/**
 * Election screen: the campaign panel.
 * ------------------------------------------------------------------
 * Budget, remaining, heat, the seat you are targeting, and the two groups of
 * actions you can spend on. Every cost, label and effect is read from
 * CMP.CAMPAIGN — nothing here hard-codes a number.
 *
 * It never shows the odds behind a risky action. The player gets a cost, a
 * risk word and an impact word, and has to decide with that.
 *
 * The screen does not resolve anything itself: it calls opts.play(), which is
 * the local engine in solo and the server in multiplayer.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.election = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  function create(opts) {
    var game = null;
    var selected = null;
    var lastReport = null;
    var notice = null;
    var busy = false;

    var statsNode = el('div', { class: 'stat-row stat-row-4' });
    var heatNode = el('div', { class: 'heat-card' });
    var targetNode = el('div', { class: 'target-card' });
    var reportNode = el('div', { class: 'report-slot' });
    var safeNode = el('div', { class: 'action-grid' });
    var riskyNode = el('div', { class: 'action-grid' });
    var headNode = el('header', { class: 'election-head' });
    var logNode = el('div', { class: 'log' });

    var root = el('section', { class: 'screen screen-election' }, [
      el('div', { class: 'election-inner' }, [
        headNode,
        statsNode,
        heatNode,
        reportNode,
        el('div', { class: 'lobby-section' }, [
          el('h2', { class: 'block-title', text: 'Target Constituency' }),
          targetNode,
        ]),
        el('div', { class: 'lobby-section' }, [
          el('div', { class: 'group-head' }, [
            el('h2', { class: 'block-title', text: 'Safe Campaign' }),
            el('span', { class: 'group-note', text: 'Predictable. Little or no heat.' }),
          ]),
          safeNode,
        ]),
        el('div', { class: 'lobby-section' }, [
          el('div', { class: 'group-head' }, [
            el('h2', { class: 'block-title risky-title', text: 'Risky Strategies' }),
            el('span', { class: 'group-note', text: 'Bigger swings, uncertain results, and heat.' }),
          ]),
          riskyNode,
        ]),
        el('div', { class: 'lobby-section' }, [
          el('h2', { class: 'block-title', text: 'Campaign Log' }),
          logNode,
        ]),
      ]),
    ]);

    /* ------------------------------------------------------ helpers */

    function seatDef(number) {
      for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
        if (CMP.CONSTITUENCIES[i].number === Number(number)) return CMP.CONSTITUENCIES[i];
      }
      return null;
    }

    /** Default to the tightest race — where money is most likely to matter. */
    function pickDefaultSeat() {
      var best = null;
      Object.keys(game.support).forEach(function (number) {
        var view = CMP.campaign.seatView(game, number);
        if (!view) return;
        if (!best || view.margin < best.margin) best = view;
      });
      return best ? Number(best.number) : CMP.CONSTITUENCIES[0].number;
    }

    function setNotice(text, tone) {
      notice = text ? { text: text, tone: tone || 'bad' } : null;
      paintReport();
    }

    /* ------------------------------------------------------ painting */

    function paintHead() {
      var party = CMP.getParty(game.partyId);
      mount(headNode, [
        el('div', { class: 'election-head-top' }, [
          el('div', {}, [
            el('h1', { class: 'title title-sm', text: 'Punjab Assembly Election' }),
            el('p', { class: 'subtitle' }, [
              el('strong', { text: CMP.TOTAL_SEATS + ' Constituencies' }),
            ]),
          ]),
          el('button', {
            class: 'btn btn-quiet',
            type: 'button',
            text: 'Menu',
            onclick: opts.onMenu,
          }),
        ]),
        el('div', { class: 'campaign-card', style: { '--party': party.colour, '--party-ink': party.ink } }, [
          el('span', { class: 'campaign-flag', text: party.short }),
          el('div', { class: 'campaign-body' }, [
            el('span', { class: 'campaign-party', text: party.name }),
            el('strong', { class: 'campaign-name', text: game.candidateName }),
            el('span', { class: 'campaign-slogan', text: '“' + game.slogan + '”' }),
          ]),
          game.gameCode
            ? el('span', { class: 'campaign-code', text: game.gameCode })
            : null,
        ]),
      ]);
    }

    function paintStats() {
      var remaining = CMP.campaign.remaining(game);
      mount(statsNode, [
        stat('Election Budget', money.format(game.budget), money.words(game.budget)),
        stat('Spent', money.format(game.spent), pctOf(game.spent, game.budget)),
        stat('Remaining Budget', money.format(remaining), money.words(remaining), 'stat-remaining'),
        stat('Seats Led', String(game.seatsWon), 'majority ' + game.majority, 'stat-highlight'),
      ]);
    }

    function pctOf(part, whole) {
      if (!whole) return '';
      return Math.round((part / whole) * 100) + '% of purse';
    }

    function stat(label, value, sub, extra) {
      return el('div', { class: 'stat' + (extra ? ' ' + extra : '') }, [
        el('span', { class: 'stat-label', text: label }),
        el('span', { class: 'stat-value', text: value }),
        sub ? el('span', { class: 'stat-sub', text: sub }) : null,
      ]);
    }

    function paintHeat() {
      var level = CMP.campaign.heatLevel(game.heat);
      var max = CMP.CAMPAIGN.heat.max;
      mount(heatNode, [
        el('div', { class: 'heat-top' }, [
          el('span', { class: 'stat-label', text: 'Political Heat' }),
          el('span', { class: 'heat-value', style: { color: level.colour } }, [
            Math.round(game.heat) + ' / ' + max,
            el('span', { class: 'heat-level', text: level.label }),
          ]),
        ]),
        el('div', { class: 'heat-track' }, [
          el('span', {
            class: 'heat-fill',
            style: { width: (game.heat / max) * 100 + '%', background: level.colour },
          }),
        ]),
        el('p', {
          class: 'heat-note',
          text:
            game.heat < CMP.CAMPAIGN.heat.minHeat
              ? 'Nothing to worry about yet.'
              : 'The higher this climbs, the more likely your campaign runs into trouble.',
        }),
      ]);
    }

    function paintTarget() {
      var view = CMP.campaign.seatView(game, selected);
      var def = seatDef(selected);
      if (!view || !def) {
        mount(targetNode, [el('p', { class: 'muted', text: 'No constituency selected.' })]);
        return;
      }
      var opponent = view.opponentId ? CMP.getParty(view.opponentId) : null;

      mount(targetNode, [
        el('div', { class: 'target-head' }, [
          el('div', {}, [
            el('span', { class: 'target-number', text: '#' + def.number }),
            el('strong', { class: 'target-name', text: def.name }),
            el('span', { class: 'target-district', text: def.district }),
          ]),
          el('button', {
            class: 'btn btn-quiet btn-small',
            type: 'button',
            text: 'Change',
            onclick: openSeatPicker,
          }),
        ]),
        el('div', { class: 'target-numbers' }, [
          numberBlock('Your Support', view.player.toFixed(1) + '%', CMP.getParty(game.partyId).colour),
          numberBlock(
            opponent ? opponent.short : 'Opponent',
            view.opponent.toFixed(1) + '%',
            opponent ? opponent.colour : '#888'
          ),
          el('div', { class: 'number-block' }, [
            el('span', { class: 'stat-label', text: 'Status' }),
            el('span', { class: 'target-rating rating-' + view.rating.id, text: view.rating.label }),
          ]),
        ]),
      ]);
    }

    function numberBlock(label, value, colour) {
      return el('div', { class: 'number-block' }, [
        el('span', { class: 'stat-label', text: label }),
        el('span', { class: 'number-value', style: { color: colour }, text: value }),
      ]);
    }

    function paintActions() {
      mount(safeNode, CMP.actionsByGroup('safe').map(actionCard));
      mount(riskyNode, CMP.actionsByGroup('risky').map(actionCard));
    }

    /**
     * One action. Shows cost, a risk word and an impact word — never the
     * underlying probabilities.
     */
    function actionCard(action) {
      var check = CMP.campaign.canPlay(game, action.id, selected);
      var affordable = action.cost <= CMP.campaign.remaining(game);

      return el(
        'button',
        {
          class:
            'action-card action-' + action.group + (check.ok ? '' : ' is-disabled'),
          type: 'button',
          disabled: !check.ok || busy,
          onclick: function () {
            runAction(action);
          },
        },
        [
          el('span', { class: 'action-icon', text: action.icon }),
          el('span', { class: 'action-main' }, [
            el('span', { class: 'action-label', text: action.label }),
            el('span', { class: 'action-blurb', text: action.blurb }),
            el('span', { class: 'action-meta' }, [
              el('span', { class: 'action-risk risk-' + action.group, text: action.riskLabel }),
              el('span', { class: 'action-impact', text: action.impactLabel }),
            ]),
          ]),
          el('span', { class: 'action-cost' }, [
            el('span', {
              class: 'action-cost-value' + (affordable ? '' : ' is-short'),
              text: money.words(action.cost),
            }),
            !check.ok
              ? el('span', { class: 'action-why', text: check.reason })
              : null,
          ]),
        ]
      );
    }

    function paintReport() {
      var items = [];
      if (notice) {
        items.push(el('p', { class: 'notice notice-' + notice.tone, text: notice.text }));
      }
      if (lastReport) {
        var good = lastReport.support > 0 || lastReport.opponentSupport < 0;
        var def = lastReport.constituency ? seatDef(lastReport.constituency) : null;
        items.push(
          el('div', { class: 'report ' + (good ? 'is-good' : 'is-bad') }, [
            el('div', { class: 'report-head' }, [
              el('strong', { text: lastReport.outcomeLabel }),
              def ? el('span', { class: 'report-where', text: def.name }) : null,
            ]),
            el('p', { class: 'report-text', text: lastReport.text }),
            el('div', { class: 'report-deltas' }, [
              lastReport.support
                ? el('span', {
                    class: 'delta ' + (lastReport.support > 0 ? 'up' : 'down'),
                    text: (lastReport.support > 0 ? '+' : '') + lastReport.support.toFixed(1) + '% you',
                  })
                : null,
              lastReport.opponentSupport
                ? el('span', {
                    class: 'delta ' + (lastReport.opponentSupport < 0 ? 'up' : 'down'),
                    text: lastReport.opponentSupport.toFixed(1) + '% rival',
                  })
                : null,
              lastReport.heatAfter > lastReport.heatBefore
                ? el('span', {
                    class: 'delta heat',
                    text: '+' + Math.round(lastReport.heatAfter - lastReport.heatBefore) + ' heat',
                  })
                : null,
            ]),
            lastReport.consequence
              ? el('div', { class: 'consequence' }, [
                  el('strong', { text: lastReport.consequence.label }),
                  el('span', { text: ' ' + lastReport.consequence.text }),
                  el('span', {
                    class: 'consequence-seats',
                    text:
                      ' Support fell in ' +
                      lastReport.consequence.seats.length +
                      (lastReport.consequence.seats.length === 1 ? ' seat.' : ' seats.'),
                  }),
                ])
              : null,
          ])
        );
      }
      mount(reportNode, items);
    }

    function paintLog() {
      var recent = (game.actions || []).slice(-8).reverse();
      if (!recent.length) {
        mount(logNode, [
          el('p', { class: 'muted', text: 'Nothing spent yet. Pick a constituency and choose a move.' }),
        ]);
        return;
      }
      mount(
        logNode,
        recent.map(function (a) {
          var def = a.constituency ? seatDef(a.constituency) : null;
          return el('div', { class: 'log-row log-' + a.group }, [
            el('span', { class: 'log-action', text: a.label }),
            el('span', { class: 'log-where', text: def ? def.name : '—' }),
            el('span', { class: 'log-cost', text: money.words(a.cost) }),
            el('span', {
              class: 'log-result ' + (a.support > 0 ? 'up' : a.support < 0 ? 'down' : ''),
              text: a.support ? (a.support > 0 ? '+' : '') + a.support.toFixed(1) + '%' : '—',
            }),
          ]);
        })
      );
    }

    /* ------------------------------------------------------ seat picker */

    function openSeatPicker() {
      var overlay = el('div', { class: 'overlay' });
      function close() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }

      var listNode = el('div', { class: 'picker-list' });
      var search = el('input', {
        class: 'field-input',
        type: 'text',
        autocomplete: 'off',
        placeholder: 'Search by name or district',
        oninput: function (e) {
          renderList(e.target.value);
        },
      });

      function renderList(filter) {
        var q = (filter || '').toLowerCase();
        var rows = CMP.CONSTITUENCIES.filter(function (c) {
          if (!q) return true;
          return (
            c.name.toLowerCase().indexOf(q) !== -1 || c.district.toLowerCase().indexOf(q) !== -1
          );
        })
          .map(function (c) {
            return { def: c, view: CMP.campaign.seatView(game, c.number) };
          })
          .filter(function (r) {
            return r.view;
          })
          .sort(function (a, b) {
            return a.view.margin - b.view.margin;
          })
          .slice(0, 60);

        mount(
          listNode,
          rows.map(function (r) {
            return el(
              'button',
              {
                class: 'picker-row' + (r.def.number === selected ? ' is-selected' : ''),
                type: 'button',
                onclick: function () {
                  selected = r.def.number;
                  close();
                  paintTarget();
                  paintActions();
                },
              },
              [
                el('span', { class: 'picker-number', text: r.def.number }),
                el('span', { class: 'picker-name' }, [
                  el('strong', { text: r.def.name }),
                  el('span', { class: 'picker-district', text: r.def.district }),
                ]),
                el('span', { class: 'picker-numbers' }, [
                  el('span', { class: 'picker-you', text: r.view.player.toFixed(0) + '%' }),
                  el('span', { class: 'picker-vs', text: 'vs' }),
                  el('span', { class: 'picker-them', text: r.view.opponent.toFixed(0) + '%' }),
                ]),
                el('span', {
                  class: 'picker-rating rating-' + r.view.rating.id,
                  text: r.view.rating.label,
                }),
              ]
            );
          })
        );
      }

      mount(overlay, [
        el('div', { class: 'modal modal-wide' }, [
          el('div', { class: 'picker-head' }, [
            el('h2', { text: 'Select Constituency' }),
            el('button', {
              class: 'btn btn-quiet btn-small',
              type: 'button',
              text: 'Close',
              onclick: close,
            }),
          ]),
          el('p', { class: 'muted', text: 'Closest races first — those are the ones money can flip.' }),
          search,
          listNode,
        ]),
      ]);
      renderList('');
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
      document.body.appendChild(overlay);
    }

    /* ------------------------------------------------------ actions */

    function runAction(action) {
      if (busy) return;
      var check = CMP.campaign.canPlay(game, action.id, selected);
      if (!check.ok) {
        setNotice(check.reason);
        return;
      }
      busy = true;
      paintActions();

      Promise.resolve(opts.play(action.id, selected)).then(
        function (res) {
          busy = false;
          if (!res || !res.ok) {
            setNotice((res && res.reason) || 'That action could not be played.');
            paintActions();
            return;
          }
          notice = null;
          lastReport = res.report;
          render(res.game || game);
        },
        function () {
          busy = false;
          setNotice('Could not reach the game server.');
          paintActions();
        }
      );
    }

    /* ------------------------------------------------------ public */

    function render(next) {
      game = next;
      if (selected === null || !game.support[selected]) selected = pickDefaultSeat();
      paintHead();
      paintStats();
      paintHeat();
      paintTarget();
      paintActions();
      paintReport();
      paintLog();
    }

    return {
      root: root,
      render: render,
      setReport: function (report) {
        lastReport = report;
        paintReport();
      },
    };
  }

  return { create: create };
})();
