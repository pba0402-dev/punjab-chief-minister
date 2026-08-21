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
  var resultView = null; // live CMP.ui.result instance once the polls close
  var serverView = null; // the latest lobby/game view from the server
  var paintedScreen = null; // the screen the page is currently showing
  var soloTimer = null;  // solo round clock; multiplayer takes the server's
  var shownRound = 0;    // the last round we showed a summary for

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

  /* ------------------------------------------------------ the round clock */

  /**
   * Seconds left in the round, as the server sees it. Multiplayer defers to
   * the server entirely; solo returns undefined so the panel uses its own
   * local deadline instead.
   */
  function secondsFromServer() {
    if (!game || game.mode !== 'multiplayer' || !serverView) return undefined;
    return typeof serverView.secondsLeft === 'number' ? serverView.secondsLeft : undefined;
  }

  /**
   * Solo has no server to end its rounds, so the shell watches the local
   * deadline and runs the same pipeline the server would.
   */
  function startSoloClock() {
    if (soloTimer !== null) return;
    soloTimer = window.setInterval(function () {
      if (!game || game.mode === 'multiplayer' || screen !== 'election') return;
      if (CMP.campaign.secondsLeft(game) > 0) return;

      var res = CMP.campaign.endRound(game);
      CMP.storage.save(game);

      if (res.finished) {
        finishSoloElection();
        return;
      }
      if (electionView) {
        electionView.render(game);
        showSummary(game.summary);
      }
    }, 500);
  }

  function stopSoloClock() {
    if (soloTimer !== null) {
      window.clearInterval(soloTimer);
      soloTimer = null;
    }
  }

  /** One summary per round, and never the same round twice. */
  function showSummary(summary) {
    if (!summary || summary.round === shownRound) return;
    shownRound = summary.round;
    if (electionView) electionView.showSummary(summary);
  }

  /**
   * Solo reached the end of round fifteen: count the seats.
   *
   * The result screen was built for multiplayer and reads a server view, so
   * solo hands it the same shape rather than growing a second renderer. There
   * is no coalition offer here — there is nobody to negotiate with.
   */
  function finishSoloElection() {
    game.result = CMP.campaign.runElection(game);
    game.screen = 'result';
    CMP.storage.save(game);
    stopSoloClock();

    serverView = {
      code: null,
      phase: game.result.outcome === 'majority' ? 'government' : 'hung',
      solo: true,
      round: game.round,
      roundsTotal: game.roundsTotal,
      result: game.result,
      coalition: null,
      possibleCoalitions: [],
      players: [
        {
          empty: false,
          id: 'solo',
          slot: 1,
          isYou: true,
          partyId: game.partyId,
          candidateName: game.candidateName,
          slogan: game.slogan,
          seatsLed: game.seatsWon,
          cash: game.cash,
          spent: game.spent,
          heat: game.heat,
        },
      ],
    };

    electionView = null;
    resultView = null;
    screen = 'result';
    paint();
  }

  /* ------------------------------------------------------ borrowing */

  /**
   * Take a loan. Solo settles it locally; multiplayer asks the server, which
   * re-checks the terms — a client cannot lend itself money.
   */
  function borrow(amount) {
    if (game && game.mode === 'multiplayer') {
      return CMP.net.takeLoan(amount).then(function (res) {
        if (!res.ok) return { ok: false, reason: res.error };
        var mine = mineFrom(res.game);
        if (mine) applyServerPlayer(mine);
        return { ok: true, game: game };
      });
    }

    var offer = CMP.campaign.takeLoan(game, amount);
    if (!offer.ok) return Promise.resolve({ ok: false, reason: offer.error });
    CMP.storage.save(game);
    return Promise.resolve({ ok: true, game: game });
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
    serverView = res.game;

    if (res.game.phase === 'election') {
      startMultiplayerElection(res.game);
      return;
    }

    // Someone rejoining after the polls closed must land on the result, not
    // sit in a lobby for a game that has already been decided.
    if (res.game.phase === 'hung' || res.game.phase === 'government') {
      resumeFinishedGame(res.game);
    }
  }

  /** Rebuild just enough local state to show the result of a finished game. */
  function resumeFinishedGame(view) {
    var mine = mineFrom(view);
    if (!mine) return;

    stopLobby();
    var mp = CMP.state.create();
    mp.mode = 'multiplayer';
    mp.gameCode = view.code;
    mp.partyId = mine.partyId;
    mp.candidateName = mine.candidateName;
    mp.slogan = mine.slogan;
    game = mp;
    if (view.incumbency) game.incumbency = view.incumbency;
    applyServerPlayer(mine);

    serverView = view;
    resultView = null;
    screen = 'result';
    paint();
    CMP.net.startPolling(onElectionUpdate);
  }

  function stopLobby() {
    CMP.net.stopPolling(onLobbyUpdate);
    lobbyView = null;
  }

  /**
   * While a multiplayer game is running, keep our own figures in step with the
   * server and follow it into the result screen when the polls close.
   */
  function onElectionUpdate(res) {
    if (!res.ok || !game || game.mode !== 'multiplayer') return;
    serverView = res.game;

    applyServerGame(res.game);

    var mine = mineFrom(res.game);
    if (mine) applyServerPlayer(mine);


    // The host closing the polls moves everyone to the result together.
    if (res.game.phase === 'hung' || res.game.phase === 'government') {
      if (screen !== 'result') {
        electionView = null;
        screen = 'result';
        paint();
        return;
      }
      if (resultView) resultView.update(res.game);
      return;
    }

    if (screen === 'election' && electionView) {
      electionView.render(game, secondsFromServer());

      // The server ends rounds, not us. When a round it finished shows up in
      // our own record, that is the cue to say what it did.
      if (mine && mine.summary) showSummary(mine.summary);
    }
  }

  /** Host only: close the polls. The poll then carries everyone to the result. */
  function declareResult() {
    CMP.net.declare().then(function (res) {
      if (!res.ok) {
        if (electionView) electionView.setReport(null);
        window.alert(res.error || 'The polls could not be closed.');
        return;
      }
      serverView = res.game;
      electionView = null;
      screen = 'result';
      paint();
      CMP.net.refresh();
    });
  }

  /**
   * The host pressed start. Everyone lands on the same board with the same
   * round clock; what differs per player is their party, their money and
   * what they choose to do with it.
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
    applyServerGame(view);
    applyServerPlayer(mine);
    serverView = view;
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
          borrow: borrow,
          getServerView: function () {
            return serverView;
          },
          onDeclare: declareResult,
        });
      }
      electionView.render(game, secondsFromServer());
      view = electionView.root;
      if (game.mode !== 'multiplayer') startSoloClock();
    } else if (screen === 'result') {
      if (!resultView) {
        resultView = CMP.ui.result.create({
          onMenu: function () {
            goTo('home');
          },
        });
      }
      if (serverView) resultView.update(serverView);
      view = resultView.root;
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

    // Only on a genuine change of screen. The result screen repaints as
    // coalition talks move, and jumping the page to the top each time would
    // throw the reader out of whatever they were reading.
    if (screen !== paintedScreen) {
      paintedScreen = screen;
      if (window.scrollTo) window.scrollTo(0, 0);
    }
  }

  function goTo(name) {
    if (name !== 'lobby') stopLobby();
    if (name !== 'election') {
      stopSoloClock();
      if (electionView) electionView.stop();
      electionView = null;
      shownRound = 0;
    }
    if (name !== 'result') resultView = null;
    if (name !== 'election' && name !== 'result') {
      CMP.net.stopPolling(onElectionUpdate);
      serverView = null;
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
    return Promise.resolve({ ok: true, report: res.report, game: game });
  }

  function mineFrom(view) {
    if (!view || !view.players) return null;
    for (var i = 0; i < view.players.length; i++) {
      if (!view.players[i].empty && view.players[i].isYou) return view.players[i];
    }
    return null;
  }

  /**
   * Copy the server's authoritative figures onto the local view object.
   * Money, heat and the loan book are the server's word — the client never
   * computes any of them for itself in multiplayer.
   */
  function applyServerPlayer(mine) {
    if (!game || !mine) return;
    game.budget = mine.budget;
    game.cash = mine.cash;
    game.spent = mine.spent;
    game.borrowed = mine.borrowed;
    game.repaid = mine.repaid;
    game.interestPaid = mine.interestPaid;
    game.granted = mine.granted;
    game.raised = mine.raised;
    game.finesPaid = mine.finesPaid;
    game.defaults = mine.defaults;
    game.borrowingBlocked = !!mine.borrowingBlocked;
    game.heat = mine.heat;
    game.seatsWon = mine.seatsLed;
    game.roundActions = mine.roundActions || 0;
    if (mine.loans) game.loans = mine.loans;
    if (mine.actions) game.actions = mine.actions;
  }

  /** The shared board and the round clock, straight from the server. */
  function applyServerGame(view) {
    if (!game || !view) return;
    if (view.board && typeof view.board === 'object') game.support = view.board;
    if (view.incumbency) game.incumbency = view.incumbency;
    game.round = view.round || 1;
    game.roundsTotal = view.roundsTotal || CMP.ROUNDS.total;
    game.roundSeconds = view.roundSeconds || CMP.ROUNDS.seconds;
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
