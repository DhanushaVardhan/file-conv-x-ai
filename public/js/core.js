/* Alembic · core
 * Shared helpers: environment detection, lazy library loading, saving files,
 * and one AI adapter that talks either to your own server (/api/...) or,
 * inside a Claude artifact, to Claude itself through the `sample` capability.
 */
(function () {
  'use strict';
  const A = (window.Alembic = window.Alembic || {});

  /* ---------------------------------------------------------------- utils */
  const util = (A.util = {
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    nextFrame: () => new Promise((r) => requestAnimationFrame(() => r())),
    yieldToUI: () => new Promise((r) => setTimeout(r, 0)),
    formatBytes(n) {
      if (!Number.isFinite(n)) return '';
      if (n < 1024) return n + ' B';
      const u = ['KB', 'MB', 'GB'];
      let i = -1;
      do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
      return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
    },
    formatTime(sec) {
      if (!Number.isFinite(sec)) return '';
      const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
      return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
    },
    ext(name) {
      const m = /\.([^./\\]+)$/.exec(name || '');
      return m ? m[1].toLowerCase() : '';
    },
    baseName(name) {
      return (name || 'file').replace(/\.[^./\\]+$/, '') || 'file';
    },
    safeName(name) {
      return (name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 120) || 'file';
    },
    slug(s, fallback) {
      const w = String(s || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join('-');
      return w || fallback || 'alembic';
    },
    escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    blobToDataURL(blob) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
      });
    },
    async blobToBase64(blob) {
      const url = await util.blobToDataURL(blob);
      return url.slice(url.indexOf(',') + 1);
    },
    base64ToBlob(b64, mime) {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime || 'application/octet-stream' });
    },
    canvasToBlob(canvas, type = 'image/png', quality) {
      return new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), type, quality)
      );
    },
    /** Decode any browser-readable image, honouring EXIF rotation. */
    async decodeImage(blob) {
      if ('createImageBitmap' in window) {
        try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (_) { /* fall back */ }
      }
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        return img;
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    },
    /** Shrink an image so its longest side is at most maxSide (for AI uploads). */
    async downscaleImage(blob, maxSide = 1600, type = 'image/jpeg', quality = 0.86) {
      const img = await util.decodeImage(blob);
      const w = img.width, h = img.height;
      const k = Math.min(1, maxSide / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      const ctx = c.getContext('2d');
      if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      if (img.close) img.close();
      const out = await util.canvasToBlob(c, type, quality);
      c.width = c.height = 0;
      return out;
    },
    cancelled() {
      const e = new Error('Stopped.');
      e.code = 'cancelled';
      return e;
    },
    checkAbort(signal) {
      if (signal && signal.aborted) throw util.cancelled();
    },
  });

  /* ------------------------------------------------------ library loading */
  // Libraries load only when a file needs them, pinned to exact versions.
  const LIB_URLS = Object.assign(
    {
      jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
      pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
      pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
    },
    window.ALEMBIC_LIB_URLS || {}
  );
  const pending = {};
  function loadScript(url, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (!pending[url]) {
      pending[url] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = () => (window[globalName] ? resolve(window[globalName]) : reject(new Error(globalName + ' did not load.')));
        s.onerror = () => {
          delete pending[url];
          reject(new Error('Could not download a helper library. Check your internet connection and try again.'));
        };
        document.head.appendChild(s);
      });
    }
    return pending[url];
  }
  let pdfjsPromise = null;
  A.libs = {
    jszip: () => loadScript(LIB_URLS.jszip, 'JSZip'),
    pdfjs() {
      if (!pdfjsPromise) {
        pdfjsPromise = import(LIB_URLS.pdfjs).then((m) => {
          m.GlobalWorkerOptions.workerSrc = LIB_URLS.pdfjsWorker;
          return m;
        });
        pdfjsPromise.catch(() => { pdfjsPromise = null; });
      }
      return pdfjsPromise;
    },
    urls: LIB_URLS,
  };

  /* ---------------------------------------------------------- environment */
  // mode: 'artifact' (inside Claude), 'server' (your own deployment), or 'static'.
  const env = (A.env = {
    mode: 'static',
    resolved: false,
    sample: null,
    sampleLimits: null,
    downloads: null,
    server: null,
    accessCode: '',
    listeners: new Set(),
    onChange(fn) { this.listeners.add(fn); },
    emit() { this.listeners.forEach((fn) => { try { fn(env); } catch (e) { console.error(e); } }); },
  });
  try { env.accessCode = localStorage.getItem('alembic.accessCode') || ''; } catch (_) { /* storage blocked */ }

  env.ready = (async () => {
    const claude = window.claude;
    if (claude && typeof claude.use === 'function') {
      env.mode = 'artifact';
      const [sample, downloads] = await Promise.all([
        claude.use('sample').catch(() => null),
        claude.use('downloads').catch(() => null),
      ]);
      env.sample = sample;
      env.downloads = downloads;
      if (sample && typeof sample.limits === 'function') {
        try { env.sampleLimits = await sample.limits(); } catch (_) { env.sampleLimits = null; }
      }
    } else if (/^https?:$/.test(location.protocol)) {
      try {
        const r = await fetch('api/health', { headers: { accept: 'application/json' } });
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
          env.server = await r.json();
          env.mode = 'server';
        }
      } catch (_) { /* no backend: static hosting */ }
    }
    env.resolved = true;
    env.emit();
    return env;
  })();

  /* --------------------------------------------------------------- saving */
  // Claude artifacts only allow these extensions; anything else is zipped first.
  const ARTIFACT_EXTS = new Set('gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip'.split(' '));
  A.save = async function save(blob, filename) {
    filename = util.safeName(filename);
    await env.ready;
    if (env.mode === 'artifact') {
      if (!env.downloads) return { ok: false, reason: 'Downloads are not available in this view. Open the artifact in Claude to save files.' };
      let data = blob, name = filename, zipped = false;
      if (!ARTIFACT_EXTS.has(util.ext(filename))) {
        const JSZip = await A.libs.jszip();
        const zip = new JSZip();
        zip.file(filename, blob);
        data = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        name = util.baseName(filename) + '-' + util.ext(filename) + '.zip';
        zipped = true;
      }
      try {
        await env.downloads.save({ filename: name, data });
        return { ok: true, zipped, name };
      } catch (e) {
        const code = e && e.code;
        if (code === 'declined') return { ok: false, quiet: true };
        if (code === 'rate_limited') return { ok: false, reason: 'A save is already waiting for your answer. Finish that one first.' };
        return { ok: false, reason: 'This view could not save the file' + (code ? ' (' + code + ').' : '.') };
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true, name: filename };
  };

  /* ------------------------------------------------------------------- AI */
  const FRIENDLY = {
    no_ai: 'AI is not switched on yet. Add an API key to your server (README, step 3).',
    not_granted: 'AI was not allowed for this page. Reload the page to be asked again.',
    sampling_disabled: 'AI is not available for this account.',
    capability_disabled: 'AI is not available in this view.',
    rate_limited: 'Too many AI requests right now. Wait a minute, then try again.',
    session_expired: 'Your session expired. Sign in again, then retry.',
    refused: 'The AI declined this request. Try rewording it.',
    empty_completion: 'The AI returned nothing. Try a shorter or clearer request.',
    prompt_too_large: 'That is too much for one request. Try a shorter file.',
    image_rejected: 'That image could not be used. Try a JPG or PNG under 20 MB.',
    images_unavailable: 'This view cannot send images to the AI.',
    invalid_json: 'The AI answer came back in the wrong shape. Try again.',
    upstream_error: 'The AI service had a hiccup. Try again in a moment.',
    network: 'Could not reach the server. Check that it is running.',
    access_code: 'This site needs an access code for AI features.',
    cancelled: 'Stopped.',
  };
  function aiError(code, message) {
    const e = new Error(message || FRIENDLY[code] || 'Something went wrong.');
    e.code = code;
    return e;
  }
  A.aiError = aiError;
  A.friendlyError = function (err) {
    if (!err) return 'Something went wrong.';
    if (err.code && FRIENDLY[err.code] && !err.serverMessage) return FRIENDLY[err.code];
    return err.message || String(err);
  };

  function headers(extra) {
    return Object.assign({ accept: 'application/json' }, env.accessCode ? { 'x-access-code': env.accessCode } : {}, extra || {});
  }
  async function api(path, { method = 'GET', body, signal } = {}) {
    let r;
    try {
      r = await fetch(path, {
        method,
        signal,
        headers: headers(body ? { 'content-type': 'application/json' } : null),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw aiError('cancelled');
      throw aiError('network');
    }
    let data = null;
    try { data = await r.json(); } catch (_) { /* not json */ }
    if (!r.ok) {
      const err = aiError((data && data.error && data.error.code) || 'upstream_error', (data && data.error && data.error.message) || 'Server error ' + r.status);
      err.serverMessage = true;
      err.status = r.status;
      throw err;
    }
    return data;
  }
  A.api = api;

  function parseJsonLoose(text) {
    const t = String(text || '').trim();
    try { return JSON.parse(t); } catch (_) { /* keep looking */ }
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    if (fence) { try { return JSON.parse(fence[1]); } catch (_) { /* keep looking */ } }
    const first = t.search(/[\[{]/);
    const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (first >= 0 && last > first) { try { return JSON.parse(t.slice(first, last + 1)); } catch (_) { /* fall through */ } }
    throw aiError('invalid_json');
  }
  A.parseJsonLoose = parseJsonLoose;

  function normalizeSampleError(e) {
    if (e instanceof Error) return e;
    const err = aiError((e && e.code) || 'upstream_error');
    if (e && e.text) err.partial = e.text;
    return err;
  }

  /** Images the current AI can take in one call. */
  function maxImages() {
    if (env.mode === 'artifact') return (env.sampleLimits && env.sampleLimits.images && env.sampleLimits.images.maxCount) || 0;
    const t = env.server && env.server.text;
    return t && t.vision ? t.maxImages || 16 : 0;
  }

  async function serverImages(images) {
    const out = [];
    for (const img of images || []) {
      const small = await util.downscaleImage(img, 1568);
      out.push({ mime: small.type, data: await util.blobToBase64(small) });
    }
    return out;
  }

  A.ai = {
    /** What AI can do right now in this environment. */
    caps() {
      const s = env.server || {};
      const text = !!(s.text || env.sample);
      return {
        ready: env.resolved,
        text,
        vision: maxImages() > 0,
        maxImages: maxImages(),
        media: !!(s.text && s.text.media), // can read whole video/audio files (Gemini)
        provider: s.text ? s.text.label : env.sample ? 'Claude' : '',
        needsCode: !!s.requiresAccessCode,
        engines: s.engines || null,
      };
    },
    /**
     * Ask for text. `input` is a prompt string, or chat turns [{role, content}] ending on a user turn.
     * opts: images (Blob[]), files ([{uri, mime}] from upload()), onText(fullText), signal, tier, json, cache
     */
    async text(input, { images, files, onText, signal, tier, json, cache } = {}) {
      const turns = typeof input === 'string' ? null : input;
      if (env.server && env.server.text) {
        const body = { json: !!json };
        if (turns) body.messages = turns;
        else body.prompt = input;
        if (images && images.length) body.images = await serverImages(images.slice(0, maxImages() || 16));
        if (files && files.length) body.files = files;
        const r = await api('api/ai/text', { method: 'POST', body, signal });
        if (onText) onText(r.text);
        return r.text;
      }
      if (env.sample) {
        const opts = {};
        if (onText) opts.onText = ({ text }) => onText(text);
        if (signal) opts.signal = signal;
        if (images && images.length) opts.images = images.slice(0, maxImages() || 1);
        if (tier) opts.modelTier = tier;
        if (cache !== undefined) opts.cache = cache;
        try {
          const r = await env.sample(turns || input, opts);
          return r.text;
        } catch (e) {
          throw normalizeSampleError(e);
        }
      }
      throw aiError('no_ai');
    },
    /** Ask for JSON and parse it tolerantly. */
    async json(input, opts = {}) {
      if (!(env.server && env.server.text) && env.sample && typeof env.sample.json === 'function') {
        const o = {};
        if (opts.signal) o.signal = opts.signal;
        if (opts.tier) o.modelTier = opts.tier;
        if (opts.images && opts.images.length) o.images = opts.images.slice(0, maxImages() || 1);
        if (opts.cache !== undefined) o.cache = opts.cache;
        try {
          return await env.sample.json(input, o);
        } catch (e) {
          throw normalizeSampleError(e);
        }
      }
      const text = await A.ai.text(input, Object.assign({}, opts, { json: true }));
      return parseJsonLoose(text);
    },
    /** Send a whole video/audio file to the server so Gemini can watch/listen to it. */
    upload(file, { signal, onProgress } = {}) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'api/ai/upload');
        const h = headers({ 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name || 'file') });
        for (const [k, v] of Object.entries(h)) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total); };
        xhr.onload = () => {
          let data = null;
          try { data = JSON.parse(xhr.responseText); } catch (_) { /* not json */ }
          if (xhr.status >= 200 && xhr.status < 300 && data) return resolve(data);
          const err = aiError((data && data.error && data.error.code) || 'upstream_error', (data && data.error && data.error.message) || 'Upload failed (' + xhr.status + ').');
          err.serverMessage = true;
          reject(err);
        };
        xhr.onerror = () => reject(aiError('network'));
        xhr.onabort = () => reject(aiError('cancelled'));
        if (signal) signal.addEventListener('abort', () => xhr.abort(), { once: true });
        xhr.send(file);
      });
    },
    /** Server-side image generation. Returns [{blob, mime}] */
    async image({ prompt, aspect, engine, signal }) {
      const r = await api('api/ai/image', { method: 'POST', body: { prompt, aspect, engine }, signal });
      return (r.images || []).map((im) => ({ blob: util.base64ToBlob(im.data, im.mime), mime: im.mime, model: r.model }));
    },
    /** Server-side video generation: start a job, then poll. */
    async videoStart({ prompt, aspect, duration, engine, signal }) {
      return api('api/ai/video', { method: 'POST', body: { prompt, aspect, duration, engine }, signal });
    },
    async videoStatus(id, signal) {
      return api('api/ai/video/' + encodeURIComponent(id), { signal });
    },
    async download(url, signal) {
      const r = await fetch(url, { headers: env.accessCode ? { 'x-access-code': env.accessCode } : {}, signal });
      if (!r.ok) throw new Error('The finished file could not be downloaded (' + r.status + ').');
      return r.blob();
    },
  };

  A.setAccessCode = function (code) {
    env.accessCode = String(code || '').trim();
    try { localStorage.setItem('alembic.accessCode', env.accessCode); } catch (_) { /* storage blocked */ }
  };
})();
