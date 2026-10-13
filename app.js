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
let currentInkColor = '#253e37';
let isEraser = false;
let inkPointer = null;
let saveTimer = null;
let pdfObjectUrl = null;
let activeCard = 0;
let studyRevealed = false;
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
    if (channel && !remote) channel.postMessage({ type: 'workspace-update', state });
    setStatus('All changes saved');
    $('#noteUpdated').textContent = 'Edited just now';
  }, 180);
}
function updateNoteFromEditor() {
  const note = activeNote();
  if (!note) return;
  note.title = noteTitle.innerText.trim() || 'Untitled note';
  note.body = noteBody.innerHTML;
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

function renderNote() {
  const note = activeNote();
  if (!note) return;
  noteTitle.innerText = note.title;
  noteBody.innerHTML = note.body || '<p>Start writing here…</p>';
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
  if (view === 'pdf') renderLinkedNotes();
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

function insertHtmlAtCursor(html) {
  noteBody.focus();
  document.execCommand('insertHTML', false, html);
  updateNoteFromEditor();
}

function insertImage(dataUrl) {
  insertHtmlAtCursor(`<img src="${dataUrl}" alt="Pasted image" />`);
}

function addPageReference(page) {
  const note = activeNote();
  const pageNumber = Math.max(1, Number(page) || 1);
  if (!note.pdfPages.includes(pageNumber)) note.pdfPages.push(pageNumber);
  insertHtmlAtCursor(`<button class="page-ref" data-page="${pageNumber}">↗ Page ${pageNumber} in PDF</button>&nbsp;`);
  renderLinkedNotes();
  notify(`Linked this note to page ${pageNumber}`);
}

function jumpToPdfPage(page) {
  const number = Math.max(1, Number(page) || 1);
  $('#pageNumber').value = number;
  if (pdfObjectUrl) $('#pdfFrame').src = `${pdfObjectUrl}#page=${number}`;
  state.currentView = 'pdf';
  renderView();
}

function renderLinkedNotes() {
  const page = Number($('#pageNumber').value) || 1;
  const allNotes = Object.values(state.notes).filter((note) => note.pdfPages?.length);
  const visible = allNotes.filter((note) => note.pdfPages.includes(page));
  $('#linkedNotesCount').textContent = `${allNotes.length} ${allNotes.length === 1 ? 'note' : 'notes'} connected`;
  $('#linkedNoteList').innerHTML = visible.length ? visible.map((note) => `<button class="linked-note-card" data-linked-note="${esc(note.id)}"><strong>${esc(note.title)}</strong><span>Biology 101 <em>· Page ${page}</em></span></button>`).join('') : '<div class="empty-index">No notes linked to this page yet.</div>';
  $$('[data-linked-note]').forEach((button) => button.addEventListener('click', () => openNote(button.dataset.linkedNote)));
}

function loadPdf(file) {
  if (!file) return;
  if (pdfObjectUrl) URL.revokeObjectURL(pdfObjectUrl);
  pdfObjectUrl = URL.createObjectURL(file);
  $('#pdfFileName').textContent = file.name;
  $('#pdfTitle').textContent = file.name;
  $('#pdfEmpty').classList.add('hidden');
  $('#pdfFrame').classList.remove('hidden');
  $('#pdfFrame').src = `${pdfObjectUrl}#page=${$('#pageNumber').value || 1}`;
  $('#pageTotal').textContent = '—';
  notify('PDF opened in this browser session');
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
  persistState();
}

// Editor content and formatting.
noteBody.addEventListener('input', updateNoteFromEditor);
noteTitle.addEventListener('input', updateNoteFromEditor);
$('#handwritingIndex').addEventListener('input', (event) => {
  activeNote().handwritingIndex = event.target.value;
  setStatus('Saving…');
  persistState();
});
$$('.tool-button[data-command]').forEach((button) => {
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => {
    noteBody.focus();
    const command = button.dataset.command;
    if (command === 'formatBlock') document.execCommand(command, false, button.dataset.value);
    else document.execCommand(command, false, null);
    updateNoteFromEditor();
  });
});
$('#bulletButton').addEventListener('mousedown', (event) => event.preventDefault());
$('#bulletButton').addEventListener('click', () => { noteBody.focus(); document.execCommand('insertUnorderedList'); updateNoteFromEditor(); });
$('#checklistButton').addEventListener('mousedown', (event) => event.preventDefault());
$('#checklistButton').addEventListener('click', () => insertHtmlAtCursor('<p class="check-row"><input type="checkbox" /> <span>New checklist item</span></p>'));
$('#toggleButton').addEventListener('mousedown', (event) => event.preventDefault());
$('#toggleButton').addEventListener('click', () => insertHtmlAtCursor('<details open><summary>Toggle heading</summary><p>Click here to add the hidden details.</p></details><p><br></p>'));
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
$('#favoriteButton').addEventListener('click', () => { const note = activeNote(); note.favorite = !note.favorite; renderNote(); persistState(); });

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
$('#clearInkButton').addEventListener('click', () => { activeNote().ink = []; drawSavedInk(); persistState(); });
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
$('#shareButton').addEventListener('click', () => notify('Invite and cloud sharing will connect when a sync service is added.'));
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

// PDF reader and note-to-page links.
$('#pdfInput').addEventListener('change', (event) => loadPdf(event.target.files[0]));
$('#pdfInputEmpty').addEventListener('change', (event) => loadPdf(event.target.files[0]));
$('#pageNumber').addEventListener('change', () => { const page = Number($('#pageNumber').value) || 1; $('#pageNumber').value = Math.max(1, page); if (pdfObjectUrl) $('#pdfFrame').src = `${pdfObjectUrl}#page=${Math.max(1, page)}`; renderLinkedNotes(); });
$('#previousPage').addEventListener('click', () => { $('#pageNumber').value = Math.max(1, Number($('#pageNumber').value || 1) - 1); $('#pageNumber').dispatchEvent(new Event('change')); });
$('#nextPage').addEventListener('click', () => { $('#pageNumber').value = Number($('#pageNumber').value || 1) + 1; $('#pageNumber').dispatchEvent(new Event('change')); });
$('#newPdfNote').addEventListener('click', () => {
  const id = `note-${Date.now()}`;
  const page = Number($('#pageNumber').value) || 1;
  const title = `PDF note · page ${page}`;
  state.notes[id] = { id, title, body: `<p>Notes from page ${page}…</p><p><button class="page-ref" data-page="${page}">↗ Page ${page} in PDF</button></p>`, handwritingIndex: '', pdfPages: [page], ink: [], updatedAt: Date.now(), favorite: false };
  const book = activeNotebook();
  book.tabs.push({ id, label: title });
  state.activeTab = id;
  state.currentView = 'notes';
  renderAll(); persistState();
});
$('#zoomButton').addEventListener('click', () => notify('Use your browser’s PDF controls to adjust zoom.'));

// Same-browser tabs share edits immediately. Cross-device sync needs a server-backed service.
if (channel) channel.addEventListener('message', (event) => {
  if (event.data?.type !== 'workspace-update' || !event.data.state) return;
  state = event.data.state;
  setStatus('Updated from another tab');
  renderNotebooks(); renderTabs(); renderStudyProgress(); updateBreadcrumbs();
  if (!noteBody.matches(':focus') && !noteTitle.matches(':focus')) renderNote();
});
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue || noteBody.matches(':focus') || noteTitle.matches(':focus')) return;
  try { state = JSON.parse(event.newValue); renderAll(); setStatus('Updated from another tab'); } catch { /* Ignore a partial write. */ }
});

renderAll();
