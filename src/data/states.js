/**
 * State registry.
 * ------------------------------------------------------------------
 * The whole game is driven from one of these records. Adding another Indian
 * state later means adding an entry here plus its seat + geometry data files
 * -- no engine or UI change. Nothing outside this file assumes "Punjab".
 *
 * A state definition supplies:
 *   chamber / office   : what the player is fighting for
 *   seats / geometry    : the political and cartographic data
 *   majority            : how many seats form a government
 *   campaign            : length, budget, actions per turn, phase schedule
 *   tuning              : the knobs the support model reads
 */
window.PG = window.PG || {};

PG.STATES = {
  punjab: {
    id: 'punjab',
    name: 'Punjab',
    demonym: 'Punjab',
    chamber: 'Punjab Legislative Assembly',
    chamberShort: 'Vidhan Sabha',
    office: 'Chief Minister of Punjab',
    officeShort: 'Chief Minister',
    electionName: 'Punjab Assembly Election',

    // Data sources (real-world reference data).
    seats: function () {
      return PG.PUNJAB_SEATS;
    },
    districts: function () {
      return PG.PUNJAB_DISTRICTS;
    },
    regions: function () {
      return PG.PUNJAB_REGIONS;
    },
    geometry: function () {
      return PG.GEOMETRY;
    },

    totalSeats: 117,
    // Simple majority of a 117-seat house = 59.
    majority: function (total) {
      return Math.floor(total / 2) + 1;
    },

    currency: { symbol: '₹', unit: 'cr', name: 'crore' },

    campaign: {
      turns: 10,
      turnLabel: 'Week',
      actionsPerTurn: 5,
      // Sub-phases of the campaign, keyed by the first turn they apply to.
      phases: [
        {
          from: 1,
          id: 'groundwork',
          label: 'Groundwork',
          blurb: 'Early weeks. Polling is rough and the picture is unclear.',
          effectMultiplier: 0.9,
          pollNoise: 6.0,
        },
        {
          from: 4,
          id: 'main',
          label: 'Main Campaign',
          blurb: 'The campaign is in full swing and the map is firming up.',
          effectMultiplier: 1.0,
          pollNoise: 3.6,
        },
        {
          from: 8,
          id: 'final',
          label: 'Final Stretch',
          blurb: 'Every rupee lands harder now, and the polling is sharp.',
          effectMultiplier: 1.35,
          pollNoise: 1.6,
        },
      ],
    },

    difficulties: {
      easy: {
        id: 'easy',
        label: 'Comfortable',
        blurb: 'A friendly map and rivals who campaign lazily.',
        budget: 320,
        playerBase: 3.5,
        rivalBudget: 0.24,
        rivalSkill: 0.45,
      },
      normal: {
        id: 'normal',
        label: 'Competitive',
        blurb: 'A genuine four-way fight. The recommended way to play.',
        budget: 340,
        playerBase: 0,
        rivalBudget: 0.27,
        rivalSkill: 0.75,
      },
      hard: {
        id: 'hard',
        label: 'Uphill Battle',
        blurb: 'You start behind and every rival targets you.',
        budget: 290,
        playerBase: -1.0,
        rivalBudget: 0.40,
        rivalSkill: 1.0,
      },
    },

    // Model tuning. All support figures are percentage points of vote share.
    tuning: {
      // Spread of the randomly generated political landscape.
      districtSpread: 4.0,
      seatSpread: 5.5,
      incumbencySpread: 3.0,
      candidateSpread: 3.2,

      // Campaign points -> vote share. share = maxSwing * (1 - e^(-points/scale))
      campaignMaxSwing: 34,
      campaignScale: 11,
      campaignDecay: 0.09, // per turn, on decaying action types

      issueWeight: 9.0, // how much issue alignment moves the needle
      candidateWeight: 1.0,
      leadershipWeight: 1.0,
      momentumWeight: 1.0,

      // Election-day randomness, in percentage points of vote share.
      seatNoise: 2.6, // independent, per seat
      regionSwing: 1.9, // correlated within a region
      stateSwing: 1.4, // correlated statewide

      // Margin thresholds (percentage points) for seat ratings.
      ratings: [
        { id: 'safe', label: 'Safe', min: 14 },
        { id: 'likely', label: 'Likely', min: 7 },
        { id: 'lean', label: 'Lean', min: 3 },
        { id: 'tossup', label: 'Toss-up', min: 0 },
      ],
    },
  },
};

PG.DEFAULT_STATE = 'punjab';

PG.getState = function (id) {
  var st = PG.STATES[id || PG.DEFAULT_STATE];
  if (!st) throw new Error('Unknown state: ' + id);
  return st;
};
