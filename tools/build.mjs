/**
 * build.mjs
 * ------------------------------------------------------------------
 * Inlines every script and stylesheet referenced by index.html into one
 * self-contained HTML file. No bundler, no dependencies: the source modules
 * are plain scripts that attach to the PG namespace, so concatenating them in
 * the order index.html declares is a correct bundle.
 *
 *   node tools/build.mjs            -> dist/punjab-cm.html
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)" \/>/g)].map((m) => m[1]);

if (!scripts.length) throw new Error('no scripts found in index.html');

let missing = [];
const read = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    missing.push(rel);
    return '';
  }
  return fs.readFileSync(p, 'utf8');
};

const css = styles.map((s) => '/* ' + s + ' */\n' + read(s)).join('\n\n');
const js = scripts.map((s) => '/* ===== ' + s + ' ===== */\n' + read(s)).join('\n\n');

if (missing.length) throw new Error('missing files: ' + missing.join(', '));

const title = (html.match(/<title>([^<]*)<\/title>/) || [, 'Punjab Chief Minister'])[1];
const description = (html.match(/name="description"\s+content="([^"]*)"/s) || [, ''])[1]
  .replace(/\s+/g, ' ')
  .trim();

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${title}</title>
<meta name="description" content="${description}" />
<style>
${css}
</style>
</head>
<body>
<div id="app"></div>
<script>
${js}
</script>
</body>
</html>
`;

const dist = path.join(ROOT, 'dist');
if (!fs.existsSync(dist)) fs.mkdirSync(dist);
const outPath = path.join(dist, 'punjab-cm.html');
fs.writeFileSync(outPath, out);

/* The Artifact host supplies its own <!doctype>/<html>/<head>/<body>, so it
   needs the page contents only. The <title> stays at the top: that is what
   names the artifact. */
const fragment = `<title>${title}</title>
<style>
${css}
</style>
<div id="app"></div>
<script>
${js}
</script>
`;
const fragPath = path.join(dist, 'punjab-cm.artifact.html');
fs.writeFileSync(fragPath, fragment);

console.log('bundled ' + scripts.length + ' scripts + ' + styles.length + ' stylesheet(s)');
console.log('-> ' + path.relative(ROOT, outPath) + '  ' + (out.length / 1024).toFixed(0) + ' KB');
console.log('-> ' + path.relative(ROOT, fragPath) + '  ' + (fragment.length / 1024).toFixed(0) + ' KB (artifact)');
