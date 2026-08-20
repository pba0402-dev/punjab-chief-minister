/**
 * Campaign actions.
 * ------------------------------------------------------------------
 * The catalogue below is the game's balance sheet: every cost and every
 * effect a player or rival can buy lives here and nowhere else.
 *
 * Effects are deliberately NOT equally powerful per rupee:
 *   - canvassing is cheap, steady and safe
 *   - rallies buy a burst that decays, and spill into neighbouring seats
 *   - candidate work is slow and expensive but permanent and undecaying
 *   - promises are the highest ceiling and the lowest floor: they only pay
 *     if you have read what the constituency actually cares about
 *   - leadership tours are the best value in the game and strictly rationed
 *
 * Campaign points feed a diminishing-returns curve (see model.campaignBonus),
 * so pouring everything into one seat is always the wrong move.
 */
window.PG = window.PG || {};
PG.actions = (function () {
  'use strict';

  var URBANICITY = { urban: 1.0, 'semi-urban': 0.55, rural: 0.2 };

  function urbanicity(def) {
    return URBANICITY[def.settlement] || 0.5;
  }

  /* ------------------------------------------------------- helpers */

  function addPoints(game, seatNum, partyId, channel, amount) {
    var seat = game.seats[seatNum];
    var bucket = seat[channel];
    bucket[partyId] = (bucket[partyId] || 0) + amount;
  }

  function addSpend(game, seatNum, partyId, amount) {
    var seat = game.seats[seatNum];
    seat.spend[partyId] = (seat.spend[partyId] || 0) + amount;
  }

  function addMod(game, seatNum, partyId, delta, turns, source) {
    game.seats[seatNum].mods.push({
      partyId: partyId,
      delta: delta,
      turnsLeft: turns === undefined ? -1 : turns,
      source: source || '',
    });
  }

  /** Effect multiplier for a party acting on a seat, from traits + org level. */
  function multiplier(game, partyId, seatNum, actionId) {
    var stateDef = PG.getState(game.stateId);
    var def = PG.index.seatDef(game.stateId, seatNum);
    var party = PG.PARTY_BY_ID[partyId];
    var phase = PG.engine.phaseFor(stateDef, game.turn);
    var m = phase.effectMultiplier;

    var org = (game.org[partyId] || {})[def.district] || 0;
    m *= 1 + org;

    // Opening-strategy bonuses apply to the player only.
    if (partyId === game.player.partyId && actionId === 'advertising') {
      m *= (game.bonus && game.bonus.ad) || 1;
    }

    if (party.trait && party.trait.id === 'kisanBase') {
      if (def.settlement === 'rural' && (actionId === 'rally' || actionId === 'canvass')) {
        m *= 1.25;
      }
    }
    return m;
  }

  /** Distribute a pool of points across seats, weighted. */
  function spread(game, partyId, seatNums, pool, weightFn, channel, actionId, money) {
    var weights = seatNums.map(weightFn);
    var total = weights.reduce(function (a, b) {
      return a + b;
    }, 0) || 1;
    seatNums.forEach(function (num, i) {
      var share = weights[i] / total;
      addPoints(game, num, partyId, channel, pool * share * multiplier(game, partyId, num, actionId));
      if (money) addSpend(game, num, partyId, money * share);
    });
  }

  /* ------------------------------------------------------- catalogue */

  var CATALOGUE = [
    {
      id: 'canvass',
      label: 'Door-to-Door Canvass',
      icon: '\u{1F6AA}',
      scope: 'seat',
      cost: 2,
      tempo: 'Slow burn',
      blurb:
        'Workers walk the streets of one constituency. Cheap and dependable, and it never fades.',
      detail: 'Small, permanent gain in one seat. The best value per rupee if you have the weeks to spare.',
      run: function (game, partyId, target) {
        var m = multiplier(game, partyId, target.seat, 'canvass');
        addPoints(game, target.seat, partyId, 'camp', 1.9 * m);
        addPoints(game, target.seat, partyId, 'ground', 0.55 * m);
        addSpend(game, target.seat, partyId, this.cost);
        return { touched: [target.seat] };
      },
    },
    {
      id: 'rally',
      label: 'Public Rally',
      icon: '\u{1F4E3}',
      scope: 'seat',
      cost: 6,
      tempo: 'Burst',
      blurb: 'A crowd, a stage and a headline. Big immediate lift that fades week by week.',
      detail: 'Strong gain in the target seat and a smaller lift in every neighbouring constituency.',
      run: function (game, partyId, target) {
        var geo = PG.index.seatGeo(game.stateId, target.seat);
        addPoints(
          game,
          target.seat,
          partyId,
          'camp',
          5.4 * multiplier(game, partyId, target.seat, 'rally')
        );
        addSpend(game, target.seat, partyId, this.cost);
        var nbrs = geo.neighbours.slice(0, 5);
        nbrs.forEach(function (n) {
          addPoints(game, n, partyId, 'camp', 1.05 * multiplier(game, partyId, n, 'rally'));
        });
        // Every rally is also a bit of statewide visibility.
        game.leadership[partyId] = (game.leadership[partyId] || 0) + 0.13;
        return { touched: [target.seat].concat(nbrs) };
      },
    },
    {
      id: 'advertising',
      label: 'Media & Print Blitz',
      icon: '\u{1F4FA}',
      scope: 'district',
      cost: 9,
      tempo: 'Burst',
      blurb: 'Radio, cable, hoardings and full-page ads across a whole district.',
      detail: 'Covers every seat in the district. Lands hardest in urban constituencies.',
      costFor: function (game, partyId) {
        var p = PG.PARTY_BY_ID[partyId];
        return p.trait && p.trait.id === 'deepPockets' ? 7 : 9;
      },
      run: function (game, partyId, target) {
        var st = PG.getState(game.stateId);
        var seats = st.districts()[target.district].seats;
        spread(
          game,
          partyId,
          seats,
          Math.min(30, 2.2 * seats.length),
          function (num) {
            return 0.5 + urbanicity(PG.index.seatDef(game.stateId, num));
          },
          'camp',
          'advertising',
          this.costFor(game, partyId)
        );
        game.leadership[partyId] = (game.leadership[partyId] || 0) + 0.21;
        return { touched: seats.slice() };
      },
    },
    {
      id: 'candidateWork',
      label: 'Strengthen Local Candidate',
      icon: '\u{1F454}',
      scope: 'seat',
      cost: 5,
      tempo: 'Permanent',
      blurb:
        'Back the constituency candidate: local office, a better ticket, visible endorsement.',
      detail:
        'Raises candidate quality permanently. Immune to decay and to whatever your rivals do next.',
      run: function (game, partyId, target) {
        var seat = game.seats[target.seat];
        var m = PG.engine.phaseFor(PG.getState(game.stateId), game.turn).effectMultiplier;
        seat.candidate[partyId] = (seat.candidate[partyId] || 0) + 2.8 * m;
        addSpend(game, target.seat, partyId, this.cost);
        return { touched: [target.seat] };
      },
    },
    {
      id: 'volunteers',
      label: 'Volunteer Mobilisation',
      icon: '\u{1F91D}',
      scope: 'district',
      cost: 4,
      tempo: 'Compounding',
      blurb: 'Sign up karyakartas, open booth committees and build a machine.',
      detail:
        'Permanent grassroots gain across the district, and everything you do there afterwards works better.',
      costFor: function (game, partyId) {
        var p = PG.PARTY_BY_ID[partyId];
        return p.trait && p.trait.id === 'volunteerArmy' ? 3 : 4;
      },
      run: function (game, partyId, target) {
        var st = PG.getState(game.stateId);
        var party = PG.PARTY_BY_ID[partyId];
        var boost = party.trait && party.trait.id === 'volunteerArmy' ? 1.35 : 1;
        var seats = st.districts()[target.district].seats;
        spread(
          game,
          partyId,
          seats,
          Math.min(16, 1.15 * seats.length) * boost,
          function () {
            return 1;
          },
          'ground',
          'volunteers',
          this.costFor(game, partyId)
        );
        if (!game.org[partyId]) game.org[partyId] = {};
        var cur = game.org[partyId][target.district] || 0;
        game.org[partyId][target.district] = Math.min(0.36, cur + 0.12 * boost);
        return { touched: seats.slice() };
      },
    },
    {
      id: 'promise',
      label: 'Development Promise',
      icon: '\u{1F3D7}',
      scope: 'seat',
      needsIssue: true,
      cost: 7,
      tempo: 'Targeted',
      blurb: 'Commit publicly to one thing this constituency has been asking for.',
      detail:
        'Huge if it matches what the seat actually cares about, close to worthless if it does not. Your party is more convincing on issues it owns.',
      run: function (game, partyId, target) {
        var seat = game.seats[target.seat];
        var party = PG.PARTY_BY_ID[partyId];
        var issueId = target.issue || seat.localIssue;
        var sal = seat.issueSalience[issueId] || 1;
        var cred = party.credibility[issueId] || 0.5;
        var pts = Math.max(0.8, Math.min(12, 2.0 + 7.5 * (sal - 0.75)));
        pts *= 0.6 + 0.8 * cred;
        pts *= multiplier(game, partyId, target.seat, 'promise');
        addPoints(game, target.seat, partyId, 'camp', pts);
        addSpend(game, target.seat, partyId, this.cost);
        return { touched: [target.seat], issue: issueId, strength: pts };
      },
    },
    {
      id: 'leadershipTour',
      label: 'Leadership Tour',
      icon: '\u{2B50}',
      scope: 'district',
      cost: 14,
      maxUses: 2,
      tempo: 'Statewide',
      blurb: 'You spend three days in one district. Cameras follow, and the state notices.',
      detail:
        'The strongest action in the game. Lifts the whole district, spills into neighbouring districts and raises your statewide standing. Strictly rationed.',
      maxUsesFor: function (game, partyId) {
        var extra = partyId === game.player.partyId ? (game.bonus && game.bonus.tours) || 0 : 0;
        return 2 + extra;
      },
      run: function (game, partyId, target) {
        var st = PG.getState(game.stateId);
        var districts = st.districts();
        var seats = districts[target.district].seats;
        spread(
          game,
          partyId,
          seats,
          Math.min(34, 2.6 * seats.length),
          function () {
            return 1;
          },
          'camp',
          'leadershipTour',
          this.cost
        );

        // Spill into districts that physically border this one.
        var neighbourDistricts = {};
        seats.forEach(function (num) {
          PG.index.seatGeo(game.stateId, num).neighbours.forEach(function (n) {
            var d = PG.index.seatDef(game.stateId, n).district;
            if (d !== target.district) neighbourDistricts[d] = true;
          });
        });
        var spillSeats = [];
        Object.keys(neighbourDistricts).forEach(function (d) {
          spillSeats = spillSeats.concat(districts[d].seats);
        });
        if (spillSeats.length) {
          spread(
            game,
            partyId,
            spillSeats,
            Math.min(16, 0.55 * spillSeats.length),
            function () {
              return 1;
            },
            'camp',
            'leadershipTour',
            0
          );
        }

        game.leadership[partyId] = (game.leadership[partyId] || 0) + 2.1;
        var region = districts[target.district].region;
        if (!game.momentum[region]) game.momentum[region] = {};
        game.momentum[region][partyId] = (game.momentum[region][partyId] || 0) + 1.1;

        return { touched: seats.concat(spillSeats), districts: Object.keys(neighbourDistricts) };
      },
    },
    {
      id: 'alliance',
      label: 'Alliance & Outreach',
      icon: '\u{1F91C}',
      scope: 'region',
      cost: 18,
      maxUses: 1,
      tempo: 'Regional',
      blurb:
        'Cut a deal with local outfits and independents across one of Punjab’s three regions.',
      detail:
        'Converts a slice of the smallest rival’s vote to you across an entire region — permanently. Rivals elsewhere will make you pay for it.',
      costFor: function (game, partyId) {
        var p = PG.PARTY_BY_ID[partyId];
        return p.trait && p.trait.id === 'coalitionBuilders' ? 13 : 18;
      },
      maxUsesFor: function (game, partyId) {
        var p = PG.PARTY_BY_ID[partyId];
        return p.trait && p.trait.id === 'coalitionBuilders' ? 2 : 1;
      },
      run: function (game, partyId, target) {
        var st = PG.getState(game.stateId);
        var regions = st.regions();
        var seats = regions[target.region].seats;
        var self = this;
        seats.forEach(function (num) {
          var seat = game.seats[num];
          // Take from the weakest rival in this seat, plus the unaligned vote.
          var rivals = PG.PARTIES.filter(function (p) {
            return p.id !== partyId;
          })
            .map(function (p) {
              return { id: p.id, v: seat.base[p.id] };
            })
            .sort(function (a, b) {
              return a.v - b.v;
            });
          var take = Math.min(3.4, rivals[0].v * 0.42);
          addMod(game, num, partyId, take, -1, 'alliance');
          addMod(game, num, rivals[0].id, -take, -1, 'alliance');
          addSpend(game, num, partyId, self.costFor(game, partyId) / seats.length);
        });
        // Backlash: rivals elsewhere use the deal against you.
        Object.keys(regions).forEach(function (rName) {
          if (rName === target.region) return;
          regions[rName].seats.forEach(function (num) {
            addMod(game, num, partyId, -0.75, -1, 'alliance-backlash');
          });
        });
        return { touched: seats.slice(), region: target.region };
      },
    },
  ];

  var BY_ID = CATALOGUE.reduce(function (m, a) {
    m[a.id] = a;
    return m;
  }, {});

  function costOf(game, partyId, actionId) {
    var a = BY_ID[actionId];
    return a.costFor ? a.costFor(game, partyId) : a.cost;
  }

  function maxUsesOf(game, partyId, actionId) {
    var a = BY_ID[actionId];
    if (!a.maxUses) return null;
    return a.maxUsesFor ? a.maxUsesFor(game, partyId) : a.maxUses;
  }

  function usesLeft(game, partyId, actionId) {
    var max = maxUsesOf(game, partyId, actionId);
    if (max === null) return null;
    var used = ((game.uses || {})[partyId] || {})[actionId] || 0;
    return Math.max(0, max - used);
  }

  return {
    catalogue: CATALOGUE,
    byId: BY_ID,
    costOf: costOf,
    maxUsesOf: maxUsesOf,
    usesLeft: usesLeft,
    urbanicity: urbanicity,
    multiplier: multiplier,
    addMod: addMod,
    addPoints: addPoints,
  };
})();
