# foliate-js — vendored

Rendering engine for the in-app reader. Vendored rather than fetched at runtime:
the reader must work offline, and a book is arbitrary downloaded content, so the
engine is pinned and shipped in the bundle.

| | |
|---|---|
| Upstream | https://github.com/johnfactotum/foliate-js |
| Pinned commit | `78914aef4466eb960965702401634c2cb348e9b1` (2026-05-01) |
| Licence | MIT — see `LICENSE`. `vendor/` holds BSD-3-Clause / MIT / Apache code. |

ES modules, no build step. Do not edit these files; to upgrade, re-vendor from a
new commit and record the SHA here so the diff is reviewable.

## What is deliberately NOT vendored

- **`pdf.js` and `vendor/pdfjs`** — pdfjs is 13 MB against a 2.9 MB app, for a
  format upstream calls "highly experimental". Every format loader in `view.js`
  is a dynamic `await import()`, so omitting it fails only the PDF path and
  affects nothing else. Rawkoon can hold `pdf`, so those files stay unopenable
  until this is revisited; re-adding is a copy of two paths.
- `reader.html`, `reader.js`, `ui/` — the upstream demo reader. We supply our own
  host shell.
- `opds.js`, `dict.js`, `tts.js`, `quote-image.js` — OPDS catalogues, dictionary
  lookup, text-to-speech and quote images. None are in scope, and all are
  dynamic imports.
- `tests/`, `rollup/`, lint and package manifests.

## Upstream constraints that shaped the integration

- **CSP is mandatory.** Upstream: "Do NOT use this library without CSP unless you
  completely trust the content." The host shell sets one.
- Scripted content in books is unsupported (relies on `blob:`; WebKit bug 218086).
- The zip loader wants random access, so the archive is served over a
  `WKURLSchemeHandler` that honours `Range` — not a `file://` URL, which JS
  `fetch()` cannot read under WKWebView's CORS rules.
- Paginator options are `setAttribute`-only; there is no JS property API.
- KF8 decompression is slow upstream, so `mobi`/`azw3` need a loading state.
