/**
 * Does money decide the game?
 * ------------------------------------------------------------------
 * The brief is explicit that it must not: a player with more money should not
 * automatically win, and strategy should matter as much as budget. This plays
 * full fifteen-round campaigns for four different approaches and reports how
 * they finish, so that claim is checked against evidence rather than asserted.
 *
 * The four are chosen to vary one thing at a time. careful and bigspender
 * differ only in money; careful and scattergun differ only in aim; gambler
 * differs from bigspender only in risk appetite.
 *
 *   careful     no borrowing, cheap safe moves, aimed at the closest races
 *   bigspender  borrows what it can repay, dearest safe moves, same aim
 *   gambler     borrows the same way, but lives on risky strategies
 *   scattergun  spends like careful, but picks seats at random
 *
 * If bigspender swept this, money would be deciding the game. If it always
 * came last, borrowing would be a trap nobody should ever take. What we want
 * from the money axis is a small edge; what we want from the aim axis is a
 * large one.
 *
 *   node tools/balance-money.mjs [games]
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', 'simple');
const GAMES = Number(process.argv[2] || 40);

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

const SAFE = CMP.actionsByGroup('safe').map((a) => a.id);
const RISKY = CMP.actionsByGroup('risky').map((a) => a.id);
/**
 * The affordable actions from a pool, given a spending limit that already
 * holds back anything falling due. A strategy that skipped its move whenever
 * its first choice was out of reach would be measuring its own stubbornness
 * rather than the effect of money, so both of these fall back rather than pass.
 */
const affordable = (ids, game, limit) =>
  ids
    .map((id) => CMP.getAction(id))
    .filter((a) => a.cost <= limit && CMP.campaign.canPlay(game, a.id, 1).ok);

const dearest = (ids, game, limit) =>
  affordable(ids, game, limit).sort((a, b) => b.cost - a.cost)[0];
const cheapest = (ids, game, limit) =>
  affordable(ids, game, limit).sort((a, b) => a.cost - b.cost)[0];

/*
 * How much to put behind each move.
 *
 * There is one campaign action now, so the money axis is entirely the amount:
 * "a cheap move" and "a dear move" used to mean different actions and now mean
 * different sums. base is a crore, which is also the entry cap, so it is the
 * plan that gets in everywhere and builds nowhere. heavy puts the maximum
 * behind every move; spread divides whatever is left across the rounds to
 * come, which is what the spending curve is supposed to reward.
 */
const CRORE = 10000000;

const SPEND = {
  base: () => CRORE,
  big: (g) => Math.min(5 * CRORE, Math.max(CRORE, g.cash)),
  heavy: (g, action) => CMP.campaign.amountRange(action).max,
  spread: (g, action, round) => {
    // Hold enough back to keep campaigning for the rest of the election.
    const roundsLeft = Math.max(1, CMP.ROUNDS.total - round + 1);
    return Math.max(CRORE, Math.floor(g.cash / (roundsLeft * 2)));
  },
};

const STRATEGIES = {
  careful: { borrow: false, pick: (g, l) => cheapest(SAFE, g, l), aim: 'marginal', spend: 'spread' },
  bigspender: { borrow: true, pick: (g, l) => cheapest(SAFE, g, l), aim: 'marginal', spend: 'big' },
  gambler: { borrow: true, pick: (g, l) => cheapest(RISKY, g, l), aim: 'marginal', spend: 'big' },
  scattergun: { borrow: false, pick: (g, l) => cheapest(SAFE, g, l), aim: 'spread', spend: 'spread' },
  heavyhitter: { borrow: false, pick: (g, l) => cheapest(SAFE, g, l), aim: 'marginal', spend: 'heavy' },
  thin: { borrow: false, pick: (g, l) => cheapest(SAFE, g, l), aim: 'marginal', spend: 'base' },
};

function playCampaign(name, seed) {
  const plan = STRATEGIES[name];
  const game = CMP.state.startElection({
    partyId: 'aap',
    candidateName: 'Bot',
    slogan: 'Bot',
    seed: 'balance:' + seed,
  });
  const rand = CMP.rng.create('moves:' + name + ':' + seed);

  /*
   * Where a move is worth most, best first.
   *
   * An empty seat comes top: a move there wins a seat outright rather than
   * narrowing a gap. After that the closest races, because that is where a
   * move can still change who holds it. Seats already dominated come last —
   * spending there buys nothing but a bigger number.
   *
   * This is what "aiming" means under an empty board, and it is the thing
   * scattergun deliberately does not do.
   */
  /*
   * Where a move is worth most, best first.
   *
   * An empty seat comes top: a move there wins a seat outright rather than
   * narrowing a gap. Then the seats this campaign is *behind* in, closest
   * first, because those are the cheapest to flip. Seats already led come
   * last — spending there buys a bigger number and not a seat.
   *
   * The margin alone cannot tell those apart: forty ahead and forty behind
   * are the same distance and completely different decisions.
   */
  const value = (v) => {
    if (!v.contested) return -1;
    return v.leading ? 1000 + v.margin : v.margin;
  };

  const marginals = () =>
    CMP.CONSTITUENCIES.map((c) => CMP.campaign.seatView(game, c.number))
      .filter(Boolean)
      .sort((a, b) => value(a) - value(b));

  for (let round = 1; round <= CMP.ROUNDS.total; round++) {
    // A borrower who cannot cover the repayment is not testing the loan
    // system, it is testing the default penalty. These ones borrow only when
    // they can still expect to pay it back.
    if (plan.borrow) {
      const offer = CMP.campaign.loanOffer(game, CMP.FINANCE.loan.maxAmount);
      const owed = CMP.campaign.debtOf(game);
      if (offer.ok && game.cash + offer.amount > owed + offer.repay) {
        CMP.campaign.takeLoan(game, offer.amount);
      }
    }

    // ...and they hold back what falls due, rather than spending it twice.
    const dueSoon = (game.loans || [])
      .filter((l) => !l.settled && l.dueRound <= round)
      .reduce((t, l) => t + l.repay, 0);

    // A round ends when the money runs out or the plan stops; the guard is a
    // runaway backstop, not a rule of the game.
    for (let move = 0; move < 40; move++) {
      // Whatever falls due this round is not available to spend.
      const action = plan.pick(game, Math.max(0, game.cash - dueSoon));
      if (!action) break;
      const pool = marginals();
      // Aiming takes the best seat available; scattering takes any seat at
      // all. A seat just campaigned in drops down the order, so aiming
      // spreads by itself rather than hammering the same eight.
      const seat =
        plan.aim === 'marginal'
          ? pool[0]
          : pool[Math.floor(rand() * pool.length)] || pool[0];
      /*
       * Getting in is capped, so the first move into a seat is the cap and
       * everything after it is the plan. A bot that ignored this would be
       * refused on its opening move and would then measure nothing.
       */
      const cap = CMP.campaign.entryCap(game, seat.number, action);
      const wanted = SPEND[plan.spend](game, action, round);
      const amount = cap ? Math.min(cap, wanted || cap) : wanted;
      CMP.campaign.play(game, action.id, action.needsConstituency ? seat.number : null, {
        outcome: rand(),
        consequence: rand(),
        consequencePick: rand(),
      }, amount);
    }

    // A round settles into a results break; the next opens when it ends.
    if (CMP.campaign.endRound(game).finished) break;
    CMP.campaign.startNextRound(game);
  }

  const result = CMP.campaign.runElection(game);
  const mine = result.standings.find((s) => s.party === game.partyId);
  return {
    seats: mine ? mine.seats : 0,
    majority: !!(mine && mine.seats >= result.majority),
    spent: game.spent,
    borrowed: game.borrowed,
    heat: game.heat,
    defaults: game.defaults,
  };
}

const names = Object.keys(STRATEGIES);
const totals = {};
names.forEach((n) => {
  totals[n] = { seats: [], majorities: 0, spent: 0, borrowed: 0, heat: 0, defaults: 0, wins: 0 };
});

for (let i = 0; i < GAMES; i++) {
  const round = names.map((n) => ({ name: n, ...playCampaign(n, i) }));
  round.forEach((r) => {
    const t = totals[r.name];
    t.seats.push(r.seats);
    if (r.majority) t.majorities++;
    t.spent += r.spent;
    t.borrowed += r.borrowed;
    t.heat += r.heat;
    t.defaults += r.defaults;
  });
  // Same board, same seed: whoever finishes with most seats took that game.
  const best = round.slice().sort((a, b) => b.seats - a.seats)[0];
  totals[best.name].wins++;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const money = (n) => '₹' + (n / 10000000).toFixed(2) + 'cr';

console.log(CMP.ROUNDS.total + ' rounds, ₹' +
  (CMP.CAMPAIGN.income.perRound / 10000000) + ' crore a round, over ' + GAMES + ' games.');
console.log('');
console.log(
  'strategy    seats (mean)   range     majorities   games won   spent    borrowed  heat  defaults'
);
console.log('-'.repeat(94));
for (const n of names) {
  const t = totals[n];
  console.log(
    n.padEnd(11) +
      mean(t.seats).toFixed(1).padStart(9) +
      '   ' +
      (Math.min(...t.seats) + '-' + Math.max(...t.seats)).padStart(9) +
      '   ' +
      (t.majorities + '/' + GAMES).padStart(9) +
      '   ' +
      (t.wins + '/' + GAMES).padStart(8) +
      '   ' +
      money(t.spent / GAMES).padStart(8) +
      ' ' +
      money(t.borrowed / GAMES).padStart(9) +
      ' ' +
      (t.heat / GAMES).toFixed(0).padStart(5) +
      ' ' +
      (t.defaults / GAMES).toFixed(2).padStart(8)
  );
}

const winCounts = names.map((n) => totals[n].wins);
const topShare = Math.max(...winCounts) / GAMES;
const seatsOf = (n) => mean(totals[n].seats);
console.log('');
console.log('most-successful strategy takes ' + Math.round(topShare * 100) + '% of games');
console.log(
  'money edge (bigspender - careful): ' + (seatsOf('bigspender') - seatsOf('careful')).toFixed(1) + ' seats'
);
console.log(
  'aim edge   (careful - scattergun): ' + (seatsOf('careful') - seatsOf('scattergun')).toFixed(1) + ' seats'
);
console.log(
  'spread vs dump (careful - heavyhitter): ' +
  (seatsOf('careful') - seatsOf('heavyhitter')).toFixed(1) + ' seats'
);
console.log('');
console.log('want: the money edge small and the aim edge larger — spending more should help,');
console.log('      but spending it in the right places should help more.');
