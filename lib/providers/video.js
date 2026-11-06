// Video generation runs as a background job: start it, then the browser polls for the result.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchJson, fetchBytes, downloadUrl, findMedia, sleep, ProviderError } from '../http.js';
import { replicateCreate, replicateGet, firstOutput, replicateDownload } from './image.js';
import { falRun } from './fal.js';

const DIR = join(tmpdir(), 'alembic-files');
mkdirSync(DIR, { recursive: true });
const jobs = new Map();
const KEEP_MS = 2 * 60 * 60 * 1000;
const MAX_WAIT_MS = 20 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > KEEP_MS) {
      if (job.file) rmSync(job.file.path, { force: true });
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

export function getJob(id) {
  return jobs.get(id) || null;
}

export function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    error: job.error || undefined,
    url: job.status === 'succeeded' ? 'api/files/' + job.id : undefined,
    engine: job.engineLabel,
  };
}

function saveFile(job, bytes, mime) {
  const ext = mime.includes('webm') ? 'webm' : mime.includes('quicktime') ? 'mov' : 'mp4';
  const path = join(DIR, job.id + '.' + ext);
  writeFileSync(path, bytes);
  job.file = { path, mime: mime.startsWith('video/') ? mime : 'video/mp4', size: statSync(path).size };
  job.status = 'succeeded';
}

const RUNNERS = { replicate: replicateVideo, fal: falVideo, gemini: geminiVideo };

export function startVideo(cfg, engine, { prompt, aspect, duration }) {
  const job = { id: randomUUID(), status: 'queued', createdAt: Date.now(), engineLabel: engine.label };
  jobs.set(job.id, job);
  const run = RUNNERS[engine.provider];
  if (!run) throw new ProviderError('bad_engine', 'Unknown video engine.', 400);
  run(cfg, engine, job, { prompt, aspect, duration })
    .catch((e) => {
      job.status = 'failed';
      job.error = e instanceof ProviderError ? e.message : 'Video generation failed: ' + (e && e.message ? e.message : 'unknown error');
      console.warn('[video] failed:', job.error);
    });
  return job;
}

/* ------------------------------------------------------------ Replicate */
export function replicateVideoInput(model, prompt, aspect, duration) {
  if (/veo/.test(model)) {
    return { prompt, duration: [4, 6, 8].includes(duration) ? duration : 8, aspect_ratio: aspect === '9:16' ? '9:16' : '16:9', resolution: '720p', generate_audio: true };
  }
  if (/p-video/.test(model)) return { prompt, duration, aspect_ratio: aspect, resolution: '720p' };
  if (/minimax\/h3/.test(model)) return { prompt, duration, resolution: '768P', ratio: aspect };
  if (/wan/.test(model)) return { prompt, aspect_ratio: aspect === '9:16' ? '9:16' : '16:9', resolution: '720p' };
  return { prompt, duration, aspect_ratio: aspect };
}

async function replicateVideo(cfg, engine, job, { prompt, aspect, duration }) {
  let p = await replicateCreate(cfg, engine.model, replicateVideoInput(engine.model, prompt, aspect, duration));
  const t0 = Date.now();
  while (p.status === 'starting' || p.status === 'processing') {
    job.status = p.status === 'starting' ? 'queued' : 'running';
    if (Date.now() - t0 > MAX_WAIT_MS) throw new ProviderError('timeout', 'The video took longer than 20 minutes, so Alembic gave up waiting.');
    await sleep(3000);
    p = await replicateGet(cfg, p.id);
  }
  if (p.status !== 'succeeded') throw new ProviderError('generation_failed', 'Replicate could not make this video' + (p.error ? ': ' + String(p.error).slice(0, 240) : '.'));
  const url = firstOutput(p.output);
  if (!url) throw new ProviderError('bad_output', 'Replicate finished but returned no video.');
  job.status = 'running';
  const file = await replicateDownload(cfg, url);
  saveFile(job, file.bytes, file.mime);
}

/* ---------------------------------------------------------------- fal.ai */
export function falVideoInput(model, prompt, aspect, duration) {
  if (/veo3/.test(model)) {
    const d = [4, 6, 8].includes(duration) ? duration : 8;
    return { prompt, aspect_ratio: aspect === '9:16' ? '9:16' : '16:9', duration: d + 's', resolution: '720p', generate_audio: true };
  }
  if (/seedance/.test(model)) {
    return { prompt, aspect_ratio: aspect, duration: String(Math.min(15, Math.max(4, duration))), resolution: '720p', generate_audio: true };
  }
  if (/grok-imagine/.test(model)) {
    return { prompt, aspect_ratio: aspect, duration: Math.min(15, Math.max(1, duration)), resolution: '720p' };
  }
  return { prompt, aspect_ratio: aspect, duration };
}

async function falVideo(cfg, engine, job, { prompt, aspect, duration }) {
  const r = await falRun(cfg, engine.model, falVideoInput(engine.model, prompt, aspect, duration), {
    timeoutMs: MAX_WAIT_MS,
    every: 3000,
    onStatus: (s) => { job.status = s; },
  });
  const url = r && r.video && r.video.url;
  if (!url) throw new ProviderError('bad_output', 'fal.ai finished but returned no video.');
  job.status = 'running';
  const file = await downloadUrl(url, { provider: 'fal.ai' });
  saveFile(job, file.bytes, file.mime);
}

/* --------------------------------------------------------------- Gemini */
async function geminiVideo(cfg, engine, job, { prompt, aspect, duration }) {
  job.status = 'running';
  const r = await fetchJson(`${cfg.bases.gemini}/v1beta/interactions`, {
    method: 'POST',
    headers: { 'x-goog-api-key': cfg.keys.gemini },
    body: {
      model: engine.model,
      input: prompt + ` (about ${duration} seconds long)`,
      response_format: { type: 'video', aspect_ratio: aspect === '9:16' ? '9:16' : '16:9', resolution: '720p' },
      background: false,
      store: false,
      stream: false,
    },
    timeout: 15 * 60 * 1000,
    provider: 'Gemini',
    hint: { keyName: 'GEMINI_API_KEY', model: engine.model, modelVar: 'GEMINI_VIDEO_MODEL' },
  });
  const media = findMedia(r, 'video');
  if (!media) throw new ProviderError('bad_output', 'Gemini answered without a video. Try rewording the prompt.');
  if (media.data) return saveFile(job, Buffer.from(media.data, 'base64'), media.mime || 'video/mp4');
  let uri = media.uri;
  if (/\/files\/[^/:?]+$/.test(uri)) uri += ':download?alt=media';
  const file = await fetchBytes(uri, { headers: { 'x-goog-api-key': cfg.keys.gemini }, provider: 'Gemini' });
  saveFile(job, file.bytes, file.mime);
}
