// Video generation runs as a background job: start it, then the browser polls for the result.
// The browser can also cancel it (Stop): Alembic stops waiting and asks the provider to cancel,
// so an unfinished clip is not billed where the provider allows that.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchJson, fetchBytes, downloadUrl, findMedia, sleep, cancelledError, ProviderError } from '../http.js';
import { replicateCreate, replicateGet, replicateCancel, firstOutput, replicateDownload } from './image.js';
import { falRun, falCancel } from './fal.js';
import { PROVIDERS } from '../catalog.js';

const DIR = join(tmpdir(), 'alembic-files');
mkdirSync(DIR, { recursive: true });
const jobs = new Map();
const KEEP_MS = 2 * 60 * 60 * 1000;
const MAX_WAIT_MS = 20 * 60 * 1000;
const DONE = new Set(['succeeded', 'failed', 'canceled']);

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
    // Only after a cancel: did the provider agree to stop (true), was it too late or impossible (false)?
    providerCanceled: job.status === 'canceled' ? !!job.providerCanceled : undefined,
  };
}

/** Status changes from the runners never overwrite a finished or cancelled job. */
function setStatus(job, status) {
  if (!DONE.has(job.status)) job.status = status;
}

function saveFile(job, bytes, mime) {
  if (job.status === 'canceled') return;
  const ext = mime.includes('webm') ? 'webm' : mime.includes('quicktime') ? 'mov' : 'mp4';
  const path = join(DIR, job.id + '.' + ext);
  writeFileSync(path, bytes);
  job.file = { path, mime: mime.startsWith('video/') ? mime : 'video/mp4', size: statSync(path).size };
  job.status = 'succeeded';
}

const RUNNERS = { replicate: replicateVideo, fal: falVideo, gemini: geminiVideo };

/**
 * @param {{prompt, aspect, duration, image?: {mime, data}}} req  image: start from this picture (engines with i2v)
 * @param {(job) => void} [onFail]  called once if the job fails (the spending limit gives its estimate back)
 */
export function startVideo(cfg, engine, { prompt, aspect, duration, image }, onFail) {
  const run = RUNNERS[engine.provider];
  if (!run) throw new ProviderError('bad_engine', 'Unknown video engine.', 400);
  let submitted;
  const job = {
    id: randomUUID(),
    status: 'queued',
    createdAt: Date.now(),
    engineLabel: engine.label,
    providerLabel: (PROVIDERS[engine.provider] || {}).label || engine.provider,
    ctl: new AbortController(),
    cancel: null, // set once the provider has accepted the job: () => Promise<boolean>
    submitted: new Promise((r) => { submitted = r; }),
  };
  /** Runners call this as soon as the provider has the job (cancelFn is null when it cannot be cancelled). */
  job.onSubmit = (cancelFn) => { job.cancel = cancelFn || null; submitted(); };
  jobs.set(job.id, job);
  run(cfg, engine, job, { prompt, aspect, duration, image })
    .catch((e) => {
      if (job.status === 'canceled') return;
      job.status = 'failed';
      job.error = e instanceof ProviderError ? e.message : 'Video generation failed: ' + (e && e.message ? e.message : 'unknown error');
      console.warn('[video] failed:', job.error);
      if (onFail) onFail(job);
    })
    .finally(() => submitted());
  return job;
}

/**
 * Stop a job (the browser's Stop button). Waits briefly for a job that is still being
 * submitted, so it can be cancelled at the provider too.
 * @returns {Promise<object|null>} the job, or null if unknown
 */
export async function cancelVideo(id) {
  const job = jobs.get(id);
  if (!job) return null;
  if (DONE.has(job.status)) return job;
  job.status = 'canceled';
  job.error = undefined;
  job.ctl.abort();
  await Promise.race([job.submitted, sleep(10000)]);
  job.providerCanceled = false;
  if (job.cancel) {
    try {
      job.providerCanceled = await job.cancel();
    } catch (e) {
      console.warn('[video] cancel at ' + job.providerLabel + ' failed:', e.message);
    }
  }
  console.log(`[${new Date().toISOString().slice(11, 19)}] video canceled ${job.engineLabel} ${job.id} (provider ${job.providerCanceled ? 'stopped it' : 'did not stop it'})`);
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
  const signal = job.ctl.signal;
  let p = await replicateCreate(cfg, engine.model, replicateVideoInput(engine.model, prompt, aspect, duration));
  const id = p.id;
  job.onSubmit(() => replicateCancel(cfg, id));
  const t0 = Date.now();
  while (p.status === 'starting' || p.status === 'processing') {
    setStatus(job, p.status === 'starting' ? 'queued' : 'running');
    if (Date.now() - t0 > MAX_WAIT_MS) throw new ProviderError('timeout', 'The video took longer than 20 minutes, so Alembic gave up waiting.');
    await sleep(3000, signal);
    if (signal.aborted) throw cancelledError();
    p = await replicateGet(cfg, id, signal);
  }
  if (p.status === 'canceled') throw cancelledError();
  if (p.status !== 'succeeded') throw new ProviderError('generation_failed', 'Replicate could not make this video' + (p.error ? ': ' + String(p.error).slice(0, 240) : '.'));
  const url = firstOutput(p.output);
  if (!url) throw new ProviderError('bad_output', 'Replicate finished but returned no video.');
  setStatus(job, 'running');
  const file = await replicateDownload(cfg, url, signal);
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

/**
 * Image-to-video ("Make it move"): the clip starts from the picture, and aspect_ratio "auto"
 * lets its shape follow the picture. fal accepts a base64 data URI for image_url
 * (https://fal.ai/docs/documentation/model-apis/fal-cdn.md); the browser keeps it small.
 */
export function falImageVideoInput(model, prompt, duration, imageUrl) {
  if (/veo3/.test(model)) {
    const d = [4, 6, 8].includes(duration) ? duration : 8;
    return { prompt, image_url: imageUrl, aspect_ratio: 'auto', duration: d + 's', resolution: '720p', generate_audio: true };
  }
  if (/seedance/.test(model)) {
    return { prompt, image_url: imageUrl, aspect_ratio: 'auto', duration: String(Math.min(15, Math.max(4, duration))), resolution: '720p', generate_audio: true };
  }
  if (/grok-imagine/.test(model)) {
    return { prompt, image_url: imageUrl, aspect_ratio: 'auto', duration: Math.min(15, Math.max(1, duration)), resolution: '720p' };
  }
  return { prompt, image_url: imageUrl, duration };
}

async function falVideo(cfg, engine, job, { prompt, aspect, duration, image }) {
  const signal = job.ctl.signal;
  const model = image ? engine.i2vModel : engine.model;
  const input = image
    ? falImageVideoInput(model, prompt, duration, `data:${image.mime};base64,${image.data}`)
    : falVideoInput(model, prompt, aspect, duration);
  const r = await falRun(cfg, model, input, {
    timeoutMs: MAX_WAIT_MS,
    every: 3000,
    signal,
    onSubmit: (sub) => job.onSubmit(() => falCancel(cfg, sub)),
    onStatus: (s) => setStatus(job, s),
  });
  const url = r && r.video && r.video.url;
  if (!url) throw new ProviderError('bad_output', 'fal.ai finished but returned no video.');
  setStatus(job, 'running');
  const file = await downloadUrl(url, { provider: 'fal.ai', signal });
  saveFile(job, file.bytes, file.mime);
}

/* --------------------------------------------------------------- Gemini */
// One long request: Stop drops the connection, but Google may still finish (and bill) the clip.
async function geminiVideo(cfg, engine, job, { prompt, aspect, duration }) {
  const signal = job.ctl.signal;
  job.onSubmit(null);
  setStatus(job, 'running');
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
    signal,
  });
  const media = findMedia(r, 'video');
  if (!media) throw new ProviderError('bad_output', 'Gemini answered without a video. Try rewording the prompt.');
  if (media.data) return saveFile(job, Buffer.from(media.data, 'base64'), media.mime || 'video/mp4');
  let uri = media.uri;
  if (/\/files\/[^/:?]+$/.test(uri)) uri += ':download?alt=media';
  const file = await fetchBytes(uri, { headers: { 'x-goog-api-key': cfg.keys.gemini }, provider: 'Gemini', signal });
  saveFile(job, file.bytes, file.mime);
}
