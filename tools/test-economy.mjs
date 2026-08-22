/**
 * The twenty-round economy, on both engines.
 * ------------------------------------------------------------------
 * The brief's own worked examples, run as assertions: five crore a round, cash
 * that carries forward, no per-round spending cap, region-locked grants, and
 * an allowance that cannot be collected twice however many times the code that
 * pays it is called.
 *
 * Runs the JS engine in a jsdom window and the PHP engine over the CLI, and
 * checks the two agree — a rule that holds in solo play and not in multiplayer
 * is worse than no rule.
 *
 *   node tools/test-economy.mjs
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

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

const CR = 10000000;

/**
 * Fixed rolls. The economy is what is under test here, not the dice: a
 * predictable outcome keeps every figure below exact, and a consequence roll
 * of 1 means no scandal ever fires and moves the money unexpectedly.
 */
const ROLLS = { outcome: 0.3, consequence: 1, consequencePick: 0.5, event: 1 };
const cr = (n) => '₹' + (n / CR).toFixed(2).replace(/\.00$/, '') + ' Cr';

/* ------------------------------------------------------------ the engine */

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
const win = dom.window;

for (const file of [
  'js/data/parties.js',
  'js/data/avatars.js',
  'js/data/constituencies.js',
  'js/data/regions.js',
  'js/data/actions.js',
  'js/engine/rng.js',
  'js/engine/campaign.js',
  'js/engine/ai.js',
  'js/state.js',
]) {
  win.eval(fs.readFileSync(path.join(APP, file), 'utf8'));
}
const CMP = win.CMP;
const engine = CMP.campaign;

/* ------------------------------------------------------------- geography */

section('Punjab has three regions and twenty-three districts');

check('three regions', CMP.REGIONS.length === 3, CMP.REGIONS.map((r) => r.id).join('/'));
check('twenty-three districts', CMP.DISTRICTS.length === 23, String(CMP.DISTRICTS.length));

const seatsInDistricts = CMP.DISTRICTS.reduce((t, d) => t + d.seats.length, 0);
check('every seat belongs to exactly one district', seatsInDistricts === 117,
  String(seatsInDistricts));

const byRegion = {};
CMP.DISTRICTS.forEach((d) => {
  byRegion[d.region] = (byRegion[d.region] || 0) + d.seats.length;
});
check('Majha has 25 seats', byRegion.majha === 25, String(byRegion.majha));
check('Doaba has 23 seats', byRegion.doaba === 23, String(byRegion.doaba));
check('Malwa has 69 seats', byRegion.malwa === 69, String(byRegion.malwa));
check('and they add to 117', byRegion.majha + byRegion.doaba + byRegion.malwa === 117);

check('every district has a grant inside the configured range',
  CMP.DISTRICTS.every((d) =>
    d.grant >= CMP.CAMPAIGN.territory.grant.min && d.grant <= CMP.CAMPAIGN.territory.grant.max));
check('the largest district pays the most',
  CMP.DISTRICTS.slice().sort((a, b) => b.seats.length - a.seats.length)[0].grant ===
    Math.max(...CMP.DISTRICTS.map((d) => d.grant)));

/* -------------------------------------------------------------- the rules */

section('Twenty rounds, and the round is not a spending cap');

check('20 rounds', CMP.ROUNDS.total === 20, String(CMP.ROUNDS.total));
check('the checkpoint is round 15', CMP.ROUNDS.eliminationRound === 15);
check('alliances close at round 10', CMP.ROUNDS.allianceDeadline === 10);
check('rounds are two minutes by default', CMP.ROUNDS.seconds === 120, String(CMP.ROUNDS.seconds));
check('and two minutes is the shortest offered',
  Math.min(...CMP.ROUNDS.durationOptions) === 120,
  CMP.ROUNDS.durationOptions.join('/'));
check('there is no cap on moves per round',
  !CMP.ROUNDS.actionsPerRound, String(CMP.ROUNDS.actionsPerRound));
check('nobody starts with money', CMP.STARTING_BUDGET === 0, String(CMP.STARTING_BUDGET));
check('the round allowance is ₹5 crore', CMP.CAMPAIGN.income.perRound === 5 * CR,
  cr(CMP.CAMPAIGN.income.perRound));

/* --------------------------------------------------- the brief's own sums */

section("The brief's worked example, step by step");

// Parties are invented now, so the harness founds one. The player is always
// slot one, so their id is 'p1' in every game.
const ME = 'p1';

function newGame(seed) {
  return CMP.state.startElection({
    candidateName: 'Test Candidate',
    partyName: 'Test Party',
    partyShort: 'TP',
    slogan: 'Testing',
    seed: seed || 'economy',
  });
}

let g = newGame('walkthrough');

check('E. round 1 opens on exactly ₹5 crore', engine.remaining(g) === 5 * CR, cr(engine.remaining(g)));

// F/G. Spend one crore, four should remain.
const rally = CMP.getAction('invest');
let seat = CMP.DISTRICTS.find((d) => d.region === 'malwa').seats[0];
// One rally is still one rally: a single move is capped at a multiple of its
// own cost, so a crore goes on a district rather than into one meeting hall.
const oneCroreAcross = engine.campaignBulk(
  g, 'invest', CMP.DISTRICTS.find((d) => d.region === 'malwa').seats, 1 * CR, () => ROLLS
);
check('F. a ₹1 crore allocation is allowed', oneCroreAcross.ok, oneCroreAcross.reason);
check('G. ₹4 crore remains', engine.remaining(g) === 4 * CR, cr(engine.remaining(g)));

// N/O/P. Next round adds five, carrying the four forward.
engine.endRound(g);
engine.startNextRound(g);
check('M. round 2 has begun', g.round === 2, String(g.round));
check('N+O+P. the balance is ₹9 crore', engine.remaining(g) === 9 * CR, cr(engine.remaining(g)));

// Q/R. Put six of the nine behind one district — more than a round's income,
// which is the whole point of letting money carry forward.
const malwa = CMP.DISTRICTS.filter((d) => d.region === 'malwa');
const bigDistrict = malwa.slice().sort((a, b) => b.seats.length - a.seats.length)[0];
const before6 = engine.remaining(g) + engine.grantTotal(g);
const bulk = engine.campaignBulk(g, 'invest', bigDistrict.seats, 6 * CR, () => ROLLS);
check('30. one allocation can cover a whole district', bulk.ok, bulk.reason);
check('Q. spending ₹6 crore in one round is allowed',
  bulk.ok && bulk.spent === 6 * CR, cr(bulk.ok ? bulk.spent : 0));
check('10. more than the ₹5 crore allowance can go in one round',
  bulk.ok && bulk.spent > 5 * CR, cr(bulk.ok ? bulk.spent : 0));
check('   and it landed across the district, not on one seat',
  bulk.ok && bulk.seats === bigDistrict.seats.length,
  (bulk.seats || 0) + ' of ' + bigDistrict.seats.length + ' seats');
/*
 * ₹6 crore left the campaign, but not all of it left the cash pile.
 *
 * Nothing is inherited any more, so a district taken in round one starts
 * paying its grant in round two — and grant money is spent before cash,
 * because it is locked to its region and holding it back would strand it.
 * What has to be true is that six crore in total went, not that it all came
 * out of one pocket.
 */
const purseAfter = engine.remaining(g) + engine.grantTotal(g);
check('R. ₹6 crore left the campaign in total',
  before6 - purseAfter === 6 * CR,
  cr(before6) + ' - ' + cr(purseAfter) + ' = ' + cr(before6 - purseAfter));
check('R. and the grant money went first',
  engine.remaining(g) >= 3 * CR, cr(engine.remaining(g)));

const beforeRound3 = engine.remaining(g);
engine.endRound(g);
engine.startNextRound(g);
check('T+U. the round allowance is added to what survived',
  engine.remaining(g) === beforeRound3 + 5 * CR,
  cr(beforeRound3) + ' + ₹5 Cr = ' + cr(engine.remaining(g)));

/* ------------------------------------------------------------- saving up */

section('V. Saving across rounds, then spending it at once');

g = newGame('saving');
for (let r = 1; r < 6; r++) {
  engine.endRound(g);
  engine.startNextRound(g);
}
check('five quiet rounds bank ₹30 crore', engine.remaining(g) === 30 * CR, cr(engine.remaining(g)));
check('every round paid exactly once',
  Object.keys(g.incomeCredited).length === 6, Object.keys(g.incomeCredited).join(','));
check('income total agrees with the balance', g.incomeTotal === 30 * CR, cr(g.incomeTotal));

// W. Spend a large accumulated balance in one round, across many seats.
const before = engine.remaining(g);
const wideSeats = CMP.DISTRICTS.filter((d) => d.region === 'malwa').flatMap((d) => d.seats);
const wide = engine.campaignBulk(g, 'invest', wideSeats, 24 * CR, () => ROLLS);
check('W. a banked ₹24 crore goes out in one round', wide.ok && wide.spent === 24 * CR,
  cr(wide.ok ? wide.spent : 0) + (wide.unspent ? ', ' + cr(wide.unspent) + ' would not fit' : ''));
check('   which takes breadth — it will not fit on a handful of seats',
  wide.ok && wide.seats > 25, String(wide.seats || 0) + ' seats');
check('   and the balance fell by exactly what was spent',
  engine.remaining(g) === before - wide.spent,
  cr(engine.remaining(g)) + ' vs ' + cr(before - wide.spent));

// The ceiling on a single move is what stops money being dumped rather than
// campaigned. It is a real limit and the plan says so rather than hiding it.
const rallyCeiling = engine.amountRange(CMP.getAction('invest')).max;
const narrow = wideSeats.slice(0, 3);
const tooNarrow = engine.planBulk(g, 'invest', narrow, rallyCeiling * narrow.length + 10 * CR);
check('11. money that will not fit is reported, not silently kept',
  tooNarrow.unspent > 0,
  cr(tooNarrow.unspent) + ' left over on ' + narrow.length + ' seats');

/* ------------------------------------------------------ the spending limit */

section('X. A player cannot spend more than they hold');

g = newGame('limit');
g.cash = 60 * CR;                     // a campaign that has been saving
const held = engine.remaining(g);
const everySeat = CMP.DISTRICTS.flatMap((d) => d.seats);
const overreach = engine.campaignBulk(g, 'invest', everySeat, held * 4, () => ROLLS);
check('X. asking for four times the balance spends only the balance',
  overreach.ok && overreach.spent <= held, cr(overreach.spent) + ' of ' + cr(held));
check('   and never takes the campaign below zero', engine.remaining(g) >= 0,
  cr(engine.remaining(g)));

/*
 * A single move is separately capped at a multiple of its own cost, so one
 * cheque cannot buy a seat outright however rich the campaign.
 *
 * The campaign gets into the seat first: an opening move is capped at a crore,
 * so testing the ceiling from outside would only ever test the entry rule.
 */
const rallyRange = engine.amountRange(CMP.getAction('invest'));
const rich = newGame('cap');
rich.cash = 100 * CR;
engine.play(rich, 'invest', everySeat[0], ROLLS, CMP.CAMPAIGN.spending.entryMaximum);
const spentGettingIn = rich.spent;
const oneMove = engine.play(rich, 'invest', everySeat[0], ROLLS, 100 * CR);
check('   one move cannot absorb a whole campaign',
  oneMove.ok && oneMove.report.cost === rallyRange.max,
  cr(oneMove.ok ? oneMove.report.cost : 0) + ', ceiling ' + cr(rallyRange.max));

/* -------------------------------------------------------- no double credit */

section('Y. The allowance cannot be collected twice');

g = newGame('double');
const opening = engine.remaining(g);
engine.creditRoundIncome(g, 1);
engine.creditRoundIncome(g, 1);
engine.creditRoundIncome(g, 1);
check('Y. three more calls for round 1 pay nothing',
  engine.remaining(g) === opening, cr(engine.remaining(g)));

// Re-running the whole round-open path is what a reconnection looks like.
engine.beginRound(g, 1);
check('   and re-opening round 1 pays nothing either',
  engine.remaining(g) === opening, cr(engine.remaining(g)));

/* ------------------------------------------------------------- territory */

section('District control, and grants locked to their region');

g = newGame('territory');

// A district this campaign did NOT open holding, so taking it is something it
// did rather than something it was dealt.
const malerkotla = CMP.DISTRICTS.find(
  (d) => d.id === 'malerkotla' && g.openingDistricts.indexOf(d.id) === -1
) || CMP.DISTRICTS.find((d) => g.openingDistricts.indexOf(d.id) === -1);
check('a district the campaign was not handed', !!malerkotla,
  'opening: ' + g.openingDistricts.join('/'));

// Take every seat in it. The board is influence rather than percentages now,
// so this is what campaigning hard everywhere in one district looks like.
malerkotla.seats.forEach((n) => {
  g.support[n] = {};
  CMP.PARTIES.forEach(function (party) {
    g.support[n][party.id] = party.id === ME ? 70 : 10;
  });
});

const region = malerkotla.region;

/*
 * Leading every seat is not controlling the district.
 *
 * A grant is paid for a district that cannot be lost, so control means every
 * seat *won* — finished, locked, nobody's to take. Leading them all is a
 * position, and a position can change on Thursday.
 */
const ledOnly = engine.districtsHeldBy(g.support, ME);
check('AM. leading every seat is not controlling the district',
  !engine.districtsWonBy(g, ME).some((d) => d.id === malerkotla.id) &&
  ledOnly.some((d) => d.id === malerkotla.id),
  ledOnly.map((d) => d.id).join('/'));

// Win them, and it is controlled.
g.wonSeats = g.wonSeats || {};
malerkotla.seats.forEach((n) => {
  g.wonSeats[String(n)] = { party: ME, round: 8, share: 100 };
});
check('AM. winning every seat is controlling it',
  engine.districtsWonBy(g, ME).some((d) => d.id === malerkotla.id));

// Lose one, and the control goes with it.
const dropped = JSON.parse(JSON.stringify(g));
delete dropped.wonSeats[String(malerkotla.seats[0])];
check('   winning all but one is not controlling it',
  !engine.districtsWonBy(dropped, ME).some((d) => d.id === malerkotla.id));

const cashBefore = engine.remaining(g);
const grantBefore = engine.grantIn(g, region);
engine.creditDistrictGrants(g, 9);
const paid = engine.grantIn(g, region) - grantBefore;
check('AN. the grant is paid on the round it is held', paid === malerkotla.grant, cr(paid));
check('64. and it does not land in general cash',
  engine.remaining(g) === cashBefore, cr(engine.remaining(g)));

const afterOne = engine.grantIn(g, region);
engine.creditDistrictGrants(g, 9);
check('   nor is it paid twice for the same round',
  engine.grantIn(g, region) === afterOne, cr(engine.grantIn(g, region)));

engine.creditDistrictGrants(g, 10);
check('AO. it pays again the next round',
  engine.grantIn(g, region) - afterOne === malerkotla.grant,
  cr(engine.grantIn(g, region) - afterOne));

// The districts the deal handed over pay nothing at all.
const dealt = newGame('dealt');
const dealtBefore = engine.grantTotal(dealt);
engine.creditDistrictGrants(dealt, 5);
check('36. a district inherited from the deal pays nothing',
  engine.grantTotal(dealt) === dealtBefore,
  cr(engine.grantTotal(dealt)) + ' from ' + dealt.openingDistricts.length + ' opening districts');

/* ----------------------------------------------------- region restriction */

section('AP-AR. Grant money only spends where it was earned');

g = newGame('regions');
g.grants = { majha: 15 * CR };
g.cash = 0;

const majhaSeat = CMP.DISTRICTS.find((d) => d.region === 'majha').seats[0];
const malwaSeat = CMP.DISTRICTS.find((d) => d.region === 'malwa').seats[0];

check('the seat regions are what we think',
  CMP.regionOfSeat(majhaSeat) === 'majha' && CMP.regionOfSeat(malwaSeat) === 'malwa');

const inMajha = engine.spendableOn(g, majhaSeat);
const inMalwa = engine.spendableOn(g, malwaSeat);
check('AP. a Majha grant is spendable in Majha', inMajha.total === 15 * CR, cr(inMajha.total));
check('AQ+AR. and blocked in Malwa', inMalwa.total === 0, cr(inMalwa.total));

const blocked = engine.canPlay(g, 'invest', malwaSeat, 1 * CR);
check('AR. so a Malwa move on Majha money is refused', !blocked.ok, blocked.reason);

// Getting in is capped, so the move that proves the money is spendable here
// is the opening one.
const entry = CMP.CAMPAIGN.spending.entryMaximum;
const allowed = engine.play(g, 'invest', majhaSeat, ROLLS, entry);
check('   the same move in Majha goes through', allowed.ok, allowed.reason);
check('   and comes out of the Majha purse',
  engine.grantIn(g, 'majha') === 15 * CR - entry,
  cr(engine.grantIn(g, 'majha')));
check('   leaving general cash alone', engine.remaining(g) === 0, cr(engine.remaining(g)));

// With both purses, the region money goes first.
g.cash = 5 * CR;
const purseBefore = engine.grantIn(g, 'majha');
const second = engine.play(g, 'invest', majhaSeat, ROLLS, 1 * CR);
check('   region money is spent before general cash',
  engine.grantIn(g, 'majha') === purseBefore - second.report.cost
    && engine.remaining(g) === 5 * CR,
  cr(engine.grantIn(g, 'majha')) + ' / ' + cr(engine.remaining(g)));

/* ---------------------------------------------------------------- ledger */

section('65. Every movement of money is written down');

g = newGame('ledger');
const ledgerMove = engine.play(g, 'invest', malwaSeat, ROLLS, 5000000);
const kinds = g.ledger.map((e) => e.kind);
check('the round allowance is a ledger row', kinds.indexOf('income') !== -1, kinds.join('/'));
check('so is the spending', kinds.indexOf('campaign') !== -1, kinds.join('/'));

const income = g.ledger.find((e) => e.kind === 'income');
const spend = g.ledger.find((e) => e.kind === 'campaign');
check('income is recorded as money in', income.amount === 5 * CR, cr(income.amount));
check('spending is recorded as money out',
  spend.amount === -ledgerMove.report.cost, cr(spend.amount));
check('and says which seat it went on', spend.seat === malwaSeat, String(spend.seat));
check('every row knows its round', g.ledger.every((e) => e.round >= 1));

/* -------------------------------------------------------------- vs PHP */

section('The server agrees with the browser');

// Written to a file and run, rather than passed with -r: the namespace
// separator has to survive a template literal, a shell and PHP, and getting
// that wrong looks exactly like a broken engine.
const phpFile = path.join(os.tmpdir(), 'cmp-economy-probe.php');
fs.writeFileSync(phpFile, [
  '<?php',
  'require ' + JSON.stringify(path.join(APP, 'api/lib/Territory.php')) + ';',
  'require ' + JSON.stringify(path.join(APP, 'api/lib/Campaign.php')) + ';',
  '$engine = new Campaign(' + JSON.stringify(path.join(APP, 'api/campaign-config.json')) + ');',
  "$p = ['cash' => 0, 'grants' => [], 'ledger' => [], 'incomeCredited' => [], 'partyId' => 'aap'];",
  '$p = $engine->creditRoundIncome($p, 1);',
  '$afterOne = $p["cash"];',
  '$p = $engine->creditRoundIncome($p, 1);',
  '$afterTwice = $p["cash"];',
  '$p = $engine->creditRoundIncome($p, 2);',
  '$afterTwo = $p["cash"];',
  '$p["grants"] = ["majha" => 150000000];',
  '$majha = $engine->spendableOn($p, ' + majhaSeat + ')["total"];',
  '$malwa = $engine->spendableOn($p, ' + malwaSeat + ')["total"];',
  '[$p2, $paid] = $engine->charge($p, ' + majhaSeat + ', 20000000);',
  'echo json_encode([',
  '  "afterOne" => $afterOne, "afterTwice" => $afterTwice, "afterTwo" => $afterTwo,',
  '  "majha" => $majha, "malwa" => $malwa,',
  '  "paidFromGrant" => $paid["grant"], "paidFromCash" => $paid["cash"],',
  '  "rounds" => $engine->rounds()["total"],',
  '  "income" => $engine->config()["income"]["perRound"],',
  ']);',
].join(String.fromCharCode(10)));

const out = JSON.parse(execFileSync('php', [phpFile], { encoding: 'utf8' }));

check('PHP pays one allowance for round 1', out.afterOne === 5 * CR, cr(out.afterOne));
check('PHP will not pay it twice', out.afterTwice === 5 * CR, cr(out.afterTwice));
check('PHP pays again for round 2', out.afterTwo === 10 * CR, cr(out.afterTwo));
check('PHP allows Majha money in Majha', out.majha === 10 * CR + 15 * CR, cr(out.majha));
check('PHP blocks it in Malwa', out.malwa === 10 * CR, cr(out.malwa));
check('PHP spends the region purse first',
  out.paidFromGrant === 2 * CR && out.paidFromCash === 0,
  cr(out.paidFromGrant) + ' / ' + cr(out.paidFromCash));
check('PHP agrees there are 20 rounds', out.rounds === 20, String(out.rounds));
check('PHP agrees the allowance is ₹5 crore', out.income === 5 * CR, cr(out.income));

/* --------------------------------------------------------- the full run */

section('13. A twenty-round campaign generates ₹100 crore');

g = newGame('full');
let total = engine.remaining(g);
for (let r = 1; r < 20; r++) {
  engine.endRound(g);
  engine.startNextRound(g);
}
check('twenty rounds of income', g.incomeTotal === 100 * CR, cr(g.incomeTotal));
check('and a campaign that spent nothing still holds all of it',
  engine.remaining(g) >= 100 * CR, cr(engine.remaining(g)));
check('14. four players would generate ₹400 crore',
  g.incomeTotal * 4 === 400 * CR, cr(g.incomeTotal * 4));

/* ---------------------------------------------------------------- done */

win.close();

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
