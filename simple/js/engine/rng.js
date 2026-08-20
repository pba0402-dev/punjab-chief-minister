/**
 * Randomness.
 * ------------------------------------------------------------------
 * Solo games roll their dice here. A seeded generator means a saved game
 * resumes on the same sequence it would have had, and tests can pin an
 * outcome by supplying the rolls directly.
 */
window.CMP = window.CMP || {};

CMP.rng = (function () {
  'use strict';

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /** mulberry32 — small, fast, good enough for a game. */
  function create(seed) {
    var a = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A fresh seed for a new game. The one place non-determinism is allowed. */
  function newSeed() {
    return (
      Date.now().toString(36) + Math.floor(Math.random() * 0xffffffff).toString(36)
    );
  }

  /**
   * The three rolls one action needs. Advancing `game.rollCount` keeps the
   * stream moving across saves without storing generator internals.
   */
  function rollsFor(game) {
    var next = create(game.seed + ':' + game.rollCount);
    game.rollCount += 1;
    return {
      outcome: next(),
      consequence: next(),
      consequencePick: next(),
      spare: next(),
    };
  }

  return { create: create, hashString: hashString, newSeed: newSeed, rollsFor: rollsFor };
})();
