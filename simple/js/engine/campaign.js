/**
 * Campaign engine (solo).
 * ------------------------------------------------------------------
 * Resolving one campaign action: check the budget, roll an outcome, move
 * support, add heat, and possibly trigger a consequence.
 *
 * Pure logic — no DOM, no storage, no network. Every number it uses comes
 * from CMP.CAMPAIGN, never from here.
 *
 * Multiplayer runs the same rules server-side in api/lib/Campaign.php, because
 * a client cannot be trusted to roll its own dice. The two are kept in step by
 * sharing one config file, and a test asserts they agree.
 */
window.CMP = window.CMP || {};

CMP.campaign = (function () {
  'use strict';

  /* ------------------------------------------------------ helpers */

  function config() {
    return CMP.CAMPAIGN;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /** Pick one entry from a weighted list. `roll` is a float in [0,1). */
  function weightedPick(items, roll) {
    var total = 0;
    var i;
    for (i = 0; i < items.length; i++) total += items[i].weight || 0;
    if (total <= 0) return items[0];

    var target = roll * total;
    for (i = 0; i < items.length; i++) {
      target -= items[i].weight || 0;
      if (target < 0) return items[i];
    }
    return items[items.length - 1];
  }

  /**
   * Real incumbents include parties nobody plays (BSP) and independents.
   * Those all sit under "Others" for game purposes; their real affiliation is
   * still shown on the constituency screen.
   */
  function gamePartyFor(realPartyCode) {
    var id = String(realPartyCode || '').toLowerCase();
    var party = CMP.getParty(id);
    return party && party.playable ? id : 'oth';
  }

  function heatLevel(heat) {
    var levels = config().heat.levels;
    for (var i = 0; i < levels.length; i++) {
      if (heat <= levels[i].upTo) return levels[i];
    }
    return levels[levels.length - 1];
  }

  /** SAFE / LIKELY / LEAN / TOSS-UP from the gap between the top two parties. */
  function ratingFor(margin) {
    var ratings = config().ratings;
    for (var i = 0; i < ratings.length; i++) {
      if (margin >= ratings[i].minMargin) return ratings[i];
    }
    return ratings[ratings.length - 1];
  }

  /** Sorted support for one constituency: [{partyId, support}, ...] desc. */
  function standings(support) {
    return Object.keys(support)
      .map(function (id) {
        return { partyId: id, support: support[id] };
      })
      .sort(function (a, b) {
        return b.support - a.support;
      });
  }

  /**
   * What the player is shown about a seat: their share, the best rival's,
   * and how close it is.
   */
  function seatView(game, number) {
    var support = game.support[number];
    if (!support) return null;
    var ranked = standings(support);
    var mine = support[game.partyId] || 0;
    var best = null;
    for (var i = 0; i < ranked.length; i++) {
      if (ranked[i].partyId !== game.partyId) {
        best = ranked[i];
        break;
      }
    }
    var margin = Math.abs(ranked[0].support - (ranked[1] ? ranked[1].support : 0));
    return {
      number: number,
      player: mine,
      opponentId: best ? best.partyId : null,
      opponent: best ? best.support : 0,
      leaderId: ranked[0].partyId,
      leading: ranked[0].partyId === game.partyId,
      margin: margin,
      rating: ratingFor(margin),
    };
  }

  /* ------------------------------------------------------ affordability */

  /**
   * A campaign holds money in four purses: general cash, and one for each
   * region of Punjab.
   *
   * General cash is the round allowance, loans, and anything raised. It can be
   * spent anywhere. A region purse is grant money earned by holding whole
   * districts in that region, and it can only be spent there — which is the
   * point of the whole territory system, and the reason it is a separate
   * number rather than a note against a single total.
   */
  function grantsOf(game) {
    if (!game.grants) game.grants = {};
    return game.grants;
  }

  function grantIn(game, regionId) {
    if (!regionId) return 0;
    return Math.max(0, grantsOf(game)[regionId] || 0);
  }

  /** Every region purse added up. Spendable, but not spendable anywhere. */
  function grantTotal(game) {
    var g = grantsOf(game);
    return Object.keys(g).reduce(function (t, k) {
      return t + Math.max(0, g[k] || 0);
    }, 0);
  }

  /**
   * Spendable general cash. Borrowed money is in here; what is owed is not
   * deducted until it falls due, which is exactly what makes borrowing
   * tempting. Grant money is deliberately not included — see spendableOn.
   */
  function remaining(game) {
    return Math.max(0, game.cash || 0);
  }

  /** Everything the campaign holds, however restricted. For display only. */
  function heldTotal(game) {
    return remaining(game) + grantTotal(game);
  }

  /**
   * What can be put behind a move aimed at one seat: general cash, plus the
   * purse for the region that seat sits in, and nothing else.
   *
   * A move with no seat behind it — applying for a grant, taking undisclosed
   * money — can only draw on general cash, because there is no region to say
   * the grant money is being spent in.
   */
  function spendableOn(game, seatNumber) {
    var region = seatNumber ? CMP.regionOfSeat(Number(seatNumber)) : null;
    var grant = region ? grantIn(game, region) : 0;
    return {
      region: region,
      cash: remaining(game),
      grant: grant,
      total: remaining(game) + grant,
    };
  }

  /**
   * Take an amount off the campaign, region purse first.
   *
   * Grant money is spent before general cash because it is the more
   * restricted of the two: holding it back to spend general cash first would
   * strand it if the district were lost. Returns how much came from where, so
   * the ledger can say so.
   */
  function charge(game, seatNumber, amount) {
    var pot = spendableOn(game, seatNumber);
    var take = Math.min(Math.max(0, Math.round(amount)), pot.total);

    var fromGrant = Math.min(pot.grant, take);
    var fromCash = take - fromGrant;

    if (fromGrant > 0) {
      grantsOf(game)[pot.region] = grantIn(game, pot.region) - fromGrant;
    }
    game.cash = Math.max(0, (game.cash || 0) - fromCash);

    return { total: take, grant: fromGrant, cash: fromCash, region: pot.region };
  }

  /* ---------------------------------------------------------- the ledger */

  /**
   * Every movement of money, in the order it happened.
   *
   * The running balances are the truth and this is the account of how they got
   * there — written by the same functions that move the money, so the two
   * cannot tell different stories. Trimmed, because a twenty-round game with
   * four players generates more rows than anybody will read.
   */
  function ledger(game, entry) {
    if (!game.ledger) game.ledger = [];
    entry.round = entry.round || game.round || 1;
    entry.at = Date.now();
    game.ledger.push(entry);
    if (game.ledger.length > 400) game.ledger.shift();
    return entry;
  }

  /**
   * Credit one round's allowance, once.
   *
   * Keyed by round number rather than counted, so a refresh, a reconnection or
   * a doubled-up call cannot pay anybody twice — which is the failure this
   * whole game's economy would never recover from.
   */
  function creditRoundIncome(game, round) {
    if (!game.incomeCredited) game.incomeCredited = {};
    var key = String(round);
    if (game.incomeCredited[key]) return 0;

    var amount = (CMP.CAMPAIGN.income || {}).perRound || 0;
    game.incomeCredited[key] = true;
    game.cash = (game.cash || 0) + amount;
    game.incomeTotal = (game.incomeTotal || 0) + amount;
    ledger(game, { round: round, kind: 'income', label: 'Round allowance', amount: amount });
    return amount;
  }

  /**
   * Pay the grants for every district this campaign wholly holds.
   *
   * Paid every round the hold lasts, into the purse for the district's own
   * region. Like the allowance it is keyed by round, so it cannot be paid
   * twice for the same round.
   */
  function creditDistrictGrants(game, round) {
    if (!game.grantsCredited) game.grantsCredited = {};
    var key = String(round);
    if (game.grantsCredited[key]) return 0;
    game.grantsCredited[key] = true;

    var held = districtsHeldBy(game.support, game.partyId);
    game.districtsHeld = held.length;

    // A grant is for a district taken, not one inherited.
    //
    // The opening board is dealt from the sitting MLAs, and it routinely hands
    // one party six districts before anybody has campaigned — on some seeds,
    // eighteen. Paying for those would settle the election in round one and
    // make the whole territory system a lottery on the deal. So the districts
    // a party opens holding are its starting position and pay nothing, until
    // it loses one and takes it back, which is a thing it did.
    var opening = game.openingDistricts || [];
    var earned = held.filter(function (d) {
      return opening.indexOf(d.id) === -1;
    });

    var total = 0;
    earned.forEach(function (d) {
      grantsOf(game)[d.region] = grantIn(game, d.region) + d.grant;
      total += d.grant;
      ledger(game, {
        round: round,
        kind: 'grant',
        label: d.name + ' district grant',
        region: d.region,
        district: d.id,
        amount: d.grant,
      });
    });
    game.grantTotalEarned = (game.grantTotalEarned || 0) + total;
    game.districtsPaying = earned.length;
    return total;
  }

  /**
   * The districts a party holds before a single move is played.
   *
   * Recorded once, when the board is dealt, and never updated: it is the
   * starting position, and losing one of them does not change what the
   * starting position was.
   */
  function openingDistrictsFor(support, partyId) {
    return districtsHeldBy(support, partyId).map(function (d) {
      return d.id;
    });
  }

  /* ------------------------------------------------------------ territory */

  /**
   * The districts one party leads outright — every seat, not most of them.
   *
   * Leading eight of nine seats in a district is a good position and pays
   * nothing. That is deliberate: a grant should be the reward for finishing a
   * job, not for being ahead.
   */
  function districtsHeldBy(support, partyId) {
    if (!partyId || !CMP.DISTRICTS) return [];
    var leaders = currentLeaders(support);
    return CMP.DISTRICTS.filter(function (d) {
      for (var i = 0; i < d.seats.length; i++) {
        if (leaders[d.seats[i]] !== partyId) return false;
      }
      return d.seats.length > 0;
    });
  }

  /** How a district stands for one party: held, leading, or neither. */
  function districtStanding(support, partyId, district) {
    var leaders = currentLeaders(support);
    var mine = 0;
    district.seats.forEach(function (n) {
      if (leaders[n] === partyId) mine++;
    });
    return {
      district: district,
      mine: mine,
      total: district.seats.length,
      held: mine === district.seats.length && district.seats.length > 0,
    };
  }

  /** Everything still owed, principal and interest together. */
  function debtOf(game) {
    return (game.loans || []).reduce(function (total, loan) {
      return loan.settled ? total : total + loan.repay;
    }, 0);
  }

  /**
   * Can this action be played right now? Returns { ok, reason }.
   * The UI uses the reason verbatim, so it has to read like a sentence.
   */
  /* -------------------------------------------------------- spending */

  /**
   * What a move is allowed to cost. An action's own cost is the middle of the
   * range rather than the price of it.
   */
  function amountRange(action) {
    var cfg = CMP.CAMPAIGN.spending;
    if (!cfg || !cfg.enabled || !action.allowsAmount) {
      return { min: action.cost, max: action.cost };
    }
    return {
      min: Math.min(cfg.minAmount, action.cost),
      max: Math.round(action.cost * cfg.maxMultiple),
    };
  }

  /**
   * How far a given amount scales a move, against the action's base cost.
   *
   * A square root: four times the money buys twice the effect. For a fixed
   * budget that makes spreading money across every available move strictly
   * better than concentrating it, which is what stops a large purse simply
   * buying the election in a handful of expensive gestures.
   */
  function scaleFor(action, amount) {
    var cfg = CMP.CAMPAIGN.spending;
    if (!cfg || !cfg.enabled || !action.allowsAmount || !action.cost) return 1;
    var curve = cfg.curve || 0.5;
    return clamp(Math.pow(amount / action.cost, curve), cfg.minScale, cfg.maxScale);
  }

  /** The amount a move will actually cost, clamped to what is allowed. */
  function resolveAmount(action, requested) {
    if (requested === null || requested === undefined || requested === '') return action.cost;
    var range = amountRange(action);
    return Math.round(clamp(Number(requested), range.min, range.max));
  }

  /**
   * One outcome, scaled by what the player put behind the move. Support, the
   * knock to an opponent, any money it brings in, and the heat it raises all
   * move together — a bigger effort is a more visible one.
   */
  function scaleOutcome(outcome, scale) {
    if (scale === 1) return outcome;
    var out = {};
    Object.keys(outcome).forEach(function (k) {
      out[k] = outcome[k];
    });
    ['support', 'opponentSupport', 'funds', 'heat'].forEach(function (field) {
      if (out[field]) {
        out[field] = field === 'funds'
          ? Math.round(out[field] * scale)
          : Math.round(out[field] * scale * 100) / 100;
      }
    });
    return out;
  }

  /** How many more moves are left in the current round. */
  function actionsLeft(game) {
    var cap = CMP.ROUNDS.actionsPerRound || 0;
    if (cap <= 0) return Infinity;
    return Math.max(0, cap - (game.roundActions || 0));
  }

  function canPlay(game, actionId, target, amount) {
    var action = CMP.getAction(actionId);
    if (!action) return { ok: false, reason: 'Unknown action.' };
    if (game.roundReady) {
      return { ok: false, reason: 'You have ended your round. Wait for the next one.' };
    }
    if (actionsLeft(game) <= 0) return { ok: false, reason: 'No moves left this round' };
    if (resolveAmount(action, amount) > spendableOn(game, target).total) {
      return { ok: false, reason: 'More than you can spend here' };
    }
    if (action.needsConstituency && !target) {
      return { ok: false, reason: 'Choose a constituency first' };
    }
    if (action.needsConstituency && !game.support[target]) {
      return { ok: false, reason: 'Unknown constituency' };
    }
    if (!roundIsLive(game)) {
      return { ok: false, reason: 'That round has closed. Wait for the next one.' };
    }
    return { ok: true };
  }

  /* ------------------------------------------------------ the round clock */

  /** Seconds left in the current round. */
  function secondsLeft(game, now) {
    if (!game || !game.roundEndsAt) return 0;
    return Math.max(0, Math.ceil((game.roundEndsAt - (now || Date.now())) / 1000));
  }

  function roundIsLive(game) {
    // Play is locked for the whole results break, not merely until the clock
    // hits zero — the scoreboard on screen is the one a late move would
    // invalidate.
    if (game.stage === 'results') return false;
    if (!game.roundEndsAt) return true;
    var grace = (CMP.ROUNDS.graceSeconds || 0) * 1000;
    return Date.now() <= game.roundEndsAt + grace;
  }

  /** Seconds left of the results break, or 0 while a round is running. */
  function intermissionLeft(game, now) {
    if (!game || game.stage !== 'results') return 0;
    return Math.max(0, Math.ceil((game.nextRoundAt - (now || Date.now())) / 1000));
  }

  function isFinalRound(game) {
    return (game.round || 1) >= CMP.ROUNDS.total;
  }

  /**
   * Open a round and stamp its deadline. The snapshot taken here is what the
   * end-of-round summary is a diff against, so "money spent" means money spent
   * this round rather than whatever was left when the tally happened to run.
   */
  function beginRound(game, round) {
    game.round = round;
    game.stage = 'playing';
    game.turn = round;
    game.roundsTotal = CMP.ROUNDS.total;
    game.roundSeconds = game.roundSeconds || CMP.ROUNDS.seconds;
    game.roundEndsAt = Date.now() + game.roundSeconds * 1000;
    game.nextRoundAt = 0;
    (game.opponents || []).forEach(function (o) {
      o.roundActions = 0;
      o.roundSpent = 0;
      o.roundReady = false;
      creditRoundIncome(o, round);
      creditDistrictGrants(withBoard(o, game), round);
    });

    // Nothing is wiped. The allowance is added to whatever survived the last
    // round, and district grants pay again for as long as the ground is held.
    game.roundReady = false;
    game.roundSpent = 0;
    game.roundGained = 0;
    game.roundActions = 0;
    creditRoundIncome(game, round);
    creditDistrictGrants(game, round);

    game.roundOpen = {
      cash: game.cash || 0,
      grants: JSON.parse(JSON.stringify(grantsOf(game))),
      heat: game.heat || 0,
      seats: game.seatsWon || 0,
      support: averageSupport(game.support, game.partyId),
    };
    return game;
  }

  /**
   * An opponent's purse with the shared board attached, so the territory
   * functions can read the seats without the opponent carrying a copy of them.
   */
  function withBoard(actor, game) {
    actor.support = game.support;
    return actor;
  }

  /* ------------------------------------------------------------ borrowing */

  /**
   * What a loan of this size would cost and when the bill lands, or a
   * refusal. Quoting and taking share this, so the confirmation screen can
   * never show terms that would then be declined.
   */
  function loanOffer(game, amount) {
    var cfg = CMP.FINANCE.loan;
    amount = Math.round((amount || 0) / cfg.increments) * cfg.increments;

    var interest = Math.round(amount * cfg.interestRate);
    var offer = {
      amount: amount,
      interestRate: cfg.interestRate,
      interest: interest,
      repay: amount + interest,
      dueRound: (game.round || 1) + cfg.repayAfterRounds,
      debtNow: debtOf(game),
      debtLimit: cfg.debtLimit,
      ok: true,
      error: null,
    };

    function refuse(why) {
      offer.ok = false;
      offer.error = why;
      return offer;
    }

    if (game.borrowingBlocked) return refuse('No bank will lend to you after your default.');
    if (amount < cfg.minAmount) return refuse('The smallest loan is ' + money(cfg.minAmount) + '.');
    if (amount > cfg.maxAmount) return refuse('The largest single loan is ' + money(cfg.maxAmount) + '.');
    if ((game.round || 1) > cfg.noBorrowingAfterRound) {
      // Otherwise the last rounds would offer free money, because the bill
      // would fall due after the campaign had already closed.
      return refuse('Too late to borrow — repayment would fall after election day.');
    }
    if (offer.debtNow + offer.repay > cfg.debtLimit) {
      return refuse('That would take you past your debt limit of ' + money(cfg.debtLimit) + '.');
    }
    return offer;
  }

  /** Take a loan on the quoted terms. */
  function takeLoan(game, amount) {
    var offer = loanOffer(game, amount);
    if (!offer.ok) return offer;

    game.cash += offer.amount;
    game.borrowed += offer.amount;
    ledger(game, { kind: 'loan', label: 'Loan taken', amount: offer.amount });
    game.loans.push({
      id: 'L' + (game.loans.length + 1),
      amount: offer.amount,
      interest: offer.interest,
      repay: offer.repay,
      takenRound: game.round,
      dueRound: offer.dueRound,
      settled: false,
      defaulted: false,
    });
    return offer;
  }

  /**
   * Loans falling due this round. A player who cannot cover one pays what
   * they can and defaults on the rest.
   *
   * Default is deliberately worse than the money involved: heat, a
   * restriction, lost support and no further credit. Without that, the best
   * play would be to borrow the maximum every round and never repay.
   */
  function settleLoans(game, summary) {
    var cfg = CMP.FINANCE.default;

    (game.loans || []).forEach(function (loan) {
      if (loan.settled || loan.dueRound > game.round) return;

      if (game.cash >= loan.repay) {
        game.cash -= loan.repay;
        game.repaid += loan.repay;
        game.interestPaid += loan.interest;
        loan.settled = true;
        ledger(game, { kind: 'repayment', label: 'Loan repaid', amount: -loan.repay });
        summary.repayments.push({
          id: loan.id,
          paid: loan.repay,
          interest: loan.interest,
          defaulted: false,
          text: 'Loan repaid with interest.',
        });
        return;
      }

      var paid = game.cash;
      game.cash = 0;
      game.repaid += paid;
      loan.settled = true;
      loan.defaulted = true;
      game.defaults += 1;
      game.heat = clamp(game.heat + cfg.heat, 0, config().heat.max);
      if (cfg.borrowingBlocked) game.borrowingBlocked = true;

      var until = game.round + cfg.restrictRounds;
      game.restrictedUntilTurn = Math.max(game.restrictedUntilTurn || 0, until);
      applyAcross(game, cfg.support, cfg.seats);

      summary.repayments.push({
        id: loan.id,
        paid: paid,
        shortfall: loan.repay - paid,
        interest: loan.interest,
        defaulted: true,
        restrictedUntil: until,
        text: cfg.text,
      });
      summary.defaulted = true;
    });

    return game;
  }

  /* --------------------------------------------------------------- events */

  /**
   * At most one event a round, and most rounds none — an event every round
   * would drown out the decisions the player actually made.
   */
  function rollEvent(game, rand) {
    if (rand() >= CMP.EVENTS.chancePerRound) return null;

    var pick = weightedPick(CMP.EVENTS.list, rand());
    var hit = [];

    if (pick.support) hit = applyAcross(game, pick.support, pick.seats || 1);
    if (pick.funds) {
      game.cash += pick.funds;
      game.granted += pick.funds;
      game.roundGained += pick.funds;
    }
    if (pick.heat) game.heat = clamp(game.heat + pick.heat, 0, config().heat.max);

    return {
      id: pick.id,
      kind: pick.kind,
      label: pick.label,
      text: pick.text,
      support: pick.support || 0,
      funds: pick.funds || 0,
      heat: pick.heat || 0,
      seats: hit,
    };
  }

  /* ------------------------------------------------------------ round end */

  /**
   * One full round end, in the same order the server runs it: money settles
   * first, then events move support, and only then is it meaningful to
   * recount leaders and projected seats.
   */
  function endRound(game) {
    var open = game.roundOpen || {
      cash: game.cash, heat: game.heat, seats: game.seatsWon, support: 0,
    };
    var summary = {
      round: game.round,
      cashBefore: open.cash,
      spent: game.roundSpent || 0,
      gained: game.roundGained || 0,
      heatBefore: open.heat,
      seatsBefore: open.seats,
      supportBefore: open.support,
      actionsPlayed: game.roundActions || 0,
      repayments: [],
      events: [],
    };

    // The opponents campaign. They move at the end of the round rather than
    // at odd moments during it, so their spending lands in the same round as
    // the player's and appears in the same results screen.
    var aiMoves = {};
    (game.opponents || []).forEach(function (opponent) {
      aiMoves[opponent.partyId] = CMP.ai.takeRound(opponent, game, game.round);
    });

    settleLoans(game, summary);
    (game.opponents || []).forEach(function (opponent) {
      settleLoansFor(game, opponent, { repayments: [] });
    });

    var rand = CMP.rng.create(game.seed + ':round:' + game.round);
    var event = rollEvent(game, rand);
    if (event) summary.events.push(event);

    var cool = config().heat.coolPerRound || 0;
    game.heat = clamp(game.heat - cool, 0, config().heat.max);
    (game.opponents || []).forEach(function (o) {
      o.heat = clamp(o.heat - cool, 0, config().heat.max);
    });

    var counts = seatCounts(game.support);
    game.seatsWon = counts[game.partyId] || 0;
    (game.opponents || []).forEach(function (o) {
      o.seatsBefore = o.seatsLed || 0;
      o.seatsLed = counts[o.partyId] || 0;
    });

    summary.cashAfter = game.cash;
    summary.cashChange = game.cash - open.cash;
    summary.debtAfter = debtOf(game);
    summary.heatAfter = game.heat;
    summary.heatChange = round1(game.heat - open.heat);
    summary.seatsAfter = game.seatsWon;
    summary.seatsChange = game.seatsWon - open.seats;
    summary.supportAfter = averageSupport(game.support, game.partyId);
    summary.supportChange = round1(summary.supportAfter - open.support);

    game.summary = summary;
    game.history.push({
      round: game.round,
      seats: counts,
      board: JSON.parse(JSON.stringify(game.support)),
    });
    game.seatTrend = game.history.map(function (h) {
      return { round: h.round, seats: h.seats };
    });

    // Which seats changed hands. Only the differences are worth reporting:
    // early rounds can settle a hundred seats at once, and a list of all 117
    // every round is a wall nobody reads.
    var previous = game.leaders || {};
    var current = currentLeaders(game.support);
    game.lastResult = buildResult(game, counts, diffLeaders(previous, current), aiMoves);
    game.leaders = current;
    game.leadParty = game.lastResult.leadParty;

    // Into the results break. The shell opens the next round when it expires.
    game.stage = 'results';
    game.nextRoundAt = Date.now() + CMP.ROUNDS.intermissionSeconds * 1000;
    game.updatedAt = Date.now();

    return { summary: summary, finished: isFinalRound(game) };
  }

  /** Leave the results break and open the next round, or close the polls. */
  function startNextRound(game) {
    if (isFinalRound(game)) {
      game.stage = 'final';
      return { finished: true };
    }
    beginRound(game, game.round + 1);
    game.updatedAt = Date.now();
    return { finished: false };
  }

  /* -------------------------------------------------------- scoreboard */

  /** Who leads each seat right now. */
  function currentLeaders(support) {
    var out = {};
    Object.keys(support).forEach(function (key) {
      var ranked = standings(support[key]);
      if (ranked.length) out[key] = ranked[0].partyId;
    });
    return out;
  }

  /**
   * Seats that changed hands. A first round has no previous state to compare
   * against, so nothing is reported — every seat "changing" on the opening
   * round would be meaningless.
   */
  function diffLeaders(previous, current) {
    if (!previous || !Object.keys(previous).length) return [];
    var changes = [];
    Object.keys(current).forEach(function (key) {
      var from = previous[key];
      if (from && from !== current[key]) {
        changes.push({ seat: Number(key), from: from, to: current[key] });
      }
    });
    changes.sort(function (a, b) {
      return a.seat - b.seat;
    });
    return changes;
  }

  /**
   * The round's scoreboard: who is where, what moved, and what it means.
   * The same shape the server builds, so one screen draws both.
   */
  function buildResult(game, counts, changes, aiMoves) {
    var cfg = CMP.CAMPAIGN.scoreboard;
    var majority = config().election.majority;

    var standingsRows = CMP.PLAYABLE_PARTIES.map(function (party) {
      var mine = party.id === game.partyId;
      var opponent = mine ? null : findOpponent(game, party.id);
      var actor = mine ? game : opponent;
      var before = mine
        ? (game.roundOpen ? game.roundOpen.seats : 0)
        : (opponent ? opponent.seatsBefore || 0 : 0);

      return {
        party: party.id,
        playerId: mine ? 'you' : (opponent ? opponent.id : null),
        candidateName: mine ? game.candidateName : (opponent ? opponent.candidateName : null),
        portraitSeed: mine ? game.portraitSeed : (opponent ? opponent.portraitSeed : null),
        isAI: !mine,
        seats: counts[party.id] || 0,
        change: (counts[party.id] || 0) - before,
        heat: actor ? Math.round(actor.heat || 0) : 0,
        disqualified: !!(actor && actor.disqualified),
        moves: mine ? null : (aiMoves[party.id] || null),
      };
    }).sort(function (a, b) {
      return b.seats - a.seats || (a.party < b.party ? -1 : 1);
    });

    var leader = standingsRows[0];
    var runnerUp = standingsRows[1] || null;
    var gap = runnerUp ? leader.seats - runnerUp.seats : leader.seats;
    var previousLeader = game.leadParty || null;
    var shown = changes.slice(0, cfg.maxSeatChangesShown);

    return {
      round: game.round,
      roundsTotal: CMP.ROUNDS.total,
      isFinalRound: isFinalRound(game),
      standings: standingsRows,
      totalSeats: Object.keys(game.support).length,
      majority: majority,

      leadParty: leader.party,
      leadSeats: leader.seats,
      leadOver: runnerUp ? runnerUp.party : null,
      leadGap: gap,
      seatsNeeded: Math.max(0, majority - leader.seats),
      newLeader: !!previousLeader && previousLeader !== leader.party && leader.seats > 0,
      previousLeader: previousLeader,
      closeRace: !!runnerUp && gap <= cfg.closeRaceSeats,

      changes: shown,
      changeCount: changes.length,
      changesHidden: Math.max(0, changes.length - shown.length),
      at: Math.floor(Date.now() / 1000),
    };
  }

  function findOpponent(game, partyId) {
    var list = game.opponents || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].partyId === partyId) return list[i];
    }
    return null;
  }

  /* ------------------------------------------------------------- in bulk */

  /**
   * How a sum divides across a set of seats.
   *
   * Each seat gets an equal share, clamped to what one move of that action is
   * allowed to cost — a rally is still a rally however rich the campaign, so
   * money past the ceiling has nowhere to go on that seat. What will not fit
   * is reported back rather than quietly kept or quietly spent, because a
   * player who allocated twenty crore and saw eight disappear would rightly
   * never trust the screen again.
   */
  function planBulk(game, actionId, seats, total) {
    var action = CMP.getAction(actionId);
    if (!action) return { ok: false, reason: 'Unknown action.', rows: [] };

    var list = (seats || []).map(Number).filter(function (n) {
      return !!game.support[n];
    });
    if (!list.length) return { ok: false, reason: 'Choose somewhere to campaign.', rows: [] };

    var range = amountRange(action);
    var want = Math.max(0, Math.round(total || 0));
    var each = Math.floor(want / list.length);

    // Whatever does not divide evenly goes on the first few seats, a rupee
    // each, so an allocation of one crore across fourteen seats spends one
    // crore rather than 99,99,990 and quietly keeps the rest.
    var remainder = want - each * list.length;

    // Region purses are per region, so what is affordable has to be worked out
    // region by region rather than against one running total.
    var pots = {};
    var cashLeft = remaining(game);

    var rows = [];
    var allocated = 0;

    list.forEach(function (seat, index) {
      var share = each + (index < remainder ? 1 : 0);
      var want = clamp(share, 0, range.max);
      if (want < range.min) want = 0;

      var region = CMP.regionOfSeat(seat);
      if (region && pots[region] === undefined) pots[region] = grantIn(game, region);

      var fromGrant = region ? Math.min(pots[region], want) : 0;
      var fromCash = Math.min(cashLeft, want - fromGrant);
      var afford = fromGrant + fromCash;

      if (afford < range.min) {
        rows.push({ seat: seat, amount: 0, region: region, short: true });
        return;
      }

      if (region) pots[region] -= fromGrant;
      cashLeft -= fromCash;
      allocated += afford;
      rows.push({ seat: seat, amount: afford, region: region, short: afford < want });
    });

    var spendable = rows.filter(function (r) {
      return r.amount > 0;
    });

    return {
      ok: spendable.length > 0,
      reason: spendable.length ? null : 'Not enough to campaign anywhere at that spread.',
      rows: rows,
      seats: spendable.length,
      allocated: allocated,
      unspent: Math.max(0, (total || 0) - allocated),
      perSeatMax: range.max,
      perSeatMin: range.min,
    };
  }

  /**
   * Play one action across several seats at once, from a single allocation.
   *
   * This is the same play() applied seat by seat, not a shortcut around it:
   * every move costs, scales, raises heat and can bring a consequence exactly
   * as it would alone. What bulk buys the player is one decision instead of
   * fifteen, which over twenty rounds is the difference between a strategy
   * game and an afternoon of clicking.
   *
   * rollsFor(index) supplies the randomness per move, so the caller keeps
   * control of the RNG.
   */
  function campaignBulk(game, actionId, seats, total, rollsFor) {
    var plan = planBulk(game, actionId, seats, total);
    if (!plan.ok) return { ok: false, reason: plan.reason, reports: [] };

    var reports = [];
    var spent = 0;
    var refused = [];

    plan.rows.forEach(function (row, i) {
      if (row.amount <= 0) return;
      var res = play(game, actionId, row.seat, rollsFor(i), row.amount);
      if (res.ok) {
        reports.push(res.report);
        spent += res.report.cost;
      } else {
        refused.push({ seat: row.seat, reason: res.reason });
      }
    });

    if (!reports.length) {
      return {
        ok: false,
        reason: (refused[0] && refused[0].reason) || 'Nothing could be played.',
        reports: [],
      };
    }

    return {
      ok: true,
      reports: reports,
      spent: spent,
      seats: reports.length,
      refused: refused,
      unspent: plan.unspent,
    };
  }

  /* ------------------------------------------------- acting for others */

  /**
   * The fields an action can move. An opponent keeps its own money, heat and
   * log; the board it campaigns on is the game's, shared with everyone else.
   */
  var ACTOR_FIELDS = [
    'cash', 'spent', 'roundSpent', 'roundActions', 'roundGained',
    'granted', 'raised', 'borrowed', 'repaid', 'interestPaid', 'finesPaid',
    'heat', 'defaults', 'borrowingBlocked', 'restrictedUntilTurn',
  ];

  /**
   * Run one of the engine's own functions as somebody other than the player.
   *
   * The engine was written with the player's game object as its subject, which
   * is the right shape for solo play. Rather than thread an actor through
   * every function, this lends the engine a view: the shared board and the
   * game's seed, with the actor's own purse and record. Whatever the action
   * moved is copied back afterwards. Arrays are shared by reference, so the
   * board, the action log and the loan book are the actor's real ones.
   */
  function asActor(game, actor, fn) {
    var view = {
      support: game.support,
      partyId: actor.partyId,
      seed: game.seed,
      round: game.round,
      turn: game.turn,
      roundsTotal: game.roundsTotal,
      budget: actor.budget,
      actions: actor.actions,
      loans: actor.loans,
      history: [],
    };
    ACTOR_FIELDS.forEach(function (k) {
      view[k] = actor[k];
    });

    var out = fn(view);

    ACTOR_FIELDS.forEach(function (k) {
      if (view[k] !== undefined) actor[k] = view[k];
    });
    return out;
  }

  /** Play one action for an opponent. Returns the report, or null. */
  function playAs(game, actor, actionId, target, rolls, amount) {
    var res = asActor(game, actor, function (view) {
      return play(view, actionId, target, rolls, amount);
    });
    return res && res.ok ? res.report : null;
  }

  /** Quote a loan for an opponent, at a given round. */
  function loanOfferFor(actor, amount, round) {
    return asActor({ support: {}, seed: '', round: round }, actor, function (view) {
      return loanOffer(view, amount);
    });
  }

  /** Take a loan for an opponent. */
  function takeLoanFor(actor, amount, round) {
    return asActor({ support: {}, seed: '', round: round }, actor, function (view) {
      return takeLoan(view, amount);
    });
  }

  /** Settle an opponent's loans, exactly as the player's are settled. */
  function settleLoansFor(game, actor, summary) {
    return asActor(game, actor, function (view) {
      return settleLoans(view, summary);
    });
  }

  /* ------------------------------------------------------ resolution */

  /**
   * Play one action. `rolls` supplies the randomness — an object with
   * outcome/consequence/consequencePick floats in [0,1) — so the caller
   * controls the RNG and tests can pin it.
   *
   * Mutates `game` and returns a report for the UI.
   */
  function play(game, actionId, target, rolls, amount) {
    var check = canPlay(game, actionId, target, amount);
    if (!check.ok) return { ok: false, reason: check.reason };

    var action = CMP.getAction(actionId);

    // What the player chose to put behind it, and what that buys.
    var cost = resolveAmount(action, amount);
    var scale = scaleFor(action, cost);
    var outcome = scaleOutcome(weightedPick(action.outcomes, rolls.outcome), scale);

    // Region purse first, then general cash. paid says where it came from.
    var paid = charge(game, target, cost);
    game.spent += paid.total;
    game.roundSpent = (game.roundSpent || 0) + paid.total;
    game.roundActions = (game.roundActions || 0) + 1;
    ledger(game, {
      kind: 'campaign',
      label: action.label,
      seat: target || null,
      region: paid.region,
      fromGrant: paid.grant,
      fromCash: paid.cash,
      amount: -paid.total,
    });

    // Money an outcome brings in. Grants are recorded apart from undisclosed
    // funding so the player's own breakdown stays honest about where the
    // campaign's money came from. It lands in general cash: it was not earned
    // by holding ground, so it is not tied to any region.
    var funds = outcome.funds || 0;
    if (funds > 0) {
      game.cash += funds;
      game.roundGained = (game.roundGained || 0) + funds;
      if (action.id === 'grant') game.granted += funds;
      else game.raised += funds;
      ledger(game, {
        kind: action.id === 'grant' ? 'funding' : 'raised',
        label: action.label,
        amount: funds,
      });
    }

    var applied = applySupport(game, target, outcome);

    // Dearer actions are seen beyond the seat they are aimed at. The spill is
    // a fraction of whatever actually happened, so a costly campaign that goes
    // wrong goes wrong across several seats too.
    if (action.reach && target && outcome.support) {
      // More money is seen in more places.
      var extra = Math.round(action.reach.seats * scale) - 1;
      if (extra > 0) {
        applied.reach = applyAcross(game, outcome.support * action.reach.share, extra, target);
      }
    }

    // An outcome with no constituency of its own — undisclosed funding going
    // wrong, say — still costs support, spread over the seats the player is
    // doing best in.
    if (!target && outcome.support) {
      applyAcross(game, outcome.support, outcome.seats || 1);
    }

    var heatBefore = game.heat;
    game.heat = clamp(game.heat + (outcome.heat || 0), 0, config().heat.max);

    var consequence = maybeConsequence(game, rolls);

    var record = {
      turn: game.turn,
      actionId: action.id,
      label: action.label,
      group: action.group,
      constituency: target || null,
      round: game.round,
      cost: cost,
      baseCost: action.cost,
      scale: Math.round(scale * 100) / 100,
      funds: funds,
      outcomeId: outcome.id,
      outcomeLabel: outcome.label,
      text: outcome.text,
      support: applied.player,
      opponentSupport: applied.opponent,
      reach: applied.reach || [],
      heatBefore: heatBefore,
      heatAfter: game.heat,
      cashAfter: game.cash,
      consequence: consequence,
    };
    game.actions.push(record);
    if (game.actions.length > 200) game.actions.shift();

    return { ok: true, report: record };
  }

  /** Move support in the target seat, keeping every seat normalised to 100. */
  function applySupport(game, number, outcome) {
    var applied = { player: 0, opponent: 0 };
    if (!number || !game.support[number]) return applied;

    var support = game.support[number];

    if (outcome.support) {
      applied.player = shift(support, game.partyId, outcome.support);
    }
    if (outcome.opponentSupport) {
      // Aim at whoever is actually ahead of the player in this seat.
      var ranked = standings(support);
      var targetParty = null;
      for (var i = 0; i < ranked.length; i++) {
        if (ranked[i].partyId !== game.partyId) {
          targetParty = ranked[i].partyId;
          break;
        }
      }
      if (targetParty) applied.opponent = shift(support, targetParty, outcome.opponentSupport);
    }

    normalise(support);
    return applied;
  }

  /** Add `delta` to one party, taking it from (or giving it to) the others. */
  function shift(support, partyId, delta) {
    var before = support[partyId] || 0;
    var after = clamp(before + delta, 1, 95);
    support[partyId] = after;
    return after - before;
  }

  function normalise(support) {
    var ids = Object.keys(support);
    var total = 0;
    ids.forEach(function (id) {
      support[id] = Math.max(0.5, support[id]);
      total += support[id];
    });
    if (total <= 0) return;
    ids.forEach(function (id) {
      support[id] = Math.round((support[id] / total) * 1000) / 10;
    });
  }

  /* ------------------------------------------------------ consequences */

  /**
   * Heat does not punish you on a schedule — it raises the odds. Below the
   * configured floor nothing ever fires; above it the chance rises with heat.
   */
  function maybeConsequence(game, rolls) {
    var cfg = config().heat;
    if (game.heat < cfg.minHeat) return null;

    var chance = (game.heat / cfg.max) * cfg.chanceFactor;
    if (rolls.consequence >= chance) return null;

    var eligible = config().consequences.filter(function (c) {
      return game.heat >= c.minHeat;
    });
    if (!eligible.length) return null;

    var pick = weightedPick(eligible, rolls.consequencePick);
    var hit = applyConsequence(game, pick, rolls);

    game.heat = clamp(game.heat + (pick.heat || 0), 0, cfg.max);

    return {
      id: pick.id,
      label: pick.label,
      text: pick.text,
      seats: hit,
      support: pick.support,
    };
  }

  /** Take support off the player in the seats they are most invested in. */
  function applyConsequence(game, consequence, rolls) {
    var numbers = Object.keys(game.support);
    if (!numbers.length) return [];

    // Hit where the player has been campaigning — that is what stings.
    var touched = {};
    game.actions.forEach(function (a) {
      if (a.constituency) touched[a.constituency] = (touched[a.constituency] || 0) + 1;
    });

    var ordered = numbers.slice().sort(function (a, b) {
        var diff = (touched[b] || 0) - (touched[a] || 0);
        if (diff !== 0) return diff;
        return (game.support[b][game.partyId] || 0) - (game.support[a][game.partyId] || 0);
      });

    var hit = [];
    var count = Math.min(consequence.seats || 1, ordered.length);
    for (var i = 0; i < count; i++) {
      var number = ordered[i];
      shift(game.support[number], game.partyId, consequence.support);
      normalise(game.support[number]);
      hit.push(Number(number));
    }
    return hit;
  }

  /* ----------------------------------------------------- election day */

  /**
   * Count all 117 seats. Solo only — multiplayer counts on the server, in
   * api/lib/Election.php, which does the same arithmetic in the same order
   * from the same config.
   *
   * The noise matters: without it a one-point lead on the last evening would
   * be a certainty, and every close seat would be decided before polling day.
   */
  function runElection(game) {
    var cfg = config().election;
    var rand = CMP.rng.create(game.seed + ':electionday');
    var perSeat = {};
    var totals = {};
    CMP.PARTIES.forEach(function (p) {
      totals[p.id] = 0;
    });

    Object.keys(game.support)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      })
      .forEach(function (number) {
        var seat = game.support[number];
        var final = {};
        Object.keys(seat).forEach(function (id) {
          final[id] = Math.max(0.5, seat[id] + (rand() - 0.5) * 2 * cfg.seatNoise);
        });
        normalise(final);

        var ranked = standings(final);
        perSeat[String(number)] = {
          winner: ranked[0].partyId,
          share: round1(ranked[0].support),
          margin: round1(ranked[0].support - (ranked[1] ? ranked[1].support : 0)),
        };
        totals[ranked[0].partyId] = (totals[ranked[0].partyId] || 0) + 1;
      });

    var rows = Object.keys(totals)
      .map(function (id) {
        // Opponents are candidates too. A result screen that named only the
        // player and listed three party names would read as though nobody
        // else had stood.
        var opponent = findOpponent(game, id);
        return {
          party: id,
          seats: totals[id],
          playerId: id === game.partyId ? 'solo' : (opponent ? opponent.id : null),
          candidate: id === game.partyId
            ? game.candidateName
            : (opponent ? opponent.candidateName : null),
          slot: id === game.partyId ? 1 : null,
          disqualified: false,
        };
      })
      .sort(function (a, b) {
        return b.seats - a.seats;
      });

    var winner = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].seats >= cfg.majority && !rows[i].disqualified) {
        winner = rows[i];
        break;
      }
    }

    return {
      perSeat: perSeat,
      standings: rows,
      totalSeats: cfg.totalSeats,
      majority: cfg.majority,
      outcome: winner ? 'majority' : 'hung',
      winner: winner,
      declaredAt: Math.floor(Date.now() / 1000),
    };
  }

  /* ------------------------------------------------------ projection */

  /**
   * Spread a support change over the seats this player cares about most —
   * the ones they have campaigned in, then the ones they are strongest in.
   * Returns the seat numbers hit.
   */
  function applyAcross(game, delta, count, except) {
    var touched = {};
    (game.actions || []).forEach(function (a) {
      if (a.constituency) touched[a.constituency] = (touched[a.constituency] || 0) + 1;
    });

    var numbers = Object.keys(game.support)
      .filter(function (n) {
        return except === undefined || except === null || String(n) !== String(except);
      })
      .sort(function (a, b) {
        var diff = (touched[b] || 0) - (touched[a] || 0);
        if (diff !== 0) return diff;
        return (game.support[b][game.partyId] || 0) - (game.support[a][game.partyId] || 0);
      });

    var hit = [];
    var n = Math.min(Math.max(1, count), numbers.length);
    for (var i = 0; i < n; i++) {
      shift(game.support[numbers[i]], game.partyId, delta);
      normalise(game.support[numbers[i]]);
      hit.push(Number(numbers[i]));
    }
    return hit;
  }

  /** Seats currently led, per party. Every party gets a key, including zero. */
  function seatCounts(support) {
    var counts = {};
    CMP.PARTIES.forEach(function (p) {
      counts[p.id] = 0;
    });
    Object.keys(support).forEach(function (number) {
      var ranked = standings(support[number]);
      if (ranked.length) counts[ranked[0].partyId] = (counts[ranked[0].partyId] || 0) + 1;
    });
    return counts;
  }

  /** Mean support across the whole board, for one party. */
  function averageSupport(support, partyId) {
    var numbers = Object.keys(support || {});
    if (!numbers.length || !partyId) return 0;
    var total = 0;
    numbers.forEach(function (n) {
      total += support[n][partyId] || 0;
    });
    return round1(total / numbers.length);
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /** ₹ in the units people actually say them in. */
  function money(paise) {
    if (paise >= 10000000) return '₹' + trim(paise / 10000000) + ' crore';
    if (paise >= 100000) return '₹' + trim(paise / 100000) + ' lakh';
    return '₹' + Math.round(paise).toLocaleString('en-IN');
  }

  function trim(v) {
    return String(Math.round(v * 100) / 100);
  }

  /** How many seats the player currently leads. */
  function seatsLed(game) {
    var count = 0;
    Object.keys(game.support).forEach(function (number) {
      var ranked = standings(game.support[number]);
      if (ranked.length && ranked[0].partyId === game.partyId) count++;
    });
    return count;
  }

  return {
    remaining: remaining,
    debtOf: debtOf,
    actionsLeft: actionsLeft,
    spendableOn: spendableOn,
    grantIn: grantIn,
    grantTotal: grantTotal,
    heldTotal: heldTotal,
    charge: charge,
    planBulk: planBulk,
    campaignBulk: campaignBulk,
    ledger: ledger,
    creditRoundIncome: creditRoundIncome,
    creditDistrictGrants: creditDistrictGrants,
    districtsHeldBy: districtsHeldBy,
    openingDistrictsFor: openingDistrictsFor,
    districtStanding: districtStanding,
    amountRange: amountRange,
    scaleFor: scaleFor,
    resolveAmount: resolveAmount,
    canPlay: canPlay,
    play: play,
    beginRound: beginRound,
    endRound: endRound,
    startNextRound: startNextRound,
    intermissionLeft: intermissionLeft,
    currentLeaders: currentLeaders,
    diffLeaders: diffLeaders,
    secondsLeft: secondsLeft,
    roundIsLive: roundIsLive,
    isFinalRound: isFinalRound,
    loanOffer: loanOffer,
    takeLoan: takeLoan,
    settleLoans: settleLoans,
    rollEvent: rollEvent,
    seatCounts: seatCounts,
    averageSupport: averageSupport,
    runElection: runElection,
    playAs: playAs,
    loanOfferFor: loanOfferFor,
    takeLoanFor: takeLoanFor,
    settleLoansFor: settleLoansFor,
    money: money,
    heatLevel: heatLevel,
    ratingFor: ratingFor,
    seatView: seatView,
    seatsLed: seatsLed,
    standings: standings,
    weightedPick: weightedPick,
    gamePartyFor: gamePartyFor,
    normalise: normalise,
  };
})();
