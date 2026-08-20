/**
 * Save / load.
 * ------------------------------------------------------------------
 * One localStorage slot, written automatically whenever the game changes.
 * Falls back to in-memory storage if the browser blocks localStorage
 * (private mode, or an iframe with storage disabled) so the game still runs
 * for the session instead of crashing.
 */
window.CMP = window.CMP || {};

CMP.storage = (function () {
  'use strict';

  var KEY = 'cmp.punjab.save.v1';

  var backend = (function () {
    try {
      var probe = KEY + '.probe';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return {
        name: 'localStorage',
        get: function (k) {
          return window.localStorage.getItem(k);
        },
        set: function (k, v) {
          window.localStorage.setItem(k, v);
        },
        remove: function (k) {
          window.localStorage.removeItem(k);
        },
      };
    } catch (e) {
      var mem = {};
      return {
        name: 'memory',
        get: function (k) {
          return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
        },
        set: function (k, v) {
          mem[k] = v;
        },
        remove: function (k) {
          delete mem[k];
        },
      };
    }
  })();

  /** Write the game. Returns true on success. */
  function save(game) {
    if (!game) return false;
    game.updatedAt = Date.now();
    try {
      backend.set(KEY, JSON.stringify(game));
      return true;
    } catch (e) {
      return false; // quota exceeded
    }
  }

  /** Read the saved game, or null if there is none or it is unreadable. */
  function load() {
    var raw = backend.get(KEY);
    if (!raw) return null;
    try {
      var game = JSON.parse(raw);
      if (!CMP.state.isValid(game)) return null;
      return game;
    } catch (e) {
      return null;
    }
  }

  function hasSave() {
    return load() !== null;
  }

  function clear() {
    backend.remove(KEY);
  }

  return {
    KEY: KEY,
    save: save,
    load: load,
    hasSave: hasSave,
    clear: clear,
    backendName: function () {
      return backend.name;
    },
  };
})();
