// Small helpers for calling AI providers with plain fetch (Node 18+).

export class ProviderError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Turn a provider's HTTP failure into a message a person can act on. */
export function explain(provider, res, body, hint = {}) {
  let raw = body && (body.error?.message || body.detail || body.message || body.error || body.title || body.errors?.[0]?.message);
  // fal returns validation problems as [{loc, msg}].
  if (Array.isArray(raw)) raw = raw.map((d) => (d && (d.msg || d.message)) || '').filter(Boolean).join('; ');
  const detail = typeof raw === 'string' ? raw.slice(0, 300) : '';
  const s = res.status;
  if (s === 401 || s === 403) return new ProviderError('bad_key', `${provider} rejected the API key. Check ${hint.keyName || 'the key'} in .env.${detail ? ' (' + detail + ')' : ''}`);
  if (s === 402) return new ProviderError('billing', `${provider} needs credit or billing on your account before it can run this.${detail ? ' (' + detail + ')' : ''}`);
  if (s === 404) return new ProviderError('model_missing', `${provider} could not find the model "${hint.model || '?'}". It may have been renamed or retired; set ${hint.modelVar || 'the model name'} in .env.${detail ? ' (' + detail + ')' : ''}`);
  if (s === 429) return new ProviderError('rate_limited', `${provider} says you are sending requests too quickly or your quota is used up. Wait a minute and try again.${detail ? ' (' + detail + ')' : ''}`, 429);
  if (s >= 500) return new ProviderError('upstream_error', `${provider} had a server problem (${s}). Try again in a moment.`);
  return new ProviderError('provider_error', `${provider} refused the request (${s})${detail ? ': ' + detail : '.'}`);
}

/** The error every provider call throws once its `signal` is aborted (Stop pressed, job cancelled). */
export function cancelledError() {
  return new ProviderError('cancelled', 'Stopped.', 499);
}

/** An AbortController that fires on `timeout` or when the caller's `signal` aborts. */
export function linkedAbort(timeout, signal) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeout);
  const onAbort = () => ctl.abort(new Error('cancelled'));
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctl.signal,
    done() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    },
  };
}

export async function fetchJson(url, { method = 'GET', headers = {}, body, timeout = 120000, provider = 'The AI service', hint, signal } = {}) {
  const link = linkedAbort(timeout, signal);
  let res;
  let text = '';
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json', ...headers } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: link.signal,
      redirect: 'follow',
    });
    text = await res.text().catch(() => '');
  } catch (e) {
    if (signal && signal.aborted) throw cancelledError();
    if (link.signal.aborted) throw new ProviderError('timeout', `${provider} took too long to answer. Try again.`, 504);
    throw new ProviderError('network', `Could not reach ${provider} (${e.cause?.code || e.message}). Check the server's internet connection.`);
  } finally {
    link.done();
  }
  if (signal && signal.aborted) throw cancelledError();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text.slice(0, 300) }; }
  if (!res.ok) throw explain(provider, res, data, hint);
  return data;
}

export async function fetchBytes(url, { headers = {}, timeout = 300000, provider = 'The AI service', signal } = {}) {
  const link = linkedAbort(timeout, signal);
  try {
    const res = await fetch(url, { headers, signal: link.signal, redirect: 'follow' });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch { /* not json */ }
      throw explain(provider, res, body);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { bytes: buf, mime: (res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim() };
  } catch (e) {
    if (signal && signal.aborted) throw cancelledError();
    if (e instanceof ProviderError) throw e;
    if (link.signal.aborted) throw new ProviderError('timeout', `Downloading the result from ${provider} took too long.`, 504);
    throw new ProviderError('network', `Could not download the result from ${provider}.`);
  } finally {
    link.done();
  }
}

/**
 * Read a server-sent-event stream (a fetch Response body) and call onEvent(name, data)
 * for every event. Handles LF and CRLF line endings and multi-line data.
 * onEvent may throw to stop reading.
 */
export async function readSse(body, onEvent) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let carry = '';
  const dispatch = (block) => {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i === -1 ? line : line.slice(0, i);
      let value = i === -1 ? '' : line.slice(i + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) onEvent(event, data.join('\n'));
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      let text = carry + (done ? dec.decode() : dec.decode(value, { stream: true }));
      carry = '';
      if (!done && text.endsWith('\r')) { carry = '\r'; text = text.slice(0, -1); }
      buf += text.replace(/\r\n?/g, '\n');
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (block.trim()) dispatch(block);
      }
      if (done) break;
    }
    if (buf.trim()) dispatch(buf);
  } catch (e) {
    reader.cancel().catch(() => {});
    throw e;
  }
}

/** Wait `ms`, or less if `signal` aborts first (the caller then checks the signal). */
export const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal && signal.aborted) return resolve();
  const done = () => {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', done);
    resolve();
  };
  const timer = setTimeout(done, ms);
  if (signal) signal.addEventListener('abort', done, { once: true });
});

/** Download a result file: an https URL or a data: URI. */
export async function downloadUrl(url, { headers = {}, provider = 'The AI service', timeout, signal } = {}) {
  if (typeof url !== 'string' || !url) throw new ProviderError('bad_output', `${provider} finished but returned no file.`);
  if (url.startsWith('data:')) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new ProviderError('bad_output', `${provider} returned an unreadable file.`);
    return { bytes: m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3])), mime: m[1] || 'application/octet-stream' };
  }
  if (!/^https?:\/\//.test(url)) throw new ProviderError('bad_output', `${provider} returned a file link Alembic cannot open.`);
  return fetchBytes(url, { headers, provider, timeout, signal });
}

/** Work out an image's type from its first bytes (some APIs do not say). */
export function sniffImageMime(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf).slice(0, 32), 'base64');
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.slice(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  return 'image/png';
}

/**
 * Find the first media blob of a kind ('image' | 'video') anywhere in a JSON response.
 * Handles {type:'image', data, mime_type}, {inlineData:{mimeType,data}}, {inline_data:{...}}, and {uri}.
 */
export function findMedia(node, kind, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return null;
  const mimeOf = (o) => o.mime_type || o.mimeType || o.media_type || '';
  for (const key of ['inlineData', 'inline_data']) {
    const b = node[key];
    if (b && typeof b.data === 'string' && mimeOf(b).startsWith(kind + '/')) return { data: b.data, mime: mimeOf(b) };
  }
  if ((node.type === kind || mimeOf(node).startsWith(kind + '/')) && (typeof node.data === 'string' || typeof node.uri === 'string')) {
    return { data: node.data, uri: node.uri, mime: mimeOf(node) || (kind === 'video' ? 'video/mp4' : 'image/png') };
  }
  const kids = Array.isArray(node) ? node : Object.values(node);
  for (const k of kids) {
    const hit = findMedia(k, kind, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Collect visible text from a Gemini Interactions or generateContent response. */
export function findText(node, depth = 0, out = []) {
  if (!node || typeof node !== 'object' || depth > 12) return out;
  if (Array.isArray(node)) { for (const k of node) findText(k, depth + 1, out); return out; }
  if (node.thought === true || node.type === 'thought') return out;
  if (typeof node.text === 'string' && (node.type === undefined || node.type === 'text' || node.type === 'output_text')) out.push(node.text);
  for (const [k, v] of Object.entries(node)) if (k !== 'text' && v && typeof v === 'object') findText(v, depth + 1, out);
  return out;
}
