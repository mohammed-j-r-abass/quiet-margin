# Public website with device storage

Quiet Margin can run as a static HTTPS website without a shared backend, accounts, or paid cloud document storage. The public build serves the application files. A visitor's own PDFs, extracted text, thoughts, recordings, and workspace are stored in IndexedDB in that browser profile on their device.

## Build and host

Use Node.js 24 and install dependencies with `npm ci`. For GitHub Pages at a project path, run this in PowerShell:

```powershell
$env:SITE_BASE_PATH = '/quiet-margin/'
npm run build:web
```

For hosting at the root of a dedicated domain, omit `SITE_BASE_PATH` or set it to `/`. Publish only the contents of `dist-web/`, including `.nojekyll`, to a static host. Do not upload `data/`, `.env`, the desktop server, local reports, or credentials.

For GitHub Pages, publish the built files on a separate `gh-pages` branch and select that branch's root as the Pages source. Keep the source code on the normal development branches. HTTPS is required for recording and the disk file picker. Changing the hosting path requires rebuilding.

The desktop commands remain `npm start`, `npm run build`, and `npm run serve`. They use the existing local server and library. Building the website does not move or delete that library.

## Where data lives

- Libraries belong to the browser profile and website origin. Separate visitors on separate devices or profiles do not share a database. Multiple tabs in the same profile use the same library; editing the same item in two tabs can result in the last save winning.
- Another browser, device, private window, website domain, or hosting path can start with an empty library. There is no automatic cloud sync or recovery account.
- Browser storage uses disk space, but its location is managed by the browser. The website cannot choose an arbitrary folder without permission.
- **Settings & backup → Saved on this device** shows the browser's storage estimate. **Protect browser storage** requests persistence. The browser may decline; persistence does not protect against clearing site data or losing the device.
- **Save backup to disk** opens a save-file picker on supported browsers, including current desktop Chrome and Edge. Other browsers download the file normally. **Download library backup** always uses a normal browser download.

Do not rely on private browsing for a long-lived library. Back up before clearing browser data, moving to another device, changing the site's domain/path, or removing the browser profile. No private library is included with a deployment.

## Backup and restore

The browser backup is a ZIP containing `library.json` plus the original PDFs and recordings. It excludes provider settings and API keys. It is unencrypted and contains private reading material, so keep the file somewhere safe.

Browser backup and restore have a 256 MB archive and uncompressed-size limit. Individual PDFs are limited to 100 MB, recordings to 25 MB, and PDFs to 3,000 pages. A backup exceeding the archive limit is rejected before writing it. The desktop app has its own restore-size limit; check it when moving a browser backup to desktop mode.

Restore validates the manifest, file names, record relationships, sizes, and required files. Path traversal, unexpected files, duplicate archive names, and oversized entries are rejected. All database and file replacements happen in one IndexedDB transaction. If saving fails because of quota or another error, the existing library remains intact.

A successful restore keeps one previous-library recovery copy in browser storage. Use **Save previous library after restore** to save it as a backup, then restore that file if needed. Keeping the recovery copy requires additional disk quota. Save a regular backup before restoring a large library. Clearing site storage removes both the current library and its recovery copy.

To move an existing desktop library to the website, download a library backup from the desktop app and restore it on the website, subject to these limits. The migration is explicit; the website has no access to the desktop data folder.

## Optional AI

No provider key is shipped with the website and there is no shared provider account. Each visitor may enter their own HTTPS endpoint, chat model ID, and API key. **Load models** requests available model IDs; **Test model** sends only a small test prompt. Model access and charges belong to that visitor's provider account.

Endpoint/model settings are stored locally. Keys exist only in JavaScript memory in the current tab. They are cleared on reload or close and can be cleared explicitly in storage settings. Keys are not written to IndexedDB, localStorage, sessionStorage, backups, URLs, or logs.

Before an AI question, the visitor must enable the checkbox allowing selected material to be sent to the displayed provider. Scoped saved quotations, thoughts, transcripts, titles, and the question can be sent for relevance selection and interpretation. Full-document text is eligible only when its separate toggle is enabled. Without a key, keyword retrieval runs locally. Browser AI searches are limited to 400 evidence items per request; narrow the scope for larger libraries.

Recordings always save locally first. Transcription is manual and asks permission before sending the selected recording to its provider. A different transcription host requires its own key. Requests omit cookies and referrers, reject redirects, and have a timeout.

Providers must allow cross-origin browser requests. A provider that blocks browser access cannot be used directly by this static site. The app explains the failure and retains the local library. Use the desktop app for those providers. A proxy is not provided, since that would put visitor material and API credentials through a shared backend.

## Security boundaries

The public build has no account database, upload server, analytics script, external script CDN, or creator API key. Reading and saving library items use browser APIs. Optional provider operations are the only feature that transmits library content. The static host still receives ordinary website requests and may log connection information such as IP addresses.

The build includes a Content Security Policy that limits scripts to bundled assets, disables embedded objects and form submissions, and allows required PDF workers and explicit HTTPS provider requests. PDF evaluation is disabled. User text and AI responses render as text through React. Backup validation and transactional writes reduce corruption and unsafe imports. These controls do not guarantee complete security.

This release does not encrypt the library with an application password. People using the same browser profile, malicious extensions, a compromised device, or malicious future site code may access its data. Use a private OS/browser profile and protect the device. Backups also require protection.

Browser isolation is by origin, not by URL path. The database name includes the application path to avoid accidental collisions, but other untrusted applications on the same origin could still read it. GitHub project sites for one account share an origin. Use a dedicated HTTPS domain before hosting untrusted applications alongside sensitive libraries. GitHub Pages does not allow custom response headers; the included CSP uses an HTML meta tag and cannot supply header-only controls such as `frame-ancestors`. A host supporting custom security headers can add those controls.

## Verification

Run `npm test`, `npm run build`, and `npm run build:web`. The browser-storage suite covers isolated visitor databases, reopening data, restore rollback, recovery copies, backup exclusions, invalid archives, session-only keys, endpoint restrictions, explicit AI consent, and evidence-ID validation. `npm audit` checks the locked dependency versions.

Serve `dist-web/` at its configured path, then test importing a PDF, adding a thought, reloading, citation generation, downloading a backup, restoring it, and reading with the thoughts sidebar closed. Check file saving and microphone permissions in the browser you intend to support. No live provider key is required for these checks.

References: [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API), [persistent storage](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist), [file saving](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker), and [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
