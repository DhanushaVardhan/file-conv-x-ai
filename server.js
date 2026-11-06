#!/usr/bin/env node
// Alembic server: serves the website and keeps your AI keys secret.
// No npm packages needed. Run:  node server.js
import http from 'node:http';
import { createReadStream, statSync, existsSync, readFileSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { loadEnvFile, readConfig } from './lib/config.js';
import { ProviderError } from './lib/http.js';
import { generateText } from './lib/providers/text.js';
import { generateImage } from './lib/providers/image.js';
import { startVideo, getJob, publicJob } from './lib/providers/video.js';
import { uploadToGemini, mediaMime } from './lib/providers/files.js';
import { publicEngine } from './lib/catalog.js';

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`Alembic needs Node.js 18 or newer (you have ${process.version}). Install the LTS version from https://nodejs.org`);
  process.exit(1);
}

const hasEnvFile = loadEnvFile();
const cfg = readConfig();
const PUBLIC = join(cfg.root, 'public');
const VERSION = JSON.parse(readFileSync(join(cfg.root, 'package.json'), 'utf8')).version;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

// The page only loads code from itself and two CDNs (pdf.js and JSZip, used to read files).
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

/* -------------------------------------------------------------- helpers */
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
function sendError(res, err) {
  if (res.headersSent) return res.destroy();
  const status = err instanceof ProviderError ? err.status : 500;
  if (!(err instanceof ProviderError)) console.error('[error]', err);
  sendJson(res, status, { error: { code: err.code || 'server_error', message: err instanceof ProviderError ? err.message : 'Something went wrong on the server.' } });
}
function readJson(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new ProviderError('too_large', 'That request is larger than 25 MB.', 413)); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new ProviderError('bad_request', 'The request body was not valid JSON.', 400)); }
    });
    req.on('error', reject);
  });
}
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}
function accessOk(req) {
  if (!cfg.accessCode) return true;
  const got = Buffer.from(String(req.headers['x-access-code'] || ''));
  const want = Buffer.from(cfg.accessCode);
  return got.length === want.length && timingSafeEqual(got, want);
}
const buckets = new Map();
function allow(ip) {
  const now = Date.now();
  const b = buckets.get(ip) || { start: now, n: 0 };
  if (now - b.start > 60000) { b.start = now; b.n = 0; }
  b.n++;
  buckets.set(ip, b);
  return b.n <= cfg.aiPerMinute;
}
setInterval(() => { const now = Date.now(); for (const [ip, b] of buckets) if (now - b.start > 120000) buckets.delete(ip); }, 60000).unref();

function prompt(p, max) {
  if (typeof p !== 'string' || !p.trim()) throw new ProviderError('bad_request', 'Write a prompt first.', 400);
  return p.trim().slice(0, max);
}
function log(kind, what, t0, extra = '') {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${kind.padEnd(5)} ${what} ${Date.now() - t0}ms ${extra}`);
}

function health() {
  const t = cfg.text;
  return {
    ok: true,
    name: 'Alembic',
    version: VERSION,
    requiresAccessCode: !!cfg.accessCode,
    text: t ? { provider: t.provider, label: t.label, model: t.model, vision: t.vision, maxImages: t.maxImages, media: t.media, maxUploadMB: t.media ? cfg.maxUploadMB : 0 } : null,
    engines: {
      image: cfg.imageCatalog.map(publicEngine),
      video: cfg.videoCatalog.map(publicEngine),
    },
  };
}

/** Chat turns from the browser: [{role, content}] ending on a user turn. */
function chatTurns(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const turns = list.slice(-24).map((m) => ({
    role: m && m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof (m && m.content) === 'string' ? m.content.slice(0, 400000) : '',
  })).filter((m) => m.content.trim());
  if (!turns.length || turns[turns.length - 1].role !== 'user') throw new ProviderError('bad_request', 'The conversation must end with a question.', 400);
  if (turns.reduce((n, m) => n + m.content.length, 0) > 600000) throw new ProviderError('too_large', 'That conversation is too long. Start a new one.', 413);
  return turns;
}
/** Gemini file references from /api/ai/upload. */
function fileRefs(list) {
  if (!Array.isArray(list) || !list.length) return [];
  const base = cfg.bases.gemini.replace(/\/+$/, '') + '/';
  return list.slice(0, 2).filter((f) => f && typeof f.uri === 'string' && f.uri.startsWith(base) && typeof f.mime === 'string' && /^(video|audio)\//.test(f.mime))
    .map((f) => ({ uri: f.uri, mime: f.mime }));
}

/* ------------------------------------------------------------------ API */
async function handleApi(req, res, route) {
  if (route === '/health' && req.method === 'GET') return sendJson(res, 200, health());

  if (route.startsWith('/ai/') || route.startsWith('/files/')) {
    if (!accessOk(req)) throw new ProviderError('access_code', 'This site needs an access code for AI features. Enter it at the top of the page.', 401);
  }
  if (req.method === 'POST' && route.startsWith('/ai/') && !allow(clientIp(req))) {
    throw new ProviderError('rate_limited', 'Too many AI requests from your network. Wait a minute and try again.', 429);
  }

  if (route === '/ai/text' && req.method === 'POST') {
    const body = await readJson(req);
    const images = (Array.isArray(body.images) ? body.images : [])
      .filter((im) => im && typeof im.data === 'string' && /^image\/(png|jpeg|webp|gif)$/.test(im.mime))
      .slice(0, 16);
    const messages = chatTurns(body.messages);
    const files = fileRefs(body.files);
    const t0 = Date.now();
    const text = await generateText(cfg, { prompt: messages ? undefined : prompt(body.prompt, 400000), messages, images, files, json: !!body.json });
    log('text', cfg.text.label, t0, [images.length && images.length + ' image(s)', files.length && files.length + ' media file(s)', messages && messages.length + ' turns'].filter(Boolean).join(', '));
    return sendJson(res, 200, { text });
  }

  if (route === '/ai/upload' && req.method === 'POST') {
    if (!cfg.text || !cfg.text.media) throw new ProviderError('no_ai', 'Watching videos and listening to audio needs GEMINI_API_KEY (with TEXT_PROVIDER unset or set to gemini).', 503);
    const size = Number(req.headers['content-length']);
    if (!Number.isFinite(size) || size <= 0) throw new ProviderError('bad_request', 'The upload had no size. Try again.', 411);
    if (size > cfg.maxUploadMB * 1024 * 1024) throw new ProviderError('too_large', `That file is over the ${cfg.maxUploadMB} MB upload limit (MAX_UPLOAD_MB).`, 413);
    let name = 'upload';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'upload')); } catch { /* keep default */ }
    const mime = mediaMime(req.headers['content-type'], name);
    if (!mime) throw new ProviderError('bad_request', 'Only video and audio files can be uploaded for the AI.', 415);
    const t0 = Date.now();
    const file = await uploadToGemini(cfg, req, { size, mime, name });
    log('file', 'Gemini upload', t0, Math.round(size / 1048576) + ' MB ' + mime);
    return sendJson(res, 200, file);
  }

  if (route === '/ai/image' && req.method === 'POST') {
    const body = await readJson(req);
    const engine = cfg.imageEngines.find((e) => e.id === body.engine) || cfg.imageEngines[0];
    if (!engine) throw new ProviderError('no_ai', 'Image generation is off. Add FAL_KEY, CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN, REPLICATE_API_TOKEN or OPENAI_API_KEY to .env and restart the server.', 503);
    const t0 = Date.now();
    const img = await generateImage(cfg, engine, { prompt: prompt(body.prompt, 2000), aspect: body.aspect });
    log('image', engine.label, t0);
    return sendJson(res, 200, { images: [img], model: engine.label });
  }

  if (route === '/ai/video' && req.method === 'POST') {
    const body = await readJson(req);
    const engine = cfg.videoEngines.find((e) => e.id === body.engine) || cfg.videoEngines[0];
    if (!engine) throw new ProviderError('no_ai', 'Video generation is off. Add FAL_KEY or REPLICATE_API_TOKEN to .env (or GEMINI_API_KEY with GEMINI_BILLING=on) and restart the server.', 503);
    const duration = engine.durations.includes(Number(body.duration)) ? Number(body.duration) : engine.durations[0];
    const aspect = engine.aspects.includes(body.aspect) ? body.aspect : engine.aspects[0];
    const job = startVideo(cfg, engine, { prompt: prompt(body.prompt, 2000), aspect, duration });
    console.log(`[${new Date().toISOString().slice(11, 19)}] video started ${engine.label} ${job.id}`);
    return sendJson(res, 202, publicJob(job));
  }

  const vm = /^\/ai\/video\/([\w-]{8,64})$/.exec(route);
  if (vm && req.method === 'GET') {
    const job = getJob(vm[1]);
    if (!job) throw new ProviderError('not_found', 'That video job was not found. It may have expired; generate it again.', 404);
    return sendJson(res, 200, publicJob(job));
  }

  const fm = /^\/files\/([\w-]{8,64})$/.exec(route);
  if (fm && (req.method === 'GET' || req.method === 'HEAD')) {
    const job = getJob(fm[1]);
    if (!job || !job.file || !existsSync(job.file.path)) throw new ProviderError('not_found', 'That file has expired. Generate it again.', 404);
    return streamFile(req, res, job.file.path, job.file.mime, { 'cache-control': 'private, max-age=3600' });
  }

  throw new ProviderError('not_found', 'Unknown API route.', 404);
}

/* --------------------------------------------------------------- static */
function streamFile(req, res, file, type, extra = {}) {
  const st = statSync(file);
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', ...extra };
  if (type.startsWith('text/html')) headers['content-security-policy'] = CSP;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start, end;
    if (m[1] === '') { start = Math.max(0, st.size - Number(m[2])); end = st.size - 1; }
    else { start = Number(m[1]); end = m[2] === '' ? st.size - 1 : Math.min(Number(m[2]), st.size - 1); }
    if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(PUBLIC, rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (!extname(rel)) return streamFile(req, res, join(PUBLIC, 'index.html'), MIME['.html'], { 'cache-control': 'no-cache' });
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  return streamFile(req, res, file, type, { 'cache-control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300' });
}

/* --------------------------------------------------------------- server */
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const i = pathname.indexOf('/api/');
  try {
    if (i !== -1) return await handleApi(req, res, pathname.slice(i + 4));
    return serveStatic(req, res, pathname);
  } catch (err) {
    sendError(res, err);
  }
});
server.requestTimeout = 0; // long AI calls are timed inside each provider
server.headersTimeout = 65000;

server.listen(cfg.port, cfg.host, () => {
  const on = (x) => (x ? x : 'off');
  console.log(`\n  Alembic ${VERSION} is running → http://localhost:${cfg.port}\n`);
  console.log(`  Text AI      ${on(cfg.text && `${cfg.text.label} (${cfg.text.model})${cfg.text.media ? ', can watch video' : ''}`)}`);
  console.log(`  Built-in     ${cfg.text ? 'Vector, Shader, Pixel art · Motion, Shader film, Story reel' : 'off (needs a text AI key)'}`);
  console.log(`  Images       ${on(cfg.imageEngines.map((e) => e.label).join(', '))}`);
  console.log(`  Video        ${on(cfg.videoEngines.map((e) => e.label).join(', '))}`);
  console.log(`  Access code  ${cfg.accessCode ? 'required' : 'not set'}`);
  if (!hasEnvFile) console.log(`\n  Tip: copy .env.example to .env and add an API key to switch on AI.`);
  console.log('');
});
