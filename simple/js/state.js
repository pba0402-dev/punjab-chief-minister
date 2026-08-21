/**
 * Game state.
 * ------------------------------------------------------------------
 * One plain object describing a campaign, plus the functions that make and
 * validate one. No DOM, no storage, no network.
 *
 * Every player starts on the same budget from the config — it is never
 * entered by hand, and nothing here hard-codes the amount.
 *
 * Cash and debt are separate numbers throughout. Cash is what can be spent and
 * never goes below zero; a loan puts money into cash but leaves a repayment
 * standing, so a campaign can look well funded and still be in trouble.
 */
window.CMP = window.CMP || {};

CMP.state = (function () {
  'use strict';

  var VERSION = 4;

  /** A blank campaign, before the player has filled anything in. */
  function create() {
    return {
      version: VERSION,
      mode: 'solo', // solo | multiplayer
      screen: 'setup',
      partyId: null,
      candidateName: '',
      slogan: '',

      // Money. budget is the opening grant and never changes; cash is what
      // is actually in hand right now.
      budget: CMP.STARTING_BUDGET,
      cash: CMP.STARTING_BUDGET,
      spent: 0,
      borrowed: 0,
      repaid: 0,
      interestPaid: 0,
      granted: 0,
      raised: 0,
      finesPaid: 0,
      loans: [],
      defaults: 0,
      borrowingBlocked: false,

      heat: 0,

      seatsWon: 0,
      totalSeats: CMP.TOTAL_SEATS,
      majority: CMP.MAJORITY,

      // Support per constituency, keyed by number: { aap: 31.2, inc: 28.0, ... }
      support: {},
      incumbency: {},
      // Every action taken, newest last.
      actions: [],

      // The round clock. In solo play the deadline is a local timestamp;
      // multiplayer takes its clock from the server instead.
      round: 1,
      roundsTotal: CMP.ROUNDS.total,
      roundSeconds: CMP.ROUNDS.seconds,
      roundEndsAt: 0,
      roundSpent: 0,
      roundGained: 0,
      roundActions: 0,
      roundOpen: null,
      summary: null,

      // One snapshot of the whole board per round, so a constituency can show
      // how its race moved rather than only where it ended up.
      history: [],
      seatTrend: [],

      // The scoreboard, and what it is compared against.
      stage: 'playing',
      nextRoundAt: 0,
      leaders: {},
      leadParty: null,
      lastResult: null,
      intermissionLeft: 0,

      // A fictional candidate portrait, fixed for the whole game.
      portraitSeed: null,

      // The parties nobody is playing get opponents, so the scoreboard always
      // has four competitors and a solo game is still an election.
      opponents: [],

      turn: 1,
      seed: null,
      rollCount: 0,

      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Build the opening political map from the real sitting MLAs.
   *
   * The party holding a seat starts ahead in it, by an amount rolled per seat
   * from the game seed so the map is not uniform. Incumbents whose party is
   * not one of the four playable ones sit under "Others".
   *
   * This is a starting position, not a prediction: campaigning can overturn
   * any of it, and the game never reproduces the real result on its own.
   */
  function seedSupport(game) {
    var rand = CMP.rng.create(game.seed + ':support');
    var cfg = CMP.CAMPAIGN.incumbency;
    var parties = CMP.PARTIES.map(function (p) {
      return p.id;
    });

    // One swing per party per game, applied to every seat. This is what stops
    // the real membership replaying itself: the incumbent bloc can start the
    // game under real pressure, or with a commanding lead, depending on the roll.
    var swing = {};
    parties.forEach(function (id) {
      // Others never gets a statewide swing — small parties and independents
      // hold seats one at a time, they do not surge across Punjab.
      swing[id] = id === 'oth'
        ? cfg.othersHandicap
        : (rand() - 0.5) * cfg.partySwingSpread;
    });

    var support = {};
    var incumbency = {};

    CMP.CONSTITUENCIES.forEach(function (c) {
      var sitting = CMP.getIncumbent(c.number);
      var holder = sitting ? CMP.campaign.gamePartyFor(sitting.party) : 'oth';

      // How entrenched is this particular incumbent?
      var level = CMP.campaign.weightedPick(cfg.levels, rand());

      var seat = {};
      parties.forEach(function (id) {
        seat[id] = Math.max(2, cfg.baseSupport + swing[id] + (rand() - 0.5) * cfg.spread);
      });
      seat[holder] += level.advantage;

      CMP.campaign.normalise(seat);
      support[c.number] = seat;
      incumbency[c.number] = { party: holder, level: level.id, label: level.label };
    });

    game.swing = swing;
    game.support = support;
    game.incumbency = incumbency;
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
    game.portraitSeed = draft.portraitSeed || (game.seed + ':you');
    seedSupport(game);
    game.seatsWon = CMP.campaign.seatsLed(game);

    // An opponent for every party the player did not take.
    game.opponents = CMP.ai.opponentsFor(game.partyId, game.seed);
    var counts = CMP.campaign.seatCounts(game.support);
    game.opponents.forEach(function (o) {
      o.seatsLed = counts[o.partyId] || 0;
      o.seatsBefore = o.seatsLed;
    });

    // The opening leader map, so round one reports real changes rather than
    // announcing all 117 seats at once.
    game.leaders = CMP.campaign.currentLeaders(game.support);
    CMP.campaign.beginRound(game, 1);
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
      typeof game.cash === 'number' &&
      typeof game.round === 'number' &&
      Array.isArray(game.opponents) &&
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
