/**
 * Putting money somewhere.
 * ------------------------------------------------------------------
 * One panel, and it answers the only question the game asks: where, how much,
 * and whether to take a risk with it.
 *
 * It used to ask which *kind* of campaigning — a rally, a media push, a
 * community drive — which was a decision about vocabulary rather than about
 * strategy. All of them were money into a seat, and money into a seat is what
 * this is now. What is left to decide is the part that matters.
 *
 * The two optional extras are modifiers on the same investment, not separate
 * errands: a negative campaign spends it against a rival instead of for
 * yourself, and corruption spends it somewhere it should not go. Neither is
 * ever necessary — an election can be fought and won on ordinary money.
 *
 * Opens as a bottom sheet over whatever the player was looking at, usually the
 * map, and closes back to it.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.campaignSheet = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  /** The three things a player can do with an investment. */
  var MODES = [
    { id: 'invest', label: 'Campaign', note: 'For you' },
    { id: 'negative', label: 'Negative', note: 'Against a rival' },
    { id: 'bribe', label: 'Corruption', note: 'Off the books' },
  ];

  function seatDef(number) {
    for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
      if (CMP.CONSTITUENCIES[i].number === Number(number)) return CMP.CONSTITUENCIES[i];
    }
    return null;
  }

  function districtOf(id) {
    var found = null;
    (CMP.DISTRICTS || []).forEach(function (d) {
      if (d.id === id) found = d;
    });
    return found;
  }

  /**
   * Open the panel on a seat, or on a district.
   *
   * @param opts.district  a district id, when the target is the whole thing
   * @param opts.play      (actionId, seat, amount) -> result
   * @param opts.playBulk  (actionId, seats, total) -> result
   */
  function open(game, seat, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var district = opts.district ? districtOf(opts.district) : null;
      // Tapping a seat means that seat. The district is offered beside it,
      // because spreading across one is the other thing people want.
      var target = seat ? 'seat' : 'district';
      var mode = 'invest';
      var amount = null;
      var busy = false;
      var settled = false;

      var body = el('div', { class: 'cs-body' });
      var panel = el('div', {
        class: 'sheet-panel campaign-sheet',
        role: 'dialog',
        'aria-modal': 'true',
      }, [body]);
      var sheet = el('div', { class: 'sheet is-bottom' }, [panel]);

      function close(result) {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKey);
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        resolve(result || null);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(null);
      }

      /* ------------------------------------------------------ reading */

      /** The seats this investment would land in. */
      function seats() {
        if (target === 'district' && district) return district.seats.slice();
        return [Number(seat)];
      }

      /** Seats in range that are not already finished. */
      function openSeats() {
        return seats().filter(function (n) {
          return !CMP.campaign.isWon(game, n);
        });
      }

      /** The most one move may put in, and the least. */
      function limits() {
        var action = CMP.getAction(mode);
        var range = CMP.campaign.amountRange(action);
        var list = openSeats();
        if (!list.length) return { min: 0, max: 0, cap: 0, pot: 0 };

        // Whatever can go behind it: cash plus the region purse of the seats
        // it would land in. A district spread draws on the same region
        // throughout, because a district sits in one.
        var pot = CMP.campaign.spendableOn(game, list[0]).total;

        // The entry cap applies per seat, so a spread across N unentered
        // seats may commit N times it.
        var caps = list.map(function (n) {
          return CMP.campaign.entryCap(game, n);
        });
        var capped = caps.filter(function (c) {
          return c > 0;
        });
        var entry = capped.length === list.length
          ? capped.reduce(function (t, c) { return t + c; }, 0)
          : 0;

        var most = Math.min(pot, range.max * list.length);
        if (entry) most = Math.min(most, entry);
        return {
          min: Math.min(range.min * list.length, most),
          max: most,
          cap: entry,
          pot: pot,
          perSeat: list.length,
        };
      }

      function standing() {
        if (target === 'seat') {
          return CMP.campaign.standings(game.support[seat] || {});
        }
        // A district's standing is the sum of its seats' shares, so the four
        // numbers add up to something a player can read as a position.
        var totals = {};
        seats().forEach(function (n) {
          CMP.campaign.standings(game.support[n] || {}).forEach(function (row) {
            totals[row.partyId] = (totals[row.partyId] || 0) + row.support;
          });
        });
        var count = seats().length || 1;
        return Object.keys(totals).map(function (id) {
          return { partyId: id, support: Math.round((totals[id] / count) * 10) / 10 };
        }).sort(function (a, b) {
          return b.support - a.support;
        });
      }

      /* ----------------------------------------------------- painting */

      function title() {
        if (target === 'district' && district) return district.name;
        var def = seatDef(seat);
        return def ? def.name : 'This seat';
      }

      function subtitle() {
        if (target === 'district' && district) {
          return district.seats.length + ' seats · ' + money.words(district.grant) + ' a round';
        }
        var def = seatDef(seat);
        return def ? 'AC ' + def.number + ' · ' + def.district : '';
      }

      /** Who stands where, or that nobody has been here. */
      function positions() {
        var rows = standing();
        if (!rows.length) {
          return el('p', { class: 'cs-open', text: 'Nobody has campaigned here yet.' });
        }
        return el('ol', { class: 'cs-positions' }, rows.slice(0, 4).map(function (row, i) {
          var party = CMP.getParty(row.partyId);
          return el('li', {
            class: 'cs-position' + (row.partyId === game.partyId ? ' is-you' : ''),
            style: { '--party': party.colour },
          }, [
            el('span', { class: 'cs-position-rank', text: String(i + 1) }),
            el('span', { class: 'cs-position-party', text: party.short }),
            el('span', { class: 'cs-position-share', text: row.support.toFixed(1) + '%' }),
          ]);
        }));
      }

      /** Seats in this district already finished, if any. */
      function wonNote() {
        var all = seats();
        var done = all.filter(function (n) {
          return CMP.campaign.isWon(game, n);
        });
        if (!done.length) return null;
        if (done.length === all.length) return null;
        return el('p', {
          class: 'cs-note',
          text: done.length + ' of ' + all.length + ' seats here are already won and locked. ' +
            'Money goes to the rest.',
        });
      }

      function targetToggle() {
        if (!district) return null;
        return el('div', { class: 'cs-target' }, [
          el('span', { class: 'cs-target-label', text: 'Target' }),
          el('div', { class: 'term-options' }, [
            el('button', {
              class: 'term-option' + (target === 'district' ? ' is-active' : ''),
              type: 'button',
              text: 'District',
              onclick: function () {
                target = 'district';
                amount = null;
                paint();
              },
            }),
            el('button', {
              class: 'term-option' + (target === 'seat' ? ' is-active' : ''),
              type: 'button',
              text: 'One seat',
              disabled: !seat,
              onclick: function () {
                target = 'seat';
                amount = null;
                paint();
              },
            }),
          ]),
        ]);
      }

      function modeToggle() {
        return el('div', { class: 'cs-modes' }, MODES.map(function (m) {
          var on = mode === m.id;
          return el('button', {
            class: 'cs-mode' + (on ? ' is-on' : '') + (m.id === 'invest' ? '' : ' is-risky'),
            type: 'button',
            'aria-pressed': on ? 'true' : 'false',
            onclick: function () {
              mode = m.id;
              amount = null;
              paint();
            },
          }, [
            el('strong', { class: 'cs-mode-label', text: m.label }),
            el('span', { class: 'cs-mode-note', text: m.note }),
          ]);
        }));
      }

      function paint() {
        var action = CMP.getAction(mode);
        var lim = limits();
        var list = openSeats();

        // Everything here is finished. There is nothing to decide.
        if (!list.length) {
          mount(body, [
            head(),
            el('div', { class: 'cs-locked' }, [
              el('strong', { class: 'cs-locked-title', text: '✓ Won' }),
              el('span', {
                class: 'cs-locked-note',
                text: target === 'seat'
                  ? CMP.campaign.wonReason
                    ? CMP.campaign.wonReason(game, seat)
                    : 'This seat is locked for the rest of the election.'
                  : 'Every seat in this district is won and locked.',
              }),
            ]),
            closeButton('Back to the map'),
          ]);
          return;
        }

        // Open at the cap when getting in, because that is the whole of the
        // decision; otherwise at something a round's allowance covers.
        if (amount === null) {
          amount = lim.cap
            ? Math.min(lim.cap, lim.max)
            : Math.min(lim.max, Math.max(lim.min, (CMP.CAMPAIGN.income || {}).perRound || lim.min));
        }
        amount = Math.max(lim.min, Math.min(amount, lim.max));

        var step = Math.max(2500000, Math.round((lim.max - lim.min) / 20 / 500000) * 500000);
        var affordable = lim.max >= lim.min && lim.max > 0;

        mount(body, [
          head(),
          positions(),
          wonNote(),
          targetToggle(),
          modeToggle(),

          el('div', { class: 'cs-amount' }, [
            el('div', { class: 'cs-amount-head' }, [
              el('span', { class: 'cs-amount-label', text: 'Invest' }),
              el('strong', { class: 'cs-amount-value', text: money.words(amount) || '₹0' }),
            ]),
            el('div', { class: 'cs-stepper' }, [
              el('button', {
                class: 'cs-step',
                type: 'button',
                'aria-label': 'Less',
                text: '−',
                disabled: amount <= lim.min,
                onclick: function () {
                  amount = Math.max(lim.min, amount - step);
                  paint();
                },
              }),
              el('input', {
                class: 'cs-range',
                type: 'range',
                min: String(lim.min),
                max: String(lim.max),
                step: String(Math.max(500000, step / 5)),
                value: String(amount),
                'aria-label': 'Amount to invest',
                oninput: function (e) {
                  amount = Number(e.target.value);
                  paint();
                },
              }),
              el('button', {
                class: 'cs-step',
                type: 'button',
                'aria-label': 'More',
                text: '+',
                disabled: amount >= lim.max,
                onclick: function () {
                  amount = Math.min(lim.max, amount + step);
                  paint();
                },
              }),
            ]),
            lim.cap
              ? el('p', {
                  class: 'cs-cap',
                  text: lim.perSeat > 1
                    ? 'First campaign in a seat: ' + money.words(lim.cap / lim.perSeat) +
                      ' at most, so ' + money.words(lim.cap) + ' across these ' +
                      lim.perSeat + '. Once you are in, spend what you like.'
                    : 'First campaign here: ' + money.words(lim.cap) + ' at most. ' +
                      'Once you are in, you can spend what you like.',
                })
              : null,
          ]),

          el('dl', { class: 'cs-summary' }, [
            line('Available', money.words(lim.pot) || '₹0'),
            line('Investment', money.words(amount)),
            line('Risk', action.riskLabel),
            line('After this', money.words(Math.max(0, lim.pot - amount)) || '₹0', true),
          ]),

          affordable
            ? el('button', {
                class: 'btn btn-primary btn-wide',
                type: 'button',
                text: busy ? 'Investing…' : 'Invest ' + money.words(amount),
                disabled: busy,
                onclick: run,
              })
            : el('p', {
                class: 'cs-cannot',
                text: 'Not enough to campaign here. You can spend ' +
                  (money.words(lim.pot) || '₹0') + ' in this area.',
              }),
          closeButton('Cancel'),
        ]);
      }

      function head() {
        return el('div', { class: 'cs-head' }, [
          el('span', { class: 'cs-kicker', text: 'Campaign' }),
          el('h2', { class: 'sheet-title', text: title() }),
          el('span', { class: 'cs-where', text: subtitle() }),
        ]);
      }

      function closeButton(label) {
        return el('button', {
          class: 'btn btn-quiet btn-wide',
          type: 'button',
          text: label,
          onclick: function () {
            close(null);
          },
        });
      }

      function line(label, value, strong) {
        return el('div', { class: 'dialog-line' + (strong ? ' is-strong' : '') }, [
          el('dt', { text: label }),
          el('dd', { text: value }),
        ]);
      }

      /* ---------------------------------------------------------- play */

      function run() {
        if (busy) return;
        busy = true;
        paint();

        var before = CMP.campaign.shareOf(game.support[seats()[0]] || {}, game.partyId);
        var list = openSeats();

        var promise = target === 'district' && list.length > 1 && opts.playBulk
          ? opts.playBulk(mode, list, amount)
          : opts.play(mode, list[0], amount);

        Promise.resolve(promise).then(function (res) {
          busy = false;
          if (!res || !res.ok) {
            if (opts.onNotice) opts.onNotice((res && res.reason) || 'That move could not be played.');
            close(null);
            return;
          }
          close({ report: res.report, game: res.game, before: before });
        }, function () {
          busy = false;
          if (opts.onNotice) opts.onNotice('Could not reach the game server.');
          close(null);
        });
      }

      document.addEventListener('keydown', onKey);
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) close(null);
      });
      paint();
      document.body.appendChild(sheet);
    });
  }

  /**
   * What the investment did, briefly.
   *
   * Kept because the money going out and nothing being said about it is the
   * one thing worse than a screen too many.
   */
  function result(game, seat, report, before, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var def = seatDef(seat);
      var support = game.support[seat] || {};
      var after = CMP.campaign.shareOf(support, game.partyId);
      var party = CMP.getParty(game.partyId);
      var moved = after - before;

      function close() {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        resolve();
      }

      var sheet = el('div', { class: 'sheet is-bottom' }, [
        el('div', {
          class: 'sheet-panel result-sheet ' + (moved > 0 ? 'is-good' : 'is-bad'),
          role: 'status',
        }, [
          el('span', { class: 'cs-kicker', text: 'Campaign result' }),
          el('h2', { class: 'sheet-title', text: def ? def.name : 'Result' }),
          el('p', { class: 'rs-headline', text: report.text }),

          el('div', { class: 'rs-moves' }, CMP.getParties().map(function (p) {
            var share = CMP.campaign.shareOf(support, p.id);
            var mine = p.id === game.partyId;
            return el('div', {
              class: 'rs-move' + (share > 0 ? '' : ' is-absent'),
              style: { '--party': p.colour },
            }, [
              el('span', { class: 'rs-move-party', text: p.short }),
              el('span', { class: 'rs-move-value' }, share > 0
                ? (mine
                    ? [
                        el('span', { class: 'rs-was', text: before.toFixed(1) + '%' }),
                        ' → ',
                        el('strong', { text: share.toFixed(1) + '%' }),
                      ]
                    : [share.toFixed(1) + '%'])
                : ['—']),
            ]);
          })),

          el('div', { class: 'rs-spent' }, [
            el('span', { text: 'Money spent' }),
            el('strong', { text: money.words(report.cost) || '₹0' }),
          ]),

          el('button', {
            class: 'btn btn-primary btn-wide',
            type: 'button',
            text: 'Back to the map',
            onclick: close,
          }),
        ]),
      ]);

      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) close();
      });
      document.body.appendChild(sheet);
      window.setTimeout(close, 4200);
      void party;
    });
  }

  return { open: open, result: result };
})();
