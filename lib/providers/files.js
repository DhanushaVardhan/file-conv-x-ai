// Gemini Files API: stream a video or audio file from the browser to Gemini so
// the text AI can watch and listen to the whole thing (summaries of lectures,
// meetings, podcasts). Files stay on Google's side for 48 hours.
// Docs: https://ai.google.dev/gemini-api/docs/files
import http from 'node:http';
import https from 'node:https';
import { fetchJson, explain, sleep, ProviderError } from '../http.js';

const MIME_BY_EXT = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mpeg: 'video/mpeg', mpg: 'video/mpeg', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', weba: 'audio/webm',
};

/** The type Gemini should be told, or null if the file is not video/audio. */
export function mediaMime(contentType, fileName) {
  const t = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (/^(video|audio)\//.test(t)) return t;
  const ext = (/\.([a-z0-9]+)$/i.exec(fileName || '') || [])[1];
  return (ext && MIME_BY_EXT[ext.toLowerCase()]) || null;
}

/** POST a stream with exact headers (fetch cannot always set Content-Length for streams). */
function pipeUpload(url, src, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const up = mod.request(u, { method: 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 300) }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data || {});
        else reject(explain('Gemini', { status: res.statusCode }, data, { keyName: 'GEMINI_API_KEY' }));
      });
    });
    up.setTimeout(timeoutMs, () => up.destroy(new Error('timeout')));
    up.on('error', (e) => reject(e.message === 'timeout'
      ? new ProviderError('timeout', 'Uploading to Gemini took too long.', 504)
      : new ProviderError('network', 'Could not upload the file to Gemini (' + (e.code || e.message) + ').')));
    src.on('aborted', () => up.destroy(new Error('client aborted')));
    src.on('error', (e) => up.destroy(e));
    src.pipe(up);
  });
}

/**
 * Upload `src` (the browser's request stream) and wait until Gemini can use it.
 * @returns {Promise<{uri:string, mime:string, name:string, state:string}>}
 */
export async function uploadToGemini(cfg, src, { size, mime, name }) {
  const key = cfg.keys.gemini;
  const base = cfg.bases.gemini;
  // 1. Start a resumable upload session.
  let start;
  try {
    start = await fetch(`${base}/upload/v1beta/files`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'x-goog-upload-protocol': 'resumable',
        'x-goog-upload-command': 'start',
        'x-goog-upload-header-content-length': String(size),
        'x-goog-upload-header-content-type': mime,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: String(name || 'upload').slice(0, 120) } }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw new ProviderError('network', 'Could not reach Gemini to upload the file (' + (e.cause?.code || e.message) + ').');
  }
  if (!start.ok) {
    let body = null;
    try { body = await start.json(); } catch { /* not json */ }
    throw explain('Gemini', start, body, { keyName: 'GEMINI_API_KEY' });
  }
  const uploadUrl = start.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new ProviderError('bad_output', 'Gemini did not return an upload address.');

  // 2. Stream the bytes and finalize.
  const meta = await pipeUpload(uploadUrl, src, {
    'content-length': String(size),
    'x-goog-upload-offset': '0',
    'x-goog-upload-command': 'upload, finalize',
  }, 30 * 60 * 1000);
  let file = meta.file || meta;
  if (!file || !file.name || !file.uri) throw new ProviderError('bad_output', 'Gemini accepted the upload but did not describe the file.');

  // 3. Videos are processed before they can be used: wait for ACTIVE.
  const t0 = Date.now();
  while (file.state === 'PROCESSING') {
    if (Date.now() - t0 > 10 * 60 * 1000) throw new ProviderError('timeout', 'Gemini is still processing this file after 10 minutes. Try a shorter video.', 504);
    await sleep(2500);
    file = await fetchJson(`${base}/v1beta/${file.name}`, {
      headers: { 'x-goog-api-key': key },
      timeout: 30000,
      provider: 'Gemini',
      hint: { keyName: 'GEMINI_API_KEY' },
    });
  }
  if (file.state === 'FAILED') throw new ProviderError('generation_failed', 'Gemini could not process this file. Try an MP4 (H.264) or a common audio format.');
  return { uri: file.uri, mime: file.mimeType || mime, name: file.name, state: file.state || 'ACTIVE' };
}
