/**
 * The election model.
 * ------------------------------------------------------------------
 * Two jobs:
 *   1. generateLandscape() -- build a plausible, seeded political map for a
 *      state: base support per party per seat, issue salience, incumbents,
 *      candidate quality. Run once at the start of a campaign.
 *   2. project() / simulate() -- turn the live game state into vote shares,
 *      seat ratings and, on election day, actual winners.
 *
 * No DOM, no UI, no storage. Everything here is a pure function of the game
 * state plus the seed.
 */
window.PG = window.PG || {};
PG.model = (function () {
  'use strict';

  var CLAMP_MIN = 0.6; // a party never drops below this share

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function normalise(raw) {
    var total = 0;
    var out = {};
    var k;
    for (k in raw) {
      out[k] = Math.max(CLAMP_MIN, raw[k]);
      total += out[k];
    }
    for (k in out) out[k] = (out[k] / total) * 100;
    return out;
  }

  /* ------------------------------------------------------------------
   * 1. Landscape generation
   * ---------------------------------------------------------------- */

  /**
   * Build the starting political map. Returns { seats, meta } where seats is
   * keyed by constituency number. Deterministic for a given seed.
   */
  function generateLandscape(stateDef, seed, difficulty, playerPartyId) {
    var rng = PG.rng.create(seed + ':landscape');
    var seatDefs = stateDef.seats();
    var districts = stateDef.districts();
    var tuning = stateDef.tuning;
    var diff = stateDef.difficulties[difficulty];
    var parties = PG.PARTIES;
    var issues = PG.ISSUES;

    // A per-district shock, so neighbouring seats lean the same way and the
    // map has real strongholds rather than 117 independent coin flips.
    var districtShock = {};
    Object.keys(districts).forEach(function (dName) {
      districtShock[dName] = {};
      parties.forEach(function (p) {
        districtShock[dName][p.id] = rng.gauss(tuning.districtSpread);
      });
    });

    var seats = {};
    seatDefs.forEach(function (def) {
      var base = {};
      var issueSalience = {};
      var candidate = {};
      var totalSal = 0;

      issues.forEach(function (issue) {
        var s = issue.salience[def.settlement] * (1 + rng.gauss(0.16));
        issueSalience[issue.id] = Math.max(0.05, s);
        totalSal += issueSalience[issue.id];
      });
      // Normalise salience so every seat has the same total attention to give.
      issues.forEach(function (issue) {
        issueSalience[issue.id] = (issueSalience[issue.id] / totalSal) * issues.length;
      });

      // The single issue that dominates local conversation here.
      var localIssue = issues[0].id;
      issues.forEach(function (issue) {
        if (issueSalience[issue.id] > issueSalience[localIssue]) localIssue = issue.id;
      });

      parties.forEach(function (p) {
        var v = p.stateBase;
        v += p.regionLean[def.region] || 0;
        v += p.settlementLean[def.settlement] || 0;
        v += districtShock[def.district][p.id];
        v += rng.gauss(tuning.seatSpread);
        // SC-reserved seats shuffle the pack a little differently.
        if (def.reservation === 'SC') v += rng.gauss(2.0);
        if (p.id === playerPartyId) v += diff.playerBase;
        base[p.id] = Math.max(1.5, v);

        candidate[p.id] = rng.gauss(tuning.candidateSpread);
      });

      base = normalise(base);

      // Sitting member: usually whoever is strongest, sometimes not.
      var ranked = parties
        .map(function (p) {
          return { id: p.id, v: base[p.id] };
        })
        .sort(function (a, b) {
          return b.v - a.v;
        });
      var incumbent = rng.chance(0.72) ? ranked[0].id : ranked[1].id;
      var incumbencyEffect = rng.gauss(tuning.incumbencySpread);

      seats[def.num] = {
        num: def.num,
        base: base,
        issueSalience: issueSalience,
        localIssue: localIssue,
        incumbent: incumbent,
        incumbencyEffect: incumbencyEffect,
        candidate: candidate,
        camp: {},
        ground: {},
        mods: [],
        spend: {},
        visited: 0,
      };
    });

    return { seats: seats, seed: seed };
  }

  /* ------------------------------------------------------------------
   * 2. Support projection
   * ---------------------------------------------------------------- */

  // Mean party credibility per issue, so alignment is a relative advantage.
  var meanCred = (function () {
    var m = {};
    PG.ISSUES.forEach(function (issue) {
      var t = 0;
      PG.PARTIES.forEach(function (p) {
        t += p.credibility[issue.id] || 0.5;
      });
      m[issue.id] = t / PG.PARTIES.length;
    });
    return m;
  })();

  function issueAlignment(party, seat) {
    var total = 0;
    var weight = 0;
    PG.ISSUES.forEach(function (issue) {
      var sal = seat.issueSalience[issue.id];
      total += sal * ((party.credibility[issue.id] || 0.5) - meanCred[issue.id]);
      weight += sal;
    });
    return weight ? total / weight : 0;
  }

  /** Diminishing-returns curve from campaign points to vote share. */
  function campaignBonus(points, tuning) {
    if (!points || points <= 0) return 0;
    return tuning.campaignMaxSwing * (1 - Math.exp(-points / tuning.campaignScale));
  }

  /**
   * True underlying vote shares for one seat. This is what the election is
   * actually decided on; the player only ever sees a fogged version.
   */
  function seatShares(game, seatNum) {
    var stateDef = PG.getState(game.stateId);
    var tuning = stateDef.tuning;
    var def = PG.index.seatDef(game.stateId, seatNum);
    var seat = game.seats[seatNum];
    var raw = {};

    PG.PARTIES.forEach(function (p) {
      var v = seat.base[p.id];

      var pts = (seat.camp[p.id] || 0) + (seat.ground[p.id] || 0) * 0.75;
      v += campaignBonus(pts, tuning);

      v += (seat.candidate[p.id] || 0) * tuning.candidateWeight;

      v += issueAlignment(p, seat) * tuning.issueWeight;

      if (seat.incumbent === p.id) v += seat.incumbencyEffect;

      v += (game.leadership[p.id] || 0) * tuning.leadershipWeight;

      var mom = game.momentum[def.region];
      if (mom) v += (mom[p.id] || 0) * tuning.momentumWeight;

      raw[p.id] = v;
    });

    // Timed modifiers from events and alliances.
    seat.mods.forEach(function (m) {
      if (raw[m.partyId] !== undefined) raw[m.partyId] += m.delta;
    });

    return normalise(raw);
  }

  /* ------------------------------------------------------------------
   * 3. Ratings and reporting
   * ---------------------------------------------------------------- */

  function rank(shares) {
    return Object.keys(shares)
      .map(function (id) {
        return { id: id, share: shares[id] };
      })
      .sort(function (a, b) {
        return b.share - a.share;
      });
  }

  /** Rating for a seat from the point of view of `viewParty`. */
  function rate(shares, viewParty, tuning) {
    var r = rank(shares);
    var leader = r[0];
    var margin = r[0].share - r[1].share;
    var band = tuning.ratings[tuning.ratings.length - 1];
    for (var i = 0; i < tuning.ratings.length; i++) {
      if (margin >= tuning.ratings[i].min) {
        band = tuning.ratings[i];
        break;
      }
    }
    var playerShare = shares[viewParty] || 0;
    var playerRank = 1;
    r.forEach(function (e, idx) {
      if (e.id === viewParty) playerRank = idx + 1;
    });
    // The gap the player has to close (negative if they are ahead).
    var gap = leader.id === viewParty ? -(margin) : leader.share - playerShare;
    return {
      leader: leader.id,
      leaderShare: leader.share,
      runnerUp: r[1].id,
      margin: margin,
      band: band.id,
      bandLabel: band.label,
      playerLeads: leader.id === viewParty,
      playerShare: playerShare,
      playerRank: playerRank,
      gap: gap,
      ranked: r,
    };
  }

  /**
   * What the player is allowed to see. Adds stable per-turn polling noise that
   * shrinks as the campaign progresses, so early reads are unreliable but a
   * seat does not flicker within a single turn.
   */
  function pollShares(game, seatNum) {
    var stateDef = PG.getState(game.stateId);
    var phase = PG.engine.phaseFor(stateDef, game.turn);
    var truth = seatShares(game, seatNum);
    if (phase.pollNoise <= 0) return truth;
    var raw = {};
    Object.keys(truth).forEach(function (pid) {
      raw[pid] =
        truth[pid] + PG.rng.stableGauss(phase.pollNoise, game.seed, 'poll', game.turn, seatNum, pid);
    });
    return normalise(raw);
  }

  /* ------------------------------------------------------------------
   * 4. Election day
   * ---------------------------------------------------------------- */

  /**
   * Run the whole state. Correlated swings (statewide and per region) sit on
   * top of independent per-seat noise, so results move in waves rather than
   * 117 coin flips -- which is both more realistic and more dramatic.
   */
  function simulateElection(game) {
    var stateDef = PG.getState(game.stateId);
    var tuning = stateDef.tuning;
    var rng = PG.rng.create(game.seed + ':election');
    var regions = stateDef.regions();

    var stateSwing = {};
    PG.PARTIES.forEach(function (p) {
      stateSwing[p.id] = rng.gauss(tuning.stateSwing);
    });

    var regionSwing = {};
    Object.keys(regions).forEach(function (rName) {
      regionSwing[rName] = {};
      PG.PARTIES.forEach(function (p) {
        regionSwing[rName][p.id] = rng.gauss(tuning.regionSwing);
      });
    });

    var results = {};
    var votes = {};
    var seatCount = {};
    PG.PARTIES.forEach(function (p) {
      votes[p.id] = 0;
      seatCount[p.id] = 0;
    });

    var seatDefs = stateDef.seats();
    seatDefs.forEach(function (def) {
      var truth = seatShares(game, def.num);
      var raw = {};
      PG.PARTIES.forEach(function (p) {
        raw[p.id] =
          truth[p.id] +
          stateSwing[p.id] +
          regionSwing[def.region][p.id] +
          rng.gauss(tuning.seatNoise);
      });
      var final = normalise(raw);
      var r = rank(final);
      results[def.num] = {
        shares: final,
        winner: r[0].id,
        runnerUp: r[1].id,
        margin: r[0].share - r[1].share,
      };
      seatCount[r[0].id]++;
      PG.PARTIES.forEach(function (p) {
        votes[p.id] += final[p.id];
      });
    });

    var voteShare = {};
    PG.PARTIES.forEach(function (p) {
      voteShare[p.id] = votes[p.id] / seatDefs.length;
    });

    return {
      perSeat: results,
      seats: seatCount,
      voteShare: voteShare,
      stateSwing: stateSwing,
      regionSwing: regionSwing,
    };
  }

  /* ------------------------------------------------------------------
   * 5. Aggregates
   * ---------------------------------------------------------------- */

  /** Projected seat counts and ratings across the whole state. */
  function projectAll(game, options) {
    var opts = options || {};
    var stateDef = PG.getState(game.stateId);
    var tuning = stateDef.tuning;
    var useFog = opts.fog !== false;
    var seatDefs = stateDef.seats();

    var counts = {};
    var bands = { safe: 0, likely: 0, lean: 0, tossup: 0 };
    var playerBands = { safe: 0, likely: 0, lean: 0, tossup: 0 };
    var bySeat = {};
    var voteTotal = {};
    PG.PARTIES.forEach(function (p) {
      counts[p.id] = 0;
      voteTotal[p.id] = 0;
    });

    seatDefs.forEach(function (def) {
      var shares = useFog ? pollShares(game, def.num) : seatShares(game, def.num);
      var r = rate(shares, game.player.partyId, tuning);
      bySeat[def.num] = { shares: shares, rating: r };
      counts[r.leader]++;
      bands[r.band]++;
      if (r.playerLeads) playerBands[r.band]++;
      PG.PARTIES.forEach(function (p) {
        voteTotal[p.id] += shares[p.id];
      });
    });

    var voteShare = {};
    PG.PARTIES.forEach(function (p) {
      voteShare[p.id] = voteTotal[p.id] / seatDefs.length;
    });

    return {
      bySeat: bySeat,
      counts: counts,
      bands: bands,
      playerBands: playerBands,
      voteShare: voteShare,
      playerSeats: counts[game.player.partyId] || 0,
      total: seatDefs.length,
      majority: stateDef.majority(seatDefs.length),
    };
  }

  /** District-level roll-up, used by the district view. */
  function districtSummary(game, projection, districtName) {
    var stateDef = PG.getState(game.stateId);
    var district = stateDef.districts()[districtName];
    var playerId = game.player.partyId;
    var out = {
      name: districtName,
      region: district.region,
      seats: district.seats.length,
      player: 0,
      opponents: 0,
      competitive: 0,
      spend: 0,
      leaders: {},
      seatList: district.seats.slice(),
    };
    district.seats.forEach(function (num) {
      var p = projection.bySeat[num];
      if (p.rating.playerLeads) out.player++;
      else out.opponents++;
      if (p.rating.band === 'tossup' || p.rating.band === 'lean') out.competitive++;
      out.leaders[p.rating.leader] = (out.leaders[p.rating.leader] || 0) + 1;
      out.spend += game.seats[num].spend[playerId] || 0;
    });
    var mom = game.momentum[district.region] || {};
    out.momentum = mom[playerId] || 0;
    return out;
  }

  return {
    generateLandscape: generateLandscape,
    seatShares: seatShares,
    pollShares: pollShares,
    campaignBonus: campaignBonus,
    issueAlignment: issueAlignment,
    rate: rate,
    rank: rank,
    normalise: normalise,
    simulateElection: simulateElection,
    projectAll: projectAll,
    districtSummary: districtSummary,
    clamp: clamp,
  };
})();
