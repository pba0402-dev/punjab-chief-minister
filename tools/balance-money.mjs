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

const STRATEGIES = {
  careful: { borrow: false, pick: (g, l) => cheapest(SAFE, g, l), aim: 'marginal' },
  bigspender: { borrow: true, pick: (g, l) => dearest(SAFE, g, l), aim: 'marginal' },
  gambler: { borrow: true, pick: (g, l) => dearest(RISKY, g, l), aim: 'marginal' },
  scattergun: { borrow: false, pick: (g, l) => cheapest(SAFE, g, l), aim: 'spread' },
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

  const marginals = () =>
    CMP.CONSTITUENCIES.map((c) => CMP.campaign.seatView(game, c.number))
      .filter(Boolean)
      .sort((a, b) => a.margin - b.margin);

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

    for (let move = 0; move < CMP.ROUNDS.actionsPerRound; move++) {
      // Whatever falls due this round is not available to spend.
      const action = plan.pick(game, Math.max(0, game.cash - dueSoon));
      if (!action) break;
      const pool = marginals();
      const seat =
        plan.aim === 'marginal'
          ? pool[Math.floor(rand() * 8)] || pool[0]
          : pool[Math.floor(rand() * pool.length)] || pool[0];
      CMP.campaign.play(game, action.id, action.needsConstituency ? seat.number : null, {
        outcome: rand(),
        consequence: rand(),
        consequencePick: rand(),
      });
    }

    if (CMP.campaign.endRound(game).finished) break;
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

console.log('Fifteen rounds, ' + CMP.ROUNDS.actionsPerRound + ' moves each, over ' + GAMES + ' games.\n');
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
console.log('');
console.log('want: the money edge small and the aim edge larger — spending more should help,');
console.log('      but spending it in the right places should help more.');
