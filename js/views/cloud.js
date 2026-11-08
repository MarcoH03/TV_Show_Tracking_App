// Profile → Sync between devices: connect a private GitHub repository, invite your other devices.
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { cloud, DEFAULT_REPO, DEFAULT_PATH, parseRepo } from '../cloud.js';
import { Page, Icon, Segmented, Spinner, toast, confirmSheet } from '../ui.js';
import { refreshAll } from '../sync.js';
import { goBack } from '../nav.js';

export function useCloud() {
  const [, set] = useState(0);
  useEffect(() => cloud.subscribe(() => set(n => n + 1)), []);
  return cloud;
}

export function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** One-line status for the Profile row and this page. */
export function cloudStatusText() {
  if (!cloud.configured) return 'Off — your data stays on this device';
  switch (cloud.status) {
    case 'syncing': return 'Syncing…';
    case 'offline': return 'Offline — will sync when you’re back online';
    case 'error': return cloud.error || 'Sync problem';
    default: return cloud.lastSync ? `Synced ${ago(cloud.lastSync)}` : 'Connected';
  }
}

export function cloudColor() {
  if (!cloud.configured || cloud.status === 'offline') return 'var(--label3)';
  return cloud.status === 'error' ? 'var(--orange)' : 'var(--green)';
}

export function CloudView() {
  useCloud();
  return html`<${Page} title="Sync" subtitle="Same shows on every device" back=${{ label: 'Profile', onClick: () => goBack('#/profile') }}>
    ${cloud.configured ? html`<${Connected} />` : html`<${Setup} />`}
  </${Page}>`;
}

function Connected() {
  const c = cloud.cfg;
  const [showCode, setShowCode] = useState(false);
  const code = cloud.shareCode();
  const busy = cloud.status === 'syncing';
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); toast('Code copied — paste it on your other device'); } catch { setShowCode(true); }
  };
  const share = () => navigator.share({ title: 'TV Tracker sync code', text: code }).catch(() => {});
  const disconnect = async () => {
    if (await confirmSheet({ title: 'Disconnect this device?', message: 'Your shows stay on this device but stop syncing. Nothing is deleted on GitHub or your other devices.', confirm: 'Disconnect' })) {
      cloud.disconnect();
      toast('This device no longer syncs');
    }
  };
  return html`
    <div class="group">
      <div class="row static">
        <span class="sync-dot" style=${`--c:${cloudColor()}`}>${busy ? html`<${Spinner} />` : html`<${Icon} name=${cloud.status === 'error' ? 'close' : 'check'} size=${16} stroke=${3} />`}</span>
        <span class="row-main">
          <span class="row-title">${cloudStatusText()}</span>
          <span class="row-sub tiny">${c.owner}/${c.repo} · ${c.path}${c.branch ? ` · ${c.branch}` : ''}</span>
        </span>
        <button class="btn tinted small" disabled=${busy} onClick=${() => cloud.now()}>Sync Now</button>
      </div>
    </div>
    <p class="footnote">Changes sync a moment after you make them and whenever you open the app. Every save is a commit in your${' '}
      <a href=${`https://github.com/${c.owner}/${c.repo}/commits`} target="_blank" rel="noopener">private repository</a>, so any earlier version can be restored.</p>

    <div class="section-head"><h2>Add Another Device</h2></div>
    <div class="group">
      <div class="row static column">
        <span class="row-sub">On your iPad, Mac or other iPhone: open TV Tracker → <b>Profile → Sync</b> → <b>Join with Code</b>, and paste this code.
          It contains your access token, so only send it to yourself (AirDrop, Notes, Messages to yourself).</span>
        ${showCode && html`<code class="sync-code" onClick=${e => window.getSelection().selectAllChildren(e.currentTarget)}>${code}</code>`}
        <div class="inline-form">
          <button class="btn primary small" onClick=${copy}>Copy Code</button>
          ${navigator.share && html`<button class="btn tinted small" onClick=${share}>Share…</button>`}
          <button class="btn secondary small" onClick=${() => setShowCode(!showCode)}>${showCode ? 'Hide' : 'Show'}</button>
        </div>
      </div>
    </div>

    <div class="group sync-danger">
      <button class="row" onClick=${disconnect}><span class="row-main"><span class="row-title danger">Disconnect This Device</span></span></button>
    </div>`;
}

function Setup() {
  const [mode, setMode] = useState('setup');
  return html`
    <div class="card sync-intro">
      <div class="sync-intro-emoji">☁️</div>
      <p>Keep your iPhone, iPad and Mac in sync. Your data is saved as a file in a <b>private GitHub repository</b> that only you can see —
        no account with us, no server. If two devices change things at once, both changes are kept.</p>
    </div>
    <div class="sync-mode"><${Segmented} options=${[{ value: 'setup', label: 'Set Up (first device)' }, { value: 'join', label: 'Join with Code' }]} value=${mode} onChange=${setMode} /></div>
    ${mode === 'setup' ? html`<${SetupForm} />` : html`<${JoinForm} />`}`;
}

function SetupForm() {
  const [f, setF] = useState({ owner: '', repo: DEFAULT_REPO, token: '', branch: '', path: DEFAULT_PATH });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const { owner, repo } = parseRepo(f.owner, f.repo);

  const newRepo = `https://github.com/new?name=${encodeURIComponent(repo || DEFAULT_REPO)}&visibility=private&description=${encodeURIComponent('TV Tracker sync data')}`;
  const newToken = 'https://github.com/settings/personal-access-tokens/new?' + new URLSearchParams({
    name: 'TV Tracker sync',
    description: `Lets TV Tracker read and write ${repo || DEFAULT_REPO} to sync your shows between devices.`,
    ...(owner ? { target_name: owner } : {}),
    contents: 'write',
  });

  const connect = async e => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await cloud.connect(f);
      toast('Connected — your shows now sync ☁️');
      refreshAll().catch(() => {});
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return html`<form onSubmit=${connect}>
    <ol class="sync-steps">
      <li><b>Create a private repository</b> on GitHub to hold your data.
        <a class="btn tinted small" href=${newRepo} target="_blank" rel="noopener">Create Repository ↗︎</a>
        <span class="row-sub">Already have a private one (like your house app’s)? You can use it — the shows go in their own file.</span></li>
      <li><b>Create an access token</b> for it. The link fills in the name and the “Contents: Read and write” permission; under${' '}
        <i>Repository access</i> choose <b>Only select repositories</b> and pick that repository.
        <a class="btn tinted small" href=${newToken} target="_blank" rel="noopener">Create Token ↗︎</a></li>
      <li><b>Connect this device</b>:</li>
    </ol>
    <div class="group">
      <label class="row field"><span>Username</span><input value=${f.owner} onInput=${set('owner')} placeholder="your-github-username" autocapitalize="off" autocomplete="off" spellcheck=${false} required /></label>
      <label class="row field"><span>Repository</span><input value=${f.repo} onInput=${set('repo')} placeholder=${DEFAULT_REPO} autocapitalize="off" autocomplete="off" spellcheck=${false} required /></label>
      <label class="row field"><span>Token</span><input type="password" value=${f.token} onInput=${set('token')} placeholder="github_pat_…" autocapitalize="off" autocomplete="off" spellcheck=${false} required /></label>
    </div>
    <details class="sync-advanced">
      <summary>Advanced</summary>
      <div class="group">
        <label class="row field"><span>File</span><input value=${f.path} onInput=${set('path')} placeholder=${DEFAULT_PATH} autocapitalize="off" spellcheck=${false} /></label>
        <label class="row field"><span>Branch</span><input value=${f.branch} onInput=${set('branch')} placeholder="default branch" autocapitalize="off" spellcheck=${false} /></label>
      </div>
    </details>
    ${error && html`<p class="sync-error">${error}</p>`}
    <div class="button-stack">
      <button class="btn primary" type="submit" disabled=${busy}>${busy ? html`<${Spinner} />` : 'Connect'}</button>
    </div>
    <p class="footnote center">The token is stored only on this device and sent only to GitHub. If this device already has shows, they’re combined with what’s in the repository.</p>
  </form>`;
}

function JoinForm() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const join = async e => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await cloud.connect(cloud.decodeCode(code));
      toast('Joined — your shows are here ☁️');
      refreshAll().catch(() => {});
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  return html`<form onSubmit=${join}>
    <p class="footnote">On a device that already syncs, open <b>Profile → Sync</b> and copy its code. Paste it here:</p>
    <div class="group">
      <textarea class="sync-code-input" value=${code} onInput=${e => setCode(e.target.value)} placeholder="tvt-…" rows="4"
        autocapitalize="off" autocomplete="off" spellcheck=${false} aria-label="Sync code" required></textarea>
    </div>
    ${error && html`<p class="sync-error">${error}</p>`}
    <div class="button-stack">
      <button class="btn primary" type="submit" disabled=${busy || !code.trim()}>${busy ? html`<${Spinner} />` : 'Join'}</button>
    </div>
    <p class="footnote center">Shows already on this device are kept and combined with the synced ones.</p>
  </form>`;
}
