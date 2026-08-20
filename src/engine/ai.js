/**
 * Rival campaigns.
 * ------------------------------------------------------------------
 * Every rival faces the same problem the player does -- a fixed purse and
 * 117 seats -- and solves it with the same action catalogue. Skill controls
 * how sharply they aim: a low-skill rival scatters money over seats it is
 * already winning, a high-skill rival hunts marginals.
 *
 * Rivals also react to the player: seats where the player has just surged
 * get extra attention, which is what makes late-campaign leads hard to hold.
 */
window.PG = window.PG || {};
PG.ai = (function () {
  'use strict';

  var BUYABLE = ['canvass', 'rally', 'advertising', 'candidateWork', 'volunteers'];

  function rivalIds(game) {
    return PG.PARTIES.filter(function (p) {
      return p.playable && p.id !== game.player.partyId;
    }).map(function (p) {
      return p.id;
    });
  }

  /** Score every seat for one rival: how much is a rupee here worth? */
  function targets(game, partyId, skill) {
    var st = PG.getState(game.stateId);
    var out = [];
    st.seats().forEach(function (def) {
      var shares = PG.model.seatShares(game, def.num);
      var ranked = PG.model.rank(shares);
      var mine = shares[partyId];
      var leader = ranked[0];
      var gap = leader.id === partyId ? mine - ranked[1].share : leader.share - mine;

      // Winnable and close is worth most; hopeless and safe are worth least.
      var value = 1 / (1 + Math.abs(gap) * 0.55);
      if (leader.id !== partyId && gap > 18) value *= 0.15; // out of reach
      if (leader.id === partyId && gap > 18) value *= 0.2; // already banked

      // Punish the player where they have been spending.
      var playerPush = game.seats[def.num].spend[game.player.partyId] || 0;
      value *= 1 + Math.min(0.7, playerPush * 0.016) * skill;

      out.push({ num: def.num, district: def.district, value: value });
    });
    out.sort(function (a, b) {
      return b.value - a.value;
    });
    return out;
  }

  /**
   * Spend one rival's weekly purse. Returns a spend-by-district summary the
   * briefing system uses to tell the player what their opponents did.
   */
  function runParty(game, partyId, rng) {
    var st = PG.getState(game.stateId);
    var diff = st.difficulties[game.difficulty];
    var skill = diff.rivalSkill;
    var purse = game.rivals[partyId].perTurn;
    var spentByDistrict = {};

    var ranked = targets(game, partyId, skill);
    // Low skill picks from a much wider, sloppier pool.
    var poolSize = Math.max(6, Math.round(ranked.length * (1.05 - skill * 0.9)));
    var pool = ranked.slice(0, poolSize);

    var guard = 0;
    while (purse >= 2 && guard++ < 40) {
      var pick = pool[Math.floor(Math.pow(rng.next(), 1 + skill * 2) * pool.length)];
      if (!pick) break;

      var affordable = BUYABLE.filter(function (id) {
        return PG.actions.costOf(game, partyId, id) <= purse;
      });
      if (!affordable.length) break;

      // Better rivals lean on the higher-leverage tools.
      var weights = {
        canvass: 3,
        rally: 2 + skill * 3,
        advertising: 1 + skill * 2,
        candidateWork: 1 + skill * 2.5,
        volunteers: 1 + skill,
      };
      var totalW = affordable.reduce(function (t, id) {
        return t + weights[id];
      }, 0);
      var roll = rng.range(0, totalW);
      var actionId = affordable[0];
      for (var i = 0; i < affordable.length; i++) {
        roll -= weights[affordable[i]];
        if (roll <= 0) {
          actionId = affordable[i];
          break;
        }
      }

      var action = PG.actions.byId[actionId];
      var cost = PG.actions.costOf(game, partyId, actionId);
      var target =
        action.scope === 'district' ? { district: pick.district } : { seat: pick.num };
      action.run(game, partyId, target);

      purse -= cost;
      game.rivals[partyId].spent += cost;
      spentByDistrict[pick.district] = (spentByDistrict[pick.district] || 0) + cost;
    }

    return spentByDistrict;
  }

  /** Run every rival for the current turn. */
  function runTurn(game) {
    var rng = PG.rng.create(game.seed + ':ai:' + game.turn);
    var summary = {};
    rivalIds(game).forEach(function (pid) {
      summary[pid] = runParty(game, pid, rng);
    });
    return summary;
  }

  return { runTurn: runTurn, rivalIds: rivalIds, targets: targets };
})();
