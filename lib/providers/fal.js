// fal.ai queue API: submit a job, poll its status, fetch the result.
// Docs: https://docs.fal.ai/model-apis/model-endpoints/queue
import { fetchJson, sleep, ProviderError } from '../http.js';

function auth(cfg) {
  return { authorization: 'Key ' + cfg.keys.fal };
}
function hint(model) {
  return { keyName: 'FAL_KEY', model, modelVar: 'the FAL_*_MODEL setting' };
}

/** Follow-up URLs use only "owner/app" of the model ID, e.g. fal-ai/flux for fal-ai/flux/schnell. */
function appPath(model) {
  return model.split('/').slice(0, 2).join('/');
}

/** Only follow status/result links that point back at the fal queue we submitted to. */
function sameOrigin(cfg, url) {
  try { return new URL(url).origin === new URL(cfg.bases.fal).origin; } catch { return false; }
}

export async function falSubmit(cfg, model, input) {
  const r = await fetchJson(`${cfg.bases.fal}/${model}`, {
    method: 'POST',
    headers: auth(cfg),
    body: input,
    timeout: 60000,
    provider: 'fal.ai',
    hint: hint(model),
  });
  if (!r || !r.request_id) throw new ProviderError('bad_output', 'fal.ai did not accept the job (no request id).');
  const base = `${cfg.bases.fal}/${appPath(model)}/requests/${encodeURIComponent(r.request_id)}`;
  return {
    id: r.request_id,
    statusUrl: r.status_url && sameOrigin(cfg, r.status_url) ? r.status_url : base + '/status',
    responseUrl: r.response_url && sameOrigin(cfg, r.response_url) ? r.response_url : base,
  };
}

/**
 * Submit and wait for the result JSON.
 * onStatus('queued' | 'running') is called while waiting.
 */
export async function falRun(cfg, model, input, { timeoutMs = 180000, every = 1500, onStatus } = {}) {
  const job = await falSubmit(cfg, model, input);
  const t0 = Date.now();
  for (;;) {
    const st = await fetchJson(job.statusUrl, { headers: auth(cfg), timeout: 30000, provider: 'fal.ai', hint: hint(model) });
    const status = st && st.status;
    if (status === 'COMPLETED') {
      if (st.error) throw new ProviderError('generation_failed', 'fal.ai could not finish this: ' + String(st.error).slice(0, 240));
      break;
    }
    if (onStatus) onStatus(status === 'IN_QUEUE' ? 'queued' : 'running');
    if (Date.now() - t0 > timeoutMs) throw new ProviderError('timeout', `fal.ai took longer than ${Math.round(timeoutMs / 60000)} minutes, so Alembic stopped waiting.`, 504);
    await sleep(every);
  }
  return fetchJson(job.responseUrl, { headers: auth(cfg), timeout: 60000, provider: 'fal.ai', hint: hint(model) });
}
