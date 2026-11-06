/* Alembic · docx
 * A small Word (.docx) reader built on JSZip: paragraphs, headings, lists,
 * tables, images and page breaks, turned into plain text for AI summaries.
 */
(function () {
  'use strict';
  const A = (window.Alembic = window.Alembic || {});

  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
  const EMU_PER_PT = 12700;



  /* ------------------------------------------------------------- reader */
  function kids(node, local) {
    const out = [];
    for (let c = node.firstElementChild; c; c = c.nextElementSibling) {
      if (c.namespaceURI === W_NS && (!local || c.localName === local)) out.push(c);
    }
    return out;
  }
  function first(node, local) {
    for (let c = node && node.firstElementChild; c; c = c.nextElementSibling) {
      if (c.namespaceURI === W_NS && c.localName === local) return c;
    }
    return null;
  }
  function wAttr(node, name) {
    if (!node) return null;
    return node.getAttributeNS(W_NS, name) ?? node.getAttribute('w:' + name);
  }
  function isOn(node) {
    if (!node) return false;
    const v = wAttr(node, 'val');
    return v == null || !/^(0|false|off|none)$/i.test(v);
  }

  /**
   * Read a .docx into simple blocks:
   * {type:'heading', level, runs} {type:'p', runs, list?:{label, level}} {type:'table', rows:[[text]]}
   * {type:'image', bytes, mime, widthPt, heightPt} {type:'pagebreak'}
   */
  async function readDocx(arrayBuffer) {
    const JSZip = await A.libs.jszip();
    let zip;
    try {
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch (_) {
      throw new Error('This file is not a valid .docx. Older .doc files need to be saved as .docx first.');
    }
    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('This file is not a Word document (.docx).');
    const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const doc = parse(await docFile.async('string'));

    // Relationships (images)
    const rels = {};
    const relFile = zip.file('word/_rels/document.xml.rels');
    if (relFile) {
      const rd = parse(await relFile.async('string'));
      for (const r of rd.getElementsByTagName('Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
    }
    // Styles -> heading levels (even in localized documents) and list numbering set by a style.
    const styleLevel = {};
    const styleNum = {};
    const stFile = zip.file('word/styles.xml');
    if (stFile) {
      const sd = parse(await stFile.async('string'));
      for (const s of sd.getElementsByTagNameNS(W_NS, 'style')) {
        const id = wAttr(s, 'styleId');
        const name = (wAttr(first(s, 'name'), 'val') || '').toLowerCase();
        const pPr = first(s, 'pPr');
        const ol = pPr && first(pPr, 'outlineLvl');
        const np = pPr && first(pPr, 'numPr');
        if (id && np) styleNum[id] = { numId: wAttr(first(np, 'numId'), 'val'), ilvl: +(wAttr(first(np, 'ilvl'), 'val') || 0) };
        let lvl = null;
        const m = /^heading\s*(\d)/.exec(name);
        if (m) lvl = +m[1];
        else if (name === 'title') lvl = 0;
        else if (ol) lvl = +wAttr(ol, 'val') + 1;
        if (id && lvl != null && lvl <= 6) styleLevel[id] = lvl;
      }
    }
    // Numbering -> bullet or number per numId/level.
    const numFmt = {};
    const numFile = zip.file('word/numbering.xml');
    if (numFile) {
      const nd = parse(await numFile.async('string'));
      const abstract = {};
      for (const an of nd.getElementsByTagNameNS(W_NS, 'abstractNum')) {
        const levels = {};
        for (const lvl of kids(an, 'lvl')) levels[wAttr(lvl, 'ilvl')] = wAttr(first(lvl, 'numFmt'), 'val') || 'bullet';
        abstract[wAttr(an, 'abstractNumId')] = levels;
      }
      for (const num of nd.getElementsByTagNameNS(W_NS, 'num')) {
        const aid = wAttr(first(num, 'abstractNumId'), 'val');
        numFmt[wAttr(num, 'numId')] = abstract[aid] || {};
      }
    }
    const counters = {};

    const blocks = [];
    const mediaCache = {};
    async function imageFromBlip(rid, extentNode) {
      const target = rels[rid];
      if (!target) return null;
      const path = target.startsWith('/') ? target.slice(1) : 'word/' + target.replace(/^\.\//, '');
      const f = zip.file(path);
      if (!f) return null;
      const ext = A.util.ext(path);
      const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : null;
      if (!mime) return null;
      const bytes = mediaCache[path] || (mediaCache[path] = await f.async('uint8array'));
      let widthPt = 300, heightPt = 200;
      if (extentNode) {
        widthPt = (+extentNode.getAttribute('cx') || 0) / EMU_PER_PT || widthPt;
        heightPt = (+extentNode.getAttribute('cy') || 0) / EMU_PER_PT || heightPt;
      }
      return { type: 'image', bytes, mime, widthPt, heightPt };
    }

    async function readParagraph(p, target) {
      const pPr = first(p, 'pPr');
      const styleId = pPr && wAttr(first(pPr, 'pStyle'), 'val');
      const numPr = pPr && first(pPr, 'numPr');
      let list = null;
      if (numPr) {
        const fromStyle = (styleId && styleNum[styleId]) || {};
        list = { numId: wAttr(first(numPr, 'numId'), 'val') || fromStyle.numId, ilvl: +(wAttr(first(numPr, 'ilvl'), 'val') || fromStyle.ilvl || 0) };
      } else if (styleId && styleNum[styleId]) {
        list = Object.assign({}, styleNum[styleId]);
      }
      if (list && (!list.numId || list.numId === '0')) list = null;
      const runs = [];
      const pending = [];
      let pageBreakAfter = false;

      async function walk(node, inherited) {
        for (let c = node.firstElementChild; c; c = c.nextElementSibling) {
          const ln = c.localName;
          if (c.namespaceURI === W_NS) {
            if (ln === 'r') {
              const rPr = first(c, 'rPr');
              const style = {
                bold: !!(rPr && isOn(first(rPr, 'b'))) || inherited.bold,
                italic: !!(rPr && isOn(first(rPr, 'i'))) || inherited.italic,
              };
              for (let rc = c.firstElementChild; rc; rc = rc.nextElementSibling) {
                const rl = rc.localName;
                if (rc.namespaceURI === W_NS) {
                  if (rl === 't') runs.push(Object.assign({ text: rc.textContent }, style));
                  else if (rl === 'tab') runs.push(Object.assign({ text: '\t' }, style));
                  else if (rl === 'br') {
                    if (wAttr(rc, 'type') === 'page') pageBreakAfter = true;
                    else runs.push({ text: '\n' });
                  } else if (rl === 'cr') runs.push({ text: '\n' });
                  else if (rl === 'noBreakHyphen') runs.push({ text: '-' });
                  else if (rl === 'drawing' || rl === 'pict') await collectImages(rc);
                } else if (rl === 'AlternateContent') {
                  // Prefer the fallback branch for compatibility.
                  const fb = [...rc.children].find((k) => k.localName === 'Fallback') || [...rc.children].find((k) => k.localName === 'Choice');
                  if (fb) await collectImages(fb);
                }
              }
            } else if (ln === 'hyperlink' || ln === 'ins' || ln === 'smartTag' || ln === 'fldSimple' || ln === 'customXml') {
              await walk(c, inherited);
            } else if (ln === 'sdt') {
              const content = first(c, 'sdtContent');
              if (content) await walk(content, inherited);
            }
          }
        }
      }
      async function collectImages(node) {
        const blips = node.getElementsByTagNameNS(A_NS, 'blip');
        for (const blip of blips) {
          const rid = blip.getAttributeNS(R_NS, 'embed') || blip.getAttribute('r:embed');
          let host = blip.parentNode;
          let extent = null;
          while (host && host !== node.parentNode) {
            const e = host.getElementsByTagNameNS ? host.getElementsByTagNameNS(WP_NS, 'extent')[0] : null;
            if (e) { extent = e; break; }
            host = host.parentNode;
          }
          const img = await imageFromBlip(rid, extent);
          if (img) pending.push(img);
        }
      }
      await walk(p, { bold: false, italic: false });

      const text = runs.map((r) => r.text).join('');
      if (text.trim()) {
        const lvl = styleId != null ? styleLevel[styleId] : undefined;
        if (lvl != null) {
          target.push({ type: 'heading', level: Math.max(1, Math.min(3, lvl || 1)), title: lvl === 0, runs });
        } else if (list) {
          const { numId, ilvl } = list;
          const fmt = (numFmt[numId] || {})[ilvl] || 'bullet';
          let label = '•';
          if (fmt !== 'bullet' && fmt !== 'none') {
            const key = numId + ':' + ilvl;
            counters[key] = (counters[key] || 0) + 1;
            for (const k of Object.keys(counters)) if (k.startsWith(numId + ':') && +k.split(':')[1] > ilvl) delete counters[k];
            const n = counters[key];
            label = fmt === 'lowerLetter' ? String.fromCharCode(96 + ((n - 1) % 26) + 1) + '.' : fmt === 'upperLetter' ? String.fromCharCode(64 + ((n - 1) % 26) + 1) + '.' : fmt === 'lowerRoman' ? roman(n).toLowerCase() + '.' : fmt === 'upperRoman' ? roman(n) + '.' : n + '.';
          }
          target.push({ type: 'p', runs, list: { label, level: ilvl } });
        } else {
          target.push({ type: 'p', runs });
        }
      } else if (!pending.length) {
        target.push({ type: 'p', runs: [], empty: true });
      }
      for (const img of pending) target.push(img);
      if (pageBreakAfter) target.push({ type: 'pagebreak' });
    }

    async function readTable(tbl, target) {
      const rows = [];
      for (const tr of kids(tbl, 'tr')) {
        const cells = [];
        for (const tc of kids(tr, 'tc')) {
          const parts = [];
          for (const p of kids(tc, 'p')) {
            const tmp = [];
            await readParagraph(p, tmp);
            for (const b of tmp) if (b.runs) parts.push(b.runs.map((r) => r.text).join(''));
          }
          cells.push(parts.filter((s) => s.trim()).join('\n'));
        }
        if (cells.length) rows.push(cells);
      }
      if (rows.length) target.push({ type: 'table', rows });
    }

    async function readContainer(node, target) {
      for (const c of kids(node)) {
        if (c.localName === 'p') await readParagraph(c, target);
        else if (c.localName === 'tbl') await readTable(c, target);
        else if (c.localName === 'sdt') {
          const content = first(c, 'sdtContent');
          if (content) await readContainer(content, target);
        }
      }
    }

    const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
    if (!body) throw new Error('This Word document has no body text.');
    await readContainer(body, blocks);
    // Trim empty paragraphs at both ends.
    while (blocks.length && blocks[0].empty) blocks.shift();
    while (blocks.length && blocks[blocks.length - 1].empty) blocks.pop();
    return blocks;
  }

  function roman(n) {
    const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let s = '';
    for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
    return s;
  }

  /** Plain text from docx blocks. */
  function blocksToText(blocks) {
    const out = [];
    for (const b of blocks) {
      if (b.type === 'heading') out.push(b.runs.map((r) => r.text).join('').trim(), '');
      else if (b.type === 'p') {
        const t = b.runs.map((r) => r.text).join('');
        if (b.list) out.push('  '.repeat(b.list.level) + b.list.label + ' ' + t.trim());
        else out.push(t, '');
      } else if (b.type === 'table') {
        for (const row of b.rows) out.push(row.map((c) => c.replace(/\n/g, ' / ')).join('\t'));
        out.push('');
      } else if (b.type === 'pagebreak') out.push('');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  A.docx = { read: readDocx, toText: blocksToText };
})();
