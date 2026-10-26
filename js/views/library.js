import { html } from '../vendor/preact-htm.js';
import { state, STATUSES, progress, markEpisodes } from '../store.js';
import { useBundles } from '../hooks.js';
import { Page, Segmented, Poster, ProgressBar, Empty, Icon, toast, epCode, relDay, nav } from '../ui.js';
import { PosterCard, quickAdd } from './common.js';
import { InstallBanner } from './install.js';

const SEGMENTS = ['watching', 'rewatching', 'watchlist', 'finished'];

export function LibraryView({ seg }) {
  const all = Object.values(state.shows).filter(s => s.status);
  const counts = Object.fromEntries(SEGMENTS.map(k => [k, all.filter(s => s.status === k).length]));
  const active = SEGMENTS.includes(seg) ? seg : 'watching';
  const shows = all.filter(s => s.status === active);
  const bundleOf = useBundles(shows.map(s => s.id));

  const options = SEGMENTS
    .filter(k => k !== 'rewatching' || counts.rewatching > 0 || active === 'rewatching')
    .map(k => ({ value: k, label: STATUSES[k].label, count: counts[k] || null }));

  return html`
    <${Page} title="My Shows" actions=${html`<a class="nav-icon" href="#/discover" aria-label="Add a show"><${Icon} name="plus" size=${24} stroke=${2.2} /></a>`}>
      <${InstallBanner} />
      <div class="sticky-seg"><${Segmented} options=${options} value=${active} onChange=${v => nav(`#/shows?seg=${v}`)} /></div>
      ${all.length === 0
        ? html`<${Empty} emoji="🍿" title="Your couch awaits" text="Find the shows you’re watching, rewatching or want to watch — no limits on how many.">
            <a class="btn primary" href="#/discover">Find shows</a></${Empty}>`
        : active === 'watching' || active === 'rewatching'
          ? html`<${WatchingList} shows=${shows} bundleOf=${bundleOf} rewatch=${active === 'rewatching'} />`
          : html`<${Grid} shows=${shows} bundleOf=${bundleOf} kind=${active} />`}
    </${Page}>`;
}

function WatchingList({ shows, bundleOf, rewatch }) {
  if (!shows.length) {
    return html`<${Empty} emoji=${rewatch ? '🔁' : '📺'} title=${rewatch ? 'Nothing on repeat' : 'Nothing in progress'}
      text=${rewatch ? 'Open a finished show and choose Rewatching to track a new run.' : 'Mark an episode as watched or set a show to Watching and it’ll show up here.'} />`;
  }
  const rows = shows.map(s => ({ s, b: bundleOf(s.id), p: progress(s.id, bundleOf(s.id)) }));
  const upNext = rows.filter(r => !r.b || r.p.next).sort((a, b) => (b.s.lastWatchedAt || b.s.addedAt) - (a.s.lastWatchedAt || a.s.addedAt));
  const waiting = rows.filter(r => r.b && !r.p.next).sort((a, b) => airTime(a.p.upcoming) - airTime(b.p.upcoming));
  return html`
    ${upNext.length > 0 && html`<div class="section-head"><h2>Up Next</h2><span class="muted">${upNext.length}</span></div>
      <div class="group cards">${upNext.map(r => html`<${UpNextRow} key=${r.s.id} entry=${r.s} bundle=${r.b} prog=${r.p} />`)}</div>`}
    ${waiting.length > 0 && html`<div class="section-head"><h2>Waiting for Episodes</h2><span class="muted">${waiting.length}</span></div>
      <div class="group cards">${waiting.map(r => html`<${UpNextRow} key=${r.s.id} entry=${r.s} bundle=${r.b} prog=${r.p} />`)}</div>`}`;
}

const airTime = ep => (ep ? new Date(ep.airstamp || ep.airdate || 8.64e15).getTime() : 8.64e15);

function UpNextRow({ entry, bundle, prog }) {
  const next = prog.next;
  const mark = e => {
    e.preventDefault();
    e.stopPropagation();
    const msg = markEpisodes(bundle, [next], true);
    toast(msg || `Watched ${epCode(next)} · ${next.name}`, {
      action: 'Undo', onAction: () => markEpisodes(bundle, [next], false),
    });
  };
  let sub;
  if (!bundle) sub = html`<span class="muted">Loading…</span>`;
  else if (next) sub = html`<span class="next-code">${epCode(next)}</span> ${next.name}`;
  else if (prog.upcoming) sub = html`<span class="accent">${epCode(prog.upcoming)} · ${relDay(prog.upcoming.airstamp || prog.upcoming.airdate)}</span>`;
  else sub = html`<span class="muted">${bundle.show.status === 'Ended' ? 'All watched 🎉' : 'Next season TBA'}</span>`;
  return html`
    <a class="row show-row" href=${`#/show/${entry.id}`}>
      <${Poster} src=${entry.image} title=${entry.name} size="sm" />
      <span class="row-main">
        <span class="row-title">${entry.name}</span>
        <span class="row-sub">${sub}</span>
        ${bundle && html`<span class="row-progress"><${ProgressBar} pct=${prog.pct} /><span class="muted small">${prog.left > 0 ? `${prog.left} left` : `${prog.watched}/${prog.aired}`}</span></span>`}
        ${prog.last && html`<span class="row-sub tiny">Last: ${epCode(prog.last)}${entry.lastWatchedAt ? ` · ${relDay(entry.lastWatchedAt).toLowerCase()}` : ''}</span>`}
      </span>
      ${next && html`<button class="check-btn big" onClick=${mark} aria-label=${`Mark ${epCode(next)} watched`}><${Icon} name="check" size=${18} stroke=${3} /></button>`}
    </a>`;
}

function Grid({ shows, bundleOf, kind }) {
  if (!shows.length) {
    return kind === 'watchlist'
      ? html`<${Empty} emoji="🔖" title="Watchlist is empty" text="Save shows you want to start later. Tap ＋ on any show." ><a class="btn tinted" href="#/discover">Browse shows</a></${Empty}>`
      : html`<${Empty} emoji="🏁" title="No finished shows yet" text="When you watch the last episode of an ended show it lands here automatically." />`;
  }
  const sorted = [...shows].sort((a, b) => (b.lastWatchedAt || b.updatedAt || 0) - (a.lastWatchedAt || a.updatedAt || 0));
  return html`<div class="poster-grid">
    ${sorted.map(s => {
      const b = bundleOf(s.id);
      const p = progress(s.id, b);
      let sub = s.network;
      if (kind === 'finished') sub = s.rating ? '★'.repeat(Math.floor(s.rating / 2)) + (s.rating % 2 ? '½' : '') : (s.rewatchCount ? `Watched ${s.rewatchCount + 1}×` : s.network);
      if (kind === 'watchlist' && b?.next) sub = `New ep ${relDay(b.next.airstamp || b.next.airdate).toLowerCase()}`;
      if (kind === 'watchlist' && p.watched) sub = `${p.watched}/${p.aired} watched`;
      if (kind === 'finished' && b && p.left > 0 && b.show.status !== 'Ended') sub = `${p.left} new episode${p.left === 1 ? '' : 's'}`;
      return html`<${PosterCard} key=${s.id} show=${{ id: s.id, name: s.name, image: s.image }} sub=${sub} onLong=${() => quickAdd({ id: s.id, name: s.name, image: { medium: s.image } })} />`;
    })}
  </div>`;
}
