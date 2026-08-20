/**
 * Parties.
 * ------------------------------------------------------------------
 * FICTIONAL parties invented for this game. They are not stand-ins for, and
 * carry no data from, any real political organisation. Everything about a
 * party lives in this file -- name, colours, where its vote sits, what it is
 * trusted on, and one passive trait. Nothing else in the codebase hard-codes
 * a party name or id.
 *
 *   credibility  : per-issue trust, 0..1. Multiplied by a seat's issue
 *                  salience to produce the issue-alignment term.
 *   regionLean   : percentage points added to base support in a region.
 *   settlementLean: percentage points added by settlement type.
 *   trait        : a passive read by the engine (see engine/actions.js).
 */
window.PG = window.PG || {};

PG.PARTIES = [
  {
    id: 'ppp',
    name: 'Punjab Progressive Party',
    short: 'PPP',
    colour: '#f0a020',
    ink: '#3a2400',
    slogan: 'Khet, Kaam, Khushhali',
    tagline: 'A farmer-first party with deep roots across the Malwa belt.',
    playable: true,
    stateBase: 22.9,
    credibility: {
      agriculture: 0.92,
      jobs: 0.5,
      economy: 0.55,
      infrastructure: 0.5,
      education: 0.55,
      healthcare: 0.78,
      lawOrder: 0.45,
    },
    regionLean: { Malwa: 3.5, Majha: -3, Doaba: -4 },
    settlementLean: { urban: -6, 'semi-urban': 0.5, rural: 7 },
    trait: {
      id: 'kisanBase',
      label: 'Kisan Base',
      blurb: 'Rallies and canvassing are 25% more effective in rural seats.',
    },
  },
  {
    id: 'ppf',
    name: "Punjab People's Front",
    short: 'PPF',
    colour: '#19b892',
    ink: '#00312a',
    slogan: 'Naujawan Punjab, Nawan Punjab',
    tagline: 'A youth and jobs movement built on volunteers, strongest in Majha.',
    playable: true,
    stateBase: 20.5,
    credibility: {
      agriculture: 0.55,
      jobs: 0.92,
      economy: 0.62,
      infrastructure: 0.5,
      education: 0.85,
      healthcare: 0.6,
      lawOrder: 0.5,
    },
    regionLean: { Malwa: -2.5, Majha: 7, Doaba: 5 },
    settlementLean: { urban: 1, 'semi-urban': 7, rural: -8 },
    trait: {
      id: 'volunteerArmy',
      label: 'Volunteer Army',
      blurb: 'Volunteer drives cost 30% less and give a bigger organisation boost.',
    },
  },
  {
    id: 'pdp',
    name: 'Punjab Development Party',
    short: 'PDP',
    colour: '#3f7bf0',
    ink: '#001c47',
    slogan: 'Build Punjab, Better Punjab',
    tagline: 'An urban, business-facing party promising roads, power and growth.',
    playable: true,
    stateBase: 22.5,
    credibility: {
      agriculture: 0.42,
      jobs: 0.68,
      economy: 0.9,
      infrastructure: 0.92,
      education: 0.6,
      healthcare: 0.5,
      lawOrder: 0.62,
    },
    regionLean: { Malwa: -2, Majha: -4, Doaba: 8 },
    settlementLean: { urban: 10, 'semi-urban': 0, rural: -7 },
    trait: {
      id: 'deepPockets',
      label: 'Deep Pockets',
      blurb: 'Starts the campaign with 15% more money and cheaper advertising.',
    },
  },
  {
    id: 'upa',
    name: 'United Punjab Alliance',
    short: 'UPA',
    colour: '#b45cf0',
    ink: '#2c0047',
    slogan: 'Sanjha Punjab, Surakhya Punjab',
    tagline: 'A broad coalition that trades on order, stability and local deals.',
    playable: true,
    stateBase: 22.1,
    credibility: {
      agriculture: 0.6,
      jobs: 0.55,
      economy: 0.6,
      infrastructure: 0.65,
      education: 0.55,
      healthcare: 0.58,
      lawOrder: 0.9,
    },
    regionLean: { Malwa: 2.5, Majha: -1, Doaba: -3 },
    settlementLean: { urban: 5, 'semi-urban': 2, rural: -8 },
    trait: {
      id: 'coalitionBuilders',
      label: 'Coalition Builders',
      blurb: 'Alliance outreach costs 30% less and can be used twice.',
    },
  },
  {
    id: 'ind',
    name: 'Independents & Others',
    short: 'IND',
    colour: '#8b93a7',
    ink: '#161a24',
    slogan: '',
    tagline: 'Local strongmen, small outfits and unaligned candidates.',
    playable: false,
    stateBase: 5.7,
    credibility: {
      agriculture: 0.5,
      jobs: 0.45,
      economy: 0.45,
      infrastructure: 0.45,
      education: 0.45,
      healthcare: 0.45,
      lawOrder: 0.5,
    },
    regionLean: { Malwa: 0, Majha: 0, Doaba: 0 },
    settlementLean: { urban: -1, 'semi-urban': 0.5, rural: 1.5 },
    trait: null,
  },
];

PG.PARTY_BY_ID = PG.PARTIES.reduce(function (m, p) {
  m[p.id] = p;
  return m;
}, {});

PG.PLAYABLE_PARTIES = PG.PARTIES.filter(function (p) {
  return p.playable;
});
