import { html } from '../vendor/preact-htm.js';
import { state, STATUSES, PAUSED, isPaused, progress, markEpisodes } from '../store.js';
import { useBundles } from '../hooks.js';
import { Page, Segmented, Poster, ProgressBar, Empty, Icon, toast, epCode, relDay, nav } from '../ui.js';
import { PosterCard, quickAdd } from './common.js';
import { InstallBanner } from './install.js';

// "paused" isn't a status you pick: it's shows with logged progress but no status.
const SEGMENTS = ['watching', 'rewatching', 'paused', 'watchlist', 'finished'];
const OPTIONAL = ['rewatching', 'paused'];
const segOf = s => s.status || (isPaused(s) ? 'paused' : null);

export function LibraryView({ seg }) {
  const all = Object.values(state.shows).filter(segOf);
  const counts = Object.fromEntries(SEGMENTS.map(k => [k, all.filter(s => segOf(s) === k).length]));
  const active = SEGMENTS.includes(seg) ? seg : 'watching';
  const shows = all.filter(s => segOf(s) === active);
  const bundleOf = useBundles(shows.map(s => s.id));

  const options = SEGMENTS
    .filter(k => !OPTIONAL.includes(k) || counts[k] > 0 || active === k)
    .map(k => ({ value: k, label: (STATUSES[k] || PAUSED).label, count: counts[k] || null }));

  return html`
    <${Page} title="My Shows" actions=${html`<a class="nav-icon" href="#/discover" aria-label="Add a show"><${Icon} name="plus" size=${24} stroke=${2.2} /></a>`}>
      <${InstallBanner} />
      <div class="sticky-seg"><${Segmented} options=${options} value=${active} onChange=${v => nav(`#/shows?seg=${v}`)} /></div>
      ${all.length === 0
        ? html`<${Empty} emoji="🍿" title="Your couch awaits" text="Find the shows you’re watching, rewatching or want to watch — no limits on how many.">
            <a class="btn primary" href="#/discover">Find shows</a></${Empty}>`
        : active === 'watching' || active === 'rewatching' || active === 'paused'
          ? html`<${WatchingList} shows=${shows} bundleOf=${bundleOf} kind=${active} />`
          : html`<${Grid} shows=${shows} bundleOf=${bundleOf} kind=${active} />`}
    </${Page}>`;
}

const EMPTY = {
  watching: ['📺', 'Nothing in progress', 'Set a show to Watching and it’ll show up here with its next episode.'],
  rewatching: ['🔁', 'Nothing on repeat', 'Open a finished show and choose Rewatching to track a new run.'],
  paused: ['⏸️', 'Nothing paused', 'Shows you’ve logged episodes for, without a status, wait here.'],
};

function WatchingList({ shows, bundleOf, kind }) {
  if (!shows.length) {
    const [emoji, title, text] = EMPTY[kind];
    return html`<${Empty} emoji=${emoji} title=${title} text=${text} />`;
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
      : html`<${Empty} emoji="🏁" title="No finished shows yet" text="A show lands here automatically once it has ended and you’ve watched every episode." />`;
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
      return html`<${PosterCard} key=${s.id} show=${{ id: s.id, name: s.name, image: s.image }} sub=${sub} onLong=${() => quickAdd({ id: s.id, name: s.name, image: { medium: s.image } })} />`;
    })}
  </div>`;
}
