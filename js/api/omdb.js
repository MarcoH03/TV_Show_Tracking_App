// Optional OMDb client (https://www.omdbapi.com) for IMDb, Rotten Tomatoes & Metacritic scores.
import { idbGet, idbSet } from '../db.js';

export async function getOmdbRatings(imdb, apiKey) {
  if (!imdb || !apiKey) return null;
  const key = `omdb:${imdb}`;
  const hit = await idbGet(key);
  if (hit && Date.now() - hit.at < 24 * 3600e3) return hit.value;
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdb}&apikey=${encodeURIComponent(apiKey)}`);
    const d = await res.json();
    if (d.Response === 'False') return null;
    const value = {
      imdb: d.imdbRating && d.imdbRating !== 'N/A' ? { rating: parseFloat(d.imdbRating), votes: d.imdbVotes } : null,
      others: (d.Ratings || []).filter(r => r.Source !== 'Internet Movie Database').map(r => ({ source: r.Source, value: r.Value })),
    };
    await idbSet(key, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}
