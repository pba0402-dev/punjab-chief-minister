/**
 * Campaign engine tests.
 * ------------------------------------------------------------------
 * The rules exist twice — in JavaScript for solo play and in PHP for
 * multiplayer — so the first job here is proving the two agree: same random
 * sequence, same outcome for the same roll, same cost and heat.
 *
 * Then the rules themselves: budgets cannot be overspent, heat climbs only on
 * risky play, consequences only fire once heat is up, and a whole purse spent
 * recklessly really is worse than spending it sensibly.
 *
 *   node tools/test-campaign.mjs
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { execFileSync } from 'child_process';
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

/* ------------------------------------------------------------ load the JS */

const sandbox = { console, Date, Math, JSON };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of [
  'js/data/parties.js',
  'js/data/constituencies.js',
  'js/data/incumbents.js',
  'js/data/actions.js',
  'js/engine/rng.js',
  'js/engine/campaign.js',
  'js/state.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
const CMP = sandbox.CMP;

const php = (...args) =>
  JSON.parse(execFileSync('php', [path.join(HERE, 'php-probe.php'), ...args], { encoding: 'utf8' }));

/* ------------------------------------------------------------ parity */

section('The JS and PHP engines agree');

const budgetJs = CMP.STARTING_BUDGET;
const budgetPhp = php('budget').startingBudget;
check('same starting budget', budgetJs === budgetPhp, budgetJs + ' vs ' + budgetPhp);
check('starting budget is ₹5 crore', budgetJs === 50000000, String(budgetJs));

for (const seed of ['seed', 'abc:0', 'WJMNU:player1']) {
  const jsHash = CMP.rng.hashString(seed);
  const phpHash = php('hash', seed).hash;
  check('hashString matches for "' + seed + '"', jsHash === phpHash, jsHash + ' vs ' + phpHash);
}

for (const seed of ['seed', 'game:7']) {
  const next = CMP.rng.create(seed);
  const jsSeq = Array.from({ length: 6 }, () => next());
  const phpSeq = php('rng', seed, '6');
  const same = jsSeq.every((v, i) => Math.abs(v - phpSeq[i]) < 1e-12);
  check(
    'random sequence matches for "' + seed + '"',
    same,
    same ? '' : jsSeq.slice(0, 2).join(',') + ' vs ' + phpSeq.slice(0, 2).join(',')
  );
}

for (const action of CMP.ACTIONS) {
  const phpPicks = php('outcomes', action.id, '200');
  const jsPicks = Array.from({ length: 200 }, (_, i) =>
    CMP.campaign.weightedPick(action.outcomes, i / 200).id
  );
  const same = jsPicks.every((v, i) => v === phpPicks[i]);
  check('"' + action.label + '" picks the same outcome for every roll', same);
}

/* ------------------------------------------------------------ a real play */

section('One action, resolved both sides');

function freshGame(partyId) {
  const g = CMP.state.startElection({
    partyId: partyId || 'aap',
    candidateName: 'Test Candidate',
    slogan: 'Test slogan',
    seed: 'parity-seed',
  });
  return g;
}

const jsGame = freshGame();
const rolls = { outcome: 0.5, consequence: 0.99, consequencePick: 0.5, spare: 0.1 };
const target = 73;

const phpPlayer = {
  partyId: jsGame.partyId,
  budget: jsGame.budget,
  spent: 0,
  heat: 0,
  support: JSON.parse(JSON.stringify(jsGame.support)),
  actions: [],
};
const phpPlay = php(
  'play',
  JSON.stringify({ player: phpPlayer, actionId: 'rally', target, rolls })
);
const jsPlay = CMP.campaign.play(jsGame, 'rally', target, rolls);

check('both resolve successfully', jsPlay.ok === true && !!phpPlay.report);
check(
  'same outcome chosen',
  jsPlay.report.outcomeId === phpPlay.report.outcomeId,
  jsPlay.report.outcomeId + ' vs ' + phpPlay.report.outcomeId
);
check('same cost deducted', jsGame.spent === phpPlay.spent, jsGame.spent + ' vs ' + phpPlay.spent);
check('same heat', jsGame.heat === phpPlay.heat, jsGame.heat + ' vs ' + phpPlay.heat);
check(
  'same support in the target seat',
  Math.abs(jsGame.support[target][jsGame.partyId] - phpPlay.support[String(target)][jsGame.partyId]) < 0.05,
  jsGame.support[target][jsGame.partyId] + ' vs ' + phpPlay.support[String(target)][jsGame.partyId]
);

/* ------------------------------------------------------------ budget */

section('Budget rules');

const g = freshGame();
check('starts on the full purse', CMP.campaign.remaining(g) === CMP.STARTING_BUDGET);
check('nothing spent yet', g.spent === 0);

const rally = CMP.getAction('rally');
CMP.campaign.play(g, 'rally', 73, rolls);
check('spending reduces the remaining budget', CMP.campaign.remaining(g) === CMP.STARTING_BUDGET - rally.cost);
check('spent is recorded', g.spent === rally.cost);
check('the action is recorded', g.actions.length === 1 && g.actions[0].actionId === 'rally');

// Drain the purse and confirm the last unaffordable action is refused.
const drain = freshGame();
let guard = 0;
while (CMP.campaign.canPlay(drain, 'rally', 73).ok && guard++ < 200) {
  CMP.campaign.play(drain, 'rally', 73, { outcome: 0.5, consequence: 0.99, consequencePick: 0.5 });
}
check('a purse runs out', CMP.campaign.remaining(drain) < rally.cost, '₹' + CMP.campaign.remaining(drain));
const refused = CMP.campaign.canPlay(drain, 'rally', 73);
check('an unaffordable action is refused', refused.ok === false);
check('the reason reads "Insufficient Budget"', refused.reason === 'Insufficient Budget', refused.reason);

const spentBefore = drain.spent;
const attempt = CMP.campaign.play(drain, 'rally', 73, rolls);
check('a refused action changes nothing', attempt.ok === false && drain.spent === spentBefore);
check('never overspends', drain.spent <= drain.budget, drain.spent + ' of ' + drain.budget);

check(
  'PHP refuses an unaffordable action too',
  php('blocked', JSON.stringify({
    player: { partyId: 'aap', budget: 1000, spent: 0, support: { 73: { aap: 30, inc: 30, bjp: 20, sad: 20 } }, actions: [] },
    actionId: 'rally',
    target: 73,
  })).reason === 'Insufficient Budget'
);

check(
  'an action needing a seat is refused without one',
  CMP.campaign.canPlay(freshGame(), 'rally', null).reason === 'Choose a constituency first'
);

/* ------------------------------------------------------------ heat */

section('Political Heat');

const calm = freshGame();
for (let i = 0; i < 6; i++) {
  CMP.campaign.play(calm, 'rally', 73, { outcome: 0.5, consequence: 0.99, consequencePick: 0.5 });
}
check('safe actions barely raise heat', calm.heat <= 2, 'heat ' + calm.heat);
check('heat starts at 0', freshGame().heat === 0);

const hot = freshGame();
CMP.campaign.play(hot, 'deal', 73, { outcome: 0.1, consequence: 0.99, consequencePick: 0.5 });
check('a risky action raises heat sharply', hot.heat >= 15, 'heat ' + hot.heat);

check('0 reads Low', CMP.campaign.heatLevel(0).label === 'Low');
check('30 reads Moderate', CMP.campaign.heatLevel(30).label === 'Moderate');
check('60 reads High', CMP.campaign.heatLevel(60).label === 'High');
check('90 reads Critical', CMP.campaign.heatLevel(90).label === 'Critical');

const capped = freshGame();
capped.heat = 95;
CMP.campaign.play(capped, 'deal', 73, { outcome: 0.99, consequence: 0.99, consequencePick: 0.5 });
check('heat never exceeds 100', capped.heat <= 100, 'heat ' + capped.heat);

/* ------------------------------------------------------------ outcomes vary */

section('Outcomes vary');

for (const id of ['deal', 'influence', 'negative', 'lastpush']) {
  const seen = {};
  for (let i = 0; i < 400; i++) {
    const gg = freshGame();
    const r = CMP.campaign.play(gg, id, 73, {
      outcome: i / 400,
      consequence: 0.99,
      consequencePick: 0.5,
    });
    seen[r.report.outcomeId] = (seen[r.report.outcomeId] || 0) + 1;
  }
  const action = CMP.getAction(id);
  check(
    '"' + action.label + '" can produce every one of its outcomes',
    Object.keys(seen).length === action.outcomes.length,
    Object.keys(seen).join(', ')
  );
}

const backfire = freshGame();
const before = backfire.support[73].aap;
CMP.campaign.play(backfire, 'deal', 73, { outcome: 0.95, consequence: 0.99, consequencePick: 0.5 });
check('a risky action can actually backfire', backfire.support[73].aap < before,
  before.toFixed(1) + ' -> ' + backfire.support[73].aap.toFixed(1));

/* ------------------------------------------------------------ consequences */

section('Consequences');

const cool = freshGame();
cool.heat = 10;
let fired = 0;
for (let i = 0; i < 200; i++) {
  const gg = freshGame();
  gg.heat = 10;
  const r = CMP.campaign.play(gg, 'rally', 73, {
    outcome: 0.5,
    consequence: i / 200,
    consequencePick: 0.5,
  });
  if (r.report.consequence) fired++;
}
check('no consequences while heat is low', fired === 0, fired + ' fired');

let firedHot = 0;
for (let i = 0; i < 200; i++) {
  const gg = freshGame();
  gg.heat = 90;
  const r = CMP.campaign.play(gg, 'rally', 73, {
    outcome: 0.5,
    consequence: i / 200,
    consequencePick: 0.5,
  });
  if (r.report.consequence) firedHot++;
}
check('consequences do fire at critical heat', firedHot > 0, firedHot + ' of 200');
check('and are not certain either', firedHot < 200, firedHot + ' of 200');

const hitGame = freshGame();
hitGame.heat = 95;
hitGame.actions.push({ constituency: 73 });
const hitBefore = hitGame.support[73].aap;
const conseq = CMP.campaign.play(hitGame, 'rally', 73, {
  outcome: 0.5,
  consequence: 0.01,
  consequencePick: 0.99,
});
check('a consequence fired', !!conseq.report.consequence, JSON.stringify(conseq.report.consequence));
if (conseq.report.consequence) {
  check('it names the seats it hit', conseq.report.consequence.seats.length > 0);
  check(
    'it explains itself in words',
    typeof conseq.report.consequence.text === 'string' && conseq.report.consequence.text.length > 10
  );
}

/* ------------------------------------------------------------ balance */

section('Balance: reckless play should usually lose');

function playStrategy(kind, seed) {
  const gg = CMP.state.startElection({
    partyId: 'aap',
    candidateName: 'Bot',
    slogan: 'Bot',
    seed: kind + ':' + seed,
  });
  const rand = CMP.rng.create('rolls:' + kind + ':' + seed);
  const seatsByCloseness = () =>
    CMP.CONSTITUENCIES.map((c) => CMP.campaign.seatView(gg, c.number))
      .filter(Boolean)
      .sort((a, b) => a.margin - b.margin);

  let guard = 0;
  while (guard++ < 400) {
    const pool = kind === 'reckless' ? ['deal', 'lastpush', 'influence'] : ['rally', 'community', 'outreach', 'media'];
    const affordable = pool.filter((id) => CMP.campaign.canPlay(gg, id, 1).ok);
    if (!affordable.length) break;
    const id = affordable[Math.floor(rand() * affordable.length)];
    // Both strategies target sensibly; only the risk appetite differs.
    const seat = seatsByCloseness()[Math.floor(rand() * 12)] || seatsByCloseness()[0];
    const res = CMP.campaign.play(gg, id, seat.number, {
      outcome: rand(),
      consequence: rand(),
      consequencePick: rand(),
    });
    if (!res.ok) break;
  }
  return { seats: CMP.campaign.seatsLed(gg), heat: gg.heat, spent: gg.spent };
}

const RUNS = 40;
let safeSeats = 0;
let recklessSeats = 0;
let recklessHeat = 0;
for (let i = 0; i < RUNS; i++) {
  safeSeats += playStrategy('safe', i).seats;
  const r = playStrategy('reckless', i);
  recklessSeats += r.seats;
  recklessHeat += r.heat;
}
const safeAvg = safeSeats / RUNS;
const recklessAvg = recklessSeats / RUNS;
const heatAvg = recklessHeat / RUNS;

console.log('  safe play:     ' + safeAvg.toFixed(1) + ' seats led');
console.log('  reckless play: ' + recklessAvg.toFixed(1) + ' seats led, heat ' + heatAvg.toFixed(0));

check('spending it all recklessly runs the heat up', heatAvg > 60, 'avg heat ' + heatAvg.toFixed(0));
check('safe play beats reckless play on average', safeAvg > recklessAvg,
  safeAvg.toFixed(1) + ' vs ' + recklessAvg.toFixed(1));

/* ------------------------------------------------------------ config */

section('Everything is configurable');

check('config exposes starting budget', typeof CMP.CAMPAIGN.startingBudget === 'number');
check('config exposes heat levels', CMP.CAMPAIGN.heat.levels.length === 4);
check('config exposes consequences', CMP.CAMPAIGN.consequences.length >= 4);
check('four safe actions', CMP.actionsByGroup('safe').length === 4);
check('four risky actions', CMP.actionsByGroup('risky').length === 4);
check(
  'every action declares cost, risk and impact labels',
  CMP.ACTIONS.every((a) => a.cost > 0 && a.riskLabel && a.impactLabel)
);
check(
  'every action has weighted outcomes',
  CMP.ACTIONS.every((a) => a.outcomes.length >= 2 && a.outcomes.every((o) => o.weight > 0))
);

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
