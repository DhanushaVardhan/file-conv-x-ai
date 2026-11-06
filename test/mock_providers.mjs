// Fake AI providers so the server's request/response handling can be tested offline.
// Imported by test_server.mjs; listens on 127.0.0.1:9900.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const PNG = readFileSync(new URL('./fixtures/logo.png', import.meta.url));
const MP4 = readFileSync(new URL('./fixtures/clip.mp4', import.meta.url));
export const MOCK = 'http://127.0.0.1:9900';
export const log = [];
const preds = new Map();
const falJobs = new Map();
const uploads = new Map();
const files = new Map();
let seq = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Magic prompts: "slow please" keeps a job running until it is cancelled;
// "late please" also runs forever, but its cancel comes back "already completed".
const SLOW = /slow please|late please/;
const nextId = (p) => p + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);

function readRaw(req) {
  return new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); });
}
function json(res, status, d, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(d));
}
const FAL_FLUX_SIZES = ['square_hd', 'landscape_16_9', 'portrait_16_9', 'landscape_4_3'];

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const raw = req.method === 'POST' ? await readRaw(req) : Buffer.alloc(0);
  let b = null;
  if (raw.length && (req.headers['content-type'] || '').includes('json')) { try { b = JSON.parse(raw.toString('utf8')); } catch { b = null; } }
  log.push({ method: req.method, path: u.pathname, search: u.search, headers: req.headers, body: b, bytes: raw.length });
  let m;

  /* ---------------- Gemini text */
  if ((m = /^\/v1beta\/models\/(.+):generateContent$/.exec(u.pathname))) {
    if (req.headers['x-goog-api-key'] !== 'gk') return json(res, 403, { error: { message: 'API key not valid' } });
    if (m[1] === 'missing-model') return json(res, 404, { error: { message: 'models/missing-model is not found' } });
    const contents = b.contents;
    const parts = contents[0].parts;
    const hasImg = parts.some((p) => p.inline_data);
    const hasFile = parts.some((p) => p.file_data && p.file_data.file_uri.startsWith(MOCK + '/v1beta/files/') && p.file_data.mime_type === 'video/mp4');
    const fileFirst = !hasFile || !!parts[0].file_data;
    const text = b.generationConfig.responseMimeType === 'application/json'
      ? '{"title":"mock","elements":[{"kind":"orb"}]}'
      : 'gemini says hi' + (hasImg ? ' (saw image)' : '') + (hasFile ? ' (watched video' + (fileFirst ? ', media first' : '') + ')' : '') +
        (contents.length > 1 ? ' [' + contents.length + ' turns: ' + contents.map((c) => c.role).join('/') + ']' : '');
    return json(res, 200, { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text }] } }] });
  }
  /* ---------------- Gemini Files API */
  if (u.pathname === '/upload/v1beta/files' && req.method === 'POST') {
    const h = req.headers;
    if (h['x-goog-api-key'] !== 'gk') return json(res, 403, { error: { message: 'API key not valid' } });
    if (h['x-goog-upload-protocol'] !== 'resumable' || h['x-goog-upload-command'] !== 'start' || !(Number(h['x-goog-upload-header-content-length']) > 0) || !h['x-goog-upload-header-content-type'] || !b || !b.file) {
      return json(res, 400, { error: { message: 'bad start request' } });
    }
    const id = nextId('s');
    uploads.set(id, { size: Number(h['x-goog-upload-header-content-length']), mime: h['x-goog-upload-header-content-type'], name: b.file.display_name });
    return json(res, 200, {}, { 'x-goog-upload-url': MOCK + '/upload-session/' + id, 'x-goog-upload-status': 'active' });
  }
  if ((m = /^\/upload-session\/(\w+)$/.exec(u.pathname))) {
    const s = uploads.get(m[1]);
    if (!s) return json(res, 404, { error: { message: 'no session' } });
    if (req.headers['x-goog-upload-command'] !== 'upload, finalize' || req.headers['x-goog-upload-offset'] !== '0') return json(res, 400, { error: { message: 'bad upload headers' } });
    if (raw.length !== s.size) return json(res, 400, { error: { message: 'size mismatch ' + raw.length + ' vs ' + s.size } });
    const fid = nextId('f');
    const file = { name: 'files/' + fid, displayName: s.name, mimeType: s.mime, sizeBytes: String(raw.length), uri: MOCK + '/v1beta/files/' + fid, state: 'PROCESSING', polls: 0 };
    files.set(fid, file);
    const { polls, ...pub } = file;
    return json(res, 200, { file: pub });
  }
  if ((m = /^\/v1beta\/files\/(\w+)$/.exec(u.pathname)) && files.has(m[1])) {
    if (req.headers['x-goog-api-key'] !== 'gk') return json(res, 403, {});
    const f = files.get(m[1]);
    f.polls++;
    if (f.polls >= 1) f.state = 'ACTIVE';
    const { polls, ...pub } = f;
    return json(res, 200, pub);
  }
  /* ---------------- Gemini interactions (image + video) */
  if (u.pathname === '/v1beta/interactions') {
    if (b.response_format.type === 'image') return json(res, 200, { id: 'i1', steps: [{ type: 'user_input' }, { type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: PNG.toString('base64') }] }] });
    if (b.response_format.type === 'video') {
      if (SLOW.test(b.input)) await wait(5000);
      if (res.destroyed) return; // the server dropped the request (Stop)
      return json(res, 200, { id: 'i2', steps: [{ type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', uri: MOCK + '/v1beta/files/vid123' }] }] });
    }
  }
  if (u.pathname === '/v1beta/files/vid123:download') {
    if (req.headers['x-goog-api-key'] !== 'gk') return json(res, 403, {});
    res.writeHead(200, { 'content-type': 'video/mp4' });
    return res.end(MP4);
  }
  /* ---------------- Anthropic */
  if (u.pathname === '/v1/messages') {
    if (req.headers['x-api-key'] !== 'ak' || req.headers['anthropic-version'] !== '2023-06-01') return json(res, 401, { error: { message: 'bad key' } });
    const hasImg = b.messages[0].content.some((c) => c.type === 'image');
    const n = b.messages.length;
    return json(res, 200, { content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: 'claude says hi' + (hasImg ? ' (saw image)' : '') + (n > 1 ? ' [' + n + ' turns: ' + b.messages.map((x) => x.role).join('/') + ']' : '') }], stop_reason: 'end_turn' });
  }
  /* ---------------- OpenAI */
  if (u.pathname === '/v1/responses') {
    if (req.headers.authorization !== 'Bearer ok') return json(res, 401, { error: { message: 'bad key' } });
    const n = b.input.length;
    const asstOk = b.input.filter((x) => x.role === 'assistant').every((x) => x.content[0].type === 'output_text');
    return json(res, 200, { output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'openai says hi' + (n > 1 ? ' [' + n + ' turns, assistant ' + (asstOk ? 'ok' : 'WRONG') + ']' : '') }] }] });
  }
  if (u.pathname === '/v1/images/generations') {
    if (!['1024x1024', '1536x1024', '1024x1536'].includes(b.size)) return json(res, 400, { error: { message: 'bad size ' + b.size } });
    return json(res, 200, { data: [{ b64_json: PNG.toString('base64') }] });
  }
  /* ---------------- Replicate */
  if ((m = /^\/v1\/models\/([^/]+\/[^/]+)\/predictions$/.exec(u.pathname))) {
    if (req.headers.authorization !== 'Bearer rt') return json(res, 401, { detail: 'Invalid token' });
    const id = nextId('p');
    const isVideo = /video|veo|h3/.test(m[1]);
    const p = { id, model: m[1], input: b.input, status: 'starting', output: null, polls: 0, isVideo, slow: SLOW.test(b.input && b.input.prompt) };
    preds.set(id, p);
    if (req.headers.prefer && !isVideo) {
      p.status = 'succeeded';
      p.output = m[1].includes('flux-schnell') ? [MOCK + '/delivery/out.png'] : MOCK + '/delivery/out.png';
    }
    return json(res, 201, { id, status: p.status, output: p.output, urls: { get: 'x' } });
  }
  if ((m = /^\/v1\/predictions\/(\w+)\/cancel$/.exec(u.pathname)) && req.method === 'POST') {
    if (req.headers.authorization !== 'Bearer rt') return json(res, 401, { detail: 'Invalid token' });
    const p = preds.get(m[1]);
    if (!p) return json(res, 404, { detail: 'Not found' });
    if (p.status === 'starting' || p.status === 'processing') p.status = 'canceled';
    return json(res, 200, { id: p.id, status: p.status, output: p.output });
  }
  if ((m = /^\/v1\/predictions\/(\w+)$/.exec(u.pathname))) {
    const p = preds.get(m[1]);
    p.polls++;
    if (p.status === 'canceled') return json(res, 200, { id: p.id, status: p.status, output: null });
    if (p.polls === 1 || p.slow) p.status = 'processing';
    if (p.polls >= 2 && !p.slow) { p.status = 'succeeded'; p.output = MOCK + '/delivery/out.mp4'; }
    return json(res, 200, { id: p.id, status: p.status, output: p.output });
  }
  /* ---------------- fal.ai queue (FAL_BASE_URL = MOCK/fal) */
  if (u.pathname.startsWith('/fal/')) {
    if (req.headers.authorization !== 'Key fk') return json(res, 401, { detail: 'Invalid FAL key' });
    const rest = u.pathname.slice(5);
    if ((m = /^([^/]+\/[^/]+)\/requests\/(\w+)\/status$/.exec(rest)) && req.method === 'GET') {
      const j = falJobs.get(m[2]);
      if (!j || j.app !== m[1]) return json(res, 405, { detail: 'Method not allowed' });
      j.polls++;
      if (j.canceled) return json(res, 200, { status: 'COMPLETED', request_id: j.id, error: 'Request was cancelled', error_type: 'request_cancelled' });
      if (SLOW.test(j.input.prompt)) return json(res, 200, { status: j.polls === 1 ? 'IN_QUEUE' : 'IN_PROGRESS', request_id: j.id });
      if (j.polls === 1) return json(res, 200, { status: 'IN_PROGRESS', request_id: j.id });
      if (/fail please/.test(j.input.prompt)) return json(res, 200, { status: 'COMPLETED', request_id: j.id, error: 'Content blocked by the safety filter', error_type: 'content_policy' });
      return json(res, 200, { status: 'COMPLETED', request_id: j.id, metrics: { inference_time: 1.2 } });
    }
    if ((m = /^([^/]+\/[^/]+)\/requests\/(\w+)$/.exec(rest)) && req.method === 'GET') {
      const j = falJobs.get(m[2]);
      if (!j || j.app !== m[1]) return json(res, 405, { detail: 'Method not allowed' });
      if (j.video) return json(res, 200, { video: { url: MOCK + '/delivery/out.mp4', content_type: 'video/mp4' }, seed: 1 });
      return json(res, 200, { images: [{ url: MOCK + '/delivery/out.png', width: 1024, height: 1024, content_type: 'image/png' }], seed: 1, has_nsfw_concepts: [false] });
    }
    // PUT {cancel_url}: 200 OK while queued, 202 while running, 400 when already completed.
    if ((m = /^([^/]+\/[^/]+)\/requests\/(\w+)\/cancel$/.exec(rest)) && req.method === 'PUT') {
      const j = falJobs.get(m[2]);
      if (!j || j.app !== m[1]) return json(res, 404, { status: 'NOT_FOUND' });
      if (/late please/.test(j.input.prompt) || (!SLOW.test(j.input.prompt) && j.polls >= 2)) return json(res, 400, { status: 'ALREADY_COMPLETED' });
      j.canceled = true;
      return j.polls <= 1 ? json(res, 200, { status: 'OK' }) : json(res, 202, { status: 'CANCELLATION_REQUESTED' });
    }
    if (req.method === 'POST') {
      const model = rest;
      const bad = (msg) => json(res, 422, { detail: [{ loc: ['body'], msg, type: 'value_error' }] });
      if (/veo3/.test(model) && !/^(4|6|8)s$/.test(b.duration)) return bad('duration must be 4s, 6s or 8s');
      if (/veo3/.test(model) && !['16:9', '9:16'].includes(b.aspect_ratio)) return bad('bad aspect_ratio');
      if (/seedance/.test(model) && (typeof b.duration !== 'string' || b.generate_audio !== true)) return bad('seedance duration must be a string');
      if (/grok-imagine/.test(model) && typeof b.duration !== 'number') return bad('grok duration must be an integer');
      if (/flux\/schnell/.test(model) && !FAL_FLUX_SIZES.includes(b.image_size)) return bad('bad image_size ' + JSON.stringify(b.image_size));
      if (/seedream/.test(model) && !(b.image_size && b.image_size.width * b.image_size.height >= 2560 * 1440)) return bad('seedream size too small');
      const id = nextId('r');
      const app = model.split('/').slice(0, 2).join('/');
      falJobs.set(id, { id, app, model, input: b, polls: 0, video: /video|veo|seedance/.test(model) });
      const base = MOCK + '/fal/' + app + '/requests/' + id;
      return json(res, 200, { request_id: id, status_url: base + '/status', response_url: base, cancel_url: base + '/cancel', queue_position: 0 });
    }
  }
  /* ---------------- Cloudflare Workers AI */
  if ((m = /^\/client\/v4\/accounts\/([^/]+)\/ai\/run\/(.+)$/.exec(u.pathname))) {
    if (req.headers.authorization !== 'Bearer cft') return json(res, 401, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] });
    if (m[1] !== 'acct1') return json(res, 404, { success: false, errors: [{ code: 7003, message: 'Could not route to account' }] });
    if (/lucid-origin/.test(m[2]) && !(b.width > 0 && b.height > 0 && b.width <= 2500 && b.height <= 2500)) return json(res, 400, { success: false, errors: [{ code: 5006, message: 'bad size' }] });
    return json(res, 200, { result: { image: PNG.toString('base64') }, success: true, errors: [], messages: [] });
  }
  /* ---------------- files the providers "deliver" */
  if (u.pathname.startsWith('/delivery/')) {
    if (u.pathname.endsWith('.png')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
    res.writeHead(200, { 'content-type': 'video/mp4' });
    return res.end(MP4);
  }
  /* ---------------- Pollinations */
  if (u.pathname.startsWith('/image/')) {
    if (req.headers.authorization !== 'Bearer sk_poll') return json(res, 401, { error: 'bad key' });
    res.writeHead(200, { 'content-type': 'image/jpeg' });
    return res.end(PNG);
  }
  if (u.pathname.startsWith('/prompt/')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(PNG); }
  json(res, 404, { error: { message: 'mock: no route ' + u.pathname } });
});

export const ready = new Promise((resolve) => server.listen(9900, '127.0.0.1', resolve));
export function close() { server.close(); }
