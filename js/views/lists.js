import { html, useState } from '../vendor/preact-htm.js';
import { state, STATUSES, createList, renameList, deleteList, toggleInList, moveInList } from '../store.js';
import { searchShows } from '../api/tvmaze.js';
import { Page, Poster, Empty, Icon, openSheet, actionSheet, confirmSheet, toast, nav } from '../ui.js';
import { PosterCard, EMOJIS, StatusBadge } from './common.js';
import { goBack } from '../nav.js';

export function ListsView() {
  const newList = () => openListEditor();
  return html`
    <${Page} title="Lists" actions=${html`<button class="nav-icon" onClick=${newList} aria-label="New list"><${Icon} name="plus" size=${24} stroke=${2.2} /></button>`}>
      ${state.lists.length === 0
        ? html`<${Empty} emoji="🗂️" title="Make your first list" text="Group shows any way you like — “Comfort shows”, “Watch with Sam”, “Halloween marathon”. Mix your watchlist and the shows you follow.">
            <button class="btn primary" onClick=${newList}>New List</button></${Empty}>`
        : html`<div class="list-grid">
            ${state.lists.map(l => html`<a class="list-card" key=${l.id} href=${`#/list/${l.id}`}>
              <div class="collage">
                ${[0, 1, 2].map(i => {
                  const s = state.shows[l.showIds[i]];
                  return s ? html`<${Poster} src=${s.image} title=${s.name} size="xs" />` : html`<div class="poster xs ghost"></div>`;
                })}
              </div>
              <div class="list-name"><span>${l.emoji}</span> ${l.name}</div>
              <div class="list-count">${l.showIds.length} show${l.showIds.length === 1 ? '' : 's'}</div>
            </a>`)}
            <button class="list-card new" onClick=${newList}><${Icon} name="plus" size=${28} /><span>New List</span></button>
          </div>`}
    </${Page}>`;
}

function openListEditor(list) {
  openSheet(({ close }) => html`<${ListEditor} list=${list} close=${close} />`);
}

function ListEditor({ list, close }) {
  const [name, setName] = useState(list?.name || '');
  const [emoji, setEmoji] = useState(list?.emoji || EMOJIS[state.lists.length % EMOJIS.length]);
  const save = e => {
    e?.preventDefault();
    if (!name.trim()) return;
    if (list) renameList(list.id, name.trim(), emoji);
    else { const id = createList(name.trim(), emoji); nav(`#/list/${id}`); }
    close();
  };
  return html`
    <div class="sheet-header"><button class="link" onClick=${close}>Cancel</button><h2>${list ? 'Edit List' : 'New List'}</h2>
      <button class="link bold" disabled=${!name.trim()} onClick=${save}>${list ? 'Save' : 'Create'}</button></div>
    <form class="sheet-body" onSubmit=${save}>
      <div class="emoji-preview">${emoji}</div>
      <div class="group"><input class="row input" value=${name} onInput=${e => setName(e.target.value)} placeholder="List name" autofocus enterkeyhint="done" aria-label="List name" /></div>
      <div class="emoji-grid">${EMOJIS.map(em => html`<button type="button" class=${em === emoji ? 'on' : ''} onClick=${() => setEmoji(em)}>${em}</button>`)}</div>
    </form>`;
}

export function ListDetailView({ id }) {
  const list = state.lists.find(l => l.id === id);
  const [editing, setEditing] = useState(false);
  if (!list) {
    return html`<${Page} title="List" large=${false} back=${{ label: 'Lists', onClick: () => goBack('#/lists') }}>
      <${Empty} emoji="🤷" title="List not found" /></${Page}>`;
  }
  const shows = list.showIds.map(sid => state.shows[sid]).filter(Boolean);
  const more = () => actionSheet({
    title: list.name,
    actions: [
      { label: 'Add Shows…', icon: '＋', onClick: () => openPicker(list) },
      { label: 'Rename…', icon: '✎', onClick: () => openListEditor(list) },
      { label: editing ? 'Done Reordering' : 'Reorder / Remove', icon: '↕︎', onClick: () => setEditing(!editing) },
      {
        label: 'Delete List', destructive: true, onClick: async () => {
          if (await confirmSheet({ title: `Delete “${list.name}”?`, message: 'The shows stay in your library.', confirm: 'Delete List' })) {
            deleteList(list.id); toast('List deleted'); goBack('#/lists');
          }
        },
      },
    ],
  });
  return html`
    <${Page} title=${html`${list.emoji} ${list.name}`} subtitle=${`${shows.length} show${shows.length === 1 ? '' : 's'}`}
      back=${{ label: 'Lists', onClick: () => goBack('#/lists') }}
      actions=${html`${editing ? html`<button class="link bold" onClick=${() => setEditing(false)}>Done</button>` : html`
        <button class="nav-icon" onClick=${() => openPicker(list)} aria-label="Add shows"><${Icon} name="plus" size=${24} stroke=${2.2} /></button>
        <button class="nav-icon" onClick=${more} aria-label="More"><${Icon} name="more" size=${24} stroke=${3} /></button>`}`}>
      ${shows.length === 0 && html`<${Empty} emoji=${list.emoji} title="This list is empty" text="Add shows from your library or search for new ones.">
        <button class="btn primary" onClick=${() => openPicker(list)}>Add Shows</button></${Empty}>`}
      ${shows.length > 0 && (editing
        ? html`<div class="group">${shows.map((s, i) => html`<div class="row show-row" key=${s.id}>
            <${Poster} src=${s.image} title=${s.name} size="xs" />
            <span class="row-main"><span class="row-title">${s.name}</span></span>
            <button class="nav-icon" disabled=${i === 0} onClick=${() => moveInList(list.id, s.id, -1)} aria-label="Move up"><${Icon} name="up" size=${20} /></button>
            <button class="nav-icon" disabled=${i === shows.length - 1} onClick=${() => moveInList(list.id, s.id, 1)} aria-label="Move down"><${Icon} name="down" size=${20} /></button>
            <button class="nav-icon danger" onClick=${() => toggleInList(list.id, s)} aria-label="Remove"><${Icon} name="trash" size=${20} /></button>
          </div>`)}</div>`
        : html`<div class="poster-grid">${shows.map(s => html`<${PosterCard} key=${s.id} show=${{ id: s.id, name: s.name, image: s.image }}
            sub=${s.status ? STATUSES[s.status].label : 'Not tracked'} />`)}</div>`)}
    </${Page}>`;
}

/** Picker: your tracked shows (watchlist + following) with checkmarks, plus search for anything else. */
function openPicker(list) {
  openSheet(({ close }) => html`<${Picker} listId=${list.id} close=${close} />`, { full: true });
}

function Picker({ listId, close }) {
  const list = state.lists.find(l => l.id === listId);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState(null);
  const library = Object.values(state.shows).filter(s => s.status)
    .sort((a, b) => (a.status === 'watchlist') - (b.status === 'watchlist') || a.name.localeCompare(b.name));
  const filtered = q ? library.filter(s => s.name.toLowerCase().includes(q.toLowerCase())) : library;
  const search = async e => {
    e.preventDefault();
    if (!q.trim()) return;
    setRemote('loading');
    setRemote(await searchShows(q.trim()).catch(() => []));
  };
  if (!list) return null;
  const Row = ({ show, sub }) => {
    const on = list.showIds.includes(show.id);
    return html`<button class="row show-row" onClick=${() => toggleInList(list.id, show)}>
      <${Poster} src=${show.image?.medium || show.image} title=${show.name} size="xs" />
      <span class="row-main"><span class="row-title">${show.name}</span><span class="row-sub">${sub}</span></span>
      <span class=${'check' + (on ? ' on' : '')}><${Icon} name="check" size=${16} stroke=${3} /></span>
    </button>`;
  };
  return html`
    <div class="sheet-header"><span></span><h2>Add to ${list.emoji} ${list.name}</h2><button class="link bold" onClick=${close}>Done</button></div>
    <div class="sheet-body">
      <form class="searchbar" onSubmit=${search}>
        <${Icon} name="search" size=${17} stroke=${2.2} />
        <input type="search" value=${q} onInput=${e => { setQ(e.target.value); setRemote(null); }} placeholder="Filter or search all shows" enterkeyhint="search" aria-label="Search" />
      </form>
      ${filtered.length > 0 && html`<div class="section-head"><h2>Your Shows</h2></div>
        <div class="group">${filtered.map(s => html`<${Row} key=${s.id} show=${s} sub=${html`<${StatusBadge} status=${s.status} />`} />`)}</div>`}
      ${q && remote === null && html`<button class="btn tinted wide" onClick=${search}>Search TVmaze for “${q}”</button>`}
      ${remote === 'loading' && html`<p class="footnote center">Searching…</p>`}
      ${Array.isArray(remote) && html`<div class="section-head"><h2>All Shows</h2></div>
        <div class="group">${remote.map(s => html`<${Row} key=${s.id} show=${s} sub=${[s.premiered?.slice(0, 4), s.network].filter(Boolean).join(' · ')} />`)}</div>`}
      ${!library.length && !q && html`<p class="footnote center">Type a name to search for shows.</p>`}
    </div>`;
}
