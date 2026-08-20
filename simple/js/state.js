/**
 * Game state.
 * ------------------------------------------------------------------
 * One plain object describing a campaign, plus the few functions that make
 * and validate one. No DOM, no storage — the UI reads this, storage.js
 * persists it.
 */
window.CMP = window.CMP || {};

CMP.state = (function () {
  'use strict';

  var VERSION = 1;

  /** A blank campaign, before the player has filled anything in. */
  function create() {
    return {
      version: VERSION,
      screen: 'setup', // setup | election
      partyId: null,
      candidateName: '',
      slogan: '',
      budget: 0,
      seatsWon: 0,
      totalSeats: CMP.TOTAL_SEATS,
      majority: CMP.MAJORITY,
      // Filled in constituency by constituency in a later version. Keyed by
      // constituency number so results can be written in any order.
      constituencies: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Check a setup form before starting. Returns { ok, errors } where errors is
   * keyed by field, so the UI can show each message next to its input.
   */
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
    if (!draft.budget || draft.budget <= 0) {
      errors.budget = 'Enter your election budget.';
    }

    var ok = true;
    for (var k in errors) {
      if (Object.prototype.hasOwnProperty.call(errors, k)) ok = false;
    }
    return { ok: ok, errors: errors };
  }

  /** Apply a validated setup form to a fresh game and move to the election. */
  function startElection(draft) {
    var game = create();
    game.partyId = draft.partyId;
    game.candidateName = draft.candidateName.trim();
    game.slogan = draft.slogan.trim();
    game.budget = draft.budget;
    game.screen = 'election';
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
      typeof game.seatsWon === 'number'
    );
  }

  return {
    VERSION: VERSION,
    create: create,
    validateSetup: validateSetup,
    startElection: startElection,
    isValid: isValid,
  };
})();
