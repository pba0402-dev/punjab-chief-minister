/**
 * Version 1 test run.
 * ------------------------------------------------------------------
 * Serves simple/ over real HTTP and drives it in jsdom, so localStorage and
 * relative script paths behave exactly as they do in a browser. Walks the
 * fourteen checks from the brief. Any console error fails the run.
 *
 *   node tools/test-simple.mjs
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'simple');

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

/* ---------------------------------------------------------------- server */

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port + '/';

/* ---------------------------------------------------------------- helpers */

const consoleErrors = [];

async function openPage(seedStorage) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => consoleErrors.push('jsdomError: ' + e.message));
  vc.on('error', (...a) => consoleErrors.push('console.error: ' + a.join(' ')));

  const dom = await JSDOM.fromURL(BASE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (seedStorage) {
        try {
          window.localStorage.setItem(seedStorage.key, seedStorage.value);
        } catch (e) {
          /* ignore */
        }
      }
      window.addEventListener('error', (e) => consoleErrors.push('window.error: ' + e.message));
    },
  });

  // Wait for scripts to load and the app to mount.
  await new Promise((resolve) => {
    const done = () => setTimeout(resolve, 60);
    if (dom.window.document.readyState === 'complete') done();
    else dom.window.addEventListener('load', done, { once: true });
  });
  return dom;
}

const q = (d, sel) => d.window.document.querySelector(sel);
const qq = (d, sel) => Array.from(d.window.document.querySelectorAll(sel));
const clickIt = (d, node) =>
  node.dispatchEvent(new d.window.MouseEvent('click', { bubbles: true, cancelable: true }));
const typeInto = (d, node, value) => {
  node.value = value;
  node.dispatchEvent(new d.window.Event('input', { bubbles: true }));
};
const text = (d) => d.window.document.body.textContent;

/* ---------------------------------------------------------------- 1-3 */

section('1-3. First screen');
let dom = await openPage();
check('1. first screen loads', !!q(dom, '.screen-home'));
check('2. "Chief Minister of Punjab" is displayed', /Chief Minister of Punjab/.test(text(dom)));
check('3. "117 Assembly Constituencies" is displayed', /117 Assembly Constituencies/.test(text(dom)));
check('   PLAY SOLO is offered', /PLAY SOLO/.test(text(dom)));
check('   PLAY WITH FRIENDS is offered', /PLAY WITH FRIENDS/.test(text(dom)));
check('   "Choose How to Play" is shown', /Choose How to Play/.test(text(dom)));
check('   nothing to resume yet', !/Continue solo campaign/.test(text(dom)));

check('   constituency data loaded', dom.window.CMP.CONSTITUENCIES.length === 117);
check('   majority computed as 59', dom.window.CMP.MAJORITY === 59);
check('   23 districts', dom.window.CMP.DISTRICTS.length === 23);
check(
  '   constituency numbers run 1..117',
  dom.window.CMP.CONSTITUENCIES.every((c, i) => c.number === i + 1)
);
check(
  '   every constituency has a name and district',
  dom.window.CMP.CONSTITUENCIES.every((c) => c.name && c.district)
);

/* ---------------------------------------------------------------- 4-7 */

section('4-7. Setup form');
clickIt(dom, qq(dom, '.mode-card').find((b) => b.textContent.indexOf('PLAY SOLO') === 0));
check('   setup screen opens', !!q(dom, '.screen-setup'));

const partyCards = qq(dom, '.party-card');
check('4. four parties offered', partyCards.length === 4, 'got ' + partyCards.length);
const partyLabels = partyCards.map((c) => c.querySelector('.party-short').textContent);
check(
  '4. AAP, INC, BJP and SAD are the four',
  ['AAP', 'INC', 'BJP', 'SAD'].every((p) => partyLabels.includes(p)),
  partyLabels.join(', ')
);

clickIt(dom, partyCards.find((c) => c.textContent.includes('INC')));
check('4. a party can be selected', qq(dom, '.party-card.is-selected').length === 1);
check(
  '4. the selected party is the one clicked',
  q(dom, '.party-card.is-selected .party-short').textContent === 'INC'
);

const inputs = qq(dom, '.field-input');
const nameInput = inputs[0];
const sloganInput = inputs[1];
const budgetInput = q(dom, '.field-money');

typeInto(dom, nameInput, 'Simran Kaur Gill');
check('5. candidate name can be entered', nameInput.value === 'Simran Kaur Gill');

typeInto(dom, sloganInput, 'Naya Punjab, Sacha Punjab');
check('6. slogan can be entered', sloganInput.value === 'Naya Punjab, Sacha Punjab');

typeInto(dom, budgetInput, '100000000');
check('7. budget can be entered', budgetInput.value.length > 0, 'value ' + budgetInput.value);
check(
  '7. budget formats in Indian grouping',
  budgetInput.value === '₹10,00,00,000',
  'got ' + budgetInput.value
);

/* validation guard */
const before = dom.window.CMP.storage.load();
check('   nothing saved before START ELECTION', before === null);

/* ---------------------------------------------------------------- 8-9 */

section('8-9. Start and save');
clickIt(dom, q(dom, '.btn-start'));
check('8. START ELECTION moves to the election screen', !!q(dom, '.screen-election'));
check('8. election screen names the election', /Punjab Assembly Election/.test(text(dom)));
check('8. 117 constituencies shown in the header', /117 Constituencies/.test(text(dom)));
check('8. all 117 constituency tiles rendered', qq(dom, '.seat').length === 117);
check('8. districts rendered', qq(dom, '.district').length === 23);

const shown = text(dom);
check('8. selected party shown', /Indian National Congress/.test(shown));
check('8. candidate name shown', /Simran Kaur Gill/.test(shown));
check('8. slogan shown', /Naya Punjab, Sacha Punjab/.test(shown));
check('8. budget shown', /₹10,00,00,000/.test(shown));
// Read the stat tiles by their label rather than scanning concatenated text.
function statValue(d, label) {
  const tile = qq(d, '.stat').find((n) => n.querySelector('.stat-label').textContent === label);
  return tile ? tile.querySelector('.stat-value').textContent : null;
}
check('8. seats won shown as 0', statValue(dom, 'Seats Won') === '0', 'got ' + statValue(dom, 'Seats Won'));
check(
  '8. majority required shown as 59',
  statValue(dom, 'Majority Required') === '59',
  'got ' + statValue(dom, 'Majority Required')
);
check(
  '8. budget tile shows the budget',
  statValue(dom, 'Election Budget') === '₹10,00,00,000',
  'got ' + statValue(dom, 'Election Budget')
);

const saved = dom.window.CMP.storage.load();
check('9. game state is saved', !!saved);
check('9. saved party', saved.partyId === 'inc');
check('9. saved candidate name', saved.candidateName === 'Simran Kaur Gill');
check('9. saved slogan', saved.slogan === 'Naya Punjab, Sacha Punjab');
check('9. saved budget', saved.budget === 100000000, 'got ' + saved.budget);
check('9. saved seats won', saved.seatsWon === 0);
check('9. saved constituency container exists', !!saved.constituencies);
check('9. storage backend is localStorage', dom.window.CMP.storage.backendName() === 'localStorage');

const rawSave = dom.window.localStorage.getItem(dom.window.CMP.storage.KEY);
check('9. save is written to localStorage', !!rawSave && rawSave.length > 0);

/* ---------------------------------------------------------------- 10-11 */

section('10-11. Refresh and continue');
dom.window.close();
dom = await openPage({ key: 'cmp.punjab.save.v1', value: rawSave });

check('10. saved game survives a reload', !!dom.window.CMP.storage.load());
check('11. a way to continue is offered', /Continue solo campaign/.test(text(dom)));
check('11. PLAY SOLO is still offered', /PLAY SOLO/.test(text(dom)));

clickIt(dom, qq(dom, '.resume-link').find((b) => /Continue solo/.test(b.textContent)));
check('11. continue returns to the election screen', !!q(dom, '.screen-election'));
const resumed = text(dom);
check('10. candidate name survived', /Simran Kaur Gill/.test(resumed));
check('10. slogan survived', /Naya Punjab, Sacha Punjab/.test(resumed));
check('10. budget survived', /₹10,00,00,000/.test(resumed));
check('10. party survived', /Indian National Congress/.test(resumed));

/* ---------------------------------------------------------------- 12 */

section('12. Starting again replaces the old save');
clickIt(dom, qq(dom, 'button').find((b) => b.textContent === 'Menu'));
check('   menu returns home', !!q(dom, '.screen-home'));

clickIt(dom, qq(dom, '.mode-card').find((b) => b.textContent.indexOf('PLAY SOLO') === 0));
check('12. PLAY SOLO opens a fresh setup screen', !!q(dom, '.screen-setup'));
check('12. no party pre-selected', qq(dom, '.party-card.is-selected').length === 0);
check('12. the old save is still there until a new one starts', !!dom.window.CMP.storage.load());

clickIt(dom, qq(dom, '.party-card').find((c) => c.textContent.includes('BJP')));
const fresh = qq(dom, '.field-input');
typeInto(dom, fresh[0], 'Gurpreet Singh Mann');
typeInto(dom, fresh[1], 'Badlaav');
typeInto(dom, q(dom, '.field-money'), '50000000');
clickIt(dom, q(dom, '.btn-start'));

const replaced = dom.window.CMP.storage.load();
check('12. the new campaign replaces the old save', replaced.candidateName === 'Gurpreet Singh Mann');
check('12. the old party is gone', replaced.partyId === 'bjp');
check('12. only one save is kept', replaced.budget === 50000000);

/* ---------------------------------------------------------------- validation */

section('Validation');
// Get back to a fresh setup form first — check 12 left us on the election screen.
clickIt(dom, qq(dom, 'button').find((b) => b.textContent === 'Menu'));
clickIt(dom, qq(dom, '.mode-card').find((b) => b.textContent.indexOf('PLAY SOLO') === 0));
const savedBefore = JSON.stringify(dom.window.CMP.storage.load());

clickIt(dom, q(dom, '.btn-start'));
check('   an empty form is refused', !!q(dom, '.screen-setup'), 'should not have advanced');
check('   errors are shown on the empty fields', qq(dom, '.field-error').length >= 3);
check(
  '   a refused start does not touch the existing save',
  JSON.stringify(dom.window.CMP.storage.load()) === savedBefore
);

/* ---------------------------------------------------------------- 13 */

section('13. Console');
const realErrors = consoleErrors.filter((e) => !/Could not parse CSS|Not implemented/.test(e));
check('13. no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

dom.window.close();
server.close();

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
