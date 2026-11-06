/* Alembic · shader
 * Shader Painter / Shader Film: the text AI writes a Shadertoy-style GLSL
 * fragment shader, the browser's GPU renders it (WebGL 2). Compile errors are
 * sent back to the AI for a fix, up to two times.
 */
(function () {
  'use strict';
  const A = window.Alembic;
  const U = A.util;

  const VERT = '#version 300 es\nin vec2 p;\nvoid main() { gl_Position = vec4(p, 0.0, 1.0); }\n';
  const HEAD = [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'uniform vec3 iResolution;',
    'uniform float iTime;',
    'uniform float iTimeDelta;',
    'uniform int iFrame;',
    'uniform vec4 iMouse;',
    'uniform vec4 iDate;',
    'out vec4 alembicColor;',
    '',
  ].join('\n');
  const HEAD_LINES = HEAD.split('\n').length - 1;
  const FOOT = '\nvoid main() {\n  vec4 c = vec4(0.0, 0.0, 0.0, 1.0);\n  mainImage(c, gl_FragCoord.xy);\n  alembicColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);\n}\n';

  function shaderError(msg) {
    const e = new Error(msg);
    e.code = 'shader';
    return e;
  }

  function extractCode(text) {
    const m = /```(?:glsl|c|cpp|hlsl|shader)?[^\n]*\n([\s\S]*?)```/i.exec(String(text || ''));
    let code = m ? m[1] : String(text || '');
    code = code
      .replace(/^\s*#version.*$/gm, '')
      .replace(/^\s*precision\s+\w+\s+\w+\s*;\s*$/gm, '')
      .replace(/^\s*uniform\s+\w+\s+(iResolution|iTime|iTimeDelta|iFrame|iFrameRate|iMouse|iDate|iSampleRate|iChannelTime|iChannelResolution|iChannel\d)\b[^;]*;\s*$/gm, '');
    return code.trim();
  }

  function mapLog(log) {
    return String(log || '')
      .replace(/\u0000/g, '')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.replace(/(ERROR|WARNING): 0:(\d+):/, (_, kind, n) => kind + ': line ' + Math.max(1, +n - HEAD_LINES) + ':'))
      .slice(0, 12)
      .join('\n');
  }

  function context(canvas, preserve) {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: !!preserve, antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
    if (!gl) throw shaderError('This browser has no WebGL 2, which the shader engines need. Try Chrome, Edge, Firefox or Safari 15+.');
    return gl;
  }

  /** Compile and link. Returns {program, u} or {error}. */
  function build(gl, code) {
    const make = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const vs = make(gl.VERTEX_SHADER, VERT);
    const fs = make(gl.FRAGMENT_SHADER, HEAD + code + FOOT);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const error = mapLog(gl.getShaderInfoLog(fs)) || 'The shader did not compile.';
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return { error };
    }
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'p');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = mapLog(gl.getProgramInfoLog(program)) || 'The shader did not link.';
      gl.deleteProgram(program);
      return { error };
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const loc = (n) => gl.getUniformLocation(program, n);
    return { program, u: { res: loc('iResolution'), time: loc('iTime'), delta: loc('iTimeDelta'), frame: loc('iFrame'), mouse: loc('iMouse'), date: loc('iDate') } };
  }

  function setUniforms(gl, prog, w, h, t, frame) {
    gl.useProgram(prog.program);
    gl.uniform3f(prog.u.res, w, h, 1);
    gl.uniform1f(prog.u.time, t);
    gl.uniform1f(prog.u.delta, 1 / 30);
    gl.uniform1i(prog.u.frame, frame | 0);
    gl.uniform4f(prog.u.mouse, 0, 0, 0, 0);
    const d = new Date();
    gl.uniform4f(prog.u.date, d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds());
  }

  function release(gl) {
    try { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (_) { /* ignore */ }
  }

  /** Compile on a small canvas; also catch shaders that render a blank frame. */
  function check(code, time = 3) {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 54;
    const gl = context(c, true);
    try {
      const prog = build(gl, code);
      if (prog.error) return { error: prog.error };
      gl.viewport(0, 0, c.width, c.height);
      setUniforms(gl, prog, c.width, c.height, time, 90);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let min = 255, max = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = (px[i] * 3 + px[i + 1] * 6 + px[i + 2]) / 10;
        if (l < min) min = l;
        if (l > max) max = l;
      }
      if (gl.isContextLost()) return { error: 'The shader is too heavy: the graphics chip gave up while drawing it.' };
      if (max - min < 6) return { blank: true };
      return { ok: true };
    } finally {
      release(gl);
    }
  }

  function prompt(idea, { style, aspect, width, height, animated, duration }) {
    return [
      'You are a demoscene artist. Write a Shadertoy-style GLSL fragment shader that paints: "' + idea + '".',
      style && style !== 'None' ? 'Visual style: ' + style + '.' : '',
      animated
        ? 'It is rendered as a ' + duration + '-second video at 30 fps. Animate it smoothly and continuously with iTime: drifting camera, flowing water, moving clouds, twinkling lights, rising particles.'
        : 'It is rendered once as a still image at iTime = 3.0, so compose a strong, finished frame.',
      'Frame size: ' + width + ' x ' + height + ' pixels (' + aspect + ').',
      'Rules:',
      '- Write helper functions plus exactly one entry point: void mainImage(out vec4 fragColor, in vec2 fragCoord). Do not write main(), #version, precision lines or uniform declarations.',
      '- Only iResolution (vec3) and iTime (float) are available. No textures, iChannel inputs or iMouse.',
      '- GLSL ES 3.00: float literals need a decimal point (2.0), no recursion, loops with constant bounds. At most 90 raymarching steps and 6 noise octaves so it runs in real time.',
      '- Centred coordinates: vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;',
      '- Make it beautiful: a clear focal point, depth (foreground, middle ground, background), soft lighting and shadows, atmospheric haze, a rich harmonious palette, a gentle vignette, and gamma correction (pow(col, vec3(0.4545))).',
      'Reply with only the code in one ```glsl block.',
    ].filter(Boolean).join('\n');
  }

  function fixPrompt(code, problem) {
    return [
      'This Shadertoy-style GLSL fragment shader has a problem in WebGL 2 (GLSL ES 3.00).',
      'Problem: ' + problem,
      '```glsl\n' + code + '\n```',
      'Fix it and keep the same scene. Define void mainImage(out vec4 fragColor, in vec2 fragCoord); no main(), #version, precision or uniform declarations (iResolution and iTime already exist); float literals need a decimal point.',
      'Reply with only the corrected full code in one ```glsl block.',
    ].join('\n');
  }

  /** Ask the AI for a working shader, repairing it up to twice. */
  async function generate(idea, opts, { signal, onStage } = {}) {
    onStage && onStage('Writing the shader…');
    let code = extractCode(await A.ai.text(prompt(idea, opts), { signal, cache: false }));
    for (let attempt = 1; attempt <= 3; attempt++) {
      U.checkAbort(signal);
      onStage && onStage('Compiling on your GPU…');
      await U.nextFrame();
      const r = check(code, opts.animated ? 1.5 : 3);
      if (r.ok) return code;
      if (attempt === 3) throw shaderError('The AI could not write a working shader for this prompt. Try again, or describe a landscape, sky, space or abstract scene.');
      const problem = r.blank ? 'It compiles but renders an almost blank, single-colour image. Make the scene clearly visible.' : 'Compiler errors (line numbers match the code):\n' + r.error;
      onStage && onStage('Fixing the shader (try ' + attempt + ' of 2)…');
      code = extractCode(await A.ai.text(fixPrompt(code, problem), { signal, cache: false }));
    }
    return code;
  }

  /** Render one frame in strips (keeps slow GPUs responsive) and return a PNG. */
  async function renderStill(code, width, height, time = 3) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const gl = context(c, true);
    let lost = false;
    c.addEventListener('webglcontextlost', () => { lost = true; }, { once: true });
    try {
      const prog = build(gl, code);
      if (prog.error) throw shaderError('The shader stopped compiling: ' + prog.error);
      gl.viewport(0, 0, width, height);
      setUniforms(gl, prog, width, height, time, 90);
      gl.enable(gl.SCISSOR_TEST);
      const strip = 96;
      for (let y = 0; y < height; y += strip) {
        gl.scissor(0, y, width, Math.min(strip, height - y));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.flush();
        await U.nextFrame();
        if (lost || gl.isContextLost()) throw shaderError('This scene was too heavy for your graphics chip. Try again or simplify the prompt.');
      }
      gl.disable(gl.SCISSOR_TEST);
      return await U.canvasToBlob(c, 'image/png');
    } finally {
      release(gl);
    }
  }

  /** A player that draws frame t on a canvas, for recording. */
  function createPlayer(canvas, code) {
    const gl = context(canvas, false);
    const prog = build(gl, code);
    if (prog.error) { release(gl); throw shaderError('The shader stopped compiling: ' + prog.error); }
    let frame = 0;
    return {
      gl,
      draw(t) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        setUniforms(gl, prog, canvas.width, canvas.height, t, frame++);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      /** Average milliseconds per frame, measured over a few frames. */
      benchmark(n = 3) {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) this.draw(i * 0.1);
        gl.finish();
        return (performance.now() - t0) / n;
      },
      lost: () => gl.isContextLost(),
      dispose: () => release(gl),
    };
  }

  A.shader = { prompt, generate, check, renderStill, createPlayer, extractCode };
})();
