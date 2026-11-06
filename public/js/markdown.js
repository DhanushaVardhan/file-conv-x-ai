/* Alembic · markdown
 * A small, safe Markdown renderer for AI answers: headings, lists, tables,
 * quotes, code and inline emphasis. All text is escaped first; only http(s)
 * links become anchors.
 */
(function () {
  'use strict';
  const A = window.Alembic;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function inline(src) {
    const codes = [];
    let s = String(src).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => '<a href="' + u.replace(/"/g, '%22') + '" target="_blank" rel="noopener noreferrer">' + t + '</a>');
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>').replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => '<code>' + esc(codes[+i]) + '</code>');
    return s;
  }

  function splitRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  }

  function render(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    let para = [];
    const flushPara = () => {
      if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
    };
    while (i < lines.length) {
      const line = lines[i];
      const t = line.trim();
      if (!t) { flushPara(); i++; continue; }
      let m;
      if (/^(```|~~~)/.test(t)) {
        flushPara();
        const fence = t.slice(0, 3);
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
        i++;
        out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if ((m = /^(#{1,6})\s+(.*?)\s*#*$/.exec(t))) {
        flushPara();
        const lvl = Math.min(4, Math.max(2, m[1].length)); // # and ## -> h2 (the page owns h1), ### -> h3
        out.push('<h' + lvl + '>' + inline(m[2]) + '</h' + lvl + '>');
        i++;
        continue;
      }
      if (/^([-*_])(\s*\1){2,}$/.test(t)) { flushPara(); out.push('<hr>'); i++; continue; }
      if (t.startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
        flushPara();
        const head = splitRow(t);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
        out.push('<div class="md-table"><table><thead><tr>' + head.map((h) => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + head.map((_, k) => '<td>' + inline(r[k] || '') + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
        continue;
      }
      if (/^>\s?/.test(t)) {
        flushPara();
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
        continue;
      }
      if (/^([-*+•]|\d{1,3}[.)])\s+/.test(t)) {
        flushPara();
        const stack = [];
        while (i < lines.length) {
          const l = lines[i];
          const mm = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/.exec(l);
          if (!mm) {
            if (l.trim() && /^\s{2,}/.test(l) && stack.length) { out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ' ' + inline(l.trim()) + '</li>'); i++; continue; }
            break;
          }
          const depth = Math.floor(mm[1].replace(/\t/g, '    ').length / 2);
          const ordered = /\d/.test(mm[2]);
          const tag = ordered ? 'ol' : 'ul';
          while (stack.length && stack[stack.length - 1].depth > depth) out.push('</' + stack.pop().tag + '>');
          if (!stack.length || stack[stack.length - 1].depth < depth) {
            out.push('<' + tag + (ordered && +mm[2] > 1 ? ' start="' + parseInt(mm[2], 10) + '"' : '') + '>');
            stack.push({ depth, tag });
          }
          out.push('<li>' + inline(mm[3]) + '</li>');
          i++;
        }
        while (stack.length) out.push('</' + stack.pop().tag + '>');
        continue;
      }
      para.push(t);
      i++;
    }
    flushPara();
    return out.join('\n');
  }

  /** Plain text version (for copying). */
  function toPlain(md) {
    return String(md || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
  }

  A.markdown = { render, toPlain };
})();
