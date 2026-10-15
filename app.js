import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createNoteEditor, insertImageAtCursor } from './editor.js';
import { cloudSyncConfigured, createNoteSyncSession, loadWorkspaceSnapshot, notifyWorkspaceChanged, saveWorkspaceSnapshot, subscribeWorkspace, supabase } from './sync.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const STORAGE_KEY = 'margin-scaffold-v1';
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('margin-live-demo') : null;
const initialState = {
  activeNotebook: 'biology',
  activeTab: 'cell-structure',
  currentView: 'notes',
  notes: {
    'cell-structure': {
      id: 'cell-structure', title: 'Cell structure', updatedAt: Date.now(), favorite: false,
      handwritingIndex: 'phospholipid bilayer membrane selectively permeable cell diagrams', pdfPages: [3, 8], ink: [],
      body: `<p>Cells are the smallest units of life — tiny, busy systems that keep every organism running. The same core parts show up again and again, each with a role to play.</p><h2>The cell membrane</h2><p>Think of the membrane as a flexible border and a careful gatekeeper. It’s made mostly of a <strong>phospholipid bilayer</strong>, with proteins tucked throughout.</p><ul><li>Controls what enters and leaves the cell</li><li>Helps the cell communicate with its surroundings</li><li>Keeps the internal environment stable</li></ul><details><summary>Why does the membrane form a bilayer?</summary><p>Phospholipids have water-loving heads and water-avoiding tails. They arrange into two layers with the tails tucked inside, away from water.</p></details><p><button class="page-ref" data-page="3">↗ Page 3 in PDF</button> <span style="color:#a0a69f">— membrane diagram</span></p><blockquote>Remember: structure follows function. The membrane is selective, not a solid wall.</blockquote>`
    },
    'cell-organelles': {
      id: 'cell-organelles', title: 'Organelles & energy', updatedAt: Date.now() - 3600000, favorite: false,
      handwritingIndex: 'mitochondria handwritten sketch ATP cellular respiration energy', pdfPages: [8], ink: [],
      body: `<p>Organelles make specialized work possible inside the cell. The nucleus stores DNA; the endoplasmic reticulum and Golgi apparatus help build and ship proteins.</p><h2>Mitochondria</h2><p>Mitochondria convert energy from food into <strong>ATP</strong>, a form the cell can use. Their folded inner membrane creates more room for the reactions of cellular respiration.</p><details><summary>Quick recall</summary><p>Where does most ATP production happen? Across the inner mitochondrial membrane.</p></details><p><button class="page-ref" data-page="8">↗ Page 8 in PDF</button> <span style="color:#a0a69f">— mitochondria sketch</span></p>`
    },
    'exam-prep': {
      id: 'exam-prep', title: 'Exam prep · cell basics', updatedAt: Date.now() - 7200000, favorite: false,
      handwritingIndex: 'handwritten exam review membrane nucleus ribosomes organelles', pdfPages: [3], ink: [],
      body: `<p>A short review to come back to before the quiz.</p><h2>Big ideas</h2><ul><li>The membrane regulates exchange with the environment.</li><li>The nucleus stores genetic instructions.</li><li>Ribosomes assemble proteins.</li></ul><details><summary>One-minute self test</summary><p>Explain how membrane structure helps it control what gets in and out.</p></details><p><button class="page-ref" data-page="3">↗ Page 3 in PDF</button></p>`
    },
    'research-methods': {
      id: 'research-methods', title: 'Research methods', updatedAt: Date.now() - 86400000, favorite: false,
      handwritingIndex: 'margin notes observational studies bias variables', pdfPages: [], ink: [],
      body: `<p>Keep a running record of methods, questions, and useful references.</p><h2>Study design</h2><p>Observational studies describe patterns in the world as it is. Experiments deliberately change one variable to test for an effect.</p><details><summary>Things to check</summary><p>Sample size, selection bias, and whether the study can support a causal claim.</p></details>`
    },
    'daily-log': {
      id: 'daily-log', title: 'Daily log', updatedAt: Date.now() - 43200000, favorite: false,
      handwritingIndex: 'morning thoughts quick capture', pdfPages: [], ink: [],
      body: `<p>A quiet place for quick thoughts, useful links, and things to remember.</p><h2>Today</h2><p>Paste an image anywhere in this note or add a toggle for details you want to tuck away.</p>`
    }
  },
  notebooks: [
    { id: 'biology', name: 'Biology 101', glyph: '✿', tabs: [{ id: 'cell-structure', label: 'Cell structure' }, { id: 'cell-organelles', label: 'Organelles' }, { id: 'exam-prep', label: 'Exam prep' }] },
    { id: 'research', name: 'Research journal', glyph: '◫', tabs: [{ id: 'research-methods', label: 'Research methods' }] },
    { id: 'personal', name: 'Personal', glyph: '⌂', tabs: [{ id: 'daily-log', label: 'Daily log' }] }
  ],
  study: { known: 3, review: 5 }
};

function readSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && saved.notes && saved.notebooks) return saved;
  } catch (error) { console.info('Starting a fresh local workspace.'); }
  return structuredClone(initialState);
}

let state = readSavedState();
let hasSavedLocalState = Boolean(localStorage.getItem(STORAGE_KEY));
let currentInkColor = '#253e37';
let isEraser = false;
let inkPointer = null;
let saveTimer = null;
let pdfDocument = null;
let pdfRenderTask = null;
let pdfRenderToken = 0;
let pdfScale = 1;
let pdfAnnotating = false;
let pdfInkPointer = null;
let activeCard = 0;
let studyRevealed = false;
let pdfActiveNoteId = null;
let noteEditor = null;
let noteEditorId = null;
let pdfEditor = null;
let pdfEditorId = null;
let editorMountToken = 0;
let pdfEditorMountToken = 0;
let authUser = null;
let workspaceChannel = null;
let syncSessions = new Map();
let cloudSaveTimer = null;
let snapshotSaveQueue = Promise.resolve();
const cards = [
  ['What is the function of the cell membrane?', 'It regulates what enters and leaves the cell, helping maintain a stable internal environment.'],
  ['What is the cell membrane mainly made of?', 'A phospholipid bilayer with proteins embedded throughout.'],
  ['What do mitochondria make for the cell?', 'ATP, a usable form of energy produced through cellular respiration.'],
  ['What does the nucleus store?', 'The cell’s DNA and genetic instructions.'],
  ['What is the role of ribosomes?', 'They assemble proteins from amino acids.'],
  ['What do we mean when we say a membrane is selectively permeable?', 'It allows some substances through while restricting others.'],
  ['Which part of a phospholipid is hydrophilic?', 'The phosphate head is water-loving.'],
  ['Why are inner mitochondrial membranes folded?', 'The folds increase surface area for energy-producing reactions.']
];
let currentStudyCards = cards;
let currentStudyDeck = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const noteBody = $('#noteBody');
const noteTitle = $('#noteTitle');
const inkCanvas = $('#inkCanvas');
const context = inkCanvas.getContext('2d');
const esc = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function activeNotebook() { return state.notebooks.find((book) => book.id === state.activeNotebook) || state.notebooks[0]; }
function activeNote() { return state.notes[state.activeTab] || state.notes[activeNotebook()?.tabs[0]?.id] || Object.values(state.notes)[0]; }
function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.add('hidden'), 2300);
}
function setStatus(message = 'Saving…') { $('#saveStatus').textContent = message; }
function persistState({ remote = false } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { notify('This note is too large to save locally.'); }
    hasSavedLocalState = true;
    if (channel && !remote) channel.postMessage({ type: 'workspace-update', state });
    if (authUser && supabase && !remote) {
      clearTimeout(cloudSaveTimer);
      cloudSaveTimer = setTimeout(() => {
        const user = authUser;
        if (!user) return;
        const payload = structuredClone(state);
        delete payload.activeNotebook;
        delete payload.activeTab;
        delete payload.currentView;
        snapshotSaveQueue = snapshotSaveQueue.then(async () => {
          if (authUser?.id !== user.id) return;
          try {
            const { error } = await saveWorkspaceSnapshot(user.id, payload);
            if (error) setStatus('Cloud save failed · saved on this device');
            else {
              notifyWorkspaceChanged(workspaceChannel);
              setStatus('Saved and synced');
            }
          } catch (error) {
            setStatus(`Cloud save failed · ${error.message || 'saved on this device'}`);
          }
        });
      }, 550);
    } else setStatus(authUser ? 'Saving locally · cloud offline' : 'Saved on this device');
    $('#noteUpdated').textContent = 'Edited just now';
  }, 180);
}
function updateNoteFromEditor(noteId, editor) {
  const note = state.notes[noteId];
  if (!note) return;
  note.body = editor.getHTML();
  note.updatedAt = Date.now();
  setStatus('Saving…');
  persistState();
}
function updateNoteTitle() {
  const note = activeNote();
  if (!note) return;
  note.title = noteTitle.innerText.trim() || 'Untitled note';
  note.updatedAt = Date.now();
  const currentTab = activeNotebook().tabs.find((tab) => tab.id === note.id);
  if (currentTab) currentTab.label = note.title;
  setStatus('Saving…');
  persistState();
  $('#breadcrumbTab').textContent = note.title;
  const currentTabButton = $$('#tabs [data-tab]').find((button) => button.dataset.tab === note.id);
  if (currentTabButton) currentTabButton.textContent = note.title;
}

function renderNotebooks() {
  $('#notebookList').innerHTML = state.notebooks.map((book) => `
    <button class="notebook-item ${book.id === state.activeNotebook ? 'selected' : ''}" data-notebook="${esc(book.id)}" title="${esc(book.name)}">
      <span class="notebook-glyph">${esc(book.glyph || '▤')}</span><span>${esc(book.name)}</span><span class="notebook-meta">${book.tabs.length}</span>
    </button>`).join('');
  $$('#notebookList [data-notebook]').forEach((button) => button.addEventListener('click', () => {
    state.activeNotebook = button.dataset.notebook;
    state.activeTab = activeNotebook().tabs[0]?.id;
    state.currentView = 'notes';
    renderAll(); persistState();
  }));
}

function renderTabs() {
  const book = activeNotebook();
  $('#tabs').innerHTML = book.tabs.map((tab) => `<button class="section-tab ${tab.id === state.activeTab ? 'selected' : ''}" data-tab="${esc(tab.id)}">${esc(tab.label)}</button>`).join('');
  $$('#tabs [data-tab]').forEach((button) => button.addEventListener('click', () => {
    state.activeTab = button.dataset.tab;
    renderNote();
    renderTabs();
    updateBreadcrumbs();
    persistState();
  }));
}

function updateBreadcrumbs() {
  $('#breadcrumbNotebook').textContent = activeNotebook()?.name || 'Notebook';
  $('#breadcrumbTab').textContent = activeNote()?.title || 'Untitled note';
  $('#noteNotebookLabel').textContent = (activeNotebook()?.name || 'NOTEBOOK').toUpperCase();
}

function getSyncSession(noteId) {
  if (!authUser || !supabase) return Promise.resolve(null);
  if (!syncSessions.has(noteId)) {
    const userId = authUser.id;
    const sessionPromise = createNoteSyncSession(noteId, authUser, {
      onStatus: (message) => { if (authUser?.id === userId && ((state.currentView === 'notes' && activeNote()?.id === noteId) || (state.currentView === 'pdf' && pdfActiveNoteId === noteId))) setStatus(message); },
      onPresence: (presence) => { if (authUser?.id === userId && ((state.currentView === 'notes' && activeNote()?.id === noteId) || (state.currentView === 'pdf' && pdfActiveNoteId === noteId))) renderPresence(presence); }
    }).catch((error) => {
      if (syncSessions.get(noteId) === sessionPromise) syncSessions.delete(noteId);
      if (authUser?.id === userId) setStatus(`Offline · ${error.message || 'saved on this device'}`);
      return null;
    });
    syncSessions.set(noteId, sessionPromise);
  }
  return syncSessions.get(noteId);
}

function retireInactiveSyncSessions() {
  const activeIds = new Set([noteEditorId, pdfEditorId].filter(Boolean));
  for (const [noteId, sessionPromise] of syncSessions.entries()) {
    if (activeIds.has(noteId)) continue;
    void sessionPromise.then((session) => {
      const stillActive = noteId === noteEditorId || noteId === pdfEditorId;
      if (stillActive || syncSessions.get(noteId) !== sessionPromise) return;
      syncSessions.delete(noteId);
      session?.destroy();
    });
  }
}

async function mountNoteEditor(note) {
  if (noteEditorId === note.id && noteEditor) return;
  const token = ++editorMountToken;
  noteEditor?.destroy();
  noteEditor = null;
  noteEditorId = note.id;
  retireInactiveSyncSessions();
  noteBody.replaceChildren();
  const session = authUser ? await getSyncSession(note.id) : null;
  if (token !== editorMountToken || activeNote()?.id !== note.id) return;
  const editor = createNoteEditor({
    element: noteBody,
    content: note.body || '<p>Start writing here…</p>',
    ydoc: session?.doc || null,
    onUpdate: ({ editor: updatedEditor }) => updateNoteFromEditor(note.id, updatedEditor)
  });
  noteEditor = editor;
  if (session?.doc && session.doc.getXmlFragment('default').length === 0) {
    editor.commands.setContent(note.body || '<p>Start writing here…</p>');
  }
}

function renderPresence(entries = []) {
  const stack = $('#presenceStack');
  const unique = [...new Map(entries.map((entry) => [entry.device_id || entry.user_id || entry.name, entry])).values()]
    .filter((entry) => entry.device_id !== undefined)
    .slice(0, 4);
  stack.innerHTML = unique.map((person, index) => {
    const initial = esc((person.name || 'You').trim().slice(0, 1).toUpperCase());
    const color = person.color || ['#e8b1a0', '#a9bfd2', '#b8c7ad', '#d8c1a7'][index % 4];
    return `<span class="collab-avatar" style="background:${esc(color)}" title="${esc(person.name || 'Connected device')}">${initial}</span>`;
  }).join('');
  stack.setAttribute('aria-label', unique.length ? `${unique.length} connected device${unique.length === 1 ? '' : 's'}` : 'No other devices connected');
}

function mergeWorkspaceSnapshot(remotePayload) {
  if (!remotePayload || typeof remotePayload !== 'object' || !remotePayload.notes || !remotePayload.notebooks) return false;
  const local = state;
  const merged = structuredClone(remotePayload);
  merged.notes ||= {};
  merged.notebooks ||= [];
  if (hasSavedLocalState) {
    for (const [id, localNote] of Object.entries(local.notes || {})) {
      const remoteNote = merged.notes[id];
      if (!remoteNote || Number(localNote.updatedAt || 0) > Number(remoteNote.updatedAt || 0)) merged.notes[id] = structuredClone(localNote);
    }
    const books = new Map(merged.notebooks.map((book) => [book.id, book]));
    for (const localBook of local.notebooks || []) {
      if (!books.has(localBook.id)) {
        merged.notebooks.push(structuredClone(localBook));
        continue;
      }
      const remoteBook = books.get(localBook.id);
      const tabs = new Map((remoteBook.tabs || []).map((tab) => [tab.id, tab]));
      for (const localTab of localBook.tabs || []) if (!tabs.has(localTab.id)) tabs.set(localTab.id, structuredClone(localTab));
      remoteBook.tabs = [...tabs.values()];
    }
    merged.customDecks = [...(merged.customDecks || [])];
    for (const deck of local.customDecks || []) if (!merged.customDecks.some((item) => item.id === deck.id)) merged.customDecks.push(structuredClone(deck));
    merged.study = local.study || merged.study;
  }
  for (const [id, localNote] of Object.entries(local.notes || {})) {
    const target = merged.notes[id];
    if (!target) continue;
    const uniqueStrokes = (left = [], right = []) => {
      const seen = new Set();
      return [...left, ...right].filter((stroke) => {
        const signature = JSON.stringify(stroke);
        if (seen.has(signature)) return false;
        seen.add(signature);
        return true;
      });
    };
    target.pdfPages = [...new Set([...(target.pdfPages || []), ...(localNote.pdfPages || [])])];
    target.ink = uniqueStrokes(target.ink, localNote.ink);
    target.pdfInk ||= {};
    for (const [page, strokes] of Object.entries(localNote.pdfInk || {})) target.pdfInk[page] = uniqueStrokes(target.pdfInk[page], strokes);
  }
  if (merged.notebooks.some((book) => book.id === local.activeNotebook)) merged.activeNotebook = local.activeNotebook;
  if (!merged.notebooks.some((book) => book.id === merged.activeNotebook)) merged.activeNotebook = merged.notebooks[0]?.id;
  const book = merged.notebooks.find((item) => item.id === merged.activeNotebook);
  if (book?.tabs?.some((tab) => tab.id === local.activeTab)) merged.activeTab = local.activeTab;
  if (!book?.tabs?.some((tab) => tab.id === merged.activeTab)) merged.activeTab = book?.tabs?.[0]?.id;
  merged.currentView = local.currentView || 'notes';
  state = merged;
  return true;
}

function updateAccountChrome() {
  const loggedIn = Boolean(authUser);
  $('#syncHeadline').textContent = loggedIn ? 'Syncing your workspace' : 'Saved on this device';
  $('#syncDescription').textContent = loggedIn ? 'Edits sync across devices signed in to this account.' : (cloudSyncConfigured ? 'Sign in to sync notes across your devices.' : 'Add Supabase settings to enable cloud sync.');
  $('#syncBadge').textContent = loggedIn ? 'CLOUD SYNC' : (cloudSyncConfigured ? 'SIGN IN' : 'LOCAL ONLY');
  $('#accountStatus').textContent = loggedIn ? `Signed in as ${authUser.email || 'your account'}.` : (cloudSyncConfigured ? 'Sign in on each device to sync your workspace.' : 'Cloud sync requires Supabase settings in .env.');
  $('#signInButton').classList.toggle('hidden', loggedIn);
  $('#signUpButton').classList.toggle('hidden', loggedIn);
  $('#signOutButton').classList.toggle('hidden', !loggedIn);
  if (loggedIn) {
    const display = authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'Account';
    $('.profile-row strong').textContent = display;
    $('.profile-row small').textContent = authUser.email || 'Synced account';
    $('.profile-avatar').textContent = display.slice(0, 1).toUpperCase();
  } else {
    $('.profile-row strong').textContent = 'Sam Rivera';
    $('.profile-row small').textContent = 'Local workspace';
    $('.profile-avatar').textContent = 'S';
  }
}

function clearSyncSessions() {
  for (const sessionPromise of syncSessions.values()) void sessionPromise.then((session) => session?.destroy());
  syncSessions.clear();
  renderPresence([]);
}

function resetEditorsForAccountChange() {
  editorMountToken += 1;
  pdfEditorMountToken += 1;
  noteEditor?.destroy();
  pdfEditor?.destroy();
  noteEditor = null;
  noteEditorId = null;
  pdfEditor = null;
  pdfEditorId = null;
}

async function refreshWorkspaceFromCloud(userId) {
  try {
    const snapshot = await loadWorkspaceSnapshot(userId);
    if (authUser?.id !== userId) return;
    if (!snapshot?.payload) {
      persistState();
      return;
    }
    if (mergeWorkspaceSnapshot(snapshot.payload)) {
      renderNotebooks();
      renderTabs();
      renderStudyProgress();
      renderCustomDecks();
      updateBreadcrumbs();
      if (!noteEditor?.isFocused && !pdfEditor?.isFocused && !noteTitle.matches(':focus') && !$('#pdfNoteTitle').matches(':focus')) renderNote();
      drawSavedInk();
      renderView();
      persistState({ remote: true });
      setStatus('Updated from another device');
    }
  } catch (error) {
    if (authUser?.id === userId) setStatus(`Cloud unavailable · ${error.message || 'saved on this device'}`);
  }
}

async function handleAuthSession(session) {
  const nextUser = session?.user || null;
  if (authUser?.id === nextUser?.id) return;
  if (workspaceChannel && supabase) void supabase.removeChannel(workspaceChannel);
  workspaceChannel = null;
  clearSyncSessions();
  resetEditorsForAccountChange();
  authUser = nextUser;
  updateAccountChrome();
  if (!authUser) {
    renderAll();
    return;
  }
  const userId = authUser.id;
  setStatus('Connecting to your workspace…');
  await refreshWorkspaceFromCloud(userId);
  if (authUser?.id !== userId) return;
  workspaceChannel = subscribeWorkspace(userId, () => { void refreshWorkspaceFromCloud(userId); });
  renderAll();
  if (!hasSavedLocalState) persistState();
}

function initializeAuth() {
  if (!supabase) {
    updateAccountChrome();
    $('#signInButton').disabled = true;
    $('#signUpButton').disabled = true;
    return;
  }
  supabase.auth.onAuthStateChange((_event, session) => { void handleAuthSession(session); });
  void supabase.auth.getSession().then(({ data, error }) => {
    if (error) $('#accountStatus').textContent = error.message;
    else void handleAuthSession(data.session);
  });
}

function renderNote() {
  const note = activeNote();
  if (!note) return;
  noteTitle.innerText = note.title;
  if (state.currentView === 'notes') void mountNoteEditor(note);
  $('#handwritingIndex').value = note.handwritingIndex || '';
  $('#favoriteButton').classList.toggle('is-favorite', Boolean(note.favorite));
  $('#favoriteButton').textContent = note.favorite ? '★' : '☆';
  $('#noteUpdated').textContent = note.updatedAt ? `Edited ${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(note.updatedAt))}` : 'Just created';
  $('#annotationPanel').classList.add('hidden');
  updateBreadcrumbs();
  requestAnimationFrame(resizeInkCanvas);
}

function renderView() {
  const view = state.currentView || 'notes';
  $('#notesView').classList.toggle('hidden', view !== 'notes');
  $('#flashcardsView').classList.toggle('hidden', view !== 'flashcards');
  $('#pdfView').classList.toggle('hidden', view !== 'pdf');
  $$('.primary-nav [data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  if (view !== 'notes') {
    editorMountToken += 1;
    noteEditor?.destroy();
    noteEditor = null;
    noteEditorId = null;
  }
  if (view !== 'pdf') {
    pdfEditorMountToken += 1;
    pdfEditor?.destroy();
    pdfEditor = null;
    pdfEditorId = null;
  }
  if (view === 'notes') void mountNoteEditor(activeNote());
  if (view === 'pdf') {
    renderLinkedNotes();
    void renderPdfPage();
  }
  retireInactiveSyncSessions();
}

function renderAll() {
  renderNotebooks();
  renderTabs();
  renderNote();
  renderView();
  renderStudyProgress();
  renderCustomDecks();
}

function renderStudyProgress() {
  const known = state.study?.known ?? 0;
  const review = state.study?.review ?? cards.length - known;
  const percent = Math.min(100, Math.round((known / cards.length) * 100));
  $('#knownCount').textContent = known;
  $('#reviewCount').textContent = review;
  $('#masteryLabel').textContent = `${percent}%`;
  $('#masteryProgress').style.width = `${percent}%`;
  $$('.deck-meter b')[0].style.width = `${percent}%`;
  $$('.deck-meter span')[0].textContent = `${percent}% mastered`;
}

function renderCustomDecks() {
  state.customDecks ||= [];
  const list = $('.deck-list');
  $$('.custom-deck-row', list).forEach((row) => row.remove());
  state.customDecks.forEach((deck) => {
    const progress = deck.progress || 0;
    const row = document.createElement('button');
    row.className = 'deck-row custom-deck-row';
    row.dataset.deckId = deck.id;
    row.innerHTML = `<span class="deck-cover cover-green">✦</span><span class="deck-info"><strong>${esc(deck.title)}</strong><small>${esc(deck.source)} <i>·</i> ${deck.cards.length} cards</small></span><span class="deck-meter"><span>${progress ? `${progress}% mastered` : 'Not started'}</span><i><b style="width:${progress}%"></b></i></span><span class="row-arrow">→</span>`;
    row.addEventListener('click', () => openStudy(deck));
    list.append(row);
  });
}

function makeFlashcardFromNote() {
  const note = activeNote();
  const selection = noteEditor?.state.selection;
  const selectedText = selection && !selection.empty ? noteEditor.state.doc.textBetween(selection.from, selection.to, ' ').trim() : '';
  const suggestedQuestion = selectedText ? `What should you remember about “${selectedText.slice(0, 55)}”?` : '';
  const question = window.prompt('Flashcard question', suggestedQuestion);
  if (!question?.trim()) return;
  const answer = window.prompt('Flashcard answer', selectedText);
  if (!answer?.trim()) return;
  state.customDecks ||= [];
  let deck = state.customDecks.find((item) => item.noteId === note.id);
  if (!deck) {
    deck = { id: `deck-${Date.now()}`, noteId: note.id, title: `${note.title} · cards`, source: activeNotebook().name, cards: [], progress: 0 };
    state.customDecks.unshift(deck);
  }
  deck.cards.push([question.trim(), answer.trim()]);
  renderCustomDecks();
  persistState();
  notify('Flashcard added to this note’s deck');
}

function cardsFromNote(note) {
  const doc = document.createElement('div');
  doc.innerHTML = note.body || '';
  const headings = [...doc.querySelectorAll('h2')];
  const generated = headings.map((heading) => {
    let answer = '';
    for (let element = heading.nextElementSibling; element && element.tagName !== 'H2'; element = element.nextElementSibling) {
      const text = element.innerText?.trim();
      if (text && !element.matches('details')) { answer = text; break; }
    }
    return answer ? [`What should you remember about ${heading.innerText.trim()}?`, answer] : null;
  }).filter(Boolean);
  if (generated.length) return generated;
  const paragraphs = [...doc.querySelectorAll('p, li')].map((element) => element.innerText.trim()).filter((text) => text && !text.startsWith('↗'));
  return (paragraphs.length ? paragraphs : ['Add a few ideas to this note first.']).slice(0, 6).map((text, index) => [index ? `What is another key idea in ${note.title}?` : `What is the key idea in ${note.title}?`, text]);
}

function addTab() {
  const name = window.prompt('Name this notebook section');
  if (!name?.trim()) return;
  const id = `note-${Date.now()}`;
  const book = activeNotebook();
  state.notes[id] = { id, title: name.trim(), body: '<p>Start with a thought, a pasted image, or a quick sketch.</p>', handwritingIndex: '', pdfPages: [], ink: [], updatedAt: Date.now(), favorite: false };
  book.tabs.push({ id, label: name.trim() });
  state.activeTab = id;
  state.currentView = 'notes';
  renderAll();
  persistState();
}

function addNotebook() {
  const name = window.prompt('Name your notebook');
  if (!name?.trim()) return;
  const id = `book-${Date.now()}`;
  const noteId = `note-${Date.now()}`;
  state.notes[noteId] = { id: noteId, title: 'First note', body: '<p>Start writing…</p>', handwritingIndex: '', pdfPages: [], ink: [], updatedAt: Date.now(), favorite: false };
  state.notebooks.push({ id, name: name.trim(), glyph: '▤', tabs: [{ id: noteId, label: 'First note' }] });
  state.activeNotebook = id;
  state.activeTab = noteId;
  state.currentView = 'notes';
  renderAll();
  persistState();
}

function findTabForNote(noteId) {
  for (const book of state.notebooks) {
    const tab = book.tabs.find((item) => item.id === noteId);
    if (tab) return { book, tab };
  }
  return null;
}

function openNote(noteId) {
  const match = findTabForNote(noteId);
  if (!match) return;
  state.activeNotebook = match.book.id;
  state.activeTab = match.tab.id;
  state.currentView = 'notes';
  renderAll();
  $('#searchResults').classList.add('hidden');
  $('#searchInput').value = '';
  persistState();
}

function searchableText(note) {
  const bodyText = (note.body || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  return `${note.title} ${bodyText} ${note.handwritingIndex || ''}`.toLowerCase();
}

function showSearchResults(query) {
  const results = $('#searchResults');
  if (!query.trim()) { results.classList.add('hidden'); return; }
  const matches = Object.values(state.notes).map((note) => {
    const contents = searchableText(note);
    if (!contents.includes(query.toLowerCase())) return null;
    const type = (note.handwritingIndex || '').toLowerCase().includes(query.toLowerCase()) && !`${note.title} ${note.body}`.toLowerCase().includes(query.toLowerCase()) ? 'Handwriting index' : 'Note text';
    return { note, type, book: findTabForNote(note.id)?.book?.name || 'Notebook' };
  }).filter(Boolean).slice(0, 7);
  results.innerHTML = `<div class="search-result-label">${matches.length ? 'SEARCH RESULTS' : 'NO MATCHES YET'}</div>${matches.length ? matches.map(({ note, type, book }) => `<button class="search-result" data-result="${esc(note.id)}"><strong>${esc(note.title)}</strong><small>${esc(book)} <span class="match-type">· ${type}</span></small></button>`).join('') : '<div class="no-results">Try a word from your typed notes or handwriting index.</div>'}`;
  results.classList.remove('hidden');
  $$('[data-result]', results).forEach((button) => button.addEventListener('click', () => openNote(button.dataset.result)));
}

function insertHtmlAtCursor(html, editor = noteEditor) {
  if (!editor) return;
  editor.chain().focus().insertContent(html).run();
}

function insertImage(dataUrl, editor = noteEditor) {
  insertImageAtCursor(editor, dataUrl);
}

function addPageReference(page) {
  const note = activeNote();
  const pageNumber = Math.max(1, Number(page) || 1);
  note.pdfPages ||= [];
  if (!note.pdfPages.includes(pageNumber)) note.pdfPages.push(pageNumber);
  note.updatedAt = Date.now();
  insertHtmlAtCursor(`<button class="page-ref" data-page="${pageNumber}">↗ Page ${pageNumber} in PDF</button>&nbsp;`);
  renderLinkedNotes();
  persistState();
  notify(`Linked this note to page ${pageNumber}`);
}

function jumpToPdfPage(page) {
  const requested = Math.max(1, Number(page) || 1);
  const number = pdfDocument ? Math.min(pdfDocument.numPages, requested) : requested;
  $('#pageNumber').value = number;
  state.currentView = 'pdf';
  renderView();
  void renderPdfPage(number);
}

async function mountPdfEditor(note) {
  if (pdfEditorId === note.id && pdfEditor) return;
  const token = ++pdfEditorMountToken;
  pdfEditor?.destroy();
  pdfEditor = null;
  pdfEditorId = note.id;
  retireInactiveSyncSessions();
  $('#pdfNoteBody').replaceChildren();
  const session = authUser ? await getSyncSession(note.id) : null;
  if (token !== pdfEditorMountToken || pdfActiveNoteId !== note.id) return;
  pdfEditor = createNoteEditor({
    element: $('#pdfNoteBody'),
    content: note.body || '<p>Write notes for this page…</p>',
    ydoc: session?.doc || null,
    onUpdate: ({ editor }) => {
      const current = state.notes[note.id];
      if (!current) return;
      current.body = editor.getHTML();
      current.updatedAt = Date.now();
      setStatus('Saving…');
      persistState();
    }
  });
  if (session?.doc && session.doc.getXmlFragment('default').length === 0) {
    pdfEditor.commands.setContent(note.body || '<p>Write notes for this page…</p>');
  }
}

function renderLinkedNotes() {
  const page = Number($('#pageNumber').value) || 1;
  const allNotes = Object.values(state.notes).filter((note) => note.pdfPages?.length);
  const visible = allNotes.filter((note) => note.pdfPages.includes(page));
  $('#linkedNotesCount').textContent = `${visible.length} ${visible.length === 1 ? 'note' : 'notes'} · Page ${page}`;
  $('#linkedNoteList').innerHTML = visible.map((note) => `<button class="linked-note-card ${note.id === pdfActiveNoteId ? 'selected' : ''}" data-linked-note="${esc(note.id)}"><strong>${esc(note.title)}</strong><span>${esc(findTabForNote(note.id)?.book?.name || 'Notebook')} <em>· Page ${page}</em></span></button>`).join('');
  if (!visible.some((note) => note.id === pdfActiveNoteId)) pdfActiveNoteId = visible[0]?.id || null;
  $('#pdfNoLinkedNotes').classList.toggle('hidden', Boolean(pdfActiveNoteId));
  $('#pdfInlineEditor').classList.toggle('hidden', !pdfActiveNoteId);
  if (pdfActiveNoteId) {
    const note = state.notes[pdfActiveNoteId];
    $('#pdfNoteTitle').value = note.title;
    void mountPdfEditor(note);
  } else {
    pdfEditor?.destroy();
    pdfEditor = null;
    pdfEditorId = null;
    pdfEditorMountToken += 1;
  }
  $$('[data-linked-note]').forEach((button) => button.addEventListener('click', () => { pdfActiveNoteId = button.dataset.linkedNote; renderLinkedNotes(); }));
  drawPdfInk();
  retireInactiveSyncSessions();
}

function savePdfActiveNote() {
  const note = state.notes[pdfActiveNoteId];
  if (!note) return;
  note.title = $('#pdfNoteTitle').value.trim() || 'Untitled PDF note';
  note.updatedAt = Date.now();
  const tab = findTabForNote(note.id)?.tab;
  if (tab) tab.label = note.title;
  const tabButton = $$('#tabs [data-tab]').find((button) => button.dataset.tab === note.id);
  if (tabButton) tabButton.textContent = note.title;
  const linkedCard = $$('[data-linked-note]').find((button) => button.dataset.linkedNote === note.id);
  if (linkedCard) linkedCard.querySelector('strong').textContent = note.title;
  setStatus('Saving…');
  persistState();
}

function createPdfNote() {
  const page = Math.max(1, Number($('#pageNumber').value) || 1);
  const id = `note-${Date.now()}`;
  const title = `PDF note · page ${page}`;
  state.notes[id] = { id, title, body: `<p>Notes from page ${page}…</p>`, handwritingIndex: '', pdfPages: [page], ink: [], pdfInk: {}, updatedAt: Date.now(), favorite: false };
  activeNotebook().tabs.push({ id, label: title });
  pdfActiveNoteId = id;
  renderNotebooks();
  renderTabs();
  renderLinkedNotes();
  persistState();
}

async function loadPdf(file) {
  if (!file) return;
  try {
    pdfRenderToken += 1;
    if (pdfRenderTask) { try { pdfRenderTask.cancel(); await pdfRenderTask.promise; } catch { /* Previous render ended. */ } }
    if (pdfDocument) await pdfDocument.destroy();
    pdfDocument = null;
    pdfRenderTask = null;
    const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
    pdfDocument = await loadingTask.promise;
    $('#pdfFileName').textContent = file.name;
    $('#pdfTitle').textContent = file.name;
    $('#pdfEmpty').classList.add('hidden');
    $('#pdfCanvasHost').classList.remove('hidden');
    $('#pageTotal').textContent = String(pdfDocument.numPages);
    const requestedPage = Math.max(1, Math.min(pdfDocument.numPages, Number($('#pageNumber').value) || 1));
    $('#pageNumber').value = requestedPage;
    state.pdfName = file.name;
    await renderPdfPage(requestedPage);
    renderLinkedNotes();
    persistState();
    notify('PDF opened in this browser session');
  } catch (error) {
    notify(`Could not open PDF: ${error.message || 'unsupported file'}`);
  }
}

async function renderPdfPage(pageNumber = Number($('#pageNumber').value) || 1) {
  if (!pdfDocument) return;
  const token = ++pdfRenderToken;
  if (pdfRenderTask) {
    try { pdfRenderTask.cancel(); await pdfRenderTask.promise; }
    catch { /* A previous page was cancelled or already complete. */ }
  }
  if (token !== pdfRenderToken || !pdfDocument) return;
  let page;
  try { page = await pdfDocument.getPage(Math.min(pdfDocument.numPages, Math.max(1, pageNumber))); }
  catch (error) { if (token === pdfRenderToken) notify(`Could not render PDF page: ${error.message || 'render error'}`); return; }
  if (token !== pdfRenderToken) return;
  const host = $('#pdfCanvasHost');
  const baseViewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(240, host.clientWidth - 34);
  const availableHeight = Math.max(300, host.clientHeight - 34);
  const fitScale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height);
  const viewport = page.getViewport({ scale: fitScale * pdfScale });
  const outputScale = window.devicePixelRatio || 1;
  const canvas = $('#pdfCanvas');
  const annotationCanvas = $('#pdfAnnotationCanvas');
  const stage = $('#pdfPageStage');
  stage.style.width = `${viewport.width}px`;
  stage.style.height = `${viewport.height}px`;
  for (const target of [canvas, annotationCanvas]) {
    target.width = Math.round(viewport.width * outputScale);
    target.height = Math.round(viewport.height * outputScale);
    target.style.width = `${viewport.width}px`;
    target.style.height = `${viewport.height}px`;
  }
  const canvasContext = canvas.getContext('2d');
  const renderTask = page.render({ canvasContext, viewport, transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0] });
  pdfRenderTask = renderTask;
  try { await renderTask.promise; }
  catch (error) {
    if (error?.name !== 'RenderingCancelledException' && token === pdfRenderToken) notify(`Could not render PDF page: ${error.message || 'render error'}`);
  }
  if (token === pdfRenderToken) drawPdfInk();
}

function drawPdfInk() {
  const canvas = $('#pdfAnnotationCanvas');
  if (!canvas.width || !canvas.height) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const scale = window.devicePixelRatio || 1;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const note = state.notes[pdfActiveNoteId];
  const strokes = note?.pdfInk?.[Number($('#pageNumber').value)] || [];
  strokes.forEach((stroke) => {
    if (!stroke.points?.length) return;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size || 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    stroke.points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

function resizeInkCanvas() {
  const rect = inkCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scale = window.devicePixelRatio || 1;
  inkCanvas.width = Math.round(rect.width * scale);
  inkCanvas.height = Math.round(rect.height * scale);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  drawSavedInk();
}

function drawSavedInk() {
  const note = activeNote();
  if (!note || !inkCanvas.clientWidth) return;
  context.clearRect(0, 0, inkCanvas.clientWidth, inkCanvas.clientHeight);
  (note.ink || []).forEach((stroke) => {
    if (!stroke.points?.length) return;
    context.beginPath();
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.size || 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    stroke.points.forEach((point, index) => {
      const x = point.x * inkCanvas.clientWidth;
      const y = point.y * inkCanvas.clientHeight;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    if (stroke.points.length === 1) { const p = stroke.points[0]; context.lineTo(p.x * inkCanvas.clientWidth + 0.1, p.y * inkCanvas.clientHeight + 0.1); }
    context.stroke();
  });
}

function canvasPoint(event) {
  const rect = inkCanvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
}

function startInk(event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  inkCanvas.setPointerCapture(event.pointerId);
  const point = canvasPoint(event);
  const stroke = { color: isEraser ? '#ffffff' : currentInkColor, size: isEraser ? 15 : (event.pointerType === 'pen' ? 2 : 2.6), points: [point] };
  const note = activeNote();
  note.ink ||= [];
  note.ink.push(stroke);
  inkPointer = stroke;
  drawSavedInk();
}

function moveInk(event) {
  if (!inkPointer) return;
  event.preventDefault();
  inkPointer.points.push(canvasPoint(event));
  drawSavedInk();
}

function endInk() {
  if (!inkPointer) return;
  inkPointer = null;
  const note = activeNote();
  if (note) note.updatedAt = Date.now();
  persistState();
}

function openStudy(deck = null) {
  activeCard = 0;
  studyRevealed = false;
  currentStudyDeck = deck;
  currentStudyCards = deck?.cards?.length ? deck.cards : cards;
  renderCard();
  $('#studyModal').classList.remove('hidden');
}

function renderCard() {
  const deckCards = currentStudyCards.length ? currentStudyCards : cards;
  const [question, answer] = deckCards[activeCard % deckCards.length];
  $('#studyModalTitle').textContent = question;
  $('#cardPosition').textContent = `${String(activeCard + 1).padStart(2, '0')} OF ${deckCards.length}`;
  $('#answerArea').textContent = answer;
  $('#answerArea').classList.toggle('hidden', !studyRevealed);
  $('#revealAnswerButton').classList.toggle('hidden', studyRevealed);
  $('#studyActions').classList.toggle('hidden', !studyRevealed);
}

function recordStudy(known) {
  if (known) state.study.known = Math.min(cards.length, (state.study?.known || 0) + 1);
  else state.study.review = Math.min(cards.length, (state.study?.review || 0) + 1);
  if (currentStudyDeck) {
    currentStudyDeck.progress = Math.min(100, Math.round(((currentStudyDeck.progress || 0) + (known ? 100 / currentStudyCards.length : 0))));
  }
  activeCard = (activeCard + 1) % currentStudyCards.length;
  studyRevealed = false;
  renderCard();
  renderStudyProgress();
  renderCustomDecks();
  persistState();
}

// Editor content and formatting.
noteTitle.addEventListener('input', updateNoteTitle);
$('#handwritingIndex').addEventListener('input', (event) => {
  activeNote().handwritingIndex = event.target.value;
  activeNote().updatedAt = Date.now();
  setStatus('Saving…');
  persistState();
});
$$('.tool-button[data-command]').forEach((button) => {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    const command = button.dataset.command;
    if (!noteEditor) return;
    if (command === 'formatBlock') noteEditor.chain().focus().toggleHeading({ level: 2 }).run();
    else if (command === 'underline') noteEditor.chain().focus().toggleMark('underline').run();
    else noteEditor.chain().focus().toggleMark(command).run();
  });
});
$('#bulletButton').addEventListener('mousedown', (event) => event.preventDefault());
$('#bulletButton').addEventListener('click', () => noteEditor?.chain().focus().toggleBulletList().run());
$('#checklistButton').addEventListener('mousedown', (event) => event.preventDefault());
$('#checklistButton').addEventListener('click', () => noteEditor?.chain().focus().toggleTaskList().run());
$('#toggleButton').addEventListener('mousedown', (event) => event.preventDefault());
$('#toggleButton').addEventListener('click', () => insertHtmlAtCursor('<details><summary>Toggle heading</summary><div><p>Click here to add the hidden details.</p></div></details><p></p>'));
$('#insertImageButton').addEventListener('mousedown', (event) => event.preventDefault());
$('#insertImageButton').addEventListener('click', () => $('#imageInput').click());
$('#imageInput').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) { const reader = new FileReader(); reader.onload = () => insertImage(reader.result); reader.readAsDataURL(file); }
  event.target.value = '';
});
noteBody.addEventListener('paste', (event) => {
  const item = [...(event.clipboardData?.items || [])].find((clip) => clip.type.startsWith('image/'));
  if (!item) return;
  event.preventDefault();
  const file = item.getAsFile();
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => insertImage(reader.result);
  reader.readAsDataURL(file);
});
noteBody.addEventListener('click', (event) => {
  const reference = event.target.closest('[data-page]');
  if (reference) { event.preventDefault(); jumpToPdfPage(reference.dataset.page); }
});
$('#pageLinkButton').addEventListener('mousedown', (event) => event.preventDefault());
$('#pageLinkButton').addEventListener('click', () => addPageReference($('#pageNumber').value || 1));
$('#makeFlashcardButton').addEventListener('mousedown', (event) => event.preventDefault());
$('#makeFlashcardButton').addEventListener('click', makeFlashcardFromNote);
$('#favoriteButton').addEventListener('click', () => { const note = activeNote(); note.favorite = !note.favorite; note.updatedAt = Date.now(); renderNote(); persistState(); });

// Annotation layer uses pointer events so Apple Pencil, touch, and mouse all work.
$('#annotateButton').addEventListener('click', () => {
  const panel = $('#annotationPanel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) requestAnimationFrame(resizeInkCanvas);
});
$$('.pen-color').forEach((button) => button.addEventListener('click', () => {
  currentInkColor = button.dataset.color; isEraser = false;
  $$('.pen-color').forEach((item) => item.classList.toggle('active', item === button));
  $('#eraserButton').classList.remove('active');
}));
$('#eraserButton').addEventListener('click', () => { isEraser = !isEraser; $('#eraserButton').classList.toggle('active', isEraser); });
$('#clearInkButton').addEventListener('click', () => { activeNote().ink = []; activeNote().updatedAt = Date.now(); drawSavedInk(); persistState(); });
inkCanvas.addEventListener('pointerdown', startInk);
inkCanvas.addEventListener('pointermove', moveInk);
inkCanvas.addEventListener('pointerup', endInk);
inkCanvas.addEventListener('pointercancel', endInk);
window.addEventListener('resize', resizeInkCanvas);

// Search includes text and the scaffold's handwriting index.
$('#searchInput').addEventListener('input', (event) => showSearchResults(event.target.value));
$('#searchInput').addEventListener('focus', (event) => showSearchResults(event.target.value));
document.addEventListener('click', (event) => { if (!event.target.closest('.search-wrap')) $('#searchResults').classList.add('hidden'); });
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); }
  if (event.key === 'Escape') { $('#searchResults').classList.add('hidden'); $('#studyModal').classList.add('hidden'); }
});

// Notebook navigation and feature screens.
$$('.primary-nav [data-view]').forEach((button) => button.addEventListener('click', () => { state.currentView = button.dataset.view; renderView(); persistState(); }));
$('#addTab').addEventListener('click', addTab);
$('#addNotebook').addEventListener('click', addNotebook);
$('#shareButton').addEventListener('click', () => {
  $('#accountModal').classList.remove('hidden');
  updateAccountChrome();
  if (!cloudSyncConfigured) $('#accountStatus').textContent = 'Create a Supabase project and add its URL and publishable key to .env first.';
  if (authUser) $('#authEmail').value = authUser.email || '';
});
$('#closeAccountButton').addEventListener('click', () => $('#accountModal').classList.add('hidden'));
$('#accountModal').addEventListener('click', (event) => { if (event.target === $('#accountModal')) $('#accountModal').classList.add('hidden'); });
$('#signInButton').addEventListener('click', async () => {
  if (!supabase) { $('#accountStatus').textContent = 'Cloud sync requires Supabase settings in .env.'; return; }
  $('#accountStatus').textContent = 'Signing in…';
  const { error } = await supabase.auth.signInWithPassword({ email: $('#authEmail').value.trim(), password: $('#authPassword').value });
  $('#accountStatus').textContent = error ? error.message : 'Signed in. Connecting your workspace…';
});
$('#signUpButton').addEventListener('click', async () => {
  if (!supabase) { $('#accountStatus').textContent = 'Cloud sync requires Supabase settings in .env.'; return; }
  $('#accountStatus').textContent = 'Creating your account…';
  const { data, error } = await supabase.auth.signUp({ email: $('#authEmail').value.trim(), password: $('#authPassword').value });
  $('#accountStatus').textContent = error ? error.message : (data.session ? 'Account created. Connecting your workspace…' : 'Check your email to confirm the account, then sign in here.');
});
$('#signOutButton').addEventListener('click', async () => {
  if (!supabase) return;
  $('#accountStatus').textContent = 'Signing out…';
  const { error } = await supabase.auth.signOut();
  $('#accountStatus').textContent = error ? error.message : 'Signed out. Your local copy remains on this device.';
});
$('#createDeckButton').addEventListener('click', () => {
  const note = activeNote();
  const title = window.prompt('Name your flashcard deck', `${note?.title || 'New'} · review`);
  if (!title?.trim()) return;
  state.customDecks ||= [];
  const deck = { id: `deck-${Date.now()}`, title: title.trim(), source: activeNotebook().name, cards: cardsFromNote(note), progress: 0 };
  state.customDecks.unshift(deck);
  renderCustomDecks();
  persistState();
  notify(`Created “${deck.title}” with ${deck.cards.length} cards from this note`);
});
$('#startStudyButton').addEventListener('click', () => openStudy());
$('#deckRow').addEventListener('click', () => openStudy());
$('#resetStudyButton').addEventListener('click', () => { state.study = { known: 0, review: cards.length }; renderStudyProgress(); persistState(); notify('Study progress reset'); });
$('#closeStudyButton').addEventListener('click', () => $('#studyModal').classList.add('hidden'));
$('#revealAnswerButton').addEventListener('click', () => { studyRevealed = true; renderCard(); });
$('#againButton').addEventListener('click', () => recordStudy(false));
$('#knowButton').addEventListener('click', () => recordStudy(true));

// PDF reader, handwriting layer, and note-to-page links.
$('#pdfInput').addEventListener('change', (event) => { void loadPdf(event.target.files[0]); event.target.value = ''; });
$('#pdfInputEmpty').addEventListener('change', (event) => { void loadPdf(event.target.files[0]); event.target.value = ''; });
$('#pageNumber').addEventListener('change', () => {
  let page = Math.max(1, Number($('#pageNumber').value) || 1);
  if (pdfDocument) page = Math.min(pdfDocument.numPages, page);
  $('#pageNumber').value = page;
  renderLinkedNotes();
  void renderPdfPage(page);
});
$('#previousPage').addEventListener('click', () => { $('#pageNumber').value = Math.max(1, Number($('#pageNumber').value || 1) - 1); $('#pageNumber').dispatchEvent(new Event('change')); });
$('#nextPage').addEventListener('click', () => { $('#pageNumber').value = Math.min(pdfDocument?.numPages || Number.MAX_SAFE_INTEGER, Number($('#pageNumber').value || 1) + 1); $('#pageNumber').dispatchEvent(new Event('change')); });
$('#newPdfNote').addEventListener('click', createPdfNote);
$('#createPdfNoteInline').addEventListener('click', createPdfNote);
$('#pdfNoteTitle').addEventListener('input', savePdfActiveNote);
$('#pdfNoteBody').addEventListener('click', (event) => {
  const pageRef = event.target.closest('[data-page]');
  if (pageRef) { event.preventDefault(); jumpToPdfPage(pageRef.dataset.page); }
});
$('#pdfPageLinkButton').addEventListener('mousedown', (event) => event.preventDefault());
$('#pdfPageLinkButton').addEventListener('click', () => {
  const note = state.notes[pdfActiveNoteId];
  if (!note || !pdfEditor) return;
  const page = Math.max(1, Number($('#pageNumber').value) || 1);
  note.pdfPages ||= [];
  if (!note.pdfPages.includes(page)) note.pdfPages.push(page);
  insertHtmlAtCursor(`<p><button class="page-ref" data-page="${page}">↗ Page ${page} in PDF</button></p>`, pdfEditor);
  persistState();
  renderLinkedNotes();
});
$('#pdfImageButton').addEventListener('mousedown', (event) => event.preventDefault());
$('#pdfImageButton').addEventListener('click', () => $('#pdfImageInput').click());
$('#pdfImageInput').addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) { const reader = new FileReader(); reader.onload = () => insertImage(reader.result, pdfEditor); reader.readAsDataURL(file); }
  event.target.value = '';
});
$('#pdfNoteBody').addEventListener('paste', (event) => {
  const item = [...(event.clipboardData?.items || [])].find((clip) => clip.type.startsWith('image/'));
  if (!item) return;
  event.preventDefault();
  const file = item.getAsFile();
  if (file) { const reader = new FileReader(); reader.onload = () => insertImage(reader.result, pdfEditor); reader.readAsDataURL(file); }
});
$('#pdfAnnotateButton').addEventListener('click', () => {
  pdfAnnotating = !pdfAnnotating;
  $('#pdfAnnotateButton').classList.toggle('active', pdfAnnotating);
  $('#pdfAnnotationCanvas').classList.toggle('is-annotating', pdfAnnotating);
  $('#pdfAnnotationCanvas').setAttribute('aria-label', pdfAnnotating ? 'Draw on this PDF page' : 'PDF annotations');
});
$('#zoomButton').addEventListener('click', () => {
  pdfScale = pdfScale >= 1.5 ? 1 : +(pdfScale + 0.25).toFixed(2);
  $('#zoomButton').textContent = `${Math.round(pdfScale * 100)}%　⌄`;
  void renderPdfPage();
});
$('#pdfAnnotationCanvas').addEventListener('pointerdown', (event) => {
  if (!pdfAnnotating || (event.button !== undefined && event.button !== 0)) return;
  event.preventDefault();
  if (!pdfActiveNoteId) createPdfNote();
  const canvas = $('#pdfAnnotationCanvas');
  canvas.setPointerCapture(event.pointerId);
  const rect = canvas.getBoundingClientRect();
  const note = state.notes[pdfActiveNoteId];
  const page = Number($('#pageNumber').value) || 1;
  note.pdfInk ||= {};
  note.pdfInk[page] ||= [];
  const stroke = { color: currentInkColor, size: event.pointerType === 'pen' ? 2 : 2.6, points: [{ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }] };
  note.pdfInk[page].push(stroke);
  pdfInkPointer = stroke;
  drawPdfInk();
});
$('#pdfAnnotationCanvas').addEventListener('pointermove', (event) => {
  if (!pdfInkPointer || !pdfAnnotating) return;
  event.preventDefault();
  const rect = $('#pdfAnnotationCanvas').getBoundingClientRect();
  pdfInkPointer.points.push({ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) });
  drawPdfInk();
});
const finishPdfInk = () => { if (!pdfInkPointer) return; pdfInkPointer = null; const note = state.notes[pdfActiveNoteId]; if (note) note.updatedAt = Date.now(); persistState(); };
$('#pdfAnnotationCanvas').addEventListener('pointerup', finishPdfInk);
$('#pdfAnnotationCanvas').addEventListener('pointercancel', finishPdfInk);
const pdfResizeObserver = new ResizeObserver(() => { if (pdfDocument) void renderPdfPage(); });
pdfResizeObserver.observe($('#pdfCanvasHost'));

// Keep the offline local copy current and relay changes to other tabs in this browser.
if (channel) channel.addEventListener('message', (event) => {
  if (event.data?.type !== 'workspace-update' || !event.data.state) return;
  state = event.data.state;
  setStatus('Updated from another tab');
  renderNotebooks(); renderTabs(); renderStudyProgress(); updateBreadcrumbs();
  if (!authUser && !noteEditor?.isFocused && !noteTitle.matches(':focus')) {
    noteEditor?.destroy(); noteEditor = null; noteEditorId = null;
    renderNote();
  }
  if (state.currentView === 'pdf' && !pdfEditor?.isFocused && !$('#pdfNoteTitle').matches(':focus')) {
    if (!authUser) { pdfEditor?.destroy(); pdfEditor = null; pdfEditorId = null; }
    renderLinkedNotes();
  }
});
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue || noteEditor?.isFocused || noteTitle.matches(':focus') || pdfEditor?.isFocused || $('#pdfNoteTitle').matches(':focus')) return;
  try {
    state = JSON.parse(event.newValue);
    if (!authUser) { noteEditor?.destroy(); noteEditor = null; noteEditorId = null; pdfEditor?.destroy(); pdfEditor = null; pdfEditorId = null; }
    renderAll(); setStatus('Updated from another tab');
  } catch { /* Ignore a partial write. */ }
});

renderAll();
initializeAuth();
