# Alembic

A colourful web app with three AI tools:

| Tool | What it does |
|---|---|
| **AI Image** | Prompt → picture, with a choice of engines. Three built-in engines work with only a text-AI key; real image models switch on when you add their keys. |
| **AI Video** | Prompt → short clip. Three built-in engines (with a generated soundtrack) plus real text-to-video models. |
| **AI Summary** | Drop a PDF, Word, Excel/CSV, PowerPoint, image, video, audio or text file → summary, key points, study notes, action items or a simple explanation, in 11 languages. Then ask follow-up questions. |

There is **nothing to `npm install`**. The server uses only built-in Node.js modules, and the browser loads pdf.js and JSZip from public CDNs when a file needs them.

## The engines

**Built in** (need only one text-AI key, such as a free Gemini key):

| Studio | Engine | How it works |
|---|---|---|
| Image | Vector Illustrator | The AI draws a layered SVG; you can download SVG or a 2048 px PNG |
| Image | Shader Painter | The AI writes a GPU shader; your graphics chip paints landscapes, skies, space and abstract art |
| Image | Pixel Artist | The AI places pixels on a 64×64-style grid; Alembic snaps them to a palette and scales up crisply |
| Video | Motion Graphics | The AI designs an animated scene; your browser animates and records it |
| Video | Shader Film | An animated GPU shader recorded to video (sky, sea, nebulae, liquid colour) |
| Video | Story Reel | Three scenes with crossfades, a title card and captions |

Every built-in video gets a **procedural soundtrack** (calm, upbeat, epic or mystery), made in the browser.

**Real models** (switch on with keys; you pay the provider per use):

| Key | Image engines | Video engines |
|---|---|---|
| `FAL_KEY` | FLUX.1 Schnell, Seedream 5 Lite | Grok Imagine Video, Seedance 2.0, Veo 3.1 Fast (all with sound) |
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | Lucid Origin, FLUX.1 Schnell (free daily allowance) | — |
| `REPLICATE_API_TOKEN` | FLUX.2 Pro, FLUX Schnell | P-Video, MiniMax H3, Veo 3.1 Fast |
| `OPENAI_API_KEY` | GPT Image | — |
| `GEMINI_API_KEY` + `GEMINI_BILLING=on` | Nano Banana 2.1 | Gemini Omni Flash |
| `POLLINATIONS_API_KEY` | Pollinations FLUX | — |
| *(no key at all)* | Free demo engine (768 px, one image every 45 s) | — |

Engines without a key appear in a **"more engines"** list that says which key unlocks them.

---

## 1. Run it on your computer

1. Install **Node.js 18 or newer** (the LTS download from <https://nodejs.org>). Check with `node -v`.
2. Open a terminal in this folder.
3. Create your settings file:
   - macOS / Linux: `cp .env.example .env`
   - Windows (Command Prompt): `copy .env.example .env`
4. Put at least a `GEMINI_API_KEY` in `.env` (free: <https://aistudio.google.com/apikey>).
5. Start the server:
   ```bash
   node server.js
   ```
6. Open **<http://localhost:3000>**.

The terminal shows which engines are on. `npm run dev` restarts the server whenever you edit a file.

## 2. Try it

- **Image:** type a prompt (or press *Surprise me*), pick an engine card, pick a shape, press *Generate*. Under the result, *Same prompt with* re-runs the prompt on another engine so you can compare.
- **Video:** pick an engine, length, shape and soundtrack. Built-in engines record in real time, so keep the tab open while it records. **Stop** also cancels a real-model job at fal.ai or Replicate.
- **Make it move:** under any picture, *Make it move* opens the video studio. With `FAL_KEY`, Grok Imagine Video, Seedance 2.0 and Veo 3.1 Fast start the clip from the picture itself (image-to-video); otherwise a built-in engine draws the same idea as a clip.
- **My creations:** every image and clip you make is kept in this browser (up to 40 of each), so it is still there after a reload. Pick one from the strip, delete it (with Undo), or press *Download all* for a zip with a `prompts.md` list. Private windows keep them only until the tab closes.
- **Summary:** press a sample (*Lecture notes*, *Status report*, *Sales data*) or drop your own file anywhere on the page. Switch between *Summary*, *Key points*, *Study notes*, *Action items* and *Explain simply*; answers are cached, so switching back is instant. Ask questions in the chat below.

## 3. API keys: what each one turns on

Open `.env`, paste keys after the `=` signs, save, and restart `node server.js`.

| Key | Turns on | Get it |
|---|---|---|
| `GEMINI_API_KEY` | Summaries and questions, *Improve prompt*, all six built-in engines. **Only Gemini can watch a whole video and hear audio** for summaries. | <https://aistudio.google.com/apikey> (free tier) |
| `FAL_KEY` | 2 image + 3 video models | <https://fal.ai/dashboard/keys> |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | 2 image models, with a free daily allowance | <https://dash.cloudflare.com/profile/api-tokens> (use the *Workers AI* template) |
| `REPLICATE_API_TOKEN` | 2 image + 3 video models | <https://replicate.com/account/api-tokens> |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Text AI with Claude or OpenAI instead of Gemini (OpenAI also adds GPT Image) | provider dashboards |

**A good start for students:** a free Gemini key (summaries + built-in engines) and a Cloudflare token (free daily image allowance). Add `FAL_KEY` or `REPLICATE_API_TOKEN` with a little credit when you want real video.

If you set more than one text key, choose with `TEXT_PROVIDER=gemini|anthropic|openai`. Providers rename and retire models often: if you see *"could not find the model"*, put the current model ID in the matching line of `.env` (all are listed in `.env.example`). Prices change too, so check each provider's pricing page and set a spending limit there.

## 4. Put it on the internet

### Render (free tier)

1. Push this folder to a GitHub repository. `.env` is in `.gitignore`, so your keys stay private.
2. At <https://render.com>: **New → Blueprint** → pick the repository (the included `render.yaml` fills in the settings). Or **New → Web Service** with start command `node server.js`.
3. Under **Environment**, add your keys and an `ACCESS_CODE`.

Free Render services sleep after 15 minutes without visitors; the next visit takes about a minute to wake up.

### Any server or VPS

Copy the folder, set the same environment variables, and run `node server.js` (keep it running with `pm2` or a systemd service). Alembic needs a long-running Node process: video jobs are tracked in memory, so serverless platforms are not a good fit.

### Protect your keys when the site is public

- `ACCESS_CODE=some-secret-phrase` makes visitors type the code once before AI features work.
- `AI_REQUESTS_PER_MINUTE=30` limits each visitor.
- `MAX_SPEND_PER_DAY=2` stops real image and video models once about $2 of estimated cost has been used that day (UTC). The estimates come from each provider's list price (shown on the engine cards and the Generate button); engines without a known price count as $0.05 an image or $0.20 a second.
- Set monthly spending limits in every provider's billing settings.

## 5. Install it like an app

Once it is online over HTTPS, open it on your phone and choose **Add to Home Screen** (Safari) or **Install app** (Chrome / Edge).

---

## How it is built

```
alembic/
├── server.js                 Node server: serves public/ and the /api routes
├── lib/
│   ├── catalog.js            every server engine (labels, models, shapes, lengths)
│   ├── config.js             reads .env and decides which engines are on
│   ├── http.js               fetch helpers and friendly error messages
│   └── providers/
│       ├── text.js           Gemini, Claude, OpenAI text (+ images, chat turns, Gemini files)
│       ├── image.js          fal, Cloudflare, Replicate, OpenAI, Gemini, Pollinations images
│       ├── video.js          fal, Replicate, Gemini video as background jobs
│       ├── fal.js            fal.ai queue client
│       └── files.js          Gemini Files API upload (whole videos/audio for summaries)
├── public/
│   ├── index.html            the three views: Image, Video, Summary
│   ├── styles.css            colours and layout (tokens at the top, light + dark)
│   └── js/
│       ├── core.js           environment, library loader, saving files, AI adapter
│       ├── catalog.js        generated from lib/catalog.js (locked engine cards)
│       ├── engines.js        one list of engines; runs built-in and server engines
│       ├── vector.js         Vector Illustrator + Pixel Artist
│       ├── shader.js         Shader Painter + Shader Film (WebGL 2)
│       ├── motion.js         Motion Graphics + Story Reel, and video recording
│       ├── music.js          procedural soundtrack (Web Audio)
│       ├── gallery.js        My creations: keeps images and clips in this browser (IndexedDB)
│       ├── readers.js        turns any file into text/pictures/statistics for the AI
│       ├── docx.js           Word reader
│       ├── summary.js        summary and question prompts
│       ├── markdown.js       safe Markdown rendering of AI answers
│       ├── samples.js        the three sample files
│       └── app.js            everything you click
├── tools/                    build_catalog, build_artifact, make_samples
└── test/                     server tests with fake providers, browser tests
```

| Route | Purpose |
|---|---|
| `GET /api/health` | Text AI and every engine, with `available` and the keys a locked one `needs` |
| `POST /api/ai/text` | `{prompt}` or `{messages:[{role, content}]}`, plus optional `images`, `files`, `json` → `{text}`. With `stream: true` the answer arrives as server-sent events: `delta` `{text}` pieces, then `done` `{text}` (or `error`) |
| `POST /api/ai/upload` | Raw video/audio body → `{uri, mime}` from the Gemini Files API (for summaries) |
| `POST /api/ai/image` | `{prompt, aspect, engine}` → `{images:[{mime, data}], model}` |
| `POST /api/ai/video` | `{prompt, aspect, duration, engine}` → `{id, status}` (starts a job). Add `image: {mime, data}` (PNG/JPG/WebP, base64) to start from a picture on engines with `fromImage` |
| `GET /api/ai/video/:id` | Job status; when finished, `url` points at the file |
| `DELETE /api/ai/video/:id` | Stop a job: Alembic stops waiting and asks fal.ai or Replicate to cancel it (`providerCanceled` says whether they did) |
| `GET /api/files/:id` | The finished video (supports seeking) |

### Tests

```bash
npm test             # server + every provider, against fake providers (no keys, no network)
npm run test:ui      # the page in headless Chromium with a fake Claude runtime (needs Python + Playwright)
npm run test:e2e     # real server + fake providers + real page
```

### Adding an engine

1. Add an entry to `IMAGE_ENGINES` or `VIDEO_ENGINES` in `lib/catalog.js`.
2. Map its inputs in `lib/providers/image.js` or `video.js` (look for `falImageInput`, `replicateVideoInput`, …).
3. Add a fake response in `test/mock_providers.mjs` and a check in `test/test_server.mjs`.
4. Run `npm run build:catalog` so the locked list in the browser shows it.

## Limits worth knowing

- Built-in engines are AI-*drawn* (SVG, shaders, animated shapes), not photographs. For photos and real footage, add a real-model key.
- Built-in clips record in real time in the browser tab (4–15 s), as MP4 where the browser supports it, otherwise WEBM.
- Video summaries without Gemini look at up to 10 frames and cannot hear the sound. Audio summaries need Gemini.
- Very long files are cut to the first 150,000 characters for the AI; spreadsheets read up to 20,000 rows per sheet, with statistics computed exactly in the browser.
- Old formats (`.doc`, `.xls`, `.ppt`) are not read; save them as `.docx`, `.xlsx` or `.pptx`.
- HEIC photos only open in Safari; elsewhere, save them as JPG first.

Libraries used in the browser: pdf.js (Apache-2.0) and JSZip (MIT). Fonts: Bricolage Grotesque, Figtree and JetBrains Mono from Google Fonts.
