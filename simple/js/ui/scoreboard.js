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
  var money = CMP.ui.money;

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

          /*
           * Won and leading, apart.
           *
           * A won seat is finished and cannot be taken; a led seat is where
           * that constituency stands today. Adding them into one number would
           * tell a player they own forty-two seats when twelve of them could
           * be gone by Thursday.
           */
          el('span', { class: 'board-seats' }, [
            el('strong', { text: String(row.won || 0) }),
            el('span', { class: 'board-seats-label', text: 'won' }),
            (row.leading || 0) > 0
              ? el('span', { class: 'board-leading-count', text: '+' + row.leading + ' leading' })
              : null,
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
     * Election night, in the order a results programme would run it.
     *
     * Malwa, then Majha, then Doaba, then who is leading overall. Each region
     * is its own short screen: the districts in it, who is ahead in each, and
     * by how much. That is the whole of what anybody wants after a round —
     * who is leading, where, and how many seats they have.
     *
     * It used to be one screen of everything that changed, with the wins and
     * the conflicts and the counts stacked on top of each other. Correct, and
     * more than anybody reads in the eight seconds between rounds.
     */
    var REGION_ORDER = ['malwa', 'majha', 'doaba'];

  /*
   * The same four words the seat panel uses, for the same four states.
   *
   * They are declared here rather than imported so this file has no opinion
   * about load order, but they are the words in CMP.ui.district.POSITION and
   * they must stay the words in CMP.ui.district.POSITION.
   */
  var POSITION_WORD = {
    won: 'Won',
    leading: 'Leading',
    trailing: 'Trailing',
    none: 'No bid',
  };

    var stage = 'overview';   // then a region id, then 'overall'

    /*
     * The results run themselves.
     *
     * A player who has just spent two minutes deciding things should be told
     * what came of it without having to ask, and the sequence moves on by
     * itself so nobody is left looking at a screen wondering whether it has
     * finished. Every step can be skipped, and any tap stops the clock: the
     * moment somebody is reading rather than watching, it waits for them.
     */
    var advance = null;

    function stopAdvance() {
      if (advance !== null) window.clearTimeout(advance);
      advance = null;
    }

    /** What comes after this, or null at the end. */
    function nextStage(from) {
      /*
       * The overview comes before the regions, so it has to know what follows
       * it. Without this it fell through to `return null`, and go() read that
       * as "nothing after this" and queued the end of the whole sequence —
       * which meant a round settled, showed the overview for a few seconds
       * and then closed, and no region was ever read out.
       */
      if (from === 'overview') return firstRegion() || 'overall';

      var at = REGION_ORDER.indexOf(from);
      if (at !== -1) {
        // Regions nobody has campaigned in yet are skipped rather than shown
        // empty: a screen saying "no results" is not a result.
        for (var i = at + 1; i < REGION_ORDER.length; i++) {
          if (regionRows(REGION_ORDER[i]).length) return REGION_ORDER[i];
        }
        return 'overall';
      }
      return null;
    }

    function go(next) {
      if (CMP.audio) CMP.audio.play(next === 'overall' ? 'victory' : 'results');
      stopAdvance();
      stopReveal();
      stage = next;
      render();

      var after = nextStage(next);
      if (after) queue(after, regionDwell(next));
      else queue('done', LEADER_DWELL);
    }

    function queue(next, ms) {
      stopAdvance();
      advance = window.setTimeout(function () {
        advance = null;
        if (next === 'done') {
          if (opts.onFinished) opts.onFinished();
          return;
        }
        go(next);
      }, ms);
    }

    /*
     * How a result is read out.
     *
     * A card takes a second and a half to arrive at the top of the feed, and
     * the one before it slides down and stays: the districts already declared
     * remain on screen the way they would on a results programme, rather than
     * each one replacing the last.
     *
     * It then holds long enough to actually read. A district name, four faces,
     * four bars and four percentages is not something anybody takes in at half
     * a second, which is what the first version of this gave it.
     *
     * The entrance is read by the stylesheet too, so the animation and the
     * timer that waits for it cannot drift apart.
     */
    var REVEAL_IN = 1500;      // a card arriving at the top
    var REVEAL_HOLD = 2100;    // and how long before the next one starts
    var REVEAL_STEP = REVEAL_IN + REVEAL_HOLD;

    /*
     * Where the feed has got to, and the timer walking it.
     *
     * Held out here rather than inside the render so a repaint — a poll
     * landing, the clock ticking — carries on from where the reveal was
     * instead of starting it again from the first district.
     */
    var feedNode = el('div', { class: 'rr-feed' });
    var revealAt = 0;
    var revealFor = null;
    var revealTimer = null;

    function stopReveal() {
      if (revealTimer !== null) window.clearTimeout(revealTimer);
      revealTimer = null;
    }

    /** Long enough to watch the region read out, and to take in the last of it. */
    /*
     * The overview is read, not watched.
     *
     * Long enough for four cards and five figures each, and no longer: it
     * used to fall through to the region rule, find no districts called
     * "overview", and return zero — so the screen that answers "how did I do"
     * was on screen for no time at all before the regions took over.
     */
    var OVERVIEW_DWELL = 5500;

    function regionDwell(region) {
      if (region === 'overview') return OVERVIEW_DWELL;
      var rows = regionRows(region).length;
      if (!rows) return 0;
      // Capped: a fifteen-district region should not hold the game for a
      // minute. Past the cap the rest of the feed is still arriving, and Skip
      // is there for anybody who has seen enough.
      return Math.min(26000, rows * REVEAL_STEP + 1400);
    }

    var LEADER_DWELL = 6000;

    var root = el('section', { class: 'round-results' });

    /* ------------------------------------------------ reading the board */

    /**
     * How a district stands, from the board the engine already settled.
     *
     * Nothing here computes a result. The shares are the same shares the
     * campaign panel and the map read, averaged across the district's seats
     * so the four numbers add up to a position somebody can read — and the
     * seats won and led are counted from the game's own record of them.
     */
    function districtRow(district) {
      var game = opts.game && opts.game();
      if (!game) return null;

      var won = game.wonSeats || {};
      var totals = {};
      var seatsWon = {};
      var seatsLed = {};
      var touched = false;

      district.seats.forEach(function (n) {
        var support = game.support[n] || {};
        var ranked = CMP.campaign.standings(support);
        if (ranked.length) touched = true;
        ranked.forEach(function (row) {
          totals[row.partyId] = (totals[row.partyId] || 0) + row.support;
        });

        var w = won[String(n)];
        if (w) {
          seatsWon[w.party] = (seatsWon[w.party] || 0) + 1;
        } else if (ranked.length) {
          seatsLed[ranked[0].partyId] = (seatsLed[ranked[0].partyId] || 0) + 1;
        }
      });

      if (!touched) return null;

      var count = district.seats.length || 1;

      /*
       * Every party, including the ones that stayed out.
       *
       * The card used to list only who had spent something, which made a
       * district contested by two look identical to one contested by four —
       * and "nobody else came" is a fact worth as much as any of the shares.
       */
      var rows = CMP.getParties().map(function (party) {
        var id = party.id;
        return {
          partyId: id,
          share: totals[id] ? Math.round((totals[id] / count) * 10) / 10 : 0,
          won: seatsWon[id] || 0,
          leading: seatsLed[id] || 0,
        };
      }).sort(function (a, b) {
        return b.share - a.share || b.won - a.won;
      });

      /*
       * Where each of them stands, in the words the seat panel uses.
       *
       * One vocabulary across the game: a player who has learned what
       * "contested" means on a seat should not have to learn it again here.
       */
      var settled = rows.reduce(function (n, r) { return n + r.won; }, 0);
      rows.forEach(function (r, i) {
        if (r.share <= 0 && !r.won) r.position = 'none';
        else if (r.won >= district.seats.length) r.position = 'won';
        else if (i === 0) r.position = settled >= district.seats.length ? 'won' : 'leading';
        else r.position = 'trailing';
      });

      return { district: district, rows: rows, settled: settled };
    }

    /** Every district in a region that anybody has campaigned in. */
    function regionRows(region) {
      if (!CMP.DISTRICTS) return [];
      var out = [];
      CMP.DISTRICTS.forEach(function (d) {
        if (d.region !== region) return;
        var row = districtRow(d);
        if (row) out.push(row);
      });
      return out.sort(function (a, b) {
        return b.district.seats.length - a.district.seats.length;
      });
    }

    /* -------------------------------------------------- the presentation */

    /**
     * The bar across the top of every results screen.
     *
     * SKIP is always there and always goes to the same place — the overall
     * leader — because somebody who does not want to watch the districts
     * wants the answer, not the next region.
     */
    function resultsBar(title, kicker) {
      return el('div', { class: 'rr-bar' }, [
        el('div', { class: 'rr-bar-text' }, [
          el('span', { class: 'rr-bar-kicker', text: kicker }),
          el('h2', { class: 'rr-bar-title', text: title }),
        ]),
        stage !== 'overall'
          ? el('button', {
              class: 'rr-skip',
              // Skipping from the overview means skipping the whole read-out.

              type: 'button',
              text: 'Skip',
              onclick: function () {
                // Finish reading this region out before leaving it, so a card
                // caught mid-arrival is not simply dropped.
                revealRest();
                go('overall');
              },
            })
          : null,
      ]);
    }

    /**
     * Where every campaign stands, before the regions are read out.
     *
     * The sequence used to open on Malwa, which is a detail — it asked the
     * player to follow a district before telling them whether they were
     * winning. This is the answer to "how did I do" in one screen: four
     * cards, five figures each, and a word for where each of them stands.
     *
     * Every figure is the engine's. Seats and shares come off the board;
     * spend and grant income come off the campaigns that own them. What is
     * left in anybody's purse does not appear, because that is theirs.
     */
    function overviewScreen() {
      var mine = opts.you && opts.you();
      var rows = (result.standings || []).slice().sort(function (a, b) {
        return (b.seats || 0) - (a.seats || 0);
      });
      var top = rows[0];

      return [
        resultsBar('End of round ' + result.round, 'How it stands'),

        el('div', { class: 'ro-grid' }, rows.map(function (row, i) {
          var id = row.partyId || row.party;
          var party = partyOf(id);
          var isYou = id === mine;

          /*
           * One word for where they are, from the same four the seat panel
           * and the district cards use.
           *
           * "Won" is for a campaign that has already cleared the majority —
           * not for one that merely leads, because leading twelve rounds out
           * is not winning and a screen that said so would be lying.
           */
          var word = row.seats <= 0 ? 'No bid'
            : (result.majority && row.seats >= result.majority) ? 'Won'
            : (top && id === (top.partyId || top.party)) ? 'Leading'
            : 'Trailing';

          return el('article', {
            class: 'ro-card is-' + word.toLowerCase().replace(' ', '-') +
              (isYou ? ' is-you' : ''),
            style: { '--party': party.colour, animationDelay: i * 90 + 'ms' },
          }, [
            el('header', { class: 'ro-card-head' }, [
              CMP.ui.portrait.render(row.avatar || avatarFor(id), 46,
                row.candidateName || party.name),
              el('div', { class: 'ro-card-who' }, [
                el('strong', { class: 'ro-card-party', text: party.name }),
                el('span', {
                  class: 'ro-card-cand',
                  text: isYou ? 'You' : (row.candidateName || party.short),
                }),
              ]),
              el('span', { class: 'ro-card-sym' }, [CMP.ui.symbol.render(party.symbol, 26)]),
            ]),

            el('div', { class: 'ro-card-seats' }, [
              el('strong', { class: 'ro-seats-value', text: String(row.seats || 0) }),
              el('span', {
                class: 'ro-seats-label',
                text: row.won
                  ? (row.won + ' won · ' + row.leading + ' leading')
                  : (row.seats === 1 ? 'seat' : 'seats'),
              }),
            ]),

            el('div', { class: 'ro-figs' }, [
              fig('Popular vote', share(row)),
              fig('Spent', spend(row.spent)),
              fig('Grants', spend(row.granted)),
            ]),

            el('span', { class: 'ro-card-state', text: word }),
          ]);
        })),

        el('button', {
          class: 'btn btn-primary btn-wide',
          type: 'button',
          text: firstRegion() ? 'Region results' : 'See who is leading',
          onclick: function () {
            go(firstRegion() || 'overall');
          },
        }),
      ];
    }

    /**
     * The region in one line, above the districts it is made of.
     *
     * Who is ahead across the whole region and by how much, so the districts
     * underneath read as evidence rather than as an unordered pile. Counted
     * from the same rows the cards are drawn from, so the two cannot
     * disagree.
     */
    function regionSummary(regionId, rows) {
      if (!rows.length) return null;

      var totals = {};
      var seats = 0;
      rows.forEach(function (row) {
        seats += row.district.seats.length;
        row.rows.forEach(function (r) {
          if (!totals[r.partyId]) totals[r.partyId] = { share: 0, won: 0, leading: 0 };
          totals[r.partyId].share += r.share;
          totals[r.partyId].won += r.won || 0;
          totals[r.partyId].leading += r.leading || 0;
        });
      });

      var ranked = Object.keys(totals).map(function (id) {
        return {
          id: id,
          share: Math.round((totals[id].share / rows.length) * 10) / 10,
          seats: totals[id].won + totals[id].leading,
        };
      }).sort(function (a, b) {
        return b.share - a.share;
      });

      var top = ranked[0];
      if (!top || top.share <= 0) return null;
      var party = partyOf(top.id);
      var standing = (result.standings || []).filter(function (r) {
        return (r.partyId || r.party) === top.id;
      })[0];

      return el('div', {
        class: 'rr-region-summary',
        style: { '--party': party.colour },
      }, [
        el('div', { class: 'rr-region-lead' }, [
          CMP.ui.portrait.render((standing && standing.avatar) || avatarFor(top.id), 34,
            party.name),
          el('div', { class: 'rr-region-who' }, [
            el('span', { class: 'rr-region-kicker', text: 'Leading here' }),
            el('strong', { class: 'rr-region-party', text: party.name }),
          ]),
        ]),
        el('div', { class: 'rr-region-figs' }, [
          fig('Seats', String(top.seats) + ' of ' + seats),
          fig('Popular vote', top.share.toFixed(1) + '%'),
          fig('Districts', String(rows.length)),
        ]),
      ]);
    }

    /** Whoever is ahead, as a share of the whole board. */
    function leaderShare() {
      var rows = (result.standings || []).slice().sort(function (a, b) {
        return (b.seats || 0) - (a.seats || 0);
      });
      return rows.length ? share(rows[0]) : '—';
    }

    /** One figure summed across every campaign, or a dash if none carry it. */
    function totalOf(key) {
      var rows = result.standings || [];
      var any = false;
      var total = 0;
      rows.forEach(function (r) {
        if (typeof r[key] === 'number') {
          any = true;
          total += r[key];
        }
      });
      return any ? total : null;
    }

    /** How much of the board is no longer in play. */
    function decidedSeats() {
      var rows = result.standings || [];
      var won = 0;
      rows.forEach(function (r) {
        won += r.won || 0;
      });
      return won;
    }

    function fig(label, value) {
      return el('div', { class: 'ro-fig' }, [
        el('span', { class: 'ro-fig-label', text: label }),
        el('strong', { class: 'ro-fig-value', text: value }),
      ]);
    }

    /*
     * A share the engine worked out, or a dash.
     *
     * A round settled before this field existed — an old save, a server that
     * has not been updated — has no share to show, and a zero would be a
     * claim rather than a gap.
     */
    function share(row) {
      return typeof row.share === 'number' ? row.share.toFixed(1) + '%' : '—';
    }

    function spend(n) {
      if (typeof n !== 'number') return '—';
      return n > 0 ? CMP.ui.money.words(n) : '₹0';
    }

    /** The first region anybody actually campaigned in this round. */
    function firstRegion() {
      for (var i = 0; i < REGION_ORDER.length; i++) {
        if (regionRows(REGION_ORDER[i]).length) return REGION_ORDER[i];
      }
      return null;
    }

    /** One region: its districts, and who is ahead in each. */
function regionScreen() {
      var region = CMP.getRegion ? CMP.getRegion(stage) : null;
      var rows = regionRows(stage);
      var after = nextStage(stage);

      /*
       * The feed the districts arrive in.
       *
       * Kept across repaints rather than rebuilt, so a poll landing or the
       * clock ticking does not restart the reveal from the first district.
       */
      if (revealFor !== stage) {
        revealFor = stage;
        revealAt = 0;
        mount(feedNode, []);
      }
      feedNode.style.setProperty('--reveal-in', REVEAL_IN + 'ms');
      scheduleReveal(rows);

      return [
        resultsBar(region ? region.name : stage, 'Round ' + result.round + ' results'),
        regionSummary(stage, rows),
        feedNode,
        el('button', {
          class: 'btn btn-primary btn-wide',
          type: 'button',
          text: after === 'overall' ? 'See who is leading' : 'Next region',
          onclick: function () {
            go(after || 'overall');
          },
        }),
      ];
    }

    /**
     * Read the next district out, then queue the one after it.
     *
     * Newest at the top: the card that just arrived is inserted above the one
     * before it, which slides down and stays. The districts already declared
     * remain on screen the way they would on a results programme, rather than
     * each one replacing the last.
     */
    function scheduleReveal(rows) {
      stopReveal();
      if (revealAt >= rows.length) return;

      var next = function () {
        revealTimer = null;
        if (revealFor !== stage || revealAt >= rows.length) return;

        var card = districtCard(rows[revealAt], revealAt);
        revealAt += 1;
        if (feedNode.firstChild) feedNode.insertBefore(card, feedNode.firstChild);
        else feedNode.appendChild(card);

        scheduleReveal(rows);
      };

      // The first arrives at once; the rest wait their turn.
      if (revealAt === 0) next();
      else revealTimer = window.setTimeout(next, REVEAL_STEP);
    }

    /** Everything left to read out, at once. Used when somebody skips. */
    function revealRest() {
      stopReveal();
      var rows = regionRows(stage);
      while (revealAt < rows.length) {
        var card = districtCard(rows[revealAt], revealAt);
        card.classList.add('is-instant');
        revealAt += 1;
        if (feedNode.firstChild) feedNode.insertBefore(card, feedNode.firstChild);
        else feedNode.appendChild(card);
      }
    }

    /** One district: who is ahead in it, by how much, and where it stands. */
    function districtCard(row, i) {
      var top = row.rows[0];

      return el('section', { class: 'rr-district' }, [
        el('header', { class: 'rr-district-head' }, [
          el('h3', { class: 'rr-district-name', text: row.district.name }),
          el('span', {
            class: 'rr-district-seats',
            text: row.district.seats.length +
              (row.district.seats.length === 1 ? ' seat' : ' seats'),
          }),
        ]),

        el('div', { class: 'rr-runners' }, row.rows.map(function (r, place) {
          var party = partyOf(r.partyId);
          var mine = opts.you && opts.you() === r.partyId;
          return el('div', {
            class: 'rr-runner' + (place === 0 ? ' is-first' : '') +
              (mine ? ' is-you' : '') + ' is-' + r.position,
            // The bars fill after their own card has settled, so a district
            // reads as one thing arriving rather than four racing.
            style: {
              '--party': party.colour,
              '--runner-delay': (REVEAL_IN * 0.45 + place * 140) + 'ms',
            },
          }, [
            CMP.ui.portrait.render(avatarFor(r.partyId), 34, party.name),
            el('span', { class: 'rr-runner-name', text: party.short }),
            el('span', { class: 'rr-runner-track' }, [
              el('span', {
                class: 'rr-runner-fill',
                style: { width: Math.max(2, r.share) + '%' },
              }),
            ]),
            el('span', {
              class: 'rr-runner-share',
              text: r.share > 0 ? r.share.toFixed(1) + '%' : '—',
            }),
            r.won
              ? el('span', { class: 'rr-runner-won', text: '\u2713' + r.won })
              : null,
            el('span', {
              class: 'rr-runner-pos is-' + r.position,
              text: POSITION_WORD[r.position] || '',
            }),
          ]);
        })),

        top && top.share > 0
          ? el('p', {
              class: 'rr-district-lead',
              style: { '--party': partyOf(top.partyId).colour },
              text: partyOf(top.partyId).short +
                (row.settled >= row.district.seats.length ? ' has taken it' : ' leading'),
            })
          : null,
      ]);
    }

    
    /**
     * Who is leading, and nothing else.
     *
     * A face, a party and a number of seats each. Everything a player might
     * want to work out from it — the majority, how far off it they are, the
     * share of the vote — is a calculation they can go and make, and putting
     * it here turns the one screen that should answer a question into another
     * screen to read.
     */
    function overallScreen() {
      var mine = opts.you && opts.you();
      var rows = (result.standings || []).slice().sort(function (a, b) {
        return (b.seats || 0) - (a.seats || 0);
      });

      return [
        resultsBar('Overall leader', 'After round ' + result.round),

        el('div', {
          class: 'rr-grid',
          style: { '--reveal-in': REVEAL_IN + 'ms' },
        }, rows.map(function (row, i) {
          var party = partyOf(row.partyId || row.party);
          return el('article', {
            class: 'rr-card' + (i === 0 ? ' is-leading' : '') +
              ((row.partyId || row.party) === mine ? ' is-you' : ''),
            // Read out in order, like the districts were.
            style: {
              '--party': party.colour,
              animationDelay: i * 260 + 'ms',
            },
          }, [
            CMP.ui.portrait.render(row.avatar || avatarFor(row.partyId || row.party),
              58, row.candidateName || party.name),
            el('span', { class: 'rr-card-party', text: party.short }),
            el('strong', { class: 'rr-card-seats', text: String(row.seats || 0) }),
            el('span', { class: 'rr-card-label', text: (row.seats === 1 ? 'seat' : 'seats') }),
            i === 0 ? el('span', { class: 'rr-card-badge', text: 'Leading' }) : null,
          ]);
        })),

        /*
         * What the round added up to, across everybody.
         *
         * Four totals rather than four more cards: the grid above already
         * says who holds what, and this says how much of the board is settled
         * and what the campaigns have cost between them.
         */
        el('div', { class: 'rr-totals' }, [
          fig('Seats decided', decidedSeats() + ' of ' + (result.totalSeats || 117)),
          /*
           * The leader's share of the board, not the majority line.
           *
           * How many seats a majority needs is on the leader's own screen and
           * on the final count; repeating it here would turn a summary of the
           * round into arithmetic about the election, which is the thing this
           * screen was built to stop doing.
           */
          fig('Popular vote', leaderShare()),
          fig('Total spend', spend(totalOf('spent'))),
          fig('Total grants', spend(totalOf('granted'))),
        ]),

        milestoneKind()
          ? el('button', {
              class: 'btn btn-quiet btn-wide',
              type: 'button',
              text: milestoneKind() === 'checkpoint'
                ? 'Round 15 review'
                : 'Halfway: alliances close',
              onclick: function () {
                stopAdvance();
                stage = 'milestone';
                render();
              },
            })
          : null,

        el('button', {
          class: 'btn btn-primary btn-wide',
          type: 'button',
          text: result.isFinalRound ? 'Go to the count' : 'Continue to next round',
          onclick: function () {
            stopAdvance();
            if (opts.onFinished) opts.onFinished();
          },
        }),
      ];
    }

    /** A face for a party, from whoever is playing it. */
    function avatarFor(partyId) {
      var rows = result.standings || [];
      for (var i = 0; i < rows.length; i++) {
        if ((rows[i].partyId || rows[i].party) === partyId && rows[i].avatar) {
          return rows[i].avatar;
        }
      }
      return (CMP.AVATARS || [])[0];
    }

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
    /*
     * The seats-changed screen, the wins block, the conflicts block and the
     * old standings screen used to live here.
     *
     * They were correct and they were too much: five stacked sections of what
     * moved, what was taken for good and what two campaigns burned on each
     * other, in the eight seconds between rounds. What replaced them is up
     * above — the regions one at a time, then who is leading — and a seat won
     * is a tick on its district's row rather than a section of its own.
     */

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
            stopAdvance();
            stage = 'overall';
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
            stopAdvance();
            stage = 'overall';
            render();
          },
        }),
      ];
    }

    /* ---------------------------------------------------- render */

    function render(next, secondsLeft) {
      if (next) {
        // A new round's results start the sequence again from the top.
        var fresh = !result || next.round !== result.round;
        result = next;
        if (fresh) {
          /*
           * Every round opens on the overview.
           *
           * It used to open on Malwa, which asked the player to follow a
           * district before anybody had told them whether they were winning.
           * The regions are the evidence; this is the answer.
           */
          go('overview');
          return;
        }
      }
      if (!result) return;

      var kind = milestoneKind();
      if (stage === 'milestone' && !kind) stage = 'overall';

      if (stage === 'milestone') {
        mount(root, kind === 'checkpoint'
          ? checkpointScreen(secondsLeft)
          : halfwayScreen(secondsLeft));
        return;
      }

      mount(root, stage === 'overview' ? overviewScreen()
        : stage === 'overall' ? overallScreen()
        : regionScreen());
    }

    function stop() {
      stopAdvance();
      stopReveal();
    }

    return { root: root, render: render, stop: stop };
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
