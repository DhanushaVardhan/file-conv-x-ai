# Alembic: handoff notes

Last updated **6 November 2026** at version **2.1.0**, by a Claude Code session working in the
GitHub repository `DhanushaVardhan/file-conv-x-ai`, on branch `ccr-326d7540-dthjis`. Version 2.0.0
was built in a Claude chat.

Read `CLAUDE.md` first for the rules and commands. This file covers the history, the honest
status, the provider reference and the roadmap.

---

## 1. Where the project came from

**Version 1** (5 Nov 2026) was a file converter (PDF→Word, MP4→MP3, images→PDF, …). It also had
AI image and AI video pages and a few AI tools.

**Version 2** (6 Nov 2026, Claude chat) followed this request from the owner, quoted as written:

> "so first of all, remove the file convertor and all, and keep only the ai image and video
> generators, got it, and also, you can keep the ai summary of any file, example pdf, word ,
> excel , or image, or video also , like this..!! and the ai image and ai video , try to be more
> good, it is only using one engine as of now, try to include 2 or 3 more engines , and if i
> wanted to do all this in claude code, and i connected my github also, so pls give me, long
> detailed text, so that, it can continue from where it stopped..!!"

| Asked | Done in 2.0 |
|---|---|
| Remove the converters | All converter code, pdf-lib and lamejs are gone. |
| Keep AI image and video | Rebuilt as two studios with engine cards. |
| More engines (2–3 more) | **Image:** 3 built-in + 10 server engines. **Video:** 3 built-in + 7 server engines. |
| "Try to be more good" | Prompt improver, "Surprise me", "Same prompt with…", generated soundtracks, "Make it move", history strip, native-format downloads. |
| AI summary of any file | PDF, Word, Excel/CSV, PowerPoint, images, video, audio, text and code. Five styles, three lengths, 11 languages, and follow-up chat. |
| Long handoff text for Claude Code | This file, `CLAUDE.md`, and a kickoff prompt. |

**Version 2.1** (6 Nov 2026, Claude Code) followed the 2.0 kickoff prompt. The owner pasted the
chat and attached `alembic-v2.zip`.

| Kickoff step | Result |
|---|---|
| Put the code on GitHub | Imported unchanged as the first commit (`51cae26`). The repository was empty, so the working branch `ccr-326d7540-dthjis` became its **default branch**. At the owner's request the same code was then pushed as `main` (section 10). |
| 1. Run the tests | The 2.0 code passed all three suites (67 server, 39 UI, 14 end-to-end checks). |
| 2. Create `.env` | **Not possible in this session.** It ran in a Claude Code cloud container with no keys and no way for the owner to edit a file there. See section 8 for how to add keys. |
| 3. Verify real providers | **Not done**, because there were no keys. No real provider has been called yet. The request shapes were re-checked against provider docs instead (section 4). |
| 4. Deploy to Render | **Not done.** It needs the owner's Render account (section 8, step 6). `render.yaml` is ready and now sets `MAX_SPEND_PER_DAY=2`. |
| 5. Roadmap | P1.1–P1.5 are done, one commit each, with tests and screenshots. P1.6–P1.8 are still open. |

Commits in 2.1, oldest first:

| Commit | What |
|---|---|
| `88740ef` | **Stop cancels real-model video jobs** at fal.ai / Replicate (P1.1) |
| `c8b6a91` | **Streaming** of summaries and chat answers in server mode (P1.3) |
| `fc63435` | **My creations**: images and clips survive a reload (IndexedDB), with delete + undo, Download all (zip) and Clear (P1.4) |
| `b294474` | **Make it move animates the picture itself** with image-to-video models on fal (P1.2) |
| `bca84a5` | **Cost hints** on engine cards and Generate buttons, plus the `MAX_SPEND_PER_DAY` limit and a Veo removal warning (P1.5) |
| `0d86c04` | Fix: a skipped tab animation was reported as a page error |

## 2. Status at a glance

| Area | State | How it was checked |
|---|---|---|
| Image studio UI (cards, styles, shapes, history, downloads) | Done | Browser test, screenshots (desktop + 390 px dark) |
| Built-in image engines: Vector Illustrator, Shader Painter, Pixel Artist | Done | Browser test with a fake Claude (incl. the shader compile-fix loop) |
| Built-in video engines: Motion Graphics, Shader Film, Story Reel + soundtrack | Done | Browser test: real MediaRecorder output, audio track present |
| Server image engines (fal ×2, Cloudflare ×2, Replicate ×2, OpenAI, Gemini, Pollinations ×2) | Code done | Server tests against **fake** providers only |
| Server video engines (fal ×3, Replicate ×3, Gemini) | Code done | Server tests against **fake** providers only |
| **Stop cancels the provider job** (fal `PUT cancel_url`, Replicate `POST …/cancel`) | Done (2.1) | Server tests per provider + end-to-end Stop test, against fakes |
| **Make it move: image-to-video** (fal Grok, Seedance, Veo) | Code done (2.1) | Server tests for all three + end-to-end flow, against fakes |
| **Streaming text in server mode** (Gemini, Claude, OpenAI) | Code done (2.1) | Server tests per provider (incl. mid-stream error, client leaving) + end-to-end, against fakes |
| **My creations** (IndexedDB gallery, delete/undo, zip, clear) | Done (2.1) | Browser test: reload restores, delete/undo, zip contents, clear; screenshots |
| **Cost hints + `MAX_SPEND_PER_DAY`** | Done (2.1) | Server tests (limit, refunds, refusals) + end-to-end price labels |
| Summary: readers for every file type, prompts, cache, chat | Done | Browser test with the 3 bundled samples + photo + video + audio |
| Summary of whole videos/audio via Gemini Files API | Code done | Server test + end-to-end test against a **fake** Gemini |
| Access code, rate limit, CSP, range requests, path traversal guard | Done | Server tests |
| Claude artifact build (`dist/alembic.html`) | Done | Browser test runs this exact file |
| CI (GitHub Actions: syntax check + server tests) | Added | Pushed; whether it ran green on GitHub was not checked |
| Deployment (Render blueprint) | Config ready | Not deployed |

Test totals at 2.1.0: `npm test` 98 checks, `npm run test:ui` 40 checks, `npm run test:e2e` 21 checks.
All of them pass.

Screenshots of the 2.1 UI changes are made by `npm run test:ui -- --shots` and
`python3 test/e2e_server.py --shots` (saved in `test/shots/`, which is gitignored):
`gallery-desktop.png`, `gallery-mobile.png`, `make-it-move.png`, `make-it-move-mobile.png`.

## 3. Verified vs. not verified (read this before trusting anything)

**Verified:** everything the tests cover. The tests run against fakes (`test/mock_providers.mjs`)
that encode the request and response shapes from each provider's documentation. Docs were
checked on 6 Nov 2026; links are in section 4.

**Not verified, because no real API keys were available.** Highest risk first:

1. **No real provider has been called, in 2.0 or 2.1.** Every server engine may still have a
   field-name or value mismatch. Riskiest spots:
   - **Make it move sends the picture as a base64 data URI in `image_url`.** fal's CDN docs say
     "Some models also accept data URIs… URLs are the universal format" and advise against large
     data URIs. fal documents uploads only through its SDKs, not REST. The browser therefore
     sends a JPEG of at most 1280 px (about 100–300 KB). If a model refuses it, upload the
     picture somewhere public first, or find fal's REST upload route.
   - fal **Seedream 5 Lite**: `image_size` is sent as `{width, height}`. If refused, try `auto_2K`
     or the FLUX enum strings.
   - Replicate **MiniMax H3**: `ratio: "16:9"` only, and no audio, are both assumptions.
   - **Gemini Omni** video and **Nano Banana** image use the Interactions API (needs billing).
   - **Streaming formats.** Claude's events were checked against its docs. Gemini's
     `streamGenerateContent?alt=sse` is documented, but its exact event body is not; Alembic
     expects one `data:` line per GenerateContentResponse chunk. OpenAI's docs refused the
     automated fetch, so `response.output_text.delta` / `response.completed` /
     `response.failed` come from memory. If streaming misbehaves, test with `stream: false` (the
     old path still works) and compare.
   - **Cancel.** fal's cancel codes are from its queue docs (200 queued, 202 running,
     400 `ALREADY_COMPLETED`). Replicate's docs do not show what `/cancel` returns; Alembic
     treats any status other than succeeded/failed as cancelled.
   - Text model IDs `gemini-3.5-flash-lite`, `claude-haiku-5-5`, `gpt-6-luna` and the image/video
     model IDs all came from earlier research. Each can be overridden in `.env`.
2. **fal says Veo 3.1 Fast (`fal-ai/veo3.1/fast`) will be removed on 17 November 2026.** The
   engine shows a warning. After that date, remove it from `lib/catalog.js` or point
   `FAL_VEO_MODEL` / `FAL_VEO_I2V_MODEL` at the successor.
3. **Prices** (section 4) come from the provider pages on 6 Nov 2026. Seedance 2.0's page quotes
   both $0.3034/s and a per-token price that disagree. Replicate FLUX Schnell, Replicate Veo,
   GPT Image, Nano Banana, Gemini Omni and Pollinations FLUX show no price in the app because
   none was found.
4. **Browsers other than Chromium were not tested** (only Chromium is installed in the cloud
   container):
   - Chrome records H.264/AAC MP4. Chromium-only builds record VP9/Opus in MP4, which iOS cannot
     play.
   - Safari 17+ records MP4. Firefox records WEBM.
   - Shader engines need WebGL 2.
5. **Real Claude artifact runtime:** tested with a stand-in. In particular, nobody knows yet
   whether IndexedDB works inside a published artifact. My creations fails soft ("this session
   only") if it does not.

## 4. Engine and provider reference

All IDs can be changed with the env var named in `lib/catalog.js` (also listed in `.env.example`).

### Image engines (`lib/catalog.js` → `IMAGE_ENGINES`)

| id | Model | Request Alembic sends | Price shown (6 Nov 2026) |
|---|---|---|---|
| `fal:flux-schnell` | `fal-ai/flux/schnell` | `{prompt, image_size: square_hd/landscape_16_9/portrait_16_9/landscape_4_3, num_inference_steps: 4, output_format: jpeg}` | $0.003/MP rounded up → about $0.006 |
| `fal:seedream` | `fal-ai/bytedance/seedream/v5/lite/text-to-image` | `{prompt, image_size: {width, height}}`: 2048², 2560×1440, 1440×2560, 2304×1728 | $0.035 |
| `cloudflare:lucid` | `@cf/leonardo/lucid-origin` | `{prompt, width, height}`: 1024², 1344×768, 768×1344, 1280×960 | about $0.03 after 10,000 free neurons/day |
| `cloudflare:flux` | `@cf/black-forest-labs/flux-1-schnell` | `{prompt, steps: 6}` (square only) | about $0.001 after the free allowance |
| `replicate:flux-2-pro` | `black-forest-labs/flux-2-pro` | `{prompt, aspect_ratio, resolution: "1 MP", output_format: webp}` | about $0.03 (seen 5 Nov) |
| `replicate:flux-schnell` | `black-forest-labs/flux-schnell` | `{prompt, aspect_ratio, num_outputs: 1, output_format: webp, go_fast}` | none found |
| `openai:gpt-image` | `gpt-image-2.5-flare` | `/v1/images/generations` `{size, quality: medium}` | none found |
| `gemini:nano-banana` | `gemini-nano-banana-2.1` | Interactions API, `response_format: {type: image, aspect_ratio}` | none found |
| `pollinations:flux` | `flux` | `GET /image/{prompt}?model&width&height&seed`, Bearer key | none found |
| `pollinations:free` | keyless classic endpoint | 768 px, one image per 45 s per server | free |

### Video engines (`VIDEO_ENGINES`)

| id | Text-to-video model | Image-to-video model (Make it move) | Lengths | Sound | Price shown |
|---|---|---|---|---|---|
| `fal:grok-video` | `xai/grok-imagine-video/text-to-video` | `xai/grok-imagine-video/image-to-video` | 6, 10, 15 s | yes | $0.07/s (720p) |
| `fal:seedance-2` | `bytedance/seedance-2.0/text-to-video` | `bytedance/seedance-2.0/image-to-video` | 5, 8, 10, 15 s | yes | $0.3034/s (720p + audio) |
| `fal:veo-3.1-fast` | `fal-ai/veo3.1/fast` | `fal-ai/veo3.1/fast/image-to-video` | 4, 6, 8 s | yes | $0.15/s with audio; **removed 17 Nov 2026** |
| `replicate:p-video` | `prunaai/p-video` | — | 5, 8, 10 s | no | $0.02/s (720p) |
| `replicate:minimax-h3` | `minimax/h3` | — | 5, 10 s | unknown | $0.08/s (768P) |
| `replicate:veo-3.1-fast` | `google/veo-3.1-fast` | — | 4, 6, 8 s | yes | none found |
| `gemini:omni` | `gemini-omni-1.1-flash` | — | 4, 6, 8 s | yes | none found |

Text-to-video inputs:

- Grok: `{prompt, aspect_ratio, duration: int, resolution: 720p}`
- Seedance: `{prompt, aspect_ratio, duration: "8" (string), resolution: 720p, generate_audio: true}`
- Veo: `{prompt, aspect_ratio: 16:9/9:16, duration: "6s", resolution: 720p, generate_audio: true}`
- P-Video: `{prompt, duration, aspect_ratio, resolution: 720p}`
- MiniMax H3: `{prompt, duration, resolution: "768P", ratio}`
- Replicate Veo: `{prompt, duration, aspect_ratio, resolution: 720p, generate_audio: true}`

Image-to-video inputs (`falImageVideoInput` in `video.js`) are the same plus
`image_url: "data:image/jpeg;base64,…"` and `aspect_ratio: "auto"`, so the clip keeps the
picture's shape. From the fal model pages:

- Veo i2v also takes `resolution` 720p/1080p/4k, `negative_prompt`, `seed`, `auto_fix` and `safety_tolerance`.
- Seedance i2v takes `end_image_url` (max 30 MB per image).
- Grok i2v has no audio field.

Replicate image-to-video field names could not be read without a token. Get them from
`GET /v1/models/{owner}/{name}` → `latest_version.openapi_schema`.

### How each provider is called

- **fal.ai queue** (`lib/providers/fal.js`):
  1. `POST https://queue.fal.run/{model}` with `Authorization: Key $FAL_KEY`. It returns
     `request_id`, `status_url`, `response_url`, `cancel_url` and `queue_position`.
  2. Poll `status_url` (`IN_QUEUE` → `IN_PROGRESS` → `COMPLETED`). A failed job comes back
     `COMPLETED` with `error` and `error_type`.
  3. `GET response_url`.
  4. **Cancel:** `PUT cancel_url`. 200 `{status: OK}` means it was queued and removed. 202
     `CANCELLATION_REQUESTED` means it was running and may still finish. 400 `ALREADY_COMPLETED`
     and 404 `NOT_FOUND` mean too late or unknown.
  5. Follow-up URLs use only `owner/app` of the model ID; Alembic follows the returned URLs.
- **Cloudflare Workers AI:** `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}`
  with `Authorization: Bearer $CLOUDFLARE_API_TOKEN`. The response is `{result: {image: base64}, success}`.
- **Replicate:**
  1. `POST /v1/models/{owner}/{name}/predictions` (images add `Prefer: wait=60`).
  2. Poll `GET /v1/predictions/{id}`.
  3. **Cancel:** `POST /v1/predictions/{id}/cancel`.
  4. Statuses: `starting`, `processing`, `succeeded`, `failed`, `canceled`.
- **Text streaming** (`lib/providers/text.js` `streamText`):
  - Gemini: `:streamGenerateContent?alt=sse` (thought parts skipped).
  - Claude: `stream: true`, `content_block_delta` with `text_delta` (thinking deltas skipped,
    `event: error` handled).
  - OpenAI Responses: `stream: true`, `response.output_text.delta`, `response.failed`, `error`.
- **Gemini Files API** (summaries of whole videos/audio, `lib/providers/files.js`): resumable
  upload, then poll `files/{id}` until `ACTIVE`, then use `file_data: {mime_type, file_uri}`.
  Limits are 2 GB per file and 20 GB per project; files are kept 48 h.

Documentation (checked 6 Nov 2026):

- fal queue: <https://fal.ai/docs/documentation/model-apis/inference/queue.md>
- fal CDN and data URIs: <https://fal.ai/docs/documentation/model-apis/fal-cdn.md>
- fal model pages: `https://fal.ai/models/{model}` and `…/llms.txt`, for example
  <https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video/llms.txt>
- Replicate HTTP API: <https://replicate.com/docs/reference/http>
- Claude streaming: <https://platform.claude.com/docs/en/build-with-claude/streaming>
- Gemini streaming: <https://aistudio.google.com/api-reference/generate-content/stream-generate-content>
- Cloudflare Workers AI pricing (10,000 free neurons/day): <https://developers.cloudflare.com/workers-ai/platform/pricing/>
- Gemini Files API: <https://ai.google.dev/gemini-api/docs/files>

## 5. How a request flows

- **Built-in image/video:** `A.engines.run` → a `LOCAL` engine asks the text AI for SVG, GLSL or a
  scene → the browser renders or records it → `{kind, blob, mime, ext, extras}`.
- **Server image:**
  1. `POST /api/ai/image`.
  2. The spending limit sets aside the estimate.
  3. `generateImage` runs; the estimate is given back if it fails.
  4. The image comes back as base64.
- **Server video:**
  1. `POST /api/ai/video` (optionally with `image` for Make it move) returns 202 `{id}`.
  2. The browser polls `GET /api/ai/video/:id` every 4 s, then fetches `api/files/:id`.
  3. **Stop** sends `DELETE /api/ai/video/:id`, which aborts polling and downloads and calls the
     provider's cancel. If the job is still being submitted, the server waits up to 10 s for its
     ID. The reply's `providerCanceled` drives the message the person sees.
  4. Jobs live in memory; files stay in the OS temp folder for 2 hours.
- **Summary:**
  1. `readers.js` turns a file into a digest.
  2. `summary.js` builds the prompt.
  3. `A.ai.text` with `onText` streams. In server mode it POSTs `stream: true` and reads
     `delta` / `done` / `error` events.
  4. Answers are cached per mode, length and language.
- **My creations:**
  - Every new item goes to `Gallery.add` (`app.js`), then `A.gallery.put` (`gallery.js`,
    IndexedDB database `alembic`, store `creations`).
  - On load, `Gallery.init` restores both studios, newest on stage.
  - Up to 40 per studio are kept.

## 6. Known issues and limits

- Built-in clips record in real time; a hidden tab throttles animation and can stall the
  recording. **Idea:** warn when `document.hidden`.
- Video jobs, the rate limiter and the spending total are in memory, per server process. A
  restart loses running jobs and resets the day's spend. Several instances would not share them.
- `MAX_SPEND_PER_DAY` uses list-price estimates:
  - Unknown prices count as $0.05 an image or $0.20 a second.
  - A stopped clip is not given back, because the provider may bill part of it.
  - Text AI calls are not counted.
- The rate limiter trusts `X-Forwarded-For`. That is fine behind Render's proxy; it can be spoofed
  on a bare VPS.
- `ACCESS_CODE` is one shared secret, not user accounts.
- The Pollinations free engine's throttle is global to the server.
- In the Claude preview the real models are locked (artifact CSP), video summaries use frames
  only, and audio is not supported.
- My creations lives in one browser. A second tab does not see the first tab's deletes until it
  reloads.

## 7. Roadmap

**P0: make it real (still open, needs the owner)**

1. Add keys (section 8) and verify each provider, cheapest call first. Start with the riskiest
   items in section 3: Make it move's data URI, streaming, cancel and Seedream's size. Fix
   mismatches, then update `test/mock_providers.mjs` and the assertions to match the real
   responses.
2. Deploy to Render with `ACCESS_CODE` and `MAX_SPEND_PER_DAY` (section 8, step 6).
3. Manual pass in Safari (macOS/iOS) and Firefox. Only Chromium runs in the cloud container.
4. Before 17 Nov 2026: replace or remove fal Veo 3.1 Fast.

**P1: done in 2.1:** cancel on Stop (P1.1), real Make it move (P1.2), streaming (P1.3), gallery
(P1.4), cost hints and budget guard (P1.5).

**P1: still open**

6. **Image options.**
   - Seed: fal FLUX Schnell has `seed`; Seedream 5 Lite has **no** seed input; Lucid Origin has
     `seed`; Cloudflare FLUX shows `seed` only in examples.
   - Several images: FLUX Schnell `num_images` 1–4; Seedream `num_images` 1–6.
   - Replicate schemas need a token to read.
   - Multiply the cost estimate by the number of images.
7. **Summary extras.**
   - Export to DOCX. Plan: render the Markdown with `A.markdown.render`, walk that HTML, and write
     `word/document.xml` + styles + numbering with JSZip. That needs no new dependency.
   - Compare two files.
   - YouTube links through Gemini `file_data.file_uri`.
   - Chunked summaries for files over 150,000 characters. `readers.js` `clip()` cuts at
     `MAX_TEXT`, so keep the full text, summarize parts, then combine.
8. **More engines:** Cloudflare `xai/grok-imagine-video`; Replicate `bytedance/seedream-5-lite`,
   `black-forest-labs/flux-2-max`, `kwaivgi/kling-v3-omni-video`; a successor for Veo 3.1 Fast.
9. **Make it move on Replicate and Gemini**, once their image-input field names are known.
10. Warn when the tab is hidden while a built-in clip records.

**P2: bigger steps**

- Accounts (an OAuth provider) and cloud storage for creations.
- Per-user quotas instead of one access code.
- Playwright UI tests in CI.
- Interface translations (Hindi, Telugu, …) to match the summary languages.

## 8. First session checklist

1. `node -v` must be 18.17 or newer. Run `npm test`; it passes with no network.
2. **Keys.** Never paste keys into a chat. Never commit them.
   - **On your own computer:** `cp .env.example .env` and paste the keys into `.env`.
   - **In a Claude Code cloud session (claude.ai/code):**
     1. Open the environment menu in the session's title bar and choose **Edit**.
     2. Add each key as an environment variable, for example `GEMINI_API_KEY` or `FAL_KEY`.
     3. Start a new session; real environment variables win over `.env`.
     4. The environment's network policy must also allow the provider hosts
        (`generativelanguage.googleapis.com`, `queue.fal.run`, `api.replicate.com`,
        `api.cloudflare.com`, …).
3. `node server.js`, then check <http://localhost:3000/api/health>. Each engine you expect should
   say `available: true`.
4. Live checks, cheapest first. Ask the owner before each paid call.
   - Gemini summary of the bundled PDF: free tier.
   - One Lucid Origin image: free daily allowance.
   - One fal FLUX Schnell image: about $0.006.
   - One 5 s P-Video clip: about $0.10.
   - One Make it move with Grok Imagine Video: 6 s, about $0.42.
   - One streamed summary per text provider you have.
5. For each mismatch:
   1. Fix the input mapping in `image.js` / `video.js` / `text.js`.
   2. Update `test/mock_providers.mjs` and `test/test_server.mjs`.
   3. Run `npm test`, then commit.
6. **Render:**
   1. Go to <https://render.com>, then **New → Blueprint**, and pick this repository.
   2. `render.yaml` deploys the `main` branch.
   3. Enter the keys you have, plus `ACCESS_CODE`, when Render asks.
   4. `MAX_SPEND_PER_DAY` defaults to 2 (USD).
   5. Free instances sleep after 15 minutes without visitors.
7. To refresh the Claude preview, run `npm run build:artifact` and publish `dist/alembic.html`
   from a Claude chat.
8. **Browser tests in a cloud container.**
   - Python Playwright is not installed there, but Chromium is (`/opt/pw-browsers`).
   - Create a venv: `python3 -m venv /tmp/pw && /tmp/pw/bin/pip install playwright==<version of the
     preinstalled Node playwright>`. In this session that version was 1.63.0.
   - Run with `PATH=/tmp/pw/bin:$PATH npm run test:ui`.
   - Never run `playwright install`.

## 9. Prompt to start the next Claude Code session

```text
You are continuing work on Alembic (repo DhanushaVardhan/file-conv-x-ai), a zero-dependency
Node + vanilla JS web app with an AI Image studio, an AI Video studio (several engines each)
and an AI Summary tool. Version 2.1.0. First read CLAUDE.md and HANDOFF.md in full. Then:

1. Run `npm test`, `npm run test:ui` and `npm run test:e2e` and tell me the results
   (HANDOFF.md section 8 explains browser tests in a cloud container).
2. Check /api/health. For every provider whose key is set (I add keys myself as environment
   variables or in .env; never ask me to paste keys into the chat), verify the real API with
   the cheapest possible call, riskiest items from HANDOFF.md section 3 first. Ask me before
   each call that costs money and tell me the rough cost. Fix any request/response mismatch
   and update test/mock_providers.mjs and test/test_server.mjs to match reality.
3. Before 17 Nov 2026, replace or remove fal Veo 3.1 Fast (HANDOFF.md section 3).
4. Then continue the roadmap in HANDOFF.md section 7 (open P1 items in order), one feature
   per commit with tests and a screenshot of any UI change, and keep HANDOFF.md current.

Rules: no new npm dependencies or frameworks without asking me; keep the app working in
server, artifact and static modes; never commit .env or print keys; do not push to main or
force-push without asking.
```

## 10. Where the code is on GitHub

- Repository: <https://github.com/DhanushaVardhan/file-conv-x-ai>. It is **public**, so never
  commit keys.
- `main` holds the current code. It was pushed at the owner's request on 6 Nov 2026.
- The first pushed branch, `ccr-326d7540-dthjis`, stays GitHub's default branch until the owner
  switches it: **Settings → General → Default branch → `main`**.
- Claude Code sessions work on their own branch; ask before pushing to `main`.
- API keys never go on GitHub. README section 3 says where they go.
- `.env` is in `.gitignore`, so keys never get uploaded. Check with `git status` before
  committing: `.env` must not be listed.
- CI (`.github/workflows/test.yml`) runs the syntax check and `npm test` on every push and pull
  request.
