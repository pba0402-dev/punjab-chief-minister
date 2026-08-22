/**
 * MY AREAS — region, then district, then campaign the lot.
 * ------------------------------------------------------------------
 * The old flow made you open a constituency to do anything, which is fine for
 * one seat and absurd for a district of fourteen. This is the strategic view:
 * pick a region, see every district in it with who leads and what it pays,
 * select the ones you mean to fight for, and campaign across all of them in a
 * single decision.
 *
 * The screen states the objective rather than leaving it to be worked out. A
 * district where you lead six of seven says so, and says what the last seat is
 * worth — because that, not the arithmetic, is the game.
 *
 * Individual constituencies are still there for anybody who wants them. They
 * are simply no longer the only way to spend money.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.myAreas = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  function create(opts) {
    var game = null;
    var openRegion = null;
    var selected = [];       // district ids chosen for a bulk campaign

    var root = el('div', { class: 'ma' });

    /* ------------------------------------------------------- reading */

    /*
     * How a district stands.
     *
     * Two counts, and the difference between them is the screen. `leading` is
     * where the seats stand today and can be taken back tomorrow; `won` is
     * permanent. A district only pays its grant when every seat in it has been
     * won, so `need` counts what is still to be won — including the seats this
     * campaign is already leading, which are the cheapest ones left but are
     * not banked.
     */
    function readDistrict(d, leaders, won) {
      var byParty = {};
      var wonBy = {};
      d.seats.forEach(function (n) {
        var who = leaders[n];
        if (who) byParty[who] = (byParty[who] || 0) + 1;
        var w = won[String(n)];
        if (w) wonBy[w.party] = (wonBy[w.party] || 0) + 1;
      });

      var ranked = Object.keys(byParty).map(function (id) {
        return { party: id, seats: byParty[id] };
      }).sort(function (a, b) {
        return b.seats - a.seats;
      });

      var mine = wonBy[game.partyId] || 0;
      var leading = byParty[game.partyId] || 0;
      var inherited = (game.openingDistricts || []).indexOf(d.id) !== -1;

      // Who controls it outright, if anybody does.
      var owner = null;
      Object.keys(wonBy).forEach(function (id) {
        if (wonBy[id] === d.seats.length) owner = id;
      });

      return {
        district: d,
        byParty: byParty,
        wonBy: wonBy,
        ranked: ranked,
        leader: ranked.length ? ranked[0].party : null,
        owner: owner,
        mine: mine,
        leading: leading,
        total: d.seats.length,
        need: d.seats.length - mine,
        held: mine === d.seats.length,
        lost: !!owner && owner !== game.partyId,
        inherited: inherited,
      };
    }

    function allDistricts() {
      var leaders = CMP.campaign.currentLeaders(game.support);
      var won = game.wonSeats || {};
      return CMP.DISTRICTS.map(function (d) {
        return readDistrict(d, leaders, won);
      });
    }

    /**
     * The district most worth taking next.
     *
     * Value is the grant it pays; cost is how many seats are still missing.
     * A district one seat short of paying thirty crore beats one four seats
     * short of paying four, and saying so saves the player doing it by hand
     * across twenty-three districts every round.
     */
    function bestTarget(rows) {
      var candidates = rows.filter(function (r) {
        // A district a rival has already won every seat in is not a target;
        // it is a finished piece of the map.
        return !r.held && !r.lost && r.need > 0 && r.need <= 4;
      });
      if (!candidates.length) return null;

      return candidates.map(function (r) {
        return { row: r, score: r.district.grant / (r.need * r.need) };
      }).sort(function (a, b) {
        return b.score - a.score;
      })[0].row;
    }

    /* ------------------------------------------------------ painting */

    function seatsSelected() {
      return selected.reduce(function (t, id) {
        var d = CMP.getDistrict(id);
        return t + (d ? d.seats.length : 0);
      }, 0);
    }

    function toggle(id) {
      var at = selected.indexOf(id);
      if (at === -1) selected.push(id);
      else selected.splice(at, 1);
      paint();
    }

    /**
     * What the campaign actually holds.
     *
     * Everything else on this screen is about what to do next; this is the
     * one block that says where things stand. Won and leading are side by
     * side and never added together — a campaign leading forty seats and
     * holding two is in a completely different position from one holding
     * forty, and a single total would hide exactly that.
     */
    function control(rows) {
      var won = Object.keys(game.wonSeats || {}).filter(function (seat) {
        return game.wonSeats[seat].party === game.partyId;
      }).length;
      var leaders = CMP.campaign.currentLeaders(game.support);
      var leading = Object.keys(leaders).filter(function (seat) {
        return leaders[seat] === game.partyId && !(game.wonSeats || {})[seat];
      }).length;
      var controlled = rows.filter(function (r) {
        return r.held;
      });
      var income = controlled.reduce(function (t, r) {
        return t + (r.inherited ? 0 : r.district.grant);
      }, 0);

      return el('section', { class: 'ma-control' }, [
        el('h3', { class: 'ma-control-title', text: 'Your control' }),
        el('div', { class: 'ma-control-figs' }, [
          el('div', { class: 'ma-control-fig is-won' }, [
            el('strong', { class: 'ma-control-value', text: String(won) }),
            el('span', { class: 'ma-control-label', text: 'seats won' }),
          ]),
          el('div', { class: 'ma-control-fig' }, [
            el('strong', { class: 'ma-control-value', text: String(leading) }),
            el('span', { class: 'ma-control-label', text: 'leading' }),
          ]),
          el('div', { class: 'ma-control-fig' }, [
            el('strong', { class: 'ma-control-value', text: String(controlled.length) }),
            el('span', { class: 'ma-control-label', text: 'districts' }),
          ]),
          el('div', { class: 'ma-control-fig is-money' }, [
            el('strong', { class: 'ma-control-value', text: money.words(income) || '₹0' }),
            el('span', { class: 'ma-control-label', text: 'grants a round' }),
          ]),
        ]),
        el('p', {
          class: 'ma-control-note',
          text: won
            ? 'Won seats are yours for the rest of the election. Leading seats are not.'
            : 'Nothing is won yet. A seat is won by taking a commanding share of it.',
        }),
      ]);
    }

    /** The bar across the top: what is selected, and what there is to spend. */
    function header(rows) {
      var available = CMP.campaign.remaining(game) + CMP.campaign.grantTotal(game);
      return el('div', { class: 'ma-head' }, [
        el('div', { class: 'ma-head-fig' }, [
          el('strong', { class: 'ma-head-value', text: String(selected.length) }),
          el('span', { class: 'ma-head-label', text: 'districts' }),
        ]),
        el('div', { class: 'ma-head-fig' }, [
          el('strong', { class: 'ma-head-value', text: String(seatsSelected()) }),
          el('span', { class: 'ma-head-label', text: 'seats' }),
        ]),
        el('div', { class: 'ma-head-fig is-money' }, [
          el('strong', { class: 'ma-head-value', text: money.words(available) || '₹0' }),
          el('span', { class: 'ma-head-label', text: 'available' }),
        ]),
      ]);
    }

    /** The one worth doing next, stated rather than implied. */
    function recommendation(rows) {
      var best = bestTarget(rows);
      if (!best) return null;

      return el('button', {
        class: 'ma-target',
        type: 'button',
        onclick: function () {
          openRegion = best.district.region;
          if (selected.indexOf(best.district.id) === -1) selected.push(best.district.id);
          paint();
        },
      }, [
        el('span', { class: 'ma-target-label', text: 'Best target' }),
        el('strong', { class: 'ma-target-name', text: best.district.name }),
        el('span', {
          class: 'ma-target-note',
          text: best.need === 1
            ? 'One more seat for ' + money.words(best.district.grant) + ' a round'
            : best.need + ' more seats for ' + money.words(best.district.grant) + ' a round',
        }),
      ]);
    }

    /** One district: who leads, how it splits, and what taking it is worth. */
    function districtCard(row) {
      var d = row.district;
      var on = selected.indexOf(d.id) !== -1;
      var leaderParty = row.leader ? CMP.getParty(row.leader) : null;

      var ownerParty = row.owner ? CMP.getParty(row.owner) : null;
      var finished = row.held || row.lost;

      return el('div', {
        class: 'ma-district' + (on ? ' is-on' : '') + (row.held ? ' is-held' : '') +
          (row.lost ? ' is-lost' : ''),
      }, [
        el('div', { class: 'ma-d-top' }, [
          el('div', { class: 'ma-d-name-wrap' }, [
            el('strong', { class: 'ma-d-name', text: d.name }),
            el('span', {
              class: 'ma-d-seats',
              text: row.mine + ' / ' + d.seats.length + ' won',
            }),
          ]),
          // A district where every seat is decided has nothing left to spend
          // on, so it offers nothing to select.
          finished
            ? el('span', {
                class: 'ma-d-locked',
                text: row.held ? 'Controlled ✓' : ownerParty.short + ' ✓',
              })
            : el('button', {
                class: 'ma-d-select' + (on ? ' is-on' : ''),
                type: 'button',
                'aria-pressed': on ? 'true' : 'false',
                text: on ? 'Selected' : 'Select',
                onclick: function () {
                  toggle(d.id);
                },
              }),
        ]),

        // Who holds what, as a stacked bar. Four numbers in a row is a table;
        // one bar is a picture of the district.
        el('div', { class: 'ma-d-split' }, CMP.PLAYABLE_PARTIES.map(function (p) {
          var n = row.byParty[p.id] || 0;
          if (!n) return null;
          return el('span', {
            class: 'ma-d-slice',
            style: { width: (n / row.total) * 100 + '%', background: p.colour },
            title: p.short + ' ' + n,
          });
        })),

        el('div', { class: 'ma-d-parties' }, row.ranked.map(function (r) {
          var p = CMP.getParty(r.party);
          if (!p) return null;
          return el('span', {
            class: 'ma-d-party' + (r.party === game.partyId ? ' is-you' : ''),
            style: { '--party': p.colour },
            text: p.short + ' ' + r.seats,
          });
        })),

        /*
         * The objective, in one line.
         *
         * This is the whole point of the screen: a player should never have to
         * count seats to work out that one more here starts a grant.
         */
        el('p', {
          class: 'ma-d-goal' + (row.held ? ' is-held' : row.lost ? ' is-lost' :
            row.need <= 2 ? ' is-close' : ''),
          text: row.held
            ? (row.inherited
                ? 'Held from the start — pays nothing until you lose it and win it back'
                : 'Controlled ✓ · ' + money.words(d.grant) +
                  ' every round for the rest of the election')
            : row.lost
              ? ownerParty.short + ' has won every seat here. Nothing left to fight for.'
              : (row.need === 1
                  ? 'Win one more seat to unlock ' + money.words(d.grant) + ' a round'
                  : 'Win ' + row.need + ' more seats for ' + money.words(d.grant) +
                    ' a round') +
                (row.leading > row.mine
                  ? ' · leading ' + row.leading + ' of them already'
                  : ''),
        }),
      ]);
    }

    function paint() {
      if (!game) return;

      var rows = allDistricts();
      var body = [control(rows), header(rows)];

      var rec = recommendation(rows);
      if (rec) body.push(rec);

      /* ---- the three regions ---- */
      body.push(el('div', { class: 'ma-regions' }, CMP.REGIONS.map(function (region) {
        var inRegion = rows.filter(function (r) {
          return r.district.region === region.id;
        });
        var held = inRegion.filter(function (r) {
          return r.held;
        }).length;
        var seatsWon = inRegion.reduce(function (t, r) {
          return t + r.mine;
        }, 0);
        var seatsAll = inRegion.reduce(function (t, r) {
          return t + r.total;
        }, 0);
        var purse = CMP.campaign.grantIn(game, region.id);

        return el('button', {
          class: 'ma-region' + (openRegion === region.id ? ' is-open' : ''),
          type: 'button',
          onclick: function () {
            openRegion = openRegion === region.id ? null : region.id;
            paint();
          },
        }, [
          el('strong', { class: 'ma-region-name', text: region.name }),
          el('span', {
            class: 'ma-region-note',
            text: seatsWon + ' / ' + seatsAll + ' seats · ' + held + ' of ' +
              inRegion.length + ' districts',
          }),
          purse
            ? el('span', { class: 'ma-region-purse', text: money.words(purse) })
            : null,
        ]);
      })));

      /* ---- the open region's districts ---- */
      if (openRegion) {
        var region = CMP.getRegion(openRegion);
        var mine = rows.filter(function (r) {
          return r.district.region === openRegion;
        }).sort(function (a, b) {
          // Closest to control first: that is the order somebody deciding
          // where to spend actually wants to read.
          if (a.held !== b.held) return a.held ? 1 : -1;
          return a.need - b.need || b.district.grant - a.district.grant;
        });

        body.push(el('section', { class: 'ma-open' }, [
          el('h3', { class: 'g-block-title', text: region.name + ' · ' + region.blurb }),
          el('div', { class: 'ma-districts' }, mine.map(districtCard)),
        ]));
      }

      /* ---- opposition ---- */
      /*
       * Where a rival is about to lock a district away.
       *
       * Sorted by how close they are rather than by what it pays, because
       * once every seat is won the district is gone for good — a cheap
       * district about to close is more urgent than a dear one nobody is
       * near finishing.
       */
      var opposition = rows.filter(function (r) {
        if (r.held || r.lost) return false;
        if (!r.leader || r.leader === game.partyId) return false;
        var theirs = r.wonBy[r.leader] || 0;
        return r.total - theirs <= 3 || r.need <= 3;
      }).sort(function (a, b) {
        return (a.total - (a.wonBy[a.leader] || 0)) - (b.total - (b.wonBy[b.leader] || 0));
      }).slice(0, 4);

      if (opposition.length && !openRegion) {
        body.push(el('section', { class: 'ma-open' }, [
          el('h3', { class: 'g-block-title', text: 'Opposition areas' }),
          el('p', {
            class: 'g-block-note',
            text: 'Districts a rival is close to locking away for good.',
          }),
          el('div', { class: 'ma-districts' }, opposition.map(districtCard)),
        ]));
      }

      /* ---- the one action ---- */
      if (selected.length) {
        body.push(el('div', { class: 'ma-commit' }, [
          el('button', {
            class: 'btn btn-primary btn-wide',
            type: 'button',
            text: 'Campaign ' + seatsSelected() + ' seats',
            onclick: function () {
              var seats = [];
              selected.forEach(function (id) {
                var d = CMP.getDistrict(id);
                if (d) seats = seats.concat(d.seats);
              });
              CMP.ui.allocate.open({
                game: game,
                seats: seats,
                title: selected.length === 1
                  ? CMP.getDistrict(selected[0]).name
                  : selected.length + ' districts',
                onPlay: opts.onAllocate,
                onClose: function () {
                  selected = [];
                  paint();
                  if (opts.onChanged) opts.onChanged();
                },
              });
            },
          }),
          el('button', {
            class: 'btn btn-quiet btn-wide',
            type: 'button',
            text: 'Clear selection',
            onclick: function () {
              selected = [];
              paint();
            },
          }),
        ]));
      }

      mount(root, body);
    }

    function render(next) {
      game = next;
      paint();
    }

    return { root: root, render: render };
  }

  return { create: create };
})();
