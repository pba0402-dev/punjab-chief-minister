/**
 * Parties, which belong to a game rather than to the game.
 * ------------------------------------------------------------------
 * There is no fixed list of parties any more. A player invents theirs — a
 * name, an abbreviation, a symbol and a colour — and the opponents are given
 * invented ones when the game starts. So a party is state, not data, and this
 * file is the registry that whatever game is open writes itself into.
 *
 * Every screen still asks `CMP.getParty(id)` and gets back the same shape it
 * always did, so nothing downstream had to learn about any of this. What
 * changed is that the answer now depends on which game is loaded.
 *
 * Nothing real is seeded here. No party in this game is a real party unless a
 * player typed its name in themselves, and no result here is a claim about any
 * real election.
 */
window.CMP = window.CMP || {};

(function () {
  'use strict';

  /* --------------------------------------------------------- the palette */

  /**
   * Colours a party can be.
   *
   * Picked to be told apart at a glance on a dark board, at the size of a dot
   * on a map — which rules out several otherwise pleasant colours. None of
   * them is any real party's colour, and they are deliberately not arranged
   * to suggest one.
   */
  CMP.PARTY_COLOURS = [
    { id: 'saffron', name: 'Saffron', colour: '#E08A2E', ink: '#2a1600' },
    { id: 'indigo', name: 'Indigo', colour: '#5A6FD8', ink: '#ffffff' },
    { id: 'emerald', name: 'Emerald', colour: '#2FA46B', ink: '#04220f' },
    { id: 'crimson', name: 'Crimson', colour: '#D0455A', ink: '#ffffff' },
    { id: 'teal', name: 'Teal', colour: '#2C9EA8', ink: '#04211f' },
    { id: 'violet', name: 'Violet', colour: '#8B5FD0', ink: '#ffffff' },
    { id: 'gold', name: 'Gold', colour: '#D4A62A', ink: '#2a2000' },
    { id: 'rose', name: 'Rose', colour: '#D46A9B', ink: '#2a0c1a' },
    { id: 'sky', name: 'Sky', colour: '#4BA3DD', ink: '#04202f' },
    { id: 'clay', name: 'Clay', colour: '#B5714A', ink: '#ffffff' },
    { id: 'moss', name: 'Moss', colour: '#7A9E3F', ink: '#12210a' },
    { id: 'slate', name: 'Slate', colour: '#8892A8', ink: '#12161f' },
  ];

  CMP.getPartyColour = function (id) {
    for (var i = 0; i < CMP.PARTY_COLOURS.length; i++) {
      if (CMP.PARTY_COLOURS[i].id === id) return CMP.PARTY_COLOURS[i];
    }
    return CMP.PARTY_COLOURS[0];
  };

  /* --------------------------------------------------------- the symbols */

  /**
   * Symbols a party can run under.
   *
   * Ordinary things: a tree, a lamp, a river. Every one of them is drawn here
   * from scratch in `CMP.ui.symbol`, and none is any real party's symbol —
   * which is a deliberate constraint rather than an accident, and the reason
   * the obvious ones are missing.
   */
  CMP.PARTY_SYMBOLS = [
    { id: 'star', name: 'Star' },
    { id: 'tree', name: 'Tree' },
    { id: 'lion', name: 'Lion' },
    { id: 'sunrise', name: 'Rising Sun' },
    { id: 'mountain', name: 'Mountain' },
    { id: 'wheel', name: 'Wheel' },
  ];

  CMP.getPartySymbol = function (id) {
    for (var i = 0; i < CMP.PARTY_SYMBOLS.length; i++) {
      if (CMP.PARTY_SYMBOLS[i].id === id) return CMP.PARTY_SYMBOLS[i];
    }
    return CMP.PARTY_SYMBOLS[0];
  };

  /* -------------------------------------------------------- the registry */

  /**
   * The parties in the game currently open.
   *
   * Empty until one is loaded. A screen that asks about a party before there
   * is a game gets a placeholder rather than an exception, because several of
   * them are built once and painted later.
   */
  var active = [];

  var UNKNOWN = {
    id: '',
    slot: 0,
    short: '—',
    name: 'Unclaimed',
    colour: '#8892A8',
    ink: '#12161f',
    symbol: 'star',
    slogan: '',
  };

  /**
   * Point the registry at a game's parties.
   *
   * Called wherever a game is loaded or created, and nowhere else. The list is
   * copied rather than held by reference so that a screen painting from it
   * cannot be surprised half-way through by a poll rewriting the game object.
   */
  CMP.setParties = function (list) {
    active = (list || []).map(function (p) {
      return CMP.normalisePartyDef(p);
    });
    CMP.PARTIES = active;
    CMP.PLAYABLE_PARTIES = active;
    return active;
  };

  CMP.getParties = function () {
    return active.slice();
  };

  /** Look up a party by id. Never returns null: screens paint mid-load. */
  CMP.getParty = function (id) {
    for (var i = 0; i < active.length; i++) {
      if (active[i].id === id) return active[i];
    }
    return UNKNOWN;
  };

  CMP.hasParty = function (id) {
    for (var i = 0; i < active.length; i++) {
      if (active[i].id === id) return true;
    }
    return false;
  };

  /* ------------------------------------------------------ making one up */

  /**
   * An abbreviation, from a name nobody supplied one for.
   *
   * Initials of the words that carry meaning: "Punjab Development Party"
   * becomes PDP, "Unity Punjab" becomes UP. A name that yields nothing usable
   * falls back to its first letters, because a party with no badge at all is
   * worse than a clumsy badge.
   */
  CMP.suggestShort = function (name) {
    var clean = String(name || '').replace(/[^A-Za-z਀-੿ ]+/g, ' ').trim();
    if (!clean) return '';

    var skip = { of: 1, the: 1, and: 1, for: 1, a: 1, an: 1 };
    var words = clean.split(/\s+/).filter(function (w) {
      return !skip[w.toLowerCase()];
    });

    var letters = words.map(function (w) {
      return w.charAt(0).toUpperCase();
    }).join('');

    if (letters.length >= 2) return letters.slice(0, 4);
    return clean.replace(/\s+/g, '').slice(0, 3).toUpperCase();
  };

  /**
   * Fill in whatever a party definition is missing.
   *
   * A party arriving from an old save, from another player's client, or from
   * a half-finished form is still painted somewhere, so every field has an
   * answer even when nobody chose one.
   */
  CMP.normalisePartyDef = function (p) {
    p = p || {};
    var colour = p.colour;
    var ink = p.ink;
    if (!colour) {
      var swatch = CMP.getPartyColour(p.colourId);
      colour = swatch.colour;
      ink = swatch.ink;
    }
    var name = String(p.name || '').trim() || 'Unnamed Party';
    return {
      id: String(p.id || ''),
      slot: Number(p.slot || 0),
      name: name,
      short: (String(p.short || '').trim() || CMP.suggestShort(name) || 'PTY').slice(0, 4),
      slogan: String(p.slogan || '').trim(),
      symbol: p.symbol || 'star',
      colourId: p.colourId || '',
      colour: colour,
      ink: ink || '#ffffff',
    };
  };

  /** The id a party gets from the slot it plays in. Stable for the game. */
  CMP.partyIdForSlot = function (slot) {
    return 'p' + Number(slot);
  };

  // Nothing is loaded yet, but the two names have to exist: several screens
  // are constructed before any game is.
  CMP.PARTIES = active;
  CMP.PLAYABLE_PARTIES = active;
})();
