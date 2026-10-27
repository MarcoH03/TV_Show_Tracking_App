// "Following": every show you track, as a poster grid or a list, each with a progress badge
// (episodes watched, how many are left, and a ring in the colour of its status).
import { html, useState } from '../vendor/preact-htm.js';
import { state, STATUSES, PAUSED, isPaused, progress, setSetting } from '../store.js';
import { useBundles } from '../hooks.js';
import { Page, Poster, Icon, ProgressRing, ProgressBar, ScopeChips, Segmented, Empty, actionSheet, epCode } from '../ui.js';
import { goBack } from '../nav.js';

const SEGMENTS = ['watching', 'rewatching', 'paused', 'watchlist', 'finished'];
const segOf = e => e.status || (isPaused(e) ? 'paused' : null);
const metaOf = seg => STATUSES[seg] || PAUSED;

const SORTS = {
  recent: { label: 'Recently Watched', fn: (a, b) => activity(b.entry) - activity(a.entry) },
  name: { label: 'Name (A–Z)', fn: (a, b) => a.entry.name.localeCompare(b.entry.name) },
  most: { label: 'Most Episodes Left', fn: (a, b) => (b.prog.left ?? -1) - (a.prog.left ?? -1) },
  least: { label: 'Fewest Episodes Left', fn: (a, b) => left(a) - left(b) },
};
const activity = e => e.lastWatchedAt || e.updatedAt || e.addedAt || 0;
// Shows with nothing left sort after the ones you can still watch.
const left = x => (x.prog.left > 0 ? x.prog.left : 1e6);

let lastFilter = 'all'; // remembered while the app is open, so "back" returns to the same filter

/** Every tracked show: anything with a status, plus paused shows (progress but no status). */
export const followedShows = () => Object.values(state.shows).filter(segOf);

export function FollowingView() {
  const view = state.settings.followingView || 'grid';
  const sort = SORTS[state.settings.followingSort] ? state.settings.followingSort : 'recent';
  const [chosen, setChosen] = useState(lastFilter);
  const all = followedShows();
  const bundleOf = useBundles(all.map(e => e.id));

  const counts = Object.fromEntries(SEGMENTS.map(k => [k, all.filter(e => segOf(e) === k).length]));
  const filter = chosen !== 'all' && !counts[chosen] ? 'all' : chosen;
  const options = [
    { value: 'all', label: 'All', count: all.length },
    ...SEGMENTS.filter(k => counts[k]).map(k => ({ value: k, label: metaOf(k).label, color: metaOf(k).color, count: counts[k] })),
  ];

  const rows = all
    .filter(e => filter === 'all' || segOf(e) === filter)
    .map(entry => ({ entry, seg: segOf(entry), bundle: bundleOf(entry.id), prog: progress(entry.id, bundleOf(entry.id)) }))
    .sort(SORTS[sort].fn);

  const chooseSort = () => actionSheet({
    title: 'Sort by',
    actions: Object.entries(SORTS).map(([k, v]) => ({ label: (k === sort ? '✓ ' : '') + v.label, onClick: () => setSetting('followingSort', k) })),
  });

  return html`
    <${Page} title="Following" subtitle=${`${all.length} show${all.length === 1 ? '' : 's'}`} back=${{ label: 'Profile', onClick: () => goBack('#/profile') }}
      actions=${html`<button class="nav-icon" onClick=${chooseSort} aria-label="Sort"><${Icon} name="sort" size=${22} /></button>`}>
      ${all.length === 0
        ? html`<${Empty} emoji="📺" title="No shows yet" text="Shows you watch, rewatch, pause, finish or save to your watchlist will all appear here.">
            <a class="btn primary" href="#/discover">Find shows</a></${Empty}>`
        : html`
          <div class="sticky-seg following-bar">
            <${ScopeChips} label="Filter by status" options=${options} value=${filter} onChange=${v => { lastFilter = v; setChosen(v); }} />
            <div class="following-tools">
              <span class="muted small">Sorted by ${SORTS[sort].label.toLowerCase()}</span>
              <${Segmented} small options=${[
                { value: 'grid', label: html`<${Icon} name="grid" size=${16} /> Grid` },
                { value: 'list', label: html`<${Icon} name="rows" size=${16} stroke=${2.4} /> List` },
              ]} value=${view} onChange=${v => setSetting('followingView', v)} />
            </div>
          </div>
          ${view === 'grid'
            ? html`<div class="poster-grid following-grid">${rows.map(r => html`<${GridCard} key=${r.entry.id} ...${r} />`)}</div>`
            : html`<div class="group">${rows.map(r => html`<${ListRow} key=${r.entry.id} ...${r} />`)}</div>`}`}
    </${Page}>`;
}

/** Ring in the status colour, filled by progress, showing episodes watched; plus what's left. */
function ProgressBadge({ seg, prog, bundle, size = 28 }) {
  const color = metaOf(seg).color;
  let leftText;
  if (!bundle) leftText = '…';
  else if (prog.left > 0) leftText = `${prog.left} left`;
  else if (prog.aired === 0) leftText = 'Soon';
  else leftText = '✓';
  return html`<span class=${'prog-badge' + (prog.left > 0 ? '' : ' done')} style=${`--c:${color}`}
      aria-label=${`${prog.watched} watched${prog.left > 0 ? `, ${prog.left} left` : ''}`}>
    <${ProgressRing} pct=${prog.pct} size=${size} color=${color}>${prog.watched}</${ProgressRing}>
    <span class="prog-left">${leftText}</span>
  </span>`;
}

function GridCard({ entry, seg, bundle, prog }) {
  return html`<div class="poster-card">
    <${Poster} src=${entry.image} title=${entry.name} href=${`#/show/${entry.id}`}
      badge=${html`<${ProgressBadge} seg=${seg} prog=${prog} bundle=${bundle} />`} />
    <div class="poster-title">${entry.name}</div>
    <div class="poster-sub" style=${`color:${metaOf(seg).color}`}>${metaOf(seg).label}</div>
  </div>`;
}

function ListRow({ entry, seg, bundle, prog }) {
  const meta = metaOf(seg);
  let detail = '';
  if (bundle) {
    if (prog.next) detail = html`Next <b>${epCode(prog.next)}</b> ${prog.next.name}`;
    else if (prog.last) detail = html`Last <b>${epCode(prog.last)}</b> ${prog.last.name}`;
    else detail = prog.aired ? `${prog.aired} episodes out` : 'Not out yet';
  }
  return html`<a class="row show-row following-row" href=${`#/show/${entry.id}`}>
    <${Poster} src=${entry.image} title=${entry.name} size="sm" />
    <span class="row-main">
      <span class="row-title">${entry.name}</span>
      <span class="row-sub tiny"><span class="status-badge inline" style=${`--c:${meta.color}`}>${meta.label}</span>
        ${bundle && prog.aired ? ` ${prog.watched}/${prog.aired} watched` : ''}</span>
      <span class="row-sub">${detail}</span>
      ${bundle && prog.aired > 0 && html`<span class="row-progress"><${ProgressBar} pct=${prog.pct} color=${meta.color} /></span>`}
    </span>
    <${ProgressBadge} seg=${seg} prog=${prog} bundle=${bundle} size=${40} />
  </a>`;
}

/** Profile entry point: poster stack + counts per status, opens the Following page. */
export function FollowingLink() {
  const all = followedShows().sort((a, b) => activity(b) - activity(a));
  const counts = SEGMENTS.map(k => [k, all.filter(e => segOf(e) === k).length]).filter(([, n]) => n);
  return html`<a class="row following-link" href="#/profile/shows">
    <span class="poster-stack">
      ${all.slice(0, 3).map(e => html`<${Poster} key=${e.id} src=${e.image} title=${e.name} size="xs" />`)}
      ${!all.length && html`<span class="poster xs ghost"></span>`}
    </span>
    <span class="row-main">
      <span class="row-title">All my shows</span>
      <span class="row-sub tiny">${all.length
        ? counts.map(([k, n], i) => html`${i ? ' · ' : ''}<span style=${`color:${metaOf(k).color}`}>${n} ${metaOf(k).label.toLowerCase()}</span>`)
        : 'Nothing tracked yet'}</span>
    </span>
    <span class="following-count">${all.length}</span>
    <${Icon} name="chevron" size=${16} class="chev" />
  </a>`;
}
