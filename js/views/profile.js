import { html, useState } from '../vendor/preact-htm.js';
import { state, update, setSetting, exportData, importData, resetAll, ensureShow, STATUSES } from '../store.js';
import { getShowFull, lookupShow, getCachedShow } from '../api/tvmaze.js';
import { getPublicProfile, testClientId } from '../api/trakt.js';
import { getOmdbRatings } from '../api/omdb.js';
import { enableNotifications, notificationsSupported, refreshAll } from '../sync.js';
import { Page, Poster, Icon, toast, confirmSheet, epCode, relDay, starText } from '../ui.js';
import { isStandalone } from './install.js';
import { goBack } from '../nav.js';

const ACCENTS = [
  ['pink', '#FF375F'], ['orange', '#FF9500'], ['green', '#30D158'], ['teal', '#30B0C7'],
  ['blue', '#0A84FF'], ['indigo', '#5E5CE6'], ['purple', '#BF5AF2'],
];

export function ProfileView({ section }) {
  if (section === 'sources') return html`<${Sources} />`;
  if (section === 'diary') return html`<${Diary} />`;

  const shows = Object.values(state.shows);
  const eps = Object.values(state.watched).reduce((n, m) => n + Object.keys(m).length, 0);
  const rewatchEps = state.history.filter(h => h.rewatch).length;
  const minutes = state.history.length ? estimateMinutes() : 0;
  const ratings = shows.filter(s => s.rating).map(s => s.rating);
  const dist = Array.from({ length: 10 }, (_, i) => ratings.filter(r => r === i + 1).length);
  const maxDist = Math.max(1, ...dist);
  const favs = shows.filter(s => s.rating >= 9).sort((a, b) => b.rating - a.rating).slice(0, 8);

  return html`
    <${Page} title="Profile">
      <div class="stats">
        <div class="stat"><b>${shows.filter(s => s.status).length}</b><span>Shows</span></div>
        <div class="stat"><b>${eps.toLocaleString()}</b><span>Episodes</span></div>
        <div class="stat"><b>${minutes ? Math.round(minutes / 60).toLocaleString() : '—'}</b><span>Hours</span></div>
        <div class="stat"><b>${Object.keys(state.epRatings).length + ratings.length}</b><span>Ratings</span></div>
      </div>
      <div class="status-counts">
        ${Object.entries(STATUSES).map(([k, v]) => html`<a href=${`#/shows?seg=${k}`} style=${`--c:${v.color}`}>
          <b>${shows.filter(s => s.status === k).length}</b>${v.label}</a>`)}
      </div>

      ${ratings.length > 0 && html`<div class="section-head"><h2>Ratings</h2><span class="muted">${ratings.length} shows · avg ${(ratings.reduce((a, b) => a + b, 0) / ratings.length / 2).toFixed(1)}★</span></div>
        <div class="card histogram">
          <span class="h-star">★</span>
          <div class="bars">${dist.map((n, i) => html`<div class="bar" title=${`${(i + 1) / 2}★: ${n}`}><span style=${`height:${(n / maxDist) * 100}%`}></span></div>`)}</div>
          <span class="h-star">★★★★★</span>
        </div>`}

      ${favs.length > 0 && html`<div class="section-head"><h2>Favorites</h2></div>
        <div class="h-scroll shelf">${favs.map(s => html`<div class="poster-card"><${Poster} src=${s.image} title=${s.name} href=${`#/show/${s.id}`} />
          <div class="poster-sub stars-text">${starText(s.rating)}</div></div>`)}</div>`}

      <div class="section-head"><h2>Recently Watched</h2>${state.history.length > 0 && html`<a class="link" href="#/profile/diary">See all</a>`}</div>
      <${DiaryList} items=${state.history.slice(0, 5)} />

      <div class="section-head"><h2>Settings</h2></div>
      <div class="group">
        <div class="row static">
          <span class="row-main"><span class="row-title">Accent color</span></span>
          <div class="accent-picker">${ACCENTS.map(([k, c]) => html`<button class=${state.settings.accent === k ? 'on' : ''} style=${`--c:${c}`} aria-label=${k} onClick=${() => setSetting('accent', k)}></button>`)}</div>
        </div>
        <${Toggle} label="Notifications" sub=${notifSub()} value=${state.settings.notifications} onChange=${async on => {
          if (on) { const r = await enableNotifications(); if (r !== 'granted') toast(r === 'unsupported' ? 'Install the app to your Home Screen to enable notifications' : 'Permission denied — enable it in iOS Settings'); }
          else setSetting('notifications', false);
        }} />
        <${Toggle} label="Show episode summaries" sub="Off hides summaries of episodes you haven’t watched (spoiler shield)" value=${state.settings.spoilers} onChange=${v => setSetting('spoilers', v)} />
        <label class="row static">
          <span class="row-main"><span class="row-title">TV schedule country</span><span class="row-sub">For “Airing Today” in Discover</span></span>
          <select value=${state.settings.country} onChange=${e => setSetting('country', e.target.value)}>
            ${['US', 'GB', 'CA', 'AU', 'ES', 'MX', 'DE', 'FR', 'IT', 'NL', 'SE', 'JP', 'KR', 'BR', 'AR', 'IE', 'NZ'].map(c => html`<option value=${c}>${c}</option>`)}
          </select>
        </label>
        <a class="row" href="#/profile/sources"><span class="row-main"><span class="row-title">Data sources & import</span><span class="row-sub">TVmaze · Trakt · IMDb/Rotten Tomatoes</span></span><${Icon} name="chevron" size=${16} class="chev" /></a>
      </div>

      <div class="section-head"><h2>Your Data</h2></div>
      <div class="group">
        <button class="row" onClick=${backup}><span class="row-main"><span class="row-title accent">Export backup</span><span class="row-sub">Save everything as a file (use it to move to another device)</span></span></button>
        <label class="row"><span class="row-main"><span class="row-title accent">Import backup</span><span class="row-sub">Restore from an exported file</span></span>
          <input type="file" accept="application/json,.json" hidden onChange=${restore} /></label>
        <button class="row" onClick=${async () => { if (await confirmSheet({ title: 'Erase all data?', message: 'This removes every show, list, rating and watch history from this device.', confirm: 'Erase Everything' })) { resetAll(); toast('All data erased'); } }}>
          <span class="row-main"><span class="row-title danger">Erase all data</span></span></button>
      </div>
      <p class="footnote center">
        Your data is stored on this device${isStandalone() ? '' : ' (in this browser)'}. Export a backup now and then.<br />
        Show data from <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a>${state.settings.traktClientId ? ' & Trakt' : ''}.
      </p>
    </${Page}>`;
}

function notifSub() {
  if (!notificationsSupported()) return 'Requires adding the app to your Home Screen (iOS 16.4+)';
  if (Notification.permission === 'denied') return 'Blocked — allow in Settings › Notifications';
  return 'New episodes & season announcements. Checked whenever you open the app.';
}

function estimateMinutes() {
  let total = 0;
  for (const [showId, eps] of Object.entries(state.watched)) {
    const b = peekRuntime(showId);
    total += Object.keys(eps).length * b;
  }
  return total + state.history.filter(h => h.rewatch).length * 40;
}
const runtimeCache = {};
function peekRuntime(id) {
  if (!(id in runtimeCache)) {
    runtimeCache[id] = 40;
    getCachedShow(id).then(b => { if (b?.show.runtime) runtimeCache[id] = b.show.runtime; });
  }
  return runtimeCache[id];
}

function Toggle({ label, sub, value, onChange }) {
  return html`<label class="row static">
    <span class="row-main"><span class="row-title">${label}</span>${sub && html`<span class="row-sub">${sub}</span>`}</span>
    <input type="checkbox" class="switch" checked=${!!value} onChange=${e => onChange(e.target.checked)} />
  </label>`;
}

function DiaryList({ items }) {
  if (!items.length) return html`<p class="footnote center">Episodes you watch will appear here, like a diary.</p>`;
  return html`<div class="group">${items.map(h => {
    const s = state.shows[h.showId];
    if (!s) return null;
    const rating = state.epRatings[h.epId];
    return html`<a class="row show-row" key=${h.epId + ':' + h.at} href=${`#/show/${h.showId}`}>
      <${Poster} src=${s.image} title=${s.name} size="xs" />
      <span class="row-main">
        <span class="row-title">${s.name}</span>
        <span class="row-sub">${h.s != null ? epCode({ season: h.s, number: h.n }) + ' · ' : ''}${h.name || ''}</span>
        <span class="row-sub tiny">${relDay(h.at)}${h.rewatch ? ' · ↻ rewatch' : ''}${rating ? ` · ${starText(rating)}` : ''}</span>
      </span>
    </a>`;
  })}</div>`;
}

function Diary() {
  return html`<${Page} title="Diary" subtitle=${`${state.history.length} episodes logged`} back=${{ label: 'Profile', onClick: () => goBack('#/profile') }}>
    <${DiaryList} items=${state.history.slice(0, 300)} />
  </${Page}>`;
}

// ---------- Backup ----------

async function backup() {
  const json = exportData();
  const name = `tv-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function restore(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    if (!(await confirmSheet({ title: 'Replace your data?', message: 'Importing replaces everything on this device with the backup.', confirm: 'Import', destructive: false }))) return;
    importData(text);
    toast('Backup restored ✓');
    refreshAll({ force: true });
  } catch (err) {
    toast(err.message || 'Couldn’t read that file');
  }
}

// ---------- Data sources & Trakt import ----------

function Sources() {
  const [trakt, setTrakt] = useState(state.settings.traktClientId);
  const [omdb, setOmdb] = useState(state.settings.omdbKey);
  const [user, setUser] = useState('');
  const [importing, setImporting] = useState(null);

  const saveTrakt = async () => {
    const v = trakt.trim();
    if (v) {
      try { await testClientId(v); } catch (e) { toast(e.message); return; }
    }
    setSetting('traktClientId', v);
    toast(v ? 'Trakt connected ✓' : 'Trakt removed');
  };
  const saveOmdb = async () => {
    const v = omdb.trim();
    if (v && !(await getOmdbRatings('tt0903747', v))) { toast('OMDb rejected that key'); return; }
    setSetting('omdbKey', v);
    toast(v ? 'OMDb connected ✓' : 'OMDb removed');
  };
  const runImport = async () => {
    if (!state.settings.traktClientId) { toast('Save a Trakt Client ID first'); return; }
    if (!user.trim()) return;
    setImporting({ done: 0, total: 0, phase: 'Fetching your Trakt profile…' });
    try {
      const n = await importFromTrakt(user, p => setImporting(p));
      toast(`Imported ${n} shows from Trakt 🎉`);
    } catch (e) {
      toast(e.message);
    }
    setImporting(null);
  };

  return html`<${Page} title="Data Sources" back=${{ label: 'Profile', onClick: () => goBack('#/profile') }}>
    <div class="group">
      <div class="row static"><span class="row-emoji">📺</span><span class="row-main"><span class="row-title">TVmaze</span>
        <span class="row-sub">Shows, seasons, episodes, posters, air dates & community ratings. Always on, no account needed.</span></span>
        <span class="pill ok">On</span></div>
    </div>

    <div class="section-head"><h2>Trakt</h2>${state.settings.traktClientId && html`<span class="pill ok">Connected</span>`}</div>
    <div class="group">
      <div class="row static column">
        <span class="row-sub">Adds Trakt ratings, Trending & Most Anticipated lists, and lets you import your history from TV Forecast / Trakt.
          Create a free app at <a href="https://trakt.tv/oauth/applications/new" target="_blank" rel="noopener">trakt.tv/oauth/applications</a>
          (any name; redirect URI <code>urn:ietf:wg:oauth:2.0:oob</code>) and paste its <b>Client ID</b>.</span>
        <div class="inline-form">
          <input value=${trakt} onInput=${e => setTrakt(e.target.value)} placeholder="Trakt Client ID" autocomplete="off" autocapitalize="off" spellcheck=${false} />
          <button class="btn primary small" onClick=${saveTrakt}>Save</button>
        </div>
      </div>
    </div>

    <div class="section-head"><h2>Import from Trakt</h2></div>
    <div class="group">
      <div class="row static column">
        <span class="row-sub">Brings in your watched episodes, watchlist and ratings. Your Trakt profile must be public
          (Trakt › Settings › Privacy). TV Forecast syncs with Trakt, so this is how to move your history over.</span>
        <div class="inline-form">
          <input value=${user} onInput=${e => setUser(e.target.value)} placeholder="Trakt username" autocomplete="off" autocapitalize="off" spellcheck=${false} />
          <button class="btn primary small" disabled=${!!importing} onClick=${runImport}>Import</button>
        </div>
        ${importing && html`<div class="import-progress">${importing.phase} ${importing.total ? `${importing.done}/${importing.total}` : ''}</div>`}
      </div>
    </div>

    <div class="section-head"><h2>IMDb & Rotten Tomatoes</h2>${state.settings.omdbKey && html`<span class="pill ok">Connected</span>`}</div>
    <div class="group">
      <div class="row static column">
        <span class="row-sub">Shows IMDb, Rotten Tomatoes and Metacritic scores next to yours, using a free key from
          <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noopener">omdbapi.com</a> (1,000 lookups/day).</span>
        <div class="inline-form">
          <input value=${omdb} onInput=${e => setOmdb(e.target.value)} placeholder="OMDb API key" autocomplete="off" autocapitalize="off" spellcheck=${false} />
          <button class="btn primary small" onClick=${saveOmdb}>Save</button>
        </div>
      </div>
    </div>
    <p class="footnote center">Keys are stored only on this device and sent only to that service.</p>
  </${Page}>`;
}

async function importFromTrakt(username, onProgress) {
  const clientId = state.settings.traktClientId;
  const data = await getPublicProfile(username, clientId);
  const byKey = new Map();
  const add = (show, patch) => {
    const k = show.ids?.trakt || show.ids?.imdb || show.title;
    byKey.set(k, { show, ...byKey.get(k), ...patch });
  };
  data.watched.forEach(w => add(w.show, { watched: w }));
  data.watchlist.forEach(w => add(w.show, { watchlist: true }));
  data.showRatings.forEach(r => add(r.show, { rating: r.rating }));
  const epRatings = data.epRatings;

  const items = [...byKey.values()];
  let done = 0;
  let imported = 0;
  onProgress({ done, total: items.length, phase: 'Matching shows…' });
  const results = await Promise.all(items.map(async item => {
    try {
      const match = await lookupShow({ imdb: item.show.ids?.imdb, thetvdb: item.show.ids?.tvdb });
      const bundle = match && await getShowFull(match.id);
      return bundle ? { item, bundle } : null;
    } catch { return null; } finally { onProgress({ done: ++done, total: items.length, phase: 'Matching shows…' }); }
  }));

  update(s => {
    for (const r of results) {
      if (!r) continue;
      const { item, bundle } = r;
      const entry = ensureShow(s, bundle.show, bundle.seasons);
      const epIndex = new Map(bundle.episodes.map(e => [`${e.season}x${e.number}`, e]));
      if (item.watched) {
        const set = s.watched[bundle.show.id] || (s.watched[bundle.show.id] = {});
        let latest = 0;
        for (const season of item.watched.seasons || []) {
          for (const ep of season.episodes || []) {
            const match = epIndex.get(`${season.number}x${ep.number}`);
            if (!match) continue;
            const at = Date.parse(ep.last_watched_at) || Date.now();
            set[match.id] ||= at;
            latest = Math.max(latest, at);
            if (!s.history.some(h => h.epId === match.id)) s.history.push({ showId: bundle.show.id, epId: match.id, at, rewatch: false, s: match.season, n: match.number, name: match.name });
          }
        }
        entry.lastWatchedAt = Math.max(entry.lastWatchedAt || 0, latest);
        const aired = bundle.episodes.filter(e => e.airstamp && Date.parse(e.airstamp) < Date.now());
        const allDone = aired.length && aired.every(e => set[e.id]);
        if (!entry.status) entry.status = allDone && bundle.show.status === 'Ended' ? 'finished' : 'watching';
      } else if (item.watchlist && !entry.status) {
        entry.status = 'watchlist';
      }
      if (item.rating && entry.rating == null) entry.rating = item.rating;
      for (const er of epRatings) {
        if (er.show?.ids?.trakt !== item.show.ids?.trakt) continue;
        const match = epIndex.get(`${er.episode.season}x${er.episode.number}`);
        if (match && !s.epRatings[match.id]) s.epRatings[match.id] = er.rating;
      }
      if (!entry.status && entry.rating == null) delete s.shows[bundle.show.id];
      else imported++;
    }
    s.history.sort((a, b) => b.at - a.at);
    if (s.history.length > 1000) s.history.length = 1000;
  });
  return imported;
}
