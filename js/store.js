// User data: everything you track lives here and is saved to localStorage on this device.
// Show/episode metadata from TVmaze is cached separately in IndexedDB (see api/tvmaze.js).

const KEY = 'tvtrack.v1';
const listeners = new Set();

// Watching / Rewatching / Watchlist are chosen by you. Finished is never picked by hand:
// a show becomes Finished on its own once it has ended and you've watched every episode.
export const STATUSES = {
  watching: { label: 'Watching', color: 'var(--green)', icon: '▶︎', selectable: true },
  rewatching: { label: 'Rewatching', color: 'var(--purple)', icon: '↻', selectable: true },
  watchlist: { label: 'Watchlist', color: 'var(--orange)', icon: '＋', selectable: true },
  finished: { label: 'Finished', color: 'var(--blue)', icon: '✓', selectable: false },
};
/** Shows with logged progress but no status: you've seen some of it but aren't watching it right now. */
export const PAUSED = { label: 'Paused', color: 'var(--teal)', icon: '❙❙' };
export const SELECTABLE = Object.keys(STATUSES).filter(k => STATUSES[k].selectable);

function blank() {
  return {
    version: 1,
    shows: {},      // id -> { id, name, image, status, rating, notify, addedAt, updatedAt, lastWatchedAt, rewatchCount, seasonCount, network, showStatus }
    watched: {},    // showId -> { epId: timestamp }
    rewatch: {},    // showId -> { epId: timestamp }  (progress of the current rewatch)
    epRatings: {},  // epId -> rating (1-10, i.e. half stars)
    lists: [],      // { id, name, emoji, showIds: [], createdAt }
    history: [],    // diary: { showId, epId, at, rewatch }
    news: [],       // { id, showId, kind, title, body, at, read }
    notified: {},   // key -> timestamp (avoid duplicate notifications)
    settings: { accent: 'pink', notifications: false, traktClientId: '', omdbKey: '', country: 'US', lastRefresh: 0, spoilers: false },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const data = JSON.parse(raw);
    const b = blank();
    return { ...b, ...data, settings: { ...b.settings, ...data.settings } };
  } catch {
    return blank();
  }
}

export let state = load();

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.error('Save failed', e); }
  }, 150);
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let version = 0;
export const getVersion = () => version;

/** Mutate state through this so the UI re-renders and data is saved. */
export function update(fn) {
  fn(state);
  version++;
  save();
  listeners.forEach(l => l(version));
}

export function flush() {
  clearTimeout(saveTimer);
  localStorage.setItem(KEY, JSON.stringify(state));
}

// ---------- Shows ----------

export function snapshotFrom(show, seasons) {
  return {
    name: show.name,
    image: show.image?.medium || null,
    network: show.network,
    showStatus: show.status,
    imdb: show.externals?.imdb || null,
    ...(seasons ? { seasonCount: seasons.length, seasonDates: Object.fromEntries(seasons.map(s => [s.number, s.premiereDate || null])) } : {}),
  };
}

export function ensureShow(s, show, seasons) {
  if (!s.shows[show.id]) {
    s.shows[show.id] = { id: show.id, status: null, rating: null, notify: true, addedAt: Date.now(), rewatchCount: 0 };
  }
  const snap = snapshotFrom(show, seasons);
  for (const k in snap) if (snap[k] === undefined || snap[k] === null && s.shows[show.id][k] != null) delete snap[k];
  Object.assign(s.shows[show.id], snap, { updatedAt: Date.now() });
  return s.shows[show.id];
}

/**
 * Set a hand-picked status (watching / rewatching / watchlist, or null to clear it).
 * Pass the TVmaze bundle when you have it so Finished can be worked out right away.
 */
export function setStatus(show, status, seasons, bundle) {
  if (status && !STATUSES[status]?.selectable) throw new Error(`${status} can't be chosen by hand`);
  update(s => {
    const entry = ensureShow(s, show, seasons);
    const prev = entry.status;
    entry.status = status;
    if (status === 'rewatching' && prev !== 'rewatching') s.rewatch[show.id] = {};
    if (status !== 'rewatching') delete s.rewatch[show.id];
    if (status === 'watching' || status === 'rewatching') entry.notify = true;
    if (bundle) reconcile(s, bundle);
    pruneShow(s, show.id);
  });
}

/** True when the show has ended and every aired episode is in your watch history. */
export function isComplete(watchedSet, bundle) {
  if (!bundle || bundle.show.status !== 'Ended') return false;
  const aired = bundle.episodes.filter(e => hasAired(e));
  return aired.length > 0 && aired.every(e => watchedSet?.[e.id]);
}

/**
 * Keep the automatic Finished state in sync with your history: finish a show once it's complete,
 * and move it back to Watching if it stops being complete (an episode unmarked, or the show is revived).
 * Returns 'finished' when the show just became Finished.
 */
export function reconcile(s, bundle) {
  const id = bundle.show.id;
  const entry = s.shows[id];
  if (!entry || entry.status === 'rewatching') return null;
  const done = isComplete(s.watched[id], bundle);
  if (done && entry.status !== 'finished') { entry.status = 'finished'; return 'finished'; }
  if (!done && entry.status === 'finished') entry.status = 'watching';
  return null;
}

export const isPaused = entry => !entry.status && Object.keys(state.watched[entry.id] || {}).length > 0;

/** Remove a show entry entirely if nothing references it any more. */
function pruneShow(s, id) {
  const e = s.shows[id];
  if (!e) return;
  const inList = s.lists.some(l => l.showIds.includes(id));
  const hasWatched = Object.keys(s.watched[id] || {}).length > 0;
  if (!e.status && !inList && !hasWatched && e.rating == null) delete s.shows[id];
}

export function removeShow(id) {
  update(s => {
    delete s.shows[id];
    delete s.watched[id];
    delete s.rewatch[id];
    s.lists.forEach(l => { l.showIds = l.showIds.filter(x => x !== id); });
    s.history = s.history.filter(h => h.showId !== id);
  });
}

export function rateShow(show, rating) {
  update(s => { ensureShow(s, show).rating = rating || null; pruneShow(s, show.id); });
}

export function rateEpisode(epId, rating) {
  update(s => { if (rating) s.epRatings[epId] = rating; else delete s.epRatings[epId]; });
}

export function setNotify(id, on) {
  update(s => { if (s.shows[id]) s.shows[id].notify = on; });
}

// ---------- Episodes ----------

const isRewatching = (s, id) => s.shows[id]?.status === 'rewatching';
export const activeSet = (id) => (isRewatching(state, id) ? state.rewatch[id] : state.watched[id]) || {};
export const isWatched = (showId, epId) => !!state.watched[showId]?.[epId];
export const isActiveWatched = (showId, epId) => !!activeSet(showId)[epId];

/** Episodes in airing order. */
export const order = eps => [...eps].sort((a, b) => a.season - b.season || a.number - b.number);

export function hasAired(ep, now = Date.now()) {
  if (ep.airstamp) return new Date(ep.airstamp).getTime() <= now;
  if (ep.airdate) return new Date(ep.airdate + 'T23:59:59').getTime() <= now;
  return false;
}

function markIn(s, showId, eps, on, log = true) {
  const rewatching = isRewatching(s, showId);
  const bucketName = rewatching ? 'rewatch' : 'watched';
  const bucket = s[bucketName][showId] || (s[bucketName][showId] = {});
  const now = Date.now();
  for (const ep of eps) {
    if (on && !bucket[ep.id]) {
      bucket[ep.id] = now;
      if (log) s.history.unshift({ showId, epId: ep.id, at: now, rewatch: rewatching, s: ep.season, n: ep.number, name: ep.name });
      // Rewatching also counts as having seen it at least once.
      if (rewatching) (s.watched[showId] || (s.watched[showId] = {}))[ep.id] ||= now;
    } else if (!on && bucket[ep.id]) {
      delete bucket[ep.id];
      s.history = s.history.filter(h => !(h.epId === ep.id && h.rewatch === rewatching));
    }
  }
  if (s.history.length > 1000) s.history.length = 1000;
  if (on && s.shows[showId]) s.shows[showId].lastWatchedAt = now;
}

/**
 * Mark / unmark episodes. Episodes that haven't aired yet can't be marked as watched.
 * Marking never changes a hand-picked status; it only finishes the show once it's complete.
 * Returns a celebration message when a season or the show is completed.
 * `bundle` is the TVmaze bundle so we can detect completion.
 */
export function markEpisodes(bundle, eps, on, { log = true } = {}) {
  let message = null;
  if (on) eps = eps.filter(e => hasAired(e));
  if (on && !eps.length) return null;
  update(s => {
    const entry = ensureShow(s, bundle.show, bundle.seasons);
    markIn(s, bundle.show.id, eps, on, log);
    if (!on) { reconcile(s, bundle); return; }

    const set = (isRewatching(s, bundle.show.id) ? s.rewatch : s.watched)[bundle.show.id] || {};
    const aired = bundle.episodes.filter(e => hasAired(e));
    const allDone = aired.length > 0 && aired.every(e => set[e.id]);
    const seasons = [...new Set(eps.map(e => e.season))];
    const doneSeason = seasons.reverse().find(n => {
      const se = bundle.episodes.filter(e => e.season === n);
      return se.length && se.every(e => set[e.id]);
    });

    if (allDone && entry.status === 'rewatching') {
      entry.rewatchCount = (entry.rewatchCount || 0) + 1;
      entry.status = 'watching';
      delete s.rewatch[bundle.show.id];
      reconcile(s, bundle);
      message = `Rewatch #${entry.rewatchCount} complete! 🍿`;
    } else if (reconcile(s, bundle) === 'finished') {
      message = `You finished ${bundle.show.name}! 🎉`;
    } else if (allDone) {
      message = `All caught up on ${bundle.show.name} ✨`;
    } else if (doneSeason != null) {
      message = `Season ${doneSeason} complete! 🎬`;
    }
  });
  return message;
}

/** Mark everything up to (and including) `target` as watched. */
export function markUpTo(bundle, target) {
  const eps = order(bundle.episodes).filter(e => e.season < target.season || (e.season === target.season && e.number <= target.number));
  return markEpisodes(bundle, eps, true);
}

/**
 * "I've seen it all": mark every aired episode as watched (without flooding the diary).
 * Ended shows become Finished; running ones go to Watching, caught up and waiting for more.
 */
export function markAllWatched(bundle) {
  const showId = bundle.show.id;
  update(s => {
    const entry = ensureShow(s, bundle.show, bundle.seasons);
    if (entry.status === 'rewatching') { entry.status = null; delete s.rewatch[showId]; }
    markIn(s, showId, bundle.episodes.filter(e => hasAired(e)), true, false);
    if (!entry.status || entry.status === 'watchlist') entry.status = 'watching';
    reconcile(s, bundle);
  });
  return state.shows[showId].status;
}

// ---------- Progress ----------

/** Progress for a show from its bundle (or null bundle → based on stored counts only). */
export function progress(showId, bundle) {
  const set = activeSet(showId);
  if (!bundle) {
    return { watched: Object.keys(set).length, aired: null, total: null, next: null, last: null, pct: 0 };
  }
  const eps = order(bundle.episodes);
  const aired = eps.filter(e => hasAired(e));
  const watchedEps = eps.filter(e => set[e.id]);
  const last = watchedEps.length ? watchedEps[watchedEps.length - 1] : null;
  const next = aired.find(e => !set[e.id]) || null;
  const upcoming = bundle.next || eps.find(e => !hasAired(e)) || null;
  const watchedAired = aired.filter(e => set[e.id]).length;
  return {
    watched: watchedEps.length,
    aired: aired.length,
    total: eps.length,
    left: aired.length - watchedAired,
    next,
    last,
    upcoming,
    pct: aired.length ? watchedAired / aired.length : 0,
  };
}

// ---------- Lists ----------

export function createList(name, emoji = '🍿') {
  const id = 'l' + Date.now().toString(36);
  update(s => { s.lists.push({ id, name, emoji, showIds: [], createdAt: Date.now() }); });
  return id;
}

export function renameList(id, name, emoji) {
  update(s => { const l = s.lists.find(x => x.id === id); if (l) { l.name = name; if (emoji) l.emoji = emoji; } });
}

export function deleteList(id) {
  update(s => {
    const l = s.lists.find(x => x.id === id);
    s.lists = s.lists.filter(x => x.id !== id);
    l?.showIds.forEach(sid => pruneShow(s, sid));
  });
}

export function toggleInList(listId, show) {
  update(s => {
    const l = s.lists.find(x => x.id === listId);
    if (!l) return;
    if (l.showIds.includes(show.id)) {
      l.showIds = l.showIds.filter(x => x !== show.id);
      pruneShow(s, show.id);
    } else {
      // `show` may be a TVmaze show or an existing library entry; only snapshot real TVmaze data.
      if (!s.shows[show.id]) ensureShow(s, show);
      l.showIds.push(show.id);
    }
  });
}

export function moveInList(listId, showId, dir) {
  update(s => {
    const l = s.lists.find(x => x.id === listId);
    const i = l?.showIds.indexOf(showId);
    if (i == null || i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= l.showIds.length) return;
    [l.showIds[i], l.showIds[j]] = [l.showIds[j], l.showIds[i]];
  });
}

// ---------- Settings / backup ----------

export function setSetting(key, value) { update(s => { s.settings[key] = value; }); }

export function exportData() {
  return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 1);
}

export function importData(json) {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || !data.shows) throw new Error('Not a TV Tracker backup file');
  const b = blank();
  update(s => {
    Object.assign(s, b, data, { settings: { ...b.settings, ...s.settings, ...data.settings } });
    delete s.exportedAt;
  });
}

export function resetAll() {
  update(s => { Object.assign(s, blank(), { settings: s.settings }); });
}
