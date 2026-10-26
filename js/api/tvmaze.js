// TVmaze API client (https://www.tvmaze.com/api) — free, no key, CORS enabled.
// Rate limit is ~20 calls / 10 s, so requests go through a small queue.
import { idbGet, idbSet } from '../db.js';

const BASE = 'https://api.tvmaze.com';
const MAX_CONCURRENT = 4;
let active = 0;
const queue = [];

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => { active--; pump(); });
  }
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    pump();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path, { retries = 3 } = {}) {
  return enqueue(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(BASE + path);
      if (res.status === 429 && attempt < retries) { await sleep(1500 * (attempt + 1)); continue; }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`TVmaze ${res.status}`);
      return res.json();
    }
  });
}

// ---- Normalisers: keep only what the app needs so caches stay small. ----

const img = i => i ? { medium: i.medium || i.original, original: i.original || i.medium } : null;
const strip = html => html ? html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : '';

export function normShow(s) {
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    image: img(s.image),
    summary: strip(s.summary),
    genres: s.genres || [],
    status: s.status, // Running, Ended, To Be Determined, In Development
    premiered: s.premiered,
    ended: s.ended,
    runtime: s.averageRuntime || s.runtime,
    network: s.network?.name || s.webChannel?.name || '',
    country: s.network?.country?.code || s.webChannel?.country?.code || '',
    schedule: s.schedule,
    rating: s.rating?.average ?? null,
    weight: s.weight,
    language: s.language,
    officialSite: s.officialSite,
    externals: s.externals || {},
    url: s.url,
  };
}

export function normEpisode(e) {
  return {
    id: e.id,
    season: e.season,
    number: e.number,
    name: e.name,
    airdate: e.airdate,
    airstamp: e.airstamp,
    runtime: e.runtime,
    rating: e.rating?.average ?? null,
    image: e.image?.medium || null,
    summary: strip(e.summary),
  };
}

function normSeason(s) {
  return {
    id: s.id,
    number: s.number,
    name: s.name,
    premiereDate: s.premiereDate,
    endDate: s.endDate,
    episodeOrder: s.episodeOrder,
    image: s.image?.medium || null,
  };
}

// ---- Public API ----

export async function searchShows(q) {
  const data = await get(`/search/shows?q=${encodeURIComponent(q)}`);
  return (data || []).map(r => normShow(r.show));
}

const memo = new Map();

/** Full show bundle: show + seasons + episodes + next episode + backdrop. Cached in IndexedDB. */
export async function getShowFull(id, { maxAge = 6 * 3600e3, force = false } = {}) {
  const key = `show:${id}`;
  if (!force) {
    const hit = memo.get(key) || await idbGet(key);
    if (hit && Date.now() - hit.fetchedAt < maxAge) { memo.set(key, hit); return hit; }
  }
  const raw = await get(`/shows/${id}?embed[]=episodes&embed[]=seasons&embed[]=nextepisode&embed[]=images`);
  if (!raw) return null;
  const e = raw._embedded || {};
  const backdrop = (e.images || []).find(i => i.type === 'background' && i.main) || (e.images || []).find(i => i.type === 'background');
  const bundle = {
    show: { ...normShow(raw), backdrop: backdrop?.resolutions?.medium?.url || backdrop?.resolutions?.original?.url || null },
    seasons: (e.seasons || []).map(normSeason),
    episodes: (e.episodes || []).filter(ep => ep.number != null).map(normEpisode),
    next: e.nextepisode ? normEpisode(e.nextepisode) : null,
    fetchedAt: Date.now(),
  };
  memo.set(key, bundle);
  await idbSet(key, bundle);
  return bundle;
}

/** Cached bundle without hitting the network (may be undefined). */
export async function getCachedShow(id) {
  const key = `show:${id}`;
  const hit = memo.get(key) || await idbGet(key);
  if (hit) memo.set(key, hit);
  return hit;
}

export function peekCachedShow(id) {
  return memo.get(`show:${id}`);
}

export async function getCast(id) {
  const data = await get(`/shows/${id}/cast`);
  return (data || []).slice(0, 15).map(c => ({
    name: c.person.name,
    character: c.character?.name,
    image: c.character?.image?.medium || c.person.image?.medium || null,
  }));
}

/** Today's schedule (broadcast for a country + streaming), deduped by show, sorted by popularity. */
export async function getSchedule(date, country = 'US') {
  const key = `sched:${date}:${country}`;
  const hit = await idbGet(key);
  if (hit && Date.now() - hit.at < 3 * 3600e3) return hit.items;
  const [tv, web] = await Promise.all([
    get(`/schedule?country=${country}&date=${date}`).catch(() => []),
    get(`/schedule/web?date=${date}`).catch(() => []),
  ]);
  const shows = new Map();
  for (const ep of [...(tv || []), ...(web || [])]) {
    const s = ep.show || ep._embedded?.show;
    if (!s || shows.has(s.id)) continue;
    if (web?.includes(ep) && s.language && s.language !== 'English') continue;
    shows.set(s.id, { show: normShow(s), episode: normEpisode(ep) });
  }
  const items = [...shows.values()].sort((a, b) => (b.show.weight || 0) - (a.show.weight || 0));
  await idbSet(key, { at: Date.now(), items });
  return items;
}

/** Find the TVmaze show for an IMDb / TheTVDB id (used to map Trakt data). Cached for a week. */
export async function lookupShow({ imdb, thetvdb }) {
  const key = `lookup:${thetvdb || ''}:${imdb || ''}`;
  const hit = await idbGet(key);
  if (hit && Date.now() - hit.at < 7 * 24 * 3600e3) return hit.show;
  let show = null;
  if (thetvdb) show = await get(`/lookup/shows?thetvdb=${thetvdb}`).catch(() => null);
  if (!show && imdb) show = await get(`/lookup/shows?imdb=${imdb}`).catch(() => null);
  const norm = normShow(show);
  await idbSet(key, { at: Date.now(), show: norm });
  return norm;
}
