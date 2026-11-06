/* Alembic · vector
 * Two built-in image engines that ask the text AI to draw with SVG:
 *   Vector Illustrator: a layered SVG illustration, exported as SVG or PNG.
 *   Pixel Artist: a tiny flat-colour SVG, snapped to a pixel grid and palette.
 */
(function () {
  'use strict';
  const A = window.Alembic;
  const U = A.util;

  const SIZES = { '1:1': [1024, 1024], '16:9': [1280, 720], '9:16': [720, 1280], '4:3': [1024, 768] };
  const GRIDS = { '1:1': [64, 64], '16:9': [96, 54], '9:16': [54, 96], '4:3': [80, 60] };

  function illustratorPrompt(prompt, style, ratio) {
    const [w, h] = SIZES[ratio] || SIZES['1:1'];
    return [
      'Create an original illustration as one SVG.',
      'Subject: ' + prompt,
      'Style: ' + (style || 'polished modern illustration') + '.',
      'Start with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '">.',
      'Composition: a clear focal subject, a background, middle and foreground layers, and a consistent light direction. Use linear and radial gradients, soft shadows (shapes with low opacity), highlights and a cohesive palette of 4 to 7 colours. Aim for 80 to 250 elements with confident, smooth shapes; feGaussianBlur is allowed for glows.',
      'Use <text> only if the subject asks for words. Do not use <image>, <script>, <foreignObject>, external links, web fonts or CSS imports.',
      'Reply with only the SVG markup.',
    ].join('\n');
  }

  function pixelPrompt(prompt, style, ratio) {
    const [w, h] = GRIDS[ratio] || GRIDS['1:1'];
    return [
      'Create pixel art as one SVG on a ' + w + ' by ' + h + ' pixel grid.',
      'Subject: ' + prompt,
      style ? 'Style hint: ' + style + ' (keep it pixel art).' : '',
      'Start with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" shape-rendering="crispEdges">.',
      'Rules: whole-number coordinates only, so every shape lines up with pixels; mostly <rect> elements (width and height of 1 or more), plus <polygon> for diagonals; flat fills only (no gradients, filters, strokes or text); a palette of 8 to 16 colours with 2 or 3 shades per material for shading and highlights; a 1-pixel dark outline around the main subject; fill the whole background first.',
      'Make the subject large, centred and instantly readable at this size, like a classic 16-bit game sprite or scene.',
      'Reply with only the SVG markup.',
    ].filter(Boolean).join('\n');
  }

  function sanitizeSvg(text) {
    const m = /<svg[\s\S]*<\/svg>/i.exec(String(text || ''));
    if (!m) throw new Error('The AI did not return a drawing. Try again, or simplify the prompt.');
    const doc = new DOMParser().parseFromString(m[0], 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('The drawing came back incomplete. Try again.');
    const svg = doc.documentElement;
    svg.querySelectorAll('script, foreignObject, image, iframe, audio, video, a, use[href^="http"]').forEach((n) => {
      if (n.localName === 'a') n.replaceWith(...n.childNodes);
      else n.remove();
    });
    for (const node of [svg, ...svg.querySelectorAll('*')]) {
      for (const at of Array.from(node.attributes)) {
        const n = at.name.toLowerCase();
        const v = at.value.trim().toLowerCase();
        if (n.startsWith('on') || v.includes('javascript:')) node.removeAttribute(at.name);
        else if ((n === 'href' || n === 'xlink:href') && !v.startsWith('#')) node.removeAttribute(at.name);
        else if (/url\(\s*['"]?(?!#)/.test(v)) node.removeAttribute(at.name);
      }
    }
    svg.querySelectorAll('style').forEach((st) => { st.textContent = st.textContent.replace(/@import[^;]*;?/gi, '').replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none'); });
    const vb = (svg.getAttribute('viewBox') || '0 0 1024 1024').split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite)) { svg.setAttribute('width', vb[2]); svg.setAttribute('height', vb[3]); }
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(svg);
  }

  async function svgImage(svgText) {
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
    try { await img.decode(); }
    catch (_) { throw new Error('The drawing could not be displayed. Try again.'); }
    finally { setTimeout(() => URL.revokeObjectURL(img.src), 2000); }
    return img;
  }

  async function svgToPng(svgText, maxSide = 2048) {
    const img = await svgImage(svgText);
    const w0 = img.naturalWidth || 1024, h0 = img.naturalHeight || 1024;
    const k = maxSide / Math.max(w0, h0);
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * k);
    c.height = Math.round(h0 * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await U.canvasToBlob(c, 'image/png');
    c.width = c.height = 0;
    return blob;
  }

  function parseColor(s) {
    s = String(s || '').trim().toLowerCase();
    let m;
    if ((m = /^#([0-9a-f]{3})$/.exec(s))) return m[1].split('').map((h) => parseInt(h + h, 16));
    if ((m = /^#([0-9a-f]{6})/.exec(s))) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s))) return [+m[1], +m[2], +m[3]];
    return null;
  }

  /** Snap the SVG to its pixel grid and palette, then scale up with hard edges. */
  async function pixelate(svgText, ratio) {
    const [gw, gh] = GRIDS[ratio] || GRIDS['1:1'];
    const img = await svgImage(svgText);
    const small = document.createElement('canvas');
    small.width = gw;
    small.height = gh;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(img, 0, 0, gw, gh);
    const data = sctx.getImageData(0, 0, gw, gh);
    const px = data.data;
    // Palette: colours named in the SVG, else the most common pixel colours.
    let palette = [];
    const seen = new Set();
    for (const m of svgText.matchAll(/(?:fill|stop-color|color)\s*[:=]\s*["']?(#[0-9a-fA-F]{3,6}|rgba?\([^)]*\))/g)) {
      const c = parseColor(m[1]);
      if (c && !seen.has(c.join())) { seen.add(c.join()); palette.push(c); }
    }
    if (palette.length < 2 || palette.length > 48) {
      const freq = new Map();
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 128) continue;
        const k = (px[i] >> 3) + ',' + (px[i + 1] >> 3) + ',' + (px[i + 2] >> 3);
        freq.set(k, (freq.get(k) || 0) + 1);
      }
      palette = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k]) => k.split(',').map((v) => (+v << 3) + 4));
    }
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 110) { px[i + 3] = 0; continue; }
      let best = 0, bd = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const c = palette[p];
        const dr = px[i] - c[0], dg = px[i + 1] - c[1], db = px[i + 2] - c[2];
        const dist = 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
        if (dist < bd) { bd = dist; best = p; }
      }
      const c = palette[best];
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
    sctx.putImageData(data, 0, 0);
    const scale = Math.max(1, Math.floor(1280 / Math.max(gw, gh)));
    const big = document.createElement('canvas');
    big.width = gw * scale;
    big.height = gh * scale;
    const bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(small, 0, 0, big.width, big.height);
    const blob = await U.canvasToBlob(big, 'image/png');
    big.width = big.height = small.width = small.height = 0;
    return { blob, grid: gw + ' × ' + gh, colors: palette.length };
  }

  A.vector = { SIZES, GRIDS, illustratorPrompt, pixelPrompt, sanitizeSvg, svgToPng, pixelate };
})();
