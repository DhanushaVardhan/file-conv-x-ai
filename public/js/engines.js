/* Alembic · engines
 * One list of image and video engines:
 *   built-in engines run in the browser and use the text AI (Claude in the
 *   preview, or your server's Gemini / Claude / OpenAI key);
 *   server engines call real image and video models through /api (needs keys).
 * Every engine's run() resolves to an "item": {kind, blob, mime, ext, extras}.
 */
(function () {
  'use strict';
  const A = window.Alembic;
  const U = A.util;

  const VIDEO_CANVAS = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1080, 1080] };
  const SHADER_VIDEO = { '16:9': [960, 540], '9:16': [540, 960], '1:1': [720, 720] };

  function styled(prompt, style) {
    return style && style !== 'None' ? prompt + '. Style: ' + style : prompt;
  }

  function soundtrackFor(choice, suggestion, duration, seedText) {
    if (choice === 'off') return null;
    const mood = choice && choice !== 'auto' ? choice : (suggestion && suggestion.mood) || 'calm';
    let seed = 0;
    for (const ch of String(seedText || '')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    return A.music.create({ mood, tempo: suggestion && choice === 'auto' ? suggestion.tempo : undefined, seed, duration });
  }

  const LOCAL = {
    image: [
      {
        id: 'local:vector',
        label: 'Vector Illustrator',
        bestFor: 'Illustrations, characters, icons, posters',
        badges: ['SVG + PNG'],
        aspects: ['1:1', '16:9', '9:16', '4:3'],
        async run({ prompt, style, aspect, signal, onStage }) {
          onStage('Sketching shapes…');
          const svg = A.vector.sanitizeSvg(await A.ai.text(A.vector.illustratorPrompt(prompt, style, aspect), { signal, cache: false }));
          onStage('Painting the PNG…');
          const blob = await A.vector.svgToPng(svg, 2048);
          return { kind: 'image', blob, mime: 'image/png', ext: 'png', extras: { svg } };
        },
      },
      {
        id: 'local:shader',
        label: 'Shader Painter',
        bestFor: 'Landscapes, skies, oceans, space, abstract art',
        badges: ['GPU-rendered', 'Can animate'],
        aspects: ['1:1', '16:9', '9:16', '4:3'],
        async run({ prompt, style, aspect, signal, onStage }) {
          const [width, height] = A.vector.SIZES[aspect] || A.vector.SIZES['1:1'];
          const code = await A.shader.generate(prompt, { style, aspect, width, height, animated: false }, { signal, onStage });
          onStage('Rendering ' + width + ' × ' + height + '…');
          const blob = await A.shader.renderStill(code, width, height, 3);
          return { kind: 'image', blob, mime: 'image/png', ext: 'png', extras: { shader: code } };
        },
      },
      {
        id: 'local:pixel',
        label: 'Pixel Artist',
        bestFor: 'Retro game art, sprites, cute icons',
        badges: ['Crisp pixels'],
        aspects: ['1:1', '16:9', '9:16', '4:3'],
        async run({ prompt, style, aspect, signal, onStage }) {
          onStage('Placing pixels…');
          const svg = A.vector.sanitizeSvg(await A.ai.text(A.vector.pixelPrompt(prompt, style, aspect), { signal, cache: false }));
          onStage('Snapping to the grid…');
          const r = await A.vector.pixelate(svg, aspect);
          return { kind: 'image', blob: r.blob, mime: 'image/png', ext: 'png', extras: { svg, note: r.grid + ' pixels · ' + r.colors + ' colours' } };
        },
      },
    ],
    video: [
      {
        id: 'local:motion',
        label: 'Motion Graphics',
        bestFor: 'Animated scenes, loops, title cards',
        badges: ['Soundtrack'],
        aspects: ['16:9', '9:16', '1:1'],
        durations: [4, 6, 8, 10],
        soundtrack: true,
        async run({ prompt, style, aspect, duration, music, signal, onStage, onCanvas, onProgress }) {
          onStage('Writing the scene…');
          const raw = await A.ai.json(A.motion.scenePrompt(prompt, { duration, aspect, style }), { signal, cache: false });
          const scene = A.motion.normalize(raw, { duration, title: prompt });
          const [w, h] = VIDEO_CANVAS[aspect] || VIDEO_CANVAS['16:9'];
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          onCanvas(canvas);
          const player = A.motion.createPlayer(canvas, scene);
          const audio = soundtrackFor(music, scene.music, duration, prompt);
          onStage('Recording…');
          const rec = await A.motion.recordCanvas(canvas, player.draw, duration, { audio, signal, onProgress });
          return { kind: 'video', blob: rec.blob, mime: rec.blob.type, ext: rec.ext, extras: { title: scene.title, audio: rec.audio, mood: audio && audio.mood } };
        },
      },
      {
        id: 'local:shader-film',
        label: 'Shader Film',
        bestFor: 'Flowing nature, space, dreamy abstract visuals',
        badges: ['GPU-rendered', 'Soundtrack'],
        aspects: ['16:9', '9:16', '1:1'],
        durations: [4, 6, 8, 10],
        soundtrack: true,
        async run({ prompt, style, aspect, duration, music, signal, onStage, onCanvas, onProgress, shaderCode }) {
          const [w, h] = SHADER_VIDEO[aspect] || SHADER_VIDEO['16:9'];
          const code = shaderCode || (await A.shader.generate(prompt, { style, aspect, width: w, height: h, animated: true, duration }, { signal, onStage }));
          const make = (cw, ch) => {
            const c = document.createElement('canvas');
            c.width = cw;
            c.height = ch;
            return c;
          };
          let canvas = make(w, h);
          let player = A.shader.createPlayer(canvas, code);
          // Slow GPU? Render smaller so the clip stays smooth.
          const ms = player.benchmark(3);
          if (ms > 34) {
            const k = Math.max(0.5, Math.sqrt(30 / ms));
            player.dispose();
            canvas = make(Math.round((w * k) / 2) * 2, Math.round((h * k) / 2) * 2);
            player = A.shader.createPlayer(canvas, code);
          }
          onCanvas(canvas);
          const audio = soundtrackFor(music, null, duration, prompt);
          onStage('Recording…');
          try {
            const rec = await A.motion.recordCanvas(canvas, player.draw, duration, { audio, signal, onProgress });
            if (player.lost()) throw new Error('The scene was too heavy for your graphics chip. Try again or simplify the prompt.');
            return { kind: 'video', blob: rec.blob, mime: rec.blob.type, ext: rec.ext, extras: { shader: code, audio: rec.audio, mood: audio && audio.mood } };
          } finally {
            player.dispose();
          }
        },
      },
      {
        id: 'local:story',
        label: 'Story Reel',
        bestFor: 'Three-scene stories with captions',
        badges: ['Captions', 'Soundtrack'],
        aspects: ['16:9', '9:16', '1:1'],
        durations: [9, 12, 15],
        soundtrack: true,
        async run({ prompt, style, aspect, duration, music, signal, onStage, onCanvas, onProgress }) {
          onStage('Writing the story…');
          const raw = await A.ai.json(A.motion.storyPrompt(prompt, { duration, aspect, style }), { signal, cache: false });
          const story = A.motion.normalizeStory(raw, { duration, title: '' });
          const [w, h] = VIDEO_CANVAS[aspect] || VIDEO_CANVAS['16:9'];
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          onCanvas(canvas);
          const player = A.motion.createStoryPlayer(canvas, story);
          const audio = soundtrackFor(music, story.music, duration, prompt);
          onStage('Recording…');
          const rec = await A.motion.recordCanvas(canvas, player.draw, duration, { audio, signal, onProgress });
          return { kind: 'video', blob: rec.blob, mime: rec.blob.type, ext: rec.ext, extras: { title: story.title, captions: story.scenes.map((s) => s.caption), audio: rec.audio, mood: audio && audio.mood } };
        },
      },
    ],
  };

  /* -------------------------------------------------------- server engines */
  async function runServerImage(engine, { prompt, style, aspect, signal, onStage }) {
    onStage('Generating with ' + engine.label + '…');
    const [im] = await A.ai.image({ prompt: styled(prompt, style), aspect, engine: engine.id, signal });
    if (!im) throw new Error('The engine returned no image. Try again.');
    const ext = (im.mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return { kind: 'image', blob: im.blob, mime: im.mime, ext, extras: {} };
  }

  async function runServerVideo(engine, { prompt, style, aspect, duration, image, signal, onStage, onStep }) {
    onStage(image ? 'Sending your picture and prompt…' : 'Sending your prompt…');
    onStep(0);
    // Make it move: a JPEG up to 1280 px keeps the request small (fal takes it as a data URI).
    let picture;
    if (image && engine.fromImage) {
      const small = await U.downscaleImage(image, 1280, 'image/jpeg', 0.88);
      picture = { mime: 'image/jpeg', data: await U.blobToBase64(small) };
      U.checkAbort(signal);
    }
    // Not aborted mid-request: once the server has the job, Stop has to cancel it there.
    const job = await A.ai.videoStart({ prompt: styled(prompt, style), aspect, duration, engine: engine.id, image: picture });
    /** Stop pressed: ask the server to cancel the job at the provider, then report what happened. */
    const stop = async () => {
      const err = U.cancelled();
      err.provider = engine.providerLabel || engine.label;
      err.providerCanceled = false;
      onStage('Stopping…');
      try {
        const r = await A.ai.videoCancel(job.id);
        err.providerCanceled = !!(r && r.providerCanceled);
      } catch (_) { /* the server could not be reached; nothing more to do */ }
      return err;
    };
    if (signal && signal.aborted) throw await stop();
    let st = job;
    onStage('Generating. Real AI video takes 30 seconds to a few minutes.');
    while (!['succeeded', 'failed', 'canceled'].includes(st.status)) {
      await U.sleep(4000, signal);
      if (signal && signal.aborted) throw await stop();
      try {
        st = await A.ai.videoStatus(job.id, signal);
      } catch (e) {
        if (e && e.code === 'cancelled') throw await stop();
        throw e;
      }
      onStep(st.status === 'queued' ? 0 : 1);
    }
    if (st.status === 'canceled') throw U.cancelled();
    if (st.status !== 'succeeded') throw new Error(st.error || 'The video could not be generated. Try a different prompt.');
    onStep(2);
    onStage('Downloading your clip…');
    const blob = await A.ai.download(st.url, signal);
    const ext = (blob.type.split('/')[1] || 'mp4').replace('quicktime', 'mov');
    return { kind: 'video', blob, mime: blob.type, ext, extras: { audio: !!engine.audio, fromImage: !!picture } };
  }

  /* --------------------------------------------------------------- listing */
  /** Every engine of a kind, with `available` and, if locked, what it needs. */
  function list(kind) {
    const caps = A.ai.caps();
    const mode = A.env.mode;
    const by = caps.provider || 'your text AI';
    const local = LOCAL[kind].map((e) => Object.assign({}, e, {
      kind,
      local: true,
      providerLabel: 'Built in · uses ' + by,
      available: caps.text,
      needs: caps.text ? [] : [mode === 'artifact' ? 'Claude' : 'GEMINI_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY'],
    }));
    const catalog = (caps.engines && caps.engines[kind]) || (window.ALEMBIC_CATALOG && window.ALEMBIC_CATALOG[kind]) || [];
    const server = catalog.map((e) => Object.assign({}, e, {
      kind,
      local: false,
      available: mode === 'server' && !!e.available,
      needs: mode === 'server' ? e.needs || [] : ['your own server'].concat(e.needs || []),
    }));
    const real = server.filter((e) => e.available);
    const locked = server.filter((e) => !e.available);
    // Real models first when they are switched on; built-in engines otherwise.
    return real.length ? real.concat(local, locked) : local.concat(locked);
  }

  function find(kind, id) {
    return list(kind).find((e) => e.id === id) || null;
  }

  /** Run an engine. ctx: {prompt, style, aspect, duration, music, image, signal, onStage, onCanvas, onProgress, onStep, shaderCode} */
  async function run(engine, ctx) {
    const noop = () => {};
    const c = Object.assign({ onStage: noop, onCanvas: noop, onProgress: noop, onStep: noop }, ctx);
    if (engine.local) {
      const impl = LOCAL[engine.kind].find((e) => e.id === engine.id);
      return impl.run(c);
    }
    return engine.kind === 'image' ? runServerImage(engine, c) : runServerVideo(engine, c);
  }

  A.engines = { list, find, run, LOCAL };
})();
