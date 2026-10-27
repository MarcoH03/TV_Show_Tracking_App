// Keeps followed shows fresh and turns changes into "news" + notifications:
//  • a new season is announced (with its premiere date once known)
//  • a premiere date is set or changes
//  • an episode is about to air / just aired
import { state, update, ensureShow, reconcile, hasAired, order } from './store.js';
import { getShowFull } from './api/tvmaze.js';
import { fmtDate, epCode, relDay } from './ui.js';

const HOUR = 3600e3;
let running = null;

/** Shows you track that haven't had notifications switched off. */
export const followed = () => Object.values(state.shows).filter(s => s.status && s.notify !== false);

function fmtTime(stamp) {
  const d = new Date(stamp);
  return d.getHours() === 0 && d.getMinutes() === 0 ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Refresh every tracked show. Running/announced shows refresh every 6h, ended ones weekly. */
export function refreshAll({ force = false, onProgress } = {}) {
  if (running) return running;
  running = (async () => {
    const entries = Object.values(state.shows);
    const lastRefresh = state.settings.lastRefresh || 0;
    const news = [];
    const notes = [];
    const fresh = [];
    let done = 0;
    await Promise.all(entries.map(async entry => {
      const ended = entry.showStatus === 'Ended';
      const maxAge = force ? 0 : ended ? 7 * 24 * HOUR : 6 * HOUR;
      try {
        const bundle = await getShowFull(entry.id, { maxAge });
        if (bundle) {
          fresh.push(bundle);
          if (entry.status && entry.notify !== false) detect(entry, bundle, lastRefresh, news, notes);
        }
      } catch (e) {
        console.warn('Refresh failed for', entry.name, e);
      }
      onProgress?.(++done, entries.length);
    }));

    update(s => {
      for (const b of fresh) if (s.shows[b.show.id]) { ensureShow(s, b.show, b.seasons); reconcile(s, b); }
      for (const n of news) {
        if (s.news.some(x => x.id === n.id)) continue;
        s.news.unshift(n);
      }
      if (s.news.length > 200) s.news.length = 200;
      s.settings.lastRefresh = Date.now();
    });

    const fresher = notes.filter(n => !state.notified[n.tag]);
    if (fresher.length) {
      update(s => { fresher.forEach(n => { s.notified[n.tag] = Date.now(); }); pruneNotified(s); });
      fresher.slice(0, 6).forEach(notify);
    }
    updateBadge();
    running = null;
    return { updated: fresh.length, news: news.length };
  })();
  return running;
}

function pruneNotified(s) {
  const cutoff = Date.now() - 120 * 24 * HOUR;
  for (const [k, t] of Object.entries(s.notified)) if (t < cutoff) delete s.notified[k];
}

function detect(entry, bundle, lastRefresh, news, notes) {
  const { show, seasons } = bundle;
  const url = `#/show/${show.id}`;
  const known = entry.seasonCount;
  const oldDates = entry.seasonDates || {};

  // New season(s) announced since we last looked.
  if (known != null && seasons.length > known) {
    for (const season of seasons.filter(x => x.number > Math.max(0, ...Object.keys(oldDates).map(Number)))) {
      const when = season.premiereDate ? `Premieres ${fmtDate(season.premiereDate)}` : 'Premiere date to be announced';
      const n = { id: `season:${show.id}:${season.number}`, showId: show.id, kind: 'season', title: `${show.name}: Season ${season.number} announced!`, body: when, at: Date.now(), date: season.premiereDate, read: false };
      news.push(n);
      notes.push({ tag: n.id, title: n.title, body: when, url });
    }
  }
  // Premiere date set or moved for a season we already knew about.
  for (const season of seasons) {
    const before = oldDates[season.number];
    if (known != null && season.number in oldDates && season.premiereDate && before !== season.premiereDate && daysFromNow(season.premiereDate) >= 0) {
      const title = before ? `${show.name}: Season ${season.number} date changed` : `${show.name}: Season ${season.number} premiere date`;
      const body = `Premieres ${fmtDate(season.premiereDate)}${before ? ` (was ${fmtDate(before)})` : ''}`;
      const id = `sdate:${show.id}:${season.number}:${season.premiereDate}`;
      news.push({ id, showId: show.id, kind: 'season', title, body, at: Date.now(), date: season.premiereDate, read: false });
      notes.push({ tag: id, title, body, url });
    }
  }

  const now = Date.now();
  for (const ep of order(bundle.episodes)) {
    if (!ep.airstamp && !ep.airdate) continue;
    const t = new Date(ep.airstamp || ep.airdate + 'T12:00:00').getTime();
    // Airing within the next 24 hours → heads-up.
    if (t > now && t - now < 24 * HOUR) {
      const time = fmtTime(ep.airstamp);
      notes.push({
        tag: `soon:${ep.id}`,
        title: `${show.name} — new episode ${relDay(t).toLowerCase()}`,
        body: `${epCode(ep)} “${ep.name}”${time ? ` at ${time}` : ''}${show.network ? ` on ${show.network}` : ''}`,
        url,
      });
    }
    // Aired since the last refresh → "out now" news.
    if (lastRefresh && t <= now && t > lastRefresh && now - t < 3 * 24 * HOUR) {
      const id = `aired:${ep.id}`;
      const premiere = ep.number === 1;
      news.push({ id, showId: show.id, kind: premiere ? 'premiere' : 'episode', title: premiere ? `${show.name}: Season ${ep.season} is here!` : `New ${show.name} episode`, body: `${epCode(ep)} “${ep.name}” is out now`, at: t, read: false });
      notes.push({ tag: id, title: `${show.name} — out now`, body: `${epCode(ep)} “${ep.name}”`, url });
    }
  }
}

function daysFromNow(date) {
  return (new Date(date + 'T23:59:59') - Date.now()) / (24 * HOUR);
}

// ---------- Notifications ----------

export const notificationsSupported = () => 'Notification' in window && 'serviceWorker' in navigator;

export async function enableNotifications() {
  if (!notificationsSupported()) return 'unsupported';
  const result = await Notification.requestPermission();
  update(s => { s.settings.notifications = result === 'granted'; });
  if (result === 'granted') notify({ tag: 'welcome', title: 'Notifications are on 🔔', body: 'You’ll hear about new episodes and season announcements for the shows you follow.', url: '#/upcoming' });
  return result;
}

export async function notify({ tag, title, body, url }) {
  if (!state.settings.notifications || !notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url } });
  } catch (e) {
    console.warn('Notification failed', e);
  }
}

export function updateBadge() {
  const unread = state.news.filter(n => !n.read).length;
  try {
    if (unread && navigator.setAppBadge) navigator.setAppBadge(unread);
    else if (navigator.clearAppBadge) navigator.clearAppBadge();
  } catch { /* not supported */ }
  return unread;
}

export function markNewsRead() {
  if (!state.news.some(n => !n.read)) return;
  update(s => { s.news.forEach(n => { n.read = true; }); });
  updateBadge();
}

// ---------- Calendar export (.ics) — lets iOS Calendar remind you even when the app is closed ----------

const icsEscape = t => String(t || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
const icsStamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDate = d => d.replace(/-/g, '');

export function buildCalendar(bundles) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TV Tracker//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:TV Tracker'];
  const now = Date.now();
  const stamp = icsStamp(now);
  for (const b of bundles) {
    const { show } = b;
    for (const ep of b.episodes) {
      if (hasAired(ep) || !ep.airdate) continue;
      const t = new Date(ep.airstamp || ep.airdate).getTime();
      if (t - now > 120 * 24 * HOUR) continue;
      const timed = ep.airstamp && fmtTime(ep.airstamp);
      lines.push('BEGIN:VEVENT', `UID:tvtracker-ep-${ep.id}@tvtracker`, `DTSTAMP:${stamp}`,
        timed ? `DTSTART:${icsStamp(ep.airstamp)}` : `DTSTART;VALUE=DATE:${icsDate(ep.airdate)}`,
        timed ? `DTEND:${icsStamp(t + (ep.runtime || show.runtime || 30) * 60e3)}` : `DTEND;VALUE=DATE:${icsDate(nextDay(ep.airdate))}`,
        `SUMMARY:${icsEscape(`📺 ${show.name} ${epCode(ep)}`)}`,
        `DESCRIPTION:${icsEscape(`“${ep.name}”${show.network ? ' on ' + show.network : ''}`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(show.name + ' — new episode')}`, timed ? 'TRIGGER:PT0M' : 'TRIGGER:PT10H', 'END:VALARM',
        'END:VEVENT');
    }
    for (const s of b.seasons) {
      if (!s.premiereDate || daysFromNow(s.premiereDate) < 0) continue;
      if (b.episodes.some(e => e.season === s.number && e.number === 1 && e.airdate)) continue; // already covered by the episode
      lines.push('BEGIN:VEVENT', `UID:tvtracker-season-${show.id}-${s.number}@tvtracker`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(s.premiereDate)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(s.premiereDate))}`,
        `SUMMARY:${icsEscape(`🎬 ${show.name} — Season ${s.number} premiere`)}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(show.name + ' is back')}`, 'TRIGGER:PT10H', 'END:VALARM',
        'END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function nextDay(date) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
