# Margin notes app scaffold

A responsive, dependency-free prototype for a notebook app that combines typed notes, stylus annotations, flashcards, search, and PDF study notes.

## Run it

Open `index.html` in a modern browser, or serve this directory locally:

```powershell
python -m http.server 4173
```

Then open <http://localhost:4173>.

## Scaffolded interactions

- **Notebooks and sections:** switch between notebooks, add notebooks, and add section tabs. Notes and titles save in browser storage.
- **Notes:** edit text, format it, add lists and collapsible toggles, paste images into the editor, or use the image picker.
- **Handwriting:** draw with Apple Pencil, touch, or a mouse. Add a searchable handwriting index alongside the ink. The search field matches note text and that index.
- **Search:** search titles, typed note content, and handwriting index terms, then jump to a matching note.
- **Flashcards:** study the included deck, mark cards for review or as known, and create a deck from the active note's headings and paragraphs. Progress is shown on the study screen.
- **PDF study:** open a PDF in the browser, set a page number, link notes to a page, and jump from a note back to its page. The PDF itself stays in the current browser session.
- **Live editing demo:** edits are saved locally and broadcast to other open tabs of the app in the same browser.

## Services to connect for a multi-device product

This repository has no server or account system yet. Cross-device sync and Google Docs-style collaboration need an authenticated backend that stores notebook content and broadcasts edits, plus conflict handling for simultaneous edits. The share button and collaborator avatars are UI scaffolds; they do not invite other users. Replace the local storage/BroadcastChannel adapter in `app.js` with the chosen sync service when one is selected.

Handwriting search currently uses a user-editable index; it does not recognize ink automatically. Connect handwriting OCR and indexing to search to enable automatic search of handwritten pages. PDF page count and annotations are also basic scaffolds: this version opens the browser's built-in PDF viewer and stores page links in the note.

All sample content and edits are stored in the browser's local storage. Use **Clear site data** in your browser to reset this demo.
