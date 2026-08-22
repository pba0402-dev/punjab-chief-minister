/**
 * Copy an asset package into the game's web root.
 *
 *   node tools/sync-assets.mjs "C:/Users/info/Desktop/1 2 3"
 *
 * The package is two folders — `portraits/` and `party-symbols/` — and they
 * land under `simple/assets/` where the app expects them. The app itself only
 * ever names them relatively (`assets/portraits/...`), so wherever the source
 * lives on this machine stays on this machine: it is an argument here and
 * nowhere in the shipped code.
 *
 * Existing files are overwritten and nothing is renamed. Anything already in
 * the destination that the source does not have is left where it is, so a
 * partial package tops up rather than wipes.
 *
 * Pass --prune to make the destination match the source exactly instead.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(HERE, '..', 'simple');
const DEST = path.join(WEB_ROOT, 'assets');

// The two folders the game reads, named as the app names them.
const GROUPS = ['portraits', 'party-symbols'];
const IMAGE = /\.(png|jpe?g|webp|svg|avif)$/i;

const args = process.argv.slice(2);
const prune = args.includes('--prune');
const source = args.find((a) => !a.startsWith('--'));

if (!source) {
  console.error('usage: node tools/sync-assets.mjs <source-folder> [--prune]');
  console.error('  <source-folder> holds portraits/ and party-symbols/');
  process.exit(2);
}
if (!fs.existsSync(source)) {
  console.error('no such folder: ' + source);
  process.exit(2);
}

let copied = 0;
let removed = 0;
const summary = [];

for (const group of GROUPS) {
  const from = path.join(source, group);
  const to = path.join(DEST, group);
  fs.mkdirSync(to, { recursive: true });

  if (!fs.existsSync(from)) {
    summary.push(group + ': no source folder, left alone');
    continue;
  }

  const files = fs.readdirSync(from).filter((f) => IMAGE.test(f));
  for (const file of files) {
    fs.copyFileSync(path.join(from, file), path.join(to, file));
    copied += 1;
  }

  if (prune) {
    const keep = new Set(files);
    for (const file of fs.readdirSync(to)) {
      if (IMAGE.test(file) && !keep.has(file)) {
        fs.unlinkSync(path.join(to, file));
        removed += 1;
      }
    }
  }

  summary.push(group + ': ' + files.length + ' file' + (files.length === 1 ? '' : 's'));
}

summary.forEach((line) => console.log('  ' + line));
console.log(copied + ' copied' + (prune ? ', ' + removed + ' pruned' : '') + ' -> simple/assets');

/*
 * Which id gets which file.
 *
 * The game's ids are `a1`-`a24` and `star`/`tree`/`lion` — they are what every
 * save, every profile and the server's own validation have always used, so
 * they do not move. The package's files are named for what they depict, and
 * they are not renamed either. The mapping between the two is written here,
 * as data, so re-pointing an id at a different picture is one line and no code
 * change at all.
 *
 * Where the package carries its own JSON, that JSON decides the order. Where
 * it does not, filenames in alphabetical order do. Either way the result is
 * written out in full rather than computed at runtime, so you can read what
 * was decided and edit it.
 */
function gameIds() {
  const avatars = (fs.readFileSync(path.join(WEB_ROOT, 'js/data/avatars.js'), 'utf8')
    .match(/CMP\.AVATARS = \[([\s\S]*?)\]/) || [])[1] || '';

  // Only the symbol list, not the colour list above it, which has the same shape.
  const symbolBlock = (fs.readFileSync(path.join(WEB_ROOT, 'js/data/parties.js'), 'utf8')
    .match(/CMP\.PARTY_SYMBOLS = \[([\s\S]*?)\];/) || [])[1] || '';

  return {
    portraits: (avatars.match(/'([^']+)'/g) || []).map((m) => m.slice(1, -1)),
    'party-symbols': (symbolBlock.match(/id: '([^']+)'/g) || [])
      .map((m) => m.match(/'([^']+)'/)[1]),
  };
}

/** The package's preferred order for a group, or null if it does not say. */
function packageOrder(group) {
  const names = group === 'portraits'
    ? ['portraits.json', path.join('portraits', 'portraits.json')]
    : [path.join('party-symbols', 'party-symbols.json'), 'party-symbols.json'];

  for (const name of names) {
    const file = path.join(source, name);
    if (!fs.existsSync(file)) continue;
    try {
      const rows = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const files = rows
        .map((row) => path.basename(String(row.image || row.file || '')))
        .filter(Boolean);
      if (files.length) return files;
    } catch (e) {
      console.log('  ! could not read ' + name + ': ' + e.message);
    }
  }
  return null;
}

const ids = gameIds();
const mapping = {};
const report = [];

for (const group of GROUPS) {
  const dir = path.join(DEST, group);
  const present = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => IMAGE.test(f))
    : [];

  // The package's order if it has one, then anything else it shipped.
  const preferred = packageOrder(group) || [];
  const known = new Set(preferred);
  const files = preferred
    .filter((f) => present.includes(f))
    .concat(present.filter((f) => !known.has(f)).sort());

  const groupIds = ids[group] || [];
  const pairs = {};
  groupIds.forEach((id, i) => {
    // An id whose own file is there keeps it: `a3.png` beats being handed the
    // third file in the package.
    if (present.includes(id + '.png')) return;
    if (files[i]) pairs[id] = files[i];
  });

  mapping[group] = pairs;
  const matched = groupIds.filter((id) => present.includes(id + '.png') || pairs[id]);
  report.push({
    group: group,
    total: groupIds.length,
    matched: matched.length,
    spare: Math.max(0, files.length - groupIds.length),
    pairs: pairs,
  });
}

const generated = `/**
 * GENERATED by tools/sync-assets.mjs — do not edit by hand.
 *
 * Which picture each id is shown as. The ids are the game's own and never
 * change; the filenames are the package's and are never renamed. This is the
 * join between them, and re-running the sync rewrites it.
 *
 * An id with no entry here falls back to <id>.png, and an id with no file at
 * all falls back to a label rather than a broken image.
 */
window.CMP = window.CMP || {};

CMP.ASSET_MAP = ${JSON.stringify(
  { portraits: mapping.portraits, symbols: mapping['party-symbols'] },
  null,
  2
)};
`;

fs.writeFileSync(path.join(WEB_ROOT, 'js/data/asset-map.js'), generated);

console.log('');
for (const r of report) {
  console.log('  ' + r.group + ': ' + r.matched + '/' + r.total + ' ids have a picture' +
    (r.spare ? ' (' + r.spare + ' file(s) spare)' : ''));
  for (const id of Object.keys(r.pairs)) {
    console.log('      ' + id + '  ->  ' + r.pairs[id]);
  }
}
console.log('\n  wrote simple/js/data/asset-map.js');
