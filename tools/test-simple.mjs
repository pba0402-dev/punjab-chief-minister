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

/* Every window opened stays on this list. The campaign screen runs a round
   clock and a countdown, so a window left open keeps Node's event loop alive
   and the suite never exits — closing them all at the end is not tidiness, it
   is what makes the process terminate. */
const openWindows = [];

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
  openWindows.push(dom);
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
  qq(d, '.act').find((c) => {
    const n = c.querySelector('.act-name');
    return n && n.textContent === label;
  });

/**
 * Spending money asks first. Click the card, then agree to the dialog —
 * which is what a player does, so the test should do it too.
 */
/** Which menu section an action lives under, so a test can go find it. */
const SECTION_OF = { campaign: 'Campaign', grants: 'Grants', corruption: 'High Risk' };

const playCard = async (d, label) => {
  const action = d.window.CMP.ACTIONS.find((a) => a.label === label);
  if (!action) throw new Error('no action called ' + label);
  const tab = qq(d, '.g-nav-item').find((n) => n.textContent === SECTION_OF[action.menu]);
  if (tab) {
    clickIt(d, tab);
    await settle();
  }
  const card = actionCard(d, label);
  if (!card) throw new Error('no action called ' + label + ' in ' + SECTION_OF[action.menu]);
  clickIt(d, card.querySelector('.act-use'));
  await settle();
  const go = q(d, '.dialog-buttons .btn-primary, .dialog-buttons .btn-danger');
  if (!go) throw new Error('no confirmation dialog appeared for ' + label);
  clickIt(d, go);
  await settle();
};

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
check('   campaign config loaded', !!CMP.CAMPAIGN && CMP.ACTIONS.length === 10,
  CMP.ACTIONS.length + ' actions');
check('   eight campaign actions plus two ways of raising money',
  CMP.actionsByGroup('safe').length === 4 && CMP.actionsByGroup('risky').length === 4 &&
  CMP.actionsByGroup('funding').length === 2);

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

section('2. The game screen');
check('   election screen opens', !!q(dom, '.screen-election'));

/** Open one of the menu sections by its label. */
function openSection(d, label) {
  const tab = qq(d, '.g-nav-item').find((n) => n.textContent === label);
  if (!tab) throw new Error('no section called ' + label);
  clickIt(d, tab);
}

/** A labelled figure inside the money section. */
function moneyLine(d, label) {
  const row = qq(d, '.sum-line').find((n) => {
    const l = n.querySelector('.sum-line-label');
    return l && l.textContent === label;
  });
  return row ? row.querySelector('.sum-line-value').textContent : null;
}

// The point of the redesign: the first screen answers who is winning, not
// how much cash everyone has. The money lives one tap away.
check('   the header names the game', /Chief Minister of Punjab/.test(q(dom, '.g-title').textContent));
check('   and states the stakes once',
  /117 seats · majority 59/.test(q(dom, '.g-subtitle').textContent),
  q(dom, '.g-subtitle').textContent);
check('   the round and clock are shown', !!q(dom, '.round-bar') && !!q(dom, '.round-clock'));

check('   one compact player strip, not four cards', qq(dom, '.g-player').length === 1);
check('   it shows the candidate', /Simran Kaur Gill/.test(q(dom, '.g-player').textContent));
check('   their party', /INC/.test(q(dom, '.g-player-party').textContent));
check('   their cash', /₹5 crore/.test(q(dom, '.g-player-cash').textContent),
  q(dom, '.g-player-cash').textContent);
check('   and their seats', /seats?$/.test(q(dom, '.g-player-seats').textContent.trim()));
check('   no large stat cards remain', qq(dom, '.stat').length === 0);

check('   a compact section menu is offered', qq(dom, '.g-nav-item').length === 7,
  qq(dom, '.g-nav-item').length + ' items');
check('   campaign is the section it opens on',
  q(dom, '.g-nav-item.is-active').textContent === 'Campaign');

check('6. the leaderboard is the centrepiece', /Who’s leading\?/i.test(text(dom)));
check('   it ranks all four candidates', qq(dom, '.lb-row').length === 4);
check('   each with a portrait', qq(dom, '.lb .portrait').length === 4);
check('   the leader is marked', !!q(dom, '.lb-row.is-leading'));
check('   and the rest are placed', /2nd/i.test(text(dom)) && /4th/i.test(text(dom)));
check('8. the majority is one line, not a chart',
  qq(dom, '.g-majority').length === 1 &&
  /of 59|majority of 59/.test(q(dom, '.g-majority-text').textContent),
  q(dom, '.g-majority-text').textContent);

check('9. leading-from lists constituencies by party', qq(dom, '.lf-group').length >= 1);
check('   the seats are named', qq(dom, '.seat-row').length > 0);
check('10. and every one is clickable',
  qq(dom, '.seat-row').every((n) => n.tagName.toLowerCase() === 'button'));
check('   with a way through to all 117',
  !!qq(dom, 'button').find((b) => /View all 117/.test(b.textContent)));

check('   campaign actions are compact rows', qq(dom, '.act').length === 5,
  qq(dom, '.act').length + ' in campaign');
check('   each with a Use button', qq(dom, '.act-use').length === 5);
check('   no long descriptions', qq(dom, '.act-body').every((n) => n.textContent.length < 60));

const shownProbabilities = /\b(35|30|20|15|45|25|40)%\s*(chance|probability)/i.test(text(dom));
check('   exact probabilities are never shown', !shownProbabilities);

/* ------------------------------------------------------- the money tab */

openSection(dom, 'Money');
check('15. money opens on its own',
  moneyLine(dom, 'Cash') === '₹5 crore', 'got ' + moneyLine(dom, 'Cash'));
check('15. spent starts at nothing', moneyLine(dom, 'Spent') === '₹0', moneyLine(dom, 'Spent'));
check('15. debt starts at nothing', moneyLine(dom, 'Debt') === '₹0', moneyLine(dom, 'Debt'));
check('15. political heat is here, and only here',
  /0 \/ 100/.test(moneyLine(dom, 'Political heat') || ''), moneyLine(dom, 'Political heat'));
check('   with a way to borrow',
  !!qq(dom, 'button').find((b) => /Borrow money/.test(b.textContent)));

openSection(dom, 'Campaign');
check('   money is not repeated on the home screen',
  !qq(dom, '.sum-line').length);

/* ---------------------------------------------------------------- spend */

section('3-5. Spending');
let game = dom.window.CMP.app.getGame();
check('   game starts on the full purse', game.budget === 50000000 && game.spent === 0);

const rallyCost = CMP.getAction('rally').cost;
await playCard(dom, 'Public Rally');
game = dom.window.CMP.app.getGame();
check('5. a safe action works', game.spent === rallyCost, 'spent ' + game.spent);
// The outcome arrives as a sheet: it matters for a moment, then the log
// below keeps the record.
check('   an outcome is reported', !!q(dom, '.report-sheet'));
check('   the report explains what happened in words',
  q(dom, '.report-text').textContent.length > 10);
clickIt(dom, q(dom, '.report-sheet .btn-primary'));
await settle();

check('   the player strip shows the money going down',
  q(dom, '.g-player-cash').textContent ===
    dom.window.CMP.ui.money.words(50000000 - rallyCost),
  q(dom, '.g-player-cash').textContent);
check('   the action is logged', qq(dom, '.log-row').length === 1);

openSection(dom, 'Money');
check('3. cash in hand drops',
  moneyLine(dom, 'Cash') === dom.window.CMP.ui.money.words(50000000 - rallyCost),
  moneyLine(dom, 'Cash'));
check('3. spent is displayed',
  moneyLine(dom, 'Spent') === dom.window.CMP.ui.money.words(rallyCost),
  moneyLine(dom, 'Spent'));
openSection(dom, 'Campaign');

const heatBefore = game.heat;
await playCard(dom, 'Underground Deal');
game = dom.window.CMP.app.getGame();
check('6. a risky action works', game.spent === rallyCost + CMP.getAction('deal').cost);
check('8. risky play raises Political Heat', game.heat > heatBefore, 'heat ' + game.heat);
// A report sheet is over the screen after a risky move; clear it first.
if (q(dom, '.report-sheet')) {
  clickIt(dom, q(dom, '.report-sheet .btn-primary'));
  await settle();
}
openSection(dom, 'Money');
check('8. the heat meter reflects it',
  new RegExp(Math.round(game.heat) + ' / 100').test(moneyLine(dom, 'Political heat') || ''),
  moneyLine(dom, 'Political heat'));
check('8. and a bar shows it', !!q(dom, '.g-heat-fill'));
openSection(dom, 'Campaign');

/* ---------------------------------------------------------------- overspend */

section('4. Overspending is impossible');
game = dom.window.CMP.app.getGame();
// Leave exactly enough for the cheapest campaign action and nothing like
// enough for the dearest, so both sides of the rule are exercised. Accepting
// undisclosed funding is free and so is excluded from "cheapest" — it is
// deliberately still available to a campaign with nothing left.
const cheapest = Math.min.apply(
  null,
  CMP.ACTIONS.filter((a) => a.cost > 0).map((a) => a.cost)
);
game.cash = cheapest;
game.spent = game.budget - cheapest;
dom.window.CMP.storage.save(game);
dom.window.CMP.app.goTo('election');

const dear = actionCard(dom, 'Last-Minute Push');
check('4. an unaffordable action is disabled',
  dear.querySelector('.act-use').disabled === true);
check('4. it says Insufficient Budget', /Insufficient Budget/.test(dear.textContent),
  dear.textContent.slice(0, 80));

const spentBefore = dom.window.CMP.app.getGame().spent;
clickIt(dom, dear);
await settle();
check('4. clicking it changes nothing', dom.window.CMP.app.getGame().spent === spentBefore);
check('4. spending never exceeds the budget',
  dom.window.CMP.app.getGame().spent <= dom.window.CMP.app.getGame().budget);

const cheap = actionCard(dom, 'Village Outreach');
check('   the cheapest action is still affordable',
  cheap.querySelector('.act-use').disabled === false,
  'cash ₹' + dom.window.CMP.app.getGame().cash);

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
check('   the panel shows the restored cash',
  q(dom, '.g-player-cash').textContent === dom.window.CMP.ui.money.words(resumed.cash),
  q(dom, '.g-player-cash').textContent);

/* ---------------------------------------------------------------- map */

section('The constituency map');
const mapTab = qq(dom, '.g-nav-item').find((t) => t.textContent === 'Map');
check('a Map section is offered', !!mapTab);
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

// Clicking a seat opens that constituency, which is what a player expects
// from a map — the target follows from it.
const cell = qq(dom, '.map-cell').find((c) => c.dataset.seat === '17');
clickIt(dom, cell);
check('clicking a seat opens that constituency',
  q(dom, '.sd-name') && q(dom, '.sd-name').textContent === 'Amritsar Central',
  q(dom, '.sd-name') ? q(dom, '.sd-name').textContent : 'no detail opened');
check('11. it names the seat and district',
  /AC 17 · Amritsar/.test(q(dom, '.sd-where').textContent), q(dom, '.sd-where').textContent);
check('11. it shows the current leader with a share',
  !!q(dom, '.sd-leader') && /%$/.test(q(dom, '.sd-leader-share').textContent));
check('13. and a bar for every party', qq(dom, '.sd-bar').length >= 4);
check('12. the real sitting MLA is shown separately', !!q(dom, '.sd-mla'));
check('12. and marked as reference only',
  /takes no part in the game/i.test(q(dom, '.sd-mla-note').textContent));
check('   with a way to campaign there',
  !!qq(dom, 'button').find((b) => /Campaign here/.test(b.textContent)));

// Colours must follow the game, not a fixed picture.
clickIt(dom, qq(dom, '.g-nav-item').find((t) => t.textContent === 'Map'));
const seat17 = () => qq(dom, '.map-cell').find((c) => c.dataset.seat === '17');
const before17 = seat17().getAttribute('fill') + '/' + seat17().getAttribute('fill-opacity');
const g17 = dom.window.CMP.app.getGame();
// Hand this seat overwhelmingly to the player and check the map follows.
Object.keys(g17.support[17]).forEach((p2) => { g17.support[17][p2] = p2 === g17.partyId ? 80 : 5; });
dom.window.CMP.app.goTo('election');
clickIt(dom, qq(dom, '.g-nav-item').find((t) => t.textContent === 'Map'));
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

section('20. All 117, searchable');
clickIt(dom, qq(dom, '.g-nav-item').find((t) => t.textContent === 'Constituencies'));
check('20. the full list opens', !!q(dom, '.seat-browser'));
check('20. all 117 are listed', qq(dom, '.seat-row').length === 117,
  qq(dom, '.seat-row').length + ' rows');
check('20. with a search box', !!q(dom, '.seat-search'));
check('20. and a filter per party plus toss-ups', qq(dom, '.seat-filter').length === 6,
  qq(dom, '.seat-filter').length + ' filters');

typeInto(dom, q(dom, '.seat-search'), 'Dera Baba');
check('20. searching narrows the list', qq(dom, '.seat-row').length === 1,
  qq(dom, '.seat-row').length + ' matches');
check('20. and finds the right seat',
  /Dera Baba Nanak/.test(q(dom, '.seat-row-name').textContent),
  q(dom, '.seat-row-name').textContent);

typeInto(dom, q(dom, '.seat-search'), '');
const allRows = qq(dom, '.seat-row').length;
clickIt(dom, qq(dom, '.seat-filter').find((b) => b.textContent === 'Toss-up'));
check('20. filtering to toss-ups shows fewer', qq(dom, '.seat-row').length < allRows,
  qq(dom, '.seat-row').length + ' of ' + allRows);
clickIt(dom, qq(dom, '.seat-filter').find((b) => b.textContent === 'All'));

const pickRow = qq(dom, '.seat-row')[2];
const pickedName = pickRow.querySelector('.seat-row-name').textContent;
clickIt(dom, pickRow);
check('10. a constituency opens when clicked',
  q(dom, '.sd-name') && q(dom, '.sd-name').textContent === pickedName,
  q(dom, '.sd-name') ? q(dom, '.sd-name').textContent : 'nothing opened');

clickIt(dom, qq(dom, 'button').find((b) => /Campaign here/.test(b.textContent)));
await settle();
check('   campaigning there sets the target',
  q(dom, '.g-target-name').textContent === pickedName,
  q(dom, '.g-target-name').textContent + ' vs ' + pickedName);
check('   and returns to the campaign section',
  q(dom, '.g-nav-item.is-active').textContent === 'Campaign');

/* ------------------------------------------------------------ rounds */

section('Fifteen rounds, solo');

dom = await openPage();
clickIt(dom, modeCard(dom, 'PLAY SOLO'));
clickIt(dom, qq(dom, '.party-card')[0]);
typeInto(dom, qq(dom, '.field-input')[0], 'Round Runner');
typeInto(dom, qq(dom, '.field-input')[1], 'One round at a time');
clickIt(dom, dom.window.document.querySelector('.btn-xl'));
await settle();

check('the round bar is shown', !!q(dom, '.round-bar'));
check('it opens on round 1 of 15', /Round\s*1\s*of\s*15/.test(q(dom, '.round-bar').textContent),
  q(dom, '.round-bar').textContent.slice(0, 40));
check('a countdown is running', /^\d+:\d\d$/.test(q(dom, '.round-clock').textContent),
  q(dom, '.round-clock').textContent);
check('the leaderboard is shown', qq(dom, '.lb-row').length === 4);
check('and how many more seats are needed',
  /needs \d+ more|past the majority/.test(q(dom, '.g-majority-text').textContent),
  q(dom, '.g-majority-text').textContent.slice(0, 60));

/**
 * Run a round out and let the shell pick it up. A round now has two stages:
 * the clock expires and the round settles into the results break, then the
 * break expires and the next round opens. This drives both.
 */
async function settleRound(d) {
  d.window.CMP.app.getGame().roundEndsAt = Date.now() - 1000;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 60));
    if (d.window.CMP.app.getScreen() === 'result') return;
    if (d.window.CMP.app.getGame().stage === 'results') return;
  }
}

async function endRound(d) {
  await settleRound(d);
  const g = d.window.CMP.app.getGame();
  if (d.window.CMP.app.getScreen() === 'result') return;
  g.nextRoundAt = Date.now() - 1000;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 60));
    if (d.window.CMP.app.getScreen() === 'result') return;
    if (d.window.CMP.app.getGame().stage === 'playing') return;
  }
}

let solo = dom.window.CMP.app.getGame();
await playCard(dom, 'Public Rally');
const spentInRound1 = dom.window.CMP.app.getGame().spent;

/* The clock expires: the round settles and the scoreboard goes up. */
await settleRound(dom);
solo = dom.window.CMP.app.getGame();
check('the clock running out settles the round', solo.stage === 'results', solo.stage);
check('the scoreboard appears', !!q(dom, '.round-results'));
check('it ranks all four candidates', qq(dom, '.board-row').length === 4,
  qq(dom, '.board-row').length + ' rows');
check('every candidate has a drawn portrait', qq(dom, '.board-row .portrait').length === 4);
check('play is locked while the round is counted',
  !q(dom, '.action-card') && !q(dom, '.panel-tab'));
check('a seat-change section is shown', /Seats changed/.test(q(dom, '.round-results').textContent));
check('the leader position is stated',
  /more seats? needed|Majority reached/.test(q(dom, '.position').textContent),
  q(dom, '.position').textContent.slice(0, 60));

/* The break expires: the next round opens. */
solo.nextRoundAt = Date.now() - 1000;
for (let i = 0; i < 40 && dom.window.CMP.app.getGame().stage !== 'playing'; i++) {
  await new Promise((r) => setTimeout(r, 60));
}
solo = dom.window.CMP.app.getGame();
check('the break ending opens the next round', solo.round === 2, 'round ' + solo.round);
check('play is possible again', !!q(dom, '.act'));
check('the campaign log kept the round it happened in',
  solo.actions[0].round === 1, String(solo.actions[0].round));
check('a summary card appears', !!q(dom, '.summary-card'));
check('it says which round finished', /Round 1 complete/.test(q(dom, '.summary-card').textContent));
check('it reports the money spent this round',
  new RegExp(dom.window.CMP.ui.money.words(spentInRound1)).test(q(dom, '.summary-card').textContent),
  q(dom, '.summary-card').textContent.slice(0, 120));
check('history recorded the finished round', solo.history.length === 1);

clickIt(dom, q(dom, '.summary-close'));
check('the summary can be dismissed', !q(dom, '.summary-card'));

/* 17. Borrowing, through the interface. */
clickIt(dom, qq(dom, '.g-nav-item').find((t) => t.textContent === 'Loan'));
await settle();
check('17. a loan section is offered', !!q(dom, '.loan-offers'));
check('17. the interest is stated', /20%/.test(q(dom, '.sum-lines').textContent));
check('17. and when it falls due',
  /2 rounds later/.test(q(dom, '.sum-lines').textContent));
check('17. a few amounts are offered, not every increment',
  qq(dom, '.loan-offer').length >= 3 && qq(dom, '.loan-offer').length <= 5,
  qq(dom, '.loan-offer').length + ' offers');
check('17. each shows the repayment before it is taken',
  qq(dom, '.loan-offer').every((n) => /repay .* · round \d+/.test(n.textContent)),
  q(dom, '.loan-offer').textContent);

const cashBeforeBorrowing = dom.window.CMP.app.getGame().cash;
clickIt(dom, qq(dom, '.loan-offer')[0]);
await settle();
check('borrowing asks for confirmation', !!q(dom, '.dialog'));
check('the confirmation states the repayment',
  /You repay/.test(q(dom, '.dialog').textContent));
clickIt(dom, q(dom, '.dialog-buttons .btn-primary'));
await settle();

check('15. the money section separates where it came from',
  (function () {
    clickIt(dom, qq(dom, '.g-nav-item').find((t) => t.textContent === 'Money'));
    clickIt(dom, qq(dom, 'button').find((b) => /Where it came from/.test(b.textContent)));
    const ok = !!q(dom, '.breakdown') && /Starting budget/.test(q(dom, '.breakdown').textContent);
    const close = qq(dom, '.sheet button').find((b) => b.textContent === 'Close');
    if (close) clickIt(dom, close);
    return ok;
  })());

solo = dom.window.CMP.app.getGame();
check('the loan is granted', solo.loans.length === 1);
check('cash rose by the amount borrowed',
  solo.cash === cashBeforeBorrowing + solo.loans[0].amount, String(solo.cash));
check('and the debt is tracked apart from it',
  dom.window.CMP.campaign.debtOf(solo) === solo.loans[0].repay);
check('the player strip flags the debt', !!q(dom, '.g-player-debt'),
  q(dom, '.g-player-debt') ? q(dom, '.g-player-debt').textContent : 'no debt shown');

/* Run out the rest of the campaign. */
let rounds = 0;
while (dom.window.CMP.app.getScreen() === 'election' && rounds++ < 20) {
  await endRound(dom);
}

check('the campaign ends after fifteen rounds', rounds <= 15, String(rounds));
check('the result screen opens on its own', dom.window.CMP.app.getScreen() === 'result');
check('the loan was settled during the campaign',
  dom.window.CMP.app.getGame().loans.every((l) => l.settled));
check('cash never went negative', dom.window.CMP.app.getGame().cash >= 0,
  String(dom.window.CMP.app.getGame().cash));
check('all fifteen rounds are in the history',
  dom.window.CMP.app.getGame().history.length === 15,
  String(dom.window.CMP.app.getGame().history.length));

/* The count. */
check('the count runs seat by seat', !!q(dom, '.count-live'));
const skipBtn = qq(dom, 'button').find((b) => /Show the result/.test(b.textContent));
if (skipBtn) clickIt(dom, skipBtn);
await settle();
check('the full result follows', !!q(dom, '.result-rows'));
const soloTotal = qq(dom, '.result-row .result-seats')
  .reduce((t, n) => t + Number(n.textContent.trim()), 0);
check('all 117 seats are declared', soloTotal === 117, String(soloTotal));

/* ---------------------------------------------------------------- console */

section('12. Console');
const realErrors = consoleErrors.filter((e) => !/Could not parse CSS|Not implemented/.test(e));
check('12. no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

openWindows.forEach((d) => {
  try {
    d.window.close();
  } catch (e) {
    /* already closed */
  }
});
server.close();

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
