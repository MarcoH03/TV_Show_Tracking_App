import { html, render, useState, useEffect } from './vendor/preact-htm.js';
import { state, subscribe, flush } from './store.js';
import { Icon, Overlays, closeTop } from './ui.js';
import { refreshAll, updateBadge } from './sync.js';
import { LibraryView } from './views/library.js';
import { ShowView } from './views/show.js';
import { DiscoverView } from './views/discover.js';
import { UpcomingView } from './views/upcoming.js';
import { ListsView, ListDetailView } from './views/lists.js';
import { ProfileView } from './views/profile.js';
import { stack, navState, goBack } from './nav.js';

const TABS = [
  { id: 'shows', label: 'My Shows', icon: 'tv' },
  { id: 'upcoming', label: 'Upcoming', icon: 'calendar' },
  { id: 'discover', label: 'Discover', icon: 'search' },
  { id: 'lists', label: 'Lists', icon: 'lists' },
  { id: 'profile', label: 'Profile', icon: 'person' },
];

function parse(hash) {
  const [path, query = ''] = (hash.replace(/^#\/?/, '') || 'shows').split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(query), path };
}

// Remember where each URL was scrolled to so "back" lands where you left off.
const scrolls = new Map();

function useRoute() {
  const [hash, setHash] = useState(location.hash || '#/shows');
  useEffect(() => {
    let prev = location.hash || '#/shows';
    stack.push(prev);
    const onChange = () => {
      scrolls.set(prev, window.scrollY);
      const next = location.hash || '#/shows';
      const isBack = stack.length > 1 && stack[stack.length - 2] === next;
      if (isBack) stack.pop(); else stack.push(next);
      prev = next;
      setHash(next);
      requestAnimationFrame(() => window.scrollTo(0, isBack || !next.includes('/show/') ? (scrolls.get(next) || 0) : 0));
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function App() {
  const [, setVersion] = useState(0);
  useEffect(() => subscribe(setVersion), []);
  const hash = useRoute();
  const { parts, query } = parse(hash);
  const [root, id] = parts;

  if (TABS.some(t => t.id === root)) navState.lastTab = root;
  const tab = navState.lastTab;
  const backLabel = TABS.find(t => t.id === tab)?.label;

  useEffect(() => { document.documentElement.dataset.accent = state.settings.accent || 'pink'; }, [state.settings.accent]);

  let view;
  switch (root) {
    case 'show': view = html`<${ShowView} key=${id} id=${Number(id)} backLabel=${backLabel} />`; break;
    case 'list': view = html`<${ListDetailView} key=${id} id=${id} />`; break;
    case 'upcoming': view = html`<${UpcomingView} />`; break;
    case 'discover': view = html`<${DiscoverView} q=${query.get('q') || ''} />`; break;
    case 'lists': view = html`<${ListsView} />`; break;
    case 'profile': view = html`<${ProfileView} section=${id} />`; break;
    default: view = html`<${LibraryView} seg=${query.get('seg')} />`;
  }

  const unread = state.news.filter(n => !n.read).length;
  return html`
    <div class="shell">
      <nav class="tabbar" aria-label="Main">
        <div class="sidebar-brand"><span class="brand-dot"></span>TV Tracker</div>
        ${TABS.map(t => html`
          <a href=${'#/' + t.id} class=${'tab' + (tab === t.id ? ' active' : '')} aria-current=${tab === t.id ? 'page' : null}
            onClick=${e => { if (tab === t.id && root === t.id) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }}>
            <span class="tab-icon"><${Icon} name=${t.icon} size=${26} stroke=${1.8} />
              ${t.id === 'upcoming' && unread > 0 && html`<span class="tab-badge">${unread > 9 ? '9+' : unread}</span>`}</span>
            <span class="tab-label">${t.label}</span>
          </a>`)}
      </nav>
      <main class="content" key=${root + (id || '')}>${view}</main>
      <${Overlays} />
    </div>`;
}

// ---------- Boot ----------

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type === 'navigate' && e.data.url) location.hash = e.data.url.replace(/^.*#/, '#');
  });
}
navigator.storage?.persist?.().catch(() => {});

// Refresh followed shows on launch and whenever the app comes back to the foreground.
const kick = () => refreshAll().catch(e => console.warn(e));
setTimeout(kick, 800);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') kick();
  else flush();
});
window.addEventListener('pagehide', flush);
updateBadge();

// Escape closes sheets on iPad/Mac keyboards.
window.addEventListener('keydown', e => { if (e.key === 'Escape') closeTop(); });

// Edge-swipe from the left to go back (standalone web apps don't get Safari's gesture).
let swipe = null;
window.addEventListener('touchstart', e => {
  const t = e.touches[0];
  if (t.clientX < 24 && !document.documentElement.classList.contains('modal-open') && /#\/(show|list)\//.test(location.hash)) {
    swipe = { x: t.clientX, y: t.clientY, el: document.querySelector('.content') };
  }
}, { passive: true });
window.addEventListener('touchmove', e => {
  if (!swipe) return;
  const t = e.touches[0];
  const dx = t.clientX - swipe.x;
  if (Math.abs(t.clientY - swipe.y) > 60) { swipe.el.style.transform = ''; swipe = null; return; }
  if (dx > 0) swipe.el.style.transform = `translateX(${dx * 0.6}px)`;
  swipe.dx = dx;
}, { passive: true });
window.addEventListener('touchend', () => {
  if (!swipe) return;
  const { el, dx } = swipe;
  swipe = null;
  el.style.transition = 'transform .2s ease';
  el.style.transform = '';
  setTimeout(() => { el.style.transition = ''; }, 220);
  if (dx > 90) goBack();
});
