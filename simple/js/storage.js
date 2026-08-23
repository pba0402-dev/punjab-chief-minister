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

  /* ------------------------------------------------------------------
     Where you were, as opposed to what you were playing.

     Which tab is open is not part of the game — reloading the page must not
     be able to change the state of an election — so it lives in a key of its
     own. It is also why a failure here is silent: losing the fact that you
     were on the Grant tab is not worth an error, and the game reads it back
     defensively anyway.
     ------------------------------------------------------------------ */

  var UI_KEY = 'cmp.punjab.ui.v1';

  function readUi() {
    try {
      var raw = backend.get(UI_KEY);
      var got = raw ? JSON.parse(raw) : null;
      return got && typeof got === 'object' ? got : {};
    } catch (e) {
      return {};
    }
  }

  /** Remember one piece of interface state across a reload. */
  function remember(key, value) {
    try {
      var ui = readUi();
      ui[key] = value;
      backend.set(UI_KEY, JSON.stringify(ui));
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Read it back, or null if it was never written or cannot be read. */
  function recall(key) {
    var ui = readUi();
    return Object.prototype.hasOwnProperty.call(ui, key) ? ui[key] : null;
  }

  function forgetUi() {
    backend.remove(UI_KEY);
  }

  return {
    KEY: KEY,
    UI_KEY: UI_KEY,
    save: save,
    load: load,
    hasSave: hasSave,
    clear: clear,
    remember: remember,
    recall: recall,
    forgetUi: forgetUi,
    backendName: function () {
      return backend.name;
    },
  };
})();
