# Margin

Margin is a browser based study notebook for rich text notes, stylus annotations, PDF study, and flashcards. It keeps a local copy on each device and can sync a private workspace through Supabase.

## Run locally

Requires Node.js 20.19 or newer.

```powershell
npm install
npm run dev
```

Open the local URL printed by Vite. Notes work locally without an account or Supabase project.

## Enable same-account sync

1. Create a Supabase project.
2. Run `supabase/migrations/20261015000100_workspace_sync.sql` in the project's SQL editor.
3. Copy `.env.example` to `.env` and set the project URL and publishable key.
4. Restart `npm run dev`, then use **Sync** to create an account or sign in on each device.

The migration stores workspace snapshots and Yjs document updates with row-level security. Each device must sign in to the same account. This is private workspace sync; inviting other accounts and granular sharing are not implemented yet.

## Current features

- Notebooks with section tabs, favorites, rich text, toggles, task lists, and pasted or uploaded images.
- Apple Pencil, touch, or mouse ink on notes and PDF pages. Add searchable terms to the handwriting index next to note ink.
- Search across note titles, rich text, and handwriting index terms.
- Flashcard decks from selected note text or note headings, with study progress.
- PDF.js page rendering with page navigation, zoom, a separate linked notes editor, page references, and an ink layer.
- Local browser storage, same-browser cross-tab updates, Supabase account sync, Yjs text collaboration, and active device presence.

## Current limits

- Handwriting search uses the words entered in the handwriting index; automatic handwriting OCR is not connected.
- A PDF is opened from the current device and remains in that browser session. The PDF file itself is not uploaded or synced, so reopen the same file on each device.
- Rich text edits merge through Yjs. Other workspace data, such as notebook metadata, flashcards, and ink strokes, sync through snapshots; simultaneous changes to the same metadata are resolved by latest edit time.
- Sync currently covers one account's devices. Sharing with collaborators, invitations, and permissions are future work.
- Images are embedded in note content, so very large pasted images can exceed local browser storage limits.
