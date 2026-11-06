/* Alembic · motion
 * Motion Graphics and Story Reel engines: the text AI writes a JSON scene (or
 * three scenes with captions), this file draws them on a canvas, and
 * recordCanvas() records any canvas animation, with an optional soundtrack,
 * to an MP4 or WEBM clip. Looping motions complete whole cycles.
 */
(function () {
  'use strict';
  const A = (window.Alembic = window.Alembic || {});
  const TAU = Math.PI * 2;

  function mulberry32(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ----------------------------------------------------------- validation */
  const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;
  const num = (v, d, lo, hi) => {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const col = (v, d) => (typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim() : d);
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const KINDS = ['stars', 'orb', 'sun', 'hills', 'wave', 'particles', 'grid', 'rays', 'ring', 'shape', 'text'];

  function normalizeMusic(m) {
    m = m && typeof m === 'object' ? m : {};
    return { mood: ['calm', 'upbeat', 'epic', 'mystery'].includes(m.mood) ? m.mood : 'calm', tempo: num(m.tempo, 0, 0, 160) || undefined };
  }

  function normalize(raw, opts = {}) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const pal = ['#ff4f8b', '#ffb547', '#2ccdc4', '#9c7bff', '#ffffff'];
    const bg = s.background || {};
    const scene = {
      title: String(s.title || opts.title || 'Untitled clip').slice(0, 80),
      duration: num(opts.duration ?? s.duration, 6, 2, 12),
      seed: hashString(JSON.stringify(s).slice(0, 2000)),
      background: { from: col(bg.from, '#0b0d26'), to: col(bg.to, '#3a1446'), angle: num(bg.angle, 180, 0, 360), glow: col(bg.glow, null) },
      camera: { zoom: num(s.camera && s.camera.zoom, 1.06, 1, 1.3) },
      music: normalizeMusic(s.music),
      elements: [],
    };
    const els = Array.isArray(s.elements) ? s.elements.slice(0, 24) : [];
    els.forEach((e, i) => {
      if (!e || !KINDS.includes(e.kind)) return;
      const c = col(e.color, pal[i % pal.length]);
      const base = { kind: e.kind, color: c, alpha: num(e.alpha, 1, 0, 1), seed: i * 7919 + 13 };
      switch (e.kind) {
        case 'stars': Object.assign(base, { count: Math.round(num(e.count, 120, 5, 400)), twinkle: num(e.twinkle, 0.6, 0, 1) }); break;
        case 'orb': Object.assign(base, { x: num(e.x, 0.5, -0.2, 1.2), y: num(e.y, 0.5, -0.2, 1.2), r: num(e.r, 0.25, 0.02, 0.9), drift: num(e.drift, 0.08, 0, 0.4), speed: Math.round(num(e.speed, 1, 1, 4)), alpha: num(e.alpha, 0.7, 0, 1) }); break;
        case 'sun': Object.assign(base, { x: num(e.x, 0.5, 0, 1), y: num(e.y, 0.55, 0, 1.2), r: num(e.r, 0.16, 0.03, 0.45), glow: col(e.glow, c), rise: num(e.rise, 0, -0.4, 0.4), stripes: !!e.stripes }); break;
        case 'hills': Object.assign(base, { y: num(e.y, 0.75, 0.2, 1), height: num(e.height, 0.18, 0.02, 0.6), roughness: num(e.roughness, 0.5, 0, 1), speed: num(e.speed, 0.04, -0.4, 0.4), color2: col(e.color2, null) }); break;
        case 'wave': Object.assign(base, { y: num(e.y, 0.8, 0, 1.1), amp: num(e.amp, 0.03, 0.002, 0.2), length: num(e.length, 0.5, 0.05, 2), speed: Math.round(num(e.speed, 1, 1, 4)), alpha: num(e.alpha, 0.8, 0, 1) }); break;
        case 'particles': Object.assign(base, { count: Math.round(num(e.count, 80, 4, 300)), size: num(e.size, 0.006, 0.001, 0.04), direction: pick(e.direction, ['up', 'down', 'left', 'right', 'out'], 'up'), speed: num(e.speed, 0.15, 0.01, 1) }); break;
        case 'grid': Object.assign(base, { y: num(e.y, 0.62, 0.3, 0.9), speed: num(e.speed, 1, 0.1, 3) }); break;
        case 'rays': Object.assign(base, { x: num(e.x, 0.5, -0.2, 1.2), y: num(e.y, 0.4, -0.2, 1.2), count: Math.round(num(e.count, 12, 3, 36)), alpha: num(e.alpha, 0.18, 0, 0.6), spin: num(e.spin, 0.2, -2, 2) }); break;
        case 'ring': Object.assign(base, { x: num(e.x, 0.5, 0, 1), y: num(e.y, 0.5, 0, 1), r: num(e.r, 0.45, 0.05, 1), every: num(e.every, 2, 0.4, 6) }); break;
        case 'shape': {
          const kf = (k, d) => ({ x: num(k && k.x, d.x, -0.5, 1.5), y: num(k && k.y, d.y, -0.5, 1.5), s: num(k && k.s, d.s, 0, 1.2), rot: num(k && k.rot, d.rot, -1440, 1440), a: num(k && k.a, d.a, 0, 1) });
          const from = kf(e.from, { x: 0.5, y: 0.5, s: 0.1, rot: 0, a: 1 });
          Object.assign(base, { shape: pick(e.shape, ['circle', 'square', 'triangle', 'hexagon', 'star', 'diamond'], 'circle'), from, to: kf(e.to, from), ease: pick(e.ease, ['in', 'out', 'inOut', 'linear'], 'inOut'), spin: num(e.spin, 0, -4, 4) });
          break;
        }
        case 'text': Object.assign(base, { text: String(e.text || '').slice(0, 48), y: num(e.y, 0.5, 0.05, 0.95), size: num(e.size, 0.08, 0.02, 0.2), appear: num(e.appear, 0.2, 0, 0.9) }); break;
      }
      if (e.kind !== 'text' || base.text) scene.elements.push(base);
    });
    if (!scene.elements.length) scene.elements.push({ kind: 'orb', color: pal[0], alpha: 0.7, x: 0.5, y: 0.5, r: 0.3, drift: 0.1, speed: 1, seed: 1 });
    return scene;
  }

  /* -------------------------------------------------------------- drawing */
  const ease = {
    linear: (p) => p,
    in: (p) => p * p * p,
    out: (p) => 1 - Math.pow(1 - p, 3),
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  };

  function polygon(ctx, shape, r) {
    ctx.beginPath();
    if (shape === 'circle') { ctx.arc(0, 0, r, 0, TAU); return; }
    const pts = shape === 'triangle' ? 3 : shape === 'square' || shape === 'diamond' ? 4 : shape === 'hexagon' ? 6 : 10;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * TAU - Math.PI / 2 + (shape === 'square' ? Math.PI / 4 : 0);
      const rr = shape === 'star' && i % 2 ? r * 0.45 : r;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  function createPlayer(canvas, scene) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, U = Math.min(W, H);
    const D = scene.duration;
    // Pre-compute random layouts so every frame is consistent.
    const cache = scene.elements.map((e) => {
      const rnd = mulberry32(scene.seed ^ e.seed);
      if (e.kind === 'stars') return Array.from({ length: e.count }, () => ({ x: rnd(), y: rnd() * 0.85, r: 0.4 + rnd() * 1.6, ph: rnd() * TAU, k: 1 + Math.floor(rnd() * 3) }));
      if (e.kind === 'particles') return Array.from({ length: e.count }, () => ({ x: rnd(), y: rnd(), r: 0.5 + rnd(), a: rnd() * TAU, ph: rnd() }));
      if (e.kind === 'hills') {
        const n = 9;
        const pts = Array.from({ length: n }, () => rnd());
        return { pts, phase: rnd() * TAU };
      }
      return null;
    });

    function hillY(e, c, u) {
      // Smooth periodic ridge (u wraps 0..1), sum of a few sines seeded per element.
      let v = 0;
      for (let i = 0; i < 4; i++) v += Math.sin(u * TAU * (i + 1) + c.pts[i] * TAU) * (0.5 / (i + 1)) * (i === 0 ? 1 : e.roughness + 0.15);
      return v;
    }

    function draw(t) {
      const p = Math.min(1, Math.max(0, t / D));
      const loop = (k) => (t / D) * TAU * k;
      ctx.save();
      ctx.clearRect(0, 0, W, H);
      // Background
      const a = (scene.background.angle * Math.PI) / 180;
      const dx = Math.sin(a) * 0.5, dy = -Math.cos(a) * 0.5;
      const g = ctx.createLinearGradient(W * (0.5 - dx), H * (0.5 - dy), W * (0.5 + dx), H * (0.5 + dy));
      g.addColorStop(0, scene.background.from);
      g.addColorStop(1, scene.background.to);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      if (scene.background.glow) {
        const rg = ctx.createRadialGradient(W * 0.5, H * 0.62, 0, W * 0.5, H * 0.62, U * (0.75 + 0.05 * Math.sin(loop(1))));
        rg.addColorStop(0, scene.background.glow);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      // Slow camera push-in.
      const z = 1 + (scene.camera.zoom - 1) * ease.inOut(p);
      ctx.translate(W / 2, H / 2);
      ctx.scale(z, z);
      ctx.translate(-W / 2, -H / 2);

      scene.elements.forEach((e, idx) => {
        const c = cache[idx];
        ctx.save();
        ctx.globalAlpha = e.alpha;
        switch (e.kind) {
          case 'stars':
            ctx.fillStyle = e.color;
            for (const s of c) {
              ctx.globalAlpha = e.alpha * (1 - e.twinkle * 0.5 + e.twinkle * 0.5 * Math.sin(loop(s.k) + s.ph));
              ctx.beginPath();
              ctx.arc(s.x * W, s.y * H, s.r * (U / 720), 0, TAU);
              ctx.fill();
            }
            break;
          case 'orb': {
            const x = (e.x + Math.sin(loop(e.speed)) * e.drift) * W;
            const y = (e.y + Math.cos(loop(e.speed) * 0.5 + idx) * e.drift * 0.6) * H;
            const r = e.r * U * (1 + 0.04 * Math.sin(loop(e.speed)));
            const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
            rg.addColorStop(0, e.color);
            rg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = rg;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
            break;
          }
          case 'sun': {
            const x = e.x * W, y = (e.y - e.rise * ease.inOut(p)) * H, r = e.r * U;
            const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.6);
            glow.addColorStop(0, e.glow);
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.globalAlpha = e.alpha * 0.55;
            ctx.fillStyle = glow;
            ctx.fillRect(x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2);
            ctx.globalAlpha = e.alpha;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            if (e.stripes) {
              const sg = ctx.createLinearGradient(x, y - r, x, y + r);
              sg.addColorStop(0, e.color);
              sg.addColorStop(1, e.glow);
              ctx.fillStyle = sg;
              ctx.fill();
              ctx.globalCompositeOperation = 'destination-out';
              for (let i = 0; i < 6; i++) {
                const yy = y + r * (0.15 + i * 0.15) + ((t * 8) % (r * 0.15));
                ctx.fillRect(x - r, yy, r * 2, r * (0.02 + i * 0.012));
              }
            } else {
              ctx.fillStyle = e.color;
              ctx.fill();
            }
            break;
          }
          case 'hills': {
            const base = e.y * H, amp = e.height * H;
            const shift = (t / D) * Math.round(e.speed * 10) / 10;
            ctx.beginPath();
            ctx.moveTo(0, H);
            for (let i = 0; i <= 64; i++) {
              const u = i / 64;
              ctx.lineTo(u * W, base - (hillY(e, c, u + shift) * 0.5 + 0.5) * amp);
            }
            ctx.lineTo(W, H);
            ctx.closePath();
            if (e.color2) {
              const hg = ctx.createLinearGradient(0, base - amp, 0, H);
              hg.addColorStop(0, e.color);
              hg.addColorStop(1, e.color2);
              ctx.fillStyle = hg;
            } else ctx.fillStyle = e.color;
            ctx.fill();
            break;
          }
          case 'wave': {
            const base = e.y * H, amp = e.amp * H, len = e.length * W;
            ctx.beginPath();
            ctx.moveTo(0, H);
            for (let x = 0; x <= W + 8; x += 8) ctx.lineTo(x, base + Math.sin((x / len) * TAU + loop(e.speed) + idx) * amp);
            ctx.lineTo(W, H);
            ctx.closePath();
            ctx.fillStyle = e.color;
            ctx.fill();
            break;
          }
          case 'particles': {
            ctx.fillStyle = e.color;
            const travel = e.speed * D;
            for (const q of c) {
              let x = q.x, y = q.y;
              const d = (q.ph + (t / D) * Math.max(1, Math.round(travel))) % 1;
              if (e.direction === 'up') y = 1.05 - ((q.y + d) % 1) * 1.1;
              else if (e.direction === 'down') y = -0.05 + ((q.y + d) % 1) * 1.1;
              else if (e.direction === 'left') x = 1.05 - ((q.x + d) % 1) * 1.1;
              else if (e.direction === 'right') x = -0.05 + ((q.x + d) % 1) * 1.1;
              else { const rr = d * 0.75; x = 0.5 + Math.cos(q.a) * rr; y = 0.5 + Math.sin(q.a) * rr; }
              x += Math.sin(loop(1) + q.ph * TAU) * 0.01;
              ctx.globalAlpha = e.alpha * (e.direction === 'out' ? Math.min(1, d * 3) * (1 - d) : 0.35 + 0.65 * Math.abs(Math.sin(q.ph * TAU + loop(2))));
              ctx.beginPath();
              ctx.arc(x * W, y * H, e.size * U * q.r, 0, TAU);
              ctx.fill();
            }
            break;
          }
          case 'grid': {
            const hy = e.y * H;
            ctx.strokeStyle = e.color;
            ctx.lineWidth = Math.max(1, U / 500);
            const fade = ctx.createLinearGradient(0, hy, 0, H);
            fade.addColorStop(0, 'rgba(0,0,0,0)');
            fade.addColorStop(0.25, 'rgba(0,0,0,1)');
            ctx.beginPath();
            for (let i = -12; i <= 12; i++) { ctx.moveTo(W / 2 + i * W * 0.02, hy); ctx.lineTo(W / 2 + i * W * 0.22, H); }
            const off = ((t / D) * Math.round(e.speed * D)) % 1;
            for (let j = 0; j < 14; j++) {
              const v = Math.pow((j + off) / 14, 2.2);
              const yy = hy + v * (H - hy);
              ctx.moveTo(0, yy); ctx.lineTo(W, yy);
            }
            ctx.stroke();
            ctx.globalCompositeOperation = 'destination-in';
            ctx.fillStyle = fade;
            ctx.fillRect(0, hy - 2, W, H - hy + 2);
            break;
          }
          case 'rays': {
            const x = e.x * W, y = e.y * H, R = Math.hypot(W, H);
            ctx.translate(x, y);
            ctx.rotate((t / D) * TAU * Math.round(e.spin * 2) / 2 / Math.max(1, e.count / 6) + 0.2);
            ctx.fillStyle = e.color;
            for (let i = 0; i < e.count; i++) {
              const a0 = (i / e.count) * TAU, a1 = a0 + (TAU / e.count) * 0.4;
              ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath(); ctx.fill();
            }
            break;
          }
          case 'ring': {
            const x = e.x * W, y = e.y * H;
            const n = Math.max(1, Math.round(D / e.every));
            for (let k = 0; k < 3; k++) {
              const ph = ((t / D) * n + k / 3) % 1;
              ctx.globalAlpha = e.alpha * (1 - ph);
              ctx.strokeStyle = e.color;
              ctx.lineWidth = U * 0.006 * (1 - ph) + 1;
              ctx.beginPath(); ctx.arc(x, y, ph * e.r * U, 0, TAU); ctx.stroke();
            }
            break;
          }
          case 'shape': {
            const k = ease[e.ease](p);
            const lerp = (a, b) => a + (b - a) * k;
            ctx.translate(lerp(e.from.x, e.to.x) * W, lerp(e.from.y, e.to.y) * H);
            ctx.rotate(((lerp(e.from.rot, e.to.rot) + e.spin * 360 * (t / D)) * Math.PI) / 180);
            ctx.globalAlpha = e.alpha * lerp(e.from.a, e.to.a);
            polygon(ctx, e.shape, lerp(e.from.s, e.to.s) * U * 0.5);
            ctx.fillStyle = e.color;
            ctx.fill();
            break;
          }
          case 'text': {
            const show = Math.min(1, Math.max(0, (p - e.appear) / 0.12));
            if (show <= 0) break;
            ctx.globalAlpha = e.alpha * ease.out(show);
            ctx.fillStyle = e.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const size = e.size * U;
            ctx.font = '800 ' + size + 'px "Bricolage Grotesque", "Figtree", system-ui, sans-serif';
            ctx.shadowColor = 'rgba(0,0,0,0.35)';
            ctx.shadowBlur = size * 0.25;
            ctx.fillText(e.text, W / 2, e.y * H + (1 - ease.out(show)) * size * 0.4, W * 0.9);
            break;
          }
        }
        ctx.restore();
      });
      ctx.restore();
      // Soft vignette for depth.
      const v = ctx.createRadialGradient(W / 2, H / 2, U * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.38)');
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
    return { draw, duration: D };
  }

  /* ------------------------------------------------------------ recording */
  const SIZES = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1080, 1080] };
  function recorderType(withAudio) {
    if (!window.MediaRecorder) return null;
    const types = withAudio
      ? ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    return types.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch (_) { return false; } }) || null;
  }

  /**
   * Record draw(t) on `canvas` for `duration` seconds in real time.
   * opts: { audio: soundtrack from Alembic.music.create(), onProgress(p), signal, fps }
   */
  async function recordCanvas(canvas, draw, duration, { audio, onProgress, signal, fps = 30 } = {}) {
    const withAudio = !!(audio && audio.track);
    const mime = recorderType(withAudio) || (withAudio ? recorderType(false) : null);
    if (!mime) throw new Error('This browser cannot record video. Try Chrome, Edge, Firefox or Safari 17+.');
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    draw(0);
    const stream = canvas.captureStream(fps);
    const audioOn = withAudio && /opus|mp4a|^video\/(mp4|webm)$/.test(mime);
    if (audioOn) stream.addTrack(audio.track);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000, audioBitsPerSecond: 128000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start(250);
    if (audioOn) await audio.start();
    const start = performance.now();
    let cancelled = false;
    await new Promise((resolve) => {
      const frame = () => {
        if (signal && signal.aborted) { cancelled = true; resolve(); return; }
        const t = (performance.now() - start) / 1000;
        if (t >= duration) { draw(duration); resolve(); return; }
        draw(t);
        if (onProgress) onProgress(t / duration);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await new Promise((r) => setTimeout(r, 150));
    rec.stop();
    await stopped;
    stream.getVideoTracks().forEach((tr) => tr.stop());
    if (withAudio) audio.stop();
    if (cancelled) { const e = new Error('Stopped.'); e.code = 'cancelled'; throw e; }
    const type = mime.split(';')[0];
    return { blob: new Blob(chunks, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm', width: canvas.width, height: canvas.height, audio: audioOn };
  }

  /** Back-compatible helper: record a single motion scene. */
  async function record(scene, { aspect = '16:9', onProgress, onCanvas, signal, audio } = {}) {
    const [w, h] = SIZES[aspect] || SIZES['16:9'];
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    if (onCanvas) onCanvas(canvas);
    const player = createPlayer(canvas, scene);
    return recordCanvas(canvas, player.draw, scene.duration, { audio, onProgress, signal });
  }

  /* ------------------------------------------------------------ story reel */
  function normalizeStory(raw, { duration = 12, title } = {}) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const list = (Array.isArray(s.scenes) ? s.scenes : []).filter((x) => x && typeof x === 'object').slice(0, 4);
    if (!list.length) list.push({ caption: '', scene: s });
    const per = duration / list.length;
    const xf = Math.min(0.9, per * 0.25);
    return {
      title: String(s.title || title || '').slice(0, 48),
      music: normalizeMusic(s.music),
      duration,
      per,
      xf,
      scenes: list.map((x) => ({ caption: String(x.caption || '').slice(0, 90), scene: normalize(x.scene || x, { duration: per + xf }) })),
    };
  }

  function wrapLines(ctx, text, maxW, maxLines) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
    return lines;
  }

  function createStoryPlayer(canvas, story) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, U = Math.min(W, H);
    const subs = story.scenes.map((s) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      return { c, player: createPlayer(c, s.scene), caption: s.caption };
    });
    const { per, xf } = story;
    const titleSpan = story.title ? Math.min(2.4, per * 0.6) : 0;
    const font = (w, px) => w + ' ' + px + 'px "Bricolage Grotesque", "Figtree", system-ui, sans-serif';
    function caption(text, alpha) {
      if (!text || alpha <= 0) return;
      const size = Math.round(U * 0.048);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = font(700, size);
      const lines = wrapLines(ctx, text, W * 0.82, 2);
      const lh = size * 1.25;
      const boxH = lines.length * lh + size * 0.9;
      const y = H - boxH - H * 0.06;
      const boxW = Math.min(W * 0.9, Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.6);
      ctx.fillStyle = 'rgba(8,10,24,0.55)';
      const x = (W - boxW) / 2, r = size * 0.5;
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + boxW, y, x + boxW, y + boxH, r); ctx.arcTo(x + boxW, y + boxH, x, y + boxH, r);
      ctx.arcTo(x, y + boxH, x, y, r); ctx.arcTo(x, y, x + boxW, y, r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((l, k) => ctx.fillText(l, W / 2, y + size * 0.45 + lh * (k + 0.5)));
      ctx.restore();
    }
    function draw(t) {
      const i = Math.min(subs.length - 1, Math.floor(t / per));
      const local = t - i * per;
      const startI = i === 0 ? 0 : i * per - xf;
      subs[i].player.draw(Math.max(0, t - startI));
      ctx.globalAlpha = 1;
      ctx.drawImage(subs[i].c, 0, 0);
      if (i + 1 < subs.length && local > per - xf) {
        const k = (local - (per - xf)) / xf;
        subs[i + 1].player.draw(t - ((i + 1) * per - xf));
        ctx.globalAlpha = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        ctx.drawImage(subs[i + 1].c, 0, 0);
        ctx.globalAlpha = 1;
      }
      // Title card over the opening.
      if (titleSpan && t < titleSpan) {
        const a = Math.min(1, t / 0.4, (titleSpan - t) / 0.5);
        ctx.save();
        ctx.globalAlpha = Math.max(0, a);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = U * 0.03;
        ctx.font = font(800, Math.round(U * 0.085));
        ctx.fillText(story.title, W / 2, H * 0.44, W * 0.9);
        ctx.restore();
      }
      // Captions fade in after the title and out before each cut.
      const cStart = i === 0 ? titleSpan + 0.2 : 0.35;
      const cEnd = per - (i + 1 < subs.length ? xf + 0.2 : 0.3);
      const ca = Math.min(1, (local - cStart) / 0.35, (cEnd - local) / 0.35);
      caption(subs[i].caption, Math.max(0, ca));
    }
    return { draw, duration: story.duration };
  }

  /* --------------------------------------------------------------- prompt */
  const ELEMENT_SPEC = [
    'Positions and sizes are fractions of the frame (0-1, y=0 is the top). Element kinds:',
    '{"kind":"stars","count":20-300,"color","twinkle":0-1}',
    '{"kind":"orb","x","y","r":0.05-0.6,"color","alpha":0-1,"drift":0-0.3,"speed":1-3}  soft glowing light',
    '{"kind":"sun","x","y","r":0.05-0.3,"color","glow":"#hex","rise":-0.3-0.3,"stripes":bool}',
    '{"kind":"hills","y":0.4-0.95,"height":0.05-0.4,"color","color2":"#hex","roughness":0-1,"speed":-0.2-0.2}  mountains, dunes, skylines',
    '{"kind":"wave","y","amp":0.005-0.1,"length":0.1-1,"color","alpha","speed":1-3}  water or fabric',
    '{"kind":"particles","count":10-250,"color","size":0.001-0.02,"direction":"up|down|left|right|out","speed":0.02-0.5}  snow, rain, embers, fireflies, warp speed',
    '{"kind":"grid","y":0.45-0.8,"color","speed":0.2-2}  retro perspective floor below the horizon y',
    '{"kind":"rays","x","y","count":6-24,"color","alpha":0-0.4,"spin":-1-1}',
    '{"kind":"ring","x","y","color","r":0.1-0.8,"every":0.5-4}  pulses',
    '{"kind":"shape","shape":"circle|square|triangle|hexagon|star|diamond","color","from":{"x","y","s":0-1,"rot","a":0-1},"to":{same},"ease":"in|out|inOut|linear","spin":0-2}',
    '{"kind":"text","text":"max 40 characters","color","y","size":0.04-0.14,"appear":0-0.8}',
  ].join('\n');
  const SCENE_SHAPE = '{"background": {"from": "#hex", "to": "#hex", "angle": 0-360, "glow": "#hex" or null}, "camera": {"zoom": 1.0-1.2}, "elements": [6 to 14 elements, back to front]}';

  function scenePrompt(idea, { duration, aspect, style }) {
    return [
      'You are a motion designer. Design a ' + duration + '-second, ' + aspect + ' animated scene for this idea: "' + idea + '".' + (style && style !== 'None' ? ' Visual style: ' + style + '.' : ''),
      'Reply with only one JSON object:',
      '{"title": string, "music": {"mood": "calm|upbeat|epic|mystery", "tempo": 60-140}, ' + SCENE_SHAPE.slice(1),
      ELEMENT_SPEC,
      'Use a cohesive palette of 3 to 5 colours that suits the idea, build depth with far, middle and near layers, and only add text if the idea asks for words or a title.',
    ].join('\n');
  }

  function storyPrompt(idea, { duration, aspect, style }) {
    return [
      'You are a storyteller and motion designer. Plan a ' + duration + '-second, ' + aspect + ' animated story reel in three scenes for: "' + idea + '".' + (style && style !== 'None' ? ' Visual style: ' + style + '.' : ''),
      'Reply with only one JSON object:',
      '{"title": "max 40 characters", "music": {"mood": "calm|upbeat|epic|mystery", "tempo": 60-140}, "scenes": [3 objects: {"caption": "one sentence of narration, max 70 characters", "scene": ' + SCENE_SHAPE + '}]}',
      ELEMENT_SPEC,
      'The three scenes are a clear beginning, middle and end: vary the composition and motion between them but keep one palette. Captions carry the story; do not repeat them as text elements.',
    ].join('\n');
  }

  /* -------------------------------------------------------------- example */
  const EXAMPLE = {
    title: 'Neon horizon',
    background: { from: '#120634', to: '#ff5c8a', angle: 180, glow: '#ff9a3d' },
    camera: { zoom: 1.08 },
    elements: [
      { kind: 'stars', count: 140, color: '#ffe9f4', twinkle: 0.7 },
      { kind: 'orb', x: 0.2, y: 0.25, r: 0.35, color: '#7a4dff', alpha: 0.45, drift: 0.06, speed: 1 },
      { kind: 'sun', x: 0.5, y: 0.6, r: 0.2, color: '#ffd23f', glow: '#ff4f8b', rise: 0.06, stripes: true },
      { kind: 'hills', y: 0.66, height: 0.16, color: '#3b0f5c', color2: '#120634', roughness: 0.8, speed: 0.1 },
      { kind: 'grid', y: 0.66, color: '#ff4fd8', speed: 1 },
      { kind: 'particles', count: 60, color: '#ffd6f0', size: 0.004, direction: 'up', speed: 0.08 },
    ],
  };

  A.motion = { normalize, createPlayer, record, recordCanvas, recorderType, scenePrompt, storyPrompt, normalizeStory, createStoryPlayer, EXAMPLE, SIZES };
})();
