# Alembic: handoff notes

Written 6 November 2026 at version **2.0.0**, for whoever continues the work (most likely
Claude Code with this GitHub repository). Read `CLAUDE.md` first for the rules and commands;
this file is the history, the honest status, the provider reference and the roadmap.

---

## 1. Where the project came from

**Version 1** (5 Nov 2026) was a file converter (PDF→Word, MP4→MP3, images→PDF, …) with AI
image and AI video pages and a few AI tools.

**Version 2** (this one) followed this request from the owner, quoted as written:

> "so first of all, remove the file convertor and all, and keep only the ai image and video
> generators, got it, and also, you can keep the ai summary of any file, example pdf, word ,
> excel , or image, or video also , like this..!! and the ai image and ai video , try to be more
> good, it is only using one engine as of now, try to include 2 or 3 more engines , and if i
> wanted to do all this in claude code, and i connected my github also, so pls give me, long
> detailed text, so that, it can continue from where it stopped..!!"

How that was carried out:

| Asked | Done |
|---|---|
| Remove the converters | All converter code, pdf-lib and lamejs are gone. |
| Keep AI image and video | Rebuilt as two studios with engine cards. |
| More engines (2–3 more) | **Image:** 3 built-in + 10 server engines. **Video:** 3 built-in + 7 server engines. In the Claude preview, where only Claude is available, there are now 3 working engines per studio instead of 1. |
| "Try to be more good" | Prompt improver, engine-specific "Surprise me" ideas, one-click "same prompt with another engine", soundtrack for built-in clips, "Make it move" from image to video, history strip, download in native formats. |
| AI summary of any file | PDF, Word, Excel/CSV, PowerPoint, images, video, audio, text and code; five summary styles, three lengths, 11 output languages, follow-up chat. |
| Long handoff text for Claude Code | This file, `CLAUDE.md`, and a kickoff prompt (section 9). |

## 2. Status at a glance

| Area | State | How it was checked |
|---|---|---|
| Image studio UI (cards, styles, shapes, history, downloads) | Done | Browser test, screenshots (desktop + 390 px dark) |
| Built-in image engines: Vector Illustrator, Shader Painter, Pixel Artist | Done | Browser test with a fake Claude (incl. the shader compile-fix loop) |
| Built-in video engines: Motion Graphics, Shader Film, Story Reel + soundtrack | Done | Browser test: real MediaRecorder output, audio track present |
| Server image engines (fal ×2, Cloudflare ×2, Replicate ×2, OpenAI, Gemini, Pollinations ×2) | Code done | Server tests against **fake** providers only |
| Server video engines (fal ×3, Replicate ×3, Gemini) | Code done | Server tests against **fake** providers only |
| Summary: readers for every file type, prompts, cache, chat | Done | Browser test with the 3 bundled samples + photo + video + audio |
| Summary of whole videos/audio via Gemini Files API | Code done | Server test + end-to-end test against a **fake** Gemini |
| Access code, rate limit, CSP, range requests, path traversal guard | Done | Server tests |
| Claude artifact build (`dist/alembic.html`) | Done | Browser test runs this exact file |
| CI (GitHub Actions: syntax check + server tests) | Added | Not yet run on GitHub |
| Deployment (Render blueprint) | Config updated | Not deployed |

Test totals at handoff: `npm test` 67 checks, `npm run test:ui` 39 checks,
`npm run test:e2e` 15 checks. All passing.

## 3. Verified vs. not verified (read this before trusting anything)

**Verified:** everything the tests cover, against fakes that encode the request and response
shapes from each provider's documentation (checked on 6 Nov 2026, links in section 4).

**Not verified, because no real API keys or provider network access were available:**

1. **No real provider has been called.** Every server engine may still have a field-name or
   value mismatch. Highest risk first:
   - fal **Seedream 5 Lite**: `image_size` sent as `{width, height}` (docs give a pixel range,
     2560×1440 to 4096×4096, but not the object shape). If refused, try the enum strings used by
     FLUX (`square_hd`, `landscape_16_9`, …) or `auto_2K`.
   - Replicate **MiniMax H3**: assumed `ratio: "16:9"` only and no audio. Check which ratios
     text-to-video accepts and whether it outputs sound.
   - **Gemini Omni** video and **Nano Banana** image use the Interactions API
     (`/v1beta/interactions`); shapes came from version-1 research. Needs a billed project.
   - Cloudflare responses are read from `result.image` (standard Cloudflare envelope) with a
     fallback to `image`. The image type is sniffed from bytes.
   - fal **Veo 3.1 Fast**: Google retired Veo in its own API; fal still documents
     `fal-ai/veo3.1/fast`. Confirm it still runs, or remove it from `lib/catalog.js`.
   - Gemini Files API: upload → poll `files/{name}` until `state: ACTIVE` → reference with
     `file_data: {mime_type, file_uri}` in `generateContent`. Google's newest docs show the
     Interactions API instead; `generateContent` should still accept `file_data`.
   - Text model IDs `gemini-3.5-flash-lite`, `claude-haiku-5-5`, `gpt-6-luna` and image model IDs
     `gpt-image-2.5-flare`, `gemini-nano-banana-2.1`, `gemini-omni-1.1-flash` all came from
     version-1 research; any of them can be overridden in `.env`.
2. **Browsers other than Chromium were not tested.** Expected behaviour:
   - Chrome records H.264/AAC MP4.
   - Chromium-only builds record VP9/Opus inside MP4, which QuickTime and iOS cannot play.
   - Safari 17+ records MP4.
   - Firefox records WEBM.
   - Shader engines need WebGL 2.
   - Safari and iOS still need a manual pass.
3. **Real Claude artifact runtime:** tested with a stand-in that mimics `sample` and
   `downloads`. The real runtime may differ in limits, such as the number of images per call.

## 4. Engine and provider reference

All IDs can be changed with the env var in the last column (see `.env.example`).

### Image engines (`lib/catalog.js` → `IMAGE_ENGINES`)

| id | Model | Request Alembic sends | Env override |
|---|---|---|---|
| `fal:flux-schnell` | `fal-ai/flux/schnell` | `{prompt, image_size: square_hd/landscape_16_9/portrait_16_9/landscape_4_3, num_inference_steps: 4, output_format: jpeg}` | `FAL_FLUX_MODEL` |
| `fal:seedream` | `fal-ai/bytedance/seedream/v5/lite/text-to-image` | `{prompt, image_size: {width, height}}`: 2048², 2560×1440, 1440×2560, 2304×1728 | `FAL_SEEDREAM_MODEL` |
| `cloudflare:lucid` | `@cf/leonardo/lucid-origin` | `{prompt, width, height}`: 1024², 1344×768, 768×1344, 1280×960 | `CLOUDFLARE_LUCID_MODEL` |
| `cloudflare:flux` | `@cf/black-forest-labs/flux-1-schnell` | `{prompt, steps: 6}` (square only, max 8 steps) | `CLOUDFLARE_FLUX_MODEL` |
| `replicate:flux-2-pro` | `black-forest-labs/flux-2-pro` | `{prompt, aspect_ratio, resolution: "1 MP", output_format: webp}` | `REPLICATE_IMAGE_BEST` |
| `replicate:flux-schnell` | `black-forest-labs/flux-schnell` | `{prompt, aspect_ratio, num_outputs: 1, output_format: webp, go_fast}` | `REPLICATE_IMAGE_FAST` |
| `openai:gpt-image` | `gpt-image-2.5-flare` | `/v1/images/generations` `{size: 1024x1024 / 1536x1024 / 1024x1536, quality: medium}` | `OPENAI_IMAGE_MODEL` |
| `gemini:nano-banana` | `gemini-nano-banana-2.1` | Interactions API, `response_format: {type: image, aspect_ratio}` | `GEMINI_IMAGE_MODEL` |
| `pollinations:flux` | `flux` | `GET /image/{prompt}?model&width&height&seed` with a Bearer key | `POLLINATIONS_IMAGE_MODEL` |
| `pollinations:free` | keyless classic endpoint | 768 px, one image per 45 s per server; shown only when no other image engine is on | — |

### Video engines (`VIDEO_ENGINES`)

| id | Model | Request Alembic sends | Lengths offered | Sound |
|---|---|---|---|---|
| `fal:grok-video` | `xai/grok-imagine-video/text-to-video` | `{prompt, aspect_ratio, duration: int 1–15, resolution: 720p}` | 6, 10, 15 s | yes |
| `fal:seedance-2` | `bytedance/seedance-2.0/text-to-video` | `{prompt, aspect_ratio, duration: "4"–"15" (string), resolution: 720p, generate_audio: true}` | 5, 8, 10, 15 s | yes |
| `fal:veo-3.1-fast` | `fal-ai/veo3.1/fast` | `{prompt, aspect_ratio: 16:9/9:16, duration: "4s"/"6s"/"8s", resolution: 720p, generate_audio: true}` | 4, 6, 8 s | yes |
| `replicate:p-video` | `prunaai/p-video` | `{prompt, duration, aspect_ratio, resolution: 720p}` | 5, 8, 10 s | no |
| `replicate:minimax-h3` | `minimax/h3` | `{prompt, duration 4–15, resolution: "768P", ratio: "16:9"}` | 5, 10 s | unknown |
| `replicate:veo-3.1-fast` | `google/veo-3.1-fast` | `{prompt, duration 4/6/8, aspect_ratio, resolution: 720p, generate_audio: true}` | 4, 6, 8 s | yes |
| `gemini:omni` | `gemini-omni-1.1-flash` | Interactions API, `response_format: {type: video, aspect_ratio, resolution: 720p}` | 4, 6, 8 s | yes |

### How each provider is called

- **fal.ai queue:**
  1. `POST https://queue.fal.run/{model}` with header `Authorization: Key $FAL_KEY` returns `request_id`, `status_url` and `response_url`.
  2. Poll `GET status_url` until it reports `IN_QUEUE`, then `IN_PROGRESS`, then `COMPLETED`. A failed job comes back `COMPLETED` with an `error` field.
  3. `GET response_url` for the result.
  4. Status and result URLs use only `owner/app` of the model ID. Alembic follows the returned URLs.
  5. Code: `lib/providers/fal.js`.
- **Cloudflare Workers AI:** `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}` with `Authorization: Bearer $CLOUDFLARE_API_TOKEN`. The response is `{result: {image: base64}, success}`.
- **Replicate:** `POST /v1/models/{owner}/{name}/predictions`.
  - Images add the header `Prefer: wait=60`.
  - Video polls `GET /v1/predictions/{id}`.
  - Output is a URL string or an array of URLs.
- **Gemini Files API** (summaries of whole videos and audio):
  1. `POST /upload/v1beta/files` with these headers:
     - `X-Goog-Upload-Protocol: resumable`
     - `X-Goog-Upload-Command: start`
     - `X-Goog-Upload-Header-Content-Length`
     - `X-Goog-Upload-Header-Content-Type`

     The upload URL comes back in the `x-goog-upload-url` response header.
  2. `POST` the bytes to that URL with `X-Goog-Upload-Offset: 0` and `X-Goog-Upload-Command: upload, finalize`.
  3. Poll `GET /v1beta/files/{id}` until `state` is `ACTIVE`.
  4. Limits: 2 GB per file, 20 GB per project, files kept 48 h. Use the Files API whenever a request would exceed 100 MB.
  5. Code: `lib/providers/files.js` streams the browser's upload straight through and does not buffer it.

Documentation (checked 6 Nov 2026):

- fal queue: <https://docs.fal.ai/model-apis/model-endpoints/queue>
- fal FLUX Schnell: <https://fal.ai/docs/model-api-reference/image-generation-api/flux-schnell>
- fal Seedream 5 Lite: <https://fal.ai/models/fal-ai/bytedance/seedream/v5/lite/text-to-image/api>
- fal Grok Imagine Video: <https://fal.ai/models/xai/grok-imagine-video/text-to-video/llms.txt>
- fal Seedance 2.0: <https://fal.ai/models/bytedance/seedance-2.0/text-to-video/api>
- fal Veo 3.1 Fast: <https://fal.ai/models/fal-ai/veo3.1/fast/api>
- Cloudflare Lucid Origin: <https://developers.cloudflare.com/workers-ai/models/lucid-origin>
- Cloudflare FLUX.1 Schnell: <https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/>
- Gemini Files API: <https://ai.google.dev/gemini-api/docs/files>
- Replicate FLUX.2 Pro: <https://replicate.com/black-forest-labs/flux-2-pro>
- Replicate MiniMax H3: <https://replicate.com/minimax/h3> and <https://replicate.com/blog/which-minimax-h3-model>
- Replicate P-Video: <https://replicate.com/prunaai/p-video>
- Replicate Veo 3.1 Fast: <https://replicate.com/google/veo-3.1-fast>

Prices seen on 5–6 Nov 2026 (they change; check before relying on them):

- P-Video: $0.02 per second at 720p.
- MiniMax H3: $0.08 per second at 768P.
- FLUX.2 Pro: $0.015 + $0.015 per megapixel, so about $0.03 for a 1 MP image.
- Cloudflare Lucid Origin: $0.007 per 512×512 tile plus $0.000132 per step, after the free daily allowance.
- Cloudflare's own Grok Imagine Video: $0.05–$0.07 per second.
- Anything not listed: check the provider's pricing page.

## 5. How a request flows

- **Built-in image (any mode):**
  1. `app.js Img.generate` calls `A.engines.run(engine, ctx)`.
  2. A `LOCAL` engine in `engines.js` asks the text AI for SVG (`vector.js`) or GLSL (`shader.js`).
  3. The browser renders it.
  4. The result is `{kind, blob, mime, ext, extras}`.
- **Server image:** `A.ai.image` → `POST /api/ai/image` → `generateImage` in `image.js`. The response is base64.
- **Built-in video:**
  1. The engine asks for a JSON scene, a story or GLSL.
  2. It draws frames on a canvas.
  3. `motion.js recordCanvas` captures the canvas and the `music.js` audio track with MediaRecorder, in real time.
- **Server video:**
  1. `POST /api/ai/video` starts a job and returns 202 with `{id}`.
  2. The browser polls `GET /api/ai/video/:id` every 4 s.
  3. When the job finishes, the browser fetches `api/files/:id`.
  4. Jobs live in memory; files stay in the OS temp folder for 2 hours.
- **Summary:**
  1. `readers.js` turns a file into a digest. Spreadsheets get exact statistics; PDFs get `[Page n]` markers; scanned PDFs and photos are sent as images; videos become frames, or the whole file is uploaded when the server has Gemini.
  2. `summary.js` builds the prompt and calls `A.ai.text`.
  3. Answers are cached per mode, length and language.
  4. Chat sends `[file context, short assistant reply, …history, question]`, so turns always alternate.

## 6. Known issues and limits

- Built-in clips record in real time. A hidden tab throttles animation and can stall the recording. **Idea:** warn when `document.hidden`.
- Video jobs are kept in memory, so a server restart loses running jobs. Pressing **Stop** in the browser does not cancel the provider job, which may still be billed. **Fix:** see roadmap P1.
- Server mode does not stream text (summaries appear all at once). The Claude preview does stream.
- The rate limiter is in memory, per IP, and trusts `X-Forwarded-For`. That is fine behind Render's proxy but can be spoofed on a bare VPS.
- `ACCESS_CODE` is one shared secret, not user accounts.
- The Pollinations free engine throttle is global to the server, not per visitor.
- In the Claude preview the real models are locked: the artifact's CSP blocks external calls. Video summaries there use frames only, and audio is not supported.

## 7. Roadmap

**P0: make it real (first session)**

1. Run `npm test` and `npm run test:e2e`.
2. Verify each provider that has a key, cheapest call first (section 8). Fix mismatches and update `test/mock_providers.mjs` and the assertions to match the real responses.
3. Deploy to Render with `ACCESS_CODE` and spending limits.
4. Run the browser tests in Safari and Firefox, or fix whatever a manual check finds.

**P1: features that build on what exists**

1. **Cancel provider jobs on Stop.** Add `DELETE /api/ai/video/:id`.
   - fal: send `PUT` to the job's `cancel_url`.
   - Replicate: `POST /v1/predictions/{id}/cancel`.
   - The browser calls it from the Stop button.
2. **Real "Make it move".**
   - Use image-to-video with the generated image: `fal-ai/veo3.1/fast/image-to-video` takes `{prompt, image_url, aspect_ratio: auto, duration, resolution, generate_audio}`. Seedance and Grok have image-to-video endpoints too.
   - First check whether `image_url` accepts a data URI; if not, upload to fal storage.
3. **Stream text in server mode.** Add an SSE route, for example `/api/ai/text?stream=1`.
   - Gemini: `streamGenerateContent?alt=sse`.
   - Anthropic: `stream: true`.
   - OpenAI Responses: `stream: true`.
   - Feed the stream to `onText` in `core.js`.
4. **Gallery that survives reloads.** Store items in IndexedDB, add "My creations" with delete, and a "download all" zip (JSZip is already loaded on demand).
5. **Cost hints.** Add a `price` field to catalog entries, show it on engine cards, and add an optional server budget guard such as `MAX_SPEND_PER_DAY`.
6. **Image options.** Seed, negative prompt, and four variations where the model supports `num_images`.
7. **Summary extras.**
   - Export to DOCX or PDF.
   - Compare two files.
   - YouTube links through Gemini: check whether `file_data.file_uri` accepts YouTube URLs.
   - Chunked summaries for files longer than the 150,000-character cap.
8. **More engines.**
   - Cloudflare's `xai/grok-imagine-video`: schema seen on 6 Nov 2026; async behaviour unknown.
   - Replicate `bytedance/seedream-5-lite`, `black-forest-labs/flux-2-max`, `kwaivgi/kling-v3-omni-video`.

**P2: bigger steps**

- Accounts (an OAuth provider) and cloud storage for creations.
- Per-user quotas instead of one access code.
- Playwright UI tests in CI.
- Interface translations (Hindi, Telugu, …) to match the summary languages.

## 8. First session checklist

1. `node -v` should be 18.17 or newer. Run `npm test`; it should pass with no network.
2. `cp .env.example .env`. The owner pastes their own keys into `.env`; never ask for keys in chat.
3. `node server.js`, then open <http://localhost:3000> and check `/api/health`.
4. Live checks, cheapest first. Ask the owner before each paid one.
   - Gemini: summarize the bundled PDF sample (free tier).
   - Cloudflare: one Lucid Origin image (free daily allowance).
   - fal: one FLUX Schnell image (fractions of a cent).
   - Video: one 5 s clip on the cheapest engine available. P-Video at 720p is about $0.10.
   - Gemini video summary: upload a short MP4 (Files API is free; the summary costs text tokens).
5. For each mismatch:
   1. Fix the input mapping in `image.js` or `video.js`.
   2. Update the fake in `test/mock_providers.mjs` and the assertion in `test/test_server.mjs`.
   3. Run `npm test`.
   4. Commit on a branch and open a PR.
6. To refresh the Claude preview, run `npm run build:artifact` and publish `dist/alembic.html` from a Claude chat.

## 9. Prompt to start a Claude Code session

Paste this into Claude Code after opening the repository:

```text
You are continuing work on Alembic, a zero-dependency Node + vanilla JS web app with an
AI Image studio, an AI Video studio (several engines each) and an AI Summary tool.
First read CLAUDE.md and HANDOFF.md in full. Then:

1. Run `npm test` and tell me the result.
2. Help me create .env from .env.example. I will paste my keys into the file myself;
   do not ask me to paste keys into the chat.
3. Start the server and check /api/health. For every provider whose key is set,
   verify the real API with the cheapest possible call. Ask me before each call that
   costs money, and tell me the rough cost. Fix any request/response mismatch in
   lib/providers/*, and update test/mock_providers.mjs and test/test_server.mjs so the
   fakes match reality. Re-run `npm test` after each fix.
4. Help me deploy to Render using render.yaml, with ACCESS_CODE set.
5. Then work through the roadmap in HANDOFF.md section 7 (P0, then P1), one feature
   per branch and pull request, with tests and a screenshot of any UI change.

Rules: no new npm dependencies or frameworks without asking me; keep the app working
in server, artifact and static modes; never commit .env or print keys; do not push
to main or force-push without asking.
```

## 10. Putting the code on GitHub

With the GitHub CLI (`gh`), inside the unzipped folder:

```bash
git init -b main
git add .
git commit -m "Alembic 2.0: AI image + video studios, AI summary"
gh repo create alembic --private --source=. --push
```

Without `gh`: create an empty private repository named `alembic` on github.com, then:

```bash
git init -b main
git add .
git commit -m "Alembic 2.0: AI image + video studios, AI summary"
git remote add origin https://github.com/YOUR-USERNAME/alembic.git
git push -u origin main
```

`.env` is in `.gitignore`, so keys are never uploaded. Check with `git status` before the first
commit: `.env` must not be listed.
