/**
 * Persistence.
 * ------------------------------------------------------------------
 * Save/load sits behind a small adapter interface, so swapping localStorage
 * for a server or IndexedDB later means writing one new adapter and changing
 * PG.storage.use(...). Nothing else in the game knows where saves live.
 *
 * Adapter contract:
 *   read(key) -> string|null   write(key, value)   remove(key)   keys() -> [string]
 */
window.PG = window.PG || {};
PG.storage = (function () {
  'use strict';

  var PREFIX = 'pg.punjab.';
  var INDEX_KEY = PREFIX + 'index';
  var AUTOSAVE = 'autosave';

  /* ------------------------------------------------------------ adapters */

  function localStorageAdapter() {
    var ok = (function () {
      try {
        var t = PREFIX + 'test';
        window.localStorage.setItem(t, '1');
        window.localStorage.removeItem(t);
        return true;
      } catch (e) {
        return false;
      }
    })();
    if (!ok) return null;
    return {
      id: 'localStorage',
      read: function (k) {
        return window.localStorage.getItem(k);
      },
      write: function (k, v) {
        window.localStorage.setItem(k, v);
      },
      remove: function (k) {
        window.localStorage.removeItem(k);
      },
    };
  }

  /** Used when the browser blocks storage (private mode, file:// quirks). */
  function memoryAdapter() {
    var mem = {};
    return {
      id: 'memory',
      read: function (k) {
        return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      },
      write: function (k, v) {
        mem[k] = v;
      },
      remove: function (k) {
        delete mem[k];
      },
    };
  }

  var adapter = localStorageAdapter() || memoryAdapter();

  /* ------------------------------------------------------------ index */

  function readIndex() {
    try {
      return JSON.parse(adapter.read(INDEX_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function writeIndex(list) {
    try {
      adapter.write(INDEX_KEY, JSON.stringify(list));
    } catch (e) {
      /* quota - the save itself already failed loudly */
    }
  }

  function describe(game) {
    var party = PG.PARTY_BY_ID[game.player.partyId];
    var st = PG.getState(game.stateId);
    return {
      slot: null,
      stateId: game.stateId,
      stateName: st.name,
      candidate: game.player.name,
      party: party.short,
      partyName: party.name,
      colour: party.colour,
      turn: game.turn,
      turns: st.campaign.turns,
      status: game.status,
      difficulty: game.difficulty,
      seats: game.history.length
        ? game.history[game.history.length - 1].playerSeats
        : null,
      savedAt: Date.now(),
    };
  }

  /* ------------------------------------------------------------ api */

  function save(game, slot) {
    var key = slot || AUTOSAVE;
    var meta = describe(game);
    meta.slot = key;
    try {
      adapter.write(PREFIX + 'save.' + key, JSON.stringify(game));
    } catch (e) {
      return { ok: false, reason: 'Storage is full or unavailable.' };
    }
    var list = readIndex().filter(function (m) {
      return m.slot !== key;
    });
    list.unshift(meta);
    writeIndex(list.slice(0, 12));
    return { ok: true, meta: meta };
  }

  function load(slot) {
    var raw = adapter.read(PREFIX + 'save.' + (slot || AUTOSAVE));
    if (!raw) return null;
    try {
      var game = JSON.parse(raw);
      if (!game || game.version !== PG.engine.SAVE_VERSION) return null;
      if (!PG.STATES[game.stateId]) return null;
      return game;
    } catch (e) {
      return null;
    }
  }

  function remove(slot) {
    adapter.remove(PREFIX + 'save.' + slot);
    writeIndex(
      readIndex().filter(function (m) {
        return m.slot !== slot;
      })
    );
  }

  function list() {
    return readIndex().filter(function (m) {
      return adapter.read(PREFIX + 'save.' + m.slot) !== null;
    });
  }

  function hasAutosave() {
    return load(AUTOSAVE) !== null;
  }

  function clearAll() {
    readIndex().forEach(function (m) {
      adapter.remove(PREFIX + 'save.' + m.slot);
    });
    adapter.remove(INDEX_KEY);
  }

  return {
    AUTOSAVE: AUTOSAVE,
    save: save,
    load: load,
    remove: remove,
    list: list,
    hasAutosave: hasAutosave,
    clearAll: clearAll,
    use: function (a) {
      adapter = a;
    },
    adapterId: function () {
      return adapter.id;
    },
  };
})();
