// Text AI: summaries and follow-up questions, prompt help, and the built-in
// image/video engines (vector art, shaders, motion scenes).
// generateText() returns the whole answer; streamText() sends it piece by piece.
import { fetchJson, linkedAbort, readSse, explain, cancelledError, ProviderError } from '../http.js';

/**
 * @param {object} cfg   readConfig() result
 * @param {object} req
 *   prompt   string, or
 *   messages [{role:'user'|'assistant', content:string}] ending on a user turn
 *   images   [{mime, data(base64)}]  attached to the first user turn
 *   files    [{uri, mime}]           Gemini Files API uploads (video/audio), Gemini only
 *   json     ask for a JSON reply
 * @returns {Promise<string>}
 */
export async function generateText(cfg, req) {
  const spec = buildRequest(cfg, req, false);
  const r = await fetchJson(spec.url, { method: 'POST', headers: spec.headers, body: spec.body, timeout: spec.timeout, provider: spec.provider, hint: spec.hint });
  return spec.parse(r);
}

/**
 * Like generateText, but calls onDelta(piece) as the answer arrives.
 * onStart() runs once the provider has accepted the request (before the first piece), so the
 * caller can still answer with a normal error if the provider refuses.
 * @returns {Promise<string>} the whole answer
 */
export async function streamText(cfg, req, { onStart, onDelta, signal } = {}) {
  const spec = buildRequest(cfg, req, true);
  const link = linkedAbort(10 * 60 * 1000, signal);
  let res;
  try {
    res = await fetch(spec.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...spec.headers },
      body: JSON.stringify(spec.body),
      signal: link.signal,
    });
  } catch (e) {
    link.done();
    if (signal && signal.aborted) throw cancelledError();
    if (link.signal.aborted) throw new ProviderError('timeout', `${spec.provider} took too long to answer. Try again.`, 504);
    throw new ProviderError('network', `Could not reach ${spec.provider} (${e.cause?.code || e.message}). Check the server's internet connection.`);
  }
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    link.done();
    throw explain(spec.provider, res, data, spec.hint);
  }
  if (onStart) onStart();
  const state = { text: '', why: '' };
  try {
    await readSse(res.body, (event, data) => {
      let obj;
      try { obj = JSON.parse(data); } catch { return; } // e.g. OpenAI's "[DONE]"
      const piece = spec.delta(event, obj, state);
      if (piece) {
        state.text += piece;
        if (onDelta) onDelta(piece);
      }
    });
  } catch (e) {
    if (signal && signal.aborted) throw cancelledError();
    if (e instanceof ProviderError) throw e;
    if (link.signal.aborted) throw new ProviderError('timeout', `${spec.provider} took too long to answer. Try again.`, 504);
    throw new ProviderError('network', `The connection to ${spec.provider} dropped before the answer finished. Try again.`);
  } finally {
    link.done();
  }
  if (!state.text) throw new ProviderError('empty_completion', `${spec.provider} returned no text${state.why ? ' (' + state.why + ')' : ''}.`);
  return state.text;
}

/** One description of the request per provider, used by both the normal and the streaming call. */
function buildRequest(cfg, { prompt, messages, images = [], files = [], json = false }, stream) {
  const t = cfg.text;
  if (!t) throw new ProviderError('no_ai', 'Text AI is off. Add GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY to .env and restart the server.', 503);
  const turns = messages && messages.length ? messages : [{ role: 'user', content: prompt }];
  if (files.length && t.provider !== 'gemini') {
    throw new ProviderError('bad_request', 'Only Gemini can watch videos and listen to audio. Set GEMINI_API_KEY (and TEXT_PROVIDER=gemini).', 400);
  }
  if (t.provider === 'gemini') return gemini(cfg, t.model, turns, images, files, json, stream);
  if (t.provider === 'anthropic') return anthropic(cfg, t.model, turns, images, stream);
  return openai(cfg, t.model, turns, images, stream);
}

/** Map an error object that arrives inside a stream to a friendly ProviderError. */
function streamError(provider, type, message) {
  const t = String(type || '');
  const detail = message ? ' (' + String(message).slice(0, 240) + ')' : '';
  if (/rate|quota|429|RESOURCE_EXHAUSTED/i.test(t)) return new ProviderError('rate_limited', `${provider} says you are sending requests too quickly or your quota is used up. Wait a minute and try again.${detail}`, 429);
  if (/overload|unavailable|internal|server|5\d\d/i.test(t)) return new ProviderError('upstream_error', `${provider} had a server problem while answering. Try again in a moment.${detail}`);
  return new ProviderError('provider_error', `${provider} stopped while answering${detail || '.'}`);
}

/* ---------------------------------------------------------------- Gemini */
function gemini(cfg, model, turns, images, files, json, stream) {
  const contents = turns.map((m, i) => {
    const parts = [];
    if (i === 0) {
      // Media first, then the words: Google recommends this order.
      for (const f of files) parts.push({ file_data: { mime_type: f.mime, file_uri: f.uri } });
      for (const im of images) parts.push({ inline_data: { mime_type: im.mime, data: im.data } });
    }
    parts.push({ text: m.content });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });
  const body = { contents, generationConfig: { maxOutputTokens: 8192 } };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  const textOf = (r) => {
    const cand = r && r.candidates && r.candidates[0];
    return ((cand && cand.content && cand.content.parts) || [])
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text)
      .join('');
  };
  return {
    provider: 'Gemini',
    // Streaming: each SSE "data:" line is a GenerateContentResponse chunk; the stream ends by closing.
    url: `${cfg.bases.gemini}/v1beta/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
    headers: { 'x-goog-api-key': cfg.keys.gemini },
    body,
    timeout: files.length ? 300000 : 180000,
    hint: { keyName: 'GEMINI_API_KEY', model, modelVar: 'GEMINI_TEXT_MODEL' },
    parse(r) {
      const text = textOf(r);
      if (!text) {
        const cand = r && r.candidates && r.candidates[0];
        const why = (r && r.promptFeedback && r.promptFeedback.blockReason) || (cand && cand.finishReason);
        throw new ProviderError('empty_completion', 'Gemini returned no text' + (why ? ' (' + why + ').' : '.'));
      }
      return text;
    },
    delta(_event, obj, state) {
      if (obj.error) throw streamError('Gemini', obj.error.status || obj.error.code, obj.error.message);
      const cand = obj.candidates && obj.candidates[0];
      const why = (obj.promptFeedback && obj.promptFeedback.blockReason) || (cand && cand.finishReason);
      if (why && why !== 'STOP') state.why = why;
      return textOf(obj);
    },
  };
}

/* ---------------------------------------------------------------- Claude */
function anthropic(cfg, model, turns, images, stream) {
  const messages = turns.map((m, i) => {
    const content = [];
    if (i === 0) for (const im of images) content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } });
    content.push({ type: 'text', text: m.content });
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
  });
  const body = { model, max_tokens: 8000, messages };
  if (stream) body.stream = true;
  return {
    provider: 'Claude',
    url: `${cfg.bases.anthropic}/v1/messages`,
    headers: { 'x-api-key': cfg.keys.anthropic, 'anthropic-version': '2023-06-01' },
    body,
    timeout: 180000,
    hint: { keyName: 'ANTHROPIC_API_KEY', model, modelVar: 'ANTHROPIC_TEXT_MODEL' },
    parse(r) {
      const text = ((r && r.content) || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (!text) throw new ProviderError('empty_completion', 'Claude returned no text' + (r && r.stop_reason ? ' (' + r.stop_reason + ').' : '.'));
      return text;
    },
    // Events: message_start, content_block_start/delta/stop, message_delta, message_stop, ping, error.
    // Only text_delta is answer text; thinking_delta and signature_delta are skipped.
    delta(_event, obj, state) {
      if (obj.type === 'error') throw streamError('Claude', obj.error && obj.error.type, obj.error && obj.error.message);
      if (obj.type === 'message_delta' && obj.delta && obj.delta.stop_reason && obj.delta.stop_reason !== 'end_turn') state.why = obj.delta.stop_reason;
      if (obj.type === 'content_block_delta' && obj.delta && obj.delta.type === 'text_delta') return obj.delta.text || '';
      return '';
    },
  };
}

/* ---------------------------------------------------------------- OpenAI */
function openai(cfg, model, turns, images, stream) {
  const input = turns.map((m, i) => {
    if (m.role === 'assistant') return { role: 'assistant', content: [{ type: 'output_text', text: m.content }] };
    const content = [{ type: 'input_text', text: m.content }];
    if (i === 0) for (const im of images) content.push({ type: 'input_image', image_url: `data:${im.mime};base64,${im.data}` });
    return { role: 'user', content };
  });
  const body = { model, reasoning: { effort: 'low' }, max_output_tokens: 16000, input };
  if (stream) body.stream = true;
  return {
    provider: 'OpenAI',
    url: `${cfg.bases.openai}/v1/responses`,
    headers: { authorization: 'Bearer ' + cfg.keys.openai },
    body,
    timeout: 180000,
    hint: { keyName: 'OPENAI_API_KEY', model, modelVar: 'OPENAI_TEXT_MODEL' },
    parse(r) {
      let text = '';
      for (const item of (r && r.output) || []) {
        if (item.type !== 'message') continue;
        for (const c of item.content || []) if (c.type === 'output_text' && typeof c.text === 'string') text += c.text;
      }
      if (!text) throw new ProviderError('empty_completion', 'OpenAI returned no text' + (r && r.incomplete_details ? ' (' + r.incomplete_details.reason + ').' : '.'));
      return text;
    },
    // Answer text arrives as response.output_text.delta; reasoning summaries use other event types.
    delta(_event, obj, state) {
      if (obj.type === 'response.output_text.delta') return typeof obj.delta === 'string' ? obj.delta : '';
      if (obj.type === 'response.failed') {
        const err = obj.response && obj.response.error;
        throw streamError('OpenAI', err && err.code, err && err.message);
      }
      if (obj.type === 'error') throw streamError('OpenAI', obj.code || (obj.error && obj.error.code), obj.message || (obj.error && obj.error.message));
      if (obj.type === 'response.incomplete') {
        const d = obj.response && obj.response.incomplete_details;
        state.why = (d && d.reason) || 'incomplete';
      }
      return '';
    },
  };
}
