/**
 * The board data, fetched only when a game needs it.
 * ------------------------------------------------------------------
 * The 117 constituencies, the sitting MLAs and the map geometry are together
 * the largest thing this game downloads, and the opening screen uses none of
 * them: it shows a title, two buttons and some counters. So they are not in
 * the page — they are pulled in the moment somebody actually starts, resumes
 * or joins an election, and never before.
 *
 * Parties and campaign actions stay in the page, because the home screen shows
 * party performance and they are small.
 *
 * Loading is idempotent and remembered: the second game of the session waits
 * on nothing. If it fails — a flaky connection on the way to the lobby — the
 * promise rejects and the caller says so, rather than opening a board with no
 * seats on it.
 */
window.CMP = window.CMP || {};

CMP.data = (function () {
  'use strict';

  var FILES = [
    'js/data/constituencies.js',
    'js/data/incumbents.js',
    'js/data/regions.js',
    'js/data/geometry.js',
  ];

  var pending = null;

  /** Is the board already here? */
  function ready() {
    return !!(CMP.CONSTITUENCIES && CMP.CONSTITUENCIES.length
      && CMP.DISTRICTS && CMP.DISTRICTS.length);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var node = document.createElement('script');
      node.src = src;
      node.async = false;   // keep them in order; geometry reads nothing, but
      node.onload = function () {
        resolve();
      };
      node.onerror = function () {
        reject(new Error('Could not load ' + src));
      };
      document.head.appendChild(node);
    });
  }

  /**
   * Make sure the board is loaded. Resolves immediately once it is, so this is
   * safe to call on every navigation.
   */
  function ensure() {
    if (ready()) return Promise.resolve();
    if (pending) return pending;

    pending = Promise.all(FILES.map(loadScript)).then(
      function () {
        if (!ready()) throw new Error('The constituency data did not load.');
      },
      function (err) {
        // Let a later attempt try again rather than failing for the session.
        pending = null;
        throw err;
      }
    );
    return pending;
  }

  return { ensure: ensure, ready: ready };
})();
