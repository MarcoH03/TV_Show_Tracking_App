import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { state, hasAired } from '../store.js';
import { useBundles } from '../hooks.js';
import { refreshAll, followed, markNewsRead, enableNotifications, notificationsSupported, buildCalendar } from '../sync.js';
import { Page, Segmented, Poster, Empty, Icon, Spinner, toast, epCode, relDay, daysUntil } from '../ui.js';
import { isStandalone } from './install.js';

let lastSeg = 'schedule';

export function UpcomingView() {
  const [seg, setSeg] = useState(lastSeg);
  const [refreshing, setRefreshing] = useState(false);
  const shows = followed();
  const bundleOf = useBundles(shows.map(s => s.id));
  const unread = state.news.filter(n => !n.read).length;

  useEffect(() => { lastSeg = seg; if (seg === 'news') { const t = setTimeout(markNewsRead, 1500); return () => clearTimeout(t); } }, [seg]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await refreshAll({ force: true });
      toast(r.news ? `${r.news} update${r.news === 1 ? '' : 's'} found` : 'Everything’s up to date');
    } catch { toast('Couldn’t refresh — are you offline?'); }
    setRefreshing(false);
  };

  const bundles = shows.map(s => bundleOf(s.id)).filter(Boolean);
  const items = [];
  const tba = [];
  for (const b of bundles) {
    for (const ep of b.episodes) {
      if (!hasAired(ep) && ep.airdate && daysUntil(ep.airdate) <= 180) items.push({ b, ep, t: new Date(ep.airstamp || ep.airdate + 'T12:00:00').getTime() });
    }
    for (const s of b.seasons) {
      const hasDatedEps = b.episodes.some(e => e.season === s.number && e.airdate);
      if (hasDatedEps) continue;
      if (s.premiereDate && daysUntil(s.premiereDate) >= 0) items.push({ b, season: s, t: new Date(s.premiereDate + 'T12:00:00').getTime() });
      else if (!s.premiereDate && !b.episodes.some(e => e.season === s.number)) tba.push({ b, season: s });
    }
  }
  items.sort((a, b) => a.t - b.t);
  const groups = [];
  for (const it of items) {
    const label = groupLabel(it.t);
    const g = groups.at(-1);
    if (g && g.label === label) g.items.push(it); else groups.push({ label, items: [it] });
  }

  const exportIcs = () => {
    const ics = buildCalendar(bundles);
    const blob = new Blob([ics], { type: 'text/calendar' });
    const file = new File([blob], 'tv-tracker.ics', { type: 'text/calendar' });
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], title: 'TV Tracker schedule' }).catch(() => {});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tv-tracker.ics';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  };

  const actions = html`<button class=${'nav-icon' + (refreshing ? ' spinning' : '')} onClick=${refresh} aria-label="Refresh"><${Icon} name="refresh" size=${22} /></button>`;

  return html`
    <${Page} title="Upcoming" actions=${actions}>
      <${NotifyPrompt} />
      <div class="sticky-seg"><${Segmented} options=${[
        { value: 'schedule', label: 'Schedule' },
        { value: 'news', label: 'News', count: unread || null },
      ]} value=${seg} onChange=${setSeg} /></div>

      ${seg === 'schedule' && html`
        ${shows.length === 0 && html`<${Empty} emoji="📅" title="No shows to follow yet" text="Shows you’re watching, rewatching or saving appear here with their next episodes and season premieres.">
          <a class="btn primary" href="#/discover">Find shows</a></${Empty}>`}
        ${shows.length > 0 && bundles.length < shows.length && html`<div class="center-pad"><${Spinner} /></div>`}
        ${groups.map(g => html`
          <div class="section-head"><h2>${g.label}</h2></div>
          <div class="group">${g.items.map(it => html`<${UpcomingRow} key=${it.ep?.id || 's' + it.season.id} item=${it} />`)}</div>`)}
        ${tba.length > 0 && html`<div class="section-head"><h2>Announced · Date TBA</h2></div>
          <div class="group">${tba.map(({ b, season }) => html`<a class="row show-row" key=${season.id} href=${`#/show/${b.show.id}`}>
            <${Poster} src=${b.show.image?.medium} title=${b.show.name} size="xs" />
            <span class="row-main"><span class="row-title">${b.show.name}</span><span class="row-sub">Season ${season.number} · premiere date not announced</span></span>
            <span class="pill">📣</span></a>`)}</div>`}
        ${bundles.length > 0 && groups.length === 0 && tba.length === 0 && html`<${Empty} emoji="😴" title="Quiet on the horizon" text="None of your shows have upcoming episodes scheduled yet." />`}
        ${bundles.length > 0 && html`<div class="button-stack padded">
          <button class="btn tinted" onClick=${exportIcs}><${Icon} name="calendar" size=${18} /> Add schedule to Calendar</button>
          <p class="footnote center">Calendar events include alerts, so you’re reminded even when the app is closed.</p>
        </div>`}`}

      ${seg === 'news' && html`<${News} />`}
    </${Page}>`;
}

function groupLabel(t) {
  const d = daysUntil(t);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d < 7) return 'This Week';
  if (d < 14) return 'Next Week';
  return new Date(t).toLocaleDateString(undefined, { month: 'long', year: new Date(t).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

function UpcomingRow({ item }) {
  const { b, ep, season } = item;
  const d = daysUntil(item.t);
  const time = ep?.airstamp ? new Date(ep.airstamp) : null;
  const timeLabel = time && (time.getHours() || time.getMinutes()) ? time.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  return html`<a class="row show-row" href=${`#/show/${b.show.id}`}>
    <${Poster} src=${b.show.image?.medium} title=${b.show.name} size="xs" />
    <span class="row-main">
      <span class="row-title">${b.show.name}</span>
      <span class="row-sub">${ep ? html`${ep.number === 1 ? html`<span class="tag">Premiere</span> ` : ''}${epCode(ep)} · ${ep.name}` : html`<span class="tag">Season ${season.number} premiere</span>`}</span>
      <span class="row-sub tiny">${relDay(item.t)}${timeLabel ? ` · ${timeLabel}` : ''}${b.show.network ? ` · ${b.show.network}` : ''}</span>
    </span>
    <span class="days"><b>${d <= 0 ? '•' : d}</b>${d > 0 ? html`<small>${d === 1 ? 'day' : 'days'}</small>` : html`<small>today</small>`}</span>
  </a>`;
}

function News() {
  if (!state.news.length) {
    return html`<${Empty} emoji="📰" title="No news yet" text="New season announcements, premiere dates and fresh episodes for shows you follow will show up here." />`;
  }
  return html`<div class="group">
    ${state.news.slice(0, 100).map(n => {
      const entry = state.shows[n.showId];
      return html`<a class=${'row show-row news' + (n.read ? '' : ' unread')} key=${n.id} href=${`#/show/${n.showId}`}>
        <${Poster} src=${entry?.image} title=${entry?.name || ''} size="xs" />
        <span class="row-main">
          <span class="row-title">${n.title}</span>
          <span class="row-sub">${n.body}</span>
          <span class="row-sub tiny">${relDay(n.at)}</span>
        </span>
        <span class="pill">${n.kind === 'season' ? '📣' : n.kind === 'premiere' ? '🎬' : '🆕'}</span>
      </a>`;
    })}
  </div>`;
}

function NotifyPrompt() {
  const [hidden, setHidden] = useState(false);
  if (hidden || state.settings.notifications || !notificationsSupported() && isStandalone()) return null;
  if (!notificationsSupported()) {
    return html`<div class="callout subtle"><span class="callout-emoji">🔔</span>
      <div><strong>Want notifications?</strong><div class="sub">Add TV Tracker to your Home Screen first — iOS only allows notifications for installed web apps.</div></div></div>`;
  }
  if (Notification.permission === 'denied') return null;
  const enable = async () => {
    const r = await enableNotifications();
    if (r !== 'granted') toast('Notifications weren’t allowed. You can change this in Settings.');
    setHidden(true);
  };
  return html`<div class="callout">
    <span class="callout-emoji">🔔</span>
    <div><strong>Get notified</strong><div class="sub">About new episodes and season announcements for shows you follow.</div></div>
    <button class="btn primary small" onClick=${enable}>Turn On</button>
  </div>`;
}
