import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { state, STATUSES } from '../store.js';
import { searchShows, getSchedule, lookupShow } from '../api/tvmaze.js';
import { getShowChart } from '../api/trakt.js';
import { useAsync } from '../hooks.js';
import { Page, Poster, Icon, Spinner, Empty } from '../ui.js';
import { PosterCard, quickAdd, StatusBadge } from './common.js';

let lastQuery = '';
let lastResults = null;

export function DiscoverView({ q }) {
  const [query, setQuery] = useState(q || lastQuery);
  const [results, setResults] = useState(lastResults);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef();

  useEffect(() => {
    lastQuery = query;
    const term = query.trim();
    if (!term) { setResults(null); lastResults = null; return; }
    if (lastResults && lastResults.term === term) return;
    setLoading(true);
    const t = setTimeout(() => {
      searchShows(term)
        .then(r => { const res = { term, items: r }; lastResults = res; setResults(res); setError(null); })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return html`
    <${Page} title="Discover">
      <form class="searchbar" role="search" onSubmit=${e => { e.preventDefault(); inputRef.current.blur(); }}>
        <${Icon} name="search" size=${17} stroke=${2.2} />
        <input ref=${inputRef} type="search" value=${query} onInput=${e => setQuery(e.target.value)}
          placeholder="Shows, e.g. Severance" autocomplete="off" autocorrect="off" enterkeyhint="search" aria-label="Search shows" />
        ${query && html`<button type="button" class="clear" onClick=${() => { setQuery(''); inputRef.current.focus(); }} aria-label="Clear">✕</button>`}
      </form>
      ${query.trim()
        ? html`<${Results} results=${results} loading=${loading} error=${error} />`
        : html`<${Browse} />`}
    </${Page}>`;
}

function Results({ results, loading, error }) {
  if (error) return html`<${Empty} emoji="📡" title="Search failed" text="Check your connection and try again." />`;
  if (!results || (loading && results.items.length === 0)) return html`<div class="center-pad"><${Spinner} /></div>`;
  if (!results.items.length) return html`<${Empty} emoji="🔍" title="No shows found" text=${`Nothing matched “${results.term}”. Try the original title.`} />`;
  return html`<div class="group results">
    ${results.items.map(show => {
      const entry = state.shows[show.id];
      const year = show.premiered?.slice(0, 4);
      return html`<a class="row show-row" key=${show.id} href=${`#/show/${show.id}`}>
        <${Poster} src=${show.image?.medium} title=${show.name} size="sm" />
        <span class="row-main">
          <span class="row-title">${show.name}</span>
          <span class="row-sub">${[year, show.network, show.status === 'Ended' ? 'Ended' : null].filter(Boolean).join(' · ')}</span>
          <span class="row-sub tiny">${show.genres.slice(0, 3).join(', ')}</span>
          ${entry?.status && html`<${StatusBadge} status=${entry.status} />`}
        </span>
        <button class=${'add-btn' + (entry?.status ? ' on' : '')} style=${entry?.status ? `--c:${STATUSES[entry.status].color}` : ''}
          onClick=${e => { e.preventDefault(); e.stopPropagation(); quickAdd(show); }} aria-label="Add">
          <${Icon} name=${entry?.status ? 'check' : 'plus'} size=${18} stroke=${2.6} />
        </button>
      </a>`;
    })}
  </div>
  <p class="footnote center">Search powered by TVmaze</p>`;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function Browse() {
  const country = state.settings.country || 'US';
  const sched = useAsync(() => getSchedule(today(), country), [country]);
  const clientId = state.settings.traktClientId;
  const recent = state.history.slice(0, 40).map(h => h.showId).filter((id, i, a) => a.indexOf(id) === i && state.shows[id]).slice(0, 10);
  return html`
    ${recent.length > 0 && html`<${Shelf} title="Jump back in" items=${recent.map(id => ({ show: { id, name: state.shows[id].name, image: state.shows[id].image } }))} />`}
    ${clientId && html`<${TraktShelf} kind="trending" title="Trending on Trakt" clientId=${clientId} />`}
    ${clientId && html`<${TraktShelf} kind="anticipated" title="Most Anticipated" clientId=${clientId} />`}
    ${sched.loading && html`<div class="center-pad"><${Spinner} /></div>`}
    ${sched.data && html`<${Shelf} title="Airing Today" items=${sched.data.slice(0, 24)} />`}
    ${sched.error && html`<${Empty} emoji="📡" title="You’re offline" text="Browse needs a connection. Your shows are still here." />`}`;
}

function Shelf({ title, items }) {
  if (!items?.length) return null;
  return html`<section>
    <div class="section-head"><h2>${title}</h2></div>
    <div class="h-scroll shelf">
      ${items.map(({ show, episode }) => html`<${PosterCard} key=${show.id} show=${show}
        sub=${episode ? `S${episode.season}·E${episode.number}${show.network ? ' · ' + show.network : ''}` : null} onLong=${() => quickAdd(show)} />`)}
    </div>
  </section>`;
}

function TraktShelf({ kind, title, clientId }) {
  const res = useAsync(async () => {
    const chart = await getShowChart(kind, clientId);
    const mapped = await Promise.all(chart.slice(0, 15).map(s => lookupShow({ imdb: s.ids?.imdb, thetvdb: s.ids?.tvdb }).catch(() => null)));
    return mapped.filter(Boolean).map(show => ({ show }));
  }, [kind, clientId]);
  if (res.loading) return html`<section><div class="section-head"><h2>${title}</h2></div><div class="center-pad"><${Spinner} /></div></section>`;
  return html`<${Shelf} title=${title} items=${res.data} />`;
}
