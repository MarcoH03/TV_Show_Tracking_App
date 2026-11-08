// Sync between your devices through a JSON file in a PRIVATE GitHub repository (REST "contents" API).
// No server: each device downloads the file, merges it with its own data record by record (newest
// change wins, see records.js) and uploads the result. If another device wrote in between, GitHub
// answers 409 and the cycle repeats. Every upload is a commit, so the repository keeps full history.
import { state, update, subscribe as onStoreChange } from './store.js';
import { toRecords, fromRecords, isDeletion, mergeMaps, sameMaps, serialize, parse, hash, SYNCED_SETTINGS } from './records.js';

const CFG_KEY = 'tvtrack.cloud';
const LEDGER_KEY = 'tvtrack.cloud.ledger';
const LAST_KEY = 'tvtrack.cloud.last';
const API = 'https://api.github.com';
const POLL_MS = 30000;
export const DEFAULT_REPO = 'tv-tracker-data';
export const DEFAULT_PATH = 'tv-tracker.json';

const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

const s = {
  cfg: read(CFG_KEY, null),
  // What this device last agreed on, per record: [time, hash of value] or [time] for a deletion.
  ledger: read(LEDGER_KEY, {}),
  lastSync: Number(localStorage.getItem(LAST_KEY)) || 0,
  status: 'off', // off | idle | syncing | offline | error
  error: null,
  remote: null, // last records seen on GitHub (in memory)
  sha: null,
  etag: null,
  busy: false,
  again: false,
  applying: false,
  // While joining, this device's records are stamped as "oldest", so data already in the cloud wins
  // where both have a value (e.g. a new device's default settings) and only what's new is added.
  joining: false,
};
const listeners = new Set();
let timer = null;
let started = false;

function setStatus(status, error = null) {
  s.status = status;
  s.error = error;
  listeners.forEach(fn => fn());
}

let ledgerTimer;
function saveLedger() {
  clearTimeout(ledgerTimer);
  ledgerTimer = setTimeout(() => { try { localStorage.setItem(LEDGER_KEY, JSON.stringify(s.ledger)); } catch (e) { console.warn('[cloud] ledger', e); } }, 300);
}

class SyncError extends Error {
  constructor(message, { offline = false, auth = false } = {}) { super(message); this.offline = offline; this.auth = auth; }
}

// ---------- Local change tracking ----------

const tick = prev => Math.max(Date.now(), (prev?.[0] || 0) + 1);

/** Give every record that changed since the last sync a fresh timestamp; turn removals into deletions. */
function stamp() {
  const cur = toRecords(state);
  let changed = false;
  for (const [k, v] of Object.entries(cur)) {
    const h = hash(JSON.stringify(v));
    const prev = s.ledger[k];
    if (!prev || prev.length === 1 || prev[1] !== h) { s.ledger[k] = [s.joining && !prev ? 1 : tick(prev), h]; changed = true; }
  }
  for (const [k, prev] of Object.entries(s.ledger)) {
    if (k in cur || prev.length === 1) continue;
    if (isDeletion(k, cur, state.history.length)) s.ledger[k] = [tick(prev)];
    else delete s.ledger[k];
    changed = true;
  }
  if (changed) saveLedger();
  return cur;
}

function localMap(cur) {
  const out = {};
  for (const [k, rec] of Object.entries(s.ledger)) out[k] = rec.length > 1 ? [rec[0], cur[k]] : [rec[0]];
  return out;
}

/** Replace the synced parts of the app state with the merged records. */
function apply(merged) {
  const live = {};
  for (const [k, rec] of Object.entries(merged)) if (rec.length > 1) live[k] = rec[1];
  const d = fromRecords(live, state);
  s.applying = true;
  try {
    update(st => {
      Object.assign(st, { shows: d.shows, watched: d.watched, rewatch: d.rewatch, epRatings: d.epRatings, lists: d.lists, history: d.history, news: d.news });
      for (const k of SYNCED_SETTINGS) if (k in d.settings) st.settings[k] = d.settings[k];
    });
  } finally {
    s.applying = false;
  }
}

function adopt(merged) {
  s.ledger = {};
  for (const [k, rec] of Object.entries(merged)) s.ledger[k] = rec.length > 1 ? [rec[0], hash(JSON.stringify(rec[1]))] : [rec[0]];
  saveLedger();
}

// ---------- GitHub ----------

async function api(method, path, { body, headers = {}, cfg = s.cfg } = {}) {
  try {
    return await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${cfg.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError('Can’t reach GitHub — you’re probably offline.', { offline: true });
  }
}

async function httpError(res, what = '') {
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch { /* no body */ }
  if (res.status === 401) return new SyncError('The token isn’t valid or has expired. Create a new one and connect again.', { auth: true });
  if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) return new SyncError('GitHub is limiting requests for a moment. It will retry shortly.');
  if (res.status === 403) return new SyncError('The token can’t write to that repository. Give it “Contents: Read and write” access to it.', { auth: true });
  if (res.status === 404) return new SyncError(`Can’t find the repository${what}. Check its name and that the token has access to it.`, { auth: true });
  return new SyncError(`GitHub error ${res.status}${msg ? `: ${msg}` : ''}`);
}

const repoPath = c => `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;
const filePath = (c = s.cfg) => `${repoPath(c)}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`;

function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function pull() {
  const c = s.cfg;
  const q = c.branch ? `?ref=${encodeURIComponent(c.branch)}` : '';
  const res = await api('GET', filePath() + q, { headers: s.remote && s.etag ? { 'If-None-Match': s.etag } : {} });
  if (res.status === 304) return s.remote;
  if (res.status === 404) { s.sha = null; s.etag = null; return null; }
  if (!res.ok) throw await httpError(res);
  const j = await res.json();
  let content = j.content;
  if (!content && j.size > 0) { // files over 1 MB come back without content: read the blob instead
    const b = await api('GET', `${repoPath(c)}/git/blobs/${j.sha}`);
    if (!b.ok) throw await httpError(b);
    content = (await b.json()).content;
  }
  s.sha = j.sha;
  s.etag = res.headers.get('ETag');
  const text = content ? fromB64(content) : '';
  try { return text.trim() ? parse(text) : {}; } catch { throw new SyncError('The sync file on GitHub is damaged. Restore it from the repository’s history.'); }
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  return 'browser';
}

/** Upload the merged records. Returns false when another device wrote first (try again). */
async function push(map) {
  const c = s.cfg;
  const body = { message: `Update from ${deviceName()}`, content: toB64(serialize(map, { savedAt: new Date().toISOString() })) };
  if (s.sha) body.sha = s.sha;
  if (c.branch) body.branch = c.branch;
  const res = await api('PUT', filePath(), { body });
  if (res.status === 409 || res.status === 422) return false;
  if (!res.ok) throw await httpError(res);
  const j = await res.json();
  s.sha = j.content?.sha || null;
  s.etag = null;
  return true;
}

// ---------- Sync cycle ----------

async function run() {
  if (!s.cfg) return;
  if (s.busy) { s.again = true; return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  s.busy = true;
  setStatus('syncing');
  try {
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      const remote = await pull();
      // Stamp, merge and apply in one synchronous step, so nothing you do meanwhile is lost.
      const local = localMap(stamp());
      const merged = mergeMaps(local, remote || {});
      if (!sameMaps(merged, local)) apply(merged);
      adopt(merged);
      if (remote && sameMaps(merged, remote)) { s.remote = remote; done = true; break; }
      if (await push(merged)) { s.remote = merged; done = true; } else { s.etag = null; }
    }
    if (!done) throw new SyncError('Another device is saving at the same time. Retrying shortly.');
    s.joining = false;
    s.lastSync = Date.now();
    localStorage.setItem(LAST_KEY, String(s.lastSync));
    setStatus('idle');
  } catch (e) {
    console.warn('[cloud]', e);
    setStatus(e.offline ? 'offline' : 'error', e.message || String(e));
  } finally {
    s.busy = false;
    if (s.again) { s.again = false; run(); }
  }
}

function schedule(ms = 1500) {
  if (!s.cfg) return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; run(); }, ms);
}

function start() {
  if (started) return;
  started = true;
  onStoreChange(() => { if (!s.applying) schedule(); });
  setInterval(() => { if (document.visibilityState === 'visible') run(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
    else if (timer) { clearTimeout(timer); timer = null; run(); } // upload before iOS freezes the app
  });
  window.addEventListener('online', () => run());
  window.addEventListener('offline', () => s.cfg && setStatus('offline'));
}

/** Accepts "user", "user/repo" or a GitHub URL. */
export function parseRepo(owner, repo) {
  let o = String(owner || '').trim();
  let r = String(repo || '').trim();
  const m = o.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (m) { o = m[1]; r = r || m[2]; } else if (o.includes('/') && !r) [o, r] = o.split('/');
  return { owner: o.replace(/^@/, ''), repo: r.replace(/\.git$/, '') };
}

export const cloud = {
  get configured() { return !!s.cfg; },
  get cfg() { return s.cfg; },
  get status() { return s.status; },
  get error() { return s.error; },
  get lastSync() { return s.lastSync; },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  /** Checks access, saves the settings and merges this device's data with what's on GitHub. */
  async connect(raw) {
    const { owner, repo } = parseRepo(raw.owner, raw.repo);
    const cfg = {
      owner, repo,
      token: String(raw.token || '').trim(),
      branch: String(raw.branch || '').trim(),
      path: String(raw.path || '').trim().replace(/^\/+/, '') || DEFAULT_PATH,
    };
    if (!cfg.owner || !cfg.repo) throw new SyncError('Enter your GitHub username and the repository name.');
    if (!cfg.token) throw new SyncError('Paste the access token.');
    const res = await api('GET', repoPath(cfg), { cfg });
    if (!res.ok) throw await httpError(res, ` “${cfg.owner}/${cfg.repo}”`);
    const info = await res.json();
    if (!info.private) throw new SyncError('That repository is public, so anyone could read your data. Use a private repository.');
    s.cfg = cfg;
    s.remote = null; s.sha = null; s.etag = null;
    s.ledger = {}; // first sync: both sides are combined (see `joining`)
    s.joining = true;
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    saveLedger();
    start();
    await run();
    if (s.status === 'error' || s.status === 'offline') {
      const msg = s.error || 'Couldn’t reach GitHub.';
      this.disconnect();
      throw new SyncError(msg);
    }
  },

  disconnect() {
    s.cfg = null; s.remote = null; s.sha = null; s.etag = null; s.ledger = {};
    clearTimeout(timer);
    localStorage.removeItem(CFG_KEY);
    localStorage.removeItem(LEDGER_KEY);
    localStorage.removeItem(LAST_KEY);
    s.lastSync = 0;
    setStatus('off');
  },

  now() { return run(); },

  init() {
    if (!s.cfg) return;
    setStatus('idle');
    start();
    run();
  },

  /** Code another of your devices can paste to join (it includes the token, so share it privately). */
  shareCode() {
    const c = s.cfg;
    if (!c) return '';
    const payload = { v: 1, o: c.owner, r: c.repo, t: c.token, b: c.branch || undefined, p: c.path !== DEFAULT_PATH ? c.path : undefined };
    return 'tvt-' + toB64(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  decodeCode(code) {
    let str = String(code || '').trim().replace(/^tvt-/, '').replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    try {
      const p = JSON.parse(fromB64(str));
      if (!p.o || !p.r || !p.t) throw new Error();
      return { owner: p.o, repo: p.r, token: p.t, branch: p.b || '', path: p.p || DEFAULT_PATH };
    } catch {
      throw new SyncError('That code isn’t valid. Copy it again from Profile → Sync on your other device.');
    }
  },
};
