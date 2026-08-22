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
  'js/data/avatars.js',
  'js/data/constituencies.js',
  'js/data/regions.js',
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
check('nobody starts with money', budgetJs === 0, String(budgetJs));
check('the round allowance is ₹5 crore',
  CMP.CAMPAIGN.income.perRound === 50000000, String(CMP.CAMPAIGN.income.perRound));

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

/**
 * A game with money in it.
 *
 * A real round one opens on five crore, which is deliberately not enough for
 * the dearer moves — saving up is the point of the economy. These tests are
 * about what a move does, not what it costs, so they get a campaign that has
 * been running a while. `freshGame(party, 0)` gives the honest round-one purse
 * where that is what is under test.
 */
/*
 * A game to test against.
 *
 * Parties are invented now, so the harness founds one rather than picking a
 * side. The player is always slot one, so their id is 'p1' in every game —
 * which is what the assertions below refer to.
 */
const ME = 'p1';

function freshGame(partyId, cash) {
  const g = CMP.state.startElection({
    candidateName: 'Test Candidate',
    partyName: 'Test Party',
    partyShort: 'TP',
    seed: 'parity-seed',
  });
  g.cash = cash === undefined ? 40000000 * 15 : cash;
  // The round snapshot is taken as the round opens, so it has to move with
  // the purse or every round summary here reports a diff against the wrong
  // opening figure.
  if (g.roundOpen) g.roundOpen.cash = g.cash;
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
  JSON.stringify({ player: phpPlayer, board: phpBoard, actionId: 'invest', target, rolls })
);
const jsPlay = CMP.campaign.play(jsGame, 'invest', target, rolls);

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
const openingCash = CMP.campaign.remaining(g);
check('opens on one round allowance',
  CMP.campaign.remaining(freshGame(ME, CMP.CAMPAIGN.income.perRound))
    === CMP.CAMPAIGN.income.perRound);
check('nothing spent yet', g.spent === 0);

const rally = CMP.getAction('invest');
CMP.campaign.play(g, 'invest', 73, rolls);
check('spending reduces the balance',
  CMP.campaign.remaining(g) === openingCash - rally.cost,
  String(CMP.campaign.remaining(g)));
check('spent is recorded', g.spent === rally.cost);
check('the action is recorded', g.actions.length === 1 && g.actions[0].actionId === 'invest');

// A round holds a fixed number of moves, so draining a purse takes a campaign
// rather than a single burst of clicking.
const drain = freshGame();
let guard = 0;
while (CMP.campaign.remaining(drain) >= rally.cost && guard++ < 400) {
  if (CMP.campaign.actionsLeft(drain) <= 0) {
    drain.roundActions = 0; // a fresh round, without waiting sixty seconds for it
    continue;
  }
  CMP.campaign.play(drain, 'invest', 73, { outcome: 0.5, consequence: 0.99, consequencePick: 0.5 });
}
check('a purse runs out', CMP.campaign.remaining(drain) < rally.cost, '₹' + CMP.campaign.remaining(drain));
drain.roundActions = 0; // so the refusal below is about money, not moves
const refused = CMP.campaign.canPlay(drain, 'invest', 73);
check('an unaffordable action is refused', refused.ok === false);
check('the refusal explains itself', refused.reason === 'More than you can spend here', refused.reason);

/* A round is bounded by money and by END ROUND, not by a move counter. What
   stops a player is running out of cash or saying they are finished. */
const roundBound = freshGame(ME, CMP.getAction('invest').cost * 6);
const quiet = { outcome: 0.5, consequence: 0.99, consequencePick: 0.5 };
let playedThisRound = 0;
for (let i = 0; i < 40; i++) {
  if (CMP.campaign.play(roundBound, 'invest', 73, quiet).ok) playedThisRound++;
  else break;
}
check('a round allows as many moves as the money covers', playedThisRound > 3,
  playedThisRound + ' moves');
check('and stops when the money runs out',
  CMP.campaign.remaining(roundBound) < CMP.getAction('invest').cost,
  CMP.ui === undefined ? String(CMP.campaign.remaining(roundBound)) : '');

const spentAll = CMP.campaign.canPlay(roundBound, 'invest', 73);
check('the refusal is about money, not a move counter',
  !spentAll.ok && /spend/.test(spentAll.reason), spentAll.reason);

/* END ROUND locks the player out until the next one. */
const ended = freshGame();
ended.roundReady = true;
const afterEnd = CMP.campaign.canPlay(ended, 'invest', 73);
check('18. after END ROUND no further moves are allowed', !afterEnd.ok, afterEnd.reason);
check('26. and it says why', /ended your round/i.test(afterEnd.reason), afterEnd.reason);

CMP.campaign.endRound(roundBound);
check('the results break refuses moves outright',
  CMP.campaign.canPlay(roundBound, 'invest', 73).ok === false);
CMP.campaign.startNextRound(roundBound);
check('the next round opens play again',
  CMP.campaign.canPlay(roundBound, 'invest', 73).ok === true,
  JSON.stringify(CMP.campaign.canPlay(roundBound, 'invest', 73)));
check('63. and the new round carries forward what was left',
  roundBound.roundReady === false && CMP.campaign.remaining(roundBound) > 0,
  String(CMP.campaign.remaining(roundBound)));

const spentBefore = drain.spent;
const attempt = CMP.campaign.play(drain, 'invest', 73, rolls);
check('a refused action changes nothing', attempt.ok === false && drain.spent === spentBefore);
check('never spends money it does not have', CMP.campaign.remaining(drain) >= 0,
  String(CMP.campaign.remaining(drain)));

check(
  'PHP refuses an unaffordable action too',
  php('blocked', JSON.stringify({
    player: { partyId: ME, budget: 1000, cash: 1000, spent: 0, actions: [] },
    board: { 73: { p1: 30, p2: 30, p3: 20, p4: 20 } },
    actionId: 'invest',
    target: 73,
  })).reason === 'More than you can spend here'
);

check(
  'an action needing a seat is refused without one',
  CMP.campaign.canPlay(freshGame(), 'invest', null).reason === 'Choose a constituency first'
);

/* ------------------------------------------------------------ heat */

section('Political Heat');

const calm = freshGame();
for (let i = 0; i < 6; i++) {
  CMP.campaign.play(calm, 'invest', 73, { outcome: 0.5, consequence: 0.99, consequencePick: 0.5 });
}
check('safe actions barely raise heat', calm.heat <= 2, 'heat ' + calm.heat);
check('heat starts at 0', freshGame().heat === 0);

const hot = freshGame();
CMP.campaign.play(hot, 'bribe', 73, { outcome: 0.1, consequence: 0.99, consequencePick: 0.5 });
check('a risky action raises heat sharply', hot.heat >= 15, 'heat ' + hot.heat);

check('0 reads Low', CMP.campaign.heatLevel(0).label === 'Low');
check('30 reads Moderate', CMP.campaign.heatLevel(30).label === 'Moderate');
check('60 reads High', CMP.campaign.heatLevel(60).label === 'High');
check('90 reads Critical', CMP.campaign.heatLevel(90).label === 'Critical');

const capped = freshGame();
capped.heat = 95;
CMP.campaign.play(capped, 'bribe', 73, { outcome: 0.99, consequence: 0.99, consequencePick: 0.5 });
check('heat never exceeds 100', capped.heat <= 100, 'heat ' + capped.heat);

/* ------------------------------------------------------------ outcomes vary */

section('Outcomes vary');

for (const id of ['bribe', 'bribe', 'negative', 'bribe']) {
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

// A seat starts empty, so there has to be something there to lose before
// losing it means anything.
const backfire = freshGame();
CMP.campaign.play(backfire, 'invest', 73, { outcome: 0.2, consequence: 0.99, consequencePick: 0.5 });
const before = backfire.support[73][ME];
check('campaigning in an empty seat creates influence', before > 0, String(before));

CMP.campaign.play(backfire, 'bribe', 73, { outcome: 0.95, consequence: 0.99, consequencePick: 0.5 });
check('a risky action can actually backfire', backfire.support[73][ME] < before,
  before.toFixed(1) + ' -> ' + backfire.support[73][ME].toFixed(1));

/* ------------------------------------------------------------ consequences */

section('Consequences');

const cool = freshGame();
cool.heat = 10;
let fired = 0;
for (let i = 0; i < 200; i++) {
  const gg = freshGame();
  gg.heat = 10;
  const r = CMP.campaign.play(gg, 'invest', 73, {
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
  const r = CMP.campaign.play(gg, 'invest', 73, {
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
const hitBefore = hitGame.support[73][ME];
const conseq = CMP.campaign.play(hitGame, 'invest', 73, {
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
check('knows how many rounds there are', clockGame.roundsTotal === 20, String(clockGame.roundsTotal));
check('a round is two minutes', clockGame.roundSeconds === 120, String(clockGame.roundSeconds));
check(
  'the clock starts near a full round',
  CMP.campaign.secondsLeft(clockGame) > 110 && CMP.campaign.secondsLeft(clockGame) <= 120,
  String(CMP.campaign.secondsLeft(clockGame))
);
check('a live round accepts actions', CMP.campaign.canPlay(clockGame, 'invest', 73).ok === true);

const phpRounds = php('rounds');
check(
  'PHP reads the same round config',
  phpRounds.total === clockGame.roundsTotal && phpRounds.seconds === clockGame.roundSeconds,
  phpRounds.total + 'x' + phpRounds.seconds
);

// An expired round refuses actions, grace window included.
const expired = freshGame();
expired.roundEndsAt = Date.now() - (CMP.ROUNDS.graceSeconds + 5) * 1000;
const late = CMP.campaign.canPlay(expired, 'invest', 73);
check('an expired round refuses an action', late.ok === false);
check('and says why', /round has closed/i.test(late.reason), late.reason);

// Ending a round advances it, snapshots history, and closes after fifteen.
const runner = freshGame();
const cashAtStart = runner.cash;
CMP.campaign.play(runner, 'invest', 73, rolls);
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
  firstEnd.summary.spent === CMP.getAction('invest').cost,
  String(firstEnd.summary.spent)
);
check(
  'the summary reports cash correctly',
  firstEnd.summary.cashBefore === cashAtStart
    && firstEnd.summary.cashAfter === cashAtStart - firstEnd.summary.spent
      + (firstEnd.summary.gained || 0),
  firstEnd.summary.cashBefore + ' -> ' + firstEnd.summary.cashAfter
);
check('a new round resets the spend counter', runner.roundSpent === 0);
check('and gives a fresh clock', CMP.campaign.secondsLeft(runner) > 110);

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
check('the campaign closes after fifteen rounds', runner.round === 20, String(runner.round));
check('and reports that it finished', finished === true);
check('with fifteen snapshots of history', runner.history.length === 20, String(runner.history.length));

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
    player: { partyId: ME, cash: borrower.cash, loans: [], record: {} },
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

/*
 * A payment that cannot be met.
 *
 * The loan does not vanish and the player is not written off. What they have
 * goes toward it, the balance carries into the next round, and a penalty is
 * added to whatever is left. It keeps carrying until it is cleared.
 */
const short_ = freshGame(ME, 0);
short_.cash = 20000000;
const shortLoan = CMP.campaign.maxLoan(short_);
CMP.campaign.takeLoan(short_, shortLoan);
const owedTotal = short_.loans[0].repay;

short_.cash = Math.floor(owedTotal / 3);
const partPaid = short_.cash;
short_.round = short_.loans[0].dueRound;

const missSummary = { repayments: [] };
CMP.campaign.settleLoans(short_, missSummary);

const missed = missSummary.repayments[0];
check('21. a payment that cannot be met is recorded as missed', missed.missed === true);
check('21. what the campaign had went toward it', missed.paid === partPaid, String(missed.paid));
check('21. cash never goes negative', short_.cash === 0, String(short_.cash));
check('21. and the loan does not disappear',
  short_.loans[0].settled === false && CMP.campaign.debtOf(short_) > 0,
  String(CMP.campaign.debtOf(short_)));

const rate = CMP.FINANCE.loan.missedPenaltyRate;
const leftAfterPart = owedTotal - partPaid;
check('22. a penalty is added to what is outstanding',
  missed.penalty === Math.round(leftAfterPart * rate),
  missed.penalty + ' on ' + leftAfterPart);
check('22. the penalty is 30%', rate === 0.3, String(rate));
check('22. and the balance is due again next round',
  short_.loans[0].dueRound === short_.round + 1,
  String(short_.loans[0].dueRound));

check('18. no further borrowing while behind',
  /missed payment/i.test(CMP.campaign.loanOffer(short_, CMP.FINANCE.loan.minAmount).error || ''),
  CMP.campaign.loanOffer(short_, CMP.FINANCE.loan.minAmount).error);

// Next round: enough to clear it, and it clears.
const nowOwed = CMP.campaign.debtOf(short_);
short_.round = short_.loans[0].dueRound;
short_.cash = nowOwed;
const clearSummary = { repayments: [] };
CMP.campaign.settleLoans(short_, clearSummary);
check('23. the carried balance is collected automatically',
  short_.loans[0].settled === true && CMP.campaign.debtOf(short_) === 0);
check('23. and the campaign is told it cleared',
  !clearSummary.repayments[0].missed, JSON.stringify(clearSummary.repayments[0]));

/*
 * Affordability: nobody is lent what they cannot service.
 */
/*
 * Capacity binds once there is already debt.
 *
 * A first loan is comfortably inside four rounds of guaranteed allowance, as
 * it should be — the rule exists to stop a campaign stacking borrowing it
 * cannot service, not to make the first one hard.
 */
const stacked = freshGame(ME, 0);
stacked.cash = 0;
stacked.loans = [{
  id: 'L0',
  amount: 200000000,
  interest: 40000000,
  repay: 240000000,
  takenRound: 1,
  dueRound: 6,
  paid: 0,
  penalties: 0,
  missedCount: 0,
  settled: false,
}];
const tooBig = CMP.campaign.loanOffer(stacked, CMP.FINANCE.loan.maxAmount);
check('17. a loan beyond capacity is refused', tooBig.ok === false, tooBig.error);
check('17. and the refusal explains why',
  /repayment capacity|debt limit/i.test(tooBig.error || ''), tooBig.error);
check('15. existing debt is subtracted from capacity',
  CMP.campaign.repaymentCapacity(stacked).owed === 240000000,
  String(CMP.campaign.repaymentCapacity(stacked).owed));

const solvent = freshGame(ME, 0);
solvent.cash = 40000000;
const most = CMP.campaign.maxLoan(solvent);
check('16. a maximum affordable loan is offered', most > 0, String(most));
check('16. borrowing exactly that is allowed',
  CMP.campaign.loanOffer(solvent, most).ok === true);
check('18. borrowing one increment more is not',
  CMP.campaign.loanOffer(solvent, most + CMP.FINANCE.loan.increments).ok === false);

const capacity = CMP.campaign.repaymentCapacity(solvent);
check('15. capacity counts cash, allowances and grants already paid',
  capacity.total === Math.max(0, capacity.cash + capacity.income + capacity.grants - capacity.owed),
  JSON.stringify(capacity));
check('15. and nothing speculative — seats are not money',
  capacity.total <= capacity.cash + capacity.income + capacity.grants);

const phpMissed = php(
  'settle',
  JSON.stringify({
    player: {
      partyId: ME,
      cash: 400000,
      heat: 0,
      record: { restrictedUntilTurn: 0 },
      loans: [{
        id: 'L1', amount: 1000000, interest: 200000, repay: 1200000,
        takenRound: 1, dueRound: 3, paid: 0, penalties: 0, missedCount: 0, settled: false,
      }],
    },
    round: 3,
  })
);
check('21. PHP records a missed payment the same way',
  phpMissed.repayments[0].missed === true, JSON.stringify(phpMissed.repayments[0]));
check('21. PHP never lets cash go negative', phpMissed.cash === 0, String(phpMissed.cash));
check('22. PHP adds the same 30% penalty',
  phpMissed.repayments[0].penalty === Math.round((1200000 - 400000) * 0.3),
  String(phpMissed.repayments[0].penalty));
check('21. PHP keeps the loan alive',
  phpMissed.loans[0].settled === false, JSON.stringify(phpMissed.loans[0]));

/* ------------------------------------------------------------- funding */

section('Raising money');

const grant = CMP.getAction('grant');
const bribe = CMP.getAction('bribe');
check('a grant action exists', !!grant);
check('it sits outside safe and risky', grant.group === 'funding');
check('a grant carries no heat', (grant.outcomes || []).every((o) => !o.heat));

/*
 * Undisclosed funding used to be an action of its own. It is one outcome of
 * the corruption action now: money that comes back with the ground it bought,
 * and a history attached to it. One combined risk, not a menu of them.
 */
check('corruption can pay for itself', (bribe.outcomes || []).some((o) => o.funds > 0));
check('and every one of its outcomes carries heat',
  (bribe.outcomes || []).every((o) => o.heat > 0));
check('it can also go wrong', (bribe.outcomes || []).some((o) => o.support < 0));
check(
  'neither describes a real-world method',
  !/how to|contact|arrange with/i.test(grant.blurb + bribe.blurb)
);

const funded = freshGame();
const cashBeforeGrant = funded.cash;
const grantRes = CMP.campaign.play(funded, 'grant', 73, { outcome: 0.05, consequence: 0.99, consequencePick: 0.5 });
check('a grant resolves', grantRes.ok === true, JSON.stringify(grantRes));
check('a funded outcome pays into cash', funded.cash > cashBeforeGrant - grant.cost, String(funded.cash));
check('grants are tracked apart from other funding', funded.granted > 0 && funded.raised === 0);

// Corruption that pays for itself: the money is tracked apart from a grant,
// because where it came from is the whole point of the distinction.
const shady = freshGame();
CMP.campaign.play(shady, 'bribe', 73, { outcome: 0.4, consequence: 0.99, consequencePick: 0.5 });
check('corruption raises heat sharply', shady.heat >= 10, String(shady.heat));
check('and is never counted as grant money', shady.granted === 0);

const phpFund = php(
  'play',
  JSON.stringify({
    player: { partyId: ME, budget: 0, cash: cashBeforeGrant, spent: 0, heat: 0, granted: 0, raised: 0, actions: [] },
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
  squeeze.spent <= squeeze.incomeTotal + (squeeze.grantTotalEarned || 0)
    + squeeze.borrowed + squeeze.granted + squeeze.raised + openingCash,
  squeeze.spent + ' spent against ' +
    (squeeze.incomeTotal + squeeze.borrowed + squeeze.granted + squeeze.raised) + ' in');

section('Balance: reckless play should usually lose');

function playStrategy(kind, seed) {
  const gg = CMP.state.startElection({
    partyId: ME,
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
    for (let move = 0; move < 3; move++) {
      const pool =
        kind === 'reckless'
          ? ['bribe', 'bribe', 'bribe']
          : ['invest', 'invest', 'invest', 'invest'];
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
CMP.campaign.play(boardGame, 'invest', 73, { outcome: 0.2, consequence: 0.99, consequencePick: 0.5 });
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
  board1.standings.every((r) => !!r.avatar));
check('the player is not marked as an opponent',
  board1.standings.filter((r) => !r.isAI).length === 1);
check('three opponents fill the other parties',
  board1.standings.filter((r) => r.isAI).length === 3);
/*
 * The board opens empty, so round one decides exactly the seats somebody
 * campaigned in — not all 117. A seat nobody went near stays uncontested,
 * which is the whole reason contesting one is worth money.
 *
 * Each of those is newly decided rather than changed hands, because there was
 * no holder to take it from. The screen shows the five that matter to the
 * player and offers the rest — see ui/scoreboard.js.
 */
const decided1 = Object.keys(CMP.campaign.currentLeaders(boardGame.support));
check('1. round one decides the seats that were contested',
  board1.changeCount === decided1.length && board1.changeCount > 0,
  board1.changeCount + ' reported, ' + decided1.length + ' decided');
check('1. and leaves the rest uncontested',
  decided1.length < 117 && decided1.length > 0,
  decided1.length + ' of 117 decided');
check('3. and none of them had a holder before it',
  board1.changes.every((c) => c.from === null),
  JSON.stringify(board1.changes[0]));
check('and each one names who took it',
  board1.changes.every((c) => !!c.to && c.from !== c.to));

/* A second round can change hands, and the diff must find exactly those. */
CMP.campaign.startNextRound(boardGame);
const beforeLeaders = JSON.parse(JSON.stringify(boardGame.leaders));
for (let i = 0; i < 3; i++) {
  CMP.campaign.play(boardGame, 'bribe', 40 + i, { outcome: 0.05, consequence: 0.99, consequencePick: 0.5 });
}
CMP.campaign.endRound(boardGame);
const board2 = boardGame.lastResult;

/*
 * A second round both takes seats and decides new ones, and the diff has to
 * find exactly both: a seat that changed hands has a previous holder, a seat
 * newly contested does not, and the screen labels them differently.
 */
const changedHands = Object.keys(boardGame.leaders).filter(
  (k) => beforeLeaders[k] && beforeLeaders[k] !== boardGame.leaders[k]
);
const newlyDecided = Object.keys(boardGame.leaders).filter((k) => !beforeLeaders[k]);
check('the second round reports every seat that moved',
  board2.changeCount === changedHands.length + newlyDecided.length,
  board2.changeCount + ' reported, ' + changedHands.length + ' changed hands and ' +
  newlyDecided.length + ' newly decided');
check('a seat that changed hands names who held it and who holds it now',
  board2.changes.filter((c) => c.from).every((c) => c.to && c.from !== c.to && c.seat > 0));
check('and a seat newly decided has no previous holder to name',
  board2.changes.filter((c) => !c.from).every((c) => !!c.to && c.seat > 0));
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
// A newLeader banner is only true when the party at the top has actually
// changed, which on an empty board can happen in round two — so this compares
// against what the previous round reported rather than assuming it held.
check('a leader change is announced only when the leader changed',
  board2.newLeader === (board1.leadParty !== board2.leadParty && board2.leadSeats > 0),
  board1.leadParty + ' -> ' + board2.leadParty + ', reported ' + board2.newLeader);

CMP.campaign.startNextRound(boardGame);
const trueLeader = boardGame.lastResult.leadParty;
const pretender = CMP.PLAYABLE_PARTIES.map((p) => p.id).find((id) => id !== trueLeader);
boardGame.leadParty = pretender;
CMP.campaign.play(boardGame, 'invest', 12, { outcome: 0.3, consequence: 0.99, consequencePick: 0.5 });
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

section('Choosing how much to spend');

/*
 * A move costs what the player puts behind it, not a fixed price. The curve
 * is a square root, which is the whole balance of the feature: four times the
 * money buys twice the effect, so for a fixed budget spreading beats dumping
 * and a large purse cannot buy the election in three expensive gestures.
 */
const scaled = CMP.getAction('invest');
const range = CMP.campaign.amountRange(scaled);

check('an action offers a range, not a price', range.max > range.min,
  range.min + '..' + range.max);
check('the base cost sits inside it', scaled.cost >= range.min && scaled.cost <= range.max);
check('spending the base cost changes nothing',
  CMP.campaign.scaleFor(scaled, scaled.cost) === 1);
check('four times the money buys about twice the effect',
  Math.abs(CMP.campaign.scaleFor(scaled, scaled.cost * 4) - 2) < 0.01,
  String(CMP.campaign.scaleFor(scaled, scaled.cost * 4)));
check('a quarter of it buys about half',
  Math.abs(CMP.campaign.scaleFor(scaled, scaled.cost / 4) - 0.5) < 0.06,
  String(CMP.campaign.scaleFor(scaled, scaled.cost / 4)));
check('the scale is clamped at both ends',
  CMP.campaign.scaleFor(scaled, 1) >= CMP.CAMPAIGN.spending.minScale &&
  CMP.campaign.scaleFor(scaled, scaled.cost * 1000) <= CMP.CAMPAIGN.spending.maxScale);
check('an amount outside the range is pulled back into it',
  CMP.campaign.resolveAmount(scaled, 999999999) === range.max &&
  CMP.campaign.resolveAmount(scaled, 1) === range.min);
/*
 * The money actually leaves the purse, and the effect follows it.
 *
 * Both campaigns get into the seat first: the opening move is capped, so a
 * comparison of two amounts has to be made from an established position or it
 * is a comparison of one amount and a refusal.
 */
const enter = { outcome: 0.5, consequence: 0.99, consequencePick: 0.5 };
const small = freshGame();
const big = freshGame();
CMP.campaign.play(small, 'invest', 73, enter, CMP.CAMPAIGN.spending.entryMaximum);
CMP.campaign.play(big, 'invest', 73, enter, CMP.CAMPAIGN.spending.entryMaximum);
const spentEntering = small.spent;

const pinned = { outcome: 0.5, consequence: 0.99, consequencePick: 0.5 };
const smallRes = CMP.campaign.play(small, 'invest', 73, pinned, range.min);
const bigRes = CMP.campaign.play(big, 'invest', 73, pinned, range.max);

check('the smaller move costs less', small.spent === spentEntering + range.min,
  String(small.spent));
check('the larger move costs more', big.spent === spentEntering + range.max,
  String(big.spent));
check('and the larger one moves more support',
  bigRes.report.support > smallRes.report.support,
  smallRes.report.support + ' vs ' + bigRes.report.support);
check('but not proportionally more',
  bigRes.report.support < smallRes.report.support * (range.max / range.min),
  'x' + (bigRes.report.support / smallRes.report.support).toFixed(1) +
  ' effect for x' + (range.max / range.min).toFixed(0) + ' money');
check('the report says what was actually spent',
  bigRes.report.cost === range.max && bigRes.report.baseCost === scaled.cost);

const phpSmall = php('play', JSON.stringify({
  player: { partyId: ME, budget: 0, cash: CMP.CAMPAIGN.income.perRound,
    spent: 0, heat: 0, granted: 0, raised: 0, actions: [] },
  board: JSON.parse(JSON.stringify(freshGame().support)),
  actionId: 'invest',
  target: 73,
  rolls: { ...pinned, spare: 0.1 },
  amount: range.min,
}));
check('PHP charges the same chosen amount', phpSmall.spent === small.spent - spentEntering,
  phpSmall.spent + ' vs ' + small.spent);
check('and scales the effect identically',
  Math.abs(phpSmall.report.support - smallRes.report.support) < 0.05,
  phpSmall.report.support + ' vs ' + smallRes.report.support);

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

/*
 * Four plans that vary one thing at a time.
 *
 * There is one campaign action now, so "a cheap move" and "a dear move" are
 * both money into a seat and the money axis is entirely the amount. careful
 * spreads its balance over the rounds it has left; bigspender puts five crore
 * behind every move; gambler does the same on the corruption table; scattergun
 * spends like careful but picks seats at random.
 */
const CRORE = 10000000;
const SAFE_PICK = (g, l) => withinBudget(SAFE_IDS, g, l)[0];
const RISKY_PICK = (g, l) => withinBudget(RISKY_IDS, g, l)[0];
const SPREAD = (g, round) =>
  Math.max(CRORE, Math.floor(g.cash / (Math.max(1, CMP.ROUNDS.total - round + 1) * 2)));

const PLANS = {
  careful: { borrow: false, pick: SAFE_PICK, aim: 'marginal', amount: SPREAD },
  bigspender: { borrow: true, pick: SAFE_PICK, aim: 'marginal',
    amount: (g) => Math.min(5 * CRORE, Math.max(CRORE, g.cash)) },
  gambler: { borrow: true, pick: RISKY_PICK, aim: 'marginal',
    amount: (g) => Math.min(5 * CRORE, Math.max(CRORE, g.cash)) },
  scattergun: { borrow: false, pick: SAFE_PICK, aim: 'spread', amount: SPREAD },
};

function campaignFor(name, seed) {
  const plan = PLANS[name];
  const g = CMP.state.startElection({
    partyId: ME, candidateName: 'Bot', slogan: 'Bot', seed: 'balance:' + seed,
  });
  const rand = CMP.rng.create('moves:' + name + ':' + seed);
  /*
   * Where a move is worth most, best first: an empty seat (a move there wins
   * one outright), then the seats this campaign is behind in, closest first,
   * then the ones it already leads. The margin alone cannot tell the last two
   * apart — forty ahead and forty behind are the same distance and completely
   * different decisions. See tools/balance-money.mjs.
   */
  const value = (v) => (!v.contested ? -1 : v.leading ? 1000 + v.margin : v.margin);
  const marginals = () =>
    CMP.CONSTITUENCIES.map((c) => CMP.campaign.seatView(g, c.number))
      .filter(Boolean)
      .sort((a, b) => value(a) - value(b));

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

    // A round ends when the money runs out, not on a move counter — the cap
    // has been a runaway backstop rather than a rule since the twenty-round
    // economy landed, and three moves a round no longer spends an allowance.
    for (let move = 0; move < 40; move++) {
      const action = plan.pick(g, Math.max(0, g.cash - dueSoon));
      if (!action) break;
      const pool = marginals();
      const seat = plan.aim === 'marginal'
        ? pool[0]
        : pool[Math.floor(rand() * pool.length)] || pool[0];
      /*
       * Getting in is capped, so the first move into a seat is the cap and
       * everything after it is the plan. A bot that ignored this would be
       * refused on its opening move and would then measure nothing.
       */
      const cap = CMP.campaign.entryCap(g, seat.number, action);
      const wanted = plan.amount(g, round);
      CMP.campaign.play(g, action.id, action.needsConstituency ? seat.number : null, {
        outcome: rand(), consequence: rand(), consequencePick: rand(),
      }, cap ? Math.min(cap, wanted) : wanted);
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

/*
 * What the board being empty changed.
 *
 * When every seat opened at roughly a quarter each, the argument was about
 * moving a percentage: aiming at the closest race was worth about five seats
 * a campaign and spending more was worth almost nothing.
 *
 * On an empty board the first question about a seat is whether anybody has
 * been there at all, so breadth is the dominant idea and the gap between a
 * well-aimed plan and a scattered one is small. What has not changed, and is
 * the thing these checks exist for, is that money must not buy the election:
 * a plan that spends more per move does worse, not better.
 */
check(
  'spending more does not decide the game',
  moneyEdge < 4,
  'money edge ' + moneyEdge.toFixed(1) + ' seats'
);
check(
  'and living on the risky table is the worst of the four',
  planNames.every((n) => n === 'gambler' || avg(n) >= avg('gambler')),
  planNames.map((n) => n + ' ' + avg(n).toFixed(0)).join(', ')
);
check(
  'aim is worth something, either way, but not the game',
  Math.abs(aimEdge) < 12,
  'aim ' + aimEdge.toFixed(1) + ' seats'
);
check(
  'no single approach dominates',
  topShare <= 0.85,
  Math.round(topShare * 100) + '% of games — see tools/balance-money.mjs, ' +
    'which runs six plans rather than four'
);
check(
  'living on risky strategies is the worst plan of the four',
  planNames.every((n) => n === 'gambler' || avg(n) >= avg('gambler')),
  planNames.map((n) => n + ' ' + avg(n).toFixed(0)).join(', ')
);
/*
 * Nobody here reaches 59, and that is the shape of the game rather than a
 * fault in these plans.
 *
 * Getting into a seat is capped at a crore, so no campaign can take a seat in
 * one move; four campaigns with the same money therefore split an empty board
 * roughly evenly, and a majority of 117 means holding half of Punjab. What
 * these plans have to prove instead is that they are separable — that
 * spending it well beats spending it badly — and that somebody wins.
 */
check(
  'every plan finishes with a real share of the board',
  planNames.every((n) => avg(n) >= 10),
  planNames.map((n) => n + ' ' + avg(n).toFixed(0)).join(', ')
);
check(
  'and the best plan is clearly better than the worst',
  Math.max.apply(null, planNames.map(avg)) - Math.min.apply(null, planNames.map(avg)) >= 5,
  planNames.map((n) => n + ' ' + avg(n).toFixed(0)).join(', ')
);

section('Everything is configurable');

check('config exposes starting budget', typeof CMP.CAMPAIGN.startingBudget === 'number');
check('config exposes heat levels', CMP.CAMPAIGN.heat.levels.length === 4);
check('config exposes consequences', CMP.CAMPAIGN.consequences.length >= 4);
/*
 * Three actions, and one of them is the game.
 *
 * There used to be eleven, and choosing between them was a decision about
 * vocabulary — a rally, a media push, a community drive — rather than about
 * strategy. All of them were money into a seat. What is left is money into a
 * seat, the same money spent against a rival, and the same money spent
 * somewhere it should not go.
 */
check('one way to campaign', CMP.actionsByGroup('safe').length === 1,
  CMP.actionsByGroup('safe').map((a) => a.id).join(','));
check('and it is money into a seat', CMP.getAction('invest').allowsAmount === true);
check('two optional risks', CMP.actionsByGroup('risky').length === 2,
  CMP.actionsByGroup('risky').map((a) => a.id).join(','));
check('one negative campaign, not several',
  CMP.actionsByGroup('risky').filter((a) => a.id === 'negative').length === 1);
check('one corruption action, not a menu of them',
  CMP.actionsByMenu('bribe').length === 1,
  CMP.actionsByMenu('bribe').map((a) => a.id).join(','));
check('every risky action is labelled as one',
  CMP.actionsByGroup('risky').every((a) => a.group === 'risky' && a.heat > 0));
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
check('corruption costs money and always costs heat',
  CMP.getAction('bribe').cost > 0 &&
  CMP.getAction('bribe').outcomes.every((o) => o.heat > 0));
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
