/* Alembic · app
 * Wires the three views (AI Image, AI Video, AI Summary) to the engines in
 * core.js, engines.js, readers.js and summary.js.
 */
(function () {
  'use strict';
  const A = window.Alembic;
  const U = A.util;
  const $ = (id) => document.getElementById(id);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const inArtifact = !!(window.claude && typeof window.claude.use === 'function');

  const ICON = {
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
  };

  /* ------------------------------------------------------------- helpers */
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'html') n.innerHTML = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
    return n;
  }
  /** replaceChildren that skips null/false (optional buttons). */
  function fill(node, ...kids) {
    node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
    return node;
  }
  function toast(msg, { bad = false, action, ms = 4200 } = {}) {
    const t = el('div', { class: 'toast' + (bad ? ' bad' : ''), role: bad ? 'alert' : 'status' }, msg);
    if (action) {
      t.style.pointerEvents = 'auto';
      t.append(' ', el('button', { class: 'toast-act', type: 'button', onclick: () => { action.run(); t.remove(); } }, action.label));
    }
    const box = $('toasts');
    box.append(t);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => t.remove(), ms);
  }
  async function saveBlob(blob, name) {
    try {
      const r = await A.save(blob, name);
      if (r.ok) toast('Saved ' + (r.name || name));
      else if (!r.quiet) toast(r.reason || 'The file could not be saved.', { bad: true });
    } catch (e) {
      toast(A.friendlyError(e), { bad: true });
    }
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch (_) {
      toast('Copy was blocked here. Select the text and copy it yourself.', { bad: true });
    }
  }
  const urlCache = new WeakMap();
  function objectUrl(blob) {
    let u = urlCache.get(blob);
    if (!u) { u = URL.createObjectURL(blob); urlCache.set(blob, u); }
    return u;
  }
  /** Re-render a control group without losing keyboard focus. */
  function keepFocus(container, render) {
    const active = document.activeElement;
    const had = active && container.contains(active) ? active.dataset.key || active.textContent : null;
    render();
    if (had != null) {
      const again = Array.from(container.querySelectorAll('button')).find((b) => (b.dataset.key || b.textContent) === had);
      if (again) again.focus();
    }
  }
  /** On one-column layouts the stage sits below the form: bring it into view. */
  function revealStage(stage) {
    if (!window.matchMedia('(max-width: 1020px)').matches) return;
    const r = stage.getBoundingClientRect();
    if (r.top < 60 || r.bottom > innerHeight) stage.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  function busyTimer(elapsedEl) {
    const t0 = performance.now();
    const id = setInterval(() => { elapsedEl.textContent = Math.round((performance.now() - t0) / 1000) + ' s'; }, 500);
    elapsedEl.textContent = '0 s';
    return () => clearInterval(id);
  }
  function counter(ta, out) {
    const upd = () => { out.textContent = ta.value.length + ' / ' + ta.maxLength; };
    ta.addEventListener('input', upd);
    upd();
    return upd;
  }

  /* --------------------------------------------------------------- theme */
  if (!inArtifact) {
    const btn = $('themeBtn');
    btn.hidden = false;
    try { const t = localStorage.getItem('alembic.theme'); if (t) document.documentElement.dataset.theme = t; } catch (_) { /* storage blocked */ }
    btn.addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('alembic.theme', next); } catch (_) { /* storage blocked */ }
    });
  }

  /* ------------------------------------------------------------- routing */
  const VIEWS = ['image', 'video', 'summary'];
  let view = null;
  function moveInk() {
    const tab = $('tab-' + view);
    const ink = $('tabInk');
    if (!tab || !ink) return;
    ink.style.width = tab.offsetWidth + 'px';
    ink.style.transform = 'translateX(' + (tab.offsetLeft - 4) + 'px)';
  }
  function route() {
    const want = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'image';
    if (want === view) return;
    const apply = () => {
      for (const v of VIEWS) {
        $('view-' + v).hidden = v !== want;
        $('tab-' + v).setAttribute('aria-selected', String(v === want));
      }
      view = want;
      moveInk();
      Video.visible(want === 'video');
    };
    if (view && document.startViewTransition && !reduceMotion) document.startViewTransition(apply);
    else apply();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', moveInk);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveInk);
  function go(v) {
    if (location.hash !== '#' + v) location.hash = '#' + v;
    else route();
  }

  /* ----------------------------------------------------------- AI status */
  function renderAiStatus() {
    const env = A.env;
    const caps = A.ai.caps();
    const imgReal = A.engines.list('image').filter((e) => e.available && !e.local).length;
    const vidReal = A.engines.list('video').filter((e) => e.available && !e.local).length;
    let state = 'off', short = 'AI off', long = 'off';
    if (!env.resolved) { short = 'Checking AI…'; long = 'checking…'; }
    else if (env.mode === 'artifact') {
      if (env.sample) { state = 'on'; short = 'AI on · Claude'; long = 'Claude'; }
      else { short = 'AI off here'; long = 'not available in this view'; }
    } else if (caps.text || imgReal || vidReal) {
      state = caps.text && imgReal && vidReal ? 'on' : 'partial';
      short = 'AI on · ' + (caps.provider || 'images');
      long = (caps.provider || 'no text AI') + ' · ' + imgReal + ' image + ' + vidReal + ' video models';
    } else long = env.mode === 'server' ? 'off (no API keys yet)' : 'off (no server)';
    $('aiPill').dataset.state = state;
    $('aiPillText').textContent = short;
    $('footAi').textContent = 'AI: ' + long;

    const pop = $('aiPop');
    pop.innerHTML = '';
    const count = (kind) => {
      const l = A.engines.list(kind);
      return l.filter((e) => e.available).length + ' of ' + l.length;
    };
    if (env.mode === 'artifact') {
      pop.append(
        el('h3', { text: env.sample ? 'AI runs on Claude in this preview' : 'AI is not available in this view' }),
        el('ul', null,
          el('li', { text: 'Summaries, prompt help and the built-in engines use Claude.' }),
          el('li', { text: 'Image engines on: ' + count('image') + '. Video engines on: ' + count('video') + '.' }),
          el('li', { text: 'Real photo and video models (FLUX, Seedream, Veo, Seedance and more) unlock when you host Alembic with API keys.' })
        )
      );
    } else if (env.mode === 'server') {
      const s = env.server;
      pop.append(
        el('h3', { text: 'AI on your server' }),
        el('ul', null,
          el('li', null, 'Text: ', s.text ? s.text.label + ' (' + s.text.model + ')' : 'off. Add GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY'),
          el('li', { text: 'Image engines on: ' + count('image') }),
          el('li', { text: 'Video engines on: ' + count('video') })
        ),
        el('p', { class: 'fine', text: 'Keys live in the .env file next to server.js. Restart the server after changing them.' })
      );
    } else {
      pop.append(
        el('h3', { text: 'AI is off' }),
        el('p', { class: 'fine', html: 'Run <code>node server.js</code> with an API key in <code>.env</code> to switch on AI. The README walks through it.' })
      );
    }
  }
  $('aiPill').addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = $('aiPop');
    pop.hidden = !pop.hidden;
    $('aiPill').setAttribute('aria-expanded', String(!pop.hidden));
  });
  document.addEventListener('click', (e) => {
    const pop = $('aiPop');
    if (!pop.hidden && !pop.contains(e.target)) { pop.hidden = true; $('aiPill').setAttribute('aria-expanded', 'false'); }
  });

  function renderAccessPanel() {
    const s = A.env.server;
    $('accessPanel').hidden = !(s && s.requiresAccessCode && !A.env.accessCode);
  }
  $('accessForm').addEventListener('submit', (e) => {
    e.preventDefault();
    A.setAccessCode($('accessInput').value);
    $('accessInput').value = '';
    renderAccessPanel();
    toast('Access code saved in this browser.');
  });
  function handleAiError(err) {
    if (err && err.code === 'access_code') {
      A.setAccessCode('');
      renderAccessPanel();
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    if (err && err.code !== 'cancelled') toast(A.friendlyError(err), { bad: true, ms: 6500 });
  }

  /* ========================================================= STUDIO KIT */
  function chipGroup(container, values, current, onPick, labels) {
    container.innerHTML = '';
    for (const v of values) {
      container.append(el('button', {
        type: 'button', role: 'radio', 'aria-checked': String(v === current()), dataset: { key: v },
        onclick: () => { onPick(v); keepFocus(container, () => chipGroup(container, values, current, onPick, labels)); },
      }, labels ? labels[v] || v : v));
    }
  }
  const RATIO_BOX = { '1:1': [16, 16], '16:9': [22, 12.4], '9:16': [12.4, 22], '4:3': [20, 15] };
  const RATIO_NAME = { '1:1': 'Square', '16:9': 'Wide', '9:16': 'Tall', '4:3': 'Classic' };
  function ratioGroup(container, ratios, current, onPick, allowed) {
    container.innerHTML = '';
    for (const r of ratios) {
      const [w, h] = RATIO_BOX[r];
      const ok = !allowed || allowed.includes(r);
      container.append(el('button', {
        type: 'button', role: 'radio', 'aria-checked': String(r === current()), dataset: { key: r }, disabled: !ok,
        'aria-label': RATIO_NAME[r] + ' ' + r + (ok ? '' : ' (not offered by this engine)'),
        onclick: () => { onPick(r); keepFocus(container, () => ratioGroup(container, ratios, current, onPick, allowed)); },
      }, el('i', { style: 'width:' + w + 'px;height:' + h + 'px' }), r));
    }
  }

  function engineCard(e, selected, onPick) {
    const badges = (e.badges || []).slice(0, 3).map((b) => el('span', { class: 'badge' + (/free/i.test(b) ? ' free' : '') + (/sound|audio|photo/i.test(b) ? ' real' : ''), text: b }));
    return el('button', {
      class: 'engine', type: 'button', role: 'radio', 'aria-checked': String(selected), dataset: { key: e.id },
      title: e.bestFor || '', onclick: onPick,
    },
    el('span', { class: 'engine-check', text: '✓', 'aria-hidden': 'true' }),
    el('span', { class: 'engine-name', text: e.label }),
    el('span', { class: 'engine-by', text: e.providerLabel || '' }),
    el('span', { class: 'engine-best', text: e.bestFor || '' }),
    badges.length ? el('span', { class: 'engine-badges' }, badges) : null);
  }

  /** Engine cards for available engines; locked ones grouped by provider. */
  function renderEngines(kind, st, ids) {
    const all = A.engines.list(kind);
    const avail = all.filter((e) => e.available);
    const locked = all.filter((e) => !e.available);
    if (!avail.some((e) => e.id === st.engineId)) st.engineId = avail[0] ? avail[0].id : null;
    const grid = $(ids.grid);
    keepFocus(grid, () => {
      grid.innerHTML = '';
      for (const e of avail) {
        grid.append(engineCard(e, e.id === st.engineId, () => {
          st.engineId = e.id;
          renderEngines(kind, st, ids);
          st.onEngine();
        }));
      }
      if (!avail.length) grid.append(el('p', { class: 'fine', text: A.env.resolved ? 'No engines are switched on here yet.' : 'Checking which engines are available…' }));
    });
    const more = $(ids.more);
    more.hidden = !locked.length;
    $(ids.moreSummary).textContent = locked.length + (locked.length === 1 ? ' more engine' : ' more engines') + (A.env.mode === 'server' ? ' you can switch on with API keys' : ' when you host it with API keys');
    const box = $(ids.locked);
    box.innerHTML = '';
    const groups = new Map();
    for (const e of locked) {
      const k = e.providerLabel || 'Other';
      if (!groups.has(k)) groups.set(k, { needs: e.needs || [], items: [] });
      groups.get(k).items.push(e);
    }
    for (const [label, g] of groups) {
      box.append(el('div', { class: 'locked-group' },
        el('h4', null, label, g.needs.length ? el('code', { text: g.needs.join(' + ') }) : null),
        el('ul', null, g.items.map((e) => el('li', null, el('b', { text: e.label }), el('span', { text: e.bestFor || '' }))))));
    }
  }

  async function enhancePrompt(ta, kind, btn, upd) {
    const v = ta.value.trim();
    if (!v) { toast('Write a few words first, then improve them.'); ta.focus(); return; }
    if (!A.ai.caps().text) { toast('Improving prompts needs AI, which is off right now.', { bad: true }); return; }
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '✦ Improving…';
    try {
      const out = await A.ai.text(
        'Rewrite this idea as one vivid, specific prompt for an AI ' + kind + ' generator. Keep the subject and intent; add concrete details about ' +
          (kind === 'image' ? 'composition, lighting, colour palette and mood' : 'camera movement, lighting, motion and mood') +
          '. 35 to 70 words, a single paragraph, no quotation marks, no preamble.\n\nIdea: ' + v,
        { tier: 'quick' }
      );
      ta.value = out.trim().replace(/^["'“]+|["'”]+$/g, '').slice(0, ta.maxLength);
      upd();
      toast('Prompt improved', { action: { label: 'Undo', run: () => { ta.value = v; upd(); } } });
    } catch (e) {
      handleAiError(e);
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }
  function historyStrip(container, items, current, onPick) {
    container.innerHTML = '';
    for (const it of items) {
      const media = it.kind === 'video' ? el('video', { src: it.url, muted: true, playsinline: true, preload: 'metadata' }) : el('img', { src: it.url, alt: '' });
      container.append(el('button', { type: 'button', 'aria-label': it.engineLabel + ': ' + it.prompt, 'aria-current': String(it === current), onclick: () => onPick(it) }, media));
    }
  }

  /* ----------------------------------------------------- shared notices */
  let webgl2 = null;
  function hasWebGL2() {
    if (webgl2 === null) {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        webgl2 = !!gl;
        const lose = gl && gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch (_) { webgl2 = false; }
    }
    return webgl2;
  }
  function noEngineHint(kind) {
    if (A.env.mode === 'artifact') return 'AI is not available in this view. Open the artifact inside Claude to use it.';
    if (A.env.mode === 'server') {
      return 'Add <code>GEMINI_API_KEY</code> (free) for the built-in engines, or <code>FAL_KEY</code>, <code>REPLICATE_API_TOKEN</code>' +
        (kind === 'image' ? ', <code>CLOUDFLARE_API_TOKEN</code> or <code>OPENAI_API_KEY</code>' : '') + ' for real ' + kind + ' models, then restart the server.';
    }
    return 'Run <code>node server.js</code> with an API key in <code>.env</code> (README, step 3).';
  }
  function engineNotice(kind, engine, box) {
    box.innerHTML = '';
    let strong = '', body = '';
    if (!A.env.resolved) { box.hidden = true; return; }
    if (!engine) {
      strong = kind === 'image' ? 'Image generation is off here.' : 'Video generation is off here.';
      body = noEngineHint(kind);
    } else if (engine.local && /shader/.test(engine.id) && !hasWebGL2()) {
      strong = engine.label + ' needs WebGL 2.';
      body = 'This browser does not have it. Pick another engine, or try Chrome, Edge, Firefox or Safari 15+.';
    } else if (kind === 'video' && engine.local && !A.motion.recorderType()) {
      strong = 'This browser cannot record video.';
      body = 'Built-in video engines need Chrome, Edge, Firefox or Safari 17+.';
    } else if (!engine.local && engine.note) {
      body = U.escapeHtml(engine.note);
    }
    if (strong) box.append(el('strong', { text: strong }));
    if (body) box.append(el('span', { html: body }));
    box.hidden = !(strong || body);
  }
  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }
  function ideaFamily(engineId) {
    if (!engineId) return 'default';
    if (!engineId.startsWith('local:')) return 'real';
    return engineId.slice(6);
  }

  /* ============================================================ AI IMAGE */
  const IMAGE_STYLES = {
    None: '',
    Photo: 'photorealistic photograph, natural light, shallow depth of field, 35mm',
    Illustration: 'detailed digital illustration, clean confident shapes, rich colour',
    '3D render': '3D render, soft studio lighting, subtle global illumination',
    Watercolor: 'watercolor painting on textured paper, soft bleeding edges',
    Anime: 'anime style, cel shading, expressive lighting',
    Neon: 'neon glow on a dark background, vivid magenta, cyan and violet',
    'Flat icon': 'flat vector icon, simple geometric shapes, bold colours, centred',
  };
  const IMAGE_IDEAS = {
    vector: [
      'A fox reading a book under a giant mushroom during a light rain',
      'A tiny greenhouse on the moon, glowing warm inside, Earth rising behind it',
      'A hot air balloon festival over a desert canyon at sunrise',
      'A cosy reading corner with plants, afternoon sun through tall windows',
      'A lighthouse on a rocky island under a sky full of stars',
    ],
    shader: [
      'Aurora rippling over snowy mountains under a starry sky',
      'A glowing nebula with a ringed planet in the foreground',
      'Ocean at sunset with a pink and orange sky reflecting on the waves',
      'Rolling green hills under soft drifting clouds',
      'Liquid marble swirling in teal, ink blue and gold',
    ],
    pixel: [
      'A cosy cabin in a snowy forest at night, warm glowing windows',
      'A knight with a sword and shield, 16-bit hero sprite',
      'A tiny dragon sleeping on a pile of gold coins',
      'A cat café storefront with a striped awning',
      'A spaceship flying past a ringed planet',
    ],
    real: [
      'A lighthouse made of glass on a cliff, aurora in the sky',
      'A busy night market with paper lanterns, steam rising from food stalls',
      'Macro photo of a dew-covered spider web at sunrise',
      'A ceramic coffee cup on a wooden table, morning light, shallow depth of field',
      'An astronaut tending a vegetable garden inside a space station',
    ],
  };
  IMAGE_IDEAS.default = IMAGE_IDEAS.vector;
  const EXAMPLE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs>' +
    '<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#241552"/><stop offset=".48" stop-color="#c2477c"/><stop offset=".72" stop-color="#ffae5c"/></linearGradient>' +
    '<radialGradient id="g"><stop offset="0" stop-color="#fff3cf"/><stop offset=".55" stop-color="#ffd27a" stop-opacity=".9"/><stop offset="1" stop-color="#ffae5c" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a66"/><stop offset=".3" stop-color="#7c3d86"/><stop offset="1" stop-color="#170f3d"/></linearGradient>' +
    '<linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#93407b"/><stop offset="1" stop-color="#5a2668"/></linearGradient></defs>' +
    '<rect width="1024" height="1024" fill="url(#s)"/>' +
    '<g fill="#fff" opacity=".7"><circle cx="140" cy="120" r="2"/><circle cx="300" cy="80" r="1.5"/><circle cx="820" cy="140" r="2"/><circle cx="660" cy="60" r="1.5"/><circle cx="930" cy="250" r="1.8"/><circle cx="90" cy="300" r="1.4"/></g>' +
    '<circle cx="512" cy="590" r="280" fill="url(#g)"/><circle cx="512" cy="590" r="112" fill="#ffe6ae"/>' +
    '<path d="M0 620 120 548l90 44 120-86 120 90 110-70 130 80 110-70 110 56 114-46v120H0z" fill="url(#m)"/>' +
    '<path d="M0 650c150-40 260 10 400-15 160-29 300 35 450 5 80-15 140-5 174 0v30H0z" fill="#3d1d5c"/>' +
    '<rect y="664" width="1024" height="360" fill="url(#w)"/>' +
    '<g fill="#ffe2a3"><rect x="428" y="684" width="168" height="7" rx="3.5" opacity=".9"/><rect x="452" y="708" width="120" height="6" rx="3" opacity=".75"/><rect x="472" y="732" width="80" height="5" rx="2.5" opacity=".6"/><rect x="490" y="756" width="44" height="4" rx="2" opacity=".45"/></g>' +
    '<g stroke="#fff" stroke-opacity=".2" stroke-width="4" stroke-linecap="round"><path d="M110 820h130M760 880h170M250 940h90M650 780h70"/></g>' +
    '<g transform="translate(600 830)"><path d="M-170 0h340l-58 58h-224z" fill="#fbf3e6"/><path d="M-170 0 0-190V0z" fill="#fff"/><path d="M0-190 170 0H0z" fill="#e7d9c6"/><path d="M-112 66h224l-26 30h-172z" fill="#fbf3e6" opacity=".16"/></g>' +
    '<g stroke="#2a1856" stroke-width="5" fill="none" stroke-linecap="round" opacity=".75"><path d="M300 340q14-15 28 0 14-15 28 0M386 300q10-11 20 0 10-11 20 0"/></g></svg>';
  const HISTORY_MAX = 40; // per studio, also the most "My creations" keeps in this browser

  function newId() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  const Img = {
    kind: 'image', ratio: '1:1', style: 'None', engineId: null, history: [], current: null, ctl: null, confirmClear: false,
    ids: { grid: 'imgEngines', more: 'imgMore', moreSummary: 'imgMoreSummary', locked: 'imgLocked', galleryHead: 'imgGalleryHead', history: 'imgHistory' },
    init() {
      this.upd = counter($('imgPrompt'), $('imgCount'));
      chipGroup($('imgStyles'), Object.keys(IMAGE_STYLES), () => this.style, (v) => { this.style = v; });
      this.renderRatios();
      $('imgEnhance').addEventListener('click', () => enhancePrompt($('imgPrompt'), 'image', $('imgEnhance'), this.upd));
      $('imgSurprise').addEventListener('click', () => {
        $('imgPrompt').value = pick(IMAGE_IDEAS[ideaFamily(this.engineId)] || IMAGE_IDEAS.default);
        this.upd();
      });
      $('imgForm').addEventListener('submit', (e) => { e.preventDefault(); this.generate(); });
      $('imgPrompt').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.generate(); }
      });
      $('imgStop').addEventListener('click', () => this.ctl && this.ctl.abort());
      const ex = new Blob([EXAMPLE_SVG], { type: 'image/svg+xml' });
      this.exampleImg = el('img', { src: objectUrl(ex), alt: 'Example: a paper boat on a lake at sunset, drawn by the Vector Illustrator engine' });
      $('imgMedia').append(this.exampleImg);
      this.refresh();
    },
    /** Back to the example picture (nothing left in My creations). */
    resetStage() {
      this.current = null;
      $('imgStage').dataset.ratio = '1:1';
      $('imgMedia').replaceChildren(this.exampleImg);
      $('imgTag').textContent = 'Example';
      $('imgActions').innerHTML = '';
      Gallery.render(this);
    },
    engine() {
      return this.engineId ? A.engines.find('image', this.engineId) : null;
    },
    renderRatios() {
      const e = this.engine();
      const allowed = e && e.aspects;
      if (allowed && !allowed.includes(this.ratio)) this.ratio = allowed[0];
      ratioGroup($('imgRatios'), ['1:1', '16:9', '9:16', '4:3'], () => this.ratio, (r) => { this.ratio = r; }, allowed);
    },
    onEngine() {
      this.renderRatios();
      engineNotice('image', this.engine(), $('imgNotice'));
    },
    refresh() {
      renderEngines('image', this, this.ids);
      this.onEngine();
      $('imgGo').disabled = !this.engine() || !!this.ctl;
    },
    async generate() {
      const prompt = $('imgPrompt').value.trim();
      if (!prompt) { toast('Describe the picture you want first.'); $('imgPrompt').focus(); return; }
      if (this.ctl) return;
      const engine = this.engine();
      if (!engine || !engine.available) { toast('No image engine is switched on here yet.', { bad: true }); return; }
      const ctl = (this.ctl = new AbortController());
      const ratio = this.ratio;
      $('imgGo').disabled = true;
      $('imgBusy').hidden = false;
      $('imgStage').dataset.ratio = ratio;
      $('imgBusyTitle').textContent = 'Starting ' + engine.label + '…';
      revealStage($('imgStage'));
      const stopTimer = busyTimer($('imgElapsed'));
      try {
        const out = await A.engines.run(engine, {
          prompt, style: IMAGE_STYLES[this.style], aspect: ratio, signal: ctl.signal,
          onStage: (s) => { $('imgBusyTitle').textContent = s; },
        });
        const item = Object.assign(out, { id: newId(), createdAt: Date.now(), url: URL.createObjectURL(out.blob), prompt, ratio, style: this.style, engineId: engine.id, engineLabel: engine.label });
        Gallery.add(this, item);
        this.show(item);
      } catch (e) {
        handleAiError(e);
        if (!this.current) $('imgStage').dataset.ratio = '1:1';
        else $('imgStage').dataset.ratio = this.current.ratio;
      } finally {
        stopTimer();
        this.ctl = null;
        $('imgBusy').hidden = true;
        $('imgGo').disabled = !this.engine();
      }
    },
    show(item) {
      this.current = item;
      $('imgStage').dataset.ratio = item.ratio;
      $('imgMedia').replaceChildren(el('img', { src: item.url, alt: item.prompt, class: item.engineId === 'local:pixel' ? 'pixel' : null }));
      $('imgTag').textContent = item.engineLabel + ' · ' + item.ratio;
      const name = U.slug(item.prompt, 'alembic-image');
      const acts = $('imgActions');
      fill(acts,
        el('button', { class: 'save-btn', type: 'button', html: ICON.download + '<span>' + item.ext.toUpperCase() + '</span>', onclick: () => saveBlob(item.blob, name + '.' + item.ext) }),
        item.extras && item.extras.svg ? el('button', { class: 'ghost-btn', type: 'button', onclick: () => saveBlob(new Blob([item.extras.svg], { type: 'image/svg+xml' }), name + '.svg') }, 'SVG') : null,
        item.extras && item.extras.shader ? el('button', { class: 'ghost-btn', type: 'button', onclick: () => copyText(item.extras.shader) }, 'Copy shader') : null,
        el('button', { class: 'ghost-btn', type: 'button', onclick: () => Video.fromImage(item) }, 'Make it move'),
        el('button', { class: 'ghost-btn', type: 'button', onclick: () => { $('imgPrompt').value = item.prompt; this.upd(); $('imgPrompt').focus(); } }, 'Reuse prompt'),
        el('button', { class: 'ghost-btn', type: 'button', 'aria-label': 'Delete this image from My creations', onclick: () => Gallery.remove(this, item) }, 'Delete'),
        el('span', { class: 'stage-caption', title: item.engineLabel + ' · ' + item.prompt, text: [item.engineLabel, item.extras && item.extras.note, U.formatBytes(item.blob.size)].filter(Boolean).join(' · ') })
      );
      this.renderAlso(item);
      Gallery.render(this);
    },
    /** One-click "try the same prompt with another engine". */
    renderAlso(item) {
      const others = A.engines.list('image').filter((e) => e.available && e.id !== item.engineId).slice(0, 4);
      if (!others.length) return;
      $('imgActions').append(el('div', { class: 'chips also', role: 'group', 'aria-label': 'Try the same prompt with another engine' },
        el('span', { class: 'fine', text: 'Same prompt with:' }),
        others.map((e) => el('button', {
          type: 'button',
          onclick: () => {
            this.engineId = e.id;
            if (e.aspects && e.aspects.includes(item.ratio)) this.ratio = item.ratio;
            $('imgPrompt').value = item.prompt;
            this.upd();
            this.refresh();
            this.generate();
          },
        }, e.label))));
    },
  };

  /* ============================================================ AI VIDEO */
  const VIDEO_STYLES = {
    None: '',
    Cinematic: 'cinematic, dramatic lighting, smooth camera movement',
    Dreamy: 'dreamy, soft pastel light, gentle floating motion',
    Neon: 'neon synthwave colours, glowing lights on dark',
    Nature: 'natural colours, calm documentary feel',
    Anime: 'anime style, vibrant cel-shaded colours',
    Minimal: 'minimal, clean geometric shapes, limited palette',
  };
  const VIDEO_IDEAS = {
    motion: [
      'Fireflies rising over a dark forest lake while the moon comes up',
      'A retro synthwave highway at sunset with a striped sun',
      'Snow falling slowly over quiet blue mountains at night',
      'An opening title card that says "Welcome to Alembic" with sparkles',
    ],
    'shader-film': [
      'Northern lights rippling over a frozen lake',
      'Flying slowly through a glowing purple nebula',
      'Ocean waves rolling under a warm orange sky',
      'Liquid gold and teal swirling like ink in water',
    ],
    story: [
      'A seed grows into a giant tree that shelters a village',
      'A paper plane travels from a city window out to the sea',
      'A little robot finds a flower on a desert planet',
    ],
    real: [
      'A golden retriever running through autumn leaves in slow motion',
      'Drone shot over turquoise sea cliffs at sunrise',
      'A barista pouring latte art, close-up, steam rising',
      'Rain on a neon-lit city street at night, people with umbrellas',
    ],
  };
  VIDEO_IDEAS.default = VIDEO_IDEAS.motion;
  const MUSIC = ['auto', 'calm', 'upbeat', 'epic', 'mystery', 'off'];
  const MUSIC_LABEL = { auto: 'Auto', calm: 'Calm', upbeat: 'Upbeat', epic: 'Epic', mystery: 'Mystery', off: 'Off' };

  const Video = {
    kind: 'video', ratio: '16:9', duration: 6, style: 'Cinematic', music: 'auto', engineId: null, history: [], current: null, ctl: null, raf: 0, confirmClear: false,
    source: null, // Make it move: {blob, url} of the picture a clip starts from
    ids: { grid: 'vidEngines', more: 'vidMore', moreSummary: 'vidMoreSummary', locked: 'vidLocked', galleryHead: 'vidGalleryHead', history: 'vidHistory' },
    init() {
      this.upd = counter($('vidPrompt'), $('vidCount'));
      chipGroup($('vidStyles'), Object.keys(VIDEO_STYLES), () => this.style, (v) => { this.style = v; });
      chipGroup($('vidMusic'), MUSIC, () => this.music, (v) => { this.music = v; }, MUSIC_LABEL);
      $('vidEnhance').addEventListener('click', () => enhancePrompt($('vidPrompt'), 'video', $('vidEnhance'), this.upd));
      $('vidSurprise').addEventListener('click', () => {
        $('vidPrompt').value = pick(VIDEO_IDEAS[ideaFamily(this.engineId)] || VIDEO_IDEAS.default);
        this.upd();
      });
      $('vidForm').addEventListener('submit', (e) => { e.preventDefault(); this.generate(); });
      $('vidPrompt').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this.generate(); }
      });
      $('vidStop').addEventListener('click', () => this.ctl && this.ctl.abort());
      const c = (this.exampleCanvas = document.createElement('canvas'));
      c.width = 960;
      c.height = 540;
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', 'Example clip: a neon sunset over a retro grid, made by the Motion Graphics engine');
      this.examplePlayer = A.motion.createPlayer(c, A.motion.normalize(A.motion.EXAMPLE, { duration: 6 }));
      this.examplePlayer.draw(1.5);
      $('vidMedia').append(c);
      this.refresh();
    },
    engine() {
      return this.engineId ? A.engines.find('video', this.engineId) : null;
    },
    renderOptions() {
      const e = this.engine();
      const durations = (e && e.durations) || [4, 6, 8];
      if (!durations.includes(this.duration)) {
        this.duration = durations.reduce((best, d) => (Math.abs(d - this.duration) < Math.abs(best - this.duration) ? d : best), durations[0]);
      }
      const box = $('vidDurations');
      keepFocus(box, () => {
        box.innerHTML = '';
        for (const d of durations) {
          box.append(el('button', {
            type: 'button', role: 'radio', 'aria-checked': String(d === this.duration), dataset: { key: String(d) },
            onclick: () => { this.duration = d; this.renderOptions(); },
          }, d + ' s'));
        }
      });
      const allowed = e && e.aspects;
      if (allowed && !allowed.includes(this.ratio)) this.ratio = allowed[0];
      ratioGroup($('vidRatios'), ['16:9', '9:16', '1:1'], () => this.ratio, (r) => { this.ratio = r; }, allowed);
      $('vidMusicField').hidden = !(e && e.soundtrack);
    },
    onEngine() {
      this.renderOptions();
      engineNotice('video', this.engine(), $('vidNotice'));
      this.renderSource();
    },
    /** Engines switched on here that can start a clip from a picture. */
    animators() {
      return A.engines.list('video').filter((e) => e.available && !e.local && e.fromImage);
    },
    setSource(item) {
      if (this.source) URL.revokeObjectURL(this.source.url);
      this.source = item ? { blob: item.blob, url: URL.createObjectURL(item.blob) } : null;
      this.renderSource();
    },
    /** The "Starting picture" card: says whether the chosen engine will use it. */
    renderSource() {
      const box = $('vidSource');
      if (!this.source) { box.hidden = true; box.replaceChildren(); return; }
      const e = this.engine();
      const can = !!(e && !e.local && e.fromImage);
      const names = this.animators().map((x) => x.label).join(', ');
      fill(box,
        el('img', { src: this.source.url, alt: 'Starting picture' }),
        el('div', { class: 'source-text' },
          el('strong', { text: 'Starting picture' }),
          el('span', { class: 'fine', text: can ? 'The clip starts from this picture and keeps its shape. Describe the motion you want.' : names ? (e ? e.label : 'This engine') + ' starts from the prompt only. Pick ' + names + ' to animate the picture.' : 'Animating a picture needs a real video model (FAL_KEY on your server).' })),
        el('button', { class: 'ghost-btn', type: 'button', 'aria-label': 'Remove the starting picture', onclick: () => { this.setSource(null); $('vidPrompt').focus(); } }, 'Remove'));
      box.classList.toggle('off', !can);
      box.hidden = false;
    },
    refresh() {
      renderEngines('video', this, this.ids);
      this.onEngine();
      $('vidGo').disabled = !this.engine() || !!this.ctl;
    },
    visible(on) {
      cancelAnimationFrame(this.raf);
      if (!on || this.current || this.ctl || reduceMotion || !this.examplePlayer) return;
      const t0 = performance.now();
      const loop = (now) => {
        this.examplePlayer.draw(((now - t0) / 1000) % this.examplePlayer.duration);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    },
    /**
     * From the image studio. With a real image-to-video model the clip starts from the picture
     * itself; otherwise the same idea is drawn again as a clip by a built-in engine.
     */
    fromImage(item) {
      $('vidPrompt').value = item.prompt;
      this.upd();
      const prefer = item.engineId === 'local:shader' ? 'local:shader-film' : item.engineId === 'local:vector' || item.engineId === 'local:pixel' ? 'local:motion' : null;
      const avail = A.engines.list('video').filter((e) => e.available);
      const animator = this.animators()[0];
      const target = animator || avail.find((e) => !e.local) || avail.find((e) => e.id === prefer);
      if (target) this.engineId = target.id;
      if (['16:9', '9:16', '1:1'].includes(item.ratio)) this.ratio = item.ratio;
      this.setSource(animator ? item : null);
      this.refresh();
      go('video');
      requestAnimationFrame(() => $('vidPrompt').focus());
      toast(animator ? 'Ready to animate your picture with ' + animator.label + '. Describe the motion, then press Generate.' : 'Prompt copied to the video studio. Press Generate when ready.');
    },
    steps(names, active) {
      const box = $('vidSteps');
      box.innerHTML = '';
      names.forEach((n, i) => box.append(el('span', { class: i < active ? 'done' : i === active ? 'on' : '', text: (i < active ? '✓ ' : '') + n })));
    },
    restoreStage() {
      if (this.current) { this.show(this.current); return; }
      $('vidStage').dataset.ratio = '16:9';
      $('vidMedia').replaceChildren(this.exampleCanvas);
      $('vidTag').textContent = 'Example · live';
      $('vidActions').innerHTML = '';
      this.visible(view === 'video');
    },
    /** Back to the live example (nothing left in My creations). */
    resetStage() {
      this.current = null;
      this.restoreStage();
      Gallery.render(this);
    },
    async generate() {
      const prompt = $('vidPrompt').value.trim();
      if (!prompt) { toast('Describe the clip you want first.'); $('vidPrompt').focus(); return; }
      if (this.ctl) return;
      const engine = this.engine();
      if (!engine || !engine.available) { toast('No video engine is switched on here yet.', { bad: true }); return; }
      const ctl = (this.ctl = new AbortController());
      const ratio = this.ratio, duration = this.duration;
      cancelAnimationFrame(this.raf);
      $('vidGo').disabled = true;
      $('vidBusy').hidden = false;
      $('vidStage').dataset.ratio = ratio;
      $('vidBusyTitle').textContent = 'Starting ' + engine.label + '…';
      revealStage($('vidStage'));
      const names = ['Queued', 'Generating', 'Downloading'];
      if (engine.local) $('vidSteps').innerHTML = '';
      else this.steps(names, 0);
      const stopTimer = busyTimer($('vidElapsed'));
      try {
        const image = this.source && engine.fromImage && !engine.local ? this.source.blob : null;
        const out = await A.engines.run(engine, {
          prompt, style: VIDEO_STYLES[this.style], aspect: ratio, duration, music: this.music, image, signal: ctl.signal,
          onStage: (s) => { $('vidBusyTitle').textContent = s; },
          onStep: (i) => this.steps(names, i),
          onCanvas: (c) => {
            // Show the clip while it records, with a way to stop.
            c.setAttribute('role', 'img');
            c.setAttribute('aria-label', 'Recording your clip');
            $('vidMedia').replaceChildren(c);
            $('vidBusy').hidden = true;
            $('vidTag').textContent = 'Recording · 0%';
            $('vidActions').replaceChildren(
              el('button', { class: 'ghost-btn', type: 'button', onclick: () => ctl.abort() }, 'Stop'),
              el('span', { class: 'stage-caption', text: 'Recording in real time, ' + duration + ' seconds. Keep this tab open.' })
            );
          },
          onProgress: (p) => { $('vidTag').textContent = 'Recording · ' + Math.min(100, Math.round(p * 100)) + '%'; },
        });
        const item = Object.assign(out, { id: newId(), createdAt: Date.now(), url: URL.createObjectURL(out.blob), prompt, ratio, seconds: duration, engineId: engine.id, engineLabel: engine.label });
        Gallery.add(this, item);
        this.show(item);
      } catch (e) {
        handleAiError(e);
        if (e && e.code === 'cancelled' && e.provider) {
          toast(e.providerCanceled
            ? 'Stopped, and ' + e.provider + ' was told to cancel the clip.'
            : 'Stopped. ' + e.provider + ' had already finished or cannot cancel this clip, so it may still be billed.', { ms: 6500 });
        }
        this.ctl = null;
        this.restoreStage();
      } finally {
        stopTimer();
        this.ctl = null;
        $('vidBusy').hidden = true;
        $('vidGo').disabled = !this.engine();
      }
    },
    show(item) {
      this.current = item;
      cancelAnimationFrame(this.raf);
      $('vidStage').dataset.ratio = item.ratio;
      $('vidMedia').replaceChildren(el('video', { src: item.url, controls: true, loop: true, muted: true, autoplay: true, playsinline: true, 'aria-label': item.prompt }));
      $('vidTag').textContent = item.engineLabel + ' · ' + item.ext.toUpperCase();
      const x = item.extras || {};
      const sound = (x.fromImage ? 'from your picture · ' : '') + (x.audio ? (x.mood ? '♪ ' + x.mood + ' soundtrack' : '♪ sound') : 'no sound');
      fill($('vidActions'),
        el('button', { class: 'save-btn', type: 'button', html: ICON.download + '<span>' + item.ext.toUpperCase() + '</span>', onclick: () => saveBlob(item.blob, U.slug(x.title || item.prompt, 'alembic-clip') + '.' + item.ext) }),
        x.shader ? el('button', { class: 'ghost-btn', type: 'button', onclick: () => copyText(x.shader) }, 'Copy shader') : null,
        el('button', { class: 'ghost-btn', type: 'button', onclick: () => { $('vidPrompt').value = item.prompt; this.upd(); $('vidPrompt').focus(); } }, 'Reuse prompt'),
        el('button', { class: 'ghost-btn', type: 'button', 'aria-label': 'Delete this clip from My creations', onclick: () => Gallery.remove(this, item) }, 'Delete'),
        el('span', { class: 'stage-caption', title: item.engineLabel + ' · ' + item.prompt, text: [item.engineLabel, item.seconds + ' s', sound, U.formatBytes(item.blob.size)].join(' · ') })
      );
      Gallery.render(this);
    },
  };

  /* ====================================================== MY CREATIONS */
  // Each studio's history doubles as "My creations": kept in this browser (IndexedDB) when it
  // allows, so it survives a reload; otherwise only until the tab closes.
  let storageWarned = false;
  const Gallery = {
    ok: false,
    /** Load saved creations into both studios (merging with anything made meanwhile). */
    async init() {
      this.ok = await A.gallery.available();
      for (const st of [Img, Video]) {
        if (this.ok) {
          let saved = [];
          try { saved = await A.gallery.list(st.kind); } catch (_) { saved = []; }
          const have = new Set(st.history.map((it) => it.id));
          for (const rec of saved) {
            if (have.has(rec.id)) continue;
            rec.extras = rec.extras || {};
            rec.url = URL.createObjectURL(rec.blob);
            st.history.push(rec);
          }
          st.history.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          this.trim(st);
        }
        if (!st.current && !st.ctl && st.history.length) st.show(st.history[0]);
        else this.render(st);
      }
    },
    trim(st) {
      while (st.history.length > HISTORY_MAX) {
        const old = st.history.pop();
        if (old.url) URL.revokeObjectURL(old.url);
        if (this.ok) A.gallery.remove(old.id).catch(() => {});
      }
    },
    /** A new creation: newest first, and saved in this browser. */
    add(st, item) {
      st.history.unshift(item);
      this.trim(st);
      A.gallery.available().then((ok) => ok && A.gallery.put(item)).catch((e) => {
        if (storageWarned) return;
        storageWarned = true;
        toast((e && e.name === 'QuotaExceededError' ? 'Your browser storage is full, so' : 'This browser would not store it, so') +
          ' new creations stay only until you close this tab. Download them, or delete old ones.', { bad: true, ms: 8000 });
      });
    },
    busy(st) {
      // A built-in clip records from the canvas on stage: leave it alone until it is done.
      if (st.kind === 'video' && st.ctl) { toast('Wait until this clip is finished.'); return true; }
      return false;
    },
    remove(st, item) {
      const i = st.history.indexOf(item);
      if (i === -1 || this.busy(st)) return;
      st.history.splice(i, 1);
      if (this.ok) A.gallery.remove(item.id).catch(() => {});
      if (st.current === item) {
        const next = st.history[Math.min(i, st.history.length - 1)];
        if (next) st.show(next);
        else st.resetStage();
      } else this.render(st);
      toast('Deleted from My creations.', { ms: 6000, action: { label: 'Undo', run: () => this.undo(st, item) } });
      setTimeout(() => {
        if (!st.history.includes(item) && item.url) { URL.revokeObjectURL(item.url); item.url = null; }
      }, 6500);
    },
    undo(st, item) {
      if (st.history.includes(item) || this.busy(st)) return;
      if (!item.url) item.url = URL.createObjectURL(item.blob);
      st.history.push(item);
      st.history.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (this.ok) A.gallery.put(item).catch(() => {});
      st.show(item);
    },
    clear(st) {
      if (this.busy(st)) return;
      const items = st.history.splice(0);
      st.confirmClear = false;
      if (this.ok) A.gallery.clear(st.kind).catch(() => {});
      for (const it of items) if (it.url) URL.revokeObjectURL(it.url);
      st.resetStage();
      toast('Deleted all ' + (st.kind === 'image' ? 'images' : 'videos') + ' from My creations.');
    },
    /** Every creation of a studio in one zip, oldest first, with a prompts.md index. */
    async zip(st, btn) {
      const items = st.history.slice().reverse();
      if (!items.length) return;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Zipping…';
      try {
        const JSZip = await A.libs.jszip();
        const zip = new JSZip();
        const rows = [];
        items.forEach((it, i) => {
          const x = it.extras || {};
          const base = String(i + 1).padStart(2, '0') + '-' + U.slug(x.title || it.prompt, st.kind);
          zip.file(base + '.' + it.ext, it.blob);
          if (x.svg) zip.file(base + '.svg', x.svg);
          const cell = (v) => String(v || '').replace(/\s+/g, ' ').replace(/\|/g, '\\|');
          rows.push('| ' + [base + '.' + it.ext, it.engineLabel, new Date(it.createdAt || Date.now()).toLocaleString(), it.prompt].map(cell).join(' | ') + ' |');
        });
        const plural = st.kind === 'image' ? 'images' : 'videos';
        zip.file('prompts.md', '# Alembic ' + plural + '\n\n| File | Engine | Made | Prompt |\n|---|---|---|---|\n' + rows.join('\n') + '\n');
        const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        await saveBlob(blob, 'alembic-' + plural + '.zip');
      } catch (e) {
        toast(A.friendlyError(e), { bad: true });
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    },
    /** The history strip and its "My creations" header (count, size, Download all, Clear). */
    render(st) {
      historyStrip($(st.ids.history), st.history, st.current, (it) => { if (!this.busy(st)) st.show(it); });
      const head = $(st.ids.galleryHead);
      const n = st.history.length;
      head.hidden = !n;
      if (!n) { st.confirmClear = false; head.replaceChildren(); return; }
      const noun = n === 1 ? st.kind : st.kind === 'image' ? 'images' : 'videos';
      const size = st.history.reduce((t, it) => t + (it.blob ? it.blob.size : 0), 0);
      const tools = st.confirmClear
        ? [
          el('button', { class: 'ghost-btn danger', type: 'button', dataset: { key: 'yes' }, onclick: () => this.clear(st) }, 'Delete all ' + n),
          el('button', { class: 'ghost-btn', type: 'button', dataset: { key: 'keep' }, onclick: () => { st.confirmClear = false; this.render(st); head.querySelector('[data-key="clear"]').focus(); } }, 'Keep them'),
        ]
        : [
          el('button', { class: 'ghost-btn', type: 'button', dataset: { key: 'zip' }, onclick: (e) => this.zip(st, e.currentTarget) }, 'Download all'),
          el('button', { class: 'ghost-btn', type: 'button', dataset: { key: 'clear' }, onclick: () => { st.confirmClear = true; this.render(st); head.querySelector('[data-key="keep"]').focus(); } }, 'Clear'),
        ];
      fill(head,
        el('h2', { text: 'My creations' }),
        el('span', { class: 'fine', text: n + ' ' + noun + ' · ' + U.formatBytes(size) + ' · ' + (this.ok ? 'kept in this browser' : 'this session only') }),
        el('div', { class: 'gallery-tools', role: 'group', 'aria-label': 'My creations' }, tools));
    },
  };

  /* ========================================================== AI SUMMARY */
  const FAMILY = { pdf: '--doc', docx: '--media', sheet: '--img', slides: '--ai', text: '--doc', image: '--img', video: '--media', audio: '--media' };

  function thinking(label) {
    return el('div', { class: 'thinking' }, el('div', { class: 'orbit', 'aria-hidden': 'true' }), el('span', { text: label }));
  }
  /** Render streaming Markdown with a blinking cursor at the end. */
  function paintMarkdown(target, text, streaming) {
    const box = el('div', { class: 'md', html: A.markdown.render(text) });
    if (streaming) {
      let last = box.lastElementChild;
      while (last && /^(UL|OL|DIV|TABLE|TBODY|TR|BLOCKQUOTE)$/.test(last.tagName) && last.lastElementChild) last = last.lastElementChild;
      (last || box).append(el('span', { class: 'cursor', 'aria-hidden': 'true' }));
    }
    target.replaceChildren(box);
  }
  /** Coalesce many streaming updates into one paint per frame. */
  function painter(fn) {
    let pending = false, latest = '';
    return (text) => {
      latest = text;
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; fn(latest); });
    };
  }

  const Sum = {
    digest: null, file: null, mode: 'summary', length: 'medium', language: 'Same as file',
    results: new Map(), history: [], ctl: null, chatCtl: null, readCtl: null, urls: [],
    init() {
      this.renderModes();
      this.renderLengths();
      const sel = $('langSelect');
      for (const l of A.summary.LANGUAGES) sel.append(el('option', { value: l, text: l === 'Same as file' ? 'Language: same as file' : l }));
      sel.value = this.language;
      sel.addEventListener('change', () => { this.language = sel.value; this.run(); });

      const dz = $('dropzone');
      const input = $('fileInput');
      const browse = () => input.click();
      dz.addEventListener('click', (e) => { if (!e.target.closest('#browseBtn')) browse(); });
      dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); browse(); } });
      $('browseBtn').addEventListener('click', (e) => { e.stopPropagation(); browse(); });
      input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) this.open(f); });
      let depth = 0;
      dz.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; dz.classList.add('over'); $('dropTitle').textContent = 'Drop to summarize'; });
      dz.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
      dz.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; dz.classList.remove('over'); $('dropTitle').textContent = 'Drop a file to summarize'; } });
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        depth = 0;
        dz.classList.remove('over');
        $('dropTitle').textContent = 'Drop a file to summarize';
        const f = e.dataTransfer && e.dataTransfer.files[0];
        if (f) this.open(f);
      });
      // A file dropped anywhere on the page opens in the Summary view.
      window.addEventListener('dragover', (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
      });
      window.addEventListener('drop', (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        e.preventDefault();
        go('summary');
        this.open(f);
      });
      document.addEventListener('paste', (e) => {
        if (view !== 'summary') return;
        const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
        if (f) { e.preventDefault(); this.open(f); }
      });

      document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', () => {
        const s = A.SAMPLES && A.SAMPLES[b.dataset.sample];
        if (!s) { toast('That sample is missing.', { bad: true }); return; }
        this.open(new File([U.base64ToBlob(s.b64, s.mime)], s.name, { type: s.mime }));
      }));
      $('changeFile').addEventListener('click', () => this.close());
      $('chatForm').addEventListener('submit', (e) => { e.preventDefault(); this.ask($('chatInput').value); });
      this.refreshAi();
    },
    key() {
      return this.mode + '|' + this.length + '|' + this.language;
    },
    renderModes() {
      const box = $('modeTabs');
      keepFocus(box, () => {
        box.innerHTML = '';
        for (const [k, m] of Object.entries(A.summary.MODES)) {
          box.append(el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === this.mode), dataset: { key: k }, onclick: () => this.setMode(k) }, m.label));
        }
      });
    },
    renderLengths() {
      const box = $('lengthSeg');
      keepFocus(box, () => {
        box.innerHTML = '';
        for (const [k, l] of Object.entries(A.summary.LENGTHS)) {
          box.append(el('button', {
            type: 'button', role: 'radio', 'aria-checked': String(k === this.length), dataset: { key: k },
            onclick: () => { if (this.length === k) return; this.length = k; this.renderLengths(); this.run(); },
          }, l.label));
        }
      });
    },
    setMode(k) {
      if (this.mode === k) return;
      this.mode = k;
      this.renderModes();
      this.run();
    },
    refreshAi() {
      const on = A.ai.caps().text;
      $('chatInput').disabled = !on || !this.digest;
      $('chatSend').disabled = !on || !this.digest || !!this.chatCtl;
      $('chatInput').placeholder = on ? 'Ask anything about this file' : 'Questions need AI, which is off here';
    },
    trackUrl(blob) {
      const u = URL.createObjectURL(blob);
      this.urls.push(u);
      return u;
    },
    stopAll() {
      for (const c of [this.ctl, this.chatCtl, this.readCtl]) if (c) c.abort();
      this.ctl = this.chatCtl = this.readCtl = null;
    },
    close(focus = true) {
      this.stopAll();
      this.digest = null;
      this.file = null;
      this.results.clear();
      this.history = [];
      for (const u of this.urls) URL.revokeObjectURL(u);
      this.urls = [];
      $('sumBench').hidden = true;
      $('sumIntro').hidden = false;
      if (focus) $('dropzone').focus({ preventScroll: true });
    },
    async open(file) {
      this.close(false);
      const kind = A.readers.kindOf(file);
      if (kind === 'unknown') { toast(A.readers.unsupportedReason(file), { bad: true, ms: 6500 }); return; }
      this.file = file;
      $('sumIntro').hidden = true;
      $('sumBench').hidden = false;
      const thumb = $('fileThumb');
      thumb.style.setProperty('--fam', 'var(' + (FAMILY[kind] || '--doc') + ')');
      thumb.replaceChildren((U.ext(file.name) || kind).toUpperCase().slice(0, 4));
      $('fileName').textContent = file.name;
      $('fileType').textContent = A.readers.KIND_LABEL[kind] + ' · ' + U.formatBytes(file.size);
      $('fileFacts').innerHTML = '';
      $('fileFrames').hidden = true;
      $('fileFrames').innerHTML = '';
      $('fileWarnings').innerHTML = '';
      $('readProgress').hidden = false;
      $('readFill').style.width = '4%';
      $('readLabel').textContent = 'Opening…';
      $('sumBody').replaceChildren(thinking('Reading ' + file.name + '…'));
      $('sumActions').innerHTML = '';
      $('dataGlance').hidden = true;
      $('dataTables').innerHTML = '';
      $('chatLog').innerHTML = '';
      $('chatSuggest').innerHTML = '';
      $('chatInput').value = '';
      this.refreshAi();
      const top = $('sumBench').getBoundingClientRect().top;
      if (top < 0 || top > innerHeight * 0.6) $('sumBench').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });

      await A.env.ready;
      const caps = A.ai.caps();
      const ctl = (this.readCtl = new AbortController());
      try {
        const d = await A.readers.read(file, {
          signal: ctl.signal,
          maxImages: caps.maxImages,
          media: caps.media,
          progress: (p, label) => {
            if (this.readCtl !== ctl) return;
            $('readFill').style.width = Math.round(Math.max(0.04, Math.min(1, p)) * 100) + '%';
            if (label) $('readLabel').textContent = label;
          },
        });
        if (this.readCtl !== ctl) return;
        this.readCtl = null;
        this.digest = d;
        this.renderFile(d);
        if (!A.ai.caps().text) this.aiOff();
        else this.run();
      } catch (e) {
        if (this.readCtl !== ctl) return;
        this.readCtl = null;
        if (e && e.code === 'cancelled') return;
        $('sumBody').replaceChildren(el('div', { class: 'err-box', role: 'alert' },
          el('span', { text: A.friendlyError(e) }),
          el('div', null, el('button', { class: 'ghost-btn', type: 'button', onclick: () => { this.close(); $('fileInput').click(); } }, 'Choose another file'))));
      } finally {
        if (!this.readCtl) $('readProgress').hidden = true;
      }
    },
    renderFile(d) {
      if (d.thumb) $('fileThumb').replaceChildren(el('img', { src: this.trackUrl(d.thumb), alt: '' }));
      const facts = $('fileFacts');
      facts.innerHTML = '';
      for (const [k, v] of d.facts.filter(([k]) => k !== 'Type' && k !== 'Size')) facts.append(el('dt', { text: k }), el('dd', { text: v }));
      if (d.frames && d.frames.length > 1) {
        const box = $('fileFrames');
        const step = Math.max(1, Math.floor(d.frames.length / 6));
        const shown = d.frames.filter((_, i) => i % step === 0).slice(0, 6);
        box.replaceChildren(...shown.map((f) => el('figure', null, el('img', { src: this.trackUrl(f.blob), alt: 'Frame at ' + U.formatTime(f.t) }), el('figcaption', { text: U.formatTime(f.t) }))));
        box.hidden = false;
      }
      $('fileWarnings').replaceChildren(...d.warnings.map((w) => el('li', { text: w })));
      if (d.tables && d.tables.length) {
        $('dataTables').replaceChildren(...d.tables.slice(0, 6).map((t) => el('div', { class: 'data' },
          el('h4', { text: t.title }),
          el('div', { class: 'table-wrap' }, el('table', null,
            el('thead', null, el('tr', null, t.columns.map((c) => el('th', { scope: 'col', text: c })))),
            el('tbody', null, t.rows.slice(0, 40).map((r) => el('tr', null, r.map((c) => el('td', { text: String(c) }))))))))));
        $('dataGlance').hidden = false;
      }
      $('chatSuggest').replaceChildren(...A.summary.suggestions(d).map((q) => el('button', { type: 'button', onclick: () => this.ask(q) }, q)));
      this.refreshAi();
    },
    aiOff() {
      const msg = A.env.mode === 'artifact'
        ? 'AI is not available in this view, so Alembic can show the file details but not summarize them. Open the artifact inside Claude.'
        : 'AI is off, so Alembic shows the file details but cannot summarize them. Add an API key to the server (README, step 3).';
      $('sumBody').replaceChildren(el('div', { class: 'notice' }, el('strong', { text: 'File read. Summaries need AI.' }), el('span', { text: msg })));
    },
    async run(fresh = false) {
      const d = this.digest;
      if (!d) return;
      if (!A.ai.caps().text) { this.aiOff(); return; }
      const key = this.key();
      if (!fresh && this.results.has(key)) {
        if (this.ctl) { this.ctl.abort(); this.ctl = null; }
        this.renderResult(this.results.get(key));
        return;
      }
      if (this.ctl) this.ctl.abort();
      const ctl = (this.ctl = new AbortController());
      const body = $('sumBody');
      body.replaceChildren(thinking('Reading the file…'));
      $('sumActions').innerHTML = '';
      let streamed = '';
      const paint = painter((t) => { if (this.ctl === ctl) paintMarkdown(body, t, true); });
      try {
        const out = await A.summary.summarize(d, { mode: this.mode, length: this.length, language: this.language }, {
          signal: ctl.signal,
          fresh,
          onStage: (s) => { if (this.ctl === ctl && !streamed) body.replaceChildren(thinking(s)); },
          onText: (t) => { streamed = t; paint(t); },
        });
        if (this.ctl !== ctl) return;
        const text = String(out || streamed).trim();
        if (!text) throw A.aiError('empty_completion');
        this.results.set(key, text);
        this.renderResult(text);
      } catch (e) {
        if (this.ctl !== ctl) return;
        if (e && e.code === 'access_code') handleAiError(e);
        const box = el('div', { class: 'err-box', role: 'alert' },
          el('span', { text: e && e.code === 'cancelled' ? 'Stopped.' : A.friendlyError(e) }),
          el('div', null, el('button', { class: 'ghost-btn', type: 'button', onclick: () => this.run(true) }, 'Try again')));
        if (streamed && e.code !== 'cancelled') body.append(box);
        else body.replaceChildren(box);
      } finally {
        if (this.ctl === ctl) this.ctl = null;
      }
    },
    renderResult(text) {
      paintMarkdown($('sumBody'), text, false);
      const d = this.digest;
      const mode = A.summary.MODES[this.mode].label;
      $('sumActions').replaceChildren(
        el('button', { class: 'save-btn', type: 'button', html: ICON.download + '<span>Markdown</span>', onclick: () => saveBlob(new Blob([text + '\n'], { type: 'text/markdown' }), U.baseName(d.name) + ' - ' + mode + '.md') }),
        el('button', { class: 'ghost-btn', type: 'button', onclick: () => copyText(A.markdown.toPlain(text)) }, 'Copy'),
        el('button', { class: 'ghost-btn', type: 'button', onclick: () => this.run(true) }, 'Regenerate')
      );
    },
    async ask(q) {
      q = String(q || '').trim();
      const d = this.digest;
      if (!q || !d) return;
      if (!A.ai.caps().text) { toast('Questions need AI, which is off here.', { bad: true }); return; }
      if (this.chatCtl) { toast('One question at a time. Wait for this answer to finish.'); return; }
      const log = $('chatLog');
      log.append(el('div', { class: 'msg user', text: q }));
      const msg = el('div', { class: 'msg ai' }, thinking('Thinking…'));
      log.append(msg);
      msg.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
      $('chatInput').value = '';
      const ctl = (this.chatCtl = new AbortController());
      this.refreshAi();
      let streamed = '';
      const paint = painter((t) => { if (this.chatCtl === ctl) paintMarkdown(msg, t, true); });
      try {
        const summary = this.results.get(this.key()) || this.results.values().next().value || '';
        const out = await A.summary.ask(d, summary, this.history, q, {
          language: this.language,
          signal: ctl.signal,
          onStage: (s) => { if (!streamed) msg.replaceChildren(thinking(s)); },
          onText: (t) => { streamed = t; paint(t); },
        });
        if (this.chatCtl !== ctl) return;
        const text = String(out || streamed).trim() || 'The AI returned no answer. Try asking another way.';
        paintMarkdown(msg, text, false);
        this.history.push({ role: 'user', content: q }, { role: 'assistant', content: text });
      } catch (e) {
        if (this.chatCtl !== ctl) return;
        if (e && e.code === 'access_code') handleAiError(e);
        msg.replaceChildren(el('div', { class: 'err-box' }, e && e.code === 'cancelled' ? 'Stopped.' : A.friendlyError(e)));
      } finally {
        if (this.chatCtl === ctl) this.chatCtl = null;
        this.refreshAi();
        if (!$('chatInput').disabled && document.activeElement === document.body) $('chatInput').focus();
      }
    },
  };

  /* ---------------------------------------------------------------- boot */
  Img.init();
  Video.init();
  Sum.init();
  Gallery.init();
  route();
  renderAiStatus();
  renderAccessPanel();
  A.env.onChange(() => {
    renderAiStatus();
    renderAccessPanel();
    Img.refresh();
    Video.refresh();
    Sum.refreshAi();
  });
  A.app = { Img, Video, Sum, Gallery, go };
})();
