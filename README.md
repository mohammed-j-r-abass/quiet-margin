# Quiet Margin

A private research reading app for one person on one laptop. React and PDF.js provide the reading workspace; Express, SQLite, and a private files folder provide persistent storage. No account or cloud deployment is required.

## Features

- Continuous PDF reading with page tracking, zoom, and saved reading positions.
- Optional highlights, written thoughts, and voice notes linked to source passages.
- Instant highlight colors and a reading view with collapsible sidebars.
- Search across notes, quotations, transcripts, and document metadata.
- Configurable AI endpoints and models with linked evidence in each answer.
- MLA citations with PDF positions and printed page labels kept separate.
- Local storage, Markdown exports, and complete library backups.

## Start

Use Node.js **24** (minimum 22.13). Install dependencies in the project folder:

```sh
npm ci
```

Double-click **Start Quiet Margin.cmd**, or open PowerShell in this folder and run:

```powershell
npm start
```

Open **http://localhost:4317** in Chrome, Edge, or Firefox. The launcher builds the frontend and starts the backend together. Stop it with Ctrl+C. If it is already running, use the existing app address. The server binds only to `127.0.0.1`.

For a fresh copy on another laptop, install Node.js 24, run `npm ci`, then `npm start`. The Windows launcher runs `npm ci` automatically if dependencies are missing. Installation needs internet access; ordinary reading does not.

## Read and capture

1. **Import a PDF** or drop it onto the import card. Import supports one or several PDFs, each up to 100 MB and 3,000 pages.
2. Open papers in tabs and **scroll down continuously** through the whole PDF. The page counter follows the page occupying the most space in the reading window. Page separators show the PDF page and any embedded printed page label. The page field and arrows remain available for quick jumps. Page, zoom, your place within the page, open tabs, and theme are saved and restored; zooming or resizing preserves your relative reading position. Nearby pages are rendered as needed. At 100%, the page fits the available width. Click **Expand** to hide app navigation and tab bars, and **Exit expanded view** to return. The expanded view and your sidebar choice are saved.
3. Select text on one PDF page. Click **Highlight** to save a highlight immediately, with no editor or confirmation window. Hover over Highlight, or click its arrow, to choose yellow, green, pink, or blue; clicking a color also saves immediately. The last chosen color is remembered. Choose **Thought** or **Voice** to capture a linked thought without highlighting by default. The thought editor shows the exact selected quotation separately from your own words, and has an optional **Highlight passage** checkbox. Selections are restricted to one page; create separate annotations for a passage spanning pages.
4. Open the margin notes using **Open thoughts sidebar** in the reader toolbar; use **Close thoughts sidebar** to hide them. Every highlight or selected-passage thought automatically includes its source page, such as **Page 235 · PDF page 2**. **Cite passage** opens an MLA citation for that passage's page, even if you are currently reading another page. Printed locators use the PDF's embedded page labels; when none are available, the note shows the PDF position and the citation leaves the printed locator for you to verify. Saving or jumping to a thought does not open the sidebar automatically or leave expanded view. Use the toolbar's **Thought** button for a general document thought even when the sidebar is closed. **Hide annotations** makes the PDF quiet without deleting anything. Open a passage from a thought's page chip or quotation when reviewing your notes.
5. **All thoughts** searches quotations, comments, transcripts, tags, document titles, and authors. Filter by document and date. Library search covers titles, authors, years, and tags; collection and date filters help organize papers. Edit a document’s details to assign a collection.

The interface defaults to muted army green and dark ash with warm, high-contrast text. Use the sun/moon button at the bottom of the sidebar to switch themes; your choice is saved. PDF page colors are preserved.

Annotations retain document identity, exact quotation, separate comment, normalized page rectangles, selection offsets, surrounding prefix/suffix text, PDF page position, explicit PDF page label when present, tags, color, and timestamps. Highlights use a light translucent tint with continuous strips per line, without word-by-word borders. Selecting a saved highlight keeps the same light tint. The PDF itself remains unchanged. Scanned or otherwise textless pages show a clear notice; this version does not perform OCR.

PDF labels and printed page numbers are not always the same. The app shows explicit page labels only when the file supplies them. It does not invent printed page numbers from the PDF position. For files without labels, add the correct printed locator yourself when using a citation.

## Audio thoughts

Click **Record voice**, allow your browser to use the microphone for localhost, speak, and click **Stop recording**. Preview before saving, then replay the saved recording from the sidebar. Recordings are limited to 25 MB. You can replace or delete audio while retaining the written annotation. The original audio is saved before any transcription is attempted.

An untranscribed recording is explicitly labeled: its audio content is not searchable. You may type a transcript yourself, or configure a transcription provider. Original provider text and later transcript revisions are preserved separately from the editable current transcript. Failed transcription leaves the recording intact. A browser permission request that stays pending times out with guidance; use a normal Chrome or Edge tab if an embedded browser cannot grant microphone access.

## Configure AI

Open **Ask your library**. The model name is directly editable at the top. Click the connection/settings icon to enter the **endpoint**, **model name**, and **API key**, then **Save & use**. You can type any model ID supported by your OpenAI-compatible provider. Changing the model takes effect for new questions immediately, without restarting.

- **Load models** fetches the provider’s advertised model IDs with your key. Model listing does not prove that billing quota or chat access is available.
- **Test model** makes a tiny Chat Completions request with the selected endpoint/model/key. No papers or notes are sent. It tests unsaved settings without replacing the saved connection.
- OpenAI examples: endpoint `https://api.openai.com/v1`, chat model `gpt-4.1-mini` or `gpt-5.4-mini`. Exact access and quota depend on your API project. Full `/chat/completions` URLs are accepted and normalized to a base URL.
- **Optional embeddings** can be left off: the selected chat model then retrieves relevant saved notes by meaning before interpreting them. This makes endpoint + model + key sufficient. For a larger library, optionally enable a compatible embedding model, such as OpenAI’s `text-embedding-3-small`. An embedding model cannot be used as the chat model.
- Settings & backup exposes the same connection controls, plus separate optional transcription settings. A blank transcription model disables automatic transcription. Blank separate endpoint/key settings fall back to the AI endpoint/key.

If you change to a different provider, enter its key; the app will not silently send the old provider’s saved key to a different origin.

### If you see HTTP 429

The app distinguishes exhausted API credit/quota from temporary request/token rate limits by reading the provider’s error code and type. Billing errors such as `insufficient_quota` or `credit_balance_exhausted` require adding API credits or adjusting the relevant project/organization limits in your provider dashboard; merely switching model names or retrying will not fix exhausted quota. Rate-limit errors show a wait/reduce-scope message and honor the provider’s Retry-After guidance in the displayed instructions. The app does not repeatedly retry billing failures.

For OpenAI, inspect [API billing](https://platform.openai.com/settings/organization/billing/overview) and [project limits](https://platform.openai.com/settings/organization/limits). The model/key and billing checks happen server-side; raw provider error bodies and credentials are not returned to the browser or printed in logs.

Alternatively, copy `.env.example` to `.env`, enter settings, and restart. Settings saved through the app override environment defaults. The example model names are configurable examples, not a promise of account availability. Local OpenAI-compatible providers can use an HTTP localhost endpoint and their configured key.

Retrieval uses `/embeddings` and `/chat/completions`; transcription uses multipart `/audio/transcriptions`. The chat model must be able to return the requested JSON text. Malformed or unlinked output is rejected; the original retrieved evidence remains available. Provider failures show an error or a keyword fallback. There is no provider-specific SDK dependency.

**Ask your library** defaults to annotations and transcripts. Describe what you remember; select one or several documents to narrow scope or compare notes. Semantic embeddings and keyword matches, or semantic selection by the chosen chat model when embeddings are off, retrieve saved material before the model interprets it. Embeddings are cached locally by content, endpoint, and model. Endpoint/embedding-model changes invalidate the cache; switching only the chat model preserves embeddings. Links are generated from actual database records, never model-created URLs. AI explanations address you directly with "you" and "your notes", while referring to paper authors separately. Each supported AI statement must cite valid retrieved evidence IDs. Evidence cards always display the saved quotation and thought from the database, distinct from the AI interpretation.

No key is needed for PDFs, annotations, recording, ordinary search, citations, export, backup, or restore. Without a key, Ask your library returns keyword evidence and explains what AI configuration is missing.

### What is sent to providers

Nothing is sent while importing, reading, annotating, doing ordinary search, exporting, or backing up.

When you ask for AI retrieval with embeddings enabled, your query and the scoped saved quotations, comments, transcripts, titles, authors, and tags may be sent to the embedding endpoint. With embeddings off, batches of scoped saved material are sent to the selected chat model to select relevant evidence by meaning. Relevant retrieved evidence and your query are then sent to the chat endpoint for interpretation. Original PDFs and audio are not sent by retrieval.

Turning on **Include full document text** explicitly permits extracted text from the selected scope to be embedded. Only retrieved text chunks go into the interpretation prompt. This can generate many embedding requests and provider charges on a large library.

Transcription sends the selected original audio recording to the configured transcription endpoint. If a transcription model is configured, saving a recording starts this step automatically. Retrying transcription is an explicit action. Provider retention policies apply to content you send.

Document text is serialized as untrusted source data and the system prompt tells the provider never to treat it as instructions. AI interpretations still require your judgment; the linked saved evidence lets you verify them.

### Keys and private storage

API keys are stored only on the server, in `.env` or `data/secrets.json`; configuration responses expose presence flags, never the keys. These files, all user data, and build output are ignored by Git. Keys are not placed in frontend bundles or logs. The secrets file is protected by the operating system’s folder permissions; this app does not add encryption or an OS credential vault.

PDFs and recordings live under `data/files/`, outside the public frontend. UUID filenames, validated routes, host/origin checks, and a per-server write token protect local file handling. The app is intended for a trusted local OS account, without public network access or multi-user authentication.

## Citations and export

Open a document’s details, correct its title, authors, publication, year, DOI, URL, publisher, volume, issue, and publication page range, and mark the metadata reviewed. Use `Family, Given; Family, Given` for personal authors; a single literal name can represent an organization. PDF title and author metadata are extracted when available. Publication facts are never inferred from a PDF creation date.

**Cite** uses Citation.js with citeproc and the bundled official CSL Modern Language Association style. It produces a Works Cited entry and a suggested in-text citation. Missing core metadata and unreviewed metadata are flagged. Check the printed page locator and bibliographic completeness before publication.

**Export notes** downloads readable Markdown containing quotations, separate thoughts, transcripts, source entries, PDF page references, annotation IDs, tags, timestamps, and recording filenames. Audio binaries are included in a full library backup, rather than in the text-only Markdown export.

## Backup and restore

**Download library backup** creates a ZIP containing all active documents, recordings, pages, notes, transcripts, and workspace state. API keys are intentionally excluded. Treat this ZIP as private: it contains your entire reading library.

**Restore a backup** validates the archive, replaces the library, and reloads the workspace. It keeps a pre-restore SQLite/files recovery copy in `data/before-restore-<timestamp>/`. Your provider configuration is retained. Restore accepts ZIPs up to 100 MB and up to 1 GB uncompressed. For larger libraries, stop the app and copy the entire `data` folder; restoring that folder while stopped also restores everything. A whole-folder backup includes secrets, so protect it accordingly.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd + K | Ask your library |
| Ctrl/Cmd + F | Search inside the current PDF |
| Ctrl/Cmd + Shift + N | General document thought |
| Left / right arrows | Previous / next PDF page |
| Escape | Close dialog; unsaved thoughts require discard confirmation |

## Verification and known limits

Run `npm test` for the isolated integration suite. The fixture script downloads public sample PDFs when needed. The suite restarts its own backend and exercises a local simulated AI provider. See `TESTING.md` for the automated and browser checks.

- No OCR, encrypted PDF unlocking, cross-page selections, or collaborative editing.
- The reader displays PDF pages in a continuous stack and renders nearby pages as needed. Embedded forms, PDF JavaScript, and document link navigation are not enabled.
- PDF text selection follows the PDF’s text layer; unusual layouts or broken encodings can produce imperfect reading order. Coordinates preserve the selected location in the original file.
- Meaning-based retrieval uses your chosen chat model, with a compatible embedding model as an optional alternative. Interpretation and transcription require compatible models at the configured endpoints and access through your provider account.
- Microphone recording requires a browser with MediaRecorder support and microphone permission for localhost. Check recording and replay in your intended browser before relying on the voice workflow.
- Chat questions are independent retrieval requests. Conversation history is not persisted, so make each request self-contained.
- A fresh clone starts with an empty library. Private documents, annotations, recordings, credentials, and local verification reports are excluded through `.gitignore`.

## Project files

`src/` contains the React app; `server/` contains the API, SQLite access, and retrieval. `assets/` bundles the MLA citation style. `tests/` contains isolated integration tests and real PDF fixtures. `data/` is your private runtime library. `npm run build` prepares a static frontend plus local PDF.js fonts/CMaps/WASM; `npm run serve` starts an already-built app.

The downloaded fixture sources are documented in `tests/fixtures/README.txt`. The bundled CSL MLA style contains its attribution and [CC BY-SA license reference](https://creativecommons.org/licenses/by-sa/3.0/). API integration follows the official [Chat Completions](https://developers.openai.com/api/reference/resources/chat), [embeddings](https://developers.openai.com/api/reference/resources/embeddings/methods/create), and [transcription](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create) references. PDF rendering uses [PDF.js](https://mozilla.github.io/pdf.js/).
