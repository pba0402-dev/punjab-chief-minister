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
  'js/engine/ai.js',
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
  cash: jsGame.cash,
  spent: 0,
  heat: 0,
  granted: 0,
  raised: 0,
  actions: [],
};
const phpBoard = JSON.parse(JSON.stringify(jsGame.support));
const phpPlay = php(
  'play',
  JSON.stringify({ player: phpPlayer, board: phpBoard, actionId: 'rally', target, rolls })
);
const jsPlay = CMP.campaign.play(jsGame, 'rally', target, rolls);

check('both resolve successfully', jsPlay.ok === true && !!phpPlay.report);
check(
  'same outcome chosen',
  jsPlay.report.outcomeId === phpPlay.report.outcomeId,
  jsPlay.report.outcomeId + ' vs ' + phpPlay.report.outcomeId
);
check('same cost deducted', jsGame.spent === phpPlay.spent, jsGame.spent + ' vs ' + phpPlay.spent);
check('same cash left', jsGame.cash === phpPlay.cash, jsGame.cash + ' vs ' + phpPlay.cash);
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

// A round holds a fixed number of moves, so draining a purse takes a campaign
// rather than a single burst of clicking.
const drain = freshGame();
let guard = 0;
while (CMP.campaign.remaining(drain) >= rally.cost && guard++ < 400) {
  if (CMP.campaign.actionsLeft(drain) <= 0) {
    drain.roundActions = 0; // a fresh round, without waiting sixty seconds for it
    continue;
  }
  CMP.campaign.play(drain, 'rally', 73, { outcome: 0.5, consequence: 0.99, consequencePick: 0.5 });
}
check('a purse runs out', CMP.campaign.remaining(drain) < rally.cost, '₹' + CMP.campaign.remaining(drain));
drain.roundActions = 0; // so the refusal below is about money, not moves
const refused = CMP.campaign.canPlay(drain, 'rally', 73);
check('an unaffordable action is refused', refused.ok === false);
check('the reason reads "Insufficient Budget"', refused.reason === 'Insufficient Budget', refused.reason);

const moveCapped = freshGame();
const moveCap = CMP.ROUNDS.actionsPerRound;
check('a round starts with every move available', CMP.campaign.actionsLeft(moveCapped) === moveCap);
for (let i = 0; i < moveCap; i++) {
  CMP.campaign.play(moveCapped, 'rally', 73, { outcome: 0.5, consequence: 0.99, consequencePick: 0.5 });
}
check('the moves run out', CMP.campaign.actionsLeft(moveCapped) === 0);
const outOfMoves = CMP.campaign.canPlay(moveCapped, 'rally', 73);
check('a fourth move in one round is refused', outOfMoves.ok === false);
check('and says so plainly', outOfMoves.reason === 'No moves left this round', outOfMoves.reason);
check('money is not the reason', CMP.campaign.remaining(moveCapped) > CMP.getAction('rally').cost);
CMP.campaign.endRound(moveCapped);
check('the results break refuses moves outright',
  CMP.campaign.canPlay(moveCapped, 'rally', 73).ok === false);
CMP.campaign.startNextRound(moveCapped);
check('the next round restores them', CMP.campaign.actionsLeft(moveCapped) === moveCap);

const spentBefore = drain.spent;
const attempt = CMP.campaign.play(drain, 'rally', 73, rolls);
check('a refused action changes nothing', attempt.ok === false && drain.spent === spentBefore);
check('never overspends', drain.spent <= drain.budget, drain.spent + ' of ' + drain.budget);

check(
  'PHP refuses an unaffordable action too',
  php('blocked', JSON.stringify({
    player: { partyId: 'aap', budget: 1000, cash: 1000, spent: 0, actions: [] },
    board: { 73: { aap: 30, inc: 30, bjp: 20, sad: 20 } },
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

/* ------------------------------------------------------------ the clock */

section('Fifteen rounds of sixty seconds');

const clockGame = freshGame();
check('opens on round 1', clockGame.round === 1);
check('knows how many rounds there are', clockGame.roundsTotal === 15, String(clockGame.roundsTotal));
check('a round is 60 seconds', clockGame.roundSeconds === 60, String(clockGame.roundSeconds));
check(
  'the clock starts near a full round',
  CMP.campaign.secondsLeft(clockGame) > 55 && CMP.campaign.secondsLeft(clockGame) <= 60,
  String(CMP.campaign.secondsLeft(clockGame))
);
check('a live round accepts actions', CMP.campaign.canPlay(clockGame, 'rally', 73).ok === true);

const phpRounds = php('rounds');
check(
  'PHP reads the same round config',
  phpRounds.total === clockGame.roundsTotal && phpRounds.seconds === clockGame.roundSeconds,
  phpRounds.total + 'x' + phpRounds.seconds
);

// An expired round refuses actions, grace window included.
const expired = freshGame();
expired.roundEndsAt = Date.now() - (CMP.ROUNDS.graceSeconds + 5) * 1000;
const late = CMP.campaign.canPlay(expired, 'rally', 73);
check('an expired round refuses an action', late.ok === false);
check('and says why', /round has closed/i.test(late.reason), late.reason);

// Ending a round advances it, snapshots history, and closes after fifteen.
const runner = freshGame();
const cashAtStart = runner.cash;
CMP.campaign.play(runner, 'rally', 73, rolls);
const firstEnd = CMP.campaign.endRound(runner);
check('the round settles into a results break', runner.stage === 'results', runner.stage);
check('the round is not the last one', firstEnd.finished === false);
check('the break has a scoreboard on it', !!runner.lastResult);
check('the scoreboard ranks all four parties', runner.lastResult.standings.length === 4);
CMP.campaign.startNextRound(runner);
check('the break ending opens the next round', runner.round === 2, String(runner.round));
check('history gains a snapshot', runner.history.length === 1);
check('the snapshot holds all 117 seats', Object.keys(runner.history[0].board).length === 117);
check(
  'the summary reports what was spent',
  firstEnd.summary.spent === CMP.getAction('rally').cost,
  String(firstEnd.summary.spent)
);
check(
  'the summary reports cash correctly',
  firstEnd.summary.cashBefore === cashAtStart && firstEnd.summary.cashAfter === runner.cash
);
check('a new round resets the spend counter', runner.roundSpent === 0);
check('and gives a fresh clock', CMP.campaign.secondsLeft(runner) > 55);

// A round now settles into a results break, and the next round opens when
// that break ends. Both steps are needed to move a campaign along.
function runRound(g) {
  const settled = CMP.campaign.endRound(g);
  if (settled.finished) return true;
  CMP.campaign.startNextRound(g);
  return false;
}

let guardRounds = 0;
let finished = false;
while (!finished && guardRounds++ < 40) finished = runRound(runner);
check('the campaign closes after fifteen rounds', runner.round === 15, String(runner.round));
check('and reports that it finished', finished === true);
check('with fifteen snapshots of history', runner.history.length === 15, String(runner.history.length));

/* ------------------------------------------------------------ borrowing */

section('Bank loans');

const cfgLoan = CMP.FINANCE.loan;
const borrower = freshGame();
const quote = CMP.campaign.loanOffer(borrower, cfgLoan.minAmount);

check('a loan can be quoted', quote.ok === true, quote.error || '');
check(
  'interest is ' + Math.round(cfgLoan.interestRate * 100) + '%',
  quote.interest === Math.round(quote.amount * cfgLoan.interestRate),
  String(quote.interest)
);
check(
  'repayment falls ' + cfgLoan.repayAfterRounds + ' rounds later',
  quote.dueRound === borrower.round + cfgLoan.repayAfterRounds,
  String(quote.dueRound)
);
check('repayment is principal plus interest', quote.repay === quote.amount + quote.interest);

const phpQuote = php(
  'loan',
  JSON.stringify({
    player: { partyId: 'aap', cash: borrower.cash, loans: [], record: {} },
    amount: cfgLoan.minAmount,
    round: 1,
  })
);
check(
  'PHP quotes the same terms',
  phpQuote.repay === quote.repay && phpQuote.dueRound === quote.dueRound,
  phpQuote.repay + '/' + phpQuote.dueRound
);

const cashBeforeLoan = borrower.cash;
const taken = CMP.campaign.takeLoan(borrower, cfgLoan.minAmount);
check('taking a loan adds cash', borrower.cash === cashBeforeLoan + taken.amount);
check('and records the debt separately', CMP.campaign.debtOf(borrower) === taken.repay);
check('cash and debt are different numbers', borrower.cash !== CMP.campaign.debtOf(borrower));

// The debt limit holds, however many loans are taken.
const stacker = freshGame();
let loops = 0;
while (CMP.campaign.loanOffer(stacker, cfgLoan.minAmount).ok && loops++ < 30) {
  CMP.campaign.takeLoan(stacker, cfgLoan.minAmount);
}
check('several loans can be held at once', stacker.loans.length > 1, String(stacker.loans.length));
check(
  'the debt limit is never passed',
  CMP.campaign.debtOf(stacker) <= cfgLoan.debtLimit,
  CMP.campaign.debtOf(stacker) + ' of ' + cfgLoan.debtLimit
);
check(
  'and borrowing past it is refused with a reason',
  /debt limit/i.test(CMP.campaign.loanOffer(stacker, cfgLoan.minAmount).error || '')
);
check(
  'one maximum loan also fits inside the limit',
  CMP.campaign.loanOffer(freshGame(), cfgLoan.maxAmount).ok === true
);

// Borrowing late is refused, because the bill would land after election day.
const lateBorrow = freshGame();
lateBorrow.round = cfgLoan.noBorrowingAfterRound + 1;
check(
  'borrowing too late is refused',
  CMP.campaign.loanOffer(lateBorrow, cfgLoan.minAmount).ok === false
);

// Repayment on time.
const payer = freshGame();
CMP.campaign.takeLoan(payer, cfgLoan.minAmount);
const owed = CMP.campaign.debtOf(payer);
const cashBeforeDue = payer.cash;
payer.round = payer.loans[0].dueRound;
const paidSummary = { repayments: [] };
CMP.campaign.settleLoans(payer, paidSummary);
check('a loan is repaid when it falls due', payer.cash === cashBeforeDue - owed, String(payer.cash));
check('the debt clears', CMP.campaign.debtOf(payer) === 0);
check('and the summary says so', paidSummary.repayments.length === 1 && !paidSummary.repayments[0].defaulted);

// Defaulting.
const defaulter = freshGame();
CMP.campaign.takeLoan(defaulter, cfgLoan.maxAmount);
defaulter.cash = 0;
defaulter.round = defaulter.loans[0].dueRound;
const defSummary = { repayments: [] };
CMP.campaign.settleLoans(defaulter, defSummary);
check('a player who cannot pay defaults', defSummary.repayments[0].defaulted === true);
check('cash never goes negative', defaulter.cash === 0, String(defaulter.cash));
check('defaulting raises heat', defaulter.heat >= CMP.FINANCE.default.heat);
check('and blocks further borrowing', defaulter.borrowingBlocked === true);
check(
  'a blocked player is told why',
  /default/i.test(CMP.campaign.loanOffer(defaulter, cfgLoan.minAmount).error || '')
);

const phpDefault = php(
  'settle',
  JSON.stringify({
    player: {
      partyId: 'aap',
      cash: 0,
      heat: 0,
      record: { restrictedUntilTurn: 0 },
      loans: [{ id: 'L1', amount: 1000000, interest: 200000, repay: 1200000, takenRound: 1, dueRound: 3, settled: false }],
    },
    round: 3,
  })
);
check('PHP defaults the same way', phpDefault.repayments[0].defaulted === true);
check('PHP never lets cash go negative', phpDefault.cash === 0, String(phpDefault.cash));
check('PHP blocks borrowing after a default', phpDefault.borrowingBlocked === true);

/* ------------------------------------------------------------- funding */

section('Raising money');

const grant = CMP.getAction('grant');
const underground = CMP.getAction('underground');
check('a grant action exists', !!grant);
check('an undisclosed funding action exists', !!underground);
check('both sit outside safe and risky', grant.group === 'funding' && underground.group === 'funding');
check('a grant carries no heat', (grant.outcomes || []).every((o) => !o.heat));
check(
  'undisclosed funding always carries heat',
  (underground.outcomes || []).every((o) => o.heat > 0)
);
check(
  'neither describes a real-world method',
  !/how to|contact|arrange with/i.test(grant.blurb + underground.blurb)
);

const funded = freshGame();
const cashBeforeGrant = funded.cash;
const grantRes = CMP.campaign.play(funded, 'grant', 73, { outcome: 0.05, consequence: 0.99, consequencePick: 0.5 });
check('a grant resolves', grantRes.ok === true);
check('a funded outcome pays into cash', funded.cash > cashBeforeGrant - grant.cost, String(funded.cash));
check('grants are tracked apart from other funding', funded.granted > 0 && funded.raised === 0);

const shady = freshGame();
CMP.campaign.play(shady, 'underground', null, { outcome: 0.05, consequence: 0.99, consequencePick: 0.5 });
check('undisclosed funding pays in', shady.raised > 0, String(shady.raised));
check('and is tracked apart from grants', shady.granted === 0);
check('and raises heat sharply', shady.heat >= 20, String(shady.heat));

const phpFund = php(
  'play',
  JSON.stringify({
    player: { partyId: 'aap', budget: CMP.STARTING_BUDGET, cash: CMP.STARTING_BUDGET, spent: 0, heat: 0, granted: 0, raised: 0, actions: [] },
    board: JSON.parse(JSON.stringify(freshGame().support)),
    actionId: 'grant',
    target: 73,
    rolls: { outcome: 0.05, consequence: 0.99, consequencePick: 0.5, spare: 0.1 },
  })
);
check('PHP resolves a grant to the same outcome', phpFund.report.outcomeId === grantRes.report.outcomeId,
  phpFund.report.outcomeId + ' vs ' + grantRes.report.outcomeId);
check('PHP credits the same cash', phpFund.cash === funded.cash, phpFund.cash + ' vs ' + funded.cash);

/* -------------------------------------------------------------- events */

section('Round events');

const jsEvents = [];
for (let i = 0; i < 100; i++) {
  jsEvents.push(CMP.campaign.weightedPick(CMP.EVENTS.list, i / 100).id);
}
const phpEvents = php('events', 'x', '100');
check('both sides pick the same events from the same rolls',
  JSON.stringify(jsEvents) === JSON.stringify(phpEvents));

let eventsFired = 0;
for (let i = 0; i < 200; i++) {
  const gg = freshGame();
  const rand = CMP.rng.create('event-' + i);
  if (CMP.campaign.rollEvent(gg, rand)) eventsFired++;
}
check(
  'events fire roughly as often as configured',
  Math.abs(eventsFired / 200 - CMP.EVENTS.chancePerRound) < 0.12,
  Math.round((eventsFired / 200) * 100) + '% vs ' + Math.round(CMP.EVENTS.chancePerRound * 100) + '%'
);
check('most rounds are decided by players, not events', eventsFired / 200 < 0.6);

/* --------------------------------------------------------- money never negative */

section('Cash can never go negative');

const squeeze = freshGame();
let squeezeGuard = 0;
while (squeezeGuard++ < 400) {
  const affordable = CMP.ACTIONS.filter((a) => a.cost <= squeeze.cash);
  if (!affordable.length) break;
  const pick = affordable[squeezeGuard % affordable.length];
  CMP.campaign.play(squeeze, pick.id, pick.needsConstituency ? 73 : null, {
    outcome: (squeezeGuard % 17) / 17,
    consequence: (squeezeGuard % 13) / 13,
    consequencePick: 0.5,
  });
  if (squeeze.cash < 0) break;
}
check('cash stays at or above zero throughout', squeeze.cash >= 0, String(squeeze.cash));
check('spending is bounded by what came in',
  squeeze.spent <= squeeze.budget + squeeze.borrowed + squeeze.granted + squeeze.raised,
  squeeze.spent + ' spent');

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

  // A full campaign: fifteen rounds, three moves each.
  for (let round = 1; round <= CMP.ROUNDS.total; round++) {
    for (let move = 0; move < CMP.ROUNDS.actionsPerRound; move++) {
      const pool =
        kind === 'reckless'
          ? ['deal', 'lastpush', 'influence']
          : ['rally', 'community', 'outreach', 'media'];
      const affordable = pool.filter((id) => CMP.campaign.canPlay(gg, id, 1).ok);
      if (!affordable.length) break;
      const id = affordable[Math.floor(rand() * affordable.length)];
      // Both strategies target sensibly; only the risk appetite differs.
      const seat = seatsByCloseness()[Math.floor(rand() * 12)] || seatsByCloseness()[0];
      CMP.campaign.play(gg, id, seat.number, {
        outcome: rand(),
        consequence: rand(),
        consequencePick: rand(),
      });
    }
    if (runRound(gg)) break;
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

section('Evidence shifts the odds, and never settles them');

/*
 * Reports are not verdicts. The finding is rolled against a hidden evidence
 * score built from risky actions taken, current heat, previous penalties and
 * the number of reports — so ganging up on someone who has done nothing
 * usually fails, and a genuinely reckless player is usually caught, but
 * neither is certain.
 *
 * Sampled here rather than through the API because it needs a player put
 * deliberately into each state and a few hundred rolls to say anything.
 */
// A warning costs nothing but a headline. What actually hurts a campaign is a
// fine, a restriction or a disqualification, so the two are counted apart —
// lumping them together would call a clean player "penalised" for something
// that never touched their campaign.
const HURTS = ['fine', 'majorFine', 'restriction', 'disqualification'];

function sampleFindings(label, spec, runs) {
  const counts = {};
  let cleared = 0;
  let damaging = 0;
  let disqualified = 0;

  for (let i = 0; i < runs; i++) {
    const r = php('investigate', JSON.stringify({ ...spec, seed: label + '-' + i }));
    counts[r.outcomeId] = (counts[r.outcomeId] || 0) + 1;
    if (r.outcomeId === 'cleared') cleared++;
    if (HURTS.indexOf(r.outcomeId) !== -1) damaging++;
    if (r.outcomeId === 'disqualification') disqualified++;
  }

  console.log('  ' + label.padEnd(22) + cleared + ' cleared, ' + damaging +
    ' really hurt, of ' + runs + '   ' + JSON.stringify(counts));
  return { cleared, damaging, disqualified, runs, counts };
}

const FINDING_RUNS = 60;
const cleanPlayer = sampleFindings('clean, ganged up on', { cash: 50000000, heat: 0, risky: 0 }, FINDING_RUNS);
const dirtyPlayer = sampleFindings('six risky actions', { cash: 50000000, heat: 85, risky: 6 }, FINDING_RUNS);

check(
  'ganging up on a clean player usually fails',
  cleanPlayer.cleared > FINDING_RUNS / 2,
  cleanPlayer.cleared + ' cleared of ' + FINDING_RUNS
);
check(
  'and rarely does them real damage',
  cleanPlayer.damaging < FINDING_RUNS * 0.25,
  cleanPlayer.damaging + ' damaging of ' + FINDING_RUNS
);
check(
  'but reporting one is not pointless either',
  cleanPlayer.cleared < FINDING_RUNS,
  'never anything but cleared'
);
check(
  'a reckless player is caught far more often',
  dirtyPlayer.damaging > cleanPlayer.damaging * 2,
  dirtyPlayer.damaging + ' vs ' + cleanPlayer.damaging
);
check(
  'and even so is sometimes cleared',
  dirtyPlayer.cleared >= 1,
  dirtyPlayer.cleared + ' of ' + FINDING_RUNS
);
check(
  'a clean player is never disqualified outright',
  cleanPlayer.disqualified === 0,
  cleanPlayer.disqualified + ' disqualified'
);
check(
  'disqualification stays rare even for a reckless one',
  dirtyPlayer.disqualified <= FINDING_RUNS * 0.1,
  dirtyPlayer.disqualified + ' of ' + FINDING_RUNS
);

section('A fine can never push cash below zero');

/*
 * Fines are charged against cash in hand. The interesting case is a fine
 * larger than the balance: the rest must not become a negative number, it must
 * become a different penalty. That needs a chosen balance rather than one that
 * happens to arise from play, so it is driven straight into the PHP rules here.
 */
const fineRuns = [];
for (let i = 0; i < 30; i++) {
  fineRuns.push(php('investigate', JSON.stringify({ cash: 500000, heat: 95, risky: 8, seed: 'fine-' + i })));
}
const charged = fineRuns.filter((r) => r.fineCharged > 0);

check('the sample produced some fines', charged.length > 0, charged.length + ' of 30');
check(
  'cash never lands below zero',
  fineRuns.every((r) => r.cashAfter >= 0),
  JSON.stringify(fineRuns.find((r) => r.cashAfter < 0) || {})
);
check(
  'never more is taken than was held',
  fineRuns.every((r) => r.finesPaid <= r.cashBefore),
  JSON.stringify(fineRuns.find((r) => r.finesPaid > r.cashBefore) || {})
);

const shortfalls = fineRuns.filter((r) => r.note);
check('a fine beyond reach becomes another penalty instead', shortfalls.length > 0,
  shortfalls.length + ' of 30 could not be paid in full');
check(
  'and that penalty is a campaign restriction',
  shortfalls.every((r) => r.restrictTurns > 0),
  JSON.stringify(shortfalls.find((r) => !r.restrictTurns) || {})
);

// A player who can afford it simply pays.
const rich = php('investigate', JSON.stringify({ cash: 50000000, heat: 95, risky: 8, seed: 'fine-0' }));
check('a player who can afford a fine pays it in full',
  rich.cashAfter === rich.cashBefore - rich.fineCharged,
  rich.cashBefore + ' - ' + rich.fineCharged + ' = ' + rich.cashAfter);
check('and takes no substitute penalty for it', rich.note === '' || !rich.note, rich.note);

section('The scoreboard reports the round honestly');

/*
 * The leaderboard, seat changes and the leader banner are worked out once and
 * shipped whole, so this is where they are checked. A real campaign rarely
 * changes leader — an incumbent bloc holding ninety-four seats tends to keep
 * leading — so the interesting cases are built directly rather than waited for.
 */
const boardGame = freshGame();
CMP.campaign.play(boardGame, 'rally', 73, { outcome: 0.2, consequence: 0.99, consequencePick: 0.5 });
CMP.campaign.endRound(boardGame);

const board1 = boardGame.lastResult;
check('a settled round produces a scoreboard', !!board1);
check('it names all four playable parties', board1.standings.length === 4);
check('it ranks them by seats',
  board1.standings.every((r, i, a) => i === 0 || a[i - 1].seats >= r.seats));
check('the leader is the top of the ranking', board1.leadParty === board1.standings[0].party);
check('the leader gap matches the top two',
  board1.leadGap === board1.standings[0].seats - board1.standings[1].seats);
check('seats needed counts up to the majority',
  board1.seatsNeeded === Math.max(0, board1.majority - board1.standings[0].seats));
check('every candidate carries a portrait seed',
  board1.standings.every((r) => !!r.portraitSeed));
check('the player is not marked as an opponent',
  board1.standings.filter((r) => !r.isAI).length === 1);
check('three opponents fill the other parties',
  board1.standings.filter((r) => r.isAI).length === 3);
// The opening leader map is recorded when the campaign starts, so round one
// has a real baseline and reports the seats that actually moved during it —
// rather than announcing all 117 as though every one had changed hands.
check('the first round reports only the seats that moved',
  board1.changeCount < 117 && board1.changeCount >= 0,
  board1.changeCount + ' of 117');
check('and each one names a different holder before and after',
  board1.changes.every((c) => c.from !== c.to));

/* A second round can change hands, and the diff must find exactly those. */
CMP.campaign.startNextRound(boardGame);
const beforeLeaders = JSON.parse(JSON.stringify(boardGame.leaders));
for (let i = 0; i < 3; i++) {
  CMP.campaign.play(boardGame, 'lastpush', 40 + i, { outcome: 0.05, consequence: 0.99, consequencePick: 0.5 });
}
CMP.campaign.endRound(boardGame);
const board2 = boardGame.lastResult;

const expected = Object.keys(boardGame.leaders).filter(
  (k) => beforeLeaders[k] && beforeLeaders[k] !== boardGame.leaders[k]
);
check('the second round reports the seats that changed hands',
  board2.changeCount === expected.length,
  board2.changeCount + ' reported, ' + expected.length + ' actually changed');
check('each change names who held it and who holds it now',
  board2.changes.every((c) => c.from && c.to && c.from !== c.to && c.seat > 0));
check('the shown list is capped',
  board2.changes.length <= CMP.CAMPAIGN.scoreboard.maxSeatChangesShown);
check('and the rest are counted rather than silently dropped',
  board2.changesHidden === Math.max(0, board2.changeCount - board2.changes.length));

/*
 * The leader banner. A real campaign rarely changes leader — an incumbent
 * bloc holding ninety-four seats tends to keep leading — so the previous
 * leader is set to somebody else and the round replayed. That is exactly the
 * comparison the banner makes.
 */
check('no leader change is announced when the leader holds',
  board2.newLeader === false, String(board2.newLeader));

CMP.campaign.startNextRound(boardGame);
const trueLeader = boardGame.lastResult.leadParty;
const pretender = CMP.PLAYABLE_PARTIES.map((p) => p.id).find((id) => id !== trueLeader);
boardGame.leadParty = pretender;
CMP.campaign.play(boardGame, 'rally', 12, { outcome: 0.3, consequence: 0.99, consequencePick: 0.5 });
CMP.campaign.endRound(boardGame);
const board3 = boardGame.lastResult;

check('a change of leader is announced when it happens',
  board3.newLeader === true && board3.leadParty !== pretender,
  board3.leadParty + ' took over from ' + board3.previousLeader);
check('and it says who lost the lead', board3.previousLeader === pretender, board3.previousLeader);

/* The close-race warning fires on the configured margin, and not otherwise. */
check('a close race is flagged only when the top two are near',
  board3.closeRace === (board3.leadGap <= CMP.CAMPAIGN.scoreboard.closeRaceSeats),
  'gap ' + board3.leadGap + ', threshold ' + CMP.CAMPAIGN.scoreboard.closeRaceSeats);
check('the totals on the scoreboard add up to the board',
  board3.totalSeats === CMP.TOTAL_SEATS, String(board3.totalSeats));

section('Money must not decide the game');

/*
 * The brief is explicit: a player with more money should not automatically
 * win, and strategy should matter as much as budget. Four approaches play full
 * campaigns, varying one thing at a time — careful and bigspender differ only
 * in money, careful and scattergun only in aim.
 *
 * tools/balance-money.mjs is the same simulation with a fuller report; this is
 * the part worth failing a build over.
 */
const SAFE_IDS = CMP.actionsByGroup('safe').map((a) => a.id);
const RISKY_IDS = CMP.actionsByGroup('risky').map((a) => a.id);

function withinBudget(ids, g, limit) {
  return ids
    .map((id) => CMP.getAction(id))
    .filter((a) => a.cost <= limit && CMP.campaign.canPlay(g, a.id, 1).ok);
}

const PLANS = {
  careful: { borrow: false, pick: (g, l) => withinBudget(SAFE_IDS, g, l).sort((a, b) => a.cost - b.cost)[0], aim: 'marginal' },
  bigspender: { borrow: true, pick: (g, l) => withinBudget(SAFE_IDS, g, l).sort((a, b) => b.cost - a.cost)[0], aim: 'marginal' },
  gambler: { borrow: true, pick: (g, l) => withinBudget(RISKY_IDS, g, l).sort((a, b) => b.cost - a.cost)[0], aim: 'marginal' },
  scattergun: { borrow: false, pick: (g, l) => withinBudget(SAFE_IDS, g, l).sort((a, b) => a.cost - b.cost)[0], aim: 'spread' },
};

function campaignFor(name, seed) {
  const plan = PLANS[name];
  const g = CMP.state.startElection({
    partyId: 'aap', candidateName: 'Bot', slogan: 'Bot', seed: 'balance:' + seed,
  });
  const rand = CMP.rng.create('moves:' + name + ':' + seed);
  const marginals = () =>
    CMP.CONSTITUENCIES.map((c) => CMP.campaign.seatView(g, c.number))
      .filter(Boolean)
      .sort((a, b) => a.margin - b.margin);

  for (let round = 1; round <= CMP.ROUNDS.total; round++) {
    if (plan.borrow) {
      const offer = CMP.campaign.loanOffer(g, CMP.FINANCE.loan.maxAmount);
      if (offer.ok && g.cash + offer.amount > CMP.campaign.debtOf(g) + offer.repay) {
        CMP.campaign.takeLoan(g, offer.amount);
      }
    }
    const dueSoon = (g.loans || [])
      .filter((l) => !l.settled && l.dueRound <= round)
      .reduce((t, l) => t + l.repay, 0);

    for (let move = 0; move < CMP.ROUNDS.actionsPerRound; move++) {
      const action = plan.pick(g, Math.max(0, g.cash - dueSoon));
      if (!action) break;
      const pool = marginals();
      const seat = plan.aim === 'marginal'
        ? pool[Math.floor(rand() * 8)] || pool[0]
        : pool[Math.floor(rand() * pool.length)] || pool[0];
      CMP.campaign.play(g, action.id, action.needsConstituency ? seat.number : null, {
        outcome: rand(), consequence: rand(), consequencePick: rand(),
      });
    }
    if (runRound(g)) break;
  }

  const result = CMP.campaign.runElection(g);
  const mine = result.standings.find((r) => r.party === g.partyId);
  return { seats: mine ? mine.seats : 0, cash: g.cash, spent: g.spent };
}

const BALANCE_GAMES = 24;
const planNames = Object.keys(PLANS);
const tally = {};
planNames.forEach((n) => {
  tally[n] = { seats: [], wins: 0 };
});

for (let i = 0; i < BALANCE_GAMES; i++) {
  const played = planNames.map((n) => ({ name: n, ...campaignFor(n, i) }));
  played.forEach((r) => tally[r.name].seats.push(r.seats));
  tally[played.slice().sort((a, b) => b.seats - a.seats)[0].name].wins++;
}

const avg = (n) => tally[n].seats.reduce((a, b) => a + b, 0) / tally[n].seats.length;
const moneyEdge = avg('bigspender') - avg('careful');
const aimEdge = avg('careful') - avg('scattergun');
const topShare = Math.max.apply(null, planNames.map((n) => tally[n].wins)) / BALANCE_GAMES;

planNames.forEach((n) => {
  console.log('  ' + n.padEnd(12) + avg(n).toFixed(1).padStart(6) + ' seats   ' +
    tally[n].wins + '/' + BALANCE_GAMES + ' games');
});

check(
  'spending more does not decide the game',
  Math.abs(moneyEdge) < 4,
  'money edge ' + moneyEdge.toFixed(1) + ' seats'
);
check(
  'aiming well matters more than spending more',
  aimEdge > Math.abs(moneyEdge),
  'aim ' + aimEdge.toFixed(1) + ' vs money ' + moneyEdge.toFixed(1)
);
check('aiming well is a real advantage', aimEdge > 2, aimEdge.toFixed(1) + ' seats');
check(
  'no single approach dominates',
  topShare <= 0.75,
  Math.round(topShare * 100) + '% of games'
);
check(
  'every approach can still win a majority sometimes',
  planNames.every((n) => Math.max.apply(null, tally[n].seats) >= CMP.MAJORITY)
);

section('Everything is configurable');

check('config exposes starting budget', typeof CMP.CAMPAIGN.startingBudget === 'number');
check('config exposes heat levels', CMP.CAMPAIGN.heat.levels.length === 4);
check('config exposes consequences', CMP.CAMPAIGN.consequences.length >= 4);
check('four safe actions', CMP.actionsByGroup('safe').length === 4);
check('four risky actions', CMP.actionsByGroup('risky').length === 4);
check(
  'every action declares a risk and an impact label',
  CMP.ACTIONS.every((a) => a.riskLabel && a.impactLabel)
);
check(
  'every campaign action costs something',
  CMP.ACTIONS.filter((a) => a.group !== 'funding').every((a) => a.cost > 0)
);
// Undisclosed funding is free to accept on purpose: it is the move a
// campaign with no cash left can still make, and heat is what it costs.
check(
  'undisclosed funding costs nothing up front but plenty in heat',
  CMP.getAction('underground').cost === 0 &&
    CMP.getAction('underground').outcomes.every((o) => o.heat > 0)
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
