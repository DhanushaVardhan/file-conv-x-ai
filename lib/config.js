// Reads .env (no dependency needed) and works out which AI engines are switched on.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { IMAGE_ENGINES, VIDEO_ENGINES } from './catalog.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

export function loadEnvFile(path = join(root, '.env')) {
  if (!existsSync(path)) return false;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/(^|\s+)#.*$/, ''); // "KEY=   # comment" means empty
    // Real environment variables win over the file (handy on hosting dashboards).
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return true;
}

const on = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const env = (k, d = '') => (process.env[k] || '').trim() || d;

export function readConfig() {
  const keys = {
    gemini: env('GEMINI_API_KEY') || env('GOOGLE_API_KEY'),
    anthropic: env('ANTHROPIC_API_KEY'),
    openai: env('OPENAI_API_KEY'),
    replicate: env('REPLICATE_API_TOKEN'),
    fal: env('FAL_KEY'),
    cfAccount: env('CLOUDFLARE_ACCOUNT_ID'),
    cfToken: env('CLOUDFLARE_API_TOKEN'),
    pollinations: env('POLLINATIONS_API_KEY'),
  };
  const geminiBilling = on(env('GEMINI_BILLING'));

  // ---- Text (summaries, prompt help, the built-in engines)
  const textOrder = ['gemini', 'anthropic', 'openai'];
  const wantText = env('TEXT_PROVIDER').toLowerCase();
  const textProvider = (textOrder.includes(wantText) && keys[wantText] ? wantText : textOrder.find((p) => keys[p])) || null;
  const TEXT = {
    gemini: { label: 'Gemini', model: env('GEMINI_TEXT_MODEL', 'gemini-3.5-flash-lite') },
    anthropic: { label: 'Claude', model: env('ANTHROPIC_TEXT_MODEL', 'claude-haiku-5-5') },
    openai: { label: 'OpenAI', model: env('OPENAI_TEXT_MODEL', 'gpt-6-luna') },
  };
  const text = textProvider
    ? {
      provider: textProvider,
      ...TEXT[textProvider],
      vision: true,
      maxImages: 16,
      // Only Gemini can watch a whole video or listen to audio (through its Files API).
      media: textProvider === 'gemini',
    }
    : null;

  // ---- Which providers have the keys they need
  const ready = {
    fal: !!keys.fal,
    cloudflare: !!(keys.cfAccount && keys.cfToken),
    replicate: !!keys.replicate,
    openai: !!keys.openai,
    gemini: !!keys.gemini && geminiBilling,
    pollinations: !!keys.pollinations,
    'pollinations-free': false,
  };
  const wantImage = env('IMAGE_PROVIDER').toLowerCase();
  const wantVideo = env('VIDEO_PROVIDER').toLowerCase();
  const resolve = (list, want) => list.map((e) => ({
    ...e,
    model: (e.modelEnv && env(e.modelEnv)) || e.model,
    available: !!ready[e.provider] && (!want || e.provider.startsWith(want)),
  }));

  const imageCatalog = resolve(IMAGE_ENGINES, wantImage);
  // The keyless demo engine only appears when nothing better is configured.
  const free = imageCatalog.find((e) => e.provider === 'pollinations-free');
  if (free) free.available = env('POLLINATIONS_FREE', 'on').toLowerCase() !== 'off' && !imageCatalog.some((e) => e.available);
  const videoCatalog = resolve(VIDEO_ENGINES, wantVideo);

  // Base URLs can be pointed at a proxy (or a local mock while testing).
  const bases = {
    gemini: env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com'),
    anthropic: env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
    openai: env('OPENAI_BASE_URL', 'https://api.openai.com'),
    replicate: env('REPLICATE_BASE_URL', 'https://api.replicate.com'),
    fal: env('FAL_BASE_URL', 'https://queue.fal.run'),
    cloudflare: env('CLOUDFLARE_BASE_URL', 'https://api.cloudflare.com'),
    pollinations: env('POLLINATIONS_BASE_URL', 'https://gen.pollinations.ai'),
    pollinationsFree: env('POLLINATIONS_FREE_BASE_URL', 'https://image.pollinations.ai'),
  };

  return {
    root,
    bases,
    port: Number(env('PORT', '3000')) || 3000,
    host: env('HOST', '0.0.0.0'),
    accessCode: env('ACCESS_CODE'),
    aiPerMinute: Math.max(1, Number(env('AI_REQUESTS_PER_MINUTE', '30')) || 30),
    maxUploadMB: Math.min(2000, Math.max(1, Number(env('MAX_UPLOAD_MB', '1024')) || 1024)),
    keys,
    text,
    imageCatalog,
    videoCatalog,
    imageEngines: imageCatalog.filter((e) => e.available),
    videoEngines: videoCatalog.filter((e) => e.available),
  };
}
