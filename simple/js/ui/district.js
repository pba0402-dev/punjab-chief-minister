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

  return { create: create, POSITION: POSITION };
})();
