/**
 * App shell.
 * ------------------------------------------------------------------
 * Decides which screen to show and owns the current game object. Every
 * change to the game goes through setGame(), which is also the single place
 * the autosave happens — so no screen can forget to save.
 */
window.CMP = window.CMP || {};

CMP.app = (function () {
  'use strict';

  var root = null;
  var game = null;
  var screen = 'home'; // home | setup | election

  function mount(node) {
    root = node;
    var saved = CMP.storage.load();
    if (saved) {
      game = saved;
      screen = 'home'; // always land on the menu so CONTINUE / NEW is a choice
    }
    paint();
  }

  /** The only writer of game state, and the only place autosave runs. */
  function setGame(next, options) {
    game = next;
    if (game && (!options || options.save !== false)) CMP.storage.save(game);
    paint();
  }

  function paint() {
    if (!root) return;

    var view;
    if (screen === 'election' && game) {
      view = CMP.ui.election.render(game, {
        onMenu: function () {
          screen = 'home';
          paint();
        },
      });
    } else if (screen === 'setup') {
      view = CMP.ui.setup.render({
        onBack: function () {
          screen = 'home';
          paint();
        },
        onStart: function (started) {
          screen = 'election';
          setGame(started);
        },
      });
    } else {
      view = CMP.ui.home.render({
        onContinue: function () {
          var saved = CMP.storage.load();
          if (!saved) {
            screen = 'setup';
            paint();
            return;
          }
          game = saved;
          screen = saved.screen === 'election' ? 'election' : 'setup';
          paint();
        },
        onNew: function (o) {
          if (o && o.clear) CMP.storage.clear();
          game = null;
          screen = 'setup';
          paint();
        },
      });
    }

    CMP.ui.dom.mount(root, [view]);
    document.body.dataset.screen = screen;
    window.scrollTo(0, 0);
  }

  return {
    mount: mount,
    setGame: setGame,
    getGame: function () {
      return game;
    },
    getScreen: function () {
      return screen;
    },
    goTo: function (name) {
      screen = name;
      paint();
    },
  };
})();

(function boot() {
  'use strict';

  function start() {
    var node = document.getElementById('app');
    if (!node) return;
    try {
      CMP.app.mount(node);
    } catch (err) {
      node.innerHTML =
        '<div class="boot-error"><h1>The game could not start</h1><p>Reload the page. ' +
        'If it keeps happening, clear this site’s stored data.</p></div>';
      if (window.console) window.console.error(err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
