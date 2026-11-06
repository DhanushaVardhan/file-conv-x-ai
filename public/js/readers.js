/* Alembic · readers
 * Turns a file into a "digest" the AI can summarize:
 *   documents  -> text (PDF, Word, PowerPoint, plain text, code, HTML)
 *   spreadsheets -> sample rows + statistics computed here, so numbers are exact
 *   images, scanned PDFs, videos -> pictures the AI can look at
 *   video/audio on a Gemini server -> the whole file, so the AI also hears it
 */
(function () {
  'use strict';
  const A = window.Alembic;
  const U = A.util;

  const MAX_TEXT = 150000; // characters of text sent to the AI

  const KIND_BY_EXT = {
    pdf: 'pdf',
    docx: 'docx', docm: 'docx',
    xlsx: 'sheet', xlsm: 'sheet', csv: 'sheet', tsv: 'sheet',
    pptx: 'slides', pptm: 'slides',
    jpg: 'image', jpeg: 'image', jfif: 'image', png: 'image', webp: 'image', gif: 'image', bmp: 'image', avif: 'image', heic: 'image', heif: 'image',
    mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video', '3gp': 'video', avi: 'video', ogv: 'video',
    mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio', flac: 'audio', weba: 'audio',
  };
  const TEXT_EXTS = new Set(('txt md markdown log json xml html htm csv rtf srt vtt yaml yml ini toml tex bib ' +
    'js mjs cjs ts tsx jsx py java c h cpp hpp cc cs go rs rb php swift kt kts scala sql sh bash zsh ps1 r m css scss ipynb').split(' '));
  const OLD_FORMATS = {
    doc: 'This is an old Word .doc file. Open it in Word or Google Docs and save it as .docx, then try again.',
    xls: 'This is an old Excel .xls file. Save it as .xlsx or CSV, then try again.',
    ppt: 'This is an old PowerPoint .ppt file. Save it as .pptx, then try again.',
    odt: 'OpenDocument text (.odt) is not supported yet. Save it as .docx or PDF.',
    ods: 'OpenDocument spreadsheets (.ods) are not supported yet. Save it as .xlsx or CSV.',
    odp: 'OpenDocument slides (.odp) are not supported yet. Save it as .pptx or PDF.',
    pages: 'Apple Pages files are not supported. Export to PDF or Word first.',
    numbers: 'Apple Numbers files are not supported. Export to Excel or CSV first.',
    key: 'Apple Keynote files are not supported. Export to PowerPoint or PDF first.',
    zip: 'ZIP archives are not supported. Unzip it and drop one file.',
  };
  const KIND_LABEL = {
    pdf: 'PDF document', docx: 'Word document', sheet: 'Spreadsheet', slides: 'PowerPoint deck',
    text: 'Text file', image: 'Image', video: 'Video', audio: 'Audio',
  };

  function kindOf(file) {
    const e = U.ext(file.name);
    if (KIND_BY_EXT[e]) return KIND_BY_EXT[e];
    if (TEXT_EXTS.has(e)) return 'text';
    const t = file.type || '';
    if (t === 'application/pdf') return 'pdf';
    if (t.includes('wordprocessingml')) return 'docx';
    if (t.includes('spreadsheetml') || t === 'text/csv') return 'sheet';
    if (t.includes('presentationml')) return 'slides';
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    if (t.startsWith('text/') || t === 'application/json') return 'text';
    return 'unknown';
  }
  function unsupportedReason(file) {
    return OLD_FORMATS[U.ext(file.name)] || 'Alembic cannot read "' + (U.ext(file.name) || 'this') + '" files yet. Try PDF, Word, Excel, CSV, PowerPoint, an image, a video or a text file.';
  }

  const words = (s) => (String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const fmtNum = (n, d = 2) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : String(n));
  function clip(text) {
    if (text.length <= MAX_TEXT) return { text, truncated: false };
    return { text: text.slice(0, MAX_TEXT) + '\n\n[... the rest of the file was cut to fit ...]', truncated: true };
  }
  function readingTime(w) {
    const m = Math.max(1, Math.round(w / 230));
    return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min';
  }

  async function readTextFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let enc = 'utf-8';
    if (buf[0] === 0xff && buf[1] === 0xfe) enc = 'utf-16le';
    else if (buf[0] === 0xfe && buf[1] === 0xff) enc = 'utf-16be';
    try {
      return new TextDecoder(enc, { fatal: true }).decode(buf);
    } catch (_) {
      return new TextDecoder('windows-1252').decode(buf);
    }
  }

  /* ------------------------------------------------------------------ PDF */
  const TASKS = new WeakMap();
  async function openPdf(file) {
    const pdfjs = await A.libs.pdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    const params = { data, isEvalSupported: false, useSystemFonts: true };
    const m = /^(https:\/\/.+\/pdfjs-dist@[^/]+\/)build\/pdf\.min\.mjs$/.exec(A.libs.urls.pdfjs);
    if (m && A.env.mode !== 'artifact') {
      // Extra font data helps unusual PDFs; artifacts cannot fetch it, so it is skipped there.
      params.cMapUrl = m[1] + 'cmaps/';
      params.cMapPacked = true;
      params.standardFontDataUrl = m[1] + 'standard_fonts/';
    }
    const task = pdfjs.getDocument(params);
    try {
      const pdf = await task.promise;
      TASKS.set(pdf, task);
      return pdf;
    } catch (e) {
      try { task.destroy(); } catch (_) { /* already gone */ }
      if (e && e.name === 'PasswordException') throw new Error('This PDF is password-protected. Remove the password, then try again.');
      throw new Error('This PDF could not be opened. It may be damaged or not really a PDF.');
    }
  }
  function closePdf(pdf) {
    try {
      const task = TASKS.get(pdf);
      if (task) task.destroy();
      else if (pdf && typeof pdf.destroy === 'function') pdf.destroy();
    } catch (_) { /* nothing to free */ }
  }

  // Symbol-font bullets come through as private-use characters.
  const BULLET_GLYPHS = /[\uF0B7\uF0A7\uF0D8\uF076\uF0FC\uF06E\uF0A8\uF0D7\u25CF\u25AA\u25E6\u2023\u2043]/g;

  /** Group pdf.js text items into lines, then lines into paragraphs. */
  function pageParagraphs(items) {
    const lines = [];
    let cur = null;
    for (const it of items) {
      if (typeof it.str !== 'string') continue;
      const tr = it.transform;
      const size = Math.hypot(tr[2], tr[3]) || Math.abs(it.height) || 10;
      const x = tr[4], y = tr[5], w = it.width || 0;
      if (!it.str) {
        if (it.hasEOL && cur) { lines.push(cur); cur = null; }
        continue;
      }
      const sameLine = cur && Math.abs(y - cur.y) <= Math.max(size, cur.size) * 0.55 && x >= cur.xEnd - Math.max(size, cur.size) * 0.6;
      if (sameLine) {
        const colGap = Math.max(size, cur.size) * 1.6;
        if (!it.str.trim()) {
          if (w > colGap && cur.text.trim()) { if (!cur.text.endsWith('\t')) cur.text += '\t'; }
          else if (!/\s$/.test(cur.text)) cur.text += ' ';
        } else {
          const gap = x - cur.xEnd;
          if (gap > colGap && cur.text.trim() && !cur.text.endsWith('\t')) cur.text += '\t';
          else if (gap > cur.size * 0.18 && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
          cur.text += it.str;
          cur.size = Math.max(cur.size, size);
        }
        cur.xEnd = Math.max(cur.xEnd, x + w);
      } else {
        if (cur) lines.push(cur);
        cur = { text: it.str, x, y, xEnd: x + w, size };
      }
      if (it.hasEOL) { lines.push(cur); cur = null; }
    }
    if (cur) lines.push(cur);
    const clean = lines
      .map((l) => Object.assign(l, { text: l.text.replace(BULLET_GLYPHS, '\u2022').replace(/[^\S\t]+/g, ' ').replace(/ *\t[\t ]*/g, '\t').trim() }))
      .filter((l) => l.text);
    if (!clean.length) return [];
    const right = Math.max(...clean.map((l) => l.xEnd));
    const left = Math.min(...clean.map((l) => l.x));
    const width = Math.max(1, right - left);
    const paras = [];
    let para = null;
    for (const line of clean) {
      const prev = para && para.lines[para.lines.length - 1];
      let fresh = !para;
      if (!fresh) {
        const gap = prev.y - line.y;
        const big = Math.max(prev.size, line.size);
        if (line.text.includes('\t') || prev.text.includes('\t')) fresh = true;
        else if (Math.abs(line.size - para.size) > para.size * 0.15) fresh = true;
        else if (gap > big * 1.85 || gap < -big) fresh = true;
        else if (/^([\u2022\u25cf\u25aa\u25e6\u00b7*\u2013-]|\d{1,2}[.)]|[a-z][.)])\s/.test(line.text)) fresh = true;
        else if (prev.xEnd < left + width * 0.72 && /[.!?:"\u201d)]$/.test(prev.text)) fresh = true;
      }
      if (fresh) { para = { lines: [line], size: line.size }; paras.push(para); }
      else para.lines.push(line);
    }
    return paras.map((p) => {
      let text = '';
      for (const l of p.lines) {
        if (!text) text = l.text;
        else if (/[A-Za-z\u00C0-\u024F]-$/.test(text) && /^[a-z\u00DF-\u024F]/.test(l.text)) text = text.slice(0, -1) + l.text;
        else text += ' ' + l.text;
      }
      return { text, size: p.size, row: text.includes('\t') };
    });
  }

  async function renderPage(page, scale, type = 'image/jpeg', quality = 0.85) {
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(vp.width));
    c.height = Math.max(1, Math.ceil(vp.height));
    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await U.canvasToBlob(c, type, quality);
    c.width = c.height = 0;
    return blob;
  }

  async function readPdf(file, ctx) {
    const pdf = await openPdf(file);
    try {
      const n = pdf.numPages;
      const pages = [];
      let chars = 0;
      for (let i = 1; i <= n; i++) {
        U.checkAbort(ctx.signal);
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const paras = pageParagraphs(tc.items);
        chars += paras.reduce((s, p) => s + p.text.length, 0);
        pages.push(paras);
        if (i === 1) {
          try {
            const vp = page.getViewport({ scale: 1 });
            ctx.digest.thumb = await renderPage(page, 260 / vp.width, 'image/jpeg', 0.8);
          } catch (_) { /* thumbnail is optional */ }
        }
        page.cleanup();
        ctx.progress(0.05 + 0.6 * (i / n), 'Reading page ' + i + ' of ' + n);
      }
      let title = '';
      try { title = ((await pdf.getMetadata()).info || {}).Title || ''; } catch (_) { /* no metadata */ }
      const d = ctx.digest;
      d.facts.push(['Pages', fmtNum(n)]);
      if (title && title.length < 120) d.facts.unshift(['Title', title]);
      const scanned = chars < 25 * n;
      if (!scanned) {
        const text = pages
          .map((paras, i) => '[Page ' + (i + 1) + ']\n' + paras.map((q, k) => (k && q.row && paras[k - 1].row ? '\n' : k ? '\n\n' : '') + q.text).join(''))
          .join('\n\n');
        const w = words(text);
        d.facts.push(['Words', fmtNum(w)], ['Reading time', readingTime(w)]);
        Object.assign(d, clip(text));
        return d;
      }
      // A scan: the AI reads page images instead.
      const max = Math.min(n, ctx.maxImages, 8);
      if (!max) throw new Error('This PDF is a scan with no text layer. Reading scans needs an AI that can see images.');
      for (let i = 1; i <= max; i++) {
        U.checkAbort(ctx.signal);
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        d.images.push(await renderPage(page, Math.min(2.2, 1600 / Math.max(vp.width, vp.height))));
        page.cleanup();
        ctx.progress(0.65 + 0.3 * (i / max), 'Preparing scanned page ' + i + ' of ' + max);
      }
      d.scanned = true;
      d.imageNote = 'The images are scanned pages 1 to ' + max + ' of ' + n + ', in order.';
      d.text = '(This PDF has no text layer. Read the text from the attached page images.)';
      d.facts.push(['Text layer', 'none (scanned)']);
      if (n > max) d.warnings.push('This is a scanned PDF, so the AI reads page images: the first ' + max + ' of ' + n + ' pages.');
      return d;
    } finally {
      closePdf(pdf);
    }
  }

  /* ----------------------------------------------------------------- Word */
  async function readDocx(file, ctx) {
    ctx.progress(0.2, 'Opening the Word file');
    const blocks = await A.docx.read(await file.arrayBuffer());
    const text = A.docx.toText(blocks);
    const d = ctx.digest;
    const w = words(text);
    const count = (t) => blocks.filter((b) => b.type === t).length;
    d.facts.push(['Words', fmtNum(w)], ['Reading time', readingTime(w)]);
    if (count('heading')) d.facts.push(['Headings', String(count('heading'))]);
    if (count('table')) d.facts.push(['Tables', String(count('table'))]);
    if (count('image')) d.facts.push(['Pictures', String(count('image'))]);
    if (!text.trim()) throw new Error('No text was found in this Word document.');
    Object.assign(d, clip(text));
    return d;
  }

  /* ---------------------------------------------------------- spreadsheets */
  const X_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  const MAX_ROWS = 20000;

  function colIndex(ref) {
    let n = 0;
    for (const ch of ref) {
      const c = ch.charCodeAt(0);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }
  function isDateCode(code) {
    const c = String(code || '').replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
    return /[dmyhs]/i.test(c) && !/^(general|@|0+(\.0+)?%?)$/i.test(c.trim());
  }
  function excelDate(serial, date1904) {
    const ms = (serial - (date1904 ? 24107 : 25569)) * 86400000;
    return new Date(Math.round(ms));
  }

  async function readXlsx(file, ctx) {
    const JSZip = await A.libs.jszip();
    let zip;
    try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
    catch (_) { throw new Error('This file is not a valid .xlsx workbook.'); }
    const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const read = async (p) => { const f = zip.file(p); return f ? parse(await f.async('string')) : null; };
    const wb = await read('xl/workbook.xml');
    if (!wb) throw new Error('This file is not an Excel workbook.');
    const date1904 = /^(1|true)$/i.test((wb.getElementsByTagNameNS(X_NS, 'workbookPr')[0] || { getAttribute: () => '' }).getAttribute('date1904') || '');
    const rels = {};
    const rd = await read('xl/_rels/workbook.xml.rels');
    if (rd) for (const r of rd.getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
    const shared = [];
    const sst = await read('xl/sharedStrings.xml');
    if (sst) {
      for (const si of sst.getElementsByTagNameNS(X_NS, 'si')) {
        let s = '';
        for (const t of si.getElementsByTagNameNS(X_NS, 't')) {
          if (t.parentNode && t.parentNode.localName === 'rPh') continue; // phonetic hints
          s += t.textContent;
        }
        shared.push(s);
      }
    }
    // Which cell styles are dates
    const dateStyle = [];
    const st = await read('xl/styles.xml');
    if (st) {
      const custom = {};
      for (const nf of st.getElementsByTagNameNS(X_NS, 'numFmt')) custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode');
      const xfs = st.getElementsByTagNameNS(X_NS, 'cellXfs')[0];
      if (xfs) {
        for (const xf of xfs.getElementsByTagNameNS(X_NS, 'xf')) {
          const id = +xf.getAttribute('numFmtId') || 0;
          dateStyle.push(BUILTIN_DATE_FORMATS.has(id) || (custom[id] != null && isDateCode(custom[id])));
        }
      }
    }
    const sheets = [];
    const list = Array.from(wb.getElementsByTagNameNS(X_NS, 'sheet'));
    for (let si = 0; si < list.length; si++) {
      U.checkAbort(ctx.signal);
      const sh = list[si];
      const rid = sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sh.getAttribute('r:id');
      let target = rels[rid] || 'worksheets/sheet' + (si + 1) + '.xml';
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const doc = await read(target);
      if (!doc) continue;
      const rows = [];
      let truncated = false;
      for (const row of doc.getElementsByTagNameNS(X_NS, 'row')) {
        if (rows.length >= MAX_ROWS) { truncated = true; break; }
        const cells = [];
        let auto = 0;
        for (const c of row.getElementsByTagNameNS(X_NS, 'c')) {
          const ref = c.getAttribute('r');
          const idx = ref ? colIndex(ref) : auto;
          auto = idx + 1;
          const t = c.getAttribute('t');
          const vNode = c.getElementsByTagNameNS(X_NS, 'v')[0];
          const v = vNode ? vNode.textContent : null;
          let val = null;
          if (t === 's') val = v != null ? shared[+v] ?? '' : '';
          else if (t === 'inlineStr') val = Array.from(c.getElementsByTagNameNS(X_NS, 't')).map((x) => x.textContent).join('');
          else if (t === 'b') val = v === '1';
          else if (t === 'str' || t === 'e') val = v || '';
          else if (v != null && v !== '') {
            const num = +v;
            const s = +c.getAttribute('s') || 0;
            val = Number.isFinite(num) ? (dateStyle[s] ? excelDate(num, date1904) : num) : v;
          }
          if (val !== null && val !== '') cells[idx] = val;
        }
        if (cells.length) rows.push(cells);
      }
      sheets.push({ name: sh.getAttribute('name') || 'Sheet ' + (si + 1), rows, truncated });
      ctx.progress(0.1 + 0.6 * ((si + 1) / list.length), 'Reading sheet ' + (si + 1) + ' of ' + list.length);
    }
    return sheets;
  }

  function parseDelimited(text) {
    const first = text.split(/\r?\n/, 5).join('\n');
    const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
    for (const ch of first) if (ch in counts) counts[ch]++;
    const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += ch;
      } else if (ch === '"' && field === '') quoted = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f !== '')) rows.push(row);
        row = [];
        if (rows.length >= MAX_ROWS) break;
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
    return rows.map((r) => r.map((v) => {
      const s = v.trim();
      if (/^-?\d+(\.\d+)?$/.test(s)) return +s;
      if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return +s.replace(/,/g, '');
      if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(s)) { const d = new Date(s.replace(' ', 'T')); if (!isNaN(d)) return d; }
      return s;
    }));
  }

  function cellText(v) {
    if (v == null) return '';
    if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, v.getUTCHours() || v.getUTCMinutes() ? 16 : 10).replace('T', ' ');
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v).replace(/\s+/g, ' ').trim();
  }

  /** Column types and statistics, computed exactly. */
  function profileSheet(sheet) {
    const rows = sheet.rows.filter((r) => r && r.some((v) => v != null && v !== ''));
    if (!rows.length) return null;
    const width = Math.max(...rows.map((r) => r.length));
    const first = rows[0];
    const stringy = first.filter((v) => typeof v === 'string').length;
    const hasHeader = rows.length > 1 && stringy >= Math.max(1, first.filter((v) => v != null).length * 0.6);
    const header = Array.from({ length: width }, (_, j) => (hasHeader && first[j] != null ? cellText(first[j]) : 'Column ' + String.fromCharCode(65 + (j % 26)) + (j >= 26 ? Math.floor(j / 26) : '')));
    const body = hasHeader ? rows.slice(1) : rows;
    const cols = [];
    for (let j = 0; j < width; j++) {
      const vals = body.map((r) => r[j]).filter((v) => v != null && v !== '');
      if (!vals.length) continue;
      const nums = vals.filter((v) => typeof v === 'number' && Number.isFinite(v));
      const dates = vals.filter((v) => v instanceof Date && !isNaN(v));
      const col = { index: j, name: header[j], count: vals.length };
      if (nums.length >= vals.length * 0.8 && nums.length >= 2) {
        let sum = 0, min = Infinity, max = -Infinity, minRow = -1, maxRow = -1;
        body.forEach((r, ri) => {
          const v = r[j];
          if (typeof v !== 'number' || !Number.isFinite(v)) return;
          sum += v;
          if (v < min) { min = v; minRow = ri; }
          if (v > max) { max = v; maxRow = ri; }
        });
        Object.assign(col, { type: 'number', sum, mean: sum / nums.length, min, max, minRow, maxRow });
      } else if (dates.length >= vals.length * 0.8) {
        const t = dates.map((d) => d.getTime());
        Object.assign(col, { type: 'date', from: new Date(Math.min(...t)), to: new Date(Math.max(...t)) });
      } else {
        const freq = new Map();
        for (const v of vals) { const k = cellText(v); freq.set(k, (freq.get(k) || 0) + 1); }
        const top = [...freq.entries()].sort((a, b) => b[1] - a[1]);
        Object.assign(col, { type: 'text', distinct: freq.size, top: top.slice(0, 5) });
      }
      cols.push(col);
    }
    const label = cols.find((c) => c.type === 'text' || c.type === 'date');
    const rowLabel = (ri) => {
      if (ri < 0) return '';
      const r = body[ri];
      const parts = cols.filter((c) => c.type !== 'number').slice(0, 2).map((c) => cellText(r[c.index])).filter(Boolean);
      return parts.length ? ' (' + parts.join(', ') + ')' : ' (row ' + (ri + (hasHeader ? 2 : 1)) + ')';
    };
    // Totals per category, for small categories only.
    const groups = [];
    const cats = cols.filter((c) => c.type === 'text' && c.distinct >= 2 && c.distinct <= 12).slice(0, 2);
    const measures = cols.filter((c) => c.type === 'number').slice(0, 3);
    for (const cat of cats) {
      for (const m of measures) {
        const sums = new Map();
        for (const r of body) {
          const k = cellText(r[cat.index]);
          const v = r[m.index];
          if (!k || typeof v !== 'number') continue;
          sums.set(k, (sums.get(k) || 0) + v);
        }
        groups.push({ by: cat.name, measure: m.name, items: [...sums.entries()].sort((a, b) => b[1] - a[1]) });
      }
    }
    return { name: sheet.name, header, hasHeader, body, cols, rowLabel, groups, rowCount: body.length, colCount: width, truncated: sheet.truncated, label };
  }

  function describeColumn(c, prof) {
    if (c.type === 'number') return 'numbers, ' + fmtNum(c.count, 0) + ' values, total ' + fmtNum(c.sum) + ', average ' + fmtNum(c.mean) + ', lowest ' + fmtNum(c.min) + prof.rowLabel(c.minRow) + ', highest ' + fmtNum(c.max) + prof.rowLabel(c.maxRow);
    if (c.type === 'date') return 'dates from ' + cellText(c.from) + ' to ' + cellText(c.to);
    return 'text, ' + c.distinct + ' different values' + (c.distinct <= 12 ? ': ' + c.top.map(([k, n]) => k + ' (' + n + ')').join(', ') : '; most common: ' + c.top.slice(0, 3).map(([k, n]) => k + ' (' + n + ')').join(', '));
  }

  function digestSheets(sheets, d) {
    const parts = [];
    let totalRows = 0;
    const profiles = sheets.map(profileSheet).filter(Boolean);
    if (!profiles.length) throw new Error('This spreadsheet is empty.');
    for (const p of profiles) {
      totalRows += p.rowCount;
      const lines = ['## Sheet "' + p.name + '": ' + fmtNum(p.rowCount, 0) + ' rows x ' + p.colCount + ' columns' + (p.truncated ? ' (only the first ' + fmtNum(MAX_ROWS, 0) + ' rows were read)' : '')];
      lines.push('Columns: ' + p.header.join(' | '));
      lines.push('Statistics computed exactly by the app (quote these numbers, do not recalculate):');
      for (const c of p.cols) lines.push('- ' + c.name + ': ' + describeColumn(c, p));
      for (const g of p.groups) lines.push('- Total ' + g.measure + ' by ' + g.by + ': ' + g.items.map(([k, v]) => k + ' ' + fmtNum(v)).join('; '));
      const sampleRows = p.body.slice(0, 60);
      lines.push('First ' + sampleRows.length + ' rows (tab-separated):');
      lines.push(p.header.join('\t'));
      for (const r of sampleRows) lines.push(Array.from({ length: p.colCount }, (_, j) => cellText(r[j])).join('\t'));
      if (p.body.length > sampleRows.length) lines.push('... ' + fmtNum(p.body.length - sampleRows.length, 0) + ' more rows not shown.');
      parts.push(lines.join('\n'));
      d.tables.push({
        title: p.name + ' · ' + fmtNum(p.rowCount, 0) + ' rows',
        columns: ['Column', 'Type', 'At a glance'],
        rows: p.cols.map((c) => [c.name, c.type === 'number' ? 'Number' : c.type === 'date' ? 'Date' : 'Text',
          c.type === 'number' ? 'Total ' + fmtNum(c.sum) + ' · Avg ' + fmtNum(c.mean) + ' · Min ' + fmtNum(c.min) + ' · Max ' + fmtNum(c.max)
            : c.type === 'date' ? cellText(c.from) + ' → ' + cellText(c.to)
              : c.distinct + ' values' + (c.distinct <= 12 ? ' · ' + c.top.slice(0, 3).map(([k]) => k).join(', ') : '')]),
      });
    }
    d.facts.push(['Sheets', String(profiles.length)], ['Rows', fmtNum(totalRows, 0)], ['Columns', String(Math.max(...profiles.map((p) => p.colCount)))]);
    Object.assign(d, clip(parts.join('\n\n')));
    return d;
  }

  async function readSheet(file, ctx) {
    const e = U.ext(file.name);
    let sheets;
    if (e === 'csv' || e === 'tsv' || file.type === 'text/csv') {
      ctx.progress(0.2, 'Reading rows');
      sheets = [{ name: U.baseName(file.name), rows: parseDelimited(await readTextFile(file)), truncated: false }];
    } else {
      sheets = await readXlsx(file, ctx);
    }
    return digestSheets(sheets, ctx.digest);
  }

  /* --------------------------------------------------------------- slides */
  const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const DML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

  async function readPptx(file, ctx) {
    const JSZip = await A.libs.jszip();
    let zip;
    try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
    catch (_) { throw new Error('This file is not a valid .pptx deck.'); }
    const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const read = async (p) => { const f = zip.file(p); return f ? parse(await f.async('string')) : null; };
    const relsOf = async (path) => {
      const dir = path.slice(0, path.lastIndexOf('/') + 1);
      const doc = await read(dir + '_rels/' + path.slice(dir.length) + '.rels');
      const out = [];
      if (doc) for (const r of doc.getElementsByTagName('Relationship')) {
        const t = r.getAttribute('Target');
        out.push({ id: r.getAttribute('Id'), type: r.getAttribute('Type') || '', target: t.startsWith('/') ? t.slice(1) : normalizePath(dir + t) });
      }
      return out;
    };
    const pres = await read('ppt/presentation.xml');
    if (!pres) throw new Error('This file is not a PowerPoint deck.');
    const presRels = await relsOf('ppt/presentation.xml');
    const order = Array.from(pres.getElementsByTagNameNS(P_NS, 'sldId')).map((s) => {
      const rid = s.getAttributeNS(R_NS, 'id') || s.getAttribute('r:id');
      const rel = presRels.find((r) => r.id === rid);
      return rel && rel.target;
    }).filter(Boolean);
    const out = [];
    let notesCount = 0;
    const shapeText = (sp) => {
      const paras = [];
      for (const p of sp.getElementsByTagNameNS(DML_NS, 'p')) {
        const t = Array.from(p.getElementsByTagNameNS(DML_NS, 't')).map((x) => x.textContent).join('').trim();
        if (t) paras.push(t);
      }
      return paras;
    };
    for (let i = 0; i < order.length; i++) {
      U.checkAbort(ctx.signal);
      const doc = await read(order[i]);
      if (!doc) continue;
      let title = '';
      const body = [];
      for (const sp of doc.getElementsByTagNameNS(P_NS, 'sp')) {
        const ph = sp.getElementsByTagNameNS(P_NS, 'ph')[0];
        const type = ph ? ph.getAttribute('type') || 'body' : '';
        const paras = shapeText(sp);
        if (!paras.length) continue;
        if (!title && (type === 'title' || type === 'ctrTitle')) title = paras.join(' ');
        else if (!['sldNum', 'dt', 'ftr', 'hdr'].includes(type)) body.push(...paras);
      }
      // Tables inside graphic frames
      for (const tbl of doc.getElementsByTagNameNS(DML_NS, 'tbl')) {
        for (const tr of tbl.getElementsByTagNameNS(DML_NS, 'tr')) {
          const cells = Array.from(tr.getElementsByTagNameNS(DML_NS, 'tc')).map((tc) => Array.from(tc.getElementsByTagNameNS(DML_NS, 't')).map((x) => x.textContent).join(' ').trim());
          if (cells.some(Boolean)) body.push(cells.join(' | '));
        }
      }
      let notes = '';
      const rels = await relsOf(order[i]);
      const nrel = rels.find((r) => /\/notesSlide$/.test(r.type));
      if (nrel) {
        const nd = await read(nrel.target);
        if (nd) {
          const parts = [];
          for (const sp of nd.getElementsByTagNameNS(P_NS, 'sp')) {
            const ph = sp.getElementsByTagNameNS(P_NS, 'ph')[0];
            if (ph && ph.getAttribute('type') === 'body') parts.push(...shapeText(sp));
          }
          notes = parts.join(' ');
          if (notes) notesCount++;
        }
      }
      out.push('Slide ' + (i + 1) + (title ? ': ' + title : '') + (body.length ? '\n' + body.map((b) => '- ' + b).join('\n') : '') + (notes ? '\nSpeaker notes: ' + notes : ''));
      ctx.progress(0.1 + 0.8 * ((i + 1) / order.length), 'Reading slide ' + (i + 1) + ' of ' + order.length);
    }
    const text = out.join('\n\n');
    if (!text.trim()) throw new Error('No text was found on these slides.');
    const d = ctx.digest;
    d.facts.push(['Slides', String(order.length)], ['Words', fmtNum(words(text))]);
    if (notesCount) d.facts.push(['Speaker notes', notesCount + ' slides']);
    Object.assign(d, clip(text));
    return d;
  }
  function normalizePath(p) {
    const parts = [];
    for (const seg of p.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }

  /* ----------------------------------------------------------------- text */
  const CODE_LANG = { js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', jsx: 'JavaScript', py: 'Python', java: 'Java', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', cc: 'C++', cs: 'C#', go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', swift: 'Swift', kt: 'Kotlin', kts: 'Kotlin', scala: 'Scala', sql: 'SQL', sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell', r: 'R', m: 'MATLAB', css: 'CSS', scss: 'SCSS' };
  async function readText(file, ctx) {
    ctx.progress(0.3, 'Reading text');
    let text = await readTextFile(file);
    const e = U.ext(file.name);
    const d = ctx.digest;
    if (e === 'html' || e === 'htm') {
      const doc = new DOMParser().parseFromString(text, 'text/html');
      doc.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
      text = (doc.body ? doc.body.innerText || doc.body.textContent : doc.documentElement.textContent) || '';
      if (doc.title) d.facts.push(['Title', doc.title.slice(0, 100)]);
      d.typeLabel = 'Web page';
    } else if (e === 'ipynb') {
      try {
        const nb = JSON.parse(text);
        text = (nb.cells || []).map((c) => (c.cell_type === 'code' ? '```\n' : '') + [].concat(c.source || []).join('') + (c.cell_type === 'code' ? '\n```' : '')).join('\n\n');
        d.typeLabel = 'Jupyter notebook';
      } catch (_) { /* keep raw */ }
    } else if (e === 'json') {
      try { text = JSON.stringify(JSON.parse(text), null, 2); d.typeLabel = 'JSON data'; } catch (_) { /* keep raw */ }
    } else if (e === 'srt' || e === 'vtt') {
      text = text.replace(/^\d+\s*$/gm, '').replace(/^WEBVTT.*$/m, '').replace(/^\s*\d\d:\d\d.*-->.*$/gm, '').replace(/\n{2,}/g, '\n');
      d.typeLabel = 'Subtitles';
    } else if (CODE_LANG[e]) {
      d.typeLabel = CODE_LANG[e] + ' code';
      d.code = true;
    } else if (e === 'md' || e === 'markdown') d.typeLabel = 'Markdown file';
    if (!text.trim()) throw new Error('This file is empty.');
    const lines = text.split('\n').length;
    d.facts.push([d.code ? 'Lines of code' : 'Lines', fmtNum(lines, 0)], ['Words', fmtNum(words(text))]);
    Object.assign(d, clip(text));
    return d;
  }

  /* ---------------------------------------------------------------- image */
  async function readImage(file, ctx) {
    if (!ctx.maxImages) throw new Error('Summarizing pictures needs an AI that can see images, which is not switched on here.');
    ctx.progress(0.3, 'Preparing the image');
    let img;
    try { img = await U.decodeImage(file); }
    catch (_) { throw new Error('This image could not be opened' + (/heic|heif/i.test(U.ext(file.name)) ? '. HEIC photos open in Safari; in other browsers save them as JPG first.' : '.')); }
    const d = ctx.digest;
    d.facts.push(['Size', img.width + ' × ' + img.height + ' px'], ['Format', (U.ext(file.name) || file.type.split('/')[1] || 'image').toUpperCase()]);
    if (img.close) img.close();
    const small = await U.downscaleImage(file, 1600);
    d.images.push(small);
    d.thumb = small;
    d.imageNote = 'The attached image is the file itself.';
    d.text = '(The file is the attached image.)';
    return d;
  }

  /* ----------------------------------------------------------- video/audio */
  function once(el, ok, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeout);
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(el.error || new Error('media error')); };
      function cleanup() { clearTimeout(t); el.removeEventListener(ok, done); el.removeEventListener('error', fail); }
      el.addEventListener(ok, done, { once: true });
      el.addEventListener('error', fail, { once: true });
    });
  }

  async function mediaDuration(el) {
    let d = el.duration;
    if (!Number.isFinite(d)) {
      // Some recordings report Infinity until the end is read.
      el.currentTime = 1e7;
      try { await once(el, 'durationchange', 5000); } catch (_) { /* best effort */ }
      d = el.duration;
      el.currentTime = 0;
    }
    return Number.isFinite(d) ? d : 0;
  }

  async function readVideo(file, ctx) {
    const d = ctx.digest;
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.src = url;
    try {
      try { await once(v, 'loadedmetadata'); }
      catch (_) { throw new Error('This browser cannot play this video format. Try an MP4 (H.264) or WEBM file.'); }
      const duration = await mediaDuration(v);
      d.duration = duration;
      d.facts.push(['Duration', U.formatTime(duration)], ['Resolution', v.videoWidth + ' × ' + v.videoHeight]);
      // Gemini on the server hears the soundtrack too; otherwise frames are all the AI gets.
      const forAi = ctx.media ? 0 : Math.min(ctx.maxImages, 10);
      const n = Math.max(forAi, 6);
      if (!forAi && !ctx.media) throw new Error('Summarizing videos needs an AI that can see images, which is not switched on here.');
      const side = 768;
      const k = Math.min(1, side / Math.max(v.videoWidth || side, v.videoHeight || side));
      const c = document.createElement('canvas');
      c.width = Math.max(2, Math.round((v.videoWidth || 640) * k));
      c.height = Math.max(2, Math.round((v.videoHeight || 360) * k));
      const g = c.getContext('2d');
      for (let i = 0; i < n; i++) {
        U.checkAbort(ctx.signal);
        const t = duration ? Math.min(duration - 0.05, duration * (i + 0.5) / n) : i;
        v.currentTime = Math.max(0, t);
        try { await once(v, 'seeked', 8000); } catch (_) { continue; }
        g.drawImage(v, 0, 0, c.width, c.height);
        const blob = await U.canvasToBlob(c, 'image/jpeg', 0.82);
        d.frames.push({ t, blob });
        ctx.progress(0.1 + 0.8 * ((i + 1) / n), 'Reading frame ' + (i + 1) + ' of ' + n);
      }
      c.width = c.height = 0;
      if (!d.frames.length) throw new Error('No frames could be read from this video.');
      d.thumb = d.frames[0].blob;
      if (ctx.media) {
        d.media = file;
        d.text = '(The file is the attached video. Watch it and listen to it.)';
        d.facts.push(['AI reads', 'whole video + sound']);
      } else {
        // Spread the AI's frames evenly over the whole video.
        const m = Math.min(forAi, d.frames.length);
        const picked = m >= d.frames.length ? d.frames : Array.from({ length: m }, (_, i) => d.frames[Math.round((i * (d.frames.length - 1)) / Math.max(1, m - 1))]);
        d.images = picked.map((f) => f.blob);
        d.imageNote = 'The attached images are frames from the video at ' + picked.map((f) => U.formatTime(f.t)).join(', ') + ' (mm:ss), in order. There is no sound track available.';
        d.text = '(The file is a ' + U.formatTime(duration) + ' video. Use the attached frames.)';
        d.facts.push(['AI reads', d.images.length + ' frames (no sound)']);
        if (A.env.mode === 'artifact') d.warnings.push('In this preview the AI looks at ' + d.images.length + ' frames and cannot hear the sound. On your own server with a Gemini key it watches and listens to the whole video.');
      }
      return d;
    } finally {
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
    }
  }

  async function readAudio(file, ctx) {
    const d = ctx.digest;
    const url = URL.createObjectURL(file);
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.src = url;
    try {
      try { await once(a, 'loadedmetadata'); } catch (_) { /* duration unknown */ }
      const duration = await mediaDuration(a);
      if (duration) d.facts.push(['Duration', U.formatTime(duration)]);
      d.facts.push(['Format', (U.ext(file.name) || 'audio').toUpperCase()]);
      if (!ctx.media) {
        throw new Error(A.env.mode === 'artifact'
          ? 'Audio summaries need the AI to listen, which this preview cannot do. Host Alembic with a Gemini key to summarize recordings, or summarize a video instead.'
          : 'Audio summaries need GEMINI_API_KEY on your server, because Gemini is the AI that can listen to recordings.');
      }
      d.media = file;
      d.text = '(The file is the attached audio recording. Listen to it.)';
      d.facts.push(['AI reads', 'whole recording']);
      return d;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ----------------------------------------------------------------- main */
  const READERS = { pdf: readPdf, docx: readDocx, sheet: readSheet, slides: readPptx, text: readText, image: readImage, video: readVideo, audio: readAudio };

  /**
   * Read a file into a digest.
   * opts: { signal, progress(fraction, label), maxImages, media }
   */
  async function read(file, opts = {}) {
    const kind = kindOf(file);
    if (kind === 'unknown') throw new Error(unsupportedReason(file));
    if (file.size > 1024 * 1024 * 1024) throw new Error('This file is over 1 GB, which is too big to read in a browser tab.');
    const digest = {
      kind,
      name: file.name,
      size: file.size,
      typeLabel: KIND_LABEL[kind],
      facts: [['Type', KIND_LABEL[kind]], ['Size', U.formatBytes(file.size)]],
      text: '',
      truncated: false,
      images: [],
      imageNote: '',
      frames: [],
      tables: [],
      warnings: [],
      media: null,
      thumb: null,
    };
    const ctx = {
      digest,
      signal: opts.signal,
      progress: opts.progress || (() => {}),
      maxImages: opts.maxImages || 0,
      media: !!opts.media,
    };
    await READERS[kind](file, ctx);
    const typeFact = digest.facts.find(([k]) => k === 'Type');
    if (typeFact) typeFact[1] = digest.typeLabel;
    if (digest.truncated) digest.warnings.push('This file is long, so the AI reads the first ' + Math.round(MAX_TEXT / 1000) + ',000 characters.');
    ctx.progress(1, 'Ready');
    return digest;
  }

  A.readers = { read, kindOf, KIND_LABEL, unsupportedReason, _test: { parseDelimited, profileSheet, pageParagraphs, isDateCode } };
})();
