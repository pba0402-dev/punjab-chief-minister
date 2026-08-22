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

  // 5: the twenty-round economy. Cash carries forward, grants are held per
  // region, and a saved game from the fifteen-round rules cannot be read as
  // one of these — the bump is what retires it instead of crashing on it.
  var VERSION = 5;

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

      // Region-locked grant purses, the ledger behind every figure, and the
      // per-round keys that stop an allowance being paid twice.
      grants: {},
      incomeCredited: {},
      grantsCredited: {},
      incomeTotal: 0,
      grantTotalEarned: 0,
      districtsHeld: 0,
      ledger: [],
      priorityDistricts: [],
      roundReady: false,

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

      /*
       * Campaign influence per constituency, keyed by seat number.
       *
       * Every one of the 117 starts as {} — nobody has campaigned anywhere,
       * so no seat has a leader, a percentage or a status. Influence
       * accumulates as money is spent; the percentages shown anywhere are
       * that influence expressed as a share, worked out when it is needed and
       * never stored. See `standings` in the engine.
       */
      support: {},

      // The parties in this game, invented by whoever is playing. There is no
      // fixed list any more.
      parties: [],
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
      avatar: null,

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
   * An empty board.
   *
   * Every one of the 117 constituencies starts with nothing in it: no
   * influence, no leader, no percentage, no status. That is the whole
   * starting position, and it is deliberately not built from anything.
   *
   * This used to deal the board from the real sitting members, which made the
   * opening screen read as a live election tracker rather than as a game
   * nobody had played yet — and handed one side a lead it had not earned. A
   * seat is now worth exactly what has been spent in it.
   */
  function emptyBoard(game) {
    var support = {};
    CMP.CONSTITUENCIES.forEach(function (c) {
      support[c.number] = {};
    });
    game.support = support;
  }

  /** Check the setup form before starting. Budget is not asked for. */
  function validateSetup(draft) {
    var errors = {};

    if (!draft.candidateName || !draft.candidateName.trim()) {
      errors.candidateName = 'Enter your name.';
    }
    if (!draft.partyName || !draft.partyName.trim()) {
      errors.partyName = 'Name the party you are founding.';
    }
    // No slogan. It was one more thing to type before anybody could play, it
    // appeared on nothing that mattered, and a returning player had to invent
    // one again every time.

    var ok = true;
    for (var k in errors) {
      if (Object.prototype.hasOwnProperty.call(errors, k)) ok = false;
    }
    return { ok: ok, errors: errors };
  }

  /** Apply a validated setup to a fresh game and open the election screen. */
  function startElection(draft) {
    var game = create();
    game.mode = draft.mode || 'solo';
    game.seed = draft.seed || CMP.rng.newSeed();
    game.screen = 'election';

    game.candidateName = (draft.candidateName || '').trim();
    game.avatar = draft.avatar || CMP.avatarFor(game.seed + ':you');

    /*
     * The player's party, invented here and now.
     *
     * Slot one is always the human, so the id is the same in every game and
     * a save can be read without knowing who typed what.
     */
    game.partyId = CMP.partyIdForSlot(1);
    var mine = CMP.normalisePartyDef({
      id: game.partyId,
      slot: 1,
      name: draft.partyName,
      short: draft.partyShort,
      slogan: draft.slogan,
      symbol: draft.partySymbol,
      colourId: draft.partyColour,
    });
    game.slogan = mine.slogan;

    // The opponents invent theirs, avoiding whatever the player just took.
    var rivals = CMP.ai.opponentsFor(game.partyId, game.seed, mine);
    game.parties = [mine].concat(rivals.map(function (o) {
      return o.party;
    }));
    CMP.setParties(game.parties);

    emptyBoard(game);

    /*
     * Nobody holds anything, and no district is anybody's.
     *
     * There is no deal to inherit from any more — the board is empty — so the
     * list of districts that pay nothing is empty too. Every district in the
     * game is one somebody took.
     */
    game.openingDistricts = [];
    game.seatTotals = null;
    game.seatsDecided = false;
    game.seatsWon = 0;

    game.opponents = rivals;
    game.opponents.forEach(function (o) {
      o.seatsLed = 0;
      o.seatsBefore = 0;
      o.openingDistricts = [];
    });

    // No leader map yet either: with nothing decided, round one reports every
    // seat it decides as newly won rather than as a change from a position
    // nobody earned.
    game.leaders = {};
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
    emptyBoard: emptyBoard,
    validateSetup: validateSetup,
    startElection: startElection,
    isValid: isValid,
  };
})();
