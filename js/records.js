// Turns the app's data into small, independent records so two devices can be merged safely.
//
// Every record has its own timestamp and the newest one wins ("last write wins" per record).
// Records are deliberately fine-grained, so edits made on different devices don't overwrite
// each other:
//   s:<show>:<field>      your fields for a show (status, rating, notify, …), one record each
//   m:<show>              the show's TVmaze snapshot (name, poster, network, …)
//   w:<show>:<episode>    an episode you've watched (value: when)
//   rw:<show>:<episode>   an episode watched in the current rewatch
//   er:<episode>          your rating for an episode
//   l:<list>              a list (name, emoji)
//   lm:<list>:<show>      a show's membership in a list (value: its position)
//   h:<show>:<ep>:<w|r>   a diary entry
//   n:<id>                a news item (with its read flag)
//   cfg:<name>            a setting that should follow you between devices
// Deletions are kept as "tombstones" ([time] with no value) so they reach the other devices.

export const USER_FIELDS = ['status', 'rating', 'notify', 'addedAt', 'lastWatchedAt', 'rewatchCount'];
export const META_FIELDS = ['name', 'image', 'network', 'showStatus', 'imdb', 'seasonCount', 'seasonDates'];
export const SYNCED_SETTINGS = ['accent', 'spoilers', 'country', 'traktClientId', 'omdbKey', 'followingView', 'followingSort'];
export const HISTORY_CAP = 1000;
export const NEWS_CAP = 200;
const TOMBSTONE_TTL = 90 * 864e5;

/** Small, fast string hash (FNV-1a) used to notice when a record's value changed. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

const histKey = h => `h:${h.showId}:${h.epId}:${h.rewatch ? 'r' : 'w'}`;

/** The app state → { key: value } for everything that syncs. */
export function toRecords(s) {
  const r = {};
  for (const e of Object.values(s.shows)) {
    for (const f of USER_FIELDS) r[`s:${e.id}:${f}`] = e[f] ?? null;
    const m = {};
    for (const f of META_FIELDS) if (e[f] !== undefined) m[f] = e[f];
    r[`m:${e.id}`] = m;
  }
  for (const [showId, eps] of Object.entries(s.watched)) for (const [epId, t] of Object.entries(eps)) r[`w:${showId}:${epId}`] = t;
  for (const [showId, eps] of Object.entries(s.rewatch)) for (const [epId, t] of Object.entries(eps)) r[`rw:${showId}:${epId}`] = t;
  for (const [epId, v] of Object.entries(s.epRatings)) r[`er:${epId}`] = v;
  for (const l of s.lists) {
    r[`l:${l.id}`] = { name: l.name, emoji: l.emoji, createdAt: l.createdAt };
    l.showIds.forEach((id, i) => { r[`lm:${l.id}:${id}`] = i; });
  }
  for (const h of s.history) { const k = histKey(h); if (!(k in r)) r[k] = h; }
  for (const n of s.news) if (!(`n:${n.id}` in r)) r[`n:${n.id}`] = n;
  for (const k of SYNCED_SETTINGS) if (s.settings[k] !== undefined) r[`cfg:${k}`] = s.settings[k];
  return r;
}

/**
 * { key: value } → the synced parts of the app state. `prev` supplies local-only bits
 * (e.g. when a snapshot was last refreshed) that aren't part of the records.
 */
export function fromRecords(r, prev) {
  const shows = {};
  const show = id => (shows[id] ||= { id: Number(id), updatedAt: prev.shows[id]?.updatedAt || 0 });
  const watched = {}, rewatch = {}, epRatings = {}, lists = {}, members = {}, settings = {};
  const history = [], news = [];
  for (const [k, v] of Object.entries(r)) {
    const p = k.split(':');
    switch (p[0]) {
      case 's': show(p[1])[p[2]] = v; break;
      case 'm': Object.assign(show(p[1]), v); break;
      case 'w': (watched[p[1]] ||= {})[p[2]] = v; break;
      case 'rw': (rewatch[p[1]] ||= {})[p[2]] = v; break;
      case 'er': epRatings[p[1]] = v; break;
      case 'l': lists[p[1]] = { id: p[1], ...v, showIds: [] }; break;
      case 'lm': (members[p[1]] ||= []).push([v, Number(p[2])]); break;
      case 'h': history.push(v); break;
      case 'n': news.push(v); break;
      case 'cfg': settings[p[1]] = v; break;
    }
  }
  for (const [listId, ms] of Object.entries(members)) {
    if (!lists[listId]) continue;
    lists[listId].showIds = ms.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(m => m[1]);
  }
  for (const e of Object.values(shows)) {
    for (const f of USER_FIELDS) if (!(f in e)) e[f] = null;
    e.name ??= '';
  }
  history.sort((a, b) => b.at - a.at || (histKey(a) < histKey(b) ? -1 : 1));
  news.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
  return {
    shows, watched, rewatch, epRatings, settings,
    lists: Object.values(lists).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || (a.id < b.id ? -1 : 1)),
    history: history.slice(0, HISTORY_CAP),
    news: news.slice(0, NEWS_CAP),
  };
}

/**
 * Should a record that disappeared locally become a tombstone (a deletion other devices must
 * apply)? Diary and news entries also disappear when the app trims old ones, which must not
 * delete them elsewhere.
 */
export function isDeletion(key, current, historyLength) {
  if (key.startsWith('n:')) return false;
  if (key.startsWith('h:')) {
    const [, showId, epId, kind] = key.split(':');
    const watchKey = `${kind === 'r' ? 'rw' : 'w'}:${showId}:${epId}`;
    return historyLength < HISTORY_CAP || !(watchKey in current);
  }
  return true;
}

// A record in a merged map is [time, value] (alive) or [time] (deleted).
const sig = rec => (rec.length > 1 ? `${rec[0]}|${hash(JSON.stringify(rec[1]))}` : `${rec[0]}|x`);

function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a[0] !== b[0]) return a[0] > b[0] ? a : b;
  return sig(a) >= sig(b) ? a : b; // same instant: pick deterministically so devices agree
}

/** Merge two record maps: per key, the newest record wins. Old tombstones and overflow are dropped. */
export function mergeMaps(local, remote, now = Date.now()) {
  const out = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const rec = newer(local[k], remote[k]);
    if (rec.length === 1 && now - rec[0] > TOMBSTONE_TTL) continue;
    out[k] = rec;
  }
  // Keep only the newest diary entries and news, like the app does.
  for (const [prefix, cap] of [['h:', HISTORY_CAP], ['n:', NEWS_CAP]]) {
    const alive = Object.keys(out).filter(k => k.startsWith(prefix) && out[k].length > 1);
    if (alive.length <= cap) continue;
    alive.sort((a, b) => (out[b][1].at || 0) - (out[a][1].at || 0));
    for (const k of alive.slice(cap)) delete out[k];
  }
  return out;
}

/** True when both maps hold exactly the same records. */
export function sameMaps(a, b) {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => b[k] && sig(a[k]) === sig(b[k]));
}

/** The sync file: one record per line, sorted, so each commit's diff on GitHub is readable. */
export function serialize(map, meta) {
  const lines = Object.keys(map).sort().map(k => `${JSON.stringify(k)}:${JSON.stringify(map[k])}`);
  return `{"app":"tv-tracker","schema":1,${Object.entries(meta).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)},`).join('')}"records":{\n${lines.join(',\n')}\n}}\n`;
}

export function parse(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== 'tv-tracker' || typeof data.records !== 'object') throw new Error('That file isn’t TV Tracker sync data.');
  const out = {};
  for (const [k, rec] of Object.entries(data.records)) if (Array.isArray(rec) && typeof rec[0] === 'number') out[k] = rec;
  return out;
}
