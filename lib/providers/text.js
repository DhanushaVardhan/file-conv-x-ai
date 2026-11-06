// Text AI: summaries and follow-up questions, prompt help, and the built-in
// image/video engines (vector art, shaders, motion scenes).
import { fetchJson, ProviderError } from '../http.js';

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
export async function generateText(cfg, { prompt, messages, images = [], files = [], json = false }) {
  const t = cfg.text;
  if (!t) throw new ProviderError('no_ai', 'Text AI is off. Add GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY to .env and restart the server.', 503);
  const turns = messages && messages.length ? messages : [{ role: 'user', content: prompt }];
  if (files.length && t.provider !== 'gemini') {
    throw new ProviderError('bad_request', 'Only Gemini can watch videos and listen to audio. Set GEMINI_API_KEY (and TEXT_PROVIDER=gemini).', 400);
  }
  if (t.provider === 'gemini') return gemini(cfg, t.model, turns, images, files, json);
  if (t.provider === 'anthropic') return anthropic(cfg, t.model, turns, images);
  return openai(cfg, t.model, turns, images);
}

async function gemini(cfg, model, turns, images, files, json) {
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
  const r = await fetchJson(`${cfg.bases.gemini}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': cfg.keys.gemini },
    body,
    timeout: files.length ? 300000 : 180000,
    provider: 'Gemini',
    hint: { keyName: 'GEMINI_API_KEY', model, modelVar: 'GEMINI_TEXT_MODEL' },
  });
  const cand = r && r.candidates && r.candidates[0];
  const text = ((cand && cand.content && cand.content.parts) || [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  if (!text) {
    const why = (r && r.promptFeedback && r.promptFeedback.blockReason) || (cand && cand.finishReason);
    throw new ProviderError('empty_completion', 'Gemini returned no text' + (why ? ' (' + why + ').' : '.'));
  }
  return text;
}

async function anthropic(cfg, model, turns, images) {
  const messages = turns.map((m, i) => {
    const content = [];
    if (i === 0) for (const im of images) content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } });
    content.push({ type: 'text', text: m.content });
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content };
  });
  const r = await fetchJson(`${cfg.bases.anthropic}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': cfg.keys.anthropic, 'anthropic-version': '2023-06-01' },
    body: { model, max_tokens: 8000, messages },
    timeout: 180000,
    provider: 'Claude',
    hint: { keyName: 'ANTHROPIC_API_KEY', model, modelVar: 'ANTHROPIC_TEXT_MODEL' },
  });
  const text = ((r && r.content) || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) throw new ProviderError('empty_completion', 'Claude returned no text' + (r && r.stop_reason ? ' (' + r.stop_reason + ').' : '.'));
  return text;
}

async function openai(cfg, model, turns, images) {
  const input = turns.map((m, i) => {
    if (m.role === 'assistant') return { role: 'assistant', content: [{ type: 'output_text', text: m.content }] };
    const content = [{ type: 'input_text', text: m.content }];
    if (i === 0) for (const im of images) content.push({ type: 'input_image', image_url: `data:${im.mime};base64,${im.data}` });
    return { role: 'user', content };
  });
  const r = await fetchJson(`${cfg.bases.openai}/v1/responses`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + cfg.keys.openai },
    body: { model, reasoning: { effort: 'low' }, max_output_tokens: 16000, input },
    timeout: 180000,
    provider: 'OpenAI',
    hint: { keyName: 'OPENAI_API_KEY', model, modelVar: 'OPENAI_TEXT_MODEL' },
  });
  let text = '';
  for (const item of (r && r.output) || []) {
    if (item.type !== 'message') continue;
    for (const c of item.content || []) if (c.type === 'output_text' && typeof c.text === 'string') text += c.text;
  }
  if (!text) throw new ProviderError('empty_completion', 'OpenAI returned no text' + (r && r.incomplete_details ? ' (' + r.incomplete_details.reason + ').' : '.'));
  return text;
}
