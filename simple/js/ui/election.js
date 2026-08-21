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
 *
 * A campaign runs for fifteen rounds of sixty seconds. The clock at the top is
 * the server's in multiplayer, and everything that spends money asks for
 * confirmation first — the round is short, and a mis-click should not be the
 * reason a campaign runs out of cash.
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
    var projectionNode = el('div', { class: 'projection-slot' });
    var heatNode = el('div', { class: 'heat-card' });
    var fundingNode = el('div', { class: 'action-grid' });
    var breakdownNode = el('div', { class: 'breakdown-slot' });
    var bankSlot = el('div', { class: 'bank-slot' });
    var moneyNode = el('div', { class: 'money-slot' });
    var targetNode = el('div', { class: 'target-card' });
    var reportNode = el('div', { class: 'report-slot' });
    var safeNode = el('div', { class: 'action-grid' });
    var riskyNode = el('div', { class: 'action-grid' });
    var headNode = el('header', { class: 'election-head' });
    var logNode = el('div', { class: 'log' });

    var tabsNode = el('div', { class: 'panel-tabs' });
    var seatNode = el('div', { class: 'seat-detail-slot' });
    var mapNode = el('div', { class: 'map-slot' });
    var oversightNode = el('div', { class: 'oversight-slot' });
    var campaignNode = el('div', { class: 'campaign-slot' });
    var declareNode = el('div', { class: 'declare-slot' });

    var roundView = CMP.ui.round.create({});
    var summaryNode = el('div', { class: 'summary-slot' });
    var resultsNode = el('div', { class: 'results-slot' });

    // The round-results screen, shown while play is locked between rounds.
    var resultsView = CMP.ui.scoreboard.create({
      you: function () {
        return game ? game.partyId : null;
      },
      trend: function () {
        return (game && game.seatTrend) || [];
      },
    });
    CMP.ui.dom.mount(resultsNode, [resultsView.root]);

    var root = el('section', { class: 'screen screen-election' }, [
      el('div', { class: 'election-inner' }, [
        headNode,
        roundView.root,
        resultsNode,
        summaryNode,
        statsNode,
        projectionNode,
        heatNode,
        tabsNode,
        reportNode,
        campaignNode,
        moneyNode,
        mapNode,
        seatNode,
        oversightNode,
        declareNode,
      ]),
    ]);

    // The money tab: where the campaign's cash came from, what is owed, and
    // the two ways of raising more.
    var bankView = CMP.ui.bank.create({
      onBorrow: function (amount) {
        // Borrowing moves cash and debt, both of which are shown at the top
        // of the screen, so repaint the whole panel rather than just the bank.
        return Promise.resolve(opts.borrow(amount)).then(function (res) {
          if (res && res.ok) render(res.game || game);
          return res;
        });
      },
      onNotice: function (text) {
        setNotice(text);
      },
    });
    CMP.ui.dom.mount(bankSlot, [bankView.root]);

    CMP.ui.dom.mount(moneyNode, [
      el('div', { class: 'lobby-section' }, [
        el('h2', { class: 'block-title', text: 'Where the money stands' }),
        breakdownNode,
      ]),
      el('div', { class: 'lobby-section' }, [
        el('div', { class: 'group-head' }, [
          el('h2', { class: 'block-title', text: 'Bank' }),
          el('span', {
            class: 'group-note',
            text: Math.round(CMP.FINANCE.loan.interestRate * 100) + '% interest, due after ' +
              CMP.FINANCE.loan.repayAfterRounds + ' rounds.',
          }),
        ]),
        bankSlot,
      ]),
      el('div', { class: 'lobby-section' }, [
        el('div', { class: 'group-head' }, [
          el('h2', { class: 'block-title', text: 'Raising Funds' }),
          el('span', { class: 'group-note', text: 'One honest route, one that is not.' }),
        ]),
        fundingNode,
      ]),
    ]);

    // The campaign tab's contents, built once and shown or hidden by tab.
    CMP.ui.dom.mount(campaignNode, [
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
    ]);

    var tab = 'campaign';
    var oversight = null;
    var mapView = null;
    var seatHistory = {};   // multiplayer: seat number -> fetched history
    var lastRound = 0;

    function setTab(next) {
      tab = next;
      paintTabs();
    }

    function paintTabs() {
      var tabs = [
        { id: 'campaign', label: 'Campaign' },
        { id: 'money', label: 'Money' },
        { id: 'map', label: 'Map' },
        { id: 'seat', label: 'Constituency' },
      ];
      if (game && game.mode === 'multiplayer') tabs.push({ id: 'rivals', label: 'Rivals' });

      mount(
        tabsNode,
        tabs.map(function (t) {
          return el('button', {
            class: 'panel-tab' + (tab === t.id ? ' is-active' : ''),
            type: 'button',
            text: t.label,
            onclick: function () {
              setTab(t.id);
            },
          });
        })
      );

      // While the round is being counted, nothing that spends money or
      // changes the board is on screen at all. Hiding the controls is clearer
      // than leaving them there disabled, and it puts the scoreboard where
      // the eye already is.
      var counting = isCounting();
      if (counting) {
        // Nothing to act on is actually rendered during the break, rather
        // than rendered and hidden: it saves repainting ten action cards
        // twice a second, and leaves no controls behind for a stray key
        // press to find.
        mount(tabsNode, []);
        mount(safeNode, []);
        mount(riskyNode, []);
        mount(fundingNode, []);
        mount(bankSlot, []);
      }
      tabsNode.style.display = counting ? 'none' : '';
      reportNode.style.display = counting ? 'none' : '';
      projectionNode.style.display = counting ? 'none' : '';
      declareNode.style.display = counting ? 'none' : '';
      resultsNode.style.display = counting ? '' : 'none';

      campaignNode.style.display = !counting && tab === 'campaign' ? '' : 'none';
      moneyNode.style.display = !counting && tab === 'money' ? '' : 'none';
      mapNode.style.display = !counting && tab === 'map' ? '' : 'none';
      seatNode.style.display = !counting && tab === 'seat' ? '' : 'none';
      oversightNode.style.display = !counting && tab === 'rivals' ? '' : 'none';
      if (counting) return;

      if (tab === 'map') paintMap();
      if (tab === 'seat') paintSeatDetail();
      if (tab === 'rivals') paintOversight();
    }

    /**
     * The map is built once and then repainted, because rebuilding 117 paths on
     * every campaign action would throw away the zoom and be visibly slow.
     */
    function paintMap() {
      if (!mapView) {
        mapView = CMP.ui.map.create({
          onSelect: function (num) {
            selected = num;
            paintTarget();
            paintActions();
            setTab('campaign');
          },
        });
        mount(mapNode, [mapView.root]);
      }
      mapView.render(game, selected);
    }

    /**
     * The roster, for the candidate table. Multiplayer takes it from the
     * server view; solo is a roster of one.
     */
    function roster() {
      var view = opts.getServerView && opts.getServerView();
      if (view && view.players) {
        return view.players
          .filter(function (p) {
            return !p.empty && p.partyId;
          })
          .map(function (p) {
            return { partyId: p.partyId, candidateName: p.candidateName, isYou: p.isYou };
          });
      }
      return [{ partyId: game.partyId, candidateName: game.candidateName, isYou: true }];
    }

    /**
     * A seat's round-by-round history. Solo has it locally; multiplayer
     * fetches it once per seat, because fifteen full boards is far more than
     * a poll every couple of seconds should be carrying.
     */
    function historyFor(number) {
      if (game.mode !== 'multiplayer') {
        return (game.history || []).map(function (h) {
          return { round: h.round, support: h.board[number] };
        }).filter(function (h) {
          return !!h.support;
        });
      }

      var key = String(number);
      if (Object.prototype.hasOwnProperty.call(seatHistory, key)) return seatHistory[key];

      seatHistory[key] = [];
      CMP.net.seatHistory(number).then(function (res) {
        if (!res.ok) return;
        seatHistory[String(res.constituency)] = res.history || [];
        if (tab === 'seat' && Number(selected) === Number(res.constituency)) paintSeatDetail();
      });
      return seatHistory[key];
    }

    function paintSeatDetail() {
      mount(seatNode, [
        CMP.ui.constituency.render(game, selected, {
          players: roster(),
          history: historyFor(selected),
          footer: el('button', {
            class: 'btn btn-xl',
            type: 'button',
            text: 'CAMPAIGN HERE',
            onclick: function () {
              setTab('campaign');
            },
          }),
        }),
      ]);
    }

    function paintOversight() {
      if (!opts.getServerView) return;
      var serverView = opts.getServerView();
      if (!serverView) {
        mount(oversightNode, [el('p', { class: 'muted', text: 'Waiting for the server…' })]);
        return;
      }
      if (!oversight) {
        oversight = CMP.ui.oversight.create({});
        mount(oversightNode, [oversight.root]);
      }
      oversight.update(serverView);
    }

    /** The host closes the polls; everyone else waits. */
    function paintDeclare() {
      if (!game || game.mode !== 'multiplayer' || !opts.getServerView) {
        mount(declareNode, []);
        return;
      }
      var serverView = opts.getServerView();
      if (!serverView) return;

      // The campaign ends itself after the last round. This is the host's
      // option to stop early, so it says so rather than implying the count
      // will not happen without them.
      var left = (game.roundsTotal || CMP.ROUNDS.total) - (game.round || 1);

      mount(declareNode, [
        el('div', { class: 'declare-block' }, [
          el('p', { class: 'declare-note', text: left > 0
            ? left + ' round' + (left === 1 ? '' : 's') + ' left. Polls close automatically after round ' +
              (game.roundsTotal || CMP.ROUNDS.total) + '.'
            : 'This is the final round. The count begins when the clock runs out.' }),
          serverView.youAreHost
            ? el('button', {
                class: 'btn btn-quiet',
                type: 'button',
                text: 'Close the polls now',
                onclick: function () {
                  CMP.ui.dialog
                    .confirm({
                      eyebrow: 'Host',
                      title: 'End the campaign early?',
                      body: left > 0
                        ? 'There are still ' + left + ' rounds to play. Closing now counts the ' +
                          'seats as they stand, for everybody.'
                        : 'The seats will be counted as they stand.',
                      confirmLabel: 'Close the polls',
                      danger: true,
                    })
                    .then(function (yes) {
                      if (yes && opts.onDeclare) opts.onDeclare();
                    });
                },
              })
            : null,
        ]),
      ]);
    }

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

    /** True while the round is settled and the scoreboard is up. */
    function isCounting() {
      return !!(game && game.stage === 'results' && game.lastResult);
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

    /**
     * Cash and debt are two separate figures and stay separate. A player
     * carrying two crore of borrowing is not two crore richer, and the top of
     * the screen should never suggest otherwise.
     */
    function paintStats() {
      var cash = CMP.campaign.remaining(game);
      var debt = CMP.campaign.debtOf(game);
      var due = nextDue();

      mount(statsNode, [
        stat('Cash in Hand', money.format(cash), money.words(cash), 'stat-remaining'),
        stat('Spent', money.format(game.spent), pctOf(game.spent, game.budget)),
        stat(
          'Debt',
          debt ? money.format(debt) : '—',
          due ? 'due end of round ' + due : 'nothing owed',
          debt ? 'stat-debt' : ''
        ),
        stat('Seats Led', String(game.seatsWon), 'majority ' + game.majority, 'stat-highlight'),
      ]);
    }

    /** The round the earliest outstanding loan falls due, if any. */
    function nextDue() {
      var rounds = (game.loans || [])
        .filter(function (l) {
          return !l.settled;
        })
        .map(function (l) {
          return l.dueRound;
        });
      return rounds.length ? Math.min.apply(null, rounds) : null;
    }

    function paintProjection() {
      mount(projectionNode, [
        CMP.ui.round.projection(game, CMP.campaign.seatCounts(game.support)),
      ]);
    }

    function paintMoney() {
      mount(breakdownNode, [CMP.ui.bank.breakdown(game)]);
      if (bankSlot.firstChild !== bankView.root) mount(bankSlot, [bankView.root]);
      bankView.render(game);
      mount(fundingNode, CMP.actionsByGroup('funding').map(actionCard));
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
          el('span', { class: 'target-buttons' }, [
            el('button', {
              class: 'btn btn-quiet btn-small',
              type: 'button',
              text: 'Map',
              onclick: function () {
                setTab('map');
              },
            }),
            el('button', {
              class: 'btn btn-quiet btn-small',
              type: 'button',
              text: 'Change',
              onclick: openSeatPicker,
            }),
          ]),
        ]),
        CMP.ui.constituency.leadingBadge(game.support[selected], 'target-leading'),
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
              lastReport.funds
                ? el('span', { class: 'delta up', text: money.words(lastReport.funds) + ' in' })
                : null,
            ]),

            // A costly action moves seats the player did not aim at, so say
            // which ones — otherwise the board appears to shift on its own.
            lastReport.reach && lastReport.reach.length
              ? el('p', {
                  class: 'report-reach',
                  text:
                    'Also felt in ' +
                    lastReport.reach.length +
                    (lastReport.reach.length === 1 ? ' other seat: ' : ' other seats: ') +
                    lastReport.reach
                      .slice(0, 4)
                      .map(function (n) {
                        var d = seatDef(n);
                        return d ? d.name : '#' + n;
                      })
                      .join(', ') +
                    (lastReport.reach.length > 4 ? ' and others.' : '.'),
                })
              : null,
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
            el('span', { class: 'log-round', text: a.round ? 'R' + a.round : '' }),
            el('span', { class: 'log-action', text: a.label }),
            el('span', { class: 'log-where', text: def ? def.name : '—' }),
            el('span', {
              class: 'log-cost',
              text: a.funds ? '+' + money.words(a.funds) : money.words(a.cost) || '—',
            }),
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

    /**
     * Everything that spends money is confirmed first. The dialog states the
     * cost and what it leaves behind, and for a risky move it says plainly
     * that the result is not knowable — but never the odds themselves.
     */
    function runAction(action) {
      if (busy) return;
      var check = CMP.campaign.canPlay(game, action.id, selected);
      if (!check.ok) {
        setNotice(check.reason);
        return;
      }

      var cash = CMP.campaign.remaining(game);
      var def = action.needsConstituency ? seatDef(selected) : null;
      var risky = action.group === 'risky' || action.id === 'underground';

      CMP.ui.dialog
        .confirm({
          eyebrow: def ? def.name + ' · #' + def.number : 'Campaign-wide',
          title: action.label + '?',
          body: action.blurb,
          lines: [
            { label: 'Cost', value: money.words(action.cost) || '₹0' },
            { label: 'Cash after', value: money.words(Math.max(0, cash - action.cost)) || '₹0', strong: true },
            { label: 'Risk', value: action.riskLabel },
            { label: 'Expected effect', value: action.impactLabel },
          ],
          note: risky
            ? 'The result is not certain, and this will raise your political heat.'
            : null,
          danger: risky,
          confirmLabel: 'Go ahead',
        })
        .then(function (yes) {
          if (yes) send(action);
        });
    }

    function send(action) {
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
          paintMoney();
        },
        function () {
          busy = false;
          setNotice('Could not reach the game server.');
          paintActions();
        }
      );
    }

    /* ------------------------------------------------------ public */

    function render(next, secondsFromServer) {
      game = next;
      if (selected === null || !game.support[selected]) selected = pickDefaultSeat();

      // A finished round adds a point to every seat's history.
      if (game.round !== lastRound) {
        lastRound = game.round;
        seatHistory = {};
      }
      paintHead();
      roundView.render(game, secondsFromServer);

      if (isCounting()) {
        resultsView.render(game.lastResult, game.intermissionLeft);
      }

      paintStats();
      paintTabs();

      // Between rounds the campaign surfaces are not on screen, so there is
      // nothing to be gained by painting them.
      if (isCounting()) return;

      paintProjection();
      paintHeat();
      paintTarget();
      paintActions();
      paintMoney();
      paintReport();
      paintLog();
      paintDeclare();
      if (mapView) mapView.render(game, selected);
    }

    return {
      root: root,
      render: render,
      /** Show what the round just did. Replaces any summary still on screen. */
      showSummary: function (summary) {
        var card = CMP.ui.round.summary(game, summary);
        mount(summaryNode, card ? [card] : []);
      },
      stop: function () {
        roundView.stop();
      },
      setReport: function (report) {
        lastReport = report;
        paintReport();
      },
    };
  }

  return { create: create };
})();
