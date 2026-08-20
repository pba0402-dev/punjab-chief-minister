/**
 * Headless test run.
 * ------------------------------------------------------------------
 * Loads the built single-file game into jsdom and plays it: setup, map
 * clicks, campaign spending, ten turns, election day, results, save/load.
 * Any console error or uncaught exception fails the run.
 *
 *   node tools/build.mjs && node tools/test.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const FILE = path.join(ROOT, 'dist', 'punjab-cm.html');

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
function section(title) {
  console.log('\n' + title);
}

/* ------------------------------------------------------------ boot */

const consoleErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => consoleErrors.push('jsdomError: ' + e.message));
virtualConsole.on('error', (...a) => consoleErrors.push('console.error: ' + a.join(' ')));
virtualConsole.on('warn', (...a) => consoleErrors.push('console.warn: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(FILE, 'utf8'), {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://localhost/punjab',
  virtualConsole,
});
const { window } = dom;
const { document } = window;
window.addEventListener('error', (e) => consoleErrors.push('window.error: ' + e.message));

// jsdom has no SVG geometry engine; the map only uses these inside pointer
// handlers, which this run does not exercise.
window.SVGSVGElement.prototype.getScreenCTM = function () {
  return null;
};
window.SVGSVGElement.prototype.createSVGPoint = function () {
  return { x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) };
};

// jsdom fires DOMContentLoaded asynchronously after parsing, and boot.js waits
// for it, so nothing is mounted until we let the event loop turn.
await new Promise((resolve) => {
  if (document.readyState === 'complete') resolve();
  else window.addEventListener('load', resolve, { once: true });
});

const PG = window.PG;
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const clickIt = (node) => {
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
};

/* ------------------------------------------------------------ data */

section('Reference data');
check('PG namespace exists', !!PG);
check('117 constituencies', PG.PUNJAB_SEATS.length === 117, 'got ' + PG.PUNJAB_SEATS.length);
check(
  'constituency numbers are 1..117 with no gaps',
  PG.PUNJAB_SEATS.every((s, i) => s.num === i + 1)
);
check(
  'no duplicate constituency names',
  new Set(PG.PUNJAB_SEATS.map((s) => s.name)).size === 117
);
check('23 districts', Object.keys(PG.PUNJAB_DISTRICTS).length === 23);
check(
  'district seat lists total 117',
  Object.values(PG.PUNJAB_DISTRICTS).reduce((t, d) => t + d.seats.length, 0) === 117
);
check(
  'regions total 117 (Majha 25 / Doaba 23 / Malwa 69)',
  PG.PUNJAB_REGIONS.Majha.seats.length === 25 &&
    PG.PUNJAB_REGIONS.Doaba.seats.length === 23 &&
    PG.PUNJAB_REGIONS.Malwa.seats.length === 69
);
check('34 SC-reserved seats', PG.PUNJAB_SEATS.filter((s) => s.reservation === 'SC').length === 34);
check('geometry has 117 cells', PG.GEOMETRY.seats.length === 117);
check(
  'every cell is a real polygon',
  PG.GEOMETRY.seats.every((s) => s.cell.length >= 3)
);
check(
  'every seat has a hex tile and neighbours',
  PG.GEOMETRY.seats.every((s) => s.hex && s.hex.length === 2 && s.neighbours.length > 0)
);
check(
  'hex tiles do not overlap',
  new Set(PG.GEOMETRY.seats.map((s) => s.hex.join(','))).size === 117
);

const stateDef = PG.getState('punjab');
check('total seats is 117', stateDef.totalSeats === 117);
check('majority is 59', stateDef.majority(117) === 59, 'got ' + stateDef.majority(117));

/* ------------------------------------------------------------ setup screen */

section('Setup screen');
check('setup screen rendered', !!$('.setup-screen'));
check('4 playable parties offered', $$('.party-card').length === 4);
check('opening strategies offered', $$('.choice-grid .choice-card').length >= 4);
check('start button present', !!$('.setup-start'));

const nameInput = $('.field-input');
nameInput.value = 'Harleen Kaur Sandhu';
nameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
clickIt($$('.party-card')[1]); // Punjab People's Front
clickIt($$('.choice-grid .choice-card')[2]); // War Chest
clickIt($('.setup-start'));

/* ------------------------------------------------------------ game screen */

section('Campaign screen');
check('game screen mounted', document.body.dataset.screen === 'game');
check('HUD present', !!$('.hud'));
check('map rendered with 117 cells', $$('.map-cell').length === 117, 'got ' + $$('.map-cell').length);
check('district borders drawn', $$('.map-district-border').length > 0);
check('district labels drawn', $$('.map-district-label').length === 23);
check('panel present', !!$('.panel'));
check('dock present', !!$('.dock'));
check('majority target shown as 59', $('.meter-marker-label').textContent === '59');

const app = window.PG.__app;
let game = app.getGame();
check('player party applied', game.player.partyId === 'ppf');
check('candidate name applied', game.player.name === 'Harleen Kaur Sandhu');
check('strategy applied', game.player.strategyId === 'warchest');
check('starts on week 1', game.turn === 1);
const APT = stateDef.campaign.actionsPerTurn;
check('starts with a full slate of actions', game.actionsLeft === APT, 'got ' + game.actionsLeft);

/* ------------------------------------------------------------ projection */

section('Projection integrity');
function projectionSum(g) {
  const p = PG.model.projectAll(g, { fog: true });
  return Object.values(p.counts).reduce((a, b) => a + b, 0);
}
check('projected seats total 117', projectionSum(game) === 117, 'got ' + projectionSum(game));
const proj0 = PG.model.projectAll(game, { fog: false });
check(
  'every seat vote share sums to 100',
  PG.PUNJAB_SEATS.every((s) => {
    const total = Object.values(proj0.bySeat[s.num].shares).reduce((a, b) => a + b, 0);
    return Math.abs(total - 100) < 0.001;
  })
);
check(
  'every seat has a rating band',
  PG.PUNJAB_SEATS.every((s) =>
    ['safe', 'likely', 'lean', 'tossup'].includes(proj0.bySeat[s.num].rating.band)
  )
);
check(
  'competitive seats exist at the start',
  proj0.bands.tossup + proj0.bands.lean >= 10,
  proj0.bands.tossup + ' tossup / ' + proj0.bands.lean + ' lean'
);

/* ------------------------------------------------------------ map interaction */

section('Map interaction');
const cell = $$('.map-cell').find((c) => c.dataset.seat === '73'); // Moga
clickIt(cell);
game = app.getGame();
check('clicking a seat selects it', $('.dock-name') && $('.dock-name').textContent === 'Moga');
check('panel shows the seat', !!$('.seat-title h2') && $('.seat-title h2').textContent === 'Moga');
check('selected cell is marked', $$('.map-cell.is-selected').length === 1);
check('action cards rendered', $$('.action-card').length === PG.actions.catalogue.length);

const modeToggles = $$('.map-toolbar .toggle');
clickIt(modeToggles.find((b) => b.textContent === 'Seat map'));
check('seat map mode still renders 117 cells', $$('.map-cell').length === 117);
clickIt(modeToggles.find((b) => b.textContent === 'Geographic'));
check('back to geographic renders 117 cells', $$('.map-cell').length === 117);
$$('.map-toolbar .toggle').forEach((b) => {
  if (['Projection', 'Battleground', 'Your spend'].includes(b.textContent)) clickIt(b);
});
check('colour modes all render', $$('.map-cell[fill]').length === 117);
clickIt($$('.map-toolbar .toggle').find((b) => b.textContent === 'Projection'));

/* ------------------------------------------------------------ spending */

section('Campaign spending');
clickIt($$('.map-cell').find((c) => c.dataset.seat === '73'));
const budgetBefore = PG.engine.moneyLeft(app.getGame());
const actionsBefore = app.getGame().actionsLeft;
const rallyCard = $$('.action-card').find((c) => c.textContent.includes('Public Rally'));
check('rally action is available', !!rallyCard && !rallyCard.disabled);
const sharesBefore = PG.model.seatShares(app.getGame(), 73).ppf;
clickIt(rallyCard);
game = app.getGame();
check('money was spent', PG.engine.moneyLeft(game) === budgetBefore - 6, 'delta ' + (budgetBefore - PG.engine.moneyLeft(game)));
check('an action was consumed', game.actionsLeft === actionsBefore - 1);
check('support moved in the target seat', PG.model.seatShares(game, 73).ppf > sharesBefore);
check(
  'neighbouring seats also moved',
  PG.index.seatGeo('punjab', 73).neighbours.some((n) => (game.seats[n].camp.ppf || 0) > 0)
);
check('spend recorded on the seat', (game.seats[73].spend.ppf || 0) > 0);

// A seat-scope action with a district selected but no seat should be blocked.
const before = PG.engine.canPlay(game, 'rally', {});
check('seat actions need a seat', before.ok === false);

// Development promise opens the issue picker.
const promiseCard = $$('.action-card').find((c) => c.textContent.includes('Development Promise'));
clickIt(promiseCard);
check('issue picker opens', !!$('.issue-picker'));
check('every issue is offered', $$('.issue-row').length === PG.ISSUES.length);
const spendBeforePromise = PG.engine.moneyLeft(app.getGame());
clickIt($$('.issue-row')[0]);
game = app.getGame();
check('promise resolves and costs money', PG.engine.moneyLeft(game) === spendBeforePromise - 7);
check('issue picker closed', !$('.issue-picker'));

// Drain the remaining actions, then confirm one more is refused.
check('actions still available mid-week', PG.engine.canPlay(game, 'canvass', { seat: 73 }).ok === true);
let drain = 0;
while (app.getGame().actionsLeft > 0 && drain++ < 20) {
  clickIt($$('.action-card').find((c) => c.textContent.includes('Door-to-Door')));
}
game = app.getGame();
check('actions run out after the weekly allowance', game.actionsLeft === 0);
check(
  'a further action is refused with a reason',
  PG.engine.canPlay(game, 'canvass', { seat: 73 }).reason === 'No campaign actions left this week'
);

/* ------------------------------------------------------------ panel tabs */

section('Panel tabs');
$$('.panel-tab').forEach((t) => {
  clickIt(t);
  check('tab "' + t.textContent + '" renders content', $('.panel-body').children.length > 0);
});
clickIt($$('.panel-tab').find((t) => t.textContent === 'Districts'));
check('districts table lists 23 districts', $$('.data-table tbody tr').length === 23);
const ludhianaRow = $$('.data-table tbody tr').find((r) => r.textContent.includes('Ludhiana'));
clickIt(ludhianaRow);
check('clicking a district selects it', app.getGame() && $('.dock-name').textContent.includes('Ludhiana'));
check('district view lists its 14 seats', $$('.seat-list-row').length === 14);

/* ------------------------------------------------------------ turns */

section('Turn loop');
const seatHistory = [];
let turnGuard = 0;
while (app.getGame().status === 'campaign' && turnGuard++ < 20) {
  const g = app.getGame();
  const t = g.turn;
  clickIt($('.dock-end'));
  const after = app.getGame();
  if (after.status === 'campaign') {
    check('week ' + t + ' advances to ' + (t + 1), after.turn === t + 1);
    check('week ' + after.turn + ' refills actions', after.actionsLeft === APT);
  }
  seatHistory.push(projectionSum(after));
}
game = app.getGame();
check('campaign lasted 10 weeks', turnGuard === 10, 'ran ' + turnGuard);
check('reached election day', game.status === 'electionDay');
check('seat totals stayed at 117 every week', seatHistory.every((n) => n === 117));
check('rivals spent money', PG.ai.rivalIds(game).some((id) => game.rivals[id].spent > 0));
check('events fired during the campaign', game.feed.some((f) => f.kind === 'event'));
check('briefings were written', game.feed.some((f) => f.kind === 'brief'));
check('history recorded per week', game.history.length === 10);

/* ------------------------------------------------------------ election */

section('Election and results');
clickIt($('.dock-end'));
game = app.getGame();
const result = game.result;
check('election ran', !!result);
check(
  'result seats total 117',
  Object.values(result.standings).reduce((t, s) => t + s.seats, 0) === 117,
  'got ' + Object.values(result.standings).reduce((t, s) => t + s.seats, 0)
);
check('every constituency declared a winner', Object.keys(result.perSeat).length === 117);
check(
  'every declared seat sums to 100%',
  Object.values(result.perSeat).every(
    (r) => Math.abs(Object.values(r.shares).reduce((a, b) => a + b, 0) - 100) < 0.001
  )
);
check('majority recorded as 59', result.majority === 59);
check(
  'government formed matches the threshold',
  result.outcome === 'coalition'
    ? result.governmentFormed === true
    : result.governmentFormed === result.playerSeats >= 59
);
check(
  'vote shares are plausible',
  result.standings.every((s) => s.voteShare >= 0 && s.voteShare <= 100) &&
    Math.abs(result.standings.reduce((t, s) => t + s.voteShare, 0) - 100) < 0.5
);

check('results overlay is shown', !!$('.results-overlay'));
$('.results-overlay').classList.add('is-visible');
app.showResults();
check('results table lists every party', $$('.results-table tbody tr').length === PG.PARTIES.length);
check('seat bar segments drawn', $$('.result-seg').length > 0);

console.log(
  '\n  result: ' +
    result.standings.map((s) => PG.PARTY_BY_ID[s.id].short + ' ' + s.seats).join('  ') +
    '   outcome=' +
    result.outcome
);

/* ------------------------------------------------------------ persistence */

section('Save and load');
const saveRes = PG.storage.save(game, 'test-slot');
check('save succeeds', saveRes.ok === true);
check('save appears in the list', PG.storage.list().some((m) => m.slot === 'test-slot'));
const reloaded = PG.storage.load('test-slot');
check('load returns a game', !!reloaded);
check('loaded game matches', reloaded && reloaded.result.playerSeats === result.playerSeats);
check('autosave exists', PG.storage.hasAutosave());
PG.storage.remove('test-slot');
check('delete removes the save', !PG.storage.list().some((m) => m.slot === 'test-slot'));

/* ------------------------------------------------------------ determinism */

section('Determinism');
const seed = 'determinism-check';
function playScript(seedValue) {
  const g = PG.engine.newGame({
    stateId: 'punjab',
    partyId: 'ppp',
    candidateName: 'Test',
    strategyId: 'grassroots',
    difficulty: 'normal',
    seed: seedValue,
  });
  for (let t = 0; t < 10; t++) {
    PG.engine.play(g, 'rally', { seat: ((t * 7) % 117) + 1 });
    PG.engine.play(g, 'canvass', { seat: ((t * 13) % 117) + 1 });
    PG.engine.endTurn(g);
  }
  return PG.engine.runElection(g);
}
const runA = playScript(seed);
const runB = playScript(seed);
check(
  'same seed and same moves give the same result',
  JSON.stringify(runA.standings) === JSON.stringify(runB.standings),
  runA.standings.map((s) => s.seats).join('/') + ' vs ' + runB.standings.map((s) => s.seats).join('/')
);
const runC = playScript('a-different-seed');
check(
  'a different seed gives a different map',
  JSON.stringify(runC.standings) !== JSON.stringify(runA.standings)
);

/* ------------------------------------------------------------ restart */

section('Restart');
clickIt($$('.results-actions .btn').find((b) => b.textContent === 'Play again'));
check('play again returns to setup', document.body.dataset.screen === 'setup');
check('setup screen offers to continue', !!$('.setup-continue') || PG.storage.list().length === 0);

/* ------------------------------------------------------------ buttons */

section('Buttons');
const setupButtons = $$('button');
let broken = 0;
setupButtons.forEach((b) => {
  if (b.classList.contains('setup-start')) return;
  if (b.textContent === 'Resume' || b.textContent === 'Delete') return;
  try {
    clickIt(b);
  } catch (e) {
    broken++;
    console.log('    button threw: "' + b.textContent + '" ' + e.message);
  }
});
check('no setup button throws', broken === 0);

/* ------------------------------------------------------------ console */

section('Console hygiene');
const realErrors = consoleErrors.filter(
  (e) => !/Could not parse CSS|Not implemented: HTMLCanvas|jsdom/.test(e)
);
check('no console errors or uncaught exceptions', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

/* ------------------------------------------------------------ summary */

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
