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
    short: 'AAP',
    name: 'Aam Aadmi Party',
    colour: '#1B62C4',
    ink: '#ffffff',
  },
  {
    id: 'inc',
    short: 'INC',
    name: 'Indian National Congress',
    colour: '#4FB3E8',
    ink: '#08243a',
  },
  {
    id: 'bjp',
    short: 'BJP',
    name: 'Bharatiya Janata Party',
    colour: '#F4761F',
    ink: '#331200',
  },
  {
    id: 'sad',
    short: 'SAD',
    name: 'Shiromani Akali Dal',
    colour: '#E2B007',
    ink: '#2e2200',
  },
];

/** Look up a party by id. Returns null for an unknown id. */
CMP.getParty = function (id) {
  for (var i = 0; i < CMP.PARTIES.length; i++) {
    if (CMP.PARTIES[i].id === id) return CMP.PARTIES[i];
  }
  return null;
};
