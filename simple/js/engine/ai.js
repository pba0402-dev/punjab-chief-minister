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

  /**
   * A party nobody typed in.
   *
   * Built from the same three-part pattern a real new party's name tends to
   * follow — a place, a cause, a kind of body — so the four names on a
   * scoreboard sound like they belong to the same election without any two of
   * them being the same. Every part is invented, and the combinations that
   * would land on a real party's name are kept out of the pools.
   */
  function inventParty(slot, rand, taken) {
    var cfg = config();
    var pick = function (list) {
      return list[Math.floor(rand() * list.length) % list.length];
    };
    var free = function (list, used) {
      var open = list.filter(function (x) {
        return used.indexOf(typeof x === 'string' ? x : x.id) === -1;
      });
      return pick(open.length ? open : list);
    };

    var name;
    for (var tries = 0; tries < 12; tries++) {
      name = pick(cfg.partyPrefixes) + ' ' + pick(cfg.partyThemes) + ' ' +
        pick(cfg.partyBodies);
      if (taken.names.indexOf(name.toLowerCase()) === -1) break;
    }
    taken.names.push(name.toLowerCase());

    var colour = free(CMP.PARTY_COLOURS, taken.colours);
    taken.colours.push(colour.id);
    var symbol = free(CMP.PARTY_SYMBOLS, taken.symbols);
    taken.symbols.push(symbol.id);

    var short = CMP.suggestShort(name);
    if (taken.shorts.indexOf(short) !== -1) short = short + (slot + 1);
    taken.shorts.push(short);

    return CMP.normalisePartyDef({
      id: CMP.partyIdForSlot(slot),
      slot: slot,
      name: name,
      short: short,
      symbol: symbol.id,
      colourId: colour.id,
    });
  }

  /** Build an opponent, entirely from the seed. */
  function create(slot, seed, taken) {
    var cfg = config();
    var partyId = CMP.partyIdForSlot(slot);
    var rand = CMP.rng.create(seed + ':ai:' + partyId);
    var pick = function (list) {
      return list[Math.floor(rand() * list.length) % list.length];
    };

    var profile = pick(cfg.profiles);
    var given = pick(cfg.givenNames);
    var surname = pick(cfg.surnames);
    var slogan = pick(cfg.slogans);

    var party = inventParty(slot, rand, taken);
    party.slogan = slogan;

    var avatar = CMP.avatarUnused(taken.avatars, seed + ':' + partyId);
    taken.avatars.push(avatar);

    return {
      id: 'ai-' + partyId,
      isAI: true,
      partyId: partyId,
      party: party,
      profileId: profile.id,
      candidateName: given + ' ' + surname,
      slogan: slogan,
      avatar: avatar,

      // Opponents run on the same economy as the player: nothing to start
      // with, five crore a round, and whatever they hold ground for.
      cash: CMP.STARTING_BUDGET,
      budget: CMP.STARTING_BUDGET,
      grants: {},
      incomeCredited: {},
      grantsCredited: {},
      incomeTotal: 0,
      grantTotalEarned: 0,
      districtsHeld: 0,
      ledger: [],
      roundSpent: 0,
      roundReady: false,
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

  /**
   * The three rivals in a solo game.
   *
   * Each invents its own party. What has already been claimed is threaded
   * through so no two of them share a colour, a symbol, an abbreviation or a
   * face — four candidates on a scoreboard have to be four people at a
   * glance, and that is not something to leave to a roll.
   */
  function opponentsFor(partyId, seed, playerParty) {
    var taken = {
      names: playerParty ? [String(playerParty.name).toLowerCase()] : [],
      shorts: playerParty ? [playerParty.short] : [],
      colours: playerParty && playerParty.colourId ? [playerParty.colourId] : [],
      symbols: playerParty ? [playerParty.symbol] : [],
      avatars: [],
    };

    var out = [];
    for (var slot = 2; slot <= 4; slot++) {
      out.push(create(slot, seed, taken));
    }
    return out;
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

    /*
     * A round is bounded by money, not by a move counter.
     *
     * An opponent plays until it runs out of things it can afford or decides
     * it would rather save — chooseAction returns null for both. The ceiling
     * is a runaway backstop, not a rule.
     */
    var allowed = 24;

    for (var move = 0; move < allowed; move++) {
      var action = chooseAction(opponent, profile, rand, round, reserve);
      if (!action) break;

      var target = null;
      if (action.needsConstituency) {
        target = chooseSeat(game.support, opponent.partyId, profile, rand, opponent);
        if (!target) break;
      }

      // How much goes behind it: spread over the moves still to come, plus
      // whatever the region purse can add.
      var amount = chooseAmount(opponent, action, round, target);

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
   * The most one move could possibly put behind itself: general cash plus the
   * largest single region purse, because a move lands in one region.
   */
  function spendableCeiling(opponent) {
    var best = 0;
    var grants = opponent.grants || {};
    Object.keys(grants).forEach(function (region) {
      best = Math.max(best, Math.max(0, grants[region] || 0));
    });
    return (opponent.cash || 0) + best;
  }

  /**
   * The region holding the most grant money, if it is worth aiming at.
   *
   * Money that can only be spent in Malwa should be spent in Malwa. An
   * opponent that campaigned wherever the closest race happened to be would
   * strand its grant income the moment it lost the district that earned it.
   */
  function richestRegion(opponent, floor) {
    var best = null;
    var bestAmount = floor || 0;
    var grants = opponent.grants || {};
    Object.keys(grants).forEach(function (region) {
      var amount = Math.max(0, grants[region] || 0);
      if (amount > bestAmount) {
        bestAmount = amount;
        best = region;
      }
    });
    return best;
  }

  /**
   * How much to put behind one move: cash divided by the moves still expected,
   * plus the region purse in full, clamped to what the action allows.
   */
  function chooseAmount(opponent, action, round, target) {
    if (!action.allowsAmount) return null;

    // Spread over the moves still to come rather than the moves in a round,
    // because there is no longer a moves-per-round number to divide by. Four
    // a round is what the money actually buys at these costs.
    var roundsLeft = Math.max(1, CMP.ROUNDS.total - round + 1);
    var movesLeft = roundsLeft * 4;

    /*
     * Against what this particular move can draw on — cash plus the purse for
     * its own region — rather than against cash alone. Grant money is
     * region-locked and cannot be saved for later somewhere else, so there is
     * nothing to gain by holding it back.
     */
    var pot = CMP.campaign.spendableOn(opponent, target);
    var budget = Math.floor(pot.cash / movesLeft) + pot.grant;
    var range = CMP.campaign.amountRange(action);
    return Math.max(range.min, Math.min(range.max, budget));
  }

  /**
   * What to play next. Risky strategies are reached for in proportion to the
   * profile's appetite, and only while the heat is bearable — an opponent that
   * ran itself to a disqualification every game would be no opponent at all.
   */
  function chooseAction(opponent, profile, rand, round, reserve) {
    /*
     * Grant money is money.
     *
     * It is locked to the region that earned it, so it cannot be added to the
     * cash pile — but any one move lands in exactly one region and can draw
     * that region's purse in full. The biggest purse is therefore the right
     * ceiling for "can this opponent afford to play at all": counting only
     * cash left it sitting on tens of crores of grant income while it
     * declared itself broke.
     */
    var spendable = Math.max(0, spendableCeiling(opponent) - (reserve || 0));

    var heat = opponent.heat || 0;
    var heatMax = CMP.CAMPAIGN.heat.max;
    var restricted = (opponent.restrictedUntilTurn || 0) >= round;

    /*
     * Heat is a dial the opponent watches, and it stops turning it well
     * before the ceiling.
     *
     * Consequences fire at heat/100 of a chance on every action, floored
     * below minHeat — so once heat is past that floor, every move is rolling
     * against itself, and a round is now as many moves as the money buys
     * rather than three. Sitting at seventy used to cost a little; it now
     * costs on every move of every round. So the line is drawn where
     * consequences actually begin.
     */
    var backoff = config().heatBackoff || 0.5;
    var consequencesFrom = CMP.CAMPAIGN.heat.minHeat || heatMax;
    var runningHot = heat >= Math.min(heatMax * backoff, consequencesFrom);

    var safe = [];
    var risky = [];
    var funding = [];

    CMP.ACTIONS.forEach(function (action) {
      if (action.cost > spendable) return;

      // Crossing the floor for one strategy taxes the whole rest of the
      // campaign, which is a bad trade at any appetite. So the appetite
      // decides how readily the room below the floor is used, not whether to
      // go through it.
      if (action.group === 'risky') {
        if (restricted || runningHot) return;
        if (heat + (action.heat || 0) >= consequencesFrom) return;
        risky.push(action);
        return;
      }
      if (action.group === 'funding') {
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
      return null;
    }

    if (risky.length && rand() < profile.riskAppetite) {
      return risky[Math.floor(rand() * risky.length) % risky.length];
    }

    // Thin against what a round costs, not against a starting budget nobody
    // is given any more.
    if (spendable < ((CMP.INCOME || {}).perRound || 0) * 0.35 && rand() < 0.3) {
      var g = find(funding, 'grant');
      if (g) return g;
    }

    return safe[Math.floor(rand() * safe.length) % safe.length];
  }

  /**
   * The district worth finishing.
   *
   * A district pays its grant every round for the rest of the game, so the
   * two seats that complete one are worth far more than two seats anywhere
   * else — and a human who works that out is fifteen seats ahead of an
   * opponent that only ever plays the closest race. Value is the grant over
   * the square of what is still missing, so a district needing one seat beats
   * a richer one needing four.
   *
   * Districts already held when the board was dealt pay nothing, so finishing
   * one of those is worth no more than any other seat.
   */
  function districtTarget(support, partyId, opponent) {
    if (!CMP.DISTRICTS || !CMP.DISTRICTS.length) return null;
    var leaders = CMP.campaign.currentLeaders(support);
    var opening = (opponent && opponent.openingDistricts) || [];

    var best = null;
    CMP.DISTRICTS.forEach(function (d) {
      if (opening.indexOf(d.id) !== -1) return;

      // The board is keyed by string throughout, so hand back strings.
      var missing = d.seats.filter(function (n) {
        return leaders[n] !== partyId;
      }).map(String);
      if (!missing.length || missing.length > 3) return;

      var value = d.grant / (missing.length * missing.length);
      if (!best || value > best.value) best = { value: value, missing: missing };
    });
    return best;
  }

  /**
   * Where to campaign: among the seats this party is closest to taking or
   * losing, since that is where a move changes the seat count — unless a
   * district is nearly complete, in which case finishing it buys income as
   * well as a seat.
   */
  function chooseSeat(support, partyId, profile, rand, opponent) {
    var numbers = Object.keys(support);
    if (!numbers.length) return null;

    function closest(pool) {
      var margins = pool.map(function (key) {
        var seat = support[key];
        var mine = seat[partyId] || 0;
        var best = 0;
        Object.keys(seat).forEach(function (pid) {
          if (pid !== partyId && seat[pid] > best) best = seat[pid];
        });
        return { key: String(key), margin: Math.abs(mine - best) };
      });
      margins.sort(function (a, b) {
        return a.margin - b.margin;
      });
      return margins;
    }

    /*
     * Not every move, or the opponent would tunnel on one district while the
     * rest of the board walked away from it. Often enough that holding
     * ground is part of how it plays.
     */
    var appetite = typeof profile.territoryFocus === 'number' ? profile.territoryFocus : 0.45;
    if (rand() < appetite) {
      var target = districtTarget(support, partyId, opponent);
      if (target) {
        var near = closest(target.missing);
        if (near.length) return near[0].key;
      }
    }

    /*
     * Otherwise, if a region is holding real grant money, campaign there. The
     * purse cannot be moved and cannot be saved for anywhere else, so a close
     * race in the wrong region is worth less than a slightly wider one that
     * the grant will actually pay for.
     */
    if (opponent) {
      var region = richestRegion(opponent, (CMP.ACTIONS[0] || {}).cost || 0);
      if (region) {
        var inRegion = numbers.filter(function (key) {
          return CMP.regionOfSeat(Number(key)) === region;
        });
        if (inRegion.length) {
          var pool = closest(inRegion).slice(0, Math.max(1, profile.targetSpread));
          return pool[Math.floor(rand() * pool.length) % pool.length].key;
        }
      }
    }

    var shortlist = closest(numbers).slice(0, Math.max(1, profile.targetSpread));
    return shortlist[Math.floor(rand() * shortlist.length) % shortlist.length].key;
  }

  /** Borrow when the purse is thin and the bill can plausibly be met. */
  function maybeBorrow(opponent, round, rand) {
    // Thin against what a round costs, not against a starting budget nobody
    // is given any more.
    var roundIncome = (CMP.INCOME || {}).perRound || 0;
    if ((opponent.cash || 0) > roundIncome) return;
    if (CMP.campaign.debtOf(opponent) > 0) return;

    var cfg = CMP.FINANCE.loan;
    var ceiling = CMP.campaign.maxLoan(opponent);
    if (ceiling < cfg.minAmount) return;

    var amount = Math.min(ceiling, cfg.minAmount + Math.floor(rand() * 4) * cfg.increments);
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
    districtTarget: districtTarget,
  };
})();
