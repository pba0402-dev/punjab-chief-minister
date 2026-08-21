/**
 * Analytics: counted, private, and closed by default.
 * ------------------------------------------------------------------
 * Three things worth failing a build over. The counts have to be right, the
 * dashboard has to be shut unless somebody deliberately opened it, and no
 * address, agent string or profile id may ever appear in what is stored.
 *
 *   node tools/test-analytics.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const APP = path.join(ROOT, 'simple');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}
const section = (t) => console.log('\n' + t);

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-analytics-'));
const PORT = 8823;

const php = spawn('php', ['-S', '127.0.0.1:' + PORT, '-t', APP], {
  env: { ...process.env, CMP_DATA_DIR: DATA },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 900));

function api(action, payload, method) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: '/api/index.php?action=' + action,
        method: method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'analytics-suite',
        },
      },
      (res) => {
        let out = '';
        res.on('data', (d) => (out += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(out));
          } catch (e) {
            reject(new Error(out.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

/* --------------------------------------------------------------- closed */

section('The dashboard is shut until somebody opens it');

const noKey = await api('analytics', {}, 'GET');
check('a fresh install refuses analytics outright', noKey.ok === false, JSON.stringify(noKey));
check('and does not say why', /not enabled/i.test(noKey.error || ''), noKey.error);

/* -------------------------------------------------------------- counting */

section('Events are counted');

await api('track', { event: 'landing_page_view' });
await api('track', { event: 'landing_page_view' });
await api('track', { event: 'game_setup_started' });
await api('track', { event: 'game_created', party: 'aap' });
await api('track', { event: 'game_started', party: 'aap' });
await api('track', { event: 'game_completed', seconds: 600 });

// Not one of the known events, so it must be discarded rather than stored.
await api('track', { event: 'drop_tables' });

const key = 'k'.repeat(40);
fs.writeFileSync(path.join(DATA, 'admin.key'), key);

const seen = await api('analytics', { key }, 'GET');
check('with a key, the dashboard opens', seen.ok === true, JSON.stringify(seen).slice(0, 120));

const today = seen.today;
check('two visits were counted', today.events.landing_page_view === 2,
  String(today.events.landing_page_view));
check('one setup, one creation, one start',
  today.events.game_setup_started === 1 &&
  today.events.game_created === 1 &&
  today.events.game_started === 1);
check('one completion', today.events.game_completed === 1);
check('an unknown event was discarded',
  !JSON.stringify(seen).includes('drop_tables'));
// Two events carried the party: creating the game and starting it.
check('the party chosen was tallied', today.byParty.aap === 2, JSON.stringify(today.byParty));
check('and how long the game took', today.averageGameSeconds === 600,
  String(today.averageGameSeconds));

/* -------------------------------------------------------------- visitors */

section('A refresh is a visit, not a new person');

check('several requests from one machine are one visitor',
  today.uniqueVisitors === 1, String(today.uniqueVisitors));

/* ---------------------------------------------------------------- funnel */

section('The funnel is the point');

const steps = seen.range.funnel.map((f) => f.step);
check('it runs from visiting to finishing',
  steps[0] === 'Visited' && steps[steps.length - 1] === 'Finished', steps.join(' → '));
check('and each step is a real count',
  seen.range.funnel.every((f) => typeof f.count === 'number'));
check('visits are at least as many as completions',
  seen.range.funnel[0].count >= seen.range.funnel[4].count);

/* --------------------------------------------------------------- privacy */

section('Nothing personal is kept');

const files = fs.readdirSync(path.join(DATA, 'analytics'));
const stored = files
  .filter((f) => f.endsWith('.json'))
  .map((f) => fs.readFileSync(path.join(DATA, 'analytics', f), 'utf8'))
  .join('');

check('no addresses are stored', !/127\.0\.0\.1|::1/.test(stored));
check('no user agent is stored', !/analytics-suite/i.test(stored));
check('the store is guarded from the web', files.indexOf('.htaccess') !== -1, files.join(','));
// Short, fixed-length hex and nothing else: not an address, not an id, and
// not long enough to be a fingerprint of anything.
const visitorHashes = (stored.match(/"visitors":\[([^\]]*)\]/) || [])[1] || '';
check('visitors are stored as short daily hashes',
  /^"[0-9a-f]{16}"(,"[0-9a-f]{16}")*$/.test(visitorHashes),
  visitorHashes.slice(0, 60));

const wire = JSON.stringify(seen);
check('and none of it reaches the dashboard either',
  !/127\.0\.0\.1|analytics-suite/.test(wire));

/* ------------------------------------------------------------------ done */

php.kill();
fs.rmSync(DATA, { recursive: true, force: true });

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
