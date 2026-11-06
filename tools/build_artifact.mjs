// Inline styles.css and every script into one page (dist/alembic.html) for
// publishing as a Claude artifact, plus dist/preview.html for local testing.
// Run: node tools/build_artifact.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { catalogSource } from './build_catalog.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pub = join(root, 'public');
writeFileSync(join(pub, 'js', 'catalog.js'), catalogSource());

const html = readFileSync(join(pub, 'index.html'), 'utf8');
const pick = (a, b) => {
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error('marker ' + a);
  return html.slice(i + a.length, j);
};
let head = pick('<!-- page:head -->', '<!-- /page:head -->');
let body = pick('<!-- page:body -->', '<!-- /page:body -->');
const css = readFileSync(join(pub, 'styles.css'), 'utf8');
head = head.replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + css + '\n</style>');
body = body.replace(/<script src="(js\/[\w.-]+)"><\/script>/g, (_, src) => {
  const js = readFileSync(join(pub, src), 'utf8');
  if (/<\/script/i.test(js)) throw new Error('script end tag inside ' + src);
  return '<script>\n' + js + '\n</script>';
});
const out = head.trim() + '\n' + body.trim() + '\n';
if (/<html|<head|<body|<!doctype/i.test(out.slice(0, 2000).replace(/<!-- .*? -->/g, ''))) throw new Error('skeleton tags left');
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'alembic.html'), out);
writeFileSync(join(root, 'dist', 'preview.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + out + '</body></html>');
console.log('built dist/alembic.html', out.length, 'bytes');
