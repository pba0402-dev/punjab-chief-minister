/**
 * One seat, over the board.
 * ------------------------------------------------------------------
 * Tap a constituency and this opens on top of the map rather than instead of
 * it. That is the whole point of the screen: the answer to "should I spend
 * here" depends on what is around it, and a panel that hides the board makes
 * the player carry the surroundings in their head.
 *
 * It answers four questions in the order they are asked, and stops:
 *
 *   which seat is this, and what is it worth
 *   who is in it, and where do they stand
 *   what have they put in
 *   what can I put in, and what would that leave me
 *
 * Everything else a seat has — the round-by-round history, the ratings, the
 * changed-hands note — stays on the full seat screen. This is the decision,
 * not the file.
 *
 * The money is the game's own. Every figure comes from CMP.campaign against
 * the live game object, and spending goes through the same play() the rest of
 * the game uses, so the entry cap, the region purse, the won-seat lock and
 * the server's authority in a multiplayer game all still apply. Nothing here
 * decides anything for itself.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.district = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  /* The words the map and the panel both use, so they never disagree. */
  var POSITION = {
    won: { label: 'Won', cls: 'is-won' },
    lost: { label: 'Lost', cls: 'is-lost' },
    leading: { label: 'Leading', cls: 'is-leading' },
    contested: { label: 'Contested', cls: 'is-contested' },
    trailing: { label: 'Trailing', cls: 'is-trailing' },
    none: { label: 'No bid', cls: 'is-none' },
  };

  function seatDef(number) {
    var all = CMP.CONSTITUENCIES || [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].number === Number(number)) return all[i];
    }
    return null;
  }

  function candidateFor(partyId, players) {
    var list = players || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].partyId === partyId) return list[i];
    }
    return null;
  }

  /**
   * The amounts offered, bounded by what is actually possible.
   *
   * Three things can cap a spend and all three are the engine's: the minimum
   * a move costs, the ceiling on a first entry into a seat nobody holds, and
   * what the campaign can actually reach for this seat. Offering an amount
   * that would be refused is worse than offering fewer amounts.
   */
  function amountsFor(game, seat) {
    var cfg = (CMP.CAMPAIGN || {}).spending || {};
    var pot = CMP.campaign.spendableOn(game, seat);
    var cap = CMP.campaign.entryCap(game, Number(seat), null);
    var ceiling = cap > 0 ? Math.min(cap, pot.total) : pot.total;
    var min = cfg.minAmount || 0;

    var quick = (cfg.quickAmounts || []).filter(function (n) {
      return n >= min && n <= ceiling;
    });
    // The most that can go in, when that is not already one of the offers.
    if (ceiling >= min && quick.indexOf(ceiling) === -1) quick.push(ceiling);

    return {
      pot: pot,
      cap: cap,
      min: min,
      max: ceiling,
      quick: quick.sort(function (a, b) { return a - b; }),
      canAfford: ceiling >= min,
    };
  }

  /**
   * Open the panel for a seat.
   *
   * Returns a controller rather than a node, because the shell keeps one
   * panel and points it at a different seat when another is tapped — which is
   * what makes tapping around the map feel like reading a board rather than
   * opening and closing windows.
   */
  function create(opts) {
    opts = opts || {};
    var root = el('div', { class: 'dp' });
    var game = null;
    var seat = null;
    var spendOpen = false;
    var amount = 0;
    var busy = false;
    var note = null;

    function close() {
      if (opts.onClose) opts.onClose();
    }

    /* ------------------------------------------------------- the header */

    function head(def, status) {
      var party = status.partyId ? CMP.getParty(status.partyId) : null;
      var stateWord = status.state === 'won' ? 'Won'
        : status.state === 'open' ? 'Open'
        : status.state === 'leading' ? 'Leading'
        : 'Contested';

      return el('header', { class: 'dp-head' }, [
        el('div', { class: 'dp-titles' }, [
          el('h2', { class: 'dp-name', text: def.name }),
          el('p', { class: 'dp-where', text: 'AC ' + def.number + ' · ' + def.district }),
        ]),
        el('button', {
          class: 'dp-close',
          type: 'button',
          'aria-label': 'Close',
          text: '✕',
          onclick: close,
        }),

        el('div', { class: 'dp-state dp-state-' + status.state }, [
          el('span', { class: 'dp-state-word', text: stateWord }),
          party
            ? el('span', {
                class: 'dp-state-who',
                style: { '--party': party.colour },
              }, [
                el('span', { class: 'dp-state-dot', 'aria-hidden': 'true' }),
                party.short + ' · ' + status.share.toFixed(1) + '%',
              ])
            : el('span', { class: 'dp-state-who is-quiet', text: 'Nobody has campaigned here' }),
        ]),
      ]);
    }

    /* -------------------------------------------------- who is in the seat */

    /**
     * One row per party: in or out, what they put in, where they stand.
     *
     * The tick and the ring carry the answer on their own, so the row reads
     * at a glance without being read. A rupee figure this client is not
     * entitled to shows as a dash rather than a guess — see seatBids.
     */
    function field(players) {
      var rows = CMP.campaign.seatBids(game, seat);
      var anySpendHidden = false;

      var list = el('div', { class: 'dp-field' }, rows.map(function (row) {
        var party = CMP.getParty(row.partyId);
        var who = candidateFor(row.partyId, players);
        var pos = POSITION[row.position] || POSITION.none;
        if (!row.spendKnown) anySpendHidden = true;

        return el('div', {
          class: 'dp-row ' + pos.cls + (row.isYou ? ' is-you' : ''),
          style: { '--party': party.colour },
        }, [
          el('span', {
            class: 'dp-mark',
            'aria-hidden': 'true',
            text: row.entered ? '✓' : '○',
          }),
          el('span', { class: 'dp-who' }, [
            el('strong', { class: 'dp-party', text: party.short }),
            el('span', {
              class: 'dp-name-small',
              text: row.isYou ? 'You' : (who ? who.candidateName : party.name),
            }),
          ]),
          el('span', {
            class: 'dp-spend',
            text: !row.entered ? '—'
              : row.spendKnown
                ? (row.spent > 0 ? money.words(row.spent) : 'no spend')
                : '—',
          }),
          el('span', { class: 'dp-pos', text: pos.label }),
        ]);
      }));

      return el('section', { class: 'dp-block' }, [
        el('div', { class: 'dp-block-head' }, [
          el('h3', { class: 'dp-block-title', text: 'In this seat' }),
          /*
           * The rupee column is this round only, and it has to say so: a
           * party leading on 100% with "no spend" beside it reads as a
           * contradiction until you know what the column measures.
           */
          el('span', { class: 'dp-block-note', text: 'Spend this round' }),
        ]),
        list,
        /*
         * Said once, at the foot, rather than four times in the rows.
         *
         * In a game with other people in it the server does not send anybody
         * else's spending, and it should not: what a rival has put where is
         * theirs. Saying so is better than a dash that looks like a bug.
         */
        anySpendHidden
          ? el('p', {
              class: 'dp-note',
              text: 'What the other campaigns have spent here is their own. ' +
                'Where they stand is on the board above.',
            })
          : null,
      ]);
    }

    /* --------------------------------------------------------- the money */

    /**
     * What the grants look like here, as opposed to what is in the purse.
     *
     * Kept apart from the money above it on purpose: available cash is a
     * balance and grant potential is a judgement about opportunity, and a
     * player who confused the two would spend against a number that was never
     * money. It reads js/data/grants-config.js and nothing else, because the
     * grant rules are going to be replaced and this panel should not have to
     * be rebuilt when they are.
     */
    function grantBlock() {
      var region = CMP.regionOfSeat ? CMP.regionOfSeat(Number(seat)) : null;
      if (!region) return null;

      var value = CMP.grantPotential(CMP.grantContextFor(game, region, game.avatar));
      var band = CMP.grantBand(value);
      var held = CMP.campaign.grantIn ? CMP.campaign.grantIn(game, region) : 0;
      var name = (CMP.getRegion && CMP.getRegion(region) || {}).name || region;

      return el('section', { class: 'dp-block' }, [
        el('div', { class: 'dp-block-head' }, [
          el('h3', { class: 'dp-block-title', text: 'Grant' }),
          el('span', { class: 'dp-block-note', text: name }),
        ]),
        el('div', { class: 'dp-grant' }, [
          el('div', { class: 'dp-grant-fig' }, [
            el('span', { class: 'dp-grant-label', text: 'Potential here' }),
            el('strong', {
              class: 'dp-grant-value is-' + band.id,
              text: band.label + ' · ' + value + '%',
            }),
          ]),
          el('div', { class: 'dp-grant-fig' }, [
            el('span', { class: 'dp-grant-label', text: 'Grant in hand' }),
            el('strong', {
              class: 'dp-grant-value',
              text: held > 0 ? money.words(held) : '₹0',
            }),
          ]),
        ]),
        el('p', {
          class: 'dp-note',
          text: 'Potential is an opportunity, not money. Grant in hand is ' +
            'real and can only be spent in ' + name + '.',
        }),
      ]);
    }

    function purse(a) {
      return el('div', { class: 'dp-purse' }, [
        el('div', { class: 'dp-purse-fig' }, [
          el('span', { class: 'dp-purse-label', text: 'Available here' }),
          el('strong', { class: 'dp-purse-value', text: money.words(a.pot.total) || '₹0' }),
        ]),
        a.pot.grant > 0
          ? el('div', { class: 'dp-purse-fig' }, [
              el('span', { class: 'dp-purse-label', text: 'Of that, grant' }),
              el('strong', {
                class: 'dp-purse-value is-grant',
                text: money.words(a.pot.grant),
              }),
            ])
          : null,
      ]);
    }

    /**
     * The amount, and what it would leave.
     *
     * Three figures and one button. The stepper is the quick amounts rather
     * than a free slider, because the engine has a minimum and a cap and a
     * list of sensible steps already — a slider would mostly be offering
     * numbers that round to one of these.
     */
    function spendPanel(a) {
      if (!(a.cap > 0)) return null;

      return el('section', { class: 'dp-block dp-spend-block' }, [
        a.cap > 0
          ? el('p', {
              class: 'dp-note',
              text: 'First entry into a seat nobody holds is capped at ' +
                money.words(a.cap) + ', for everyone equally.',
            })
          : null,
      ]);
    }

    function tallyFig(label, value, cls) {
      return el('div', { class: 'dp-tally-fig ' + (cls || '') }, [
        el('span', { class: 'dp-tally-label', text: label }),
        el('strong', { class: 'dp-tally-value', text: value }),
      ]);
    }

    function sumLine(label, value, cls) {
      return el('div', { class: 'dp-sum ' + (cls || '') }, [
        el('span', { class: 'dp-sum-label', text: label }),
        el('strong', { class: 'dp-sum-value', text: value }),
      ]);
    }

    /**
     * Spend it, through the game's own play().
     *
     * Nothing is deducted here and no outcome is decided here. The engine
     * charges the region purse first, applies the entry cap, refuses a won
     * seat, and in a multiplayer game the server does all of it instead —
     * this only asks, and repaints with whatever came back.
     */
    function spend(a) {
      if (busy || !opts.play) return;
      if (amount < a.min || amount > a.max) return;

      busy = true;
      note = null;
      paint();

      Promise.resolve(opts.play(seat, amount)).then(function (res) {
        busy = false;
        if (!res || !res.ok) {
          note = { tone: 'bad', text: (res && res.reason) || 'That could not be played.' };
        } else {
          note = { tone: 'good', text: money.words(amount) + ' spent here.' };
          spendOpen = false;
          amount = 0;
          if (CMP.audio) CMP.audio.play('spend');
        }
        paint();
      }).catch(function () {
        busy = false;
        note = { tone: 'bad', text: 'That could not be played.' };
        paint();
      });
    }

    /* ----------------------------------------------------------- the foot */

    /**
     * Why this seat cannot be spent in, when it cannot.
     *
     * Scrolls with the rest, because it is something to read rather than
     * something to press.
     */
    function blocked(status, a) {
      if (status.state === 'won') {
        var winner = CMP.getParty(status.partyId);
        return el('div', { class: 'dp-foot is-locked' }, [
          el('p', { class: 'dp-locked' }, [
            el('strong', { text: winner.short + ' has won this seat.' }),
            ' Nobody can campaign here again, including them.',
          ]),
        ]);
      }
      if (!opts.canSpend || !opts.canSpend()) {
        return el('div', { class: 'dp-foot' }, [
          el('p', { class: 'dp-note', text: 'The round is closed. Wait for the next one.' }),
        ]);
      }
      if (!a.canAfford) {
        return el('div', { class: 'dp-foot' }, [
          purse(a),
          el('p', {
            class: 'dp-note is-bad',
            text: 'You need at least ' + money.words(a.min) +
              ' to campaign here, and you have ' + (money.words(a.pot.total) || '₹0') + '.',
          }),
        ]);
      }
      return null;
    }

    /**
     * The money, pinned to the bottom of the panel.
     *
     * A phone has room for about two thirds of this seat, and what fell off
     * the end was the button. The field above scrolls; what the player came to
     * press does not move, which is the one thing about this panel that has to
     * be true on a small screen.
     */
    function actions(status, a) {
      if (blocked(status, a)) return null;

      var after = Math.max(0, a.pot.total - amount);

      return el('div', { class: 'dp-actions' }, [
        /*
         * Available, this spend, remaining - beside the button rather than
         * above the scroll, because the arithmetic is the decision and it has
         * to be readable at the moment the button is pressed.
         */
        /*
         * The chips, the arithmetic and the button are one decision, so they
         * are one block that does not move. What scrolls above them is the
         * evidence: who is in the seat and what the cap is.
         */
        spendOpen
          ? el('div', { class: 'dp-amounts' }, a.quick.map(function (n) {
              return el('button', {
                class: 'dp-amount' + (n === amount ? ' is-on' : ''),
                type: 'button',
                disabled: busy,
                onclick: function () {
                  amount = n;
                  if (CMP.audio) CMP.audio.play('tap');
                  paint();
                },
              }, [money.words(n)]);
            }))
          : null,
        spendOpen
          ? el('div', { class: 'dp-tally' }, [
              tallyFig('Available', money.words(a.pot.total) || '₹0'),
              tallyFig('This spend', money.words(amount) || '₹0', 'is-spend'),
              tallyFig('Remaining', money.words(after) || '₹0', 'is-after'),
            ])
          : purse(a),
        el('button', {
          class: 'btn ' + (spendOpen ? 'btn-quiet' : 'btn-primary') + ' btn-wide',
          type: 'button',
          text: spendOpen ? 'Not now' : 'Spend money here',
          onclick: function () {
            spendOpen = !spendOpen;
            if (spendOpen && !amount) amount = a.quick[0] || a.min;
            if (CMP.audio) CMP.audio.play('tap');
            paint();
          },
        }),
        spendOpen
          ? el('button', {
              class: 'btn btn-primary btn-wide dp-go',
              type: 'button',
              disabled: busy || amount < a.min || amount > a.max,
              text: busy ? 'Spending…' : 'Spend ' + (money.words(amount) || '₹0'),
              onclick: function () {
                spend(a);
              },
            })
          : null,
      ]);
    }

    /*
     * The way through to the full seat screen.
     *
     * Outside foot(), because it is not part of the spend decision: a settled
     * seat and a closed round both end that decision early, and neither is a
     * reason to stop somebody reading the seat's history.
     */
    function more() {
      if (!opts.onFull) return null;
      return el('button', {
        class: 'dp-more',
        type: 'button',
        text: 'Full seat detail',
        onclick: function () {
          opts.onFull(seat);
        },
      });
    }

    /* ------------------------------------------------------------- paint */

    function paint() {
      if (!game || seat === null) {
        mount(root, []);
        return;
      }
      var def = seatDef(seat);
      if (!def) {
        mount(root, [el('p', { class: 'dp-note', text: 'Unknown constituency.' })]);
        return;
      }

      var status = CMP.campaign.seatStatus(game, seat);
      var a = amountsFor(game, seat);

      mount(root, [
        head(def, status),
        el('div', { class: 'dp-body' }, [
          field(opts.players ? opts.players() : []),
          note
            ? el('p', { class: 'dp-flash is-' + note.tone, text: note.text })
            : null,
          grantBlock(),
          spendOpen ? spendPanel(a) : null,
          blocked(status, a),
          more(),
        ]),
        actions(status, a),
      ]);
    }

    /** Point the panel at a seat. The same panel, a different seat. */
    function show(nextGame, number) {
      var changed = Number(number) !== seat;
      game = nextGame;
      seat = Number(number);
      if (changed) {
        spendOpen = false;
        amount = 0;
        note = null;
      }
      paint();
    }

    /** Repaint against a game that moved under us, keeping the seat. */
    function update(nextGame) {
      if (seat === null) return;
      game = nextGame;
      paint();
    }

    return {
      root: root,
      show: show,
      update: update,
      seat: function () {
        return seat;
      },
    };
  }

  /* ==================================================================
     A district, over the board.

     The map's playing areas are districts: tap one and this opens on top of
     it. What a district actually is, in this game, is a group of
     constituencies that pays a grant every round to whoever leads all of
     them — so the panel answers the two questions that follow from that: who
     is ahead across the whole of it, and what would it cost to change that.

     Spending here goes through the same bulk allocation the areas screen
     uses, which plays each seat in the district with the game's own dice. No
     calculation is done in this file; it asks and repaints.
     ================================================================== */

  function createArea(opts) {
    opts = opts || {};
    var root = el('div', { class: 'dp dp-area' });
    var game = null;
    var districtId = null;
    var spendOpen = false;
    var amount = 0;
    var busy = false;
    var note = null;

    function def() {
      return CMP.getDistrict ? CMP.getDistrict(districtId) : null;
    }

    function close() {
      if (opts.onClose) opts.onClose();
    }

    /**
     * How the district stands, counted from the board.
     *
     * A district is not a seat, so it has no single leader — it has whoever
     * leads the most of it. Won seats and led seats are counted apart,
     * because one is finished and the other is today's picture.
     */
    function standing() {
      var d = def();
      if (!d) return null;
      var won = game.wonSeats || {};
      var rows = {};

      function row(id) {
        if (!rows[id]) rows[id] = { partyId: id, won: 0, leading: 0, spent: 0, known: true };
        return rows[id];
      }

      d.seats.forEach(function (n) {
        var w = won[String(n)];
        if (w) {
          row(w.party).won += 1;
          return;
        }
        var lead = CMP.ui.constituency.leaderOf(game.support[n] || {});
        if (lead) row(lead.partyId).leading += 1;
      });

      // What each campaign has put into this district this round, where this
      // client is entitled to know — see seatBids.
      d.seats.forEach(function (n) {
        CMP.campaign.seatBids(game, n).forEach(function (b) {
          var r = row(b.partyId);
          if (!b.spendKnown) r.known = false;
          else r.spent += b.spent || 0;
        });
      });

      var list = CMP.getParties().map(function (party) {
        var r = rows[party.id] || { partyId: party.id, won: 0, leading: 0, spent: 0, known: true };
        r.total = r.won + r.leading;
        return r;
      }).sort(function (a, b) {
        return b.total - a.total || b.won - a.won;
      });

      var top = list[0] && list[0].total > 0 ? list[0] : null;
      var settled = list.reduce(function (n, r) { return n + r.won; }, 0);

      return {
        district: d,
        rows: list,
        top: top,
        settled: settled,
        seats: d.seats.length,
        /*
         * A district pays its grant to whoever leads every seat in it.
         *
         * Leading, not winning outright — see districtsHeldBy in the engine,
         * which reads the support board. The panel said "win all 11" until
         * this was checked against the rule, which would have had a player
         * chasing a harder condition than the one that actually pays.
         */
        held: top && top.total >= d.seats.length ? top.partyId : null,
      };
    }

    /** The seats in this district anybody may still campaign in. */
    function openSeats() {
      var d = def();
      if (!d) return [];
      return d.seats.filter(function (n) {
        return !CMP.campaign.isWon(game, n);
      });
    }

    /**
     * What can go in, bounded by what the engine will accept.
     *
     * A district spend is one sum spread across its open seats, so the floor
     * is the minimum move times the number of seats it would be spread over —
     * anything less would be refused seat by seat.
     */
    function amountsFor() {
      var cfg = (CMP.CAMPAIGN || {}).spending || {};
      var seats = openSeats();
      var pot = seats.length
        ? CMP.campaign.spendableOn(game, seats[0])
        : { total: 0, grant: 0, cash: 0, region: null };
      var min = (cfg.minAmount || 0) * Math.max(1, seats.length);
      var max = pot.total;

      var steps = [];
      for (var i = 1; i <= 4; i++) {
        var n = min * i;
        if (n <= max) steps.push(n);
      }
      if (max >= min && steps.indexOf(max) === -1) steps.push(max);

      return {
        pot: pot,
        seats: seats,
        min: min,
        max: max,
        quick: steps,
        canAfford: max >= min && seats.length > 0,
      };
    }

    function head(st) {
      var d = st.district;
      var party = st.top ? CMP.getParty(st.top.partyId) : null;
      var word = st.held ? 'Held' : st.top ? 'Leading' : 'Open';

      return el('header', { class: 'dp-head' }, [
        el('div', { class: 'dp-titles' }, [
          el('h2', { class: 'dp-name', text: d.name }),
          el('p', {
            class: 'dp-where',
            text: st.seats + (st.seats === 1 ? ' seat' : ' seats') + ' · ' +
              ((CMP.getRegion && CMP.getRegion(d.region) || {}).name || d.region),
          }),
        ]),
        el('button', {
          class: 'dp-close',
          type: 'button',
          'aria-label': 'Close',
          text: '✕',
          onclick: close,
        }),
        el('div', { class: 'dp-state dp-state-' + word.toLowerCase() }, [
          el('span', { class: 'dp-state-word', text: word }),
          party
            ? el('span', {
                class: 'dp-state-who',
                style: { '--party': party.colour },
              }, [
                el('span', { class: 'dp-state-dot', 'aria-hidden': 'true' }),
                party.short + ' · ' + st.top.total + ' of ' + st.seats,
              ])
            : el('span', { class: 'dp-state-who is-quiet', text: 'Nobody has campaigned here' }),
        ]),
      ]);
    }

    function field(st, players) {
      var anyHidden = false;
      var list = el('div', { class: 'dp-field' }, st.rows.map(function (r) {
        var party = CMP.getParty(r.partyId);
        var isYou = r.partyId === game.partyId;
        if (!r.known) anyHidden = true;

        var pos = r.total <= 0 ? POSITION.none
          : r.won >= st.seats ? POSITION.won
          : st.top && st.top.partyId === r.partyId ? POSITION.leading
          : POSITION.trailing;

        return el('div', {
          class: 'dp-row ' + pos.cls + (isYou ? ' is-you' : ''),
          style: { '--party': party.colour },
        }, [
          el('span', {
            class: 'dp-mark',
            'aria-hidden': 'true',
            text: r.total > 0 ? '✓' : '○',
          }),
          el('span', { class: 'dp-who' }, [
            el('strong', { class: 'dp-party', text: party.short }),
            el('span', {
              class: 'dp-name-small',
              text: isYou ? 'You' : (candidateFor(r.partyId, players) || {}).candidateName ||
                party.name,
            }),
          ]),
          el('span', {
            class: 'dp-seats-held',
            text: r.total + (r.won ? ' (✓' + r.won + ')' : ''),
          }),
          el('span', { class: 'dp-pos', text: pos.label }),
        ]);
      }));

      return el('section', { class: 'dp-block' }, [
        el('div', { class: 'dp-block-head' }, [
          el('h3', { class: 'dp-block-title', text: 'Across the district' }),
          el('span', { class: 'dp-block-note', text: 'Seats held' }),
        ]),
        list,
        anyHidden
          ? el('p', {
              class: 'dp-note',
              text: 'What the other campaigns have spent here is their own.',
            })
          : null,
      ]);
    }

    /**
     * The grant, and the money — kept apart, and both said plainly.
     *
     * A district pays its grant only to a campaign that leads every seat in
     * it, which is the fact that makes a district worth taking rather than a
     * seat. The purse beside it is what is actually available to spend here.
     */
    function moneyBlock(st, a) {
      var region = st.district.region;
      var name = (CMP.getRegion && CMP.getRegion(region) || {}).name || region;
      var held = CMP.campaign.grantIn ? CMP.campaign.grantIn(game, region) : 0;
      var mine = st.rows.filter(function (r) {
        return r.partyId === game.partyId;
      })[0] || { won: 0, total: 0 };
      var toTake = Math.max(0, st.seats - mine.total);

      return el('section', { class: 'dp-block' }, [
        el('div', { class: 'dp-grant' }, [
          el('div', { class: 'dp-grant-fig' }, [
            el('span', { class: 'dp-grant-label', text: 'Your money here' }),
            el('strong', {
              class: 'dp-grant-value',
              text: money.words(a.pot.total) || '₹0',
            }),
          ]),
          el('div', { class: 'dp-grant-fig' }, [
            el('span', { class: 'dp-grant-label', text: name + ' grant' }),
            el('strong', {
              class: 'dp-grant-value is-medium',
              text: held > 0 ? money.words(held) : '₹0',
            }),
          ]),
        ]),
        el('p', {
          class: 'dp-note',
          text: st.held === game.partyId
            ? 'You hold this district outright, so it pays you every round.'
            : toTake === 0
              ? 'Nothing left to take here.'
              : 'Lead all ' + st.seats + ' seats and this district pays a grant ' +
                'every round. ' + toTake + (toTake === 1 ? ' to go.' : ' to go.'),
        }),
      ]);
    }

    function spendPanel(a) {
      var after = Math.max(0, a.pot.total - amount);
      return el('div', { class: 'dp-actions' }, [
        el('div', { class: 'dp-amounts' }, a.quick.map(function (n) {
          return el('button', {
            class: 'dp-amount' + (n === amount ? ' is-on' : ''),
            type: 'button',
            disabled: busy,
            onclick: function () {
              amount = n;
              if (CMP.audio) CMP.audio.play('tap');
              paint();
            },
          }, [money.words(n)]);
        })),
        el('div', { class: 'dp-tally' }, [
          tallyFig('Available', money.words(a.pot.total) || '₹0'),
          tallyFig('This spend', money.words(amount) || '₹0', 'is-spend'),
          tallyFig('Remaining', money.words(after) || '₹0', 'is-after'),
        ]),
        el('button', {
          class: 'btn btn-quiet btn-wide',
          type: 'button',
          text: 'Not now',
          onclick: function () {
            spendOpen = false;
            paint();
          },
        }),
        el('button', {
          class: 'btn btn-primary btn-wide dp-go',
          type: 'button',
          disabled: busy || amount < a.min || amount > a.max,
          text: busy ? 'Spending…' : 'Spend ' + (money.words(amount) || '₹0'),
          onclick: function () {
            spend(a);
          },
        }),
      ]);
    }

    function tallyFig(label, value, cls) {
      return el('div', { class: 'dp-tally-fig ' + (cls || '') }, [
        el('span', { class: 'dp-tally-label', text: label }),
        el('strong', { class: 'dp-tally-value', text: value }),
      ]);
    }

    /**
     * Spend it across the district, through the game's own allocation.
     *
     * One sum spread over the seats that are still open, played with the same
     * dice as playing each of them by hand. Nothing is decided here.
     */
    function spend(a) {
      if (busy || !opts.allocate) return;
      if (amount < a.min || amount > a.max) return;

      busy = true;
      note = null;
      paint();

      Promise.resolve(opts.allocate(a.seats, amount)).then(function (res) {
        busy = false;
        if (!res || !res.ok) {
          note = { tone: 'bad', text: (res && res.reason) || 'That could not be played.' };
        } else {
          note = {
            tone: 'good',
            text: money.words(res.spent || amount) + ' across ' +
              (res.seats || a.seats.length) + ' seats.',
          };
          spendOpen = false;
          amount = 0;
          if (CMP.audio) CMP.audio.play('spend');
        }
        paint();
      }).catch(function () {
        busy = false;
        note = { tone: 'bad', text: 'That could not be played.' };
        paint();
      });
    }

    function actions(st, a) {
      if (!opts.canSpend || !opts.canSpend()) {
        return el('div', { class: 'dp-actions' }, [
          el('p', { class: 'dp-note', text: 'The round is closed. Wait for the next one.' }),
        ]);
      }
      if (!a.seats.length) {
        return el('div', { class: 'dp-actions' }, [
          el('p', { class: 'dp-note', text: 'Every seat here is settled.' }),
        ]);
      }
      if (!a.canAfford) {
        return el('div', { class: 'dp-actions' }, [
          el('p', {
            class: 'dp-note is-bad',
            text: 'Campaigning across ' + a.seats.length + ' seats needs at least ' +
              money.words(a.min) + ', and you have ' + (money.words(a.pot.total) || '₹0') + '.',
          }),
        ]);
      }
      if (spendOpen) return spendPanel(a);

      return el('div', { class: 'dp-actions' }, [
        el('div', { class: 'dp-purse' }, [
          el('div', { class: 'dp-purse-fig' }, [
            el('span', { class: 'dp-purse-label', text: 'Available here' }),
            el('strong', {
              class: 'dp-purse-value',
              text: money.words(a.pot.total) || '₹0',
            }),
          ]),
        ]),
        el('button', {
          class: 'btn btn-primary btn-wide',
          type: 'button',
          text: 'Campaign across ' + a.seats.length +
            (a.seats.length === 1 ? ' seat' : ' seats'),
          onclick: function () {
            spendOpen = true;
            if (!amount) amount = a.quick[0] || a.min;
            if (CMP.audio) CMP.audio.play('tap');
            paint();
          },
        }),
      ]);
    }

    /**
     * The seats themselves, for when the district is not the right unit.
     *
     * A district spend spreads evenly; taking one particular seat off
     * somebody is a different move, and this is the way to it.
     */
    function seatList(st) {
      if (!opts.onSeat) return null;
      return el('section', { class: 'dp-block' }, [
        el('h3', { class: 'dp-block-title', text: 'Seats' }),
        el('div', { class: 'dp-seats' }, st.district.seats.map(function (n) {
          var status = CMP.campaign.seatStatus(game, n);
          var party = status.partyId ? CMP.getParty(status.partyId) : null;
          var seat = seatDef(n);
          return el('button', {
            class: 'dp-seat is-' + status.state,
            type: 'button',
            dataset: { seat: String(n) },
            style: party ? { '--party': party.colour } : null,
            onclick: function () {
              opts.onSeat(n);
            },
          }, [
            el('span', { class: 'dp-seat-name', text: seat ? seat.name : 'AC ' + n }),
            el('span', {
              class: 'dp-seat-who',
              text: party ? party.short : 'open',
            }),
          ]);
        })),
      ]);
    }

    function paint() {
      if (!game || !districtId) {
        mount(root, []);
        return;
      }
      var st = standing();
      if (!st) {
        mount(root, [el('p', { class: 'dp-note', text: 'Unknown district.' })]);
        return;
      }
      var a = amountsFor();

      mount(root, [
        head(st),
        el('div', { class: 'dp-body' }, [
          field(st, opts.players ? opts.players() : []),
          moneyBlock(st, a),
          note ? el('p', { class: 'dp-flash is-' + note.tone, text: note.text }) : null,
          seatList(st),
        ]),
        actions(st, a),
      ]);
    }

    function show(nextGame, id) {
      var changed = id !== districtId;
      game = nextGame;
      districtId = id;
      if (changed) {
        spendOpen = false;
        amount = 0;
        note = null;
      }
      paint();
    }

    function update(nextGame) {
      if (!districtId) return;
      game = nextGame;
      paint();
    }

    return {
      root: root,
      show: show,
      update: update,
      district: function () {
        return districtId;
      },
    };
  }

  return { create: create, createArea: createArea, POSITION: POSITION };
})();
