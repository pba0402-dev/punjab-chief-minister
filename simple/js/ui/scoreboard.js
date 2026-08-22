/**
 * The election scoreboard.
 * ------------------------------------------------------------------
 * What a round looks like when it finishes: four candidates ranked by
 * projected seats, the seats that changed hands, who is leading and by how
 * much, and how far the leader still has to go.
 *
 * Every figure on this screen is worked out on the server and shipped whole,
 * so four people watching the same round see the same numbers. Nothing here
 * counts anything; it only draws what it was given. That matters more than it
 * sounds — a scoreboard where two players disagree about the score is worse
 * than no scoreboard at all.
 *
 * The one rule about what to show: only the constituencies that changed hands.
 * Early rounds can settle forty seats at once, and a list of all 117 every
 * round is a wall nobody reads. Differences are the news.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.scoreboard = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var svg = CMP.ui.dom.svg;
  var mount = CMP.ui.dom.mount;

  function partyOf(id) {
    return CMP.getParty(id) || { id: id, short: String(id || '?').toUpperCase(), name: id, colour: '#8b93a7' };
  }

  function seatName(number) {
    for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
      if (CMP.CONSTITUENCIES[i].number === Number(number)) return CMP.CONSTITUENCIES[i].name;
    }
    return 'AC ' + number;
  }

  /* --------------------------------------------------------- leaderboard */

  /**
   * The ranked candidates. `you` is the party the viewer is playing, so their
   * own row is marked — with four faces on screen it should take no effort to
   * find your own.
   */
  function leaderboard(result, you, opts) {
    opts = opts || {};
    var majority = result.majority;
    var top = Math.max(1, result.standings[0] ? result.standings[0].seats : 1);

    return el('ol', { class: 'board' + (opts.compact ? ' is-compact' : '') },
      result.standings.map(function (row, i) {
        var party = partyOf(row.party);
        var isYou = row.party === you;
        var leading = i === 0 && row.seats > 0;

        return el('li', {
          class: 'board-row' +
            (isYou ? ' is-you' : '') +
            (leading ? ' is-leading' : '') +
            (row.disqualified ? ' is-out' : ''),
          style: { '--party': party.colour, '--party-ink': party.ink || '#fff' },
        }, [
          el('span', { class: 'board-rank', text: String(i + 1) }),

          el('span', { class: 'board-face' },
            row.avatar
              ? [CMP.ui.portrait.render(row.avatar, opts.compact ? 34 : 46, row.candidateName)]
              : [el('span', { class: 'board-face-blank', text: party.short })]),

          el('span', { class: 'board-who' }, [
            el('strong', { class: 'board-name', text: row.candidateName || party.name }),
            el('span', { class: 'board-party' }, [
              party.short,
              row.isAI ? el('span', { class: 'board-tag', text: 'AI' }) : null,
              isYou ? el('span', { class: 'board-tag is-you', text: 'you' }) : null,
              row.disqualified ? el('span', { class: 'board-tag is-out', text: 'out' }) : null,
            ]),
          ]),

          el('span', { class: 'board-bar' }, [
            el('span', {
              class: 'board-bar-fill',
              style: { width: (row.seats / top) * 100 + '%' },
            }),
            majority && top >= majority
              ? el('span', {
                  class: 'board-bar-majority',
                  style: { left: (majority / top) * 100 + '%' },
                  title: 'Majority: ' + majority,
                })
              : null,
          ]),

          el('span', { class: 'board-seats' }, [
            el('strong', { text: String(row.seats) }),
            el('span', { class: 'board-seats-label', text: 'seats' }),
          ]),

          el('span', {
            class: 'board-change' +
              (row.change > 0 ? ' is-up' : row.change < 0 ? ' is-down' : ''),
            text: row.change > 0 ? '+' + row.change : row.change < 0 ? String(row.change) : '—',
          }),

          leading ? el('span', { class: 'board-leading', text: 'Leading' }) : null,
        ]);
      })
    );
  }

  /* ------------------------------------------------------ seat changes */

  /**
   * The constituencies that changed hands, one line each: who held it, who
   * holds it now. Nothing else from the 117 — the rest did not move.
   */
  function seatChanges(result) {
    if (!result.changeCount) {
      return el('p', { class: 'changes-none', text: 'No seat leaders changed this round.' });
    }

    return el('div', { class: 'changes' }, [
      el(
        'ul',
        { class: 'changes-list' },
        result.changes.map(function (change, i) {
          var from = partyOf(change.from);
          var to = partyOf(change.to);
          return el('li', {
            class: 'change-row',
            style: {
              '--from': from.colour,
              '--to': to.colour,
              '--to-ink': to.ink || '#fff',
              // Staggered so the flips read one after another rather than
              // arriving as a block.
              animationDelay: i * 70 + 'ms',
            },
          }, [
            el('span', { class: 'change-ac', text: 'AC ' + change.seat }),
            el('span', { class: 'change-name', text: seatName(change.seat) }),
            el('span', { class: 'change-flip' }, [
              el('span', { class: 'change-from', text: from.short }),
              el('span', { class: 'change-arrow', text: '→' }),
              el('span', { class: 'change-to', text: to.short }),
            ]),
          ]);
        })
      ),
      result.changesHidden
        ? el('p', {
            class: 'changes-more',
            text: 'and ' + result.changesHidden + ' more seat' +
              (result.changesHidden === 1 ? '' : 's') + ' changed hands.',
          })
        : null,
    ]);
  }

  /* -------------------------------------------------------- movements */

  /** Who gained and who lost this round, at a glance. */
  function movements(result) {
    var moved = result.standings
      .slice()
      .filter(function (r) {
        return r.change !== 0;
      })
      .sort(function (a, b) {
        return b.change - a.change;
      });

    if (!moved.length) {
      return el('p', { class: 'moves-none', text: 'No party gained or lost ground this round.' });
    }

    return el('div', { class: 'moves' }, moved.map(function (row) {
      var party = partyOf(row.party);
      return el('span', {
        class: 'move' + (row.change > 0 ? ' is-up' : ' is-down'),
        style: { '--party': party.colour },
      }, [
        el('span', { class: 'move-party', text: party.short }),
        el('strong', {
          class: 'move-value',
          text: (row.change > 0 ? '+' : '') + row.change,
        }),
      ]);
    }));
  }

  /* ---------------------------------------------------------- position */

  /** Where the leader stands relative to a majority. */
  function position(result) {
    var leader = partyOf(result.leadParty);
    var needed = result.seatsNeeded;

    return el('div', { class: 'position', style: { '--party': leader.colour } }, [
      el('div', { class: 'position-head' }, [
        el('span', { class: 'stat-label', text: 'Current leader' }),
        el('span', { class: 'position-party', text: leader.name }),
      ]),
      el('div', { class: 'position-numbers' }, [
        el('span', { class: 'position-count' }, [
          el('strong', { text: String(result.leadSeats) }),
          ' / ' + result.majority,
        ]),
        el('span', {
          class: 'position-need' + (needed === 0 ? ' is-clear' : ''),
          text: needed === 0
            ? 'Majority reached'
            : needed + ' more seat' + (needed === 1 ? '' : 's') + ' needed',
        }),
      ]),
      result.leadOver
        ? el('p', {
            class: 'position-lead',
            text: leader.short + ' is ' + result.leadGap + ' seat' +
              (result.leadGap === 1 ? '' : 's') + ' ahead of ' + partyOf(result.leadOver).short + '.',
          })
        : null,
    ]);
  }

  /* ------------------------------------------------------------ banners */

  function banners(result) {
    var out = [];

    if (result.newLeader) {
      var leader = partyOf(result.leadParty);
      out.push(el('div', {
        class: 'banner banner-new-leader',
        style: { '--party': leader.colour, '--party-ink': leader.ink || '#fff' },
        role: 'status',
      }, [
        el('span', { class: 'banner-kicker', text: 'New leader' }),
        el('strong', { class: 'banner-headline', text: leader.name }),
        el('span', {
          class: 'banner-detail',
          text: 'takes the lead from ' + partyOf(result.previousLeader).short +
            ' with ' + result.leadSeats + ' seats.',
        }),
      ]));
    }

    if (result.closeRace && !result.newLeader) {
      var a = result.standings[0];
      var b = result.standings[1];
      out.push(el('div', { class: 'banner banner-close' }, [
        el('span', { class: 'banner-kicker', text: 'Close race' }),
        el('strong', {
          class: 'banner-headline',
          text: partyOf(a.party).short + ' ' + a.seats + ' · ' + partyOf(b.party).short + ' ' + b.seats,
        }),
        el('span', {
          class: 'banner-detail',
          text: 'Only ' + result.leadGap + ' seat' + (result.leadGap === 1 ? '' : 's') + ' apart.',
        }),
      ]));
    }

    return out;
  }

  /* ------------------------------------------------------------ history */

  /**
   * All four parties across every round played, as four lines.
   *
   * This does not go on the game screen. It is the shape of a whole campaign,
   * which is worth looking at between rounds and a distraction during one — so
   * it lives behind ELECTION HISTORY and nowhere else.
   */
  function historyChart(trend) {
    if (!trend || trend.length < 2) return null;

    var parties = CMP.PARTIES.filter(function (p) {
      return p.playable;
    });

    var W = 320;
    var H = 150;
    var PAD_L = 26;
    var PAD_R = 8;
    var PAD_T = 10;
    var PAD_B = 20;

    var total = CMP.CONSTITUENCIES.length;
    var majority = Math.floor(total / 2) + 1;
    var lastRound = trend[trend.length - 1].round;
    var firstRound = trend[0].round;
    var span = Math.max(1, lastRound - firstRound);

    // The vertical scale runs to a round number above the highest line, so a
    // close campaign is not drawn as four lines squashed along the bottom.
    var peak = 0;
    trend.forEach(function (row) {
      parties.forEach(function (p) {
        peak = Math.max(peak, row.seats[p.id] || 0);
      });
    });
    var top = Math.max(majority + 10, Math.ceil((peak + 8) / 10) * 10);

    function x(round) {
      return PAD_L + ((round - firstRound) / span) * (W - PAD_L - PAD_R);
    }
    function y(seats) {
      return H - PAD_B - (seats / top) * (H - PAD_T - PAD_B);
    }

    var majorityY = y(majority);

    var lines = parties.map(function (p) {
      var d = trend.map(function (row, i) {
        return (i ? 'L' : 'M') + x(row.round).toFixed(1) + ' ' + y(row.seats[p.id] || 0).toFixed(1);
      }).join(' ');
      return svg('path', {
        class: 'hc-line',
        d: d,
        fill: 'none',
        stroke: p.colour,
        'stroke-width': '2',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      });
    });

    // A dot on each party's last round, so the end of the story is readable
    // where four lines are close together.
    var last = trend[trend.length - 1];
    var dots = parties.map(function (p) {
      return svg('circle', {
        class: 'hc-dot',
        cx: x(last.round).toFixed(1),
        cy: y(last.seats[p.id] || 0).toFixed(1),
        r: '3',
        fill: p.colour,
      });
    });

    var chart = svg('svg', {
      class: 'history-chart',
      viewBox: '0 0 ' + W + ' ' + H,
      role: 'img',
      'aria-label': 'Seats held by each party from round ' + firstRound + ' to round ' + lastRound,
    }, [
      svg('line', {
        class: 'hc-axis',
        x1: String(PAD_L), y1: String(H - PAD_B), x2: String(W - PAD_R), y2: String(H - PAD_B),
      }),
      svg('line', {
        class: 'hc-majority',
        x1: String(PAD_L), y1: majorityY.toFixed(1), x2: String(W - PAD_R), y2: majorityY.toFixed(1),
      }),
      svg('text', {
        class: 'hc-tick', x: String(PAD_L - 4), y: (majorityY + 3).toFixed(1),
        'text-anchor': 'end', text: String(majority),
      }),
      svg('text', {
        class: 'hc-tick', x: String(PAD_L - 4), y: String(H - PAD_B + 3),
        'text-anchor': 'end', text: '0',
      }),
      svg('text', {
        class: 'hc-tick', x: String(PAD_L), y: String(H - 5), text: 'R' + firstRound,
      }),
      svg('text', {
        class: 'hc-tick', x: String(W - PAD_R), y: String(H - 5),
        'text-anchor': 'end', text: 'R' + lastRound,
      }),
    ].concat(lines).concat(dots));

    return el('div', { class: 'history-chart-block' }, [
      chart,
      el('ul', { class: 'hc-key' }, parties.map(function (p) {
        return el('li', { class: 'hc-key-row' }, [
          el('span', { class: 'hc-key-dot', style: { background: p.colour } }),
          el('span', { class: 'hc-key-label', text: p.short }),
          el('strong', { class: 'hc-key-value', text: String(last.seats[p.id] || 0) }),
        ]);
      })),
      el('p', { class: 'hc-note', text: String(majority) + ' seats is a majority.' }),
    ]);
  }

  /**
   * The whole campaign as a table, round by round. Offered rather than shown —
   * fifteen rows of five numbers is reference material, not headline news.
   */
  function historyTable(trend) {
    if (!trend || !trend.length) {
      return el('p', { class: 'muted', text: 'No rounds finished yet.' });
    }
    var parties = CMP.PARTIES.filter(function (p) {
      return p.playable;
    });

    return el('div', { class: 'history-table-wrap' }, [
      el('table', { class: 'history-table' }, [
        el('thead', {}, [
          el('tr', {}, [el('th', { text: 'Round' })].concat(
            parties.map(function (p) {
              return el('th', { class: 'is-num', text: p.short });
            })
          )),
        ]),
        el('tbody', {}, trend.map(function (row) {
          var best = parties.reduce(function (top, p) {
            return (row.seats[p.id] || 0) > (row.seats[top.id] || 0) ? p : top;
          }, parties[0]);
          return el('tr', {}, [el('td', { text: String(row.round) })].concat(
            parties.map(function (p) {
              return el('td', {
                class: 'is-num' + (p.id === best.id ? ' is-top' : ''),
                style: p.id === best.id ? { '--party': p.colour } : null,
                text: String(row.seats[p.id] || 0),
              });
            })
          ));
        })),
      ]),
    ]);
  }

  /* ------------------------------------------------- the results screen */

  /**
   * The whole round-results panel. `opts.secondsLeft` drives the countdown to
   * the next round; `opts.trend` is the per-round seat history behind the
   * "view election history" control.
   */
  function create(opts) {
    opts = opts || {};
    var result = null;

    /*
     * Two screens, in this order, every round.
     *
     * What changed comes first, because that is the news: which seats moved
     * and who took them from whom. Only then the standings. Showing the table
     * first buries the story under a scoreboard that has barely moved — four
     * numbers a round or two different is not what anybody is waiting to see.
     */
    var stage = 'changes';
    var showAllChanges = false;

    var root = el('section', { class: 'round-results' });

    function head(title, kicker, secondsLeft) {
      return el('div', { class: 'results-head' }, [
        el('div', {}, [
          el('span', { class: 'results-kicker', text: kicker }),
          el('h2', { class: 'results-heading', text: title }),
        ]),
        typeof secondsLeft === 'number'
          ? el('div', { class: 'results-next' }, [
              el('span', {
                class: 'stat-label',
                text: result.isFinalRound ? 'Counting in' : 'Next round in',
              }),
              el('strong', { class: 'results-next-value', text: Math.max(0, secondsLeft) + 's' }),
            ])
          : null,
      ]);
    }

    /* ------------------------------------------------ screen one */

    /**
     * What moved.
     *
     * A seat that had no leader and now has one is *won*, not changed —
     * round one settles all 117 that way, so it says so rather than listing
     * a hundred flips from nobody.
     */
    function changesScreen(secondsLeft) {
      /*
       * Your own seats first.
       *
       * Round one decides all 117 at once, so which five appear at the top
       * decides whether this screen is news or a list. The ones that matter
       * to the person reading are the ones they took and the ones they lost.
       */
      var mineNow = opts.you && opts.you();
      var changes = (result.changes || []).slice().sort(function (a, b) {
        var aMine = (a.to === mineNow ? 2 : 0) + (a.from === mineNow ? 1 : 0);
        var bMine = (b.to === mineNow ? 2 : 0) + (b.from === mineNow ? 1 : 0);
        return bMine - aMine || a.seat - b.seat;
      });
      var shown = showAllChanges ? changes : changes.slice(0, 5);
      var hidden = changes.length - shown.length;

      if (!changes.length) {
        return [
          head('Round ' + result.round + ' complete', 'Punjab Assembly', secondsLeft),
          el('div', { class: 'rr-quiet' }, [
            el('strong', { class: 'rr-quiet-title', text: 'No major seat changes' }),
            el('span', {
              class: 'rr-quiet-note',
              text: 'All current leaders held their positions.',
            }),
          ]),
          el('button', {
            class: 'btn btn-primary btn-wide',
            type: 'button',
            text: 'See who’s leading',
            onclick: function () {
              stage = 'leading';
              render();
            },
          }),
        ];
      }

      return [
        head('Round ' + result.round + ' complete', 'Punjab Assembly', secondsLeft),
        el('h3', { class: 'results-title', text: 'Seats changed' }),

        el('ul', { class: 'rr-changes' }, shown.map(function (change, i) {
          var from = change.from ? partyOf(change.from) : null;
          var to = partyOf(change.to);
          var mine = opts.you && opts.you();
          var won = mine && change.to === mine;
          var lost = mine && change.from === mine;

          return el('li', {
            class: 'rr-change' + (won ? ' is-won' : lost ? ' is-lost' : ''),
            style: {
              '--from': from ? from.colour : 'var(--line)',
              '--to': to.colour,
              animationDelay: i * 70 + 'ms',
            },
          }, [
            el('span', {
              class: 'rr-change-tag',
              text: won ? 'Seat won' : lost ? 'Seat lost' : from ? 'New leader' : 'Seat decided',
            }),
            el('strong', { class: 'rr-change-name', text: seatName(change.seat) }),
            el('span', { class: 'rr-change-flip' }, [
              from
                ? el('span', { class: 'rr-badge is-from', text: from.short })
                : el('span', { class: 'rr-badge is-none', text: '—' }),
              el('span', { class: 'rr-arrow', 'aria-hidden': 'true', text: '→' }),
              el('span', { class: 'rr-badge is-to', text: to.short }),
            ]),
            el('span', {
              class: 'rr-change-note',
              text: to.short + ' takes the lead.',
            }),
          ]);
        })),

        hidden > 0
          ? el('button', {
              class: 'btn btn-quiet btn-wide',
              type: 'button',
              text: '+ ' + hidden + ' more change' + (hidden === 1 ? '' : 's') + ' · view all',
              onclick: function () {
                showAllChanges = true;
                render();
              },
            })
          : null,

        el('button', {
          class: 'btn btn-primary btn-wide',
          type: 'button',
          text: 'Continue',
          onclick: function () {
            stage = 'leading';
            render();
          },
        }),
      ];
    }

    /* ------------------------------------------------ screen two */

    function leadingScreen(secondsLeft) {
      return [
        head('Who’s leading?', 'After round ' + result.round, secondsLeft),
        leaderboard(result, opts.you ? opts.you() : null, { compact: true }),
        el('div', { class: 'results-totals' }, [
          el('span', {}, ['Total ', el('strong', { text: String(result.totalSeats) })]),
          el('span', {}, ['Majority ', el('strong', { text: String(result.majority) })]),
        ]),
        position(result),

        milestoneKind()
          ? el('button', {
              class: 'btn btn-primary btn-wide',
              type: 'button',
              text: milestoneKind() === 'checkpoint'
                ? 'The round 15 review'
                : 'Halfway: where this stands',
              onclick: function () {
                stage = 'milestone';
                render();
              },
            })
          : null,

        el('button', {
          class: 'btn btn-quiet btn-wide',
          type: 'button',
          text: 'Back to what changed',
          onclick: function () {
            stage = 'changes';
            render();
          },
        }),
      ];
    }

    /* --------------------------------------- screen three, twice a game */

    /**
     * Two rounds are not like the others, and saying so is most of the point.
     *
     * Round ten is the last round in which an alliance can be agreed, and the
     * moment the campaign stops being open-ended. Round fifteen is the review.
     * Both deserve a screen that states what has just changed about the rules
     * rather than another seat count.
     */
    function milestoneKind() {
      if (!result) return null;
      var rounds = CMP.ROUNDS || {};
      if (result.round === (CMP.ELIMINATION || {}).round) return 'checkpoint';
      if (result.round === rounds.allianceDeadline) return 'halfway';
      return null;
    }

    function milestoneRow(row, you) {
      var party = partyOf(row.party);
      var short = Math.max(0, (result.majority || 59) - row.seats);
      return el('div', {
        class: 'ms-row' + (row.party === you ? ' is-you' : '') +
          (row.eliminated ? ' is-out' : ''),
        style: { '--party': party.colour },
      }, [
        el('span', { class: 'ms-row-party' }, [
          el('span', { class: 'race-dot', style: { background: party.colour } }),
          party.short,
        ]),
        el('span', { class: 'ms-row-name', text: row.candidateName || party.name }),
        el('strong', { class: 'ms-row-seats', text: String(row.seats) }),
        el('span', {
          class: 'ms-row-need',
          text: row.eliminated ? 'out' : short ? short + ' short' : 'majority',
        }),
      ]);
    }

    function halfwayScreen(secondsLeft) {
      var you = opts.you ? opts.you() : null;
      var total = (CMP.ROUNDS || {}).total || 20;
      var left = Math.max(0, total - result.round);

      return [
        head('Halfway', 'Round ' + result.round + ' of ' + total, secondsLeft),
        el('div', { class: 'ms-note' }, [
          el('strong', { class: 'ms-note-title', text: 'Alliances close now' }),
          el('span', {
            class: 'ms-note-line',
            text: 'No new alliance can be agreed after this round. Whatever ' +
              'is agreed now is what goes into the second half.',
          }),
        ]),
        el('h3', { class: 'results-title', text: 'Where the field stands' }),
        el('div', { class: 'ms-rows' }, result.standings.map(function (row) {
          return milestoneRow(row, you);
        })),
        el('p', {
          class: 'ms-foot',
          text: left + ' rounds left, and the review at round ' +
            ((CMP.ELIMINATION || {}).round || 15) + '.',
        }),
        el('button', {
          class: 'btn btn-quiet btn-wide',
          type: 'button',
          text: 'Back to the standings',
          onclick: function () {
            stage = 'leading';
            render();
          },
        }),
      ];
    }

    function checkpointScreen(secondsLeft) {
      var you = opts.you ? opts.you() : null;
      var review = result.review || {};
      var gone = review.eliminated || null;
      var goneParty = gone ? partyOf(gone.partyId || gone.party) : null;
      var rounds = CMP.ROUNDS || {};

      return [
        head('The review', 'Round ' + result.round + ' checkpoint', secondsLeft),

        gone
          ? el('div', { class: 'ms-note is-out' }, [
              el('strong', {
                class: 'ms-note-title',
                text: (gone.candidateName || (goneParty && goneParty.name) || 'A campaign') +
                  ' is out',
              }),
              el('span', { class: 'ms-note-line', text: review.reason || '' }),
              el('span', {
                class: 'ms-note-line',
                text: 'Their seats stay where they are. They are out of the ' +
                  'running, not off the board.',
              }),
            ])
          : el('div', { class: 'ms-note is-safe' }, [
              el('strong', { class: 'ms-note-title', text: 'Everybody survives' }),
              el('span', {
                class: 'ms-note-line',
                text: review.reason || 'The field is too close to put anybody out.',
              }),
            ]),

        el('h3', { class: 'results-title', text: 'The field at the review' }),
        el('div', { class: 'ms-rows' }, result.standings.map(function (row) {
          return milestoneRow(row, you);
        })),

        el('p', {
          class: 'ms-foot',
          text: 'The final phase begins: rounds ' + (rounds.finalPhaseFrom || 16) +
            ' to ' + (rounds.total || 20) + '.',
        }),
        el('button', {
          class: 'btn btn-quiet btn-wide',
          type: 'button',
          text: 'Back to the standings',
          onclick: function () {
            stage = 'leading';
            render();
          },
        }),
      ];
    }

    /* ---------------------------------------------------- render */

    function render(next, secondsLeft) {
      if (next) {
        // A new round's results start on the first screen again.
        if (!result || next.round !== result.round) {
          stage = 'changes';
          showAllChanges = false;
        }
        result = next;
      }
      if (!result) return;

      var kind = milestoneKind();
      if (stage === 'milestone' && !kind) stage = 'leading';

      mount(root, stage === 'changes'
        ? changesScreen(secondsLeft)
        : stage === 'milestone'
          ? (kind === 'checkpoint' ? checkpointScreen(secondsLeft) : halfwayScreen(secondsLeft))
          : leadingScreen(secondsLeft));
    }

    return { root: root, render: render };
  }

  return {
    create: create,
    leaderboard: leaderboard,
    seatChanges: seatChanges,
    movements: movements,
    position: position,
    historyChart: historyChart,
    historyTable: historyTable,
  };
})();
