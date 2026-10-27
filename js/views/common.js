// Pieces shared between screens: add-to-list sheet, status picker, episode sheet, show rows.
import { html, useState } from '../vendor/preact-htm.js';
import {
  state, STATUSES, SELECTABLE, PAUSED, setStatus, toggleInList, createList, markEpisodes, markUpTo, markAllWatched, removeShow, rateEpisode,
  isActiveWatched, hasAired, activeSet,
} from '../store.js';
import { getShowFull } from '../api/tvmaze.js';
import { Icon, Poster, Stars, openSheet, actionSheet, confirmSheet, toast, epCode, fmtDate, relDay, daysUntil } from '../ui.js';

export const EMOJIS = ['🍿', '📺', '🎬', '⭐️', '❤️', '🔥', '👻', '😂', '🧠', '🌙', '🚀', '🐉', '🕵️', '🏆', '🎄', '☕️'];

/** Sheet listing your lists with checkmarks so a show can be added to several at once. */
export function openAddToList(show) {
  openSheet(({ close }) => html`<${AddToListSheet} show=${show} close=${close} />`);
}

function AddToListSheet({ show, close }) {
  const [name, setName] = useState('');
  const create = e => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = createList(name.trim(), EMOJIS[state.lists.length % EMOJIS.length]);
    toggleInList(id, show);
    setName('');
  };
  return html`
    <div class="sheet-header"><button class="link" onClick=${close}>Done</button><h2>Add to List</h2><span></span></div>
    <div class="sheet-body">
      <div class="sheet-subject">
        <${Poster} src=${show.image?.medium || show.image} title=${show.name} size="xs" />
        <strong>${show.name}</strong>
      </div>
      <div class="group">
        ${state.lists.map(l => {
          const on = l.showIds.includes(show.id);
          return html`<button class="row" key=${l.id} onClick=${() => toggleInList(l.id, show)}>
            <span class="row-emoji">${l.emoji}</span>
            <span class="row-main"><span class="row-title">${l.name}</span><span class="row-sub">${l.showIds.length} shows</span></span>
            <span class=${'check' + (on ? ' on' : '')}><${Icon} name="check" size=${16} stroke=${3} /></span>
          </button>`;
        })}
        <form class="row new-list" onSubmit=${create}>
          <span class="row-emoji plus"><${Icon} name="plus" size=${18} stroke=${2.4} /></span>
          <input value=${name} onInput=${e => setName(e.target.value)} placeholder="New list…" enterkeyhint="done" aria-label="New list name" />
          ${name && html`<button class="link" type="submit">Create</button>`}
        </form>
      </div>
    </div>`;
}

/** Quick status chooser used from search results / posters. */
export async function quickAdd(show) {
  const entry = state.shows[show.id];
  let bundle = null;
  const ensureBundle = async () => (bundle ||= await getShowFull(show.id).catch(() => null));
  const apply = async status => {
    if (entry?.status === 'finished' && status !== 'rewatching') {
      toast('You’ve seen every episode — choose Rewatching to watch it again.');
      return;
    }
    const b = await ensureBundle();
    setStatus(b?.show || show, status, b?.seasons, b);
    toast(`${show.name} → ${STATUSES[status].label}`);
  };
  // Picking Finished here means "I've seen it all": every aired episode gets marked as watched.
  const finishAll = async () => {
    const b = await ensureBundle();
    if (!b) { toast('Couldn’t load the episodes — check your connection.'); return; }
    const count = b.episodes.filter(e => hasAired(e)).length;
    const status = markAllWatched(b);
    toast(status !== 'finished'
      ? `Marked all ${count} aired episodes — new ones are already scheduled, so it stays in Watching`
      : b.show.status === 'Ended'
        ? `${show.name} → Finished · ${count} episodes marked as watched 🎉`
        : `${show.name} → Finished · all ${count} aired episodes watched. It moves back to Watching when more is scheduled`, { duration: 4500 });
  };
  const remove = async () => {
    if (Object.keys(state.watched[show.id] || {}).length
      && !(await confirmSheet({ title: `Remove ${show.name}?`, message: 'This deletes your watch history and ratings for this show.', confirm: 'Remove' }))) return;
    removeShow(show.id);
    toast(`Removed ${show.name}`);
  };
  actionSheet({
    title: show.name,
    actions: [
      ...SELECTABLE.map(k => ({
        label: (entry?.status === k ? '✓ ' : '') + STATUSES[k].label,
        icon: STATUSES[k].icon,
        onClick: () => apply(k),
      })),
      {
        label: entry?.status === 'finished' ? '✓ Finished' : 'Finished — Seen It All',
        icon: STATUSES.finished.icon,
        onClick: () => (entry?.status === 'finished' ? toast('Already finished 🎉') : finishAll()),
      },
      { label: 'Add to List…', icon: '☰', onClick: () => openAddToList(show) },
      ...(entry ? [{ label: 'Remove from My Shows', destructive: true, onClick: remove }] : []),
    ],
  });
}

export function StatusBadge({ status }) {
  if (!status) return null;
  const s = STATUSES[status] || PAUSED;
  return html`<span class="status-badge" style=${`--c:${s.color}`}>${s.label}</span>`;
}

/** Poster grid cell with title + optional subtitle. */
export function PosterCard({ show, sub, onLong }) {
  const entry = state.shows[show.id];
  const status = entry?.status;
  const badge = status ? html`<span class="poster-dot" style=${`--c:${STATUSES[status].color}`} title=${STATUSES[status].label}></span>` : null;
  return html`<div class="poster-card" onContextMenu=${onLong && (e => { e.preventDefault(); onLong(); })}>
    <${Poster} src=${show.image?.medium || show.image} title=${show.name} href=${`#/show/${show.id}`} badge=${badge} />
    <div class="poster-title">${show.name}</div>
    ${sub && html`<div class="poster-sub">${sub}</div>`}
  </div>`;
}

// ---------- Episode detail sheet ----------

function airsWhen(ep) {
  if (!ep.airdate) return 'on a date to be announced';
  const r = relDay(ep.airstamp || ep.airdate);
  return r === 'Today' || r === 'Tomorrow' ? r.toLowerCase() : `on ${r}`;
}

export function openEpisode(bundle, ep) {
  openSheet(({ close }) => html`<${EpisodeSheet} bundle=${bundle} ep=${ep} close=${close} />`);
}

function EpisodeSheet({ bundle, ep, close }) {
  const showId = bundle.show.id;
  const watched = isActiveWatched(showId, ep.id);
  const aired = hasAired(ep);
  const [reveal, setReveal] = useState(state.settings.spoilers || watched);
  const days = daysUntil(ep.airstamp || ep.airdate);
  const rating = state.epRatings[ep.id];
  const toggle = () => {
    const msg = markEpisodes(bundle, [ep], !watched);
    if (msg) toast(msg);
  };
  const upTo = () => {
    const msg = markUpTo(bundle, ep);
    toast(msg || `Marked everything up to ${epCode(ep)} as watched`);
    close();
  };
  const before = bundle.episodes.filter(e => hasAired(e) && (e.season < ep.season || (e.season === ep.season && e.number < ep.number)) && !activeSet(showId)[e.id]).length;
  return html`
    <div class="sheet-header"><span></span><h2>${epCode(ep)}</h2><button class="link" onClick=${close}>Done</button></div>
    <div class="sheet-body episode-sheet">
      ${ep.image && html`<div class=${'ep-still' + (reveal ? '' : ' blurred')}><img src=${ep.image} alt="" /></div>`}
      <h3 class="ep-title">${ep.name}</h3>
      <div class="ep-meta">
        ${fmtDate(ep.airstamp || ep.airdate, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
        ${!aired && days != null && html` · <span class="accent">${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}</span>`}
        ${ep.runtime && html` · ${ep.runtime} min`}
      </div>
      ${ep.summary && (reveal
        ? html`<p class="ep-summary">${ep.summary}</p>`
        : html`<button class="spoiler" onClick=${() => setReveal(true)}>Summary hidden to avoid spoilers · Tap to show</button>`)}

      <div class="group rating-group">
        <div class="row static">
          <span class="row-main"><span class="row-title">Your rating</span></span>
          <${Stars} value=${rating} onChange=${v => rateEpisode(ep.id, v)} size=${26} />
        </div>
        ${ep.rating != null && html`<div class="row static">
          <span class="row-main"><span class="row-title">TVmaze community</span></span>
          <span class="score">${ep.rating.toFixed(1)}<small>/10</small></span>
        </div>`}
      </div>

      ${(aired || watched) && html`<div class="button-stack">
        <button class=${'btn ' + (watched ? 'secondary' : 'primary')} onClick=${toggle}>
          <${Icon} name="check" size=${18} stroke=${2.6} /> ${watched ? 'Watched ✓ — tap to undo' : 'Mark as Watched'}
        </button>
        ${aired && before > 0 && html`<button class="btn tinted" onClick=${upTo}>
          Watched up to here <small>(+${before + (watched ? 0 : 1)} episodes)</small>
        </button>`}
      </div>`}
      ${!aired && html`<p class="footnote">Airs ${airsWhen(ep)}. You can mark it as watched once it’s out — you’ll get a heads-up if notifications are on.</p>`}
    </div>`;
}
