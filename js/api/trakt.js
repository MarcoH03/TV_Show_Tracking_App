// Optional Trakt client (https://trakt.docs.apiary.io). Needs a free Client ID from
// https://trakt.tv/oauth/applications — only public data is used, so no login is required.
import { idbGet, idbSet } from '../db.js';

const BASE = 'https://api.trakt.tv';

async function get(path, clientId) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': clientId },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'Trakt rejected the Client ID' : `Trakt ${res.status}`);
  return res.json();
}

async function cached(key, maxAge, fn) {
  const hit = await idbGet(key);
  if (hit && Date.now() - hit.at < maxAge) return hit.value;
  const value = await fn();
  await idbSet(key, { at: Date.now(), value });
  return value;
}

/** Community rating for a show by IMDb id. Returns { rating (0-10), votes } or null. */
export function getShowRating(imdb, clientId) {
  if (!imdb || !clientId) return Promise.resolve(null);
  return cached(`trakt:rating:${imdb}`, 24 * 3600e3, async () => {
    const r = await get(`/shows/${imdb}/ratings`, clientId);
    return r ? { rating: r.rating, votes: r.votes } : null;
  }).catch(() => null);
}

/** Trending / popular / anticipated lists — returns [{ title, year, ids }]. */
export function getShowChart(kind, clientId) {
  return cached(`trakt:${kind}`, 6 * 3600e3, async () => {
    const data = await get(`/shows/${kind}?limit=20`, clientId);
    return (data || []).map(d => d.show || d);
  });
}

export function testClientId(clientId) {
  return get('/shows/trending?limit=1', clientId);
}

/** Pulls a public Trakt profile so it can be imported. */
export async function getPublicProfile(username, clientId) {
  const u = encodeURIComponent(username.trim());
  const [watched, watchlist, showRatings, epRatings] = await Promise.all([
    get(`/users/${u}/watched/shows`, clientId),
    get(`/users/${u}/watchlist/shows`, clientId).catch(() => []),
    get(`/users/${u}/ratings/shows`, clientId).catch(() => []),
    get(`/users/${u}/ratings/episodes`, clientId).catch(() => []),
  ]);
  if (watched === null) throw new Error('Trakt user not found or profile is private');
  return { watched: watched || [], watchlist: watchlist || [], showRatings: showRatings || [], epRatings: epRatings || [] };
}
