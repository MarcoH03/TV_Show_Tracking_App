import { html, useState } from '../vendor/preact-htm.js';
import { Icon } from '../ui.js';

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isMac = () => /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;

/** Nudges you to add the app to your Home Screen / Dock when it's open in a browser tab. */
export function InstallBanner() {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('tvtrack.installHidden') === '1'; } catch { return false; } });
  if (hidden || isStandalone()) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem('tvtrack.installHidden', '1'); } catch {} };
  return html`<div class="install-banner">
    <img src="icons/icon-192.png" alt="" />
    <div>
      <strong>Install TV Tracker</strong>
      <p>${isMac()
        ? html`In Safari choose <b>File → Add to Dock</b> to use it like a Mac app.`
        : html`Tap <span class="share-glyph"><${Icon} name="share" size=${15} /></span> then <b>Add to Home Screen</b> to open it full screen, without Safari.`}</p>
    </div>
    <button class="nav-icon" onClick=${dismiss} aria-label="Dismiss"><${Icon} name="close" size=${18} /></button>
  </div>`;
}
