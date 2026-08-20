/**
 * Party data.
 * ------------------------------------------------------------------
 * The only place a party is defined. Add or remove entries here and the
 * setup screen, the election screen and the save format all follow — no
 * other file names a party.
 *
 * These are real Punjab parties used as playable sides in a fictional
 * strategy game. Nothing here is a claim about any real election.
 */
window.CMP = window.CMP || {};

CMP.PARTIES = [
  {
    id: 'aap',
    playable: true,
    short: 'AAP',
    name: 'Aam Aadmi Party',
    colour: '#1B62C4',
    ink: '#ffffff',
  },
  {
    id: 'inc',
    playable: true,
    short: 'INC',
    name: 'Indian National Congress',
    colour: '#4FB3E8',
    ink: '#08243a',
  },
  {
    id: 'bjp',
    playable: true,
    short: 'BJP',
    name: 'Bharatiya Janata Party',
    colour: '#F4761F',
    ink: '#331200',
  },
  {
    id: 'sad',
    playable: true,
    short: 'SAD',
    name: 'Shiromani Akali Dal',
    colour: '#E2B007',
    ink: '#2e2200',
  },
  {
    // Not playable. Holds the seats that belong to nobody in the game: real
    // incumbents from smaller parties and independents all sit here.
    id: 'oth',
    playable: false,
    short: 'OTH',
    name: 'Others & Independents',
    colour: '#8b93a7',
    ink: '#141821',
  },
];

/** The four a player can choose. Others is never selectable. */
CMP.PLAYABLE_PARTIES = CMP.PARTIES.filter(function (p) {
  return p.playable;
});

/** Look up a party by id. Returns null for an unknown id. */
CMP.getParty = function (id) {
  for (var i = 0; i < CMP.PARTIES.length; i++) {
    if (CMP.PARTIES[i].id === id) return CMP.PARTIES[i];
  }
  return null;
};
