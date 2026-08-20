/**
 * Game state.
 * ------------------------------------------------------------------
 * One plain object describing a campaign, plus the functions that make and
 * validate one. No DOM, no storage, no network.
 *
 * Every player starts on the same budget from the config — it is never
 * entered by hand, and nothing here hard-codes the amount.
 */
window.CMP = window.CMP || {};

CMP.state = (function () {
  'use strict';

  var VERSION = 2;

  /** A blank campaign, before the player has filled anything in. */
  function create() {
    return {
      version: VERSION,
      mode: 'solo', // solo | multiplayer
      screen: 'setup',
      partyId: null,
      candidateName: '',
      slogan: '',

      budget: CMP.STARTING_BUDGET,
      spent: 0,
      heat: 0,

      seatsWon: 0,
      totalSeats: CMP.TOTAL_SEATS,
      majority: CMP.MAJORITY,

      // Support per constituency, keyed by number: { aap: 31.2, inc: 28.0, ... }
      support: {},
      // Every action taken, newest last.
      actions: [],

      turn: 1,
      seed: null,
      rollCount: 0,

      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Build the opening political map. Seeded, so the same game always starts
   * the same way, and every party begins genuinely in contention somewhere.
   */
  function seedSupport(game) {
    var rand = CMP.rng.create(game.seed + ':support');
    var parties = CMP.PARTIES.map(function (p) {
      return p.id;
    });

    // Each party gets a regional bias so the map has strongholds rather than
    // 117 identical seats.
    var bias = {};
    parties.forEach(function (id) {
      bias[id] = (rand() - 0.5) * 12;
    });

    var support = {};
    CMP.CONSTITUENCIES.forEach(function (c) {
      var seat = {};
      parties.forEach(function (id) {
        seat[id] = Math.max(3, 25 + bias[id] + (rand() - 0.5) * 22);
      });
      CMP.campaign.normalise(seat);
      support[c.number] = seat;
    });

    game.support = support;
  }

  /** Check the setup form before starting. Budget is not asked for. */
  function validateSetup(draft) {
    var errors = {};

    if (!draft.partyId || !CMP.getParty(draft.partyId)) {
      errors.partyId = 'Choose a party to lead.';
    }
    if (!draft.candidateName || !draft.candidateName.trim()) {
      errors.candidateName = 'Enter your candidate’s name.';
    }
    if (!draft.slogan || !draft.slogan.trim()) {
      errors.slogan = 'Enter an election slogan.';
    }

    var ok = true;
    for (var k in errors) {
      if (Object.prototype.hasOwnProperty.call(errors, k)) ok = false;
    }
    return { ok: ok, errors: errors };
  }

  /** Apply a validated setup to a fresh game and open the election screen. */
  function startElection(draft) {
    var game = create();
    game.partyId = draft.partyId;
    game.candidateName = (draft.candidateName || '').trim();
    game.slogan = (draft.slogan || '').trim();
    game.mode = draft.mode || 'solo';
    game.seed = draft.seed || CMP.rng.newSeed();
    game.screen = 'election';
    seedSupport(game);
    game.seatsWon = CMP.campaign.seatsLed(game);
    game.updatedAt = Date.now();
    return game;
  }

  /** True if a loaded object is a game this build understands. */
  function isValid(game) {
    return !!(
      game &&
      game.version === VERSION &&
      game.partyId &&
      CMP.getParty(game.partyId) &&
      typeof game.spent === 'number' &&
      typeof game.heat === 'number' &&
      game.support &&
      typeof game.support === 'object'
    );
  }

  return {
    VERSION: VERSION,
    create: create,
    seedSupport: seedSupport,
    validateSetup: validateSetup,
    startElection: startElection,
    isValid: isValid,
  };
})();
