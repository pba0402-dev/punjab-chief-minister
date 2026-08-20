/**
 * Deterministic randomness.
 * ------------------------------------------------------------------
 * Everything random in the game runs through here so that a saved game
 * reloads identically and a seed reproduces a whole campaign. No engine
 * code is allowed to call Math.random directly.
 */
window.PG = window.PG || {};
PG.rng = (function () {
  'use strict';

  // 32-bit string hash, used to derive stable sub-seeds from labels.
  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  // mulberry32
  function create(seed) {
    var a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    var spare = null;

    var api = {
      next: function () {
        a = (a + 0x6d2b79f5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      /** Uniform float in [lo, hi). */
      range: function (lo, hi) {
        return lo + api.next() * (hi - lo);
      },
      /** Integer in [lo, hi]. */
      int: function (lo, hi) {
        return Math.floor(lo + api.next() * (hi - lo + 1));
      },
      /** Standard normal, Box-Muller with a cached spare. */
      normal: function () {
        if (spare !== null) {
          var s = spare;
          spare = null;
          return s;
        }
        var u = 0;
        var v = 0;
        while (u === 0) u = api.next();
        while (v === 0) v = api.next();
        var r = Math.sqrt(-2 * Math.log(u));
        var th = 2 * Math.PI * v;
        spare = r * Math.sin(th);
        return r * Math.cos(th);
      },
      /** Normal clamped to +/- 2.5 sigma, so nothing goes wild. */
      gauss: function (sigma) {
        var n = api.normal();
        if (n > 2.5) n = 2.5;
        if (n < -2.5) n = -2.5;
        return n * (sigma === undefined ? 1 : sigma);
      },
      pick: function (arr) {
        return arr[Math.floor(api.next() * arr.length)];
      },
      shuffle: function (arr) {
        var out = arr.slice();
        for (var i = out.length - 1; i > 0; i--) {
          var j = Math.floor(api.next() * (i + 1));
          var t = out[i];
          out[i] = out[j];
          out[j] = t;
        }
        return out;
      },
      chance: function (p) {
        return api.next() < p;
      },
    };
    return api;
  }

  /**
   * A stable pseudo-random value in [0,1) derived from a seed and any number
   * of labels. Used for things that must be identical every time they are
   * recomputed (polling fog, for example) without storing them.
   */
  function stable(seed) {
    var key = String(seed);
    for (var i = 1; i < arguments.length; i++) key += '|' + arguments[i];
    var h = hashString(key);
    h = Math.imul(h ^ (h >>> 15), h | 1) >>> 0;
    h ^= h + (Math.imul(h ^ (h >>> 7), h | 61) >>> 0);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  }

  /** Stable value shaped like a clamped normal, mean 0. */
  function stableGauss(sigma) {
    var args = Array.prototype.slice.call(arguments, 1);
    var a = stable.apply(null, args.concat(['a']));
    var b = stable.apply(null, args.concat(['b']));
    if (a === 0) a = 1e-9;
    var n = Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
    if (n > 2.5) n = 2.5;
    if (n < -2.5) n = -2.5;
    return n * sigma;
  }

  function randomSeed() {
    // The only entry point allowed to be non-deterministic: picking a new seed.
    return (Math.floor(Math.random() * 0xffffffff) >>> 0).toString(36);
  }

  return {
    create: create,
    hashString: hashString,
    stable: stable,
    stableGauss: stableGauss,
    randomSeed: randomSeed,
  };
})();
