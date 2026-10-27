import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import {
  state, STATUSES, SELECTABLE, PAUSED, setStatus, rateShow, setNotify, removeShow, markEpisodes, markUpTo,
  progress, order, hasAired, activeSet, isWatched, isPaused,
} from '../store.js';
import { getShowFull, getCast, getCachedShow } from '../api/tvmaze.js';
import { getShowRating } from '../api/trakt.js';
import { getOmdbRatings } from '../api/omdb.js';
import {
  Icon, Poster, Stars, Spinner, ProgressBar, Empty, toast, actionSheet, confirmSheet,
  epCode, fmtDate, relDay, daysUntil, useLongPress,
} from '../ui.js';
import { openAddToList, openEpisode } from './common.js';
import { goBack } from '../nav.js';

export function ShowView({ id, backLabel }) {
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    getCachedShow(id).then(b => { if (alive && b) setBundle(b); });
    getShowFull(id, { maxAge: 30 * 60e3 })
      .then(b => { if (!alive) return; if (b) setBundle(b); else setError('Show not found'); })
      .catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [id]);

  const back = { label: backLabel || 'Back', onClick: () => goBack() };

  if (!bundle) {
    return html`<div class="page"><header class="navbar scrolled"><div class="nav-left"><button class="nav-back" onClick=${back.onClick}><${Icon} name="back" size=${22} stroke=${2.4} /><span>${back.label}</span></button></div></header>
      <div class="center-fill">${error ? html`<${Empty} emoji="📡" title="Couldn’t load show" text=${error} />` : html`<${Spinner} />`}</div></div>`;
  }
  return html`<${ShowDetail} bundle=${bundle} back=${back} />`;
}

function ShowDetail({ bundle, back }) {
  const { show, seasons } = bundle;
  const entry = state.shows[show.id];
  const status = entry?.status;
  const prog = progress(show.id, bundle);
  const [scrolled, setScrolled] = useState(false);
  const heroRef = useRef();

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { rootMargin: '-90px 0px 0px 0px' });
    if (heroRef.current) io.observe(heroRef.current);
    return () => io.disconnect();
  }, []);

  const choose = st => {
    const next = status === st ? null : st;
    if (status === 'finished' && next !== 'rewatching') {
      toast('You’ve seen every episode — choose Rewatching to watch it again.');
      return;
    }
    if (next === 'rewatching') toast('Rewatching tracks a fresh run — your first watch stays saved.');
    setStatus(show, next, seasons, bundle);
    if (!next && isPaused(state.shows[show.id] || {})) toast('Progress kept — you’ll find it under Paused in My Shows.');
  };

  // Finished isn't chosen: it's reached by watching every episode of a show that has ended.
  const firstWatchLeft = bundle.episodes.filter(e => hasAired(e) && !isWatched(show.id, e.id)).length;
  const finishedHint = status === 'finished'
    ? (entry.rewatchCount ? `Seen ${entry.rewatchCount + 1}×` : 'All watched')
    : show.status !== 'Ended' ? 'Still airing' : `${firstWatchLeft} to go`;

  const more = () => actionSheet({
    title: show.name,
    actions: [
      { label: 'Add to List…', icon: '☰', onClick: () => openAddToList(show) },
      ...(entry ? [{ label: entry.notify === false ? 'Turn On Notifications' : 'Mute Notifications', icon: '🔔', onClick: () => setNotify(show.id, entry.notify === false) }] : []),
      { label: 'Open on TVmaze', icon: '↗︎', onClick: () => window.open(show.url, '_blank') },
      ...(show.externals.imdb ? [{ label: 'Open on IMDb', icon: '↗︎', onClick: () => window.open(`https://www.imdb.com/title/${show.externals.imdb}/`, '_blank') }] : []),
      ...(navigator.share ? [{ label: 'Share…', icon: '⇪', onClick: () => navigator.share({ title: show.name, url: show.url }).catch(() => {}) }] : []),
      ...(entry ? [{
        label: 'Remove & Clear History', destructive: true,
        onClick: async () => {
          if (await confirmSheet({ title: `Remove ${show.name}?`, message: 'This deletes your watch history, ratings and list entries for this show.', confirm: 'Remove' })) {
            removeShow(show.id);
            toast(`Removed ${show.name}`);
          }
        },
      }] : []),
    ],
  });

  const year = show.premiered?.slice(0, 4);
  const years = year ? (show.ended ? `${year}–${show.ended.slice(0, 4)}` : show.status === 'Running' ? `${year}–` : year) : '';
  const upcomingSeason = seasons.find(s => s.premiereDate && daysUntil(s.premiereDate) > 0 && !bundle.episodes.some(e => e.season === s.number && hasAired(e)));
  const announced = seasons.filter(s => !s.premiereDate && !bundle.episodes.some(e => e.season === s.number && e.airdate));

  return html`
    <div class="page show-page">
      <header class=${'navbar overlay' + (scrolled ? ' scrolled' : '')}>
        <div class="nav-left"><button class="nav-back" onClick=${back.onClick}><${Icon} name="back" size=${22} stroke=${2.4} /><span>${back.label}</span></button></div>
        <div class="nav-title">${show.name}</div>
        <div class="nav-right">
          ${entry?.status && html`<button class="nav-icon" onClick=${() => { setNotify(show.id, entry.notify === false); toast(entry.notify === false ? 'Notifications on 🔔' : 'Notifications muted'); }} aria-label="Notifications">
            <${Icon} name=${entry.notify === false ? 'bellOff' : 'bell'} size=${22} /></button>`}
          <button class="nav-icon" onClick=${more} aria-label="More"><${Icon} name="more" size=${24} stroke=${3} /></button>
        </div>
      </header>

      <section class="hero" ref=${heroRef}>
        <div class="hero-bg" style=${`background-image:url('${show.backdrop || show.image?.original || ''}')`}></div>
        <div class="hero-content">
          <${Poster} src=${show.image?.medium} title=${show.name} size="lg" />
          <div class="hero-text">
            <h1>${show.name}</h1>
            <div class="hero-meta">${[years, show.network, show.runtime && `${show.runtime}m`].filter(Boolean).join(' · ')}</div>
            <div class="hero-meta"><span class=${'show-status ' + (show.status || '').replace(/\s/g, '')}>${show.status}</span></div>
            ${show.genres.length > 0 && html`<div class="chips">${show.genres.slice(0, 3).map(g => html`<span class="chip">${g}</span>`)}</div>`}
          </div>
        </div>
      </section>

      <div class="page-body show-body">
        <div class="status-picker" role="group" aria-label="Status">
          ${SELECTABLE.map(k => html`
            <button class=${'status-btn' + (status === k ? ' on' : '')} style=${`--c:${STATUSES[k].color}`} onClick=${() => choose(k)} aria-pressed=${status === k}>
              <span class="status-icon">${STATUSES[k].icon}</span>${STATUSES[k].label}
            </button>`)}
          <div class=${'status-btn state' + (status === 'finished' ? ' on' : '')} style=${`--c:${STATUSES.finished.color}`} role="status"
            title="A show becomes Finished automatically when it has ended and you’ve watched every episode">
            <span class="status-icon">${STATUSES.finished.icon}</span>${STATUSES.finished.label}<small>${finishedHint}</small>
          </div>
        </div>
        ${!status && isPaused(entry || { id: show.id }) && html`<p class="footnote status-note">
          <span class="status-badge" style=${`--c:${PAUSED.color}`}>${PAUSED.label}</span> Your progress is saved. Choose Watching when you pick it back up.</p>`}

        ${prog.watched > 0 || status === 'watching' || status === 'rewatching' ? html`<${ProgressCard} bundle=${bundle} prog=${prog} entry=${entry} />` : null}

        ${bundle.next && html`<div class="callout" onClick=${() => openEpisode(bundle, bundle.next)}>
          <span class="callout-emoji">📅</span>
          <div><strong>Next episode ${whenLabel(bundle.next.airstamp || bundle.next.airdate)}</strong>
          <div class="sub">${epCode(bundle.next)} “${bundle.next.name}” · ${fmtDate(bundle.next.airstamp || bundle.next.airdate, { weekday: 'short', month: 'short', day: 'numeric' })}${countdown(bundle.next)}</div></div>
        </div>`}
        ${!bundle.next && upcomingSeason && html`<div class="callout"><span class="callout-emoji">🎬</span>
          <div><strong>Season ${upcomingSeason.number} premieres ${fmtDate(upcomingSeason.premiereDate)}</strong><div class="sub">${countdownDays(upcomingSeason.premiereDate)}</div></div></div>`}
        ${!bundle.next && !upcomingSeason && announced.length > 0 && html`<div class="callout"><span class="callout-emoji">📣</span>
          <div><strong>Season ${announced[0].number} announced</strong><div class="sub">Premiere date not announced yet — we’ll let you know.</div></div></div>`}

        <${Ratings} show=${show} entry=${entry} />

        ${show.summary && html`<${Summary} text=${show.summary} />`}

        <${Seasons} bundle=${bundle} />

        <${Cast} id=${show.id} />
        <p class="footnote center">Data from <a href=${show.url} target="_blank" rel="noopener">TVmaze</a> (CC BY-SA)</p>
      </div>
    </div>`;
}

const whenLabel = d => { const r = relDay(d); return r === 'Today' || r === 'Tomorrow' ? r.toLowerCase() : 'on ' + r; };
const countdown = ep => { const d = daysUntil(ep.airstamp || ep.airdate); return d > 1 ? ` · in ${d} days` : ''; };
const countdownDays = date => { const d = daysUntil(date); return d === 1 ? 'Tomorrow!' : `In ${d} days`; };

function ProgressCard({ bundle, prog, entry }) {
  const rewatching = entry?.status === 'rewatching';
  const next = prog.next;
  const markNext = () => { const msg = markEpisodes(bundle, [next], true); toast(msg || `Watched ${epCode(next)} ✓`); };
  return html`
    <div class="card progress-card">
      <div class="progress-top">
        <div>
          <div class="eyebrow">${rewatching ? `Rewatch${entry.rewatchCount ? ' #' + (entry.rewatchCount + 1) : ''}` : 'Your progress'}</div>
          <div class="big-num">${prog.watched}<small> / ${prog.aired} episodes</small></div>
        </div>
        <div class="ring" style=${`--p:${prog.pct}`}><span>${Math.round(prog.pct * 100)}%</span></div>
      </div>
      <${ProgressBar} pct=${prog.pct} />
      <div class="progress-rows">
        <div><span class="label">Last watched</span><span>${prog.last ? html`<b>${epCode(prog.last)}</b> ${prog.last.name}` : '—'}</span></div>
        <div><span class="label">Up next</span><span>${next ? html`<b>${epCode(next)}</b> ${next.name}` : prog.upcoming ? 'All caught up ✨' : 'Finished 🎉'}</span></div>
      </div>
      ${next && html`<button class="btn primary small" onClick=${markNext}><${Icon} name="check" size=${16} stroke=${2.8} /> Watched ${epCode(next)}</button>`}
    </div>`;
}

function Ratings({ show, entry }) {
  const [extra, setExtra] = useState({});
  const { traktClientId, omdbKey } = state.settings;
  useEffect(() => {
    let alive = true;
    const imdb = show.externals.imdb;
    getShowRating(imdb, traktClientId).then(t => alive && t && setExtra(x => ({ ...x, trakt: t })));
    getOmdbRatings(imdb, omdbKey).then(o => alive && o && setExtra(x => ({ ...x, omdb: o })));
    return () => { alive = false; };
  }, [show.id, traktClientId, omdbKey]);

  const scores = [];
  if (extra.omdb?.imdb) scores.push({ label: 'IMDb', value: extra.omdb.imdb.rating.toFixed(1), suffix: '/10', cls: 'imdb' });
  if (extra.trakt?.rating) scores.push({ label: 'Trakt', value: Math.round(extra.trakt.rating * 10), suffix: '%', cls: 'trakt' });
  if (show.rating != null) scores.push({ label: 'TVmaze', value: show.rating.toFixed(1), suffix: '/10', cls: 'tvmaze' });
  for (const o of extra.omdb?.others || []) scores.push({ label: o.source.replace('Rotten Tomatoes', 'Tomatometer'), value: o.value, suffix: '', cls: 'rt' });

  return html`
    <div class="card ratings-card">
      <div class="my-rating">
        <div class="eyebrow">Your rating</div>
        <${Stars} value=${entry?.rating} onChange=${v => { rateShow(show, v); if (v) toast(`Rated ${show.name} ${v / 2}★`); }} size=${34} />
      </div>
      ${scores.length > 0 && html`<div class="scores">
        ${scores.map(s => html`<div class=${'score-pill ' + s.cls}><b>${s.value}<small>${s.suffix}</small></b><span>${s.label}</span></div>`)}
      </div>`}
      ${!traktClientId && !omdbKey && html`<a class="footnote link-sm" href="#/profile/sources">Add IMDb, Rotten Tomatoes & Trakt scores →</a>`}
    </div>`;
}

function Summary({ text }) {
  const [open, setOpen] = useState(false);
  return html`<div class="summary">
    <p class=${open ? '' : 'clamp'}>${text}</p>
    ${text.length > 180 && html`<button class="link" onClick=${() => setOpen(!open)}>${open ? 'Less' : 'More'}</button>`}
  </div>`;
}

function Seasons({ bundle }) {
  const { show } = bundle;
  const eps = order(bundle.episodes);
  const seasonNums = [...new Set([...bundle.seasons.map(s => s.number), ...eps.map(e => e.season)])].sort((a, b) => a - b);
  const prog = progress(show.id, bundle);
  const initial = prog.next?.season ?? (prog.last?.season || seasonNums.find(n => eps.some(e => e.season === n)) || seasonNums[0]);
  const [season, setSeason] = useState(initial);
  const set = activeSet(show.id);
  const list = eps.filter(e => e.season === season);
  const seasonInfo = bundle.seasons.find(s => s.number === season);
  const aired = list.filter(e => hasAired(e));
  const watchedCount = list.filter(e => set[e.id]).length;
  const allWatched = aired.length > 0 && aired.every(e => set[e.id]);
  const rewatching = state.shows[show.id]?.status === 'rewatching';

  const chipsRef = useRef();
  useEffect(() => {
    chipsRef.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, []);

  if (!seasonNums.length) return null;

  const toggleSeason = () => {
    const msg = markEpisodes(bundle, aired, !allWatched);
    toast(msg || (allWatched ? `Unmarked season ${season}` : `Season ${season} marked as watched`));
  };

  return html`
    <section class="seasons">
      <div class="section-head"><h2>Episodes</h2>${rewatching && html`<span class="status-badge" style="--c:var(--purple)">Rewatch mode</span>`}</div>
      <div class="season-chips" ref=${chipsRef} role="tablist">
        ${seasonNums.map(n => {
          const se = eps.filter(e => e.season === n);
          const done = se.length > 0 && se.every(e => set[e.id]);
          return html`<button role="tab" aria-selected=${n === season} class=${'season-chip' + (n === season ? ' on' : '') + (done ? ' done' : '')} onClick=${() => setSeason(n)}>
            ${done && html`<${Icon} name="check" size=${13} stroke=${3} />`}Season ${n}</button>`;
        })}
      </div>
      <div class="season-head">
        <div>
          <div class="season-meta">${list.length ? `${watchedCount} of ${list.length} watched` : 'No episodes listed yet'}${seasonInfo?.premiereDate ? ` · ${hasAired({ airdate: seasonInfo.premiereDate }) ? 'Aired' : 'Premieres'} ${fmtDate(seasonInfo.premiereDate)}` : ''}</div>
        </div>
        ${aired.length > 0 && html`<button class="btn tinted small" onClick=${toggleSeason}>${allWatched ? 'Unmark season' : 'Mark season watched'}</button>`}
      </div>
      <div class="group episodes">
        ${list.map(ep => html`<${EpisodeRow} key=${ep.id} bundle=${bundle} ep=${ep} watched=${!!set[ep.id]} seenBefore=${rewatching && isWatched(show.id, ep.id)} />`)}
        ${!list.length && html`<div class="row static muted">Episodes will appear here once they’re announced.</div>`}
      </div>
      ${list.length > 2 && html`<p class="footnote">Tip: long-press an episode (or tap it) to mark everything up to that point.</p>`}
    </section>`;
}

function EpisodeRow({ bundle, ep, watched, seenBefore }) {
  const aired = hasAired(ep);
  const myRating = state.epRatings[ep.id];
  const [pop, setPop] = useState(false);
  const toggle = e => {
    e.stopPropagation();
    if (!watched) { setPop(true); setTimeout(() => setPop(false), 400); }
    const msg = markEpisodes(bundle, [ep], !watched);
    if (msg) toast(msg);
  };
  const menu = () => actionSheet({
    title: `${epCode(ep)} · ${ep.name}`,
    message: aired ? null : 'This episode hasn’t aired yet, so it can’t be marked as watched.',
    actions: [
      ...(aired ? [
        { label: watched ? 'Mark as Unwatched' : 'Mark as Watched', icon: '✓', onClick: () => { const m = markEpisodes(bundle, [ep], !watched); if (m) toast(m); } },
        { label: `Watched Up to ${epCode(ep)}`, icon: '⤓', onClick: () => { const m = markUpTo(bundle, ep); toast(m || `Marked up to ${epCode(ep)} ✓`); } },
      ] : []),
      { label: aired ? 'Rate & Details…' : 'Details…', icon: aired ? '★' : 'ℹ︎', onClick: () => openEpisode(bundle, ep) },
      {
        label: `Unwatch From ${epCode(ep)} Onward`, icon: '↺', destructive: true,
        onClick: () => markEpisodes(bundle, bundle.episodes.filter(e => e.season > ep.season || (e.season === ep.season && e.number >= ep.number)), false),
      },
    ],
  });
  const lp = useLongPress(menu);
  const days = !aired ? daysUntil(ep.airstamp || ep.airdate) : null;
  return html`
    <div class=${'row episode' + (watched ? ' watched' : '') + (!aired ? ' unaired' : '')} onClick=${() => !lp.wasLong() && openEpisode(bundle, ep)}
      onTouchStart=${lp.onTouchStart} onTouchMove=${lp.onTouchMove} onTouchEnd=${lp.onTouchEnd} onTouchCancel=${lp.onTouchCancel} onContextMenu=${lp.onContextMenu}>
      <span class="ep-num">${ep.number}</span>
      <span class="row-main">
        <span class="row-title">${ep.name}</span>
        <span class="row-sub">
          ${aired ? fmtDate(ep.airstamp || ep.airdate) : ep.airdate ? html`<span class="accent">${days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${fmtDate(ep.airdate)} · in ${days}d`}</span>` : 'TBA'}
          ${ep.rating != null && html` · <span class="mini-score">★ ${ep.rating.toFixed(1)}</span>`}
          ${myRating && html` · <span class="mine">You ${myRating / 2}★</span>`}
          ${seenBefore && !watched && html` · <span class="seen">seen</span>`}
        </span>
      </span>
      ${aired || watched
        ? html`<button class=${'check-btn' + (watched ? ' on' : '') + (pop ? ' pop' : '')} onClick=${toggle} aria-label=${watched ? 'Mark unwatched' : 'Mark watched'} aria-pressed=${watched}>
            <${Icon} name="check" size=${16} stroke=${3} />
          </button>`
        : html`<span class="check-btn locked" aria-label="Not aired yet" title="Not aired yet"><${Icon} name="calendar" size=${15} stroke=${2} /></span>`}
    </div>`;
}

function Cast({ id }) {
  const [cast, setCast] = useState(null);
  useEffect(() => { getCast(id).then(setCast).catch(() => setCast([])); }, [id]);
  if (!cast?.length) return null;
  return html`<section>
    <div class="section-head"><h2>Cast</h2></div>
    <div class="h-scroll cast">
      ${cast.map(c => html`<div class="cast-card">
        ${c.image ? html`<img src=${c.image} alt="" loading="lazy" />` : html`<div class="cast-ph">${c.name[0]}</div>`}
        <div class="cast-name">${c.name}</div><div class="cast-char">${c.character}</div>
      </div>`)}
    </div>
  </section>`;
}
