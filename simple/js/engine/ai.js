/**
 * Opponents for the parties nobody is playing (solo).
 * ------------------------------------------------------------------
 * The mirror of api/lib/AI.php, for solo play. Multiplayer resolves opponents
 * on the server, because a client cannot be trusted to roll its own dice;
 * solo has no server, so the same rules exist here.
 *
 * The two share one config file and tools/test-campaign.mjs asserts they agree
 * on temperament, naming and the moves a given profile makes.
 *
 * These opponents play by exactly the same rules as the player: the same
 * actions, the same costs, the same weighted outcomes, the same heat, the same
 * three moves a round. They get no extra information and no extra money. What
 * differs is temperament — how much risk each takes, how tightly it targets,
 * how readily it borrows — so three rivals do not all play the same way.
 */
window.CMP = window.CMP || {};

CMP.ai = (function () {
  'use strict';

  function config() {
    return CMP.CAMPAIGN.ai;
  }

  /** Build an opponent for one party, entirely from the seed. */
  function create(partyId, seed) {
    var cfg = config();
    var rand = CMP.rng.create(seed + ':ai:' + partyId);
    var pick = function (list) {
      return list[Math.floor(rand() * list.length) % list.length];
    };

    var profile = pick(cfg.profiles);
    var given = pick(cfg.givenNames);
    var surname = pick(cfg.surnames);
    var slogan = pick(cfg.slogans);

    return {
      id: 'ai-' + partyId,
      isAI: true,
      partyId: partyId,
      profileId: profile.id,
      candidateName: given + ' ' + surname,
      slogan: slogan,
      portraitSeed: seed + ':' + partyId,

      cash: CMP.STARTING_BUDGET,
      budget: CMP.STARTING_BUDGET,
      spent: 0,
      borrowed: 0,
      repaid: 0,
      granted: 0,
      raised: 0,
      finesPaid: 0,
      loans: [],
      defaults: 0,
      borrowingBlocked: false,
      heat: 0,
      seatsLed: 0,
      rollCount: 0,
      roundActions: 0,
      actions: [],
    };
  }

  /** Every party the player did not take. */
  function opponentsFor(partyId, seed) {
    return CMP.PLAYABLE_PARTIES
      .filter(function (p) {
        return p.id !== partyId;
      })
      .map(function (p) {
        return create(p.id, seed);
      });
  }

  function profileOf(opponent) {
    var profiles = config().profiles;
    for (var i = 0; i < profiles.length; i++) {
      if (profiles[i].id === opponent.profileId) return profiles[i];
    }
    return profiles[0];
  }

  /**
   * One opponent's moves for a round, played against the shared board.
   * `board` is the game's support map, mutated in place like everything else
   * in the engine. Returns the moves made.
   */
  function takeRound(opponent, game, round) {
    if (opponent.disqualified) return [];

    var profile = profileOf(opponent);
    var rand = CMP.rng.create(game.seed + ':aiturn:' + opponent.partyId + ':' + round);
    var moves = [];

    if (rand() < profile.borrowChance) maybeBorrow(opponent, round, rand);

    // Money owed is not money to spend. An opponent that spent its way into a
    // default would hand the game away for nothing.
    var reserve = CMP.campaign.debtOf(opponent);

    opponent.roundActions = 0;
    var allowed = CMP.ROUNDS.actionsPerRound || 3;

    for (var move = 0; move < allowed; move++) {
      var action = chooseAction(opponent, profile, rand, round, reserve);
      if (!action) break;

      var target = null;
      if (action.needsConstituency) {
        target = chooseSeat(game.support, opponent.partyId, profile, rand);
        if (!target) break;
      }

      // Spreading evenly across the moves available is the efficient play
      // under a square-root curve, so that is what an opponent does.
      var amount = chooseAmount(opponent, action, round);

      var report = CMP.campaign.playAs(game, opponent, action.id, target, {
        outcome: rand(),
        consequence: rand(),
        consequencePick: rand(),
      }, amount);
      if (!report) break;
      moves.push({
        actionId: report.actionId,
        label: report.label,
        constituency: report.constituency,
        support: report.support,
      });
    }

    return moves;
  }

  /**
   * How much to put behind a move: what is left, divided by the moves still
   * expected, clamped to what the action allows.
   */
  function chooseAmount(opponent, action, round) {
    if (!action.allowsAmount) return null;
    var movesLeft = Math.max(1, (CMP.ROUNDS.total - round + 1) * CMP.ROUNDS.actionsPerRound);
    var budget = Math.floor((opponent.cash || 0) / movesLeft);
    var range = CMP.campaign.amountRange(action);
    return Math.max(range.min, Math.min(range.max, budget));
  }

  /**
   * What to play next. Risky strategies are reached for in proportion to the
   * profile's appetite, and only while the heat is bearable — an opponent that
   * ran itself to a disqualification every game would be no opponent at all.
   */
  function chooseAction(opponent, profile, rand, round, reserve) {
    var spendable = Math.max(0, (opponent.cash || 0) - (reserve || 0));
    var heatMax = CMP.CAMPAIGN.heat.max;
    var backoff = config().heatBackoff || 0.5;
    var runningHot = (opponent.heat || 0) >= heatMax * backoff;
    var restricted = (opponent.restrictedUntilTurn || 0) >= round;

    var safe = [];
    var risky = [];
    var funding = [];

    CMP.ACTIONS.forEach(function (action) {
      if (action.cost > spendable) return;
      if (action.group === 'risky') {
        if (!restricted && !runningHot) risky.push(action);
        return;
      }
      if (action.group === 'funding') {
        if (action.id === 'underground' && runningHot) return;
        funding.push(action);
        return;
      }
      safe.push(action);
    });

    var find = function (pool, id) {
      for (var i = 0; i < pool.length; i++) {
        if (pool[i].id === id) return pool[i];
      }
      return null;
    };

    // Nothing left to campaign with: raise money if that is still sensible,
    // otherwise sit the round out.
    if (!safe.length) {
      var grant = find(funding, 'grant');
      if (grant) return grant;
      var shady = find(funding, 'underground');
      if (shady && rand() < profile.riskAppetite) return shady;
      return null;
    }

    if (risky.length && rand() < profile.riskAppetite) {
      return risky[Math.floor(rand() * risky.length) % risky.length];
    }

    if (spendable < CMP.STARTING_BUDGET * 0.35 && rand() < 0.3) {
      var g = find(funding, 'grant');
      if (g) return g;
    }

    return safe[Math.floor(rand() * safe.length) % safe.length];
  }

  /**
   * Where to campaign: among the seats this party is closest to taking or
   * losing, since that is where a move changes the seat count.
   */
  function chooseSeat(support, partyId, profile, rand) {
    var numbers = Object.keys(support);
    if (!numbers.length) return null;

    var margins = numbers.map(function (key) {
      var seat = support[key];
      var mine = seat[partyId] || 0;
      var best = 0;
      Object.keys(seat).forEach(function (pid) {
        if (pid !== partyId && seat[pid] > best) best = seat[pid];
      });
      return { key: key, margin: Math.abs(mine - best) };
    });
    margins.sort(function (a, b) {
      return a.margin - b.margin;
    });

    var shortlist = margins.slice(0, Math.max(1, profile.targetSpread));
    return shortlist[Math.floor(rand() * shortlist.length) % shortlist.length].key;
  }

  /** Borrow when the purse is thin and the bill can plausibly be met. */
  function maybeBorrow(opponent, round, rand) {
    if (opponent.cash > CMP.STARTING_BUDGET * 0.3) return;
    if (CMP.campaign.debtOf(opponent) > 0) return;

    var cfg = CMP.FINANCE.loan;
    var amount = cfg.minAmount + Math.floor(rand() * 4) * cfg.increments;
    var offer = CMP.campaign.loanOfferFor(opponent, amount, round);
    if (!offer.ok) return;
    if (opponent.cash + offer.amount < offer.repay) return;
    CMP.campaign.takeLoanFor(opponent, amount, round);
  }

  return {
    create: create,
    opponentsFor: opponentsFor,
    profileOf: profileOf,
    takeRound: takeRound,
    chooseAction: chooseAction,
    chooseSeat: chooseSeat,
  };
})();
