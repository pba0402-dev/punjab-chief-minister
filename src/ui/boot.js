/**
 * Boot.
 * Starts the app and puts a readable message on screen if anything throws
 * during start-up, rather than leaving a blank page.
 */
(function () {
  'use strict';

  function fail(err) {
    var host = document.getElementById('app');
    if (!host) return;
    host.innerHTML =
      '<div class="boot-error">' +
      '<h1>The game could not start</h1>' +
      '<p>' +
      PG.ui.fmt.escapeHtml(err && err.message ? err.message : String(err)) +
      '</p>' +
      '<p class="boot-hint">Reload the page. If it keeps happening, clear this site’s stored data to drop a corrupt save.</p>' +
      '</div>';
    if (window.console) window.console.error(err);
  }

  function boot() {
    try {
      // Kept on the namespace so the headless test harness can drive the game.
      PG.__app = PG.ui.app.start(document.getElementById('app'));
    } catch (err) {
      fail(err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
