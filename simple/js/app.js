/**
 * App shell.
 * ------------------------------------------------------------------
 * Owns which screen is showing and the current solo game. Solo state lives in
 * localStorage and never touches the network; multiplayer state lives on the
 * server and is polled while the lobby is open.
 *
 * Screens: home | setup | election | multiplayer | lobby
 */
window.CMP = window.CMP || {};

CMP.app = (function () {
  'use strict';

  var root = null;
  var game = null; // solo game only
  var screen = 'home';
  var lobbyView = null; // live CMP.ui.lobby instance while in the lobby

  function mount(node) {
    root = node;
    var saved = CMP.storage.load();
    if (saved) game = saved;
    paint();
  }

  /** The only writer of solo state, and the only place solo autosave runs. */
  function setGame(next, options) {
    game = next;
    if (game && (!options || options.save !== false)) CMP.storage.save(game);
    paint();
  }

  /* ------------------------------------------------------ lobby wiring */

  function enterLobby() {
    stopLobby();
    lobbyView = CMP.ui.lobby.create({
      onLeave: function () {
        stopLobby();
        goTo('home');
      },
    });

    CMP.net.startPolling(onLobbyUpdate);
    return lobbyView.root;
  }

  function onLobbyUpdate(res) {
    if (!lobbyView) return;

    if (!res.ok) {
      if (res.offline) {
        lobbyView.setNotice('Reconnecting to the game server…', 'info');
        return;
      }
      // The seat is genuinely gone — send the player home rather than
      // leaving them staring at a lobby that no longer exists.
      if (res.code === 'not_found' || res.code === 'not_a_player' || res.code === 'bad_token') {
        CMP.net.clearSession();
        stopLobby();
        goTo('home');
        return;
      }
      lobbyView.setNotice(res.error, 'bad');
      return;
    }

    lobbyView.setNotice(null);
    lobbyView.update(res.game);

    if (res.game.phase === 'election') {
      startMultiplayerElection(res.game);
    }
  }

  function stopLobby() {
    CMP.net.stopPolling(onLobbyUpdate);
    lobbyView = null;
  }

  /**
   * The host pressed start. Version 1 hands every player the same election
   * screen built from their own lobby entry; the shared campaign itself is
   * the next version's job.
   */
  function startMultiplayerElection(view) {
    var mine = null;
    for (var i = 0; i < view.players.length; i++) {
      if (!view.players[i].empty && view.players[i].isYou) mine = view.players[i];
    }
    if (!mine) return;

    stopLobby();
    var mp = CMP.state.startElection({
      partyId: mine.partyId,
      candidateName: mine.candidateName,
      slogan: mine.slogan,
      budget: mine.budget,
    });
    mp.mode = 'multiplayer';
    mp.gameCode = view.code;
    game = mp; // not saved locally: the server is the source of truth
    screen = 'election';
    paint();
  }

  /* ------------------------------------------------------ rendering */

  function paint() {
    if (!root) return;
    var view;

    if (screen === 'election' && game) {
      view = CMP.ui.election.render(game, {
        onMenu: function () {
          goTo('home');
        },
      });
    } else if (screen === 'setup') {
      view = CMP.ui.setup.render({
        onBack: function () {
          goTo('home');
        },
        onStart: function (started) {
          started.mode = 'solo';
          screen = 'election';
          setGame(started);
        },
      });
    } else if (screen === 'multiplayer') {
      view = CMP.ui.multiplayer.render({
        onBack: function () {
          goTo('home');
        },
        onJoined: function () {
          goTo('lobby');
        },
      });
    } else if (screen === 'lobby') {
      view = enterLobby();
    } else {
      screen = 'home';
      stopLobby();
      view = CMP.ui.home.render({
        onSolo: function () {
          game = null;
          goTo('setup');
        },
        onMultiplayer: function () {
          goTo('multiplayer');
        },
        onRejoin: function () {
          goTo('lobby');
        },
        onContinueSolo: function () {
          var saved = CMP.storage.load();
          if (!saved) {
            goTo('setup');
            return;
          }
          game = saved;
          screen = saved.screen === 'election' ? 'election' : 'setup';
          paint();
        },
      });
    }

    CMP.ui.dom.mount(root, [view]);
    document.body.dataset.screen = screen;
    window.scrollTo(0, 0);
  }

  function goTo(name) {
    if (name !== 'lobby') stopLobby();
    screen = name;
    paint();
  }

  return {
    mount: mount,
    setGame: setGame,
    goTo: goTo,
    getGame: function () {
      return game;
    },
    getScreen: function () {
      return screen;
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
