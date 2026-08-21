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
    var session = CMP.net.getSession();
    var me = CMP.profile.get();

    var root = el('section', { class: 'screen screen-home' }, [
      el('div', { class: 'h-inner' }, [
        /* ---- the title ---- */
        el('header', { class: 'h-hero' }, [
          el('h1', { class: 'h-title' }, [
            el('span', { class: 'h-title-top', text: 'Chief Minister' }),
            el('span', { class: 'h-title-of', text: 'of' }),
            el('span', { class: 'h-title-bottom', text: 'Punjab' }),
          ]),
          el('p', { class: 'h-tagline', text: '117 Assembly Seats · 59 for a majority' }),
          me
            ? el('p', { class: 'h-welcome' }, [
                'Welcome back, ',
                el('strong', { text: me.name }),
              ])
            : el('p', { class: 'h-welcome', text: 'Can you win 59 seats and become Chief Minister?' }),
        ]),

        /* ---- the two things to do ---- */
        el('div', { class: 'h-play' }, [
          el('button', {
            class: 'h-play-btn is-solo',
            type: 'button',
            onclick: opts.onSolo,
          }, [
            el('span', { class: 'h-play-label', text: 'Play solo' }),
            el('span', { class: 'h-play-sub', text: 'Against three opponents' }),
          ]),
          el('button', {
            class: 'h-play-btn is-friends',
            type: 'button',
            onclick: opts.onMultiplayer,
          }, [
            el('span', { class: 'h-play-label', text: 'Play with friends' }),
            el('span', { class: 'h-play-sub', text: 'Up to four, one party each' }),
          ]),
        ]),

        /* ---- anything already in progress ---- */
        session || (saved && CMP.state.isValid(saved))
          ? el('div', { class: 'h-resume' }, [
              session
                ? el('button', {
                    class: 'resume-link',
                    type: 'button',
                    text: 'Rejoin game ' + session.code,
                    onclick: opts.onRejoin,
                  })
                : null,
              saved && CMP.state.isValid(saved)
                ? el('button', {
                    class: 'resume-link',
                    type: 'button',
                    text: 'Continue election · round ' + (saved.round || 1),
                    onclick: opts.onContinueSolo,
                  })
                : null,
            ])
          : null,

        statsNode,
        boardNode,
        profileNode,
        partiesNode,
        recentNode,
      ]),
    ]);

    /* ------------------------------------------------------- painting */

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
