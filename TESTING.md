# Testing

Use Node.js 24 and install dependencies with `npm ci`.

Run the automated checks:

```sh
npm test
npm run build
```

Before testing, the fixture script downloads two public sample PDFs if they are missing. These downloads are ignored by Git. The synthetic PDF with page labels 101 through 104 is included in the repository.

The integration suite starts a separate server on port 4318, uses a temporary library, and simulates an AI provider locally. It does not use the application's saved library or API keys. Stop another test run using that port before starting a new run.

The checks cover:

- PDF import, text extraction, and invalid uploads.
- Separate quotations, thoughts, transcripts, and highlight choices.
- Annotation coordinates, text anchors, and source page labels.
- MLA citations using the source page rather than the current reading page.
- Reading positions, preferences, and restart persistence.
- Local host restrictions, write tokens, and credential redaction.
- Provider configuration, model selection, retrieval, and provider errors.
- Original audio storage and transcript revision history.
- Backup, restore, and rejection of unsafe archive paths.

For browser checks, start the app with `npm start` and open `http://localhost:4317/`.

1. Import a PDF, scroll across page boundaries, and check the page counter.
2. Highlight a passage with one click, then try a different color.
3. Save a thought with highlighting disabled and the sidebar closed.
4. Open the sidebar and use the note's page reference and Cite passage button.
5. Change zoom, switch documents, refresh, and check the restored reading position.
6. Record a voice note in a browser with microphone access, then replay it.
7. Export notes and create a library backup.

Live AI requests and microphone capture require manual checks with the provider and browser you intend to use. Scanned PDFs require OCR outside this application.
