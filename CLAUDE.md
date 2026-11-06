# CLAUDE.md

Guidance for Claude Code working in this repository. Read `HANDOFF.md` too: it has the
project history, what is verified, what is not, and the roadmap.

## What this is

Alembic is a web app with three AI tools: **AI Image**, **AI Video** (each with several
engines) and **AI Summary** (any file → summary + chat). It runs in three modes, and every
change must keep all three working:

| Mode | How it starts | AI comes from |
|---|---|---|
| `server` | `node server.js` | `/api/*` routes using keys in `.env` |
| `artifact` | `dist/alembic.html` published as a Claude artifact | `window.claude.use('sample')` (Claude) |
| `static` | `public/` on static hosting | none (AI shows as off; files are still read) |

`public/js/core.js` detects the mode (`Alembic.env.mode`) and exposes one AI adapter
(`Alembic.ai.text/json/upload/image/videoStart/videoStatus/download`) so the UI code does not care.

## Commands

```bash
node server.js            # http://localhost:3000 (npm run dev = auto-restart)
npm test                  # server tests against fake providers + catalog sync check (fast, no keys)
npm run test:ui           # builds dist/preview.html, runs it in headless Chromium with a fake Claude runtime
npm run test:e2e          # real server.js + fake providers + real page
npm run build:catalog     # regenerate public/js/catalog.js after editing lib/catalog.js
npm run build:artifact    # dist/alembic.html (single file for the Claude artifact)
```

Browser tests need Python 3 with `playwright` (`pip install playwright && playwright install chromium`).
In a Claude Code cloud container Chromium is already installed: make a venv with the Python
`playwright` matching the preinstalled Node one and put it first on PATH; never run
`playwright install` there (details in `HANDOFF.md` section 8).
Run `npm test` after any server change, `npm run test:ui` after any front-end change, and
`npm run test:e2e` when a change crosses both.

## Hard rules

- **Zero dependencies.** The server uses only built-in Node modules (Node 18.17+, global `fetch`).
  The browser uses vanilla JS. The only CDN libraries are pdf.js and JSZip, pinned to exact
  versions in `core.js` (`LIB_URLS`). Do not add npm packages, bundlers or frameworks without
  asking the user first.
- **No build step for `public/`.** Files are served as written. The one generated file is
  `public/js/catalog.js` (from `lib/catalog.js`); CI fails if it is stale.
- **Secrets stay on the server.** Keys live in `.env` (gitignored) or the host's environment.
  Never send a key to the browser, log it, or commit it. `/api/health` exposes only labels,
  model IDs and which env var names unlock an engine.
- **Paid API calls cost the user money.** Tests use `test/mock_providers.mjs`. Before calling a
  real provider (to verify a schema), ask the user, use the cheapest model and the smallest
  output, and say what it will roughly cost.
- **Ask before pushing to `main`, deleting files the user made, or force-pushing.** Work on a
  branch and open a PR.
- **Prices change.** Engine prices in `lib/catalog.js` are list prices with the date they were
  read; update the comment block there when you change one. `MAX_SPEND_PER_DAY` relies on them.

## Code map

```
server.js                 HTTP server, routes, access code, rate limit, static files + CSP
lib/catalog.js            every server engine: id, provider, label, model, modelEnv, aspects, durations, audio,
                          i2v (image-to-video model for Make it move), price; estimateCost()
lib/config.js             .env loader; which text AI and which engines are available
lib/http.js               fetchJson/fetchBytes/downloadUrl, explain() → friendly ProviderError
lib/providers/text.js     generateText / streamText({prompt | messages, images, files, json}) for gemini/anthropic/openai
lib/providers/image.js    generateImage(): fal, cloudflare, replicate, gemini, openai, pollinations
lib/providers/video.js    startVideo() background jobs (+ image-to-video), cancelVideo(); files kept 2 h in tmp
lib/providers/fal.js      fal queue: submit → poll status_url → GET response_url; falCancel() (PUT cancel_url)
lib/providers/files.js    Gemini Files API resumable upload, streamed from the browser request
public/js/core.js         util, lazy libs, env detection, A.save (downloads), A.ai adapter
public/js/engines.js      A.engines.list/find/run: built-in engines + server engines in one list
public/js/vector.js       Vector Illustrator, Pixel Artist (SVG prompts, sanitizer, rasterizer)
public/js/shader.js       Shader Painter / Shader Film: GLSL prompt, compile-and-fix loop, WebGL2 render
public/js/motion.js       Motion Graphics scene engine, Story Reel, recordCanvas() (MediaRecorder)
public/js/music.js        procedural Web Audio soundtrack recorded into clips
public/js/gallery.js      My creations: IndexedDB store of images/clips (A.gallery); fails soft when storage is blocked
public/js/readers.js      file → "digest" {kind, text, images, tables, facts, warnings, media...}
public/js/summary.js      summary/chat prompts; uploads media once per digest (Gemini)
public/js/app.js          UI for the three views (Img, Video, Sum objects; exposed as Alembic.app)
```

Front-end modules are IIFEs that attach to `window.Alembic` and load in the order listed at
the bottom of `public/index.html`. Keep that pattern.

## How to…

- **Add a server engine:** entry in `lib/catalog.js` → input mapping in `image.js`/`video.js`
  (`falImageInput`, `falVideoInput`, `replicateImageInput`, `replicateVideoInput`,
  `cloudflareImageInput`) → fake response in `test/mock_providers.mjs` → assertion in
  `test/test_server.mjs` → `npm run build:catalog`. The UI picks it up automatically.
- **Add a built-in engine:** add to `LOCAL` in `public/js/engines.js` with `run(ctx)` returning
  `{kind, blob, mime, ext, extras}`; extend `test/ui_test.py`'s fake `sample` to answer its prompt.
- **Add a file type to Summary:** extend `KIND_BY_EXT`/`READERS` in `readers.js`; the digest must
  fill `text` (and/or `images`), `facts`, `warnings`.
- **Change colours/spacing:** tokens at the top of `public/styles.css` (light + dark).

## UI and copy conventions

- Plain, friendly words; no jargon in the UI ("Add FAL_KEY to switch this on", not "provider unauthorized").
- Errors say what happened and what to do next (`lib/http.js#explain`, `core.js#FRIENDLY`).
- Every control works with a keyboard; radio groups use `role="radio"`/`aria-checked`.
- Check 390 px wide (no horizontal scroll), light and dark, and `prefers-reduced-motion`.
- Long work shows progress and a Stop button; Stop must abort cleanly (`AbortController`).

## Verifying work

A change is done when the relevant tests pass and you have looked at the result: open the page
(or `dist/preview.html`) in a headless browser and take a screenshot of the screen you changed.
For provider changes, confirm the request shape against the provider's current docs (links in
`HANDOFF.md`) and update the mock to match.
