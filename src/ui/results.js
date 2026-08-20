/**
 * Results (Phase 6).
 * ------------------------------------------------------------------
 * An overlay over the map, which by then is showing the declared result seat
 * by seat. The headline answers one question first -- did you form the
 * government -- and only then breaks the numbers down.
 */
window.PG = window.PG || {};
PG.ui = PG.ui || {};

PG.ui.results = (function () {
  'use strict';

  var el = PG.ui.dom.el;
  var mount = PG.ui.dom.mount;
  var fmt = PG.ui.fmt;

  var HEADLINES = {
    majority: {
      kicker: 'Majority won',
      verdict: 'Government formed',
      tone: 'win',
    },
    coalition: {
      kicker: 'Hung assembly',
      verdict: 'Government formed',
      tone: 'win',
    },
    hung: {
      kicker: 'Hung assembly',
      verdict: 'Government not formed',
      tone: 'lose',
    },
    defeat: {
      kicker: 'Defeat',
      verdict: 'Government not formed',
      tone: 'lose',
    },
  };

  function create(opts) {
    var root = el('div', { class: 'results-overlay', 'aria-hidden': 'true' });

    function seatBar(result, playerId) {
      var total = result.total;
      var segments = result.standings.filter(function (s) {
        return s.seats > 0;
      });
      return el('div', { class: 'result-bar-wrap' }, [
        el(
          'div',
          { class: 'result-bar' },
          segments.map(function (s) {
            var p = PG.PARTY_BY_ID[s.id];
            return el('span', {
              class: 'result-seg' + (s.id === playerId ? ' is-you' : ''),
              style: { width: (s.seats / total) * 100 + '%', background: p.colour },
              title: p.name + ': ' + s.seats,
            });
          })
        ),
        el('span', {
          class: 'result-majority-line',
          style: { left: (result.majority / total) * 100 + '%' },
        }),
        el('span', {
          class: 'result-majority-label',
          style: { left: (result.majority / total) * 100 + '%' },
          text: 'Majority ' + result.majority,
        }),
      ]);
    }

    function render(game) {
      var result = game.result;
      if (!result) return;
      var stateDef = PG.getState(game.stateId);
      var playerId = game.player.partyId;
      var party = PG.PARTY_BY_ID[playerId];
      var head = HEADLINES[result.outcome];
      var mine = result.standings.filter(function (s) {
        return s.id === playerId;
      })[0];

      mount(root, [
        el('div', { class: 'results-card tone-' + head.tone }, [
          el('div', { class: 'results-head' }, [
            el('span', { class: 'results-kicker', text: stateDef.electionName }),
            el('h1', { class: 'results-verdict', text: head.verdict }),
            el('p', { class: 'results-line' }, [
              result.total + ' seats · majority ' + result.majority + ' · ',
              el('strong', { text: head.kicker }),
            ]),
          ]),

          result.governmentFormed
            ? el('div', { class: 'results-office' }, [
                el('span', { class: 'office-label', text: 'Sworn in as' }),
                el('span', { class: 'office-title', text: stateDef.office }),
                el('span', { class: 'office-name', text: game.player.name }),
                el('span', { class: 'office-party', style: { color: party.colour }, text: party.name }),
                result.coalition
                  ? el('span', {
                      class: 'office-note',
                      text:
                        'In coalition with ' +
                        PG.PARTY_BY_ID[result.coalition.partnerId].name +
                        ' — ' +
                        result.coalition.total +
                        ' seats together.',
                    })
                  : null,
              ])
            : el('div', { class: 'results-office is-lost' }, [
                el('span', { class: 'office-label', text: 'You finish on' }),
                el('span', { class: 'office-title', text: result.playerSeats + ' seats' }),
                el('span', {
                  class: 'office-note',
                  text:
                    result.playerSeats >= result.majority
                      ? ''
                      : Math.max(0, result.majority - result.playerSeats) +
                        ' short of the ' +
                        result.majority +
                        ' needed to form a government.',
                }),
              ]),

          seatBar(result, playerId),

          el('div', { class: 'table-wrap results-table-wrap' }, [
            el('table', { class: 'data-table results-table' }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', { class: 'ta-left', text: 'Party' }),
                  el('th', { text: 'Seats' }),
                  el('th', { text: 'Change' }),
                  el('th', { text: 'Vote share' }),
                ]),
              ]),
              el(
                'tbody',
                {},
                result.standings.map(function (s) {
                  var p = PG.PARTY_BY_ID[s.id];
                  return el('tr', { class: s.id === playerId ? 'is-you' : '' }, [
                    el('td', { class: 'ta-left' }, [
                      el('span', { class: 'standing-dot', style: { background: p.colour } }),
                      el('span', { text: p.name }),
                    ]),
                    el('td', { class: 'num-strong', text: s.seats }),
                    el('td', {
                      class: s.change > 0 ? 'delta-up' : s.change < 0 ? 'delta-down' : 'delta-flat',
                      text: s.change === 0 ? '—' : fmt.signed(s.change),
                    }),
                    el('td', { text: fmt.pct(s.voteShare, 1) }),
                  ]);
                })
              ),
            ]),
          ]),

          el('div', { class: 'results-stats' }, [
            stat('Seats won', mine.seats + ' of ' + result.total),
            stat('Vote share', fmt.pct(mine.voteShare, 1)),
            stat('Change', mine.change === 0 ? 'no change' : fmt.signed(mine.change) + ' seats'),
            stat('Spent', fmt.money(game, result.spent) + ' of ' + fmt.money(game, result.budget)),
          ]),

          el('div', { class: 'results-actions' }, [
            el('button', {
              class: 'btn btn-primary',
              type: 'button',
              text: 'Play again',
              onclick: function () {
                hide();
                opts.onRestart();
              },
            }),
            el('button', {
              class: 'btn',
              type: 'button',
              text: 'Review the map',
              onclick: hide,
            }),
          ]),
        ]),
      ]);
    }

    function stat(label, value) {
      return el('div', { class: 'results-stat' }, [
        el('span', { class: 'results-stat-label', text: label }),
        el('span', { class: 'results-stat-value', text: value }),
      ]);
    }

    function show(game) {
      render(game);
      root.classList.add('is-visible');
      root.setAttribute('aria-hidden', 'false');
    }

    function hide() {
      root.classList.remove('is-visible');
      root.setAttribute('aria-hidden', 'true');
    }

    return { root: root, show: show, hide: hide, render: render };
  }

  return { create: create };
})();
