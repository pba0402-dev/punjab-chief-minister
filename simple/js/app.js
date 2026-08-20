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
  var electionView = null; // live CMP.ui.election instance while campaigning

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

  /** While campaigning in multiplayer, refresh our own figures from the server. */
  function onElectionUpdate(res) {
    if (!res.ok || screen !== 'election' || !game || game.mode !== 'multiplayer') return;
    var mine = mineFrom(res.game);
    if (!mine) return;
    applyServerPlayer(mine);
    if (electionView) electionView.render(game);
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
    var mp = CMP.state.create();
    mp.mode = 'multiplayer';
    mp.gameCode = view.code;
    mp.partyId = mine.partyId;
    mp.candidateName = mine.candidateName;
    mp.slogan = mine.slogan;
    mp.screen = 'election';
    game = mp; // the server is the source of truth; nothing is saved locally
    applyServerPlayer(mine);
    electionView = null;
    screen = 'election';
    paint();

    // Keep our own figures in step with the server while the election runs.
    CMP.net.startPolling(onElectionUpdate);
  }

  /* ------------------------------------------------------ rendering */

  function paint() {
    if (!root) return;
    var view;

    if (screen === 'election' && game) {
      if (!electionView) {
        electionView = CMP.ui.election.create({
          onMenu: function () {
            goTo('home');
          },
          play: playAction,
        });
      }
      electionView.render(game);
      view = electionView.root;
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
    if (name !== 'election') {
      electionView = null;
      CMP.net.stopPolling(onElectionUpdate);
    }
    screen = name;
    paint();
  }

  /**
   * One entry point for spending money, whichever mode is running.
   * Solo rolls locally; multiplayer asks the server, because a client must
   * not be able to choose its own outcome or set its own budget.
   */
  function playAction(actionId, constituency) {
    if (game && game.mode === 'multiplayer') {
      return CMP.net.playAction(actionId, constituency).then(function (res) {
        if (!res.ok) return { ok: false, reason: res.error };
        var mine = mineFrom(res.game);
        if (mine) applyServerPlayer(mine);
        return { ok: true, report: lastServerReport(mine), game: game };
      });
    }

    var rolls = CMP.rng.rollsFor(game);
    var res = CMP.campaign.play(game, actionId, constituency, rolls);
    if (!res.ok) return { ok: false, reason: res.reason };
    game.seatsWon = CMP.campaign.seatsLed(game);
    CMP.storage.save(game);
    return { ok: true, report: res.report, game: game };
  }

  function mineFrom(view) {
    if (!view || !view.players) return null;
    for (var i = 0; i < view.players.length; i++) {
      if (!view.players[i].empty && view.players[i].isYou) return view.players[i];
    }
    return null;
  }

  /** Copy the server's authoritative figures onto the local view object. */
  function applyServerPlayer(mine) {
    if (!game || !mine) return;
    game.budget = mine.budget;
    game.spent = mine.spent;
    game.heat = mine.heat;
    game.seatsWon = mine.seatsLed;
    if (mine.support) game.support = mine.support;
    if (mine.actions) game.actions = mine.actions;
  }

  function lastServerReport(mine) {
    if (!mine || !mine.actions || !mine.actions.length) return null;
    return mine.actions[mine.actions.length - 1];
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
