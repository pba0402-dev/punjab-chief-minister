/**
 * Campaigning in one constituency.
 * ------------------------------------------------------------------
 * Opened by CAMPAIGN HERE. Two steps and no more: pick a move, then decide how
 * much to put behind it.
 *
 * The amount is the interesting decision. An action's cost is the middle of a
 * range rather than a price, and what you spend scales what it achieves — on a
 * square-root curve, so four times the money buys twice the effect. Spreading
 * a budget across many moves therefore beats dumping it into a few, which is
 * what stops a rich campaign simply buying the election.
 *
 * What is never shown is the odds. The player gets a cost, a risk word and an
 * expected effect, and decides with that.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.campaignSheet = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  /**
   * Open the sheet. `opts.play(actionId, seat, amount)` resolves the move.
   * Resolves to the report when something was played, or null.
   */
  function open(game, seat, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var chosen = null;
      var amount = null;
      var busy = false;
      var settled = false;
      var showRisky = false;

      var def = null;
      for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
        if (CMP.CONSTITUENCIES[i].number === Number(seat)) def = CMP.CONSTITUENCIES[i];
      }
      var support = game.support[seat];
      var ranked = CMP.campaign.standings(support);
      var mine = support[game.partyId] || 0;
      var rival = ranked.filter(function (r) {
        return r.partyId !== game.partyId;
      })[0];

      var body = el('div', { class: 'cs-body' });
      var panel = el('div', { class: 'sheet-panel campaign-sheet', role: 'dialog', 'aria-modal': 'true' }, [body]);
      var sheet = el('div', { class: 'sheet' }, [panel]);

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

      /* ------------------------------------------------ step one: what */

      function header() {
        var party = CMP.getParty(game.partyId);
        return el('div', { class: 'cs-head' }, [
          el('span', { class: 'cs-kicker', text: 'Campaign in' }),
          el('h2', { class: 'sheet-title', text: def ? def.name : 'this seat' }),
          el('div', { class: 'cs-figures' }, [
            figure('Available', money.words(CMP.campaign.remaining(game)) || '₹0'),
            figure('Your support', mine.toFixed(1) + '%', party.colour),
            rival
              ? figure(CMP.getParty(rival.partyId).short, rival.support.toFixed(1) + '%',
                  CMP.getParty(rival.partyId).colour)
              : null,
          ]),
        ]);
      }

      function figure(label, value, colour) {
        return el('span', { class: 'cs-figure' }, [
          el('span', { class: 'cs-figure-label', text: label }),
          el('strong', { class: 'cs-figure-value', style: colour ? { color: colour } : null, text: value }),
        ]);
      }

      function actionRow(action) {
        var check = CMP.campaign.canPlay(game, action.id, seat);
        var risky = action.group === 'risky' || action.id === 'underground';
        return el('div', { class: 'act' + (risky ? ' is-risky' : '') + (check.ok ? '' : ' is-blocked') }, [
          el('span', { class: 'act-icon', 'aria-hidden': 'true', text: action.icon }),
          el('span', { class: 'act-body' }, [
            el('strong', { class: 'act-name', text: action.label }),
            el('span', { class: 'act-meta' }, [
              el('span', {
                class: 'act-cost',
                text: action.allowsAmount ? 'from ' + money.words(CMP.campaign.amountRange(action).min)
                  : (action.cost ? money.words(action.cost) : 'No cost'),
              }),
              el('span', { class: 'act-risk' + (risky ? ' is-high' : ''), text: action.riskLabel }),
            ]),
          ]),
          el('button', {
            class: 'act-use' + (risky ? ' is-risky' : ''),
            type: 'button',
            text: 'Select',
            disabled: !check.ok || busy,
            onclick: function () {
              chosen = action;
              amount = action.allowsAmount ? action.cost : null;
              paintAmount();
            },
          }),
          !check.ok ? el('span', { class: 'act-why', text: check.reason }) : null,
        ]);
      }

      function paintChoose() {
        var ordinary = CMP.actionsByMenu('campaign');
        var risky = CMP.actionsByMenu('corruption');

        mount(body, [
          header(),
          el('div', { class: 'act-list' }, ordinary.map(actionRow)),

          // High-risk moves are behind a deliberate second tap, so nobody
          // stumbles into one while looking for a rally.
          el('button', {
            class: 'cs-risky-toggle' + (showRisky ? ' is-open' : ''),
            type: 'button',
            text: showRisky ? 'Hide high-risk options' : 'High-risk options',
            onclick: function () {
              showRisky = !showRisky;
              paintChoose();
            },
          }),
          showRisky
            ? el('div', { class: 'act-list' }, risky.map(actionRow))
            : null,

          el('button', {
            class: 'btn btn-quiet btn-wide',
            type: 'button',
            text: 'Cancel',
            onclick: function () {
              close(null);
            },
          }),
        ]);
      }

      /* ----------------------------------------- step two: how much */

      function paintAmount() {
        if (!chosen.allowsAmount) {
          confirmAndPlay();
          return;
        }

        var range = CMP.campaign.amountRange(chosen);
        var cash = CMP.campaign.remaining(game);
        var cap = Math.min(range.max, cash);
        amount = Math.max(range.min, Math.min(amount || chosen.cost, cap));

        var quick = (CMP.CAMPAIGN.spending.quickAmounts || []).filter(function (v) {
          return v >= range.min && v <= cap;
        });
        if (quick.indexOf(cap) === -1 && cap > range.min) quick.push(cap);

        var scale = CMP.campaign.scaleFor(chosen, amount);
        var impact = scale >= 1.6 ? 'Large' : scale >= 1.1 ? 'Strong' : scale >= 0.8 ? 'Medium' : 'Small';

        mount(body, [
          header(),
          el('div', { class: 'cs-chosen' }, [
            el('span', { class: 'act-icon', 'aria-hidden': 'true', text: chosen.icon }),
            el('div', {}, [
              el('strong', { class: 'act-name', text: chosen.label }),
              el('span', { class: 'act-risk', text: chosen.riskLabel }),
            ]),
            el('button', {
              class: 'cs-change',
              type: 'button',
              text: 'Change',
              onclick: function () {
                chosen = null;
                paintChoose();
              },
            }),
          ]),

          el('h3', { class: 'cs-question', text: 'How much do you want to spend?' }),

          el('div', { class: 'cs-amounts' }, quick.map(function (v) {
            return el('button', {
              class: 'cs-amount' + (v === amount ? ' is-active' : ''),
              type: 'button',
              text: money.words(v),
              onclick: function () {
                amount = v;
                paintAmount();
              },
            });
          })),

          el('div', { class: 'cs-slider' }, [
            el('input', {
              class: 'cs-range',
              type: 'range',
              min: String(range.min),
              max: String(cap),
              step: String(Math.max(100000, Math.round((cap - range.min) / 40 / 100000) * 100000)),
              value: String(amount),
              'aria-label': 'Amount to spend',
              oninput: function (e) {
                amount = Number(e.target.value);
                paintAmount();
              },
            }),
            el('output', { class: 'cs-range-value', text: money.words(amount) }),
          ]),

          el('dl', { class: 'dialog-lines' }, [
            line('Current cash', money.words(cash) || '₹0'),
            line('Campaign spending', money.words(amount)),
            line('Cash after', money.words(Math.max(0, cash - amount)) || '₹0', true),
            line('Estimated impact', impact),
            line('Risk', chosen.riskLabel),
          ]),

          el('button', {
            class: 'btn btn-primary btn-wide',
            type: 'button',
            text: busy ? 'Campaigning…' : 'Confirm campaign',
            disabled: busy,
            onclick: confirmAndPlay,
          }),
          el('button', {
            class: 'btn btn-quiet btn-wide',
            type: 'button',
            text: 'Cancel',
            onclick: function () {
              close(null);
            },
          }),
        ]);
      }

      function line(label, value, strong) {
        return el('div', { class: 'dialog-line' + (strong ? ' is-strong' : '') }, [
          el('dt', { text: label }),
          el('dd', { text: value }),
        ]);
      }

      /* ------------------------------------------------------- play */

      function confirmAndPlay() {
        if (busy) return;
        busy = true;
        if (chosen.allowsAmount) paintAmount();

        Promise.resolve(opts.play(chosen.id, chosen.needsConstituency ? seat : null, amount)).then(
          function (res) {
            busy = false;
            if (!res || !res.ok) {
              if (opts.onNotice) opts.onNotice((res && res.reason) || 'That move could not be played.');
              close(null);
              return;
            }
            close({ report: res.report, game: res.game, before: mine });
          },
          function () {
            busy = false;
            if (opts.onNotice) opts.onNotice('Could not reach the game server.');
            close(null);
          }
        );
      }

      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) close(null);
      });
      document.addEventListener('keydown', onKey);
      paintChoose();
      document.body.appendChild(sheet);
    });
  }

  /**
   * What the move did, in the seat it did it in. Short, then straight back to
   * the constituency — never out to a dashboard.
   */
  function result(game, seat, report, before, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var def = null;
      for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
        if (CMP.CONSTITUENCIES[i].number === Number(seat)) def = CMP.CONSTITUENCIES[i];
      }
      var support = game.support[seat] || {};
      var after = support[game.partyId] || 0;
      var party = CMP.getParty(game.partyId);
      var ranked = CMP.campaign.standings(support);
      var top = ranked[0];
      var moved = after - before;

      var headline = top && top.partyId === game.partyId
        ? (moved > 0 ? party.short + ' strengthens its lead here' : party.short + ' still leads here')
        : (moved > 0 ? party.short + ' closes the gap' : 'No ground gained here');

      function close() {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
        resolve();
      }

      var sheet = el('div', { class: 'sheet' }, [
        el('div', {
          class: 'sheet-panel result-sheet ' + (moved > 0 ? 'is-good' : 'is-bad'),
          role: 'status',
        }, [
          el('span', { class: 'cs-kicker', text: 'Campaign result' }),
          el('h2', { class: 'sheet-title', text: def ? def.name : 'Result' }),
          el('p', { class: 'rs-headline', text: headline }),

          el('div', { class: 'rs-moves' }, ranked.slice(0, 3).map(function (row) {
            var p = CMP.getParty(row.partyId);
            var was = row.partyId === game.partyId ? before : null;
            return el('div', { class: 'rs-move', style: { '--party': p.colour } }, [
              el('span', { class: 'rs-move-party', text: p.short }),
              el('span', { class: 'rs-move-value' }, was === null
                ? [row.support.toFixed(1) + '%']
                : [
                    el('span', { class: 'rs-was', text: was.toFixed(1) + '%' }),
                    ' → ',
                    el('strong', { text: row.support.toFixed(1) + '%' }),
                  ]),
            ]);
          })),

          el('p', { class: 'rs-text', text: report.text }),

          el('div', { class: 'rs-spent' }, [
            el('span', { text: 'Money spent' }),
            el('strong', { text: money.words(report.cost) || '₹0' }),
          ]),

          report.consequence
            ? el('p', { class: 'report-consequence' }, [
                el('strong', { text: report.consequence.label + '. ' }),
                report.consequence.text,
              ])
            : null,

          // Straight on to the next seat, or back to the list. Never out to a
          // dashboard the player then has to navigate back through.
          el('div', { class: 'rs-next' }, [
            opts.nextSeat
              ? el('button', {
                  class: 'btn btn-primary',
                  type: 'button',
                  text: 'Next closest seat',
                  onclick: function () {
                    close();
                    opts.onNext(opts.nextSeat);
                  },
                })
              : null,
            el('button', {
              class: 'btn btn-quiet',
              type: 'button',
              text: 'Back to my areas',
              onclick: function () {
                close();
                if (opts.onAreas) opts.onAreas();
              },
            }),
          ]),
          el('button', {
            class: 'btn btn-quiet btn-wide',
            type: 'button',
            text: 'Stay here',
            onclick: close,
          }),
        ]),
      ]);

      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) close();
      });
      document.body.appendChild(sheet);
    });
  }

  return { open: open, result: result };
})();
