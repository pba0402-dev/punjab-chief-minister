/**
 * Campaign events.
 * ------------------------------------------------------------------
 * Controlled drama. Events are drawn once or twice a turn from a weighted
 * deck, always land on a named seat / district / region rather than the whole
 * campaign, and are capped small enough that no single roll can end a run.
 *
 * Events prefer places the player is actually active, so the campaign reacts
 * to what you are doing instead of firing into the void.
 */
window.PG = window.PG || {};
PG.events = (function () {
  'use strict';

  /* ---------------------------------------------------------- pickers */

  function activeSeats(game, partyId) {
    var out = [];
    Object.keys(game.seats).forEach(function (num) {
      if ((game.seats[num].spend[partyId] || 0) > 0) out.push(+num);
    });
    return out;
  }

  function pickSeat(game, rng, partyId, projection) {
    var active = activeSeats(game, partyId);
    var pool = active.length && rng.chance(0.7) ? active : Object.keys(game.seats).map(Number);
    // Prefer somewhere competitive so the event actually matters.
    var competitive = pool.filter(function (n) {
      var b = projection.bySeat[n].rating.band;
      return b === 'tossup' || b === 'lean';
    });
    return rng.pick(competitive.length && rng.chance(0.75) ? competitive : pool);
  }

  function pickDistrict(game, rng, partyId) {
    var st = PG.getState(game.stateId);
    var names = Object.keys(st.districts());
    var spent = {};
    activeSeats(game, partyId).forEach(function (n) {
      var d = PG.index.seatDef(game.stateId, n).district;
      spent[d] = (spent[d] || 0) + (game.seats[n].spend[partyId] || 0);
    });
    var busy = Object.keys(spent);
    return rng.pick(busy.length && rng.chance(0.65) ? busy : names);
  }

  function pickRegion(game, rng) {
    return rng.pick(Object.keys(PG.getState(game.stateId).regions()));
  }

  function strongestRival(game) {
    var best = null;
    PG.PARTIES.forEach(function (p) {
      if (p.id === game.player.partyId || !p.playable) return;
      var v = game.standing[p.id] || 0;
      if (!best || v > best.v) best = { id: p.id, v: v };
    });
    return best ? best.id : PG.PARTIES[0].id;
  }

  function seatName(game, num) {
    var d = PG.index.seatDef(game.stateId, num);
    return d.name + ' (' + d.district + ')';
  }

  /* ---------------------------------------------------------- deck */

  var DECK = [
    /* ------------------------------ positive */
    {
      id: 'bigCrowd',
      kind: 'positive',
      weight: 10,
      title: 'Rally draws a huge crowd',
      run: function (game, rng, proj) {
        var pid = game.player.partyId;
        var num = pickSeat(game, rng, pid, proj);
        PG.actions.addPoints(game, num, pid, 'camp', 2.4);
        return {
          seat: num,
          text:
            'Your meeting at ' +
            seatName(game, num) +
            ' overflowed onto the road. Local news carried it all evening.',
        };
      },
    },
    {
      id: 'localHero',
      kind: 'positive',
      weight: 9,
      title: 'A local favourite steps forward',
      run: function (game, rng, proj) {
        var pid = game.player.partyId;
        var num = pickSeat(game, rng, pid, proj);
        game.seats[num].candidate[pid] = (game.seats[num].candidate[pid] || 0) + 2.2;
        return {
          seat: num,
          text:
            'A well-liked panchayat leader in ' +
            seatName(game, num) +
            ' has agreed to carry your banner. Your candidate there is suddenly credible.',
        };
      },
    },
    {
      id: 'defection',
      kind: 'positive',
      weight: 6,
      title: 'A rival organiser crosses over',
      run: function (game, rng, proj) {
        var pid = game.player.partyId;
        var num = pickSeat(game, rng, pid, proj);
        var rival = strongestRival(game);
        PG.actions.addPoints(game, num, pid, 'camp', 2.0);
        PG.actions.addMod(game, num, rival, -1.6, -1, 'defection');
        return {
          seat: num,
          text:
            PG.PARTY_BY_ID[rival].short +
            "'s booth organiser in " +
            seatName(game, num) +
            ' has joined you, and brought his workers with him.',
        };
      },
    },
    {
      id: 'volunteerSurge',
      kind: 'positive',
      weight: 8,
      title: 'Volunteers turn out in force',
      run: function (game, rng) {
        var pid = game.player.partyId;
        var district = pickDistrict(game, rng, pid);
        var seats = PG.getState(game.stateId).districts()[district].seats;
        seats.forEach(function (n) {
          PG.actions.addPoints(game, n, pid, 'ground', 0.75);
        });
        return {
          district: district,
          text:
            'Booth committees across ' +
            district +
            ' filled up over the weekend. Your organisation there is noticeably stronger.',
        };
      },
    },
    {
      id: 'endorsement',
      kind: 'positive',
      weight: 6,
      title: 'A big endorsement lands',
      run: function (game, rng) {
        var pid = game.player.partyId;
        var region = pickRegion(game, rng);
        var seats = PG.getState(game.stateId).regions()[region].seats;
        seats.forEach(function (n) {
          PG.actions.addMod(game, n, pid, 0.9, 3, 'endorsement');
        });
        return {
          region: region,
          text:
            'A respected growers’ association across ' +
            region +
            ' has come out for you. Expect three good weeks in the region.',
        };
      },
    },
    {
      id: 'policyWin',
      kind: 'positive',
      weight: 5,
      title: 'Your policy launch cuts through',
      run: function (game) {
        var pid = game.player.partyId;
        game.leadership[pid] = (game.leadership[pid] || 0) + 0.55;
        return {
          text: 'Your manifesto launch led the evening bulletins statewide. Your personal standing is up.',
        };
      },
    },

    /* ------------------------------ negative */
    {
      id: 'controversy',
      kind: 'negative',
      weight: 9,
      title: 'Campaign controversy',
      run: function (game, rng) {
        var pid = game.player.partyId;
        var district = pickDistrict(game, rng, pid);
        var seats = PG.getState(game.stateId).districts()[district].seats;
        seats.forEach(function (n) {
          PG.actions.addMod(game, n, pid, -1.7, 3, 'controversy');
        });
        return {
          district: district,
          text:
            'A remark by one of your speakers in ' +
            district +
            ' is being replayed on every channel. It will cost you locally for a few weeks.',
        };
      },
    },
    {
      id: 'rivalSurge',
      kind: 'negative',
      weight: 9,
      title: 'A rival surges',
      run: function (game, rng) {
        var region = pickRegion(game, rng);
        var rival = strongestRival(game);
        if (!game.momentum[region]) game.momentum[region] = {};
        game.momentum[region][rival] = (game.momentum[region][rival] || 0) + 1.3;
        return {
          region: region,
          rival: rival,
          text:
            PG.PARTY_BY_ID[rival].name +
            ' has caught a wave across ' +
            region +
            '. Their numbers there are climbing.',
        };
      },
    },
    {
      id: 'promiseBacklash',
      kind: 'negative',
      weight: 7,
      title: 'Local backlash',
      run: function (game, rng, proj) {
        var pid = game.player.partyId;
        var num = pickSeat(game, rng, pid, proj);
        var issue = PG.ISSUE_BY_ID[game.seats[num].localIssue];
        PG.actions.addMod(game, num, pid, -2.0, 4, 'backlash');
        return {
          seat: num,
          text:
            'An agitation over ' +
            issue.label.toLowerCase() +
            ' has broken out in ' +
            seatName(game, num) +
            ', and your campaign is being blamed for ignoring it.',
        };
      },
    },
    {
      id: 'candidateResigns',
      kind: 'negative',
      weight: 5,
      title: 'A candidate withdraws',
      run: function (game, rng, proj) {
        var pid = game.player.partyId;
        var num = pickSeat(game, rng, pid, proj);
        var seat = game.seats[num];
        seat.candidate[pid] = Math.min(seat.candidate[pid] || 0, 0) - 1.4;
        return {
          seat: num,
          text:
            'Your candidate in ' +
            seatName(game, num) +
            ' has pulled out over a ticket dispute. The replacement is an unknown.',
        };
      },
    },
    {
      id: 'infighting',
      kind: 'negative',
      weight: 5,
      title: 'Infighting spills into public',
      run: function (game) {
        var pid = game.player.partyId;
        game.leadership[pid] = (game.leadership[pid] || 0) - 0.5;
        return {
          text:
            'Two of your state office-bearers traded accusations in front of reporters. Not a good look.',
        };
      },
    },
    {
      id: 'opponentBlitz',
      kind: 'negative',
      weight: 7,
      title: 'Rival pours money into a district',
      run: function (game, rng, proj) {
        var rival = strongestRival(game);
        var district = pickDistrict(game, rng, game.player.partyId);
        var seats = PG.getState(game.stateId).districts()[district].seats;
        seats.forEach(function (n) {
          PG.actions.addPoints(game, n, rival, 'camp', 1.5);
        });
        return {
          district: district,
          rival: rival,
          text:
            PG.PARTY_BY_ID[rival].short +
            ' has flooded ' +
            district +
            ' with hoardings and cable spots this week.',
        };
      },
    },
  ];

  var TOTAL_WEIGHT = DECK.reduce(function (t, e) {
    return t + e.weight;
  }, 0);

  /**
   * Draw and apply this turn's events. Early turns skew positive so the
   * opening of a campaign feels like it is going somewhere.
   */
  function runTurn(game, projection) {
    var stateDef = PG.getState(game.stateId);
    var rng = PG.rng.create(game.seed + ':events:' + game.turn);
    var count = rng.chance(0.45) ? 2 : 1;
    var progress = game.turn / stateDef.campaign.turns;
    var negativeBias = 0.35 + progress * 0.3; // 0.35 -> 0.65
    var fired = [];
    var used = {};

    for (var i = 0; i < count; i++) {
      var wantNegative = rng.chance(negativeBias);
      var pool = DECK.filter(function (e) {
        if (used[e.id]) return false;
        return wantNegative ? e.kind === 'negative' : e.kind === 'positive';
      });
      if (!pool.length) pool = DECK.filter(function (e) { return !used[e.id]; });
      if (!pool.length) break;

      var totalW = pool.reduce(function (t, e) {
        return t + e.weight;
      }, 0);
      var roll = rng.range(0, totalW);
      var chosen = pool[0];
      for (var j = 0; j < pool.length; j++) {
        roll -= pool[j].weight;
        if (roll <= 0) {
          chosen = pool[j];
          break;
        }
      }
      used[chosen.id] = true;
      var res = chosen.run(game, rng, projection) || {};
      fired.push({
        id: chosen.id,
        kind: chosen.kind,
        title: chosen.title,
        text: res.text || '',
        seat: res.seat,
        district: res.district,
        region: res.region,
        turn: game.turn,
      });
    }
    return fired;
  }

  return { runTurn: runTurn, deck: DECK, totalWeight: TOTAL_WEIGHT };
})();
