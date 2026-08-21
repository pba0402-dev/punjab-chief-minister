/**
 * The round clock, the projection, the bank, and the two dialogs.
 * ------------------------------------------------------------------
 * Everything that belongs to the fifteen-round structure rather than to any
 * one campaign action.
 *
 * The clock deserves a note. In multiplayer the deadline belongs to the
 * server, and the client is told how many seconds are left on every poll. We
 * turn that into a local deadline (now + secondsLeft) and count down from it
 * between polls, rather than reading the server's own timestamp as an absolute
 * — that way a player whose computer clock is wrong still sees the same
 * countdown as everybody else, and a refresh picks up mid-round correctly.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

/* ------------------------------------------------------------- dialogs */

CMP.ui.dialog = (function () {
  'use strict';

  var el = CMP.ui.dom.el;

  /**
   * A modal that resolves true or false. Used to confirm anything that
   * spends money or takes on debt, so no irreversible move is one stray
   * click away.
   */
  function confirm(spec) {
    return new Promise(function (resolve) {
      var settled = false;

      function close(answer) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(answer);
      }

      function onKey(e) {
        if (e.key === 'Escape') close(false);
      }

      var confirmBtn = el('button', {
        class: 'btn ' + (spec.danger ? 'btn-danger' : 'btn-primary'),
        type: 'button',
        text: spec.confirmLabel || 'Confirm',
        onclick: function () {
          close(true);
        },
      });

      var overlay = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' }, [
        el('div', { class: 'dialog' + (spec.danger ? ' dialog-danger' : '') }, [
          spec.eyebrow ? el('span', { class: 'dialog-eyebrow', text: spec.eyebrow }) : null,
          el('h2', { class: 'dialog-title', text: spec.title }),
          spec.body ? el('p', { class: 'dialog-body', text: spec.body }) : null,
          spec.lines && spec.lines.length
            ? el(
                'dl',
                { class: 'dialog-lines' },
                spec.lines.map(function (line) {
                  return el('div', { class: 'dialog-line' + (line.strong ? ' is-strong' : '') }, [
                    el('dt', { text: line.label }),
                    el('dd', { text: line.value }),
                  ]);
                })
              )
            : null,
          spec.note ? el('p', { class: 'dialog-note', text: spec.note }) : null,
          el('div', { class: 'dialog-buttons' }, [
            el('button', {
              class: 'btn btn-quiet',
              type: 'button',
              text: spec.cancelLabel || 'Cancel',
              onclick: function () {
                close(false);
              },
            }),
            confirmBtn,
          ]),
        ]),
      ]);

      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close(false);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(overlay);
      confirmBtn.focus();
    });
  }

  return { confirm: confirm };
})();

/* --------------------------------------------------------- round clock */

CMP.ui.round = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var svg = CMP.ui.dom.svg;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  /**
   * The round strip: which round, how long is left, and how far through the
   * campaign we are.
   */
  function create(opts) {
    opts = opts || {};
    var game = null;
    var deadline = 0;      // local ms, derived from the server's seconds left
    var timer = null;
    var lastRound = 0;

    var labelNode = el('span', { class: 'round-label' });
    var movesNode = el('span', { class: 'round-moves' });
    var clockNode = el('span', { class: 'round-clock', text: '--:--' });
    var stepsNode = el('div', { class: 'round-steps' });
    var readyNode = el('div', { class: 'round-ready' });

    /*
     * The clock is a ring that drains, not a bar that shrinks.
     *
     * A full circle at the start, gone at zero. It sits in the corner at about
     * the size of a coin, which is as much room as a countdown deserves on a
     * phone — the board is what people came to look at.
     *
     * Drawn with a dash pattern on a stroked circle: no path arithmetic, and
     * the arc is exact at any size.
     */
    var RING_R = 42;
    var RING_C = 2 * Math.PI * RING_R;

    var ringArc = svg('circle', {
      class: 'rt-arc',
      cx: '50', cy: '50', r: String(RING_R),
      fill: 'none', 'stroke-width': '9', 'stroke-linecap': 'round',
      'stroke-dasharray': RING_C + ' ' + RING_C,
    });

    var ringNode = el('div', { class: 'round-timer' }, [
      svg('svg', { class: 'rt-ring', viewBox: '0 0 100 100', 'aria-hidden': 'true' }, [
        svg('circle', {
          class: 'rt-track',
          cx: '50', cy: '50', r: String(RING_R),
          fill: 'none', 'stroke-width': '9',
        }),
        ringArc,
      ]),
      el('div', { class: 'rt-face' }, [clockNode]),
    ]);

    var root = el('div', { class: 'round-bar' }, [
      el('div', { class: 'round-bar-main' }, [
        ringNode,
        el('div', { class: 'round-bar-text' }, [labelNode, movesNode, readyNode]),
      ]),
      stepsNode,
    ]);

    function secondsLeft() {
      return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    }

    function paintClock() {
      // During the results break the clock is not counting anything down for
      // the player to act on, so it says what is happening instead of showing
      // a frozen 0:00 they might read as a bug.
      if (game && game.stage === 'results') {
        clockNode.textContent = '···';
        clockNode.classList.remove('is-low', 'is-out');
        clockNode.classList.add('is-counting');
        ringArc.setAttribute('stroke-dasharray', RING_C + ' ' + RING_C);
        ringNode.classList.add('is-counting');
        return;
      }
      clockNode.classList.remove('is-counting');
      ringNode.classList.remove('is-counting');

      var left = secondsLeft();
      var total = (game && game.roundSeconds) || CMP.ROUNDS.seconds;
      var mins = Math.floor(left / 60);
      var secs = left % 60;
      clockNode.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;

      // The last ten seconds are worth noticing without being shouted at.
      var low = left <= 10 && left > 0;
      clockNode.classList.toggle('is-low', low);
      clockNode.classList.toggle('is-out', left === 0);
      ringNode.classList.toggle('is-low', low);
      ringNode.classList.toggle('is-out', left === 0);

      var shown = Math.max(0, Math.min(1, left / total));
      ringArc.setAttribute('stroke-dasharray', (RING_C * shown) + ' ' + RING_C);

      if (left === 0 && opts.onExpired) opts.onExpired();
    }

    function paintSteps() {
      var total = (game && game.roundsTotal) || CMP.ROUNDS.total;
      var current = (game && game.round) || 1;
      var pips = [];
      for (var i = 1; i <= total; i++) {
        pips.push(
          el('span', {
            class:
              'round-pip' +
              (i < current ? ' is-done' : '') +
              (i === current ? ' is-now' : ''),
            title: 'Round ' + i,
          })
        );
      }
      mount(stepsNode, pips);
    }

    function render(next, secondsFromServer) {
      game = next;
      var round = game.round || 1;
      var total = game.roundsTotal || CMP.ROUNDS.total;

      mount(labelNode, [
        'Round ',
        el('strong', { text: String(round) }),
        ' of ' + total,
        round >= total ? el('span', { class: 'round-final', text: 'Final round' }) : null,
      ]);

      if (round !== lastRound) {
        lastRound = round;
        paintSteps();
      }

      /*
       * What a round is bounded by, now that it is not bounded by moves.
       *
       * Two things: what the campaign has left to spend, and who else is
       * still deciding. Both change while the player watches, so both live
       * beside the clock rather than a screen away.
       */
      if (game.stage === 'results') {
        mount(movesNode, [
          el('span', { class: 'round-moves-label', text: 'Round closed' }),
        ]);
      } else if (game.roundReady) {
        mount(movesNode, [
          el('span', { class: 'round-moves-label is-ready', text: "You're ready" }),
        ]);
      } else {
        var money = CMP.ui.money;
        mount(movesNode, [
          el('span', { class: 'round-spend', text: money.words(CMP.campaign.remaining(game)) }),
          el('span', { class: 'round-moves-label', text: 'to spend' }),
        ]);
      }

      /*
       * The ready count. Only worth showing when somebody could be waited
       * for — a solo game has nobody to wait for, and a line saying "1 / 1
       * ready" is noise.
       */
      var ready = opts.readyCount && opts.readyCount();
      if (ready && ready.of > 1) {
        mount(readyNode, [
          el('span', { class: 'round-ready-count', text: ready.count + ' / ' + ready.of }),
          el('span', {
            class: 'round-ready-label',
            text: ready.count >= ready.of ? 'ready — round ending' : 'ready',
          }),
        ]);
        readyNode.classList.toggle('is-all', ready.count >= ready.of);
      } else {
        mount(readyNode, []);
      }

      // Multiplayer is told the seconds left; solo keeps its own deadline.
      if (typeof secondsFromServer === 'number') {
        deadline = Date.now() + secondsFromServer * 1000;
      } else if (game.roundEndsAt) {
        deadline = game.roundEndsAt;
      }

      paintClock();
      if (timer === null) timer = window.setInterval(paintClock, 250);
    }

    function stop() {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    return { root: root, render: render, stop: stop, secondsLeft: secondsLeft };
  }

  /* ------------------------------------------------------- projection */

  /**
   * Where every party stands right now, and — the number that actually
   * matters — how many more seats the player needs.
   */
  function projection(game, counts) {
    var majority = CMP.MAJORITY;
    var rows = CMP.PARTIES.map(function (p) {
      return { party: p, seats: (counts && counts[p.id]) || 0 };
    }).sort(function (a, b) {
      return b.seats - a.seats;
    });

    var mine = (counts && counts[game.partyId]) || 0;
    var needed = Math.max(0, majority - mine);
    var top = Math.max(1, rows[0].seats);

    return el('div', { class: 'projection' }, [
      el('div', { class: 'projection-head' }, [
        el('span', { class: 'stat-label', text: 'Projected Seats' }),
        el('span', {
          class: 'projection-need' + (needed === 0 ? ' is-clear' : ''),
          text: needed === 0
            ? 'Majority reached — ' + mine + ' seats'
            : 'Needs ' + needed + ' more seat' + (needed === 1 ? '' : 's'),
        }),
      ]),
      el(
        'div',
        { class: 'projection-bars' },
        rows.map(function (row) {
          return el(
            'div',
            {
              class: 'projection-row' + (row.party.id === game.partyId ? ' is-you' : ''),
              style: { '--party': row.party.colour },
            },
            [
              el('span', { class: 'projection-party', text: row.party.short }),
              el('span', { class: 'projection-track' }, [
                el('span', {
                  class: 'projection-fill',
                  style: { width: (row.seats / top) * 100 + '%' },
                }),
              ]),
              el('span', { class: 'projection-seats', text: String(row.seats) }),
            ]
          );
        })
      ),
      el('p', {
        class: 'projection-note',
        text: majority + ' of ' + CMP.TOTAL_SEATS + ' seats forms a government. ' +
          'These are current leads, not the count.',
      }),
    ]);
  }

  /* ---------------------------------------------------- round summary */

  /**
   * What the round did to you, shown when a round turns over so a changed
   * number always comes with a reason.
   *
   * It sits in the page rather than over it. The next round is already
   * running by the time this appears, and a modal that had to be dismissed
   * would spend a player's seconds for them.
   */
  function summary(game, s, onClose) {
    if (!s) return null;

    function delta(value, suffix, invert) {
      var good = invert ? value < 0 : value > 0;
      var bad = invert ? value > 0 : value < 0;
      var sign = value > 0 ? '+' : '';
      return el('span', {
        class: 'sum-delta' + (good ? ' is-good' : bad ? ' is-bad' : ''),
        text: sign + (Math.round(value * 10) / 10) + (suffix || ''),
      });
    }

    function row(label, value, change) {
      return el('div', { class: 'sum-row' }, [
        el('span', { class: 'sum-label', text: label }),
        el('span', { class: 'sum-value' }, [value, change || null]),
      ]);
    }

    var card = el('div', { class: 'summary-card', role: 'status' }, [
      el('div', { class: 'summary-head' }, [
        el('div', {}, [
          el('span', { class: 'dialog-eyebrow', text: 'Round ' + s.round + ' complete' }),
          el('h2', {
            class: 'summary-title',
            text: s.seatsChange > 0
              ? 'A good round'
              : s.seatsChange < 0
                ? 'Ground lost'
                : 'The board holds',
          }),
        ]),
        el('button', {
          class: 'summary-close',
          type: 'button',
          'aria-label': 'Dismiss the round summary',
          text: '×',
          onclick: function () {
            dismiss();
          },
        }),
      ]),

      el('div', { class: 'sum-grid' }, [
        row('Money spent', el('strong', { text: money.words(s.spent) || '₹0' })),
        row('Money raised', el('strong', { text: money.words(s.gained) || '₹0' })),
        row('Cash in hand', el('strong', { text: money.words(s.cashAfter) || '₹0' }),
          s.cashChange ? delta(s.cashChange / 100000, 'L') : null),
        s.debtAfter
          ? row('Debt outstanding', el('strong', { class: 'is-debt', text: money.words(s.debtAfter) }))
          : null,
        row('Average support', el('strong', { text: (s.supportAfter || 0).toFixed(1) + '%' }),
          delta(s.supportChange || 0, '%')),
        row('Seats led', el('strong', { text: String(s.seatsAfter) }),
          delta(s.seatsChange || 0)),
        row('Political heat', el('strong', { text: String(Math.round(s.heatAfter || 0)) }),
          delta(s.heatChange || 0, '', true)),
      ]),

      (s.repayments || []).length
        ? el('div', { class: 'sum-block' }, [
            el('h3', { class: 'sum-block-title', text: 'The bank' }),
            el(
              'ul',
              { class: 'sum-list' },
              s.repayments.map(function (r) {
                return el('li', { class: r.defaulted ? 'is-bad' : '' }, [
                  el('strong', { text: r.defaulted ? 'Default. ' : 'Repaid. ' }),
                  r.text +
                    (r.defaulted
                      ? ' Short by ' + money.words(r.shortfall) + '.'
                      : ' ' + money.words(r.paid) + ' including ' + money.words(r.interest) + ' interest.'),
                ]);
              })
            ),
          ])
        : null,

      (s.events || []).length
        ? el('div', { class: 'sum-block' }, [
            el('h3', { class: 'sum-block-title', text: 'This round' }),
            el(
              'ul',
              { class: 'sum-list' },
              s.events.map(function (e) {
                return el('li', { class: e.kind === 'bad' ? 'is-bad' : 'is-good' }, [
                  el('strong', { text: e.label + '. ' }),
                  e.text,
                  e.seats && e.seats.length
                    ? el('span', { class: 'sum-seats', text: ' ' + seatNames(e.seats) })
                    : null,
                ]);
              })
            ),
          ])
        : null,
    ]);

    function dismiss() {
      if (card.parentNode) card.parentNode.removeChild(card);
      if (onClose) onClose();
    }

    return card;
  }

  function seatNames(numbers) {
    var names = numbers.slice(0, 3).map(function (n) {
      for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
        if (CMP.CONSTITUENCIES[i].number === Number(n)) return CMP.CONSTITUENCIES[i].name;
      }
      return '#' + n;
    });
    if (numbers.length > 3) names.push('and ' + (numbers.length - 3) + ' more');
    return names.join(', ');
  }

  return { create: create, projection: projection, summary: summary };
})();

/* ------------------------------------------------------------- the bank */

CMP.ui.bank = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  /**
   * Borrowing, and the breakdown of where the campaign's money stands.
   *
   * Cash and debt are shown as two separate figures on purpose. A player who
   * has borrowed twice is not richer than one who has not — they have simply
   * moved a problem two rounds down the road, and the panel should say so.
   */
  function create(opts) {
    opts = opts || {};
    var game = null;
    var amount = CMP.FINANCE.loan.minAmount;
    var busy = false;

    var root = el('div', { class: 'bank' });

    function offerFor(value) {
      // Solo quotes locally; multiplayer asks the server before committing,
      // but the local quote is the same arithmetic and keeps the panel live.
      return CMP.campaign.loanOffer(game, value);
    }

    function amounts() {
      var cfg = CMP.FINANCE.loan;
      var out = [];
      for (var v = cfg.minAmount; v <= cfg.maxAmount; v += cfg.increments) out.push(v);
      return out;
    }

    function take() {
      if (busy) return;
      var offer = offerFor(amount);
      if (!offer.ok) return;

      CMP.ui.dialog
        .confirm({
          eyebrow: 'Bank loan',
          title: 'Borrow ' + money.words(offer.amount) + '?',
          body:
            'The money is yours to spend this round. The repayment is taken ' +
            'automatically at the end of round ' + offer.dueRound + '.',
          lines: [
            { label: 'You receive', value: money.words(offer.amount) },
            { label: 'Interest at ' + Math.round(offer.interestRate * 100) + '%', value: money.words(offer.interest) },
            { label: 'You repay', value: money.words(offer.repay), strong: true },
            { label: 'Due at end of', value: 'Round ' + offer.dueRound },
          ],
          note:
            'If you cannot cover it when it falls due you will default: heat, ' +
            'lost support, a campaign restriction, and no further credit.',
          confirmLabel: 'Take the loan',
        })
        .then(function (yes) {
          if (!yes) return;
          busy = true;
          render(game);
          Promise.resolve(opts.onBorrow(offer.amount)).then(
            function (res) {
              busy = false;
              if (res && res.ok === false && opts.onNotice) opts.onNotice(res.reason || res.error);
              render(res && res.game ? res.game : game);
            },
            function () {
              busy = false;
              if (opts.onNotice) opts.onNotice('Could not reach the game server.');
              render(game);
            }
          );
        });
    }

    function outstanding() {
      return (game.loans || []).filter(function (l) {
        return !l.settled;
      });
    }

    function render(next) {
      game = next;
      var cfg = CMP.FINANCE.loan;
      var debt = CMP.campaign.debtOf(game);
      var offer = offerFor(amount);
      var loans = outstanding();

      mount(root, [
        el('div', { class: 'bank-figures' }, [
          figure('Cash in hand', money.words(game.cash) || '₹0', 'is-cash'),
          figure('Debt outstanding', debt ? money.words(debt) : '—', debt ? 'is-debt' : ''),
          figure('Debt limit', money.words(cfg.debtLimit), ''),
        ]),

        loans.length
          ? el(
              'ul',
              { class: 'loan-list' },
              loans.map(function (l) {
                var due = l.dueRound - (game.round || 1);
                return el('li', { class: 'loan-item' + (due <= 0 ? ' is-due' : '') }, [
                  el('span', { class: 'loan-amount', text: money.words(l.repay) }),
                  el('span', {
                    class: 'loan-due',
                    text:
                      due <= 0
                        ? 'due at the end of this round'
                        : 'due end of round ' + l.dueRound +
                          ' (' + due + ' round' + (due === 1 ? '' : 's') + ')',
                  }),
                ]);
              })
            )
          : null,

        game.borrowingBlocked
          ? el('p', { class: 'bank-blocked', text: 'No bank will lend to you after your default.' })
          : el('div', { class: 'bank-borrow' }, [
              el('span', { class: 'stat-label', text: 'Borrow' }),
              el(
                'div',
                { class: 'bank-amounts' },
                amounts().map(function (v) {
                  return el('button', {
                    class: 'bank-chip' + (v === amount ? ' is-active' : ''),
                    type: 'button',
                    text: money.words(v),
                    onclick: function () {
                      amount = v;
                      render(game);
                    },
                  });
                })
              ),
              el('p', {
                class: 'bank-terms' + (offer.ok ? '' : ' is-refused'),
                text: offer.ok
                  ? 'Repay ' + money.words(offer.repay) + ' at the end of round ' +
                    offer.dueRound + ', including ' + money.words(offer.interest) +
                    ' interest at ' + Math.round(offer.interestRate * 100) + '%.'
                  : offer.error,
              }),
              el('button', {
                class: 'btn btn-primary btn-small',
                type: 'button',
                text: busy ? 'Arranging…' : 'Take loan',
                disabled: !offer.ok || busy,
                onclick: take,
              }),
            ]),
      ]);
    }

    function figure(label, value, extra) {
      return el('div', { class: 'bank-figure ' + (extra || '') }, [
        el('span', { class: 'stat-label', text: label }),
        el('strong', { class: 'bank-figure-value', text: value }),
      ]);
    }

    return { root: root, render: render };
  }

  /** The money breakdown, kept honest about what is borrowed. */
  function breakdown(game) {
    var debt = CMP.campaign.debtOf(game);
    var rows = [
      { label: 'Starting budget', value: game.budget },
      { label: 'Grants received', value: game.granted, hideIfZero: true },
      { label: 'Other funding', value: game.raised, hideIfZero: true },
      { label: 'Borrowed', value: game.borrowed, hideIfZero: true },
      { label: 'Spent on campaigning', value: -game.spent },
      { label: 'Loan repayments', value: -game.repaid, hideIfZero: true },
      { label: 'Fines paid', value: -game.finesPaid, hideIfZero: true },
    ].filter(function (r) {
      return !(r.hideIfZero && !r.value);
    });

    return el('div', { class: 'breakdown' }, [
      el(
        'dl',
        { class: 'breakdown-rows' },
        rows.map(function (r) {
          return el('div', { class: 'breakdown-row' }, [
            el('dt', { text: r.label }),
            el('dd', {
              class: r.value < 0 ? 'is-out' : 'is-in',
              text: (r.value < 0 ? '−' : '+') + (money.words(Math.abs(r.value)) || '₹0'),
            }),
          ]);
        })
      ),
      el('div', { class: 'breakdown-totals' }, [
        el('div', { class: 'breakdown-total' }, [
          el('span', { class: 'stat-label', text: 'Cash in hand' }),
          el('strong', { text: money.format(game.cash) }),
        ]),
        el('div', { class: 'breakdown-total' + (debt ? ' is-debt' : '') }, [
          el('span', { class: 'stat-label', text: 'Still owed' }),
          el('strong', { text: debt ? money.format(debt) : '—' }),
        ]),
      ]),
    ]);
  }

  return { create: create, breakdown: breakdown };
})();
