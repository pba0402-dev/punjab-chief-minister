/**
 * Game engine.
 * ------------------------------------------------------------------
 * Owns the game state and the turn loop. Nothing in here touches the DOM or
 * localStorage; the UI reads state and calls these functions, never the
 * other way round.
 *
 * Turn loop, once per week:
 *   player spends actions -> endTurn -> decay -> rivals campaign -> events
 *   -> briefings written -> next week
 * After the final week the state moves to 'electionDay' and runElection()
 * simulates all seats at once.
 */
window.PG = window.PG || {};
PG.engine = (function () {
  'use strict';

  var SAVE_VERSION = 1;

  /* ------------------------------------------------------------ phases */

  function phaseFor(stateDef, turn) {
    var phases = stateDef.campaign.phases;
    var found = phases[0];
    for (var i = 0; i < phases.length; i++) {
      if (turn >= phases[i].from) found = phases[i];
    }
    return found;
  }

  /* ------------------------------------------------------------ new game */

  function newGame(opts) {
    var stateId = opts.stateId || PG.DEFAULT_STATE;
    var stateDef = PG.getState(stateId);
    var difficulty = opts.difficulty || 'normal';
    var diff = stateDef.difficulties[difficulty];
    var seed = opts.seed || PG.rng.randomSeed();
    var partyId = opts.partyId;
    var party = PG.PARTY_BY_ID[partyId];
    if (!party || !party.playable) throw new Error('Pick a playable party');

    var landscape = PG.model.generateLandscape(stateDef, seed, difficulty, partyId);

    var game = {
      version: SAVE_VERSION,
      id: seed + '-' + partyId,
      stateId: stateId,
      seed: seed,
      difficulty: difficulty,
      createdAt: opts.now || 0,
      updatedAt: opts.now || 0,
      player: {
        name: (opts.candidateName || '').trim() || 'Independent Candidate',
        partyId: partyId,
        slogan: (opts.slogan || '').trim() || party.slogan,
        strategyId: opts.strategyId || 'grassroots',
      },
      status: 'campaign', // campaign | electionDay | results
      turn: 1,
      budget: { total: diff.budget, spent: 0 },
      actionsLeft: stateDef.campaign.actionsPerTurn,
      seats: landscape.seats,
      leadership: {},
      momentum: {},
      org: {},
      bonus: { ad: 1, tours: 0 },
      uses: {},
      rivals: {},
      standing: {},
      feed: [],
      history: [],
      baseline: null,
      result: null,
    };

    PG.PARTIES.forEach(function (p) {
      game.leadership[p.id] = 0;
    });
    Object.keys(stateDef.regions()).forEach(function (r) {
      game.momentum[r] = {};
      PG.PARTIES.forEach(function (p) {
        game.momentum[r][p.id] = 0;
      });
    });

    // Rival purses, sized off the player's and spread over the campaign.
    PG.ai.rivalIds(game).forEach(function (pid) {
      var total = Math.round(diff.budget * diff.rivalBudget);
      game.rivals[pid] = {
        budget: total,
        perTurn: total / stateDef.campaign.turns,
        spent: 0,
      };
    });

    // Opening strategy.
    var strategy = PG.STRATEGY_BY_ID[game.player.strategyId];
    if (strategy) {
      var ctx = { strongestDistricts: strongestDistricts(game, partyId) };
      strategy.apply(game, ctx);
    }

    var opening = PG.model.projectAll(game, { fog: false });
    game.baseline = { counts: opening.counts, voteShare: opening.voteShare };
    game.standing = opening.voteShare;

    pushFeed(game, {
      kind: 'phase',
      tone: 'neutral',
      title: 'Campaign begins',
      text:
        'Nominations are in across all ' +
        stateDef.totalSeats +
        ' constituencies. ' +
        stateDef.campaign.turns +
        ' weeks to polling day, and ' +
        stateDef.majority(stateDef.totalSeats) +
        ' seats to win.',
    });

    return game;
  }

  function strongestDistricts(game, partyId) {
    var stateDef = PG.getState(game.stateId);
    var districts = stateDef.districts();
    return Object.keys(districts)
      .map(function (name) {
        var t = 0;
        districts[name].seats.forEach(function (n) {
          t += game.seats[n].base[partyId];
        });
        return { name: name, avg: t / districts[name].seats.length };
      })
      .sort(function (a, b) {
        return b.avg - a.avg;
      })
      .map(function (d) {
        return d.name;
      });
  }

  /* ------------------------------------------------------------ feed */

  function pushFeed(game, entry) {
    entry.turn = game.turn;
    game.feed.unshift(entry);
    if (game.feed.length > 160) game.feed.length = 160;
  }

  /* ------------------------------------------------------------ actions */

  function moneyLeft(game) {
    return game.budget.total - game.budget.spent;
  }

  function canPlay(game, actionId, target) {
    var action = PG.actions.byId[actionId];
    if (!action) return { ok: false, reason: 'Unknown action' };
    if (game.status !== 'campaign') return { ok: false, reason: 'Campaigning has closed' };
    if (game.actionsLeft <= 0) return { ok: false, reason: 'No campaign actions left this week' };

    var cost = PG.actions.costOf(game, game.player.partyId, actionId);
    if (cost > moneyLeft(game)) return { ok: false, reason: 'Not enough money left' };

    var left = PG.actions.usesLeft(game, game.player.partyId, actionId);
    if (left !== null && left <= 0) return { ok: false, reason: 'No uses of this remain' };

    if (action.scope === 'seat' && !(target && target.seat)) {
      return { ok: false, reason: 'Pick a constituency first' };
    }
    if (action.scope === 'district' && !(target && target.district)) {
      return { ok: false, reason: 'Pick a district first' };
    }
    if (action.scope === 'region' && !(target && target.region)) {
      return { ok: false, reason: 'Pick a region first' };
    }
    return { ok: true, cost: cost };
  }

  function play(game, actionId, target) {
    var check = canPlay(game, actionId, target);
    if (!check.ok) return check;

    var pid = game.player.partyId;
    var action = PG.actions.byId[actionId];
    var before = PG.model.seatShares(game, target.seat || firstSeatOf(game, target));

    var res = action.run(game, pid, target) || {};

    game.budget.spent += check.cost;
    game.actionsLeft -= 1;
    if (!game.uses[pid]) game.uses[pid] = {};
    game.uses[pid][actionId] = (game.uses[pid][actionId] || 0) + 1;

    var where = describeTarget(game, action, target);
    var after = PG.model.seatShares(game, target.seat || firstSeatOf(game, target));
    var delta = after[pid] - before[pid];

    pushFeed(game, {
      kind: 'action',
      tone: 'good',
      title: action.label,
      text: where + '.',
      seat: target.seat,
      district: target.district,
      region: target.region,
      cost: check.cost,
    });

    return { ok: true, cost: check.cost, delta: delta, result: res, action: action };
  }

  function firstSeatOf(game, target) {
    var stateDef = PG.getState(game.stateId);
    if (target.district) return stateDef.districts()[target.district].seats[0];
    if (target.region) return stateDef.regions()[target.region].seats[0];
    return stateDef.seats()[0].num;
  }

  function describeTarget(game, action, target) {
    if (target.seat) {
      var d = PG.index.seatDef(game.stateId, target.seat);
      return d.name + ', ' + d.district;
    }
    if (target.district) return 'across ' + target.district + ' district';
    if (target.region) return 'across the ' + target.region + ' region';
    return 'statewide';
  }

  /* ------------------------------------------------------------ end turn */

  function decay(game) {
    var stateDef = PG.getState(game.stateId);
    var rate = 1 - stateDef.tuning.campaignDecay;
    Object.keys(game.seats).forEach(function (num) {
      var seat = game.seats[num];
      Object.keys(seat.camp).forEach(function (pid) {
        seat.camp[pid] *= rate;
      });
      seat.mods = seat.mods.filter(function (m) {
        if (m.turnsLeft < 0) return true;
        m.turnsLeft -= 1;
        return m.turnsLeft > 0;
      });
    });
    PG.PARTIES.forEach(function (p) {
      game.leadership[p.id] *= 0.9;
    });
    Object.keys(game.momentum).forEach(function (r) {
      PG.PARTIES.forEach(function (p) {
        game.momentum[r][p.id] *= 0.8;
      });
    });
  }

  function endTurn(game) {
    if (game.status !== 'campaign') return { ok: false, reason: 'Campaigning has closed' };
    var stateDef = PG.getState(game.stateId);
    var before = PG.model.projectAll(game, { fog: false });

    decay(game);
    var rivalSpend = PG.ai.runTurn(game);
    var fired = PG.events.runTurn(game, before);

    fired.forEach(function (e) {
      pushFeed(game, {
        kind: 'event',
        tone: e.kind === 'positive' ? 'good' : e.kind === 'negative' ? 'bad' : 'neutral',
        title: e.title,
        text: e.text,
        seat: e.seat,
        district: e.district,
        region: e.region,
      });
    });

    var after = PG.model.projectAll(game, { fog: false });
    awardMomentum(game, before, after);
    game.standing = after.voteShare;
    game.history.push({
      turn: game.turn,
      playerSeats: after.playerSeats,
      voteShare: after.voteShare[game.player.partyId],
      spent: game.budget.spent,
    });

    briefings(game, before, after, rivalSpend).forEach(function (b) {
      pushFeed(game, b);
    });

    var wasPhase = phaseFor(stateDef, game.turn);
    game.turn += 1;
    game.actionsLeft = stateDef.campaign.actionsPerTurn;
    game.updatedAt = Date.now();

    if (game.turn > stateDef.campaign.turns) {
      game.status = 'electionDay';
      game.turn = stateDef.campaign.turns;
      pushFeed(game, {
        kind: 'phase',
        tone: 'neutral',
        title: 'Campaigning has closed',
        text: 'The silence period has begun. Nothing more can be done — Punjab votes tomorrow.',
      });
    } else {
      var nowPhase = phaseFor(stateDef, game.turn);
      if (nowPhase.id !== wasPhase.id) {
        pushFeed(game, {
          kind: 'phase',
          tone: 'neutral',
          title: nowPhase.label,
          text: nowPhase.blurb,
        });
      }
    }

    return { ok: true, events: fired };
  }

  /**
   * Regional momentum is earned, not given. A party that picks up seats in a
   * region this week gets a wave there that lifts every seat in it next week
   * -- and a party going backwards gets the reverse. This is what lets a
   * well-run campaign compound instead of grinding one seat at a time.
   */
  function awardMomentum(game, before, after) {
    var stateDef = PG.getState(game.stateId);
    var regions = stateDef.regions();
    Object.keys(regions).forEach(function (rName) {
      var counts = {};
      PG.PARTIES.forEach(function (p) {
        counts[p.id] = { before: 0, after: 0 };
      });
      regions[rName].seats.forEach(function (n) {
        counts[before.bySeat[n].rating.leader].before++;
        counts[after.bySeat[n].rating.leader].after++;
      });
      if (!game.momentum[rName]) game.momentum[rName] = {};
      PG.PARTIES.forEach(function (p) {
        var delta = counts[p.id].after - counts[p.id].before;
        if (!delta) return;
        var gain = delta * 0.3;
        var cur = game.momentum[rName][p.id] || 0;
        game.momentum[rName][p.id] = Math.max(-2.2, Math.min(2.2, cur + gain));
      });
    });
  }

  /* ------------------------------------------------------------ briefings */

  function briefings(game, before, after, rivalSpend) {
    var out = [];
    var pid = game.player.partyId;
    var stateDef = PG.getState(game.stateId);

    // Seat movement.
    var seatDelta = after.playerSeats - before.playerSeats;
    if (seatDelta !== 0) {
      out.push({
        kind: 'brief',
        tone: seatDelta > 0 ? 'good' : 'bad',
        title: 'Projection moves',
        text:
          'Your projected total ' +
          (seatDelta > 0 ? 'rises' : 'falls') +
          ' by ' +
          Math.abs(seatDelta) +
          ' to ' +
          after.playerSeats +
          ' of ' +
          after.total +
          '.',
      });
    }

    // Statewide tightening or stretching.
    function topTwoGap(p) {
      var r = PG.model.rank(p.voteShare);
      return r[0].share - r[1].share;
    }
    var gapBefore = topTwoGap(before);
    var gapAfter = topTwoGap(after);
    if (Math.abs(gapAfter - gapBefore) > 0.35) {
      out.push({
        kind: 'brief',
        tone: 'neutral',
        title: 'Statewide polling',
        text:
          gapAfter < gapBefore
            ? stateDef.name + '-wide polling has tightened at the top of the field.'
            : 'The gap at the top of the ' + stateDef.name + ' field has widened.',
      });
    }

    // Toss-ups appearing.
    var newTossups = after.bands.tossup - before.bands.tossup;
    if (newTossups >= 2) {
      out.push({
        kind: 'brief',
        tone: 'neutral',
        title: 'The map loosens',
        text: newTossups + ' more constituencies have become toss-ups.',
      });
    } else if (newTossups <= -2) {
      out.push({
        kind: 'brief',
        tone: 'neutral',
        title: 'The map hardens',
        text: Math.abs(newTossups) + ' toss-ups have settled into a clear lean.',
      });
    }

    // Regional momentum.
    var regions = stateDef.regions();
    Object.keys(regions).forEach(function (rName) {
      var b = 0;
      var a = 0;
      regions[rName].seats.forEach(function (n) {
        if (before.bySeat[n].rating.playerLeads) b++;
        if (after.bySeat[n].rating.playerLeads) a++;
      });
      if (a - b >= 2) {
        out.push({
          kind: 'brief',
          tone: 'good',
          title: 'Momentum in ' + rName,
          text: 'Your campaign is gaining ground in ' + rName + ' — up ' + (a - b) + ' seats there.',
          region: rName,
        });
      } else if (b - a >= 2) {
        out.push({
          kind: 'brief',
          tone: 'bad',
          title: 'Slipping in ' + rName,
          text: 'You have lost the lead in ' + (b - a) + ' ' + rName + ' seats this week.',
          region: rName,
        });
      }
    });

    // What the rivals did with their money.
    Object.keys(rivalSpend || {}).forEach(function (rid) {
      var byDistrict = rivalSpend[rid];
      var top = null;
      Object.keys(byDistrict).forEach(function (d) {
        if (!top || byDistrict[d] > byDistrict[top]) top = d;
      });
      if (top && byDistrict[top] >= 8) {
        out.push({
          kind: 'brief',
          tone: 'bad',
          title: PG.PARTY_BY_ID[rid].short + ' targets ' + top,
          text:
            PG.PARTY_BY_ID[rid].name +
            ' has stepped up spending across ' +
            top +
            ' district this week.',
          district: top,
        });
      }
    });

    return out.slice(0, 6);
  }

  /* ------------------------------------------------------------ election */

  function runElection(game) {
    if (game.status === 'results') return game.result;
    var stateDef = PG.getState(game.stateId);
    var sim = PG.model.simulateElection(game);
    var pid = game.player.partyId;
    var total = stateDef.totalSeats;
    var majority = stateDef.majority(total);
    var playerSeats = sim.seats[pid] || 0;

    var standings = PG.PARTIES.map(function (p) {
      return {
        id: p.id,
        seats: sim.seats[p.id] || 0,
        voteShare: sim.voteShare[p.id] || 0,
        change: (sim.seats[p.id] || 0) - (game.baseline.counts[p.id] || 0),
      };
    }).sort(function (a, b) {
      return b.seats - a.seats || b.voteShare - a.voteShare;
    });

    var largest = standings[0];
    var outcome;
    var coalition = null;

    if (playerSeats >= majority) {
      outcome = 'majority';
    } else if (largest.id === pid) {
      // Hung house, player largest: try to put a coalition together.
      var partners = standings
        .filter(function (s) {
          return s.id !== pid && s.seats > 0;
        })
        .sort(function (a, b) {
          return a.seats - b.seats;
        });
      var needed = majority - playerSeats;
      var partner = null;
      for (var i = 0; i < partners.length; i++) {
        if (partners[i].seats >= needed) {
          partner = partners[i];
          break;
        }
      }
      var usedAlliance = ((game.uses[pid] || {}).alliance || 0) > 0;
      var withinReach = playerSeats >= majority - 12;
      var goodwill = withinReach && (usedAlliance || playerSeats >= majority - 6);
      if (partner && goodwill) {
        outcome = 'coalition';
        coalition = { partnerId: partner.id, total: playerSeats + partner.seats };
      } else {
        outcome = 'hung';
      }
    } else {
      outcome = 'defeat';
    }

    var result = {
      perSeat: sim.perSeat,
      standings: standings,
      playerSeats: playerSeats,
      majority: majority,
      total: total,
      outcome: outcome,
      coalition: coalition,
      governmentFormed: outcome === 'majority' || outcome === 'coalition',
      spent: game.budget.spent,
      budget: game.budget.total,
      turnout: 0,
    };

    game.result = result;
    game.status = 'results';
    pushFeed(game, {
      kind: 'phase',
      tone: result.governmentFormed ? 'good' : 'bad',
      title: 'Result declared',
      text:
        PG.PARTY_BY_ID[pid].short +
        ' wins ' +
        playerSeats +
        ' of ' +
        total +
        ' seats. ' +
        (result.governmentFormed
          ? 'Government formed.'
          : 'Short of the ' + majority + ' needed.'),
    });
    return result;
  }

  /* ------------------------------------------------------------ misc */

  function seatsNeeded(game) {
    var stateDef = PG.getState(game.stateId);
    return stateDef.majority(stateDef.totalSeats);
  }

  function turnsLeft(game) {
    var stateDef = PG.getState(game.stateId);
    if (game.status !== 'campaign') return 0;
    return stateDef.campaign.turns - game.turn + 1;
  }

  return {
    SAVE_VERSION: SAVE_VERSION,
    newGame: newGame,
    phaseFor: phaseFor,
    canPlay: canPlay,
    play: play,
    endTurn: endTurn,
    runElection: runElection,
    moneyLeft: moneyLeft,
    seatsNeeded: seatsNeeded,
    turnsLeft: turnsLeft,
    pushFeed: pushFeed,
    strongestDistricts: strongestDistricts,
  };
})();
