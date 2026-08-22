/**
 * What the player has asked for, kept between games.
 * ------------------------------------------------------------------
 * Two preferences so far — background music and sound effects — stored in the
 * same localStorage this game already uses for saves and profiles, so there is
 * one place a browser remembers things about a player rather than two.
 *
 * There is no audio in the game yet, and this is deliberately honest about
 * that: the settings screen says so rather than offering a switch that does
 * nothing and looks broken. What this gives is somewhere for the answer to
 * live, so whatever plays sound later reads `CMP.settings.get('music')` and
 * finds a preference the player set before it existed.
 *
 * Anything that starts playing should also listen: `CMP.settings.onChange`
 * fires when a preference moves, so a running track can stop the moment
 * somebody turns it off rather than at the next screen.
 */
window.CMP = window.CMP || {};

CMP.settings = (function () {
  'use strict';

  var KEY = 'cmp.punjab.settings.v1';

  /*
   * On by default, because a game with music should play it the first time
   * and a player who does not want it says so once.
   */
  var DEFAULTS = { music: true, sound: true };

  var cache = null;
  var listeners = [];

  function store() {
    try {
      return window.localStorage;
    } catch (e) {
      // A browser with storage disabled still gets working settings; they
      // just do not outlive the tab.
      return null;
    }
  }

  function all() {
    if (cache) return cache;
    cache = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      cache[k] = DEFAULTS[k];
    });

    var box = store();
    if (box) {
      try {
        var raw = box.getItem(KEY);
        var saved = raw ? JSON.parse(raw) : null;
        if (saved && typeof saved === 'object') {
          Object.keys(DEFAULTS).forEach(function (k) {
            if (typeof saved[k] === 'boolean') cache[k] = saved[k];
          });
        }
      } catch (e) {
        /* unreadable settings are no settings, not a broken game */
      }
    }
    return cache;
  }

  function get(key) {
    var value = all()[key];
    return value === undefined ? DEFAULTS[key] : value;
  }

  function set(key, value) {
    if (!(key in DEFAULTS)) return get(key);
    var next = !!value;
    if (all()[key] === next) return next;

    cache[key] = next;
    var box = store();
    if (box) {
      try {
        box.setItem(KEY, JSON.stringify(cache));
      } catch (e) {
        /* full or private: the setting still holds for this session */
      }
    }
    listeners.forEach(function (fn) {
      try {
        fn(key, next);
      } catch (e) {
        /* one bad listener does not stop the others */
      }
    });
    return next;
  }

  function toggle(key) {
    return set(key, !get(key));
  }

  /** Called with (key, value) whenever a preference moves. */
  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  return { get: get, set: set, toggle: toggle, onChange: onChange, keys: Object.keys(DEFAULTS) };
})();
