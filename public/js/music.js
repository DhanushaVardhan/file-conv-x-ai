/* Alembic · music
 * A tiny procedural soundtrack for the built-in video engines. It is generated
 * with Web Audio (no samples, no network) and recorded into the clip silently.
 */
(function () {
  'use strict';
  const A = window.Alembic;

  const MOODS = {
    calm: { scale: 'major', prog: [0, 5, 3, 4], tempo: 72, pad: 1, arp: 'bell', drums: 0 },
    upbeat: { scale: 'major', prog: [0, 4, 5, 3], tempo: 118, pad: 0.7, arp: 'pluck', drums: 2 },
    epic: { scale: 'minor', prog: [0, 5, 2, 6], tempo: 92, pad: 1.1, arp: 'none', drums: 1 },
    mystery: { scale: 'minor', prog: [0, 3, 5, 4], tempo: 66, pad: 0.8, arp: 'bell', drums: 0 },
  };
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const ROOTS = [48, 50, 52, 53, 55, 57]; // C3 D3 E3 F3 G3 A3

  const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function rng(seed) {
    let s = seed >>> 0 || 7;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  function impulse(ctx, seconds = 2.4, decay = 3) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function normalizeMood(m) {
    return MOODS[m] ? m : 'calm';
  }

  /**
   * Build a soundtrack. Returns { track, start(), stop() } where `track` is a
   * MediaStreamTrack to add to the recording. Returns null if Web Audio is missing.
   */
  function create({ mood = 'calm', tempo, seed = 1, duration = 8 } = {}) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !Ctx.prototype.createMediaStreamDestination) return null;
    const cfg = MOODS[normalizeMood(mood)];
    let ctx;
    try { ctx = new Ctx(); } catch (_) { return null; }
    const dest = ctx.createMediaStreamDestination();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(dest);
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    verb.connect(wet).connect(master);
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(master);
    bus.connect(verb);

    const r = rng(seed);
    const root = ROOTS[Math.floor(r() * ROOTS.length)];
    const scale = SCALES[cfg.scale];
    const bpm = Math.max(56, Math.min(140, tempo || cfg.tempo));
    const beat = 60 / bpm;
    const bar = beat * 4;
    const deg = (d, oct = 0) => root + 12 * oct + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    const chordTones = (d) => [deg(d), deg(d + 2), deg(d + 4)];

    function tone(t, midi, len, { type = 'sine', gain = 0.1, attack = 0.01, release = 0.3, cutoff, detune = 0, to = bus } = {}) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = midiHz(midi);
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + attack);
      g.gain.setValueAtTime(gain, t + Math.max(attack, len - release));
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + release);
      let node = o;
      if (cutoff) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = cutoff;
        f.Q.value = 0.7;
        node.connect(f);
        node = f;
      }
      node.connect(g).connect(to);
      o.start(t);
      o.stop(t + len + release + 0.05);
    }
    let noiseBuf = null;
    function noise(t, len, gain, hp) {
      if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = hp;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      s.connect(f).connect(g).connect(bus);
      s.start(t);
      s.stop(t + len + 0.02);
    }
    function kick(t, gain = 0.5) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.4);
    }

    function schedule(t0) {
      const end = t0 + duration;
      for (let b = 0, t = t0; t < end; b++, t += bar) {
        const d = cfg.prog[b % cfg.prog.length];
        const notes = chordTones(d);
        const len = Math.min(bar, end - t);
        // Pad: two detuned saws per chord tone through a soft filter.
        for (const n of notes) {
          for (const det of [-7, 7]) tone(t, n, len, { type: 'sawtooth', gain: 0.018 * cfg.pad, attack: 0.5, release: 0.9, cutoff: cfg.scale === 'minor' ? 900 : 1400, detune: det });
        }
        // Bass
        const bassStep = cfg.drums === 2 ? beat / 2 : cfg.drums === 1 ? beat * 2 : bar;
        for (let s = 0; s < len - 0.01; s += bassStep) tone(t + s, notes[0] - 12, Math.min(bassStep, len - s) * 0.9, { type: 'triangle', gain: 0.09, attack: 0.02, release: 0.15 });
        // Arpeggio
        if (cfg.arp !== 'none') {
          const step = cfg.arp === 'pluck' ? beat / 2 : beat;
          const pattern = [0, 1, 2, 1, 2, 0, 1, 2];
          let k = 0;
          for (let s = 0; s < len - 0.01; s += step, k++) {
            const n = notes[pattern[k % pattern.length]] + 12 + (cfg.arp === 'bell' && k % 4 === 3 ? 12 : 0);
            if (cfg.arp === 'bell') tone(t + s, n, 0.08, { type: 'sine', gain: 0.05, attack: 0.005, release: 0.9 });
            else tone(t + s, n, step * 0.5, { type: 'square', gain: 0.022, attack: 0.005, release: 0.12, cutoff: 2600 });
          }
        }
        // Drums
        if (cfg.drums === 2) {
          for (let s = 0; s < len - 0.01; s += beat) {
            kick(t + s, 0.45);
            noise(t + s + beat / 2, 0.05, 0.06, 7000);
          }
        } else if (cfg.drums === 1) {
          kick(t, 0.6);
          if (len > beat * 2.5) kick(t + beat * 2.5, 0.35);
          noise(t + beat * 2, 0.4, 0.05, 900);
        }
      }
      // Fade in and out.
      master.gain.setValueAtTime(0.0001, t0);
      master.gain.exponentialRampToValueAtTime(0.8, t0 + 0.6);
      master.gain.setValueAtTime(0.8, Math.max(t0 + 0.7, end - 1.2));
      master.gain.exponentialRampToValueAtTime(0.0001, end);
    }

    return {
      track: dest.stream.getAudioTracks()[0],
      mood: normalizeMood(mood),
      async start() {
        try { await ctx.resume(); } catch (_) { /* stays silent */ }
        schedule(ctx.currentTime + 0.05);
      },
      stop() {
        try { dest.stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* ignore */ }
        setTimeout(() => ctx.close().catch(() => {}), 200);
      },
    };
  }

  A.music = { create, MOODS: Object.keys(MOODS), normalizeMood };
})();
