/**
 * The opening screen.
 * ------------------------------------------------------------------
 * The question this screen has to raise is "can I win Punjab?", not "here are
 * some election statistics". So the two ways to play are the loudest things on
 * it, and everything else — who is playing, who is winning, what you have
 * done before — sits underneath in a form you can take in at a glance.
 *
 * Every figure here comes from the server, counted from games that actually
 * finished. Nothing is seeded and nothing is estimated: a new installation
 * shows zero players and zero elections, and says so, until somebody plays.
 * That is worth more than an impressive-looking screen — a number nobody can
 * trust is worse than a small one.
 *
 * The statistics load after the buttons, and the 117 constituencies are not
 * touched until a game starts. Nobody should wait on a leaderboard to press
 * Play.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.home = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

  /** Cached between visits so returning to the menu is instant. */
  var cachedStats = null;

  function render(opts) {
    var statsNode = el('div', { class: 'h-stats' });
    var boardNode = el('div', { class: 'h-block' });
    var profileNode = el('div', { class: 'h-block' });
    var partiesNode = el('div', { class: 'h-block' });
    var recentNode = el('div', { class: 'h-block' });

    var saved = CMP.storage.load();
    var me = CMP.profile.get();
    var resumeNode = el('div', { class: 'h-resume' });

    var root = el('section', { class: 'screen screen-home' }, [
      el('div', { class: 'h-inner' }, [
        /* ---- the title ---- */
        el('header', { class: 'h-hero' }, [
          el('h1', { class: 'h-title', text: 'Election Time' }),
          el('p', { class: 'h-sub', text: 'Punjab Assembly' }),

          // The three facts that define the game, as figures rather than a
          // sentence. Somebody deciding whether to play needs the shape of it,
          // not a paragraph about it.
          el('div', { class: 'h-facts' }, [
            fact('117', 'Seats'),
            fact('59', 'Majority'),
            fact(String(CMP.ROUNDS.total), 'Rounds'),
          ]),

          me ? el('p', { class: 'h-welcome' }, ['Welcome back, ', el('strong', { text: me.name })]) : null,
        ]),

        /*
         * What there is to do.
         *
         * "Election Time" is the way in, whether the other three parties are
         * people or not — a player choosing a game should be choosing an
         * election, not a mode. The distinction lives in the setup that
         * follows, where it is a fact about who else is playing rather than a
         * label on a button.
         */
        el('div', { class: 'h-play' }, [
          el('button', {
            class: 'h-play-btn is-primary',
            type: 'button',
            onclick: opts.onSolo,
          }, [
            el('span', { class: 'h-play-label', text: 'Election Time' }),
            el('span', { class: 'h-play-sub', text: 'Choose a party and contest all 117' }),
          ]),
          el('button', {
            class: 'h-play-btn',
            type: 'button',
            onclick: opts.onMultiplayer,
          }, [
            el('span', { class: 'h-play-label', text: 'Play with friends' }),
            el('span', { class: 'h-play-sub', text: 'Create an election, share the code' }),
          ]),
          el('button', {
            class: 'h-play-btn is-quiet',
            type: 'button',
            onclick: opts.onJoin || opts.onMultiplayer,
          }, [
            el('span', { class: 'h-play-label', text: 'Join election' }),
            el('span', { class: 'h-play-sub', text: 'Enter a code from a friend' }),
          ]),
        ]),

        /* ---- anything already in progress ---- */
        resumeNode,

        statsNode,
        boardNode,
        profileNode,
        partiesNode,
        recentNode,
      ]),
    ]);

    /**
     * What is waiting to be picked up.
     *
     * Closing a tab is not quitting. A multiplayer game somebody stepped away
     * from is still theirs, so it is offered back by code — and asked of the
     * server rather than read out of this browser, because the whole point is
     * that it survives a browser that forgot.
     *
     * A game the player deliberately ended is never offered. That is what
     * ending means, and an "end game" that kept suggesting itself afterwards
     * would be no different from leaving.
     */
    function paintResume(openGames) {
      var rows = [];

      (openGames || []).forEach(function (entry) {
        var where = entry.round > 0
          ? 'Round ' + entry.round + ' of ' + (entry.roundsTotal || CMP.ROUNDS.total)
          : 'Waiting in the lobby';
        rows.push(el('button', {
          class: 'resume-link is-rejoin',
          type: 'button',
          onclick: function () {
            CMP.net.adopt(entry);
            if (opts.onRejoin) opts.onRejoin();
          },
        }, [
          el('span', { class: 'resume-title', text: 'Rejoin game ' + entry.code }),
          el('span', { class: 'resume-note', text: where }),
        ]));
      });

      if (saved && CMP.state.isValid(saved)) {
        rows.push(el('button', {
          class: 'resume-link',
          type: 'button',
          onclick: opts.onContinueSolo,
        }, [
          el('span', { class: 'resume-title', text: 'Continue solo election' }),
          el('span', {
            class: 'resume-note',
            text: 'Round ' + (saved.round || 1) + ' of ' + (saved.roundsTotal || CMP.ROUNDS.total),
          }),
        ]));
      }

      mount(resumeNode, rows);
    }

    /* ------------------------------------------------------- painting */

    /** One of the three facts under the title. */
    function fact(value, label) {
      return el('div', { class: 'h-fact' }, [
        el('strong', { class: 'h-fact-value', text: value }),
        el('span', { class: 'h-fact-label', text: label }),
      ]);
    }

    function figure(value, label) {
      return el('div', { class: 'h-figure' }, [
        el('strong', { class: 'h-figure-value', text: String(value) }),
        el('span', { class: 'h-figure-label', text: label }),
      ]);
    }

    function paintStats(summary) {
      mount(statsNode, [
        el('h2', { class: 'h-block-title', text: 'The Punjab election' }),
        el('div', { class: 'h-figures' }, [
          figure(summary.players, summary.players === 1 ? 'player' : 'players'),
          figure(summary.elections, summary.elections === 1 ? 'election' : 'elections'),
          figure(summary.governments, 'governments'),
        ]),
        summary.elections === 0
          ? el('p', { class: 'h-note', text: 'No elections have finished here yet. Yours would be the first.' })
          : null,
      ]);
    }

    function paintLeaderboard(rows) {
      if (!rows.length) {
        mount(boardNode, [
          el('h2', { class: 'h-block-title', text: 'Top players' }),
          el('p', { class: 'h-note', text: 'Nobody has won an election here yet.' }),
        ]);
        return;
      }

      mount(boardNode, [
        el('div', { class: 'h-block-head' }, [
          el('h2', { class: 'h-block-title', text: 'Top players' }),
          el('button', {
            class: 'h-more',
            type: 'button',
            text: 'Leaderboard →',
            onclick: function () {
              if (opts.onLeaderboard) opts.onLeaderboard();
            },
          }),
        ]),
        el('ol', { class: 'h-board' }, rows.slice(0, 5).map(function (row, i) {
          return el('li', { class: 'h-board-row' }, [
            el('span', { class: 'h-board-rank', text: String(i + 1) }),
            row.portraitSeed
              ? CMP.ui.portrait.render(row.portraitSeed, 28, row.name)
              : el('span', { class: 'h-board-blank' }),
            el('span', { class: 'h-board-name', text: row.name }),
            el('span', { class: 'h-board-score', text: row.score.toLocaleString('en-IN') }),
          ]);
        })),
      ]);
    }

    function paintProfile(profile) {
      if (!profile) {
        mount(profileNode, []);
        return;
      }
      mount(profileNode, [
        el('div', { class: 'h-block-head' }, [
          el('h2', { class: 'h-block-title', text: 'Your profile' }),
          el('button', {
            class: 'h-more',
            type: 'button',
            text: 'View profile →',
            onclick: function () {
              if (opts.onProfile) opts.onProfile();
            },
          }),
        ]),
        el('div', { class: 'h-profile' }, [
          profile.portraitSeed
            ? CMP.ui.portrait.render(profile.portraitSeed, 48, profile.name)
            : null,
          el('div', { class: 'h-profile-who' }, [
            el('strong', { class: 'h-profile-name', text: profile.name }),
            el('span', { class: 'h-profile-level', text: 'Level ' + profile.level }),
          ]),
          el('div', { class: 'h-profile-figures' }, [
            figure(profile.won, 'wins'),
            figure(profile.played, 'games'),
            figure(profile.winRate + '%', 'win rate'),
          ]),
        ]),
      ]);
    }

    function paintParties(summary) {
      if (!summary.byParty.length) {
        mount(partiesNode, []);
        return;
      }
      mount(partiesNode, [
        el('h2', { class: 'h-block-title', text: 'Party performance' }),
        el('p', { class: 'h-kicker', text: 'Game player statistics — not a real-world poll.' }),
        el('div', { class: 'h-parties' }, summary.byParty.map(function (row) {
          var party = CMP.getParty(row.party);
          return el('div', { class: 'h-party', style: { '--party': party.colour } }, [
            el('span', { class: 'h-party-name', text: party.short }),
            el('span', { class: 'h-party-track' }, [
              el('span', { class: 'h-party-fill', style: { width: row.share + '%' } }),
            ]),
            el('span', { class: 'h-party-share', text: row.share + '%' }),
          ]);
        })),
      ]);
    }

    function paintRecent(profile) {
      var history = (profile && profile.history) || [];
      if (!history.length) {
        mount(recentNode, []);
        return;
      }
      mount(recentNode, [
        el('div', { class: 'h-block-head' }, [
          el('h2', { class: 'h-block-title', text: 'Your recent elections' }),
          el('button', {
            class: 'h-more',
            type: 'button',
            text: 'All results →',
            onclick: function () {
              if (opts.onProfile) opts.onProfile();
            },
          }),
        ]),
        el('div', { class: 'h-recent' }, history.slice(0, 3).map(function (row) {
          var party = CMP.getParty(row.party);
          return el('div', {
            class: 'h-recent-row' + (row.won ? ' is-win' : ''),
            style: { '--party': party.colour },
          }, [
            el('span', { class: 'h-recent-party', text: party.short }),
            el('span', { class: 'h-recent-seats', text: row.seats + ' seats' }),
            el('span', {
              class: 'h-recent-result',
              text: row.won ? 'Won' : row.outcome === 'hung' ? 'Hung' : 'Lost',
            }),
          ]);
        })),
      ]);
    }

    /* --------------------------------------------------------- loading */

    function apply(data) {
      cachedStats = data;
      paintStats(data.summary);
      paintLeaderboard(data.leaderboard || []);
      paintParties(data.summary);
    }

    // Show whatever is already known immediately, then refresh. The buttons
    // never wait on the network.
    if (cachedStats) apply(cachedStats);
    else {
      mount(statsNode, [
        el('h2', { class: 'h-block-title', text: 'The Punjab election' }),
        el('p', { class: 'h-note', text: 'Counting…' }),
      ]);
    }
    if (CMP.profile.stats()) {
      paintProfile(CMP.profile.stats());
      paintRecent(CMP.profile.stats());
    }

    // Show whatever this browser already knows about immediately, then ask
    // the server for anything it has forgotten.
    var session = CMP.net.getSession();
    paintResume(session ? [{ code: session.code, round: 0, roundsTotal: 0,
      playerId: session.playerId, token: session.token }] : []);

    if (me) {
      CMP.net.resumable(me.id).then(function (res) {
        if (res && res.ok) paintResume(res.games);
      });
    }

    CMP.net
      .stats()
      .then(function (res) {
        if (res && res.ok) apply(res);
        else {
          mount(statsNode, [
            el('h2', { class: 'h-block-title', text: 'The Punjab election' }),
            el('p', { class: 'h-note', text: 'Statistics are not available offline.' }),
          ]);
        }
      })
      .catch(function () {
        mount(statsNode, []);
      });

    if (CMP.profile.has()) {
      CMP.profile.refresh().then(function (profile) {
        paintProfile(profile);
        paintRecent(profile);
      });
    }

    return root;
  }

  return { render: render };
})();
