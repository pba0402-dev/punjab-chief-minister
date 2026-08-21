/**
 * Putting one sum behind many seats at once.
 * ------------------------------------------------------------------
 * The economy lets a campaign save for several rounds and then move. Spending
 * twenty crore one rally at a time would be twenty taps, so this is the screen
 * that makes saving worth doing: pick where, pick how much, see exactly what
 * it buys and what will not fit, and commit once.
 *
 * Region money is spent where it was earned, so the breakdown says which purse
 * each rupee is coming out of rather than presenting one total that quietly
 * cannot be spent everywhere.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.allocate = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  /**
   * @param opts.game      the game
   * @param opts.seats     seat numbers to spread across
   * @param opts.title     what the player picked ("Ludhiana", "12 close seats")
   * @param opts.onPlay    (actionId, seats, amount) -> Promise of a result
   * @param opts.onClose   called when the sheet closes
   */
  function open(opts) {
    var game = opts.game;
    var seats = (opts.seats || []).slice();
    var actionId = 'rally';
    var amount = 0;
    var busy = false;

    var body = el('div', { class: 'al-body' });
    var sheet = el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-panel al-panel', role: 'dialog', 'aria-modal': 'true' }, [body]),
    ]);

    /** The most this allocation could usefully absorb. */
    function ceilingFor(id) {
      var action = CMP.getAction(id);
      var perSeat = CMP.campaign.amountRange(action).max;
      return perSeat * seats.length;
    }

    /** What the campaign could actually put behind these seats. */
    function affordable() {
      var pots = {};
      var cash = CMP.campaign.remaining(game);
      var total = cash;
      seats.forEach(function (n) {
        var region = CMP.regionOfSeat(n);
        if (region && pots[region] === undefined) {
          pots[region] = CMP.campaign.grantIn(game, region);
          total += pots[region];
        }
      });
      return total;
    }

    function clampAmount() {
      var most = Math.min(affordable(), ceilingFor(actionId));
      if (amount > most) amount = most;
      if (amount < 0) amount = 0;
      return most;
    }

    function paint() {
      var most = clampAmount();
      var plan = amount > 0
        ? CMP.campaign.planBulk(game, actionId, seats, amount)
        : { rows: [], seats: 0, allocated: 0, unspent: 0 };

      var landing = plan.rows ? plan.rows.filter(function (r) {
        return r.amount > 0;
      }) : [];

      // Which purse each rupee comes from, region by region.
      var fromRegion = {};
      var fromCash = 0;
      var cashLeft = CMP.campaign.remaining(game);
      var potLeft = {};
      landing.forEach(function (row) {
        var region = row.region;
        if (region && potLeft[region] === undefined) {
          potLeft[region] = CMP.campaign.grantIn(game, region);
        }
        var g = region ? Math.min(potLeft[region], row.amount) : 0;
        if (region) potLeft[region] -= g;
        var c = Math.min(cashLeft, row.amount - g);
        cashLeft -= c;
        if (g > 0) fromRegion[region] = (fromRegion[region] || 0) + g;
        fromCash += c;
      });

      mount(body, [
        el('header', { class: 'al-head' }, [
          el('h2', { class: 'sheet-title', text: 'Campaign in ' + opts.title }),
          el('p', {
            class: 'al-sub',
            text: seats.length + ' seat' + (seats.length === 1 ? '' : 's') +
              ' · ' + money.words(affordable()) + ' available here',
          }),
        ]),

        /* ---- what kind of campaign ---- */
        el('div', { class: 'al-moves' }, CMP.actionsByMenu('campaign').map(function (a) {
          return el('button', {
            class: 'al-move' + (a.id === actionId ? ' is-active' : ''),
            type: 'button',
            onclick: function () {
              actionId = a.id;
              paint();
            },
          }, [
            el('span', { class: 'al-move-name', text: a.label }),
            el('span', { class: 'al-move-cost', text: money.words(a.cost) + ' a seat' }),
          ]);
        })),

        /* ---- how much ---- */
        el('div', { class: 'al-amount' }, [
          el('div', { class: 'al-amount-head' }, [
            el('span', { class: 'al-amount-label', text: 'Put behind it' }),
            el('strong', { class: 'al-amount-value', text: money.words(amount) || '₹0' }),
          ]),
          el('input', {
            class: 'al-slider',
            type: 'range',
            min: '0',
            max: String(most),
            step: String(Math.max(100000, Math.round(most / 200) || 100000)),
            value: String(amount),
            'aria-label': 'Amount to spend',
            oninput: function (e) {
              amount = Number(e.target.value);
              paint();
            },
          }),
          el('div', { class: 'al-quick' }, [0.25, 0.5, 1].map(function (f) {
            var v = Math.round(most * f);
            return el('button', {
              class: 'al-quick-btn',
              type: 'button',
              text: f === 1 ? 'All of it' : Math.round(f * 100) + '%',
              onclick: function () {
                amount = v;
                paint();
              },
            });
          })),
        ]),

        /* ---- what it buys ---- */
        el('div', { class: 'sum-lines al-preview' }, [
          line('Lands on', landing.length + ' of ' + seats.length + ' seats'),
          line('Each seat gets',
            landing.length ? money.words(Math.round(plan.allocated / landing.length)) : '—'),
          Object.keys(fromRegion).length
            ? line('From region grants', Object.keys(fromRegion).map(function (r) {
                var region = CMP.getRegion(r);
                return (region ? region.name : r) + ' ' + money.words(fromRegion[r]);
              }).join(', '))
            : null,
          fromCash > 0 ? line('From campaign cash', money.words(fromCash)) : null,
          line('Left afterwards', money.words(affordable() - plan.allocated) || '₹0'),
        ]),

        plan.unspent > 0
          ? el('p', {
              class: 'al-note',
              text: money.words(plan.unspent) + ' will not fit — one move can only ' +
                'take so much, so spread it wider or spend less.',
            })
          : null,

        /* ---- commit ---- */
        el('button', {
          class: 'btn btn-primary btn-wide',
          type: 'button',
          disabled: busy || !landing.length,
          text: landing.length
            ? 'Campaign across ' + landing.length + ' seat' + (landing.length === 1 ? '' : 's')
            : 'Choose an amount',
          onclick: commit,
        }),
        el('button', {
          class: 'btn btn-quiet btn-wide',
          type: 'button',
          text: 'Cancel',
          onclick: close,
        }),
      ]);
    }

    function line(label, value) {
      return el('div', { class: 'sum-line' }, [
        el('span', { class: 'sum-line-label', text: label }),
        el('strong', { class: 'sum-line-value', text: value }),
      ]);
    }

    function commit() {
      if (busy) return;
      busy = true;
      paint();

      Promise.resolve(opts.onPlay(actionId, seats, amount)).then(
        function (res) {
          busy = false;
          if (res && res.ok) {
            showResult(res);
            return;
          }
          paint();
          mount(body, [
            el('p', { class: 'notice notice-bad', text: (res && res.reason) || 'That did not go through.' }),
            el('button', {
              class: 'btn btn-quiet btn-wide',
              type: 'button',
              text: 'Close',
              onclick: close,
            }),
          ]);
        },
        function () {
          busy = false;
          paint();
        }
      );
    }

    /** What actually happened, seat by seat, before going back to the board. */
    function showResult(res) {
      var gained = (res.reports || []).reduce(function (t, r) {
        return t + (r.support || 0);
      }, 0);

      mount(body, [
        el('h2', { class: 'sheet-title', text: 'Campaign run' }),
        el('div', { class: 'sum-lines' }, [
          line('Seats campaigned in', String(res.seats || 0)),
          line('Spent', money.words(res.spent || 0)),
          line('Support gained', (gained >= 0 ? '+' : '') + (Math.round(gained * 10) / 10)),
          line('Left to spend', money.words(CMP.campaign.remaining(game)) || '₹0'),
        ]),
        el('button', {
          class: 'btn btn-primary btn-wide',
          type: 'button',
          text: 'Back to the map',
          onclick: close,
        }),
      ]);
    }

    function close() {
      if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      if (opts.onClose) opts.onClose();
    }

    sheet.addEventListener('click', function (e) {
      if (e.target === sheet) close();
    });

    paint();
    document.body.appendChild(sheet);
    return { close: close };
  }

  return { open: open };
})();
