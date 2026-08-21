/**
 * A player's profile, and the leaderboard.
 * ------------------------------------------------------------------
 * What somebody has done across every election they have played: games, wins,
 * seats, their best result, the party they keep coming back to, the
 * achievements they have picked up and the level those add to.
 *
 * Only public game statistics appear here. There is no email, no phone number
 * and no account detail to show, because none is collected — a profile is a
 * chosen name, a drawn portrait and a record of games.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.profile = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

  function achievementsList(earned) {
    var all = CMP.CAMPAIGN.profiles.achievements;
    var have = {};
    (earned || []).forEach(function (a) {
      have[a.id] = a;
    });

    return el('div', { class: 'pf-achievements' }, all.map(function (a) {
      var got = !!have[a.id];
      return el('div', { class: 'pf-achievement' + (got ? ' is-earned' : '') }, [
        el('span', { class: 'pf-achievement-icon', 'aria-hidden': 'true', text: a.icon }),
        el('div', { class: 'pf-achievement-body' }, [
          el('strong', { class: 'pf-achievement-name', text: a.label }),
          el('span', { class: 'pf-achievement-blurb', text: a.blurb }),
        ]),
        got ? el('span', { class: 'pf-achievement-tick', 'aria-label': 'Earned', text: '✓' }) : null,
      ]);
    }));
  }

  function figure(value, label) {
    return el('div', { class: 'pf-figure' }, [
      el('strong', { class: 'pf-figure-value', text: String(value) }),
      el('span', { class: 'pf-figure-label', text: label }),
    ]);
  }

  /*
   * Charts, one at a time.
   *
   * Five charts stacked down a phone is a report; one chart with a row of
   * tabs above it is something somebody actually looks at. The metric is
   * remembered while the screen is open and nothing else moves when it
   * changes.
   */
  var CHARTS = [
    { id: 'seats', label: 'Seats', of: function (r) { return r.seats; }, max: 117 },
    { id: 'result', label: 'Results', of: function (r) { return r.won ? 1 : 0; }, max: 1 },
  ];

  function chartBlock(profile) {
    var metric = CHARTS[0];
    var node = el('div', { class: 'ch' });

    // Oldest first: a chart of a career reads left to right.
    var history = (profile.history || []).slice().reverse();

    function paint() {
      var values = history.map(metric.of);
      var top = Math.max(metric.max === 1 ? 1 : Math.max.apply(null, values.concat([1])), 1);

      mount(node, [
        el('div', { class: 'ch-tabs' }, CHARTS.map(function (c) {
          return el('button', {
            class: 'ch-tab' + (c.id === metric.id ? ' is-on' : ''),
            type: 'button',
            text: c.label,
            onclick: function () {
              metric = c;
              paint();
            },
          });
        })),

        el('div', { class: 'ch-bars' }, history.map(function (row, i) {
          var v = values[i];
          var party = CMP.getParty(row.party);
          var height = Math.max(3, Math.round((v / top) * 100));
          return el('div', {
            class: 'ch-bar-wrap',
            title: 'Election ' + (i + 1) + ': ' + row.seats + ' seats, ' +
              (row.won ? 'won' : 'lost'),
          }, [
            el('span', {
              class: 'ch-bar' + (row.won ? ' is-win' : ''),
              style: {
                height: height + '%',
                background: metric.id === 'result'
                  ? (row.won ? 'var(--wheat)' : 'var(--line)')
                  : (party ? party.colour : 'var(--muted-2)'),
              },
            }),
          ]);
        })),

        el('p', {
          class: 'ch-note',
          text: metric.id === 'seats'
            ? history.length + ' elections · best ' + profile.bestResult + ' seats'
            : profile.won + ' won of ' + profile.played + ' · ' + profile.winRate + '%',
        }),
      ]);
    }

    paint();

    return el('section', { class: 'pf-section' }, [
      el('h2', { class: 'h-block-title', text: 'Record' }),
      node,
    ]);
  }

  /** The profile screen. */
  function render(opts) {
    var bodyNode = el('div', { class: 'pf-body' });

    var root = el('section', { class: 'screen screen-profile' }, [
      el('div', { class: 'pf-inner' }, [
        el('header', { class: 'pf-head' }, [
          el('button', {
            class: 'sd-back',
            type: 'button',
            'aria-label': 'Back',
            text: '‹',
            onclick: opts.onBack,
          }),
          el('h1', { class: 'pf-title', text: 'Profile' }),
        ]),
        bodyNode,
      ]),
    ]);

    function paint(profile) {
      var me = CMP.profile.get();

      if (!profile) {
        // The record lives on the server, but who you are lives here. With no
        // connection there is still a name and a face to show, and saying so
        // is better than an empty screen that reads like a lost account.
        mount(bodyNode, me
          ? [
              el('div', { class: 'pf-card' }, [
                CMP.ui.portrait.render(me.portraitSeed, 64, me.name),
                el('div', { class: 'pf-who' }, [
                  el('strong', { class: 'pf-name', text: me.name }),
                ]),
              ]),
              el('p', {
                class: 'pf-note',
                text: 'Your record is kept on the server and could not be reached. ' +
                  'Nothing has been lost — try again when you are back online.',
              }),
            ]
          : [
              el('p', {
                class: 'h-note',
                text: 'No profile yet. Play an election and one will start itself.',
              }),
            ]);
        return;
      }

      var parties = Object.keys(profile.byParty || {});

      mount(bodyNode, [
        /* ---- who ---- */
        el('div', { class: 'pf-card' }, [
          profile.portraitSeed
            ? CMP.ui.portrait.render(profile.portraitSeed, 64, profile.name)
            : null,
          el('div', { class: 'pf-who' }, [
            el('strong', { class: 'pf-name', text: profile.name }),
            el('span', { class: 'pf-level', text: 'Level ' + profile.level }),
            el('span', { class: 'pf-level-track' }, [
              el('span', {
                class: 'pf-level-fill',
                style: {
                  width: Math.min(100, (profile.levelInto / Math.max(1, profile.levelNeed)) * 100) + '%',
                },
              }),
            ]),
            el('span', {
              class: 'pf-level-note',
              text: profile.score.toLocaleString('en-IN') + ' points · ' +
                (profile.levelNeed - profile.levelInto).toLocaleString('en-IN') + ' to the next level',
            }),
          ]),
        ]),

        /* ---- the record ---- */
        el('div', { class: 'pf-figures' }, [
          figure(profile.played, 'played'),
          figure(profile.won, 'won'),
          figure(profile.winRate + '%', 'win rate'),
          figure(profile.bestResult, 'best result'),
          figure(profile.seatsTotal, 'seats won'),
          figure(profile.coalitionWins, 'coalitions'),
        ]),

        profile.played > profile.verifiedPlayed
          ? el('p', {
              class: 'pf-note',
              text: (profile.played - profile.verifiedPlayed) + ' of these were solo games. ' +
                'They count here, but not on the leaderboard — the server did not play them.',
            })
          : null,

        /* ---- by party ---- */
        parties.length
          ? el('section', { class: 'pf-section' }, [
              el('h2', { class: 'h-block-title', text: 'Party record' }),
              el('div', { class: 'pf-parties' }, parties.map(function (id) {
                var row = profile.byParty[id];
                var party = CMP.getParty(id);
                return el('div', { class: 'pf-party', style: { '--party': party.colour } }, [
                  el('span', { class: 'pf-party-name', text: party.short }),
                  el('span', { class: 'pf-party-record', text: row.won + ' of ' + row.played }),
                  el('span', { class: 'pf-party-seats', text: row.seats + ' seats' }),
                  id === profile.favouriteParty
                    ? el('span', { class: 'board-tag', text: 'favourite' })
                    : null,
                ]);
              })),
            ])
          : null,

        /* ---- achievements ---- */
        el('section', { class: 'pf-section' }, [
          el('h2', { class: 'h-block-title', text: 'Achievements' }),
          achievementsList(profile.achievements),
        ]),

        /* ---- charts ---- */
        (profile.history || []).length ? chartBlock(profile) : null,

        /* ---- history ---- */
        (profile.history || []).length
          ? el('section', { class: 'pf-section' }, [
              el('h2', { class: 'h-block-title', text: 'Election history' }),
              el('div', { class: 'pf-history' }, profile.history.map(function (row, i) {
                var party = CMP.getParty(row.party);
                return el('div', {
                  class: 'pf-history-row' + (row.won ? ' is-win' : ''),
                  style: { '--party': party.colour },
                }, [
                  el('span', { class: 'pf-history-n', text: '#' + (profile.history.length - i) }),
                  el('span', { class: 'pf-history-party', text: party.short }),
                  el('span', { class: 'pf-history-seats', text: row.seats + ' seats' }),
                  el('span', {
                    class: 'pf-history-result',
                    text: row.won ? 'Won' : row.outcome === 'hung' ? 'Hung' : 'Lost',
                  }),
                  !row.verified ? el('span', { class: 'pf-history-solo', text: 'solo' }) : null,
                ]);
              })),
            ])
          : null,
      ]);
    }

    paint(CMP.profile.stats());
    CMP.profile.refresh().then(paint);

    return root;
  }

  /** The leaderboard screen. */
  function leaderboard(opts) {
    var listNode = el('div', { class: 'lbd-list' });

    var root = el('section', { class: 'screen screen-profile' }, [
      el('div', { class: 'pf-inner' }, [
        el('header', { class: 'pf-head' }, [
          el('button', {
            class: 'sd-back',
            type: 'button',
            'aria-label': 'Back',
            text: '‹',
            onclick: opts.onBack,
          }),
          el('h1', { class: 'pf-title', text: 'Leaderboard' }),
        ]),
        el('p', {
          class: 'h-kicker',
          text: 'Ranked on wins, seats, coalitions and achievements — not on games played. ' +
            'Solo results are excluded, because the server did not play them.',
        }),
        listNode,
      ]),
    ]);

    mount(listNode, [el('p', { class: 'h-note', text: 'Counting…' })]);

    CMP.net.stats().then(function (res) {
      var rows = (res && res.ok && res.leaderboard) || [];
      if (!rows.length) {
        mount(listNode, [
          el('p', { class: 'h-note', text: 'Nobody has won an election here yet.' }),
        ]);
        return;
      }
      mount(listNode, rows.map(function (row, i) {
        return el('div', { class: 'lbd-row' + (i === 0 ? ' is-top' : '') }, [
          el('span', { class: 'lbd-rank', text: String(i + 1) }),
          row.portraitSeed
            ? CMP.ui.portrait.render(row.portraitSeed, 40, row.name)
            : el('span', { class: 'h-board-blank' }),
          el('div', { class: 'lbd-who' }, [
            el('strong', { class: 'lbd-name', text: row.name }),
            el('span', { class: 'lbd-sub', text: 'Level ' + row.level + ' · ' + row.won + ' of ' + row.played }),
          ]),
          el('strong', { class: 'lbd-score', text: row.score.toLocaleString('en-IN') }),
        ]);
      }));
    });

    return root;
  }

  return { render: render, leaderboard: leaderboard };
})();
