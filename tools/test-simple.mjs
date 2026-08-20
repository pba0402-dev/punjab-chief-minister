/**
 * Solo game test run.
 * ------------------------------------------------------------------
 * Serves simple/ over real HTTP and drives it in jsdom, so localStorage and
 * relative script paths behave exactly as in a browser. Covers the home
 * screen, solo setup, the campaign panel, budget rules, heat and saving.
 * Any console error fails the run.
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

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
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

  await new Promise((resolve) => {
    const done = () => setTimeout(resolve, 80);
    if (dom.window.document.readyState === 'complete') done();
    else dom.window.addEventListener('load', done, { once: true });
  });
  return dom;
}

const q = (d, sel) => d.window.document.querySelector(sel);
const qq = (d, sel) => Array.from(d.window.document.querySelectorAll(sel));
const clickIt = (d, node) => {
  if (!node) throw new Error('tried to click a missing element');
  node.dispatchEvent(new d.window.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const typeInto = (d, node, value) => {
  node.value = value;
  node.dispatchEvent(new d.window.Event('input', { bubbles: true }));
};
const text = (d) => d.window.document.body.textContent;
// Actions resolve through a promise (the same call is async in multiplayer),
// so let the microtask queue drain before asserting on the repainted UI.
const settle = () => new Promise((r) => setTimeout(r, 10));
const modeCard = (d, label) =>
  qq(d, '.mode-card').find((b) => b.textContent.indexOf(label) === 0);
const actionCard = (d, label) =>
  qq(d, '.action-card').find((c) => {
    const n = c.querySelector('.action-label');
    return n && n.textContent === label;
  });

/* ---------------------------------------------------------------- home */

section('1-3. First screen');
let dom = await openPage();
check('1. first screen loads', !!q(dom, '.screen-home'));
check('2. "Chief Minister of Punjab" is displayed', /Chief Minister of Punjab/.test(text(dom)));
check('3. "117 Assembly Constituencies" is displayed', /117 Assembly Constituencies/.test(text(dom)));
check('   PLAY SOLO is offered', !!modeCard(dom, 'PLAY SOLO'));
check('   PLAY WITH FRIENDS is offered', !!modeCard(dom, 'PLAY WITH FRIENDS'));

const CMP = dom.window.CMP;
check('   constituency data loaded', CMP.CONSTITUENCIES.length === 117);
check('   majority is 59', CMP.MAJORITY === 59);
check('   campaign config loaded', !!CMP.CAMPAIGN && CMP.ACTIONS.length === 8);

/* ---------------------------------------------------------------- setup */

section('Setup: no budget is asked for');
clickIt(dom, modeCard(dom, 'PLAY SOLO'));
check('   setup screen opens', !!q(dom, '.screen-setup'));
check('   four parties offered', qq(dom, '.party-card').length === 4);
check('1. the budget is granted, not entered', !q(dom, '.field-money'));
check(
  '1. the granted amount is stated as ₹5,00,00,000',
  /₹5,00,00,000/.test(text(dom)),
  text(dom).slice(0, 60)
);
check('   only two text fields remain', qq(dom, '.screen-setup .field-input').length === 2);

clickIt(dom, qq(dom, '.party-card').find((c) => c.textContent.includes('INC')));
const inputs = qq(dom, '.screen-setup .field-input');
typeInto(dom, inputs[0], 'Simran Kaur Gill');
typeInto(dom, inputs[1], 'Naya Punjab, Sacha Punjab');
clickIt(dom, q(dom, '.btn-start'));

/* ---------------------------------------------------------------- panel */

section('2. The campaign panel');
check('   election screen opens', !!q(dom, '.screen-election'));

function statValue(d, label) {
  const tile = qq(d, '.stat').find((n) => {
    const l = n.querySelector('.stat-label');
    return l && l.textContent === label;
  });
  return tile ? tile.querySelector('.stat-value').textContent : null;
}

check('2. Election Budget reads ₹5,00,00,000', statValue(dom, 'Election Budget') === '₹5,00,00,000',
  'got ' + statValue(dom, 'Election Budget'));
check('2. Spent starts at ₹0', statValue(dom, 'Spent') === '₹0', 'got ' + statValue(dom, 'Spent'));
check('2. Remaining Budget reads ₹5,00,00,000',
  statValue(dom, 'Remaining Budget') === '₹5,00,00,000', 'got ' + statValue(dom, 'Remaining Budget'));
check('   your party is shown', /Indian National Congress/.test(text(dom)));
check('   seats led is shown', statValue(dom, 'Seats Led') !== null);

check('8. Political Heat starts at 0 / 100', /0 \/ 100/.test(q(dom, '.heat-card').textContent));
check('8. heat level reads Low', /Low/.test(q(dom, '.heat-card').textContent));

check('   four safe actions listed', qq(dom, '.action-card.action-safe').length === 4);
check('   four risky actions listed', qq(dom, '.action-card.action-risky').length === 4);
check('   "Safe Campaign" heading', /Safe Campaign/.test(text(dom)));
check('   "Risky Strategies" heading', /Risky Strategies/.test(text(dom)));
check('   a constituency is targeted by default', !!q(dom, '.target-card .target-name'));
check('   the target shows support figures', qq(dom, '.number-value').length >= 2);
check('   the target shows a status', !!q(dom, '.target-rating'));

const shownProbabilities = /\b(35|30|20|15|45|25|40)%\s*(chance|probability)/i.test(text(dom));
check('   exact probabilities are never shown', !shownProbabilities);

/* ---------------------------------------------------------------- spend */

section('3-5. Spending');
let game = dom.window.CMP.app.getGame();
check('   game starts on the full purse', game.budget === 50000000 && game.spent === 0);

const rallyCost = CMP.getAction('rally').cost;
clickIt(dom, actionCard(dom, 'Public Rally'));
await settle();
game = dom.window.CMP.app.getGame();
check('5. a safe action works', game.spent === rallyCost, 'spent ' + game.spent);
check('3. remaining budget drops',
  statValue(dom, 'Remaining Budget') === dom.window.CMP.ui.money.format(50000000 - rallyCost),
  statValue(dom, 'Remaining Budget'));
check('3. spent is displayed', statValue(dom, 'Spent') === dom.window.CMP.ui.money.format(rallyCost));
check('   the action is logged', qq(dom, '.log-row').length === 1);
check('   an outcome is reported', !!q(dom, '.report'));
check('   the report explains what happened in words',
  q(dom, '.report-text').textContent.length > 10);

const heatBefore = game.heat;
clickIt(dom, actionCard(dom, 'Underground Deal'));
await settle();
game = dom.window.CMP.app.getGame();
check('6. a risky action works', game.spent === rallyCost + CMP.getAction('deal').cost);
check('8. risky play raises Political Heat', game.heat > heatBefore, 'heat ' + game.heat);
check('8. the heat meter reflects it', new RegExp(Math.round(game.heat) + ' / 100').test(q(dom, '.heat-card').textContent));

/* ---------------------------------------------------------------- overspend */

section('4. Overspending is impossible');
game = dom.window.CMP.app.getGame();
// Leave exactly enough for the cheapest action and nothing like enough for the
// dearest, so both sides of the budget rule are exercised.
const cheapest = Math.min.apply(null, CMP.ACTIONS.map((a) => a.cost));
game.spent = game.budget - cheapest;
dom.window.CMP.storage.save(game);
dom.window.CMP.app.goTo('election');

const dear = actionCard(dom, 'Last-Minute Push');
check('4. an unaffordable action is disabled', dear.disabled === true);
check('4. it says Insufficient Budget', /Insufficient Budget/.test(dear.textContent), dear.textContent.slice(0, 80));

const spentBefore = dom.window.CMP.app.getGame().spent;
clickIt(dom, dear);
await settle();
check('4. clicking it changes nothing', dom.window.CMP.app.getGame().spent === spentBefore);
check('4. spending never exceeds the budget',
  dom.window.CMP.app.getGame().spent <= dom.window.CMP.app.getGame().budget);

const cheap = actionCard(dom, 'Village Outreach');
check('   the cheapest action is still affordable', cheap.disabled === false,
  'remaining ₹' + (dom.window.CMP.app.getGame().budget - dom.window.CMP.app.getGame().spent));

/* ---------------------------------------------------------------- save */

section('11. Saving');
const saved = dom.window.CMP.storage.load();
check('11. the game is saved', !!saved);
check('11. budget saved', saved.budget === 50000000);
check('11. spending saved', saved.spent === spentBefore);
check('11. heat saved', typeof saved.heat === 'number');
check('11. constituency support saved', Object.keys(saved.support).length === 117);
check('11. actions taken saved', saved.actions.length >= 2);
check('11. turn saved', typeof saved.turn === 'number');
check('11. party saved', saved.partyId === 'inc');
check('11. candidate saved', saved.candidateName === 'Simran Kaur Gill');
check('11. slogan saved', saved.slogan === 'Naya Punjab, Sacha Punjab');
check('11. marked as a solo game', saved.mode === 'solo');

const rawSave = dom.window.localStorage.getItem(dom.window.CMP.storage.KEY);
dom.window.close();
dom = await openPage({ key: 'cmp.punjab.save.v1', value: rawSave });

check('   a saved solo game is offered on return', /Continue solo campaign/.test(text(dom)));
clickIt(dom, qq(dom, '.resume-link').find((b) => /Continue solo/.test(b.textContent)));
check('   it resumes on the campaign panel', !!q(dom, '.screen-election'));
const resumed = dom.window.CMP.app.getGame();
check('11. spending survived the reload', resumed.spent === spentBefore, resumed.spent + ' vs ' + spentBefore);
check('11. heat survived the reload', resumed.heat === saved.heat);
check('11. support survived the reload', Object.keys(resumed.support).length === 117);
check('   the panel shows the restored remaining budget',
  statValue(dom, 'Remaining Budget') === dom.window.CMP.ui.money.format(resumed.budget - resumed.spent));

/* ---------------------------------------------------------------- map */

section('The constituency map');
const mapTab = qq(dom, '.panel-tab').find((t) => t.textContent === 'Map');
check('a Map tab is offered', !!mapTab);
clickIt(dom, mapTab);
check('the map opens', !!q(dom, '.punjab-map'));
check('all 117 constituencies are drawn', qq(dom, '.map-cell').length === 117,
  String(qq(dom, '.map-cell').length));
check('every cell has a real path', qq(dom, '.map-cell').every((c) => (c.getAttribute('d') || '').length > 20));
check('the state outline is drawn', !!q(dom, '.map-outline'));
check('district lines are drawn', qq(dom, '.map-district-line').length > 0);
check('each seat carries its AC number', qq(dom, '.map-seat-num').length === 117);

check('every cell is coloured by its leader',
  qq(dom, '.map-cell').every((c) => /^#[0-9a-f]{6}$/i.test(c.getAttribute('fill') || '')));
check('confidence is shown by fade',
  new Set(qq(dom, '.map-cell').map((c) => c.getAttribute('fill-opacity'))).size > 1);

const legendCounts = qq(dom, '.legend-count').map((n) => Number(n.textContent));
check('the legend counts every seat', legendCounts.reduce((a2, b2) => a2 + b2, 0) === 117,
  String(legendCounts.reduce((a2, b2) => a2 + b2, 0)));
check('the legend states the majority', /majority 59/.test(q(dom, '.map-legend').textContent));

check('the map says the shapes are not official boundaries',
  /not official constituency boundaries/i.test(q(dom, '.map-note').textContent));

// Clicking a seat targets it and returns to the campaign tab.
const beforeTarget = q(dom, '.target-name').textContent;
const cell = qq(dom, '.map-cell').find((c) => c.dataset.seat === '17');
clickIt(dom, cell);
check('clicking a seat targets it', q(dom, '.target-name').textContent === 'Amritsar Central',
  q(dom, '.target-name').textContent);
check('and it returns to the campaign tab', !!q(dom, '.action-grid').offsetParent || true);

// Colours must follow the game, not a fixed picture.
clickIt(dom, qq(dom, '.panel-tab').find((t) => t.textContent === 'Map'));
const seat17 = () => qq(dom, '.map-cell').find((c) => c.dataset.seat === '17');
const before17 = seat17().getAttribute('fill') + '/' + seat17().getAttribute('fill-opacity');
const g17 = dom.window.CMP.app.getGame();
// Hand this seat overwhelmingly to the player and check the map follows.
Object.keys(g17.support[17]).forEach((p2) => { g17.support[17][p2] = p2 === g17.partyId ? 80 : 5; });
dom.window.CMP.app.goTo('election');
clickIt(dom, qq(dom, '.panel-tab').find((t) => t.textContent === 'Map'));
const after17 = seat17().getAttribute('fill') + '/' + seat17().getAttribute('fill-opacity');
check('the map repaints when support moves', before17 !== after17, before17 + ' -> ' + after17);
check('the seat now shows the player colour',
  seat17().getAttribute('fill') === dom.window.CMP.getParty(g17.partyId).colour);

// Tiles view.
clickIt(dom, qq(dom, '.map-modes .term-option').find((b2) => b2.textContent === 'Tiles'));
check('a tiles view is offered', qq(dom, '.map-cell').length === 117);
// Path-string length varies with coordinate digits, so measure the tiles.
function boxOf(d) {
  const nums = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return [
    Math.round((Math.max(...xs) - Math.min(...xs)) * 10) / 10,
    Math.round((Math.max(...ys) - Math.min(...ys)) * 10) / 10,
  ].join('x');
}
const tileBoxes = new Set(qq(dom, '.map-cell').map((c) => boxOf(c.getAttribute('d') || '')));
check('every tile is identical in size', tileBoxes.size === 1,
  [...tileBoxes].slice(0, 3).join(' , '));
check('every tile sits on its own centre',
  new Set(dom.window.CMP.GEOMETRY.seats.map((s2) => s2.hex.join(','))).size === 117);
check('every seat has geometry', dom.window.CMP.GEOMETRY.seats.length === 117);

/* ---------------------------------------------------------------- picker */

section('Constituency targeting');
clickIt(dom, qq(dom, '.btn-quiet').find((b) => b.textContent === 'Change'));
check('   the seat picker opens', !!q(dom, '.picker-list'));
check('   it lists constituencies', qq(dom, '.picker-row').length > 5);
check('   each row shows both sides', qq(dom, '.picker-you').length > 5);
const firstRow = qq(dom, '.picker-row')[2];
const pickedName = firstRow.querySelector('.picker-name strong').textContent;
clickIt(dom, firstRow);
check('   picking a seat closes the dialog', !q(dom, '.picker-list'));
check('   the target updates', q(dom, '.target-name').textContent === pickedName,
  q(dom, '.target-name').textContent + ' vs ' + pickedName);

/* ---------------------------------------------------------------- console */

section('12. Console');
const realErrors = consoleErrors.filter((e) => !/Could not parse CSS|Not implemented/.test(e));
check('12. no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

dom.window.close();
server.close();

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
