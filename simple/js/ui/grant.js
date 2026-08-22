/**
 * Grants: what a campaign is earning, and where the next one is.
 * ------------------------------------------------------------------
 * A district pays its grant every round once every seat in it has been won,
 * and the money is locked to the region that earned it. That is the whole
 * rule, and this screen exists to make it something a player can act on:
 * three regions, what each is already paying, what is still on the table, and
 * which districts are worth going after next.
 *
 * It replaced a dashboard that led with how many seats you were leading. That
 * is a fact about the board, not a decision about money, and it pushed the
 * question — where does the next crore a round come from — below the fold.
 *
 * Nothing here calculates an economy of its own. The grants, the districts,
 * the seats and the purses are the engine's, read as they are.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.grant = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  function create(opts) {
    var game = null;
    var openRegion = null;      // a region id, when one is being inspected
    var targetParty = null;     // a rival, when one is being challenged

    var root = el('div', { class: 'gr' });

    /* --------------------------------------------------------- reading */

    /**
     * How a district stands for the campaign looking at it.
     *
     * `won` is permanent and `leading` is not, and the difference is the
     * whole screen: a district pays nothing until every seat in it is won,
     * so seats led are progress and seats won are the thing.
     */
    function readDistrict(d) {
      var won = game.wonSeats || {};
      var leaders = CMP.campaign.currentLeaders(game.support);
      var mine = 0;
      var leading = 0;
      var byParty = {};
      var wonBy = {};

      d.seats.forEach(function (n) {
        var w = won[String(n)];
        if (w) {
          wonBy[w.party] = (wonBy[w.party] || 0) + 1;
          if (w.party === game.partyId) mine += 1;
          return;
        }
        var who = leaders[n];
        if (who) {
          byParty[who] = (byParty[who] || 0) + 1;
          if (who === game.partyId) leading += 1;
        }
      });

      var owner = null;
      Object.keys(wonBy).forEach(function (id) {
        if (wonBy[id] === d.seats.length) owner = id;
      });

      // Whoever is ahead here on won-plus-led, which is how a district reads
      // at a glance even though only the won half pays.
      var strength = {};
      Object.keys(byParty).forEach(function (id) {
        strength[id] = (strength[id] || 0) + byParty[id];
      });
      Object.keys(wonBy).forEach(function (id) {
        strength[id] = (strength[id] || 0) + wonBy[id];
      });
      var ahead = null;
      Object.keys(strength).forEach(function (id) {
        if (!ahead || strength[id] > strength[ahead]) ahead = id;
      });

      return {
        district: d,
        mine: mine,
        leading: leading,
        total: d.seats.length,
        need: d.seats.length - mine,
        held: mine === d.seats.length,
        owner: owner,
        lost: !!owner && owner !== game.partyId,
        ahead: ahead,
        strength: strength,
        wonBy: wonBy,
      };
    }

    function allDistricts() {
      return (CMP.DISTRICTS || []).map(readDistrict);
    }

    /**
     * A region's grant position.
     *
     * `earning` is what the districts already controlled pay every round.
     * `purse` is what has actually accumulated and is sitting there to spend
     * — the two are different questions and the screen keeps them apart.
     * `open` is what the rest of the region would pay if it were taken.
     */
    function readRegion(regionId, rows) {
      var here = rows.filter(function (r) {
        return r.district.region === regionId;
      });

      var earning = 0;
      var open = 0;
      here.forEach(function (r) {
        if (r.held) earning += r.district.grant;
        else if (!r.lost) open += r.district.grant;
      });

      return {
        region: CMP.getRegion(regionId),
        rows: here,
        held: here.filter(function (r) {
          return r.held;
        }).length,
        earning: earning,
        open: open,
        purse: CMP.campaign.grantIn(game, regionId),
      };
    }

    /**
     * What a district is worth going after.
     *
     * Value is what it pays; cost is how many seats are still to be won, and
     * it counts squared because the last seat of a district is dearer than
     * the first — a seat somebody else is leading has to be taken from them.
     * Seats already led are cheaper than open ones, so they discount the
     * cost rather than counting as done.
     *
     * The seats a district has do not enter into it except through what it
     * pays, which is the point: the largest district is not the best target,
     * the best return on the next few crore is.
     */
    function score(row) {
      if (row.held || row.lost || !row.need) return 0;
      var toTake = row.need - row.leading * 0.45;
      if (toTake <= 0) toTake = 0.5;
      return row.district.grant / (toTake * toTake);
    }

    function priorityOf(value, best) {
      if (!best) return 'low';
      var share = value / best;
      return share >= 0.6 ? 'high' : share >= 0.25 ? 'medium' : 'low';
    }

    function bestTargets(rows, limit) {
      var scored = rows.map(function (row) {
        return { row: row, value: score(row) };
      }).filter(function (s) {
        return s.value > 0;
      }).sort(function (a, b) {
        return b.value - a.value;
      });

      var best = scored.length ? scored[0].value : 0;
      return scored.slice(0, limit || 3).map(function (s) {
        s.priority = priorityOf(s.value, best);
        return s;
      });
    }

    /**
     * Where challenging one rival would cost them most.
     *
     * Not their money — nothing in this game takes money off anybody. What a
     * district changes hands does is stop it ever paying them, so the ones
     * worth naming are the districts they are closest to completing and you
     * are closest to reaching.
     */
    function againstParty(rows, partyId) {
      var scored = rows.map(function (row) {
        if (row.held || row.lost) return null;
        var theirs = (row.wonBy[partyId] || 0) + ((row.strength[partyId] || 0) -
          (row.wonBy[partyId] || 0));
        if (!theirs) return null;

        // What it would cost them: the grant they are on course for, weighted
        // by how near they are to it and how near you are to stopping them.
        var theirGap = Math.max(0.5, row.total - theirs);
        var yourGap = Math.max(0.5, row.need - row.leading * 0.45);
        return {
          row: row,
          theirs: theirs,
          value: row.district.grant / (theirGap * yourGap),
        };
      }).filter(Boolean).sort(function (a, b) {
        return b.value - a.value;
      });

      var best = scored.length ? scored[0].value : 0;
      return scored.slice(0, 3).map(function (s) {
        s.priority = priorityOf(s.value, best);
        return s;
      });
    }

    /* -------------------------------------------------------- painting */

    function figure(label, value, cls) {
      return el('div', { class: 'gr-fig' + (cls ? ' ' + cls : '') }, [
        el('span', { class: 'gr-fig-label', text: label }),
        el('strong', { class: 'gr-fig-value', text: money.words(value) || '₹0' }),
      ]);
    }

    /** One region: what it pays, what is banked, what is still out there. */
    function regionCard(info) {
      var id = info.region.id;
      return el('button', {
        class: 'gr-card' + (openRegion === id ? ' is-open' : ''),
        type: 'button',
        onclick: function () {
          openRegion = openRegion === id ? null : id;
          paint();
        },
      }, [
        el('div', { class: 'gr-card-head' }, [
          el('h3', { class: 'gr-card-name', text: info.region.name + ' grant' }),
          el('span', {
            class: 'gr-card-held',
            text: info.held + ' of ' + info.rows.length + ' districts',
          }),
        ]),
        el('div', { class: 'gr-figs' }, [
          figure('Won, a round', info.earning, 'is-won'),
          figure('Available now', info.purse, 'is-purse'),
          figure('Still open', info.open),
        ]),
      ]);
    }

    /** Why a district is or is not paying, in one line each. */
    function districtRow(row) {
      var d = row.district;
      var ahead = row.ahead ? CMP.getParty(row.ahead) : null;

      return el('div', {
        class: 'gr-district' + (row.held ? ' is-held' : '') + (row.lost ? ' is-lost' : ''),
        style: ahead ? { '--party': ahead.colour } : null,
      }, [
        el('span', { class: 'gr-district-name', text: d.name }),
        el('span', {
          class: 'gr-district-seats',
          text: row.mine + ' / ' + row.total + ' won',
        }),
        el('span', { class: 'gr-district-grant', text: money.words(d.grant) }),
        el('span', {
          class: 'gr-district-state',
          text: row.held
            ? 'Paying'
            : row.lost
              ? (CMP.getParty(row.owner).short + ' has it')
              : row.leading
                ? 'Leading ' + row.leading
                : 'Open',
        }),
      ]);
    }

    /**
     * What would earn more, said about this game rather than in general.
     *
     * "Win more seats" is true of every strategy game ever written. What a
     * player can act on is which region is closest to paying and by how much.
     */
    function howToEarnMore(rows) {
      var lines = (CMP.REGIONS || []).map(function (region) {
        var info = readRegion(region.id, rows);
        var close = info.rows.filter(function (r) {
          return !r.held && !r.lost && r.need <= 2;
        });
        var contested = info.rows.filter(function (r) {
          return !r.held && !r.lost && r.leading > 0 && r.leading < r.total;
        });

        var note;
        if (!info.rows.length) return null;
        if (close.length) {
          note = close.length + (close.length === 1 ? ' district is' : ' districts are') +
            ' within two seats of paying';
        } else if (contested.length) {
          note = 'You are leading in ' + contested.length +
            (contested.length === 1 ? ' district' : ' districts') + ' but have won none of them outright';
        } else if (info.open > 0) {
          note = money.words(info.open) + ' a round is still unclaimed here';
        } else {
          note = 'Every district here is decided';
        }

        return el('li', { class: 'gr-how-row' }, [
          el('strong', { class: 'gr-how-region', text: region.name }),
          el('span', { class: 'gr-how-note', text: note }),
        ]);
      }).filter(Boolean);

      return el('section', { class: 'gr-block' }, [
        el('h2', { class: 'gr-block-title', text: 'How to earn more' }),
        el('ul', { class: 'gr-how' }, lines),
      ]);
    }

    /** The next few districts worth the money, and why. */
    function targetsBlock(rows) {
      var picks = bestTargets(rows, 3);
      if (!picks.length) return null;

      return el('section', { class: 'gr-block' }, [
        el('h2', { class: 'gr-block-title', text: 'Best targets' }),
        el('p', {
          class: 'gr-block-note',
          text: 'What the next few crore would earn, not which district is biggest.',
        }),
        el('div', { class: 'gr-targets' }, picks.map(function (pick) {
          return targetCard(pick);
        })),
      ]);
    }

    function targetCard(pick) {
      var row = pick.row;
      var d = row.district;
      var region = CMP.getRegion(d.region);
      var ahead = row.ahead ? CMP.getParty(row.ahead) : null;

      return el('article', {
        class: 'gr-target is-' + pick.priority,
        style: ahead ? { '--party': ahead.colour } : null,
      }, [
        el('div', { class: 'gr-target-head' }, [
          el('div', {}, [
            el('h3', { class: 'gr-target-name', text: d.name }),
            el('span', { class: 'gr-target-region', text: region ? region.name : '' }),
          ]),
          el('span', { class: 'gr-target-priority', text: pick.priority + ' priority' }),
        ]),

        el('dl', { class: 'gr-target-figs' }, [
          line('Seats to win', String(row.need) + ' of ' + row.total),
          line('Already leading', String(row.leading)),
          line('Pays', money.words(d.grant) + ' a round'),
          ahead && row.ahead !== game.partyId
            ? line('Ahead here', ahead.short)
            : null,
        ]),

        el('button', {
          class: 'btn btn-quiet btn-wide',
          type: 'button',
          text: 'Campaign in ' + d.name,
          onclick: function () {
            if (opts.onDistrict) opts.onDistrict(d.id);
          },
        }),
      ]);
    }

    function line(label, value) {
      return el('div', { class: 'gr-line' }, [
        el('dt', { text: label }),
        el('dd', { text: value }),
      ]);
    }

    /**
     * Challenging one rival in particular.
     *
     * Nothing here takes money off anybody — the game has no mechanism for
     * that and inventing one would be a change to the economy rather than a
     * screen. What taking a district does is stop it ever paying them, and
     * that is what this says.
     */
    function opponentBlock(rows) {
      var rivals = (CMP.PARTIES || []).filter(function (p) {
        return p.id !== game.partyId;
      });
      if (!rivals.length) return null;

      var picks = targetParty ? againstParty(rows, targetParty) : [];
      var party = targetParty ? CMP.getParty(targetParty) : null;

      return el('section', { class: 'gr-block' }, [
        el('h2', { class: 'gr-block-title', text: 'Target an opponent' }),
        el('div', { class: 'gr-rivals' }, rivals.map(function (p) {
          return el('button', {
            class: 'gr-rival' + (targetParty === p.id ? ' is-on' : ''),
            type: 'button',
            style: { '--party': p.colour },
            'aria-pressed': targetParty === p.id ? 'true' : 'false',
            onclick: function () {
              targetParty = targetParty === p.id ? null : p.id;
              paint();
            },
          }, [
            el('span', { class: 'gr-rival-dot' }),
            el('span', { class: 'gr-rival-name', text: p.short }),
          ]);
        })),

        targetParty && !picks.length
          ? el('p', {
              class: 'gr-block-note',
              text: party.short + ' is not close to a grant anywhere you could reach.',
            })
          : null,

        targetParty && picks.length
          ? el('div', { class: 'gr-targets' }, [
              el('p', {
                class: 'gr-block-note',
                text: 'Taking these would stop ' + party.short +
                  ' earning from them. It does not take money they already have.',
              }),
            ].concat(picks.map(function (pick) {
              return targetCard(pick);
            })))
          : null,
      ]);
    }

    /* ----------------------------------------------------------- paint */

    function paint() {
      if (!game) return;

      var rows = allDistricts();
      var body = [];

      /*
       * The three regions first, because the question this screen answers is
       * "where is my money coming from and where is the next of it".
       */
      body.push(el('div', { class: 'gr-cards' }, (CMP.REGIONS || []).map(function (region) {
        return regionCard(readRegion(region.id, rows));
      })));

      if (openRegion) {
        var info = readRegion(openRegion, rows);
        body.push(el('section', { class: 'gr-block' }, [
          el('h2', { class: 'gr-block-title', text: info.region.name + ' districts' }),
          el('div', { class: 'gr-districts' }, info.rows.slice().sort(function (a, b) {
            if (a.held !== b.held) return a.held ? -1 : 1;
            return a.need - b.need || b.district.grant - a.district.grant;
          }).map(districtRow)),
        ]));
      }

      body.push(howToEarnMore(rows));
      body.push(targetsBlock(rows));
      body.push(opponentBlock(rows));

      mount(root, body.filter(Boolean));
    }

    return {
      root: root,
      render: function (next) {
        game = next;
        paint();
      },
    };
  }

  return { create: create };
})();
