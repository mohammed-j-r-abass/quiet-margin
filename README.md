# Quiet Margin

A research reading app for PDFs, notes, highlights, voice recordings, and source-linked AI search.

[Open Quiet Margin](https://mohammed-j-r-abass.github.io/quiet-margin/)

## Features

- Continuous PDF reading with saved positions and page tracking.
- Highlights and thoughts linked to source passages.
- Voice notes and optional transcription.
- Search across documents and notes.
- MLA citations, Markdown exports, and library backups.
- Configurable AI providers and models.

## Stack

React, Vite, PDF.js, IndexedDB, Node.js, Express, and SQLite. Local development uses Node.js 24.

## Storage

The website saves each library on the device in its browser profile. No account is required. Clearing site data removes the library; backups can be saved to disk. The desktop version uses a local SQLite database.

Optional AI uses a visitor's own endpoint, model, and key. Browser keys last for the current tab session. Selected material is sent to the chosen provider with permission.

Optional Cloudflare Web Analytics reports website visits and page load performance. Library contents and AI keys are excluded from these statistics.
