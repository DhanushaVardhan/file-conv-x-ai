// Server tests against fake providers. Run: node test/test_server.mjs
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { MOCK, log, ready, close } from './mock_providers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MP4 = readFileSync(new URL('./fixtures/clip.mp4', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLEAR = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'REPLICATE_API_TOKEN', 'FAL_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'POLLINATIONS_API_KEY', 'GEMINI_BILLING', 'TEXT_PROVIDER', 'IMAGE_PROVIDER', 'VIDEO_PROVIDER', 'ACCESS_CODE'];
const baseEnv = {
  ...process.env,
  ...Object.fromEntries(CLEAR.map((k) => [k, ''])),
  GEMINI_BASE_URL: MOCK, ANTHROPIC_BASE_URL: MOCK, OPENAI_BASE_URL: MOCK, REPLICATE_BASE_URL: MOCK,
  FAL_BASE_URL: MOCK + '/fal', CLOUDFLARE_BASE_URL: MOCK, POLLINATIONS_BASE_URL: MOCK, POLLINATIONS_FREE_BASE_URL: MOCK,
};
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };

async function withServer(env, port, fn) {
  const p = spawn('node', ['server.js'], { cwd: ROOT, env: { ...baseEnv, ...env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 50 && !out.includes('running'); i++) await sleep(100);
  const B = 'http://127.0.0.1:' + port;
  try { await fn(B, () => out); } catch (e) { failures++; console.log('  ✗ threw: ' + e.stack + '\n' + out); } finally { p.kill(); await sleep(150); }
}
const post = async (B, path, body, headers = {}) => {
  const r = await fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};
const get = async (B, path, headers = {}) => {
  const r = await fetch(B + path, { headers });
  return { status: r.status, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : null, r };
};
async function waitJob(B, id, headers = {}) {
  let st;
  for (let k = 0; k < 40; k++) {
    await sleep(500);
    st = (await get(B, '/api/ai/video/' + id, headers)).data;
    if (st.status === 'succeeded' || st.status === 'failed') break;
  }
  return st;
}
const del = async (B, path, headers = {}) => {
  const r = await fetch(B + path, { method: 'DELETE', headers });
  return { status: r.status, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : null };
};
const lastCall = (re) => [...log].reverse().find((l) => re.test(l.path) && l.method === 'POST');
const lastAny = (re) => [...log].reverse().find((l) => re.test(l.path));
const img = { mime: 'image/png', data: 'iVBORw0KGgo=' };
/** POST /api/ai/text with stream: true; returns status, content type, events, the final text and the joined deltas. */
async function streamCall(B, body, headers = {}) {
  const r = await fetch(B + '/api/ai/text', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ ...body, stream: true }) });
  const type = r.headers.get('content-type') || '';
  const raw = await r.text();
  if (!type.includes('event-stream')) return { status: r.status, type, data: JSON.parse(raw || '{}'), events: [], deltas: [] };
  const events = raw.split('\n\n').filter((b) => b.trim() && !b.startsWith(':')).map((b) => {
    const ev = /^event: (.*)$/m.exec(b);
    const da = /^data: (.*)$/m.exec(b);
    return { event: ev && ev[1], data: da ? JSON.parse(da[1]) : null };
  });
  const done = events.find((e) => e.event === 'done');
  const deltas = events.filter((e) => e.event === 'delta');
  return { status: r.status, type, events, deltas, text: done && done.data.text, joined: deltas.map((d) => d.data.text).join(''), error: (events.find((e) => e.event === 'error') || {}).data };
}
const avail = (h, kind) => h.engines[kind].filter((e) => e.available).map((e) => e.id).join();

await ready;

console.log('0. .env parsing');
{
  const { loadEnvFile } = await import('../lib/config.js');
  const { writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const f = tmpdir() + '/alembic-env-test';
  writeFileSync(f, 'ALEMBIC_T_EMPTY=        # https://example.com\nALEMBIC_T_VAL=abc  # note\nALEMBIC_T_Q="a # b"\n# ALEMBIC_T_OFF=1\n');
  loadEnvFile(f);
  rmSync(f);
  ok(process.env.ALEMBIC_T_EMPTY === '' && process.env.ALEMBIC_T_VAL === 'abc' && process.env.ALEMBIC_T_Q === 'a # b' && process.env.ALEMBIC_T_OFF === undefined, 'inline comments, quotes and commented-out lines');
}

console.log('A. No keys at all');
await withServer({}, 4101, async (B) => {
  const h = (await get(B, '/api/health')).data;
  ok(h.text === null, 'health: no text AI');
  ok(avail(h, 'image') === 'pollinations:free' && avail(h, 'video') === '', 'only the free demo image engine is available');
  const locked = h.engines.image.find((e) => e.id === 'fal:flux-schnell');
  ok(locked && !locked.available && locked.needs.join() === 'FAL_KEY' && locked.providerLabel === 'fal.ai', 'locked engines say which key unlocks them');
  ok(h.engines.video.length === 7 && h.engines.image.length === 10, 'catalog: 10 image + 7 video engines');
  const t = await post(B, '/api/ai/text', { prompt: 'hi' });
  ok(t.status === 503 && t.data.error.code === 'no_ai', 'text without key -> 503 no_ai');
  const i1 = await post(B, '/api/ai/image', { prompt: 'a fox', aspect: '16:9' });
  ok(i1.status === 200 && i1.data.images[0].data.length > 100, 'free image works');
  const i2 = await post(B, '/api/ai/image', { prompt: 'a fox', aspect: '16:9' });
  ok(i2.status === 429 && /45 seconds/.test(i2.data.error.message), 'free image throttled');
  const v = await post(B, '/api/ai/video', { prompt: 'x' });
  ok(v.status === 503, 'video without key -> 503');
  const up = await fetch(B + '/api/ai/upload', { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: MP4 });
  ok(up.status === 503, 'upload without Gemini -> 503');
  const page = await get(B, '/');
  ok(page.r.status === 200 && page.r.headers.get('content-security-policy')?.includes("script-src 'self' https://cdnjs.cloudflare.com"), 'index served with CSP');
  ok((await get(B, '/js/app.js')).r.headers.get('content-type').startsWith('text/javascript'), 'js served with JS mime');
  const trav = await fetch(B + '/%2e%2e/server.js');
  ok(trav.status === 403 || trav.status === 404, 'encoded traversal blocked (' + trav.status + ')');
  ok((await get(B, '/summary')).r.status === 200, 'unknown route falls back to the app');
});

console.log('B. Gemini text + files, Replicate + fal media, access code');
await withServer({ GEMINI_API_KEY: 'gk', REPLICATE_API_TOKEN: 'rt', FAL_KEY: 'fk', ACCESS_CODE: 'open sesame', AI_REQUESTS_PER_MINUTE: '100' }, 4102, async (B) => {
  const h = (await get(B, '/api/health')).data;
  ok(h.requiresAccessCode && h.text.provider === 'gemini' && h.text.media === true && h.text.maxUploadMB === 1024, 'health: gemini text that can watch video');
  ok(avail(h, 'image') === 'fal:flux-schnell,fal:seedream,replicate:flux-2-pro,replicate:flux-schnell', 'image engines: ' + avail(h, 'image'));
  ok(avail(h, 'video') === 'fal:grok-video,fal:seedance-2,fal:veo-3.1-fast,replicate:p-video,replicate:minimax-h3,replicate:veo-3.1-fast', 'video engines: ' + avail(h, 'video'));
  const no = await post(B, '/api/ai/text', { prompt: 'hi' });
  ok(no.status === 401 && no.data.error.code === 'access_code', 'missing access code -> 401');
  const H = { 'x-access-code': 'open sesame' };
  const t = await post(B, '/api/ai/text', { prompt: 'hi', images: [img] }, H);
  ok(t.status === 200 && t.data.text === 'gemini says hi (saw image)', 'gemini text with image, thought parts skipped');
  const j = await post(B, '/api/ai/text', { prompt: 'scene', json: true }, H);
  ok(j.status === 200 && JSON.parse(j.data.text).title === 'mock', 'gemini json mode');
  const chat = await post(B, '/api/ai/text', { messages: [{ role: 'user', content: 'context' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'question?' }] }, H);
  ok(chat.data.text === 'gemini says hi [3 turns: user/model/user]', 'chat turns mapped to gemini roles: ' + chat.data.text);
  const badChat = await post(B, '/api/ai/text', { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }, H);
  ok(badChat.status === 400, 'chat must end on a user turn');

  // Streaming (server-sent events)
  const s1 = await streamCall(B, { prompt: 'hi', images: [img] }, H);
  ok(s1.status === 200 && s1.type.startsWith('text/event-stream') && s1.deltas.length >= 2 && s1.text === 'gemini says hi (saw image)' && s1.joined === s1.text,
    'gemini streams in ' + s1.deltas.length + ' pieces, thoughts skipped: ' + s1.text);
  const sc = lastAny(/streamGenerateContent$/);
  ok(sc && sc.search === '?alt=sse' && sc.body.contents[0].parts.some((p) => p.inline_data), 'gemini stream uses streamGenerateContent?alt=sse');
  const s2 = await streamCall(B, { messages: [{ role: 'user', content: 'context' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'question?' }] }, H);
  ok(s2.text === 'gemini says hi [3 turns: user/model/user]', 'streamed chat keeps the turns: ' + s2.text);
  const s3 = await streamCall(B, { prompt: 'break please' }, H);
  ok(s3.status === 200 && s3.error && s3.error.error.code === 'upstream_error' && s3.deltas.length === 1 && !s3.text, 'a provider error mid-stream arrives as an error event: ' + (s3.error && s3.error.error.message));
  const s4 = await streamCall(B, { prompt: 'hi' });
  ok(s4.status === 401 && s4.data.error.code === 'access_code', 'streaming needs the access code too');
  const s5 = await streamCall(B, { prompt: 'scene', json: true }, H);
  ok(s5.status === 200 && s5.type.includes('json') && JSON.parse(s5.data.text).title === 'mock', 'json requests are never streamed');
  const quit = new AbortController();
  const half = await fetch(B + '/api/ai/text', { method: 'POST', signal: quit.signal, headers: { 'content-type': 'application/json', ...H }, body: JSON.stringify({ prompt: 'hi', stream: true }) });
  const rd = half.body.getReader();
  await rd.read();
  quit.abort();
  await sleep(500);
  const after = await post(B, '/api/ai/text', { prompt: 'hi' }, H);
  ok(after.status === 200 && after.data.text === 'gemini says hi', 'the server shrugs off a browser that leaves mid-stream');

  // Gemini Files API upload
  const noCode = await fetch(B + '/api/ai/upload', { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: MP4 });
  ok(noCode.status === 401, 'upload needs the access code');
  const up = await fetch(B + '/api/ai/upload', { method: 'POST', headers: { ...H, 'content-type': 'video/mp4', 'x-file-name': encodeURIComponent('lecture 1.mp4') }, body: MP4 });
  const ref = await up.json();
  ok(up.status === 200 && ref.uri.startsWith(MOCK + '/v1beta/files/') && ref.mime === 'video/mp4' && ref.state === 'ACTIVE', 'upload streamed to Gemini and waited for ACTIVE: ' + JSON.stringify(ref).slice(0, 90));
  const start = lastCall(/^\/upload\/v1beta\/files$/);
  ok(start && start.body.file.display_name === 'lecture 1.mp4' && start.headers['x-goog-upload-header-content-length'] === String(MP4.length), 'resumable start sent size and name');
  const octet = await fetch(B + '/api/ai/upload', { method: 'POST', headers: { ...H, 'content-type': 'application/octet-stream', 'x-file-name': 'talk.mkv' }, body: MP4 });
  ok(octet.status === 200 && (await octet.json()).mime === 'video/x-matroska', 'type guessed from the file name when the browser sends none');
  const pdf = await fetch(B + '/api/ai/upload', { method: 'POST', headers: { ...H, 'content-type': 'application/pdf', 'x-file-name': 'a.pdf' }, body: Buffer.from('%PDF') });
  ok(pdf.status === 415, 'non-media upload refused');
  const watch = await post(B, '/api/ai/text', { prompt: 'summarize', files: [{ uri: ref.uri, mime: 'video/mp4' }] }, H);
  ok(watch.data.text === 'gemini says hi (watched video, media first)', 'text call references the uploaded file: ' + watch.data.text);
  const evil = await post(B, '/api/ai/text', { prompt: 'summarize', files: [{ uri: 'https://evil.example/x', mime: 'video/mp4' }] }, H);
  ok(evil.data.text === 'gemini says hi', 'foreign file URIs are dropped');

  // Images
  const i = await post(B, '/api/ai/image', { prompt: 'fox', aspect: '9:16', engine: 'replicate:flux-schnell' }, H);
  ok(i.status === 200 && i.data.images[0].mime === 'image/png', 'replicate flux schnell (array output)');
  const fl = lastCall(/flux-schnell\/predictions/);
  ok(fl && fl.headers.prefer === 'wait=60' && fl.body.input.aspect_ratio === '9:16', 'replicate called with Prefer: wait=60');
  const i2 = await post(B, '/api/ai/image', { prompt: 'fox', aspect: '4:3', engine: 'replicate:flux-2-pro' }, H);
  ok(i2.status === 200 && lastCall(/flux-2-pro/).body.input.resolution === '1 MP', 'replicate flux-2-pro (string output, 1 MP)');
  const f1 = await post(B, '/api/ai/image', { prompt: 'fox', aspect: '16:9', engine: 'fal:flux-schnell' }, H);
  ok(f1.status === 200 && f1.data.images[0].mime === 'image/png' && f1.data.model === 'FLUX.1 Schnell', 'fal flux image via queue');
  ok(lastCall(/^\/fal\/fal-ai\/flux\/schnell$/).body.image_size === 'landscape_16_9', 'fal flux 16:9 -> landscape_16_9');
  const f2 = await post(B, '/api/ai/image', { prompt: 'poster', aspect: '9:16', engine: 'fal:seedream' }, H);
  const sd = lastCall(/seedream/);
  ok(f2.status === 200 && sd.body.image_size.width === 1440 && sd.body.image_size.height === 2560, 'fal seedream custom 2K size');
  const f3 = await post(B, '/api/ai/image', { prompt: 'fail please', aspect: '1:1', engine: 'fal:flux-schnell' }, H);
  ok(f3.status === 502 && /safety filter/.test(f3.data.error.message), 'fal job error explained: ' + (f3.data.error && f3.data.error.message));

  // Videos
  const runs = [
    ['replicate:p-video', { aspect: '1:1', duration: 8 }, /p-video/, (bd) => bd.input.aspect_ratio === '1:1' && bd.input.duration === 8 && bd.input.resolution === '720p'],
    ['replicate:minimax-h3', { aspect: '9:16', duration: 10 }, /minimax\/h3/, (bd) => bd.input.ratio === '16:9' && bd.input.duration === 10 && bd.input.resolution === '768P'],
    ['replicate:veo-3.1-fast', { aspect: '1:1', duration: 7 }, /veo-3\.1-fast/, (bd) => bd.input.aspect_ratio === '16:9' && bd.input.duration === 4 && bd.input.generate_audio === true],
    ['fal:seedance-2', { aspect: '9:16', duration: 8 }, /^\/fal\/bytedance\/seedance/, (bd) => bd.duration === '8' && bd.aspect_ratio === '9:16' && bd.generate_audio === true],
    ['fal:veo-3.1-fast', { aspect: '9:16', duration: 6 }, /^\/fal\/fal-ai\/veo3\.1\/fast$/, (bd) => bd.duration === '6s' && bd.aspect_ratio === '9:16'],
    ['fal:grok-video', { aspect: '1:1', duration: 99 }, /^\/fal\/xai\/grok/, (bd) => bd.duration === 6 && bd.aspect_ratio === '1:1'],
  ];
  let firstUrl = null;
  for (const [engine, opts, re, check] of runs) {
    const v = await post(B, '/api/ai/video', { prompt: 'waves', engine, ...opts }, H);
    const st = v.status === 202 ? await waitJob(B, v.data.id, H) : { status: 'not started ' + JSON.stringify(v.data) };
    const call = lastCall(re);
    const body = call && call.body;
    ok(st.status === 'succeeded' && body && check(body), engine + ' video: ' + st.status + (st.error ? ' ' + st.error : '') + ' input ' + JSON.stringify(body && (body.input || body)).slice(0, 110));
    if (!firstUrl && st.url) firstUrl = st.url;
  }
  // Make it move: start a clip from a picture (image-to-video)
  const pic = { mime: 'image/png', data: readFileSync(new URL('./fixtures/logo.png', import.meta.url)).toString('base64') };
  ok(h.engines.video.filter((e) => e.fromImage).map((e) => e.id).join() === 'fal:grok-video,fal:seedance-2,fal:veo-3.1-fast', 'health marks the engines that can animate a picture');
  const i2vRuns = [
    ['fal:veo-3.1-fast', 6, /^\/fal\/fal-ai\/veo3\.1\/fast\/image-to-video$/, (bd) => bd.duration === '6s' && bd.generate_audio === true && bd.resolution === '720p'],
    ['fal:seedance-2', 8, /^\/fal\/bytedance\/seedance-2\.0\/image-to-video$/, (bd) => bd.duration === '8' && bd.generate_audio === true],
    ['fal:grok-video', 10, /^\/fal\/xai\/grok-imagine-video\/image-to-video$/, (bd) => bd.duration === 10],
  ];
  const started = await Promise.all(i2vRuns.map(([engine, duration]) => post(B, '/api/ai/video', { prompt: 'the boat drifts away', engine, aspect: '16:9', duration, image: pic }, H)));
  for (let k = 0; k < i2vRuns.length; k++) {
    const [engine, , re, check] = i2vRuns[k];
    const v = started[k];
    const st = v.status === 202 ? await waitJob(B, v.data.id, H) : { status: 'not started ' + JSON.stringify(v.data) };
    const call = lastCall(re);
    const bd = call && call.body;
    ok(st.status === 'succeeded' && bd && bd.image_url.startsWith('data:image/png;base64,iVBOR') && bd.aspect_ratio === 'auto' && bd.prompt === 'the boat drifts away' && check(bd),
      engine + ' image-to-video: ' + st.status + (st.error ? ' ' + st.error : '') + ' ' + JSON.stringify(bd && { ...bd, image_url: bd.image_url.slice(0, 26) + '…' }).slice(0, 150));
  }
  const noI2v = await post(B, '/api/ai/video', { prompt: 'x', engine: 'replicate:p-video', image: pic }, H);
  ok(noI2v.status === 400 && /cannot start from a picture\. Pick Grok Imagine Video, Seedance 2\.0, Veo 3\.1 Fast/.test(noI2v.data.error.message), 'engines without image-to-video refuse a picture and name the ones that can');
  const badPic = await post(B, '/api/ai/video', { prompt: 'x', engine: 'fal:veo-3.1-fast', image: { mime: 'image/svg+xml', data: 'PHN2Zz4=' } }, H);
  ok(badPic.status === 400 && /PNG, JPG or WebP/.test(badPic.data.error.message), 'only PNG, JPG or WebP pictures');

  const f = await fetch(B + '/' + firstUrl, { headers: H });
  const buf = Buffer.from(await f.arrayBuffer());
  ok(f.status === 200 && f.headers.get('content-type') === 'video/mp4' && buf.length > 1000, 'video file served (' + buf.length + ' bytes)');
  const part = await fetch(B + '/' + firstUrl, { headers: { ...H, range: 'bytes=0-99' } });
  ok(part.status === 206 && (await part.arrayBuffer()).byteLength === 100, 'range request returns 206 with 100 bytes');
  ok((await fetch(B + '/' + firstUrl)).status === 401, 'file needs the access code too');

  // Stop: the job is cancelled at the provider, not just abandoned
  const cancels = [
    ['fal:seedance-2', /^\/fal\/bytedance\/seedance-2\.0\/requests\/\w+\/cancel$/, 'PUT'],
    ['replicate:p-video', /^\/v1\/predictions\/\w+\/cancel$/, 'POST'],
  ];
  for (const [engine, re, method] of cancels) {
    const v = await post(B, '/api/ai/video', { prompt: 'slow please', engine, aspect: '16:9', duration: 8 }, H);
    await sleep(400);
    const c = await del(B, '/api/ai/video/' + v.data.id, H);
    const call = lastAny(re);
    ok(c.status === 200 && c.data.status === 'canceled' && c.data.providerCanceled === true && call && call.method === method,
      engine + ' stop cancels the provider job with ' + (call ? call.method + ' ' + call.path.replace(/\w+\/cancel$/, '…/cancel') : 'no call') + ' ' + JSON.stringify(c.data));
    await sleep(600);
    const st = (await get(B, '/api/ai/video/' + v.data.id, H)).data;
    ok(st.status === 'canceled' && !st.url && !st.error, engine + ' stays cancelled with no file: ' + JSON.stringify(st));
  }
  const late = await post(B, '/api/ai/video', { prompt: 'late please', engine: 'fal:grok-video', aspect: '16:9', duration: 6 }, H);
  await sleep(400);
  const lc = await del(B, '/api/ai/video/' + late.data.id, H);
  ok(lc.data.status === 'canceled' && lc.data.providerCanceled === false, 'fal "already completed" reported as not cancelled at the provider');
  const doneJob = await post(B, '/api/ai/video', { prompt: 'waves', engine: 'replicate:p-video', aspect: '16:9', duration: 5 }, H);
  await waitJob(B, doneJob.data.id, H);
  const dc = await del(B, '/api/ai/video/' + doneJob.data.id, H);
  ok(dc.status === 200 && dc.data.status === 'succeeded' && dc.data.url, 'stopping a finished job changes nothing');
  ok((await del(B, '/api/ai/video/00000000-unknown', H)).status === 404, 'stopping an unknown job -> 404');
  ok((await del(B, '/api/ai/video/' + doneJob.data.id)).status === 401, 'stopping needs the access code');
});

console.log('C. Claude text, OpenAI + Cloudflare + Gemini billing + Pollinations');
await withServer({ ANTHROPIC_API_KEY: 'ak', OPENAI_API_KEY: 'ok', GEMINI_API_KEY: 'gk', GEMINI_BILLING: 'on', TEXT_PROVIDER: 'anthropic', POLLINATIONS_API_KEY: 'sk_poll', CLOUDFLARE_ACCOUNT_ID: 'acct1', CLOUDFLARE_API_TOKEN: 'cft' }, 4103, async (B) => {
  const h = (await get(B, '/api/health')).data;
  ok(h.text.provider === 'anthropic' && h.text.model === 'claude-haiku-5-5' && h.text.media === false, 'TEXT_PROVIDER=anthropic honoured; cannot watch video');
  ok(avail(h, 'image') === 'cloudflare:lucid,cloudflare:flux,openai:gpt-image,gemini:nano-banana,pollinations:flux', 'image engines: ' + avail(h, 'image'));
  ok(avail(h, 'video') === 'gemini:omni', 'video engines: ' + avail(h, 'video'));
  const t = await post(B, '/api/ai/text', { prompt: 'hi', images: [img] });
  ok(t.data.text === 'claude says hi (saw image)', 'claude text with image, thinking skipped');
  const chat = await post(B, '/api/ai/text', { messages: [{ role: 'user', content: 'ctx' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'q' }] });
  ok(chat.data.text === 'claude says hi [3 turns: user/assistant/user]', 'claude chat turns');
  const cs = await streamCall(B, { prompt: 'hi', images: [img] });
  ok(cs.text === 'claude says hi (saw image)' && cs.deltas.length >= 2 && cs.joined === cs.text && lastCall(/^\/v1\/messages$/).body.stream === true, 'claude streams text_delta only (thinking skipped): ' + cs.joined);
  const files = await post(B, '/api/ai/text', { prompt: 'x', files: [{ uri: MOCK + '/v1beta/files/abc', mime: 'video/mp4' }] });
  ok(files.status === 400 && /Only Gemini/.test(files.data.error.message), 'media files refused for non-Gemini text');
  const up = await fetch(B + '/api/ai/upload', { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: MP4 });
  ok(up.status === 503, 'upload refused when the text AI is not Gemini');
  const lu = await post(B, '/api/ai/image', { prompt: 'x', aspect: '16:9', engine: 'cloudflare:lucid' });
  const luCall = lastCall(/lucid-origin/);
  ok(lu.status === 200 && lu.data.images[0].mime === 'image/png' && luCall.body.width === 1344 && luCall.body.height === 768, 'cloudflare lucid origin 16:9 (mime sniffed)');
  const cf = await post(B, '/api/ai/image', { prompt: 'x', aspect: '16:9', engine: 'cloudflare:flux' });
  ok(cf.status === 200 && lastCall(/flux-1-schnell/).body.steps === 6, 'cloudflare flux (square only)');
  const o = await post(B, '/api/ai/image', { prompt: 'x', aspect: '16:9', engine: 'openai:gpt-image' });
  ok(o.status === 200 && o.data.images[0].mime === 'image/webp', 'openai image');
  const g = await post(B, '/api/ai/image', { prompt: 'x', aspect: '16:9', engine: 'gemini:nano-banana' });
  ok(g.status === 200 && g.data.images[0].mime === 'image/png', 'gemini interactions image found in steps');
  const p = await post(B, '/api/ai/image', { prompt: 'x', aspect: '1:1', engine: 'pollinations:flux' });
  ok(p.status === 200, 'pollinations keyed image');
  const v = await post(B, '/api/ai/video', { prompt: 'x', aspect: '9:16', duration: 4, engine: 'gemini:omni' });
  const st = await waitJob(B, v.data.id);
  ok(st.status === 'succeeded', 'gemini omni video via uri download: ' + st.status + ' ' + (st.error || ''));
  const slow = await post(B, '/api/ai/video', { prompt: 'slow please', aspect: '16:9', duration: 4, engine: 'gemini:omni' });
  await sleep(300);
  const c = await del(B, '/api/ai/video/' + slow.data.id);
  await sleep(300);
  const st2 = (await get(B, '/api/ai/video/' + slow.data.id)).data;
  ok(c.data.status === 'canceled' && c.data.providerCanceled === false && st2.status === 'canceled', 'gemini omni stop drops the request (Google may still bill it)');
});

console.log('D. OpenAI text, bad keys, missing model, rate limit');
await withServer({ OPENAI_API_KEY: 'ok', GEMINI_API_KEY: 'wrong', TEXT_PROVIDER: 'openai', AI_REQUESTS_PER_MINUTE: '4' }, 4104, async (B) => {
  const t = await post(B, '/api/ai/text', { prompt: 'hi' });
  ok(t.data.text === 'openai says hi', 'openai responses text parsed from message item');
  const chat = await post(B, '/api/ai/text', { messages: [{ role: 'user', content: 'ctx' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'q' }] });
  ok(chat.data.text === 'openai says hi [3 turns, assistant ok]', 'openai chat turns use output_text for assistant');
  await post(B, '/api/ai/text', { prompt: 'hi' });
  await post(B, '/api/ai/text', { prompt: 'hi' });
  const lim = await post(B, '/api/ai/text', { prompt: 'hi' });
  ok(lim.status === 429 && lim.data.error.code === 'rate_limited', 'per-minute limit enforced');
});
await withServer({ OPENAI_API_KEY: 'ok', TEXT_PROVIDER: 'openai' }, 4108, async (B) => {
  const os = await streamCall(B, { prompt: 'hi' });
  ok(os.text === 'openai says hi' && os.deltas.length >= 2 && os.joined === os.text && lastCall(/^\/v1\/responses$/).body.stream === true, 'openai streams output_text deltas only (reasoning skipped): ' + os.joined);
});
await withServer({ GEMINI_API_KEY: 'wrong' }, 4105, async (B) => {
  const t = await post(B, '/api/ai/text', { prompt: 'hi' });
  ok(t.status === 502 && t.data.error.code === 'bad_key' && /GEMINI_API_KEY/.test(t.data.error.message), 'bad key explained: ' + t.data.error.message.slice(0, 70));
  const bs = await streamCall(B, { prompt: 'hi' });
  ok(bs.status === 502 && bs.data.error.code === 'bad_key' && !bs.events.length, 'a refused stream is a normal JSON error');
  const e = await post(B, '/api/ai/text', {});
  ok(e.status === 400, 'empty prompt rejected');
});
await withServer({ GEMINI_API_KEY: 'gk', GEMINI_TEXT_MODEL: 'missing-model', FAL_KEY: 'wrong' }, 4106, async (B) => {
  const t = await post(B, '/api/ai/text', { prompt: 'hi' });
  ok(t.data.error.code === 'model_missing' && /GEMINI_TEXT_MODEL/.test(t.data.error.message), 'missing model explained');
  const f = await post(B, '/api/ai/image', { prompt: 'x', engine: 'fal:flux-schnell' });
  ok(f.status === 502 && f.data.error.code === 'bad_key' && /FAL_KEY/.test(f.data.error.message), 'bad fal key explained');
});
console.log('E. Prices and the daily spending limit');
await withServer({ FAL_KEY: 'fk', MAX_SPEND_PER_DAY: '0.05' }, 4109, async (B) => {
  const h0 = (await get(B, '/api/health')).data;
  ok(h0.budget && h0.budget.limit === 0.05 && h0.budget.spent === 0, 'health shows the daily spending limit');
  const priced = (k) => h0.engines[k].filter((e) => e.price).map((e) => e.id + ' ' + e.price.usd).join(', ');
  ok(h0.engines.image.find((e) => e.id === 'fal:seedream').price.usd === 0.035 && h0.engines.video.find((e) => e.id === 'fal:grok-video').price.per === 'second', 'engines carry list prices: ' + priced('video'));
  ok(/17 November 2026/.test(h0.engines.video.find((e) => e.id === 'fal:veo-3.1-fast').note), 'Veo 3.1 Fast warns that fal retires it on 17 Nov 2026');
  const a = await post(B, '/api/ai/image', { prompt: 'x', engine: 'fal:seedream', aspect: '1:1' });
  const b = await post(B, '/api/ai/image', { prompt: 'x', engine: 'fal:seedream', aspect: '1:1' });
  ok(a.status === 200 && b.status === 429 && b.data.error.code === 'budget' && /MAX_SPEND_PER_DAY/.test(b.data.error.message), 'a second $0.035 Seedream image would pass $0.05: refused');
  const fail = await post(B, '/api/ai/image', { prompt: 'fail please', engine: 'fal:flux-schnell', aspect: '1:1' });
  const c = await post(B, '/api/ai/image', { prompt: 'x', engine: 'fal:flux-schnell', aspect: '1:1' });
  const h1 = (await get(B, '/api/health')).data;
  ok(fail.status === 502 && c.status === 200 && Math.abs(h1.budget.spent - 0.041) < 1e-9, 'a failed call is given back; spent today $' + h1.budget.spent);
  const v = await post(B, '/api/ai/video', { prompt: 'x', engine: 'fal:grok-video', duration: 6 });
  ok(v.status === 429 && /resets at midnight UTC/.test(v.data.error.message), 'a 6 s Grok clip (about $0.42) is refused before it starts');
});
await withServer({ CLOUDFLARE_ACCOUNT_ID: 'acct1', CLOUDFLARE_API_TOKEN: 'nope', IMAGE_PROVIDER: 'cloudflare' }, 4107, async (B) => {
  const h = (await get(B, '/api/health')).data;
  ok(avail(h, 'image') === 'cloudflare:lucid,cloudflare:flux', 'IMAGE_PROVIDER narrows the list');
  const r = await post(B, '/api/ai/image', { prompt: 'x', engine: 'cloudflare:lucid' });
  ok(r.status === 502 && r.data.error.code === 'bad_key' && /Authentication error/.test(r.data.error.message), 'cloudflare error message surfaced: ' + r.data.error.message.slice(0, 80));
});

close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
