// Image generation: fal.ai, Cloudflare Workers AI, Replicate, OpenAI, Gemini and Pollinations.
import { fetchJson, fetchBytes, downloadUrl, findMedia, sniffImageMime, sleep, ProviderError } from '../http.js';
import { falRun } from './fal.js';

const ASPECTS = ['1:1', '16:9', '9:16', '4:3'];

/** @returns {Promise<{mime:string, data:string}>} base64 image */
export async function generateImage(cfg, engine, { prompt, aspect }) {
  if (!ASPECTS.includes(aspect)) aspect = '1:1';
  if (engine.aspects && !engine.aspects.includes(aspect)) aspect = engine.aspects[0];
  switch (engine.provider) {
    case 'fal': return falImage(cfg, engine, prompt, aspect);
    case 'cloudflare': return cloudflareImage(cfg, engine, prompt, aspect);
    case 'replicate': return replicateImage(cfg, engine, prompt, aspect);
    case 'gemini': return geminiImage(cfg, engine, prompt, aspect);
    case 'openai': return openaiImage(cfg, engine, prompt, aspect);
    case 'pollinations': return pollinationsImage(cfg, engine, prompt, aspect);
    case 'pollinations-free': return pollinationsFree(cfg, prompt, aspect);
    default: throw new ProviderError('bad_engine', 'Unknown image engine.', 400);
  }
}

function asImage(file, fallback = 'image/png') {
  const mime = file.mime && file.mime.startsWith('image/') ? file.mime : sniffImageMime(file.bytes) || fallback;
  return { mime, data: file.bytes.toString('base64') };
}

/* ---------------------------------------------------------------- fal.ai */
const FAL_FLUX_SIZE = { '1:1': 'square_hd', '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '4:3': 'landscape_4_3' };
// Seedream 5 Lite works natively between about 3.7 and 16.7 megapixels.
const FAL_SEEDREAM_SIZE = { '1:1': [2048, 2048], '16:9': [2560, 1440], '9:16': [1440, 2560], '4:3': [2304, 1728] };

export function falImageInput(model, prompt, aspect) {
  if (/seedream/.test(model)) {
    const [width, height] = FAL_SEEDREAM_SIZE[aspect];
    return { prompt, image_size: { width, height }, num_images: 1, enable_safety_checker: true };
  }
  if (/flux/.test(model)) {
    return { prompt, image_size: FAL_FLUX_SIZE[aspect], num_inference_steps: 4, num_images: 1, output_format: 'jpeg', enable_safety_checker: true };
  }
  return { prompt, image_size: FAL_FLUX_SIZE[aspect], num_images: 1 };
}

async function falImage(cfg, engine, prompt, aspect) {
  const r = await falRun(cfg, engine.model, falImageInput(engine.model, prompt, aspect), { timeoutMs: 180000, every: 1200 });
  const url = r && r.images && r.images[0] && r.images[0].url;
  if (!url) throw new ProviderError('bad_output', 'fal.ai finished but returned no image' + (r && r.has_nsfw_concepts && r.has_nsfw_concepts[0] ? ' (it was blocked by the safety filter).' : '.'));
  return asImage(await downloadUrl(url, { provider: 'fal.ai' }), 'image/jpeg');
}

/* ------------------------------------------------- Cloudflare Workers AI */
// Lucid Origin takes any width/height up to 2500; FLUX Schnell on Cloudflare is square only.
const LUCID_SIZE = { '1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344], '4:3': [1280, 960] };

export function cloudflareImageInput(model, prompt, aspect) {
  if (/lucid-origin/.test(model)) {
    const [width, height] = LUCID_SIZE[aspect];
    return { prompt, width, height };
  }
  return { prompt: prompt.slice(0, 2048), steps: 6 };
}

async function cloudflareImage(cfg, engine, prompt, aspect) {
  const url = `${cfg.bases.cloudflare}/client/v4/accounts/${encodeURIComponent(cfg.keys.cfAccount)}/ai/run/${engine.model}`;
  const r = await fetchJson(url, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + cfg.keys.cfToken },
    body: cloudflareImageInput(engine.model, prompt, aspect),
    timeout: 120000,
    provider: 'Cloudflare Workers AI',
    hint: { keyName: 'CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID)', model: engine.model, modelVar: engine.modelEnv },
  });
  const b64 = (r && r.result && r.result.image) || (r && r.image);
  if (typeof b64 !== 'string' || !b64) throw new ProviderError('bad_output', 'Cloudflare finished but returned no image.');
  return { mime: sniffImageMime(b64), data: b64 };
}

/* ------------------------------------------------------------- Replicate */
export async function replicateCreate(cfg, model, input, { wait } = {}) {
  const headers = { authorization: 'Bearer ' + cfg.keys.replicate };
  if (wait) headers.prefer = 'wait=' + wait;
  return fetchJson(`${cfg.bases.replicate}/v1/models/${model}/predictions`, {
    method: 'POST',
    headers,
    body: { input },
    timeout: ((wait || 0) + 30) * 1000,
    provider: 'Replicate',
    hint: { keyName: 'REPLICATE_API_TOKEN', model, modelVar: 'the REPLICATE_* model setting' },
  });
}
export async function replicateGet(cfg, id, signal) {
  return fetchJson(`${cfg.bases.replicate}/v1/predictions/${encodeURIComponent(id)}`, {
    headers: { authorization: 'Bearer ' + cfg.keys.replicate },
    timeout: 30000,
    provider: 'Replicate',
    hint: { keyName: 'REPLICATE_API_TOKEN' },
    signal,
  });
}
/**
 * Cancel a prediction: POST /v1/predictions/{id}/cancel (https://replicate.com/docs/reference/http).
 * @returns {Promise<boolean>} false when it had already finished
 */
export async function replicateCancel(cfg, id) {
  const p = await fetchJson(`${cfg.bases.replicate}/v1/predictions/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + cfg.keys.replicate },
    timeout: 15000,
    provider: 'Replicate',
    hint: { keyName: 'REPLICATE_API_TOKEN' },
  });
  return !(p && (p.status === 'succeeded' || p.status === 'failed'));
}
export function firstOutput(out) {
  if (!out) return null;
  if (typeof out === 'string') return out;
  if (Array.isArray(out)) return firstOutput(out[0]);
  if (typeof out === 'object') return out.url || out.uri || firstOutput(Object.values(out)[0]);
  return null;
}
/** Download a Replicate output (URL or data: URI). */
export async function replicateDownload(cfg, url, signal) {
  try {
    return await downloadUrl(url, { headers: url.startsWith('data:') ? {} : { authorization: 'Bearer ' + cfg.keys.replicate }, provider: 'Replicate', signal });
  } catch (e) {
    if (url.startsWith('data:') || e.code === 'cancelled') throw e;
    return downloadUrl(url, { provider: 'Replicate', signal });
  }
}
export function replicateImageInput(model, prompt, aspect) {
  if (/flux-schnell/.test(model)) return { prompt, aspect_ratio: aspect, num_outputs: 1, output_format: 'webp', output_quality: 90, go_fast: true };
  if (/flux-2/.test(model)) return { prompt, aspect_ratio: aspect, resolution: '1 MP', output_format: 'webp', output_quality: 90, safety_tolerance: 2 };
  if (/nano-banana/.test(model)) return { prompt, aspect_ratio: aspect, resolution: '1K', output_format: 'jpg' };
  return { prompt, aspect_ratio: aspect };
}
async function replicateImage(cfg, engine, prompt, aspect) {
  let p = await replicateCreate(cfg, engine.model, replicateImageInput(engine.model, prompt, aspect), { wait: 60 });
  const t0 = Date.now();
  while (p && (p.status === 'starting' || p.status === 'processing')) {
    if (Date.now() - t0 > 180000) throw new ProviderError('timeout', 'Replicate is taking unusually long. Try again in a minute.', 504);
    await sleep(1500);
    p = await replicateGet(cfg, p.id);
  }
  if (!p || p.status !== 'succeeded') throw new ProviderError('generation_failed', 'Replicate could not make this image' + (p && p.error ? ': ' + String(p.error).slice(0, 200) : '.'));
  const url = firstOutput(p.output);
  if (!url) throw new ProviderError('bad_output', 'Replicate finished but returned no image.');
  return asImage(await replicateDownload(cfg, url), 'image/webp');
}

/* ---------------------------------------------------------------- Gemini */
async function geminiImage(cfg, engine, prompt, aspect) {
  const headers = { 'x-goog-api-key': cfg.keys.gemini };
  const hint = { keyName: 'GEMINI_API_KEY', model: engine.model, modelVar: 'GEMINI_IMAGE_MODEL' };
  let r;
  try {
    r = await fetchJson(`${cfg.bases.gemini}/v1beta/interactions`, {
      method: 'POST',
      headers,
      body: { model: engine.model, input: [{ type: 'text', text: prompt }], response_format: { type: 'image', aspect_ratio: aspect, image_size: '1K' }, store: false },
      timeout: 180000,
      provider: 'Gemini',
      hint,
    });
  } catch (e) {
    if (!(e instanceof ProviderError) || !['model_missing', 'provider_error'].includes(e.code)) throw e;
    // Older style call, kept as a fallback.
    r = await fetchJson(`${cfg.bases.gemini}/v1beta/models/${encodeURIComponent(engine.model)}:generateContent`, {
      method: 'POST',
      headers,
      body: { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } } },
      timeout: 180000,
      provider: 'Gemini',
      hint,
    });
  }
  const media = findMedia(r, 'image');
  if (!media || !media.data) throw new ProviderError('bad_output', 'Gemini answered without an image. Try rewording the prompt.');
  return { mime: media.mime || 'image/png', data: media.data };
}

/* ---------------------------------------------------------------- OpenAI */
async function openaiImage(cfg, engine, prompt, aspect) {
  const size = aspect === '1:1' ? '1024x1024' : aspect === '9:16' ? '1024x1536' : '1536x1024';
  const r = await fetchJson(`${cfg.bases.openai}/v1/images/generations`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + cfg.keys.openai },
    body: { model: engine.model, prompt, size, quality: engine.quality || 'medium', n: 1, output_format: 'webp' },
    timeout: 240000,
    provider: 'OpenAI',
    hint: { keyName: 'OPENAI_API_KEY', model: engine.model, modelVar: 'OPENAI_IMAGE_MODEL' },
  });
  const b64 = r && r.data && r.data[0] && r.data[0].b64_json;
  if (!b64) throw new ProviderError('bad_output', 'OpenAI returned no image.');
  return { mime: 'image/webp', data: b64 };
}

/* ---------------------------------------------------------- Pollinations */
const POLL_SIZE = { '1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344], '4:3': [1152, 864] };
async function pollinationsImage(cfg, engine, prompt, aspect) {
  const [w, h] = POLL_SIZE[aspect];
  const seed = Math.floor(Math.random() * 1e9);
  const url = `${cfg.bases.pollinations}/image/${encodeURIComponent(prompt.slice(0, 1500))}?model=${encodeURIComponent(engine.model)}&width=${w}&height=${h}&seed=${seed}`;
  const file = await fetchBytes(url, { headers: { authorization: 'Bearer ' + cfg.keys.pollinations }, provider: 'Pollinations', timeout: 180000 });
  if (!file.mime.startsWith('image/')) throw new ProviderError('bad_output', 'Pollinations did not return an image.');
  return { mime: file.mime, data: file.bytes.toString('base64') };
}

// The keyless "classic" endpoint allows one request per IP every ~45 s.
const FREE_SIZE = { '1:1': [768, 768], '16:9': [768, 432], '9:16': [432, 768], '4:3': [768, 576] };
let lastFree = 0;
async function pollinationsFree(cfg, prompt, aspect) {
  const wait = 46000 - (Date.now() - lastFree);
  if (wait > 0) throw new ProviderError('rate_limited', `The free demo engine allows one image every 45 seconds. Try again in ${Math.ceil(wait / 1000)} s, or add an API key for faster, sharper images.`, 429);
  lastFree = Date.now();
  const [w, h] = FREE_SIZE[aspect];
  const seed = Math.floor(Math.random() * 1e9);
  const url = `${cfg.bases.pollinationsFree}/prompt/${encodeURIComponent(prompt.slice(0, 800))}?width=${w}&height=${h}&seed=${seed}`;
  const file = await fetchBytes(url, { provider: 'the free demo engine (Pollinations)', timeout: 120000 });
  if (!file.mime.startsWith('image/')) throw new ProviderError('bad_output', 'The free demo engine did not return an image. It may be busy; try again later or add an API key.');
  return { mime: file.mime, data: file.bytes.toString('base64') };
}
