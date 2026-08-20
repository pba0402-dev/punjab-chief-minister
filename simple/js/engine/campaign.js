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

  function remaining(game) {
    return Math.max(0, game.budget - game.spent);
  }

  /**
   * Can this action be played right now? Returns { ok, reason }.
   * The UI uses the reason verbatim, so it has to read like a sentence.
   */
  function canPlay(game, actionId, target) {
    var action = CMP.getAction(actionId);
    if (!action) return { ok: false, reason: 'Unknown action.' };
    if (action.cost > remaining(game)) return { ok: false, reason: 'Insufficient Budget' };
    if (action.needsConstituency && !target) {
      return { ok: false, reason: 'Choose a constituency first' };
    }
    if (action.needsConstituency && !game.support[target]) {
      return { ok: false, reason: 'Unknown constituency' };
    }
    return { ok: true };
  }

  /* ------------------------------------------------------ resolution */

  /**
   * Play one action. `rolls` supplies the randomness — an object with
   * outcome/consequence/consequencePick floats in [0,1) — so the caller
   * controls the RNG and tests can pin it.
   *
   * Mutates `game` and returns a report for the UI.
   */
  function play(game, actionId, target, rolls) {
    var check = canPlay(game, actionId, target);
    if (!check.ok) return { ok: false, reason: check.reason };

    var action = CMP.getAction(actionId);
    var outcome = weightedPick(action.outcomes, rolls.outcome);

    game.spent += action.cost;

    var applied = applySupport(game, target, outcome);

    var heatBefore = game.heat;
    game.heat = clamp(game.heat + (outcome.heat || 0), 0, config().heat.max);

    var consequence = maybeConsequence(game, rolls);

    var record = {
      turn: game.turn,
      actionId: action.id,
      label: action.label,
      group: action.group,
      constituency: target || null,
      cost: action.cost,
      outcomeId: outcome.id,
      outcomeLabel: outcome.label,
      text: outcome.text,
      support: applied.player,
      opponentSupport: applied.opponent,
      heatBefore: heatBefore,
      heatAfter: game.heat,
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

  /* ------------------------------------------------------ projection */

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
    canPlay: canPlay,
    play: play,
    heatLevel: heatLevel,
    ratingFor: ratingFor,
    seatView: seatView,
    seatsLed: seatsLed,
    standings: standings,
    weightedPick: weightedPick,
    normalise: normalise,
  };
})();
