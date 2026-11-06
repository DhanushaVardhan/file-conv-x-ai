// Every server-side image and video engine Alembic knows about.
// config.js decides which are switched on (by API keys); the browser shows the
// rest as "locked" cards that say which key unlocks them.
//
// To add an engine: add an entry here, then handle its provider/model in
// lib/providers/image.js or lib/providers/video.js. Model IDs can be changed
// without code edits through the environment variable named in `modelEnv`.
// A video engine with `i2v` can also start from a picture ("Make it move").

const ALL = ['1:1', '16:9', '9:16', '4:3'];

// Prices: USD per image or per second of video, from each provider's model page on
// 6 Nov 2026 (approx: true = worked out for the size Alembic asks for). Prices change, so the
// app shows them as estimates; an engine without `price` is shown without one.
//   fal FLUX.1 Schnell  $0.003 per megapixel, rounded up (1024 x 1024 counts as 2)
//   Seedream 5 Lite     $0.035 per image
//   Lucid Origin        $0.007 per 512 px tile + $0.000132 per step, after 10,000 free neurons a day
//   CF FLUX.1 Schnell   $0.0000528 per tile + $0.0001056 per step
//   FLUX.2 Pro          about $0.03 for 1 MP (seen 5 Nov 2026)
//   Grok Imagine Video  $0.07 per second at 720p
//   Seedance 2.0        $0.3034 per second at 720p with audio (the page also quotes a per-token price)
//   Veo 3.1 Fast (fal)  $0.15 per second with audio at 720p
//   P-Video             $0.02 per second at 720p;  MiniMax H3  $0.08 per second at 768P

export const PROVIDERS = {
  fal: { label: 'fal.ai', needs: ['FAL_KEY'], keysUrl: 'https://fal.ai/dashboard/keys' },
  cloudflare: { label: 'Cloudflare Workers AI', needs: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'], keysUrl: 'https://dash.cloudflare.com/profile/api-tokens' },
  replicate: { label: 'Replicate', needs: ['REPLICATE_API_TOKEN'], keysUrl: 'https://replicate.com/account/api-tokens' },
  openai: { label: 'OpenAI', needs: ['OPENAI_API_KEY'], keysUrl: 'https://platform.openai.com/api-keys' },
  gemini: { label: 'Google Gemini', needs: ['GEMINI_API_KEY', 'GEMINI_BILLING=on'], keysUrl: 'https://aistudio.google.com/apikey' },
  pollinations: { label: 'Pollinations', needs: ['POLLINATIONS_API_KEY'], keysUrl: 'https://enter.pollinations.ai' },
  'pollinations-free': { label: 'Pollinations (free demo)', needs: [], keysUrl: '' },
};

export const IMAGE_ENGINES = [
  {
    id: 'fal:flux-schnell', provider: 'fal', label: 'FLUX.1 Schnell',
    model: 'fal-ai/flux/schnell', modelEnv: 'FAL_FLUX_MODEL',
    bestFor: 'Fast, sharp photos and art in a few seconds', badges: ['Photo-real', 'Fast'], aspects: ALL,
    price: { usd: 0.006, per: 'image', approx: true },
  },
  {
    id: 'fal:seedream', provider: 'fal', label: 'Seedream 5 Lite',
    model: 'fal-ai/bytedance/seedream/v5/lite/text-to-image', modelEnv: 'FAL_SEEDREAM_MODEL',
    bestFor: 'Detailed 2K images, posters and lettering', badges: ['Photo-real', '2K'], aspects: ALL,
    price: { usd: 0.035, per: 'image' },
  },
  {
    id: 'cloudflare:lucid', provider: 'cloudflare', label: 'Lucid Origin',
    model: '@cf/leonardo/lucid-origin', modelEnv: 'CLOUDFLARE_LUCID_MODEL',
    bestFor: 'Polished, colourful images by Leonardo', badges: ['Free daily quota'], aspects: ALL,
    price: { usd: 0.03, per: 'image', approx: true, freeDaily: true },
  },
  {
    id: 'cloudflare:flux', provider: 'cloudflare', label: 'FLUX.1 Schnell · CF',
    model: '@cf/black-forest-labs/flux-1-schnell', modelEnv: 'CLOUDFLARE_FLUX_MODEL',
    bestFor: 'Quick square images', badges: ['Free daily quota', 'Square only'], aspects: ['1:1'],
    price: { usd: 0.001, per: 'image', approx: true, freeDaily: true },
  },
  {
    id: 'replicate:flux-2-pro', provider: 'replicate', label: 'FLUX.2 Pro',
    model: 'black-forest-labs/flux-2-pro', modelEnv: 'REPLICATE_IMAGE_BEST',
    bestFor: 'Top-quality photos with fine detail', badges: ['Photo-real', 'Best detail'], aspects: ALL,
    price: { usd: 0.03, per: 'image', approx: true },
  },
  {
    id: 'replicate:flux-schnell', provider: 'replicate', label: 'FLUX Schnell · Replicate',
    model: 'black-forest-labs/flux-schnell', modelEnv: 'REPLICATE_IMAGE_FAST',
    bestFor: 'Fast, cheap drafts', badges: ['Fast'], aspects: ALL,
  },
  {
    id: 'openai:gpt-image', provider: 'openai', label: 'GPT Image',
    model: 'gpt-image-2.5-flare', modelEnv: 'OPENAI_IMAGE_MODEL', quality: 'medium',
    bestFor: 'Follows long instructions; clean text in images', badges: ['Text in images'], aspects: ALL,
  },
  {
    id: 'gemini:nano-banana', provider: 'gemini', label: 'Nano Banana 2.1',
    model: 'gemini-nano-banana-2.1', modelEnv: 'GEMINI_IMAGE_MODEL',
    bestFor: "Google's image model: natural scenes and consistent characters", badges: ['Photo-real'], aspects: ALL,
  },
  {
    id: 'pollinations:flux', provider: 'pollinations', label: 'Pollinations FLUX',
    model: 'flux', modelEnv: 'POLLINATIONS_IMAGE_MODEL',
    bestFor: 'Low-cost FLUX images', badges: ['Low cost'], aspects: ALL,
  },
  {
    id: 'pollinations:free', provider: 'pollinations-free', label: 'Free demo engine',
    model: 'classic', modelEnv: '',
    bestFor: '768 px images, one every 45 s, no key needed', badges: ['Free', 'No key'], aspects: ALL,
    price: { usd: 0, per: 'image' },
    note: 'The free demo engine is slow and small. Add any image key for better pictures.',
  },
];

export const VIDEO_ENGINES = [
  {
    id: 'fal:grok-video', provider: 'fal', label: 'Grok Imagine Video',
    model: 'xai/grok-imagine-video/text-to-video', modelEnv: 'FAL_GROK_VIDEO_MODEL',
    bestFor: 'Lively 720p clips with sound, from xAI', badges: ['Real footage', 'Sound'],
    aspects: ['16:9', '9:16', '1:1'], durations: [6, 10, 15], audio: true,
    i2v: { model: 'xai/grok-imagine-video/image-to-video', modelEnv: 'FAL_GROK_I2V_MODEL' },
    price: { usd: 0.07, per: 'second' },
  },
  {
    id: 'fal:seedance-2', provider: 'fal', label: 'Seedance 2.0',
    model: 'bytedance/seedance-2.0/text-to-video', modelEnv: 'FAL_SEEDANCE_MODEL',
    bestFor: 'Cinematic shots with sound and lip-sync', badges: ['Real footage', 'Sound'],
    aspects: ['16:9', '9:16', '1:1'], durations: [5, 8, 10, 15], audio: true,
    i2v: { model: 'bytedance/seedance-2.0/image-to-video', modelEnv: 'FAL_SEEDANCE_I2V_MODEL' },
    price: { usd: 0.3034, per: 'second' },
  },
  {
    id: 'fal:veo-3.1-fast', provider: 'fal', label: 'Veo 3.1 Fast',
    model: 'fal-ai/veo3.1/fast', modelEnv: 'FAL_VEO_MODEL',
    bestFor: "Google's video model, with dialogue and sound", badges: ['Real footage', 'Sound'],
    aspects: ['16:9', '9:16'], durations: [4, 6, 8], audio: true,
    i2v: { model: 'fal-ai/veo3.1/fast/image-to-video', modelEnv: 'FAL_VEO_I2V_MODEL' },
    price: { usd: 0.15, per: 'second' },
    note: 'fal.ai says it will remove Veo 3.1 Fast on 17 November 2026. Pick another engine if it stops working.',
  },
  {
    id: 'replicate:p-video', provider: 'replicate', label: 'P-Video',
    model: 'prunaai/p-video', modelEnv: 'REPLICATE_VIDEO_FAST',
    bestFor: 'Fast, low-cost 720p clips', badges: ['Real footage', 'Fast'],
    aspects: ['16:9', '9:16', '1:1'], durations: [5, 8, 10], audio: false,
    price: { usd: 0.02, per: 'second' },
  },
  {
    id: 'replicate:minimax-h3', provider: 'replicate', label: 'MiniMax H3',
    model: 'minimax/h3', modelEnv: 'REPLICATE_MINIMAX_MODEL',
    bestFor: 'Smooth, realistic motion at 768p', badges: ['Real footage'],
    aspects: ['16:9'], durations: [5, 10], audio: false,
    price: { usd: 0.08, per: 'second' },
  },
  {
    id: 'replicate:veo-3.1-fast', provider: 'replicate', label: 'Veo 3.1 Fast · Replicate',
    model: 'google/veo-3.1-fast', modelEnv: 'REPLICATE_VIDEO_BEST',
    bestFor: "Google's video model, with sound", badges: ['Real footage', 'Sound'],
    aspects: ['16:9', '9:16'], durations: [4, 6, 8], audio: true,
  },
  {
    id: 'gemini:omni', provider: 'gemini', label: 'Gemini Omni Flash',
    model: 'gemini-omni-1.1-flash', modelEnv: 'GEMINI_VIDEO_MODEL',
    bestFor: "Google's newest video model, with sound", badges: ['Real footage', 'Sound'],
    aspects: ['16:9', '9:16'], durations: [4, 6, 8], audio: true,
  },
];

/** What the browser is allowed to see about an engine. */
export function publicEngine(e) {
  const p = PROVIDERS[e.provider] || { label: e.provider, needs: [] };
  return {
    id: e.id,
    label: e.label,
    provider: e.provider,
    providerLabel: p.label,
    model: e.model,
    bestFor: e.bestFor,
    badges: e.badges,
    aspects: e.aspects,
    durations: e.durations,
    audio: !!e.audio,
    fromImage: !!e.i2v, // can animate a picture (Make it move)
    price: e.price || null,
    note: e.note,
    available: !!e.available,
    needs: e.available ? [] : p.needs,
  };
}

/**
 * Rough cost of one run in USD, or null when the price is unknown.
 * @param {{duration?: number}} opts  seconds, for video engines
 */
export function estimateCost(e, { duration } = {}) {
  const p = e && e.price;
  if (!p) return null;
  return p.per === 'second' ? p.usd * (duration || (e.durations && e.durations[0]) || 5) : p.usd;
}

/** Every engine, all locked: inlined into the artifact preview, which has no server. */
export function lockedCatalog() {
  return {
    image: IMAGE_ENGINES.map((e) => publicEngine({ ...e, available: false })),
    video: VIDEO_ENGINES.map((e) => publicEngine({ ...e, available: false })),
  };
}
