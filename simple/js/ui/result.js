/**
 * Result and government formation.
 * ------------------------------------------------------------------
 * Three states in one screen:
 *   majority   — somebody cleared 59 and is Chief Minister
 *   hung       — nobody did, so coalition talks open
 *   government — a coalition was agreed
 *
 * The coalition half is only shown when it is actually live, so a clean
 * majority result stays a clean result screen.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.result = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var svg = CMP.ui.dom.svg;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  function create(opts) {
    var view = null; // the server's game view
    var notice = null;
    var draft = { partnerId: '', chiefMinisterId: '', cabinet: '', policy: '', resources: '' };

    // Counting state. A result that lands complete in one frame tells you the
    // number but not the evening; declaring the seats in order gives the count
    // somewhere to build, and a player something to watch.
    var counting = false;
    var declared = 0;
    var countTimer = null;
    var seatOrder = [];

    var root = el('section', { class: 'screen screen-result' });

    function me() {
      if (!view) return null;
      for (var i = 0; i < view.players.length; i++) {
        if (!view.players[i].empty && view.players[i].isYou) return view.players[i];
      }
      return null;
    }

    function playerById(id) {
      for (var i = 0; i < view.players.length; i++) {
        if (!view.players[i].empty && view.players[i].id === id) return view.players[i];
      }
      return null;
    }

    function nameFor(id) {
      var p = playerById(id);
      if (!p) return 'Unknown';
      var party = CMP.getParty(p.partyId);
      return (p.candidateName || 'Player ' + p.slot) + ' (' + (party ? party.short : '—') + ')';
    }

    function setNotice(text, tone) {
      notice = text ? { text: text, tone: tone || 'bad' } : null;
      paint();
    }

    function send(payload) {
      CMP.net.coalition(payload).then(function (res) {
        if (!res.ok) {
          setNotice(res.error);
          return;
        }
        notice = null;
        if (res.game) update(res.game);
        CMP.net.refresh();
      });
    }

    /* ------------------------------------------------------ counting */

    var SEATS_PER_TICK = 3;
    var TICK_MS = 90;

    function startCount() {
      if (!view || !view.result || !view.result.perSeat) return;
      seatOrder = Object.keys(view.result.perSeat)
        .map(Number)
        .sort(function (a, b) {
          return a - b;
        });
      counting = true;
      declared = 0;
      tick();
      paint();
    }

    function tick() {
      if (countTimer !== null) window.clearTimeout(countTimer);
      countTimer = window.setTimeout(function () {
        declared = Math.min(seatOrder.length, declared + SEATS_PER_TICK);
        if (declared >= seatOrder.length) {
          finishCount();
          return;
        }
        paintCount();
        tick();
      }, TICK_MS);
    }

    function finishCount() {
      if (countTimer !== null) window.clearTimeout(countTimer);
      countTimer = null;
      counting = false;
      declared = seatOrder.length;
      paint();
    }

    /** How far the count has got, for the "117 of 117 counted" line. */
    function countedLine() {
      var total = view.result.totalSeats;
      return total + ' of ' + total + ' seats counted';
    }

    /** Running totals from the seats declared so far. */
    function runningTotals() {
      var totals = {};
      CMP.PARTIES.forEach(function (p) {
        totals[p.id] = 0;
      });
      for (var i = 0; i < declared; i++) {
        var seat = view.result.perSeat[String(seatOrder[i])];
        if (seat && seat.winner) totals[seat.winner] = (totals[seat.winner] || 0) + 1;
      }
      return totals;
    }

    function seatName(number) {
      for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
        if (CMP.CONSTITUENCIES[i].number === Number(number)) return CMP.CONSTITUENCIES[i].name;
      }
      return 'AC ' + number;
    }

    var countNode = el('div', { class: 'count-live' });

    /** Repaint only the counting block, so the whole screen does not flicker. */
    function paintCount() {
      var result = view.result;
      var totals = runningTotals();
      var rows = CMP.PARTIES.map(function (p) {
        return { party: p, seats: totals[p.id] || 0 };
      }).sort(function (a, b) {
        return b.seats - a.seats;
      });

      var recent = [];
      for (var i = Math.max(0, declared - 6); i < declared; i++) {
        var number = seatOrder[i];
        var seat = result.perSeat[String(number)];
        var party = CMP.getParty(seat.winner);
        recent.unshift(
          el('li', { class: 'count-seat' }, [
            el('span', { class: 'count-ac', text: '#' + number }),
            el('span', { class: 'count-name', text: seatName(number) }),
            el('span', {
              class: 'count-winner',
              style: { '--party': party.colour, '--party-ink': party.ink },
              text: party.short,
            }),
            el('span', {
              class: 'count-margin',
              text: seat.margin < 2 ? 'held by ' + seat.margin.toFixed(1) : '',
            }),
          ])
        );
      }

      mount(countNode, [
        el('div', { class: 'count-head' }, [
          el('span', { class: 'stat-label', text: 'Counting' }),
          el('strong', {
            class: 'count-progress',
            text: declared + ' of ' + seatOrder.length + ' declared',
          }),
          el('button', {
            class: 'btn btn-quiet btn-small',
            type: 'button',
            text: 'Show the result',
            onclick: finishCount,
          }),
        ]),
        el('div', { class: 'count-track' }, [
          el('span', {
            class: 'count-fill',
            style: { width: (declared / seatOrder.length) * 100 + '%' },
          }),
        ]),
        el(
          'div',
          { class: 'count-bars' },
          rows.map(function (row) {
            var past = row.seats >= result.majority;
            return el(
              'div',
              {
                class: 'count-row' + (past ? ' is-past' : ''),
                style: { '--party': row.party.colour },
              },
              [
                el('span', { class: 'count-party', text: row.party.short }),
                el('span', { class: 'count-bar' }, [
                  el('span', {
                    class: 'count-bar-fill',
                    style: { width: (row.seats / result.totalSeats) * 100 + '%' },
                  }),
                ]),
                el('span', { class: 'count-seats', text: String(row.seats) }),
              ]
            );
          })
        ),
        el('p', {
          class: 'count-majority',
          text: result.majority + ' seats needed for a majority.',
        }),
        el('ul', { class: 'count-list' }, recent),
      ]);
    }

    /* ------------------------------------------------------ sections */

    /** The portrait seed for whoever played a party, if anyone did. */
    function avatarFor(partyId) {
      for (var i = 0; i < view.players.length; i++) {
        var p = view.players[i];
        if (!p.empty && p.partyId === partyId && p.avatar) return p.avatar;
      }
      return null;
    }

    /**
     * The final standings as a leaderboard with faces, so the election ends
     * the way every round ended rather than dropping to a bare table.
     */
    function finalBoard() {
      var result = view.result;
      // Every party in the game stands: there is no "others" bucket any more,
      // because there are no parties in this election nobody is playing.
      var standings = result.standings
        .map(function (row) {
          return {
            party: row.party,
            playerId: row.playerId,
            candidateName: row.candidate,
            avatar: avatarFor(row.party),
            isAI: isAIParty(row.party),
            seats: row.seats,
            change: 0,
            disqualified: !!row.disqualified,
          };
        });

      var mine = me();
      return el('div', { class: 'final-board' }, [
        CMP.ui.scoreboard.leaderboard(
          {
            standings: standings,
            majority: result.majority,
            totalSeats: result.totalSeats,
          },
          mine ? mine.partyId : null,
          {}
        ),
      ]);
    }

    function isAIParty(partyId) {
      for (var i = 0; i < view.players.length; i++) {
        var p = view.players[i];
        if (!p.empty && p.partyId === partyId) return !!p.isAI;
      }
      return false;
    }

    function resultTable() {
      var result = view.result;
      return el('div', { class: 'result-block' }, [
        el('h2', { class: 'result-heading', text: 'Punjab Election Result' }),
        seatDonut(result),
        el(
          'div',
          { class: 'result-rows' },
          result.standings.map(function (s) {
            var party = CMP.getParty(s.party);
            return el('div', { class: 'result-row' + (s.disqualified ? ' is-out' : '') }, [
              el('span', { class: 'result-party' }, [
                el('span', { class: 'race-dot', style: { background: party.colour } }),
                party.short,
              ]),
              el('span', { class: 'result-candidate', text: s.candidate || party.name }),
              el('span', { class: 'result-track' }, [
                el('span', {
                  class: 'result-fill',
                  style: {
                    width: (s.seats / result.totalSeats) * 100 + '%',
                    background: party.colour,
                  },
                }),
              ]),
              el('span', { class: 'result-seats', text: s.seats }),
              s.disqualified ? el('span', { class: 'result-out', text: 'OUT' }) : null,
            ]);
          })
        ),
        el('div', { class: 'result-totals' }, [
          el('span', {}, ['Total ', el('strong', { text: String(result.totalSeats) })]),
          el('span', {}, ['Majority ', el('strong', { text: String(result.majority) })]),
        ]),
      ]);
    }

    /**
     * What each campaign built, rather than what it won.
     *
     * Seats are the result; districts and the money they paid are the reason
     * for it. A campaign that took six districts and ran on their grants
     * fought a different election from one that spent its allowance and never
     * held ground, and the seat count alone hides that entirely.
     */
    function campaignNumbers() {
      var rows = (view.result.standings || []).filter(function (s) {
        return s.districts || s.grantIncome;
      });
      if (!rows.length) return null;

      return el('section', { class: 'result-block' }, [
        el('h3', { class: 'result-subheading', text: 'The campaign in numbers' }),
        el('div', { class: 'cn-rows' }, view.result.standings.map(function (s) {
          var party = CMP.getParty(s.party);
          return el('div', { class: 'cn-row' }, [
            el('span', { class: 'cn-party' }, [
              el('span', { class: 'race-dot', style: { background: party.colour } }),
              party.short,
            ]),
            el('span', { class: 'cn-fig' }, [
              el('strong', { text: String(s.districts || 0) }),
              el('span', { class: 'cn-label', text: 'districts' }),
            ]),
            el('span', { class: 'cn-fig' }, [
              el('strong', { text: CMP.ui.money.words(s.grantIncome || 0) }),
              el('span', { class: 'cn-label', text: 'in grants' }),
            ]),
          ]);
        })),
        el('p', {
          class: 'ar-block-note',
          text: 'Districts held when the polls closed, and what those ' +
            'districts paid out across the campaign.',
        }),
      ]);
    }

    /**
     * The whole assembly as one ring.
     *
     * A hundred and seventeen seats divided four ways is the single fact the
     * result screen exists to state, and a ring states it before anybody reads
     * a number. The majority is marked on it, so "did anybody get there" is
     * answered by looking rather than by arithmetic.
     */
    function seatDonut(result) {
      var total = result.totalSeats || 117;
      var R = 42;
      var C = 2 * Math.PI * R;
      var offset = 0;

      var arcs = result.standings.map(function (row) {
        var party = CMP.getParty(row.party);
        var length = (row.seats / total) * C;
        var node = svg('circle', {
          class: 'ring-arc',
          cx: '50', cy: '50', r: String(R),
          fill: 'none',
          stroke: party ? party.colour : 'var(--line)',
          'stroke-width': '14',
          'stroke-dasharray': length + ' ' + (C - length),
          'stroke-dashoffset': String(-offset),
        });
        offset += length;
        return node;
      });

      var top = result.standings.slice().sort(function (a, b) {
        return b.seats - a.seats;
      })[0];

      return el('div', { class: 'rd-block' }, [
        el('div', { class: 'rd-wrap' }, [
          svg('svg', {
            class: 'ring', viewBox: '0 0 100 100', role: 'img',
            'aria-label': result.standings.map(function (r) {
              var p = CMP.getParty(r.party);
              return (p ? p.short : r.party) + ' ' + r.seats;
            }).join(', '),
          }, [
            svg('circle', {
              cx: '50', cy: '50', r: String(R),
              fill: 'none', stroke: 'var(--line-soft)', 'stroke-width': '14',
            }),
          ].concat(arcs)),
          el('div', { class: 'rd-centre' }, [
            el('strong', { class: 'rd-value', text: String(top ? top.seats : 0) }),
            el('span', { class: 'rd-label', text: 'of ' + total }),
          ]),
        ]),

        el('ul', { class: 'rd-key' }, result.standings.slice().sort(function (a, b) {
          return b.seats - a.seats;
        }).map(function (row) {
          var party = CMP.getParty(row.party);
          return el('li', { class: 'rd-key-row' }, [
            el('span', {
              class: 'rd-key-dot',
              style: { background: party ? party.colour : 'var(--line)' },
            }),
            el('span', { class: 'rd-key-label', text: party ? party.short : row.party }),
            el('strong', { class: 'rd-key-value', text: String(row.seats) }),
            el('span', {
              class: 'rd-key-share',
              text: Math.round((row.seats / total) * 1000) / 10 + '%',
            }),
          ]);
        })),

        el('p', {
          class: 'rd-note',
          text: (result.majority || 59) + ' seats is a majority.',
        }),
      ]);
    }

    function verdictBanner() {
      var result = view.result;
      var coalition = view.coalition || {};

      if (coalition.status === 'formed') {
        var cm = playerById(coalition.chiefMinisterId);
        var dep = playerById(coalition.deputyId);
        var cabinet = labelFrom('cabinetSplits', coalition.cabinet);
        var policy = labelFrom('policies', coalition.policy);
        var resources = labelFrom('resourceTerms', coalition.resources);

        return el('div', { class: 'verdict verdict-win' }, [
          el('span', { class: 'verdict-kicker', text: 'Coalition Government Formed' }),
          el('h1', { class: 'verdict-title', text: coalition.combined + ' seats together' }),
          el('div', { class: 'coalition-summary' }, [
            summaryRow('Chief Minister', cm ? cm.candidateName : '—'),
            summaryRow('Deputy Chief Minister', dep ? dep.candidateName : '—'),
            summaryRow('Cabinet', cabinet),
            summaryRow('Policy priority', policy),
            summaryRow('Resources', resources),
          ]),
          el('p', {
            class: 'verdict-congrats',
            text:
              me() && coalition.members.indexOf(me().id) !== -1
                ? 'Congratulations — you have formed the Government of Punjab.'
                : 'A government has been formed without you.',
          }),
        ]);
      }

      if (result.outcome === 'majority' && result.winner) {
        var winnerIsYou = me() && result.winner.playerId === me().id;
        var party = CMP.getParty(result.winner.party);
        var seed = avatarFor(result.winner.party);

        return el('div', { class: 'verdict ' + (winnerIsYou ? 'verdict-win' : 'verdict-lose') }, [
          el('span', { class: 'verdict-kicker', text: 'Majority Government' }),
          el('h1', { class: 'verdict-title', text: result.winner.seats + ' of ' + result.totalSeats }),

          el('div', {
            class: 'winner-card',
            style: { '--party': party.colour, '--party-ink': party.ink || '#fff' },
          }, [
            seed ? CMP.ui.portrait.render(seed, 92, result.winner.candidate) : null,
            el('div', { class: 'winner-body' }, [
              el('span', { class: 'winner-kicker', text: 'Chief Minister of Punjab' }),
              el('strong', { class: 'winner-name', text: result.winner.candidate || party.name }),
              el('span', { class: 'winner-party', text: party.name }),
              el('span', {
                class: 'winner-seats',
                text: result.winner.seats + ' seats · majority ' + result.majority,
              }),
            ]),
          ]),

          el('p', {
            class: 'verdict-congrats',
            text: winnerIsYou
              ? 'Congratulations — you have formed the Government of Punjab.'
              : 'Your campaign fell short this time.',
          }),
        ]);
      }

      return el('div', { class: 'verdict verdict-hung' }, [
        el('span', { class: 'verdict-kicker', text: 'Hung Assembly' }),
        el('h1', { class: 'verdict-title', text: 'No party reached ' + result.majority }),
        el('p', {
          class: 'verdict-congrats',
          text: 'No party has a majority. Government formation moves to coalition talks.',
        }),
      ]);
    }

    function summaryRow(label, value) {
      return el('div', { class: 'summary-row' }, [
        el('span', { class: 'stat-label', text: label }),
        el('span', { class: 'summary-value', text: value }),
      ]);
    }

    function labelFrom(listKey, id) {
      var list = (CMP.CAMPAIGN.coalition || {})[listKey] || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return list[i].label;
      }
      return '—';
    }

    /* ------------------------------------------------------ coalition */

    function coalitionSection() {
      var coalition = view.coalition || {};
      if (view.result.outcome !== 'hung' || coalition.status === 'formed') return null;

      var mine = me();
      if (!mine) return null;

      var proposal = coalition.proposal;
      if (proposal) return proposalCard(proposal, mine);

      var options = (view.possibleCoalitions || []).filter(function (pair) {
        return pair.a.playerId === mine.id || pair.b.playerId === mine.id;
      });

      return el('div', { class: 'coalition-block' }, [
        el('h2', { class: 'result-heading', text: 'Government Formation' }),
        coalition.status === 'failed'
          ? el('p', { class: 'notice notice-info', text: 'The last talks broke down. Another pairing can be tried.' })
          : null,
        /*
         * Four campaigns can finish close enough together that no two of them
         * reach 59 between them. That is a real outcome rather than a missing
         * option, so it is stated plainly instead of showing an empty list.
         */
        options.length
          ? el('p', { class: 'muted', text: 'Pairings that would reach ' + view.result.majority + ' seats:' })
          : el('p', { class: 'muted' }, [
              'No pairing involving you reaches ' + view.result.majority + ' seats. ',
              (view.possibleCoalitions || []).length
                ? 'Another pair may still form a government without you.'
                : 'No two campaigns can form one, so the assembly stays hung.',
            ]),
        el(
          'div',
          { class: 'pair-list' },
          options.map(function (pair) {
            var partner = pair.a.playerId === mine.id ? pair.b : pair.a;
            return el(
              'button',
              {
                class: 'pair-row' + (draft.partnerId === partner.playerId ? ' is-selected' : ''),
                type: 'button',
                onclick: function () {
                  draft.partnerId = partner.playerId;
                  if (!draft.chiefMinisterId) draft.chiefMinisterId = mine.id;
                  paint();
                },
              },
              [
                el('span', { class: 'pair-with', text: 'with ' + nameFor(partner.playerId) }),
                el('span', { class: 'pair-seats', text: pair.combined + ' seats' }),
              ]
            );
          })
        ),
        draft.partnerId ? termsForm(mine) : null,
      ]);
    }

    function termsForm(mine) {
      var partner = playerById(draft.partnerId);
      if (!partner) return null;

      return el('div', { class: 'terms-form' }, [
        el('h3', { class: 'race-title', text: 'Negotiate terms' }),

        pick('Chief Minister', [
          { id: mine.id, label: mine.candidateName + ' (you)' },
          { id: partner.id, label: partner.candidateName },
        ], draft.chiefMinisterId, function (id) {
          draft.chiefMinisterId = id;
          paint();
        }),

        pick('Cabinet share', CMP.CAMPAIGN.coalition.cabinetSplits, draft.cabinet, function (id) {
          draft.cabinet = id;
          paint();
        }),

        pick('Policy priority', CMP.CAMPAIGN.coalition.policies, draft.policy, function (id) {
          draft.policy = id;
          paint();
        }),

        pick('Resources next time', CMP.CAMPAIGN.coalition.resourceTerms, draft.resources, function (id) {
          draft.resources = id;
          paint();
        }),

        el('button', {
          class: 'btn btn-primary btn-xl',
          type: 'button',
          disabled: !(draft.chiefMinisterId && draft.cabinet && draft.policy && draft.resources),
          text: 'PROPOSE COALITION',
          onclick: function () {
            send({
              move: 'propose',
              partnerId: draft.partnerId,
              chiefMinisterId: draft.chiefMinisterId,
              cabinet: draft.cabinet,
              policy: draft.policy,
              resources: draft.resources,
            });
          },
        }),
      ]);
    }

    function pick(label, items, selected, onPick) {
      return el('div', { class: 'term-group' }, [
        el('span', { class: 'field-label', text: label }),
        el(
          'div',
          { class: 'term-options' },
          items.map(function (item) {
            return el('button', {
              class: 'term-option' + (selected === item.id ? ' is-selected' : ''),
              type: 'button',
              text: item.label,
              onclick: function () {
                onPick(item.id);
              },
            });
          })
        ),
      ]);
    }

    function proposalCard(proposal, mine) {
      var forMe = proposal.toId === mine.id;
      var mineIsProposer = proposal.fromId === mine.id;

      return el('div', { class: 'coalition-block' }, [
        el('h2', { class: 'result-heading', text: 'Coalition Offer' }),
        el('div', { class: 'coalition-summary' }, [
          summaryRow('Between', nameFor(proposal.fromId) + ' and ' + nameFor(proposal.toId)),
          summaryRow('Combined seats', String(proposal.combined)),
          summaryRow('Chief Minister', nameFor(proposal.chiefMinisterId)),
          summaryRow('Deputy', nameFor(proposal.deputyId)),
          summaryRow('Cabinet', labelFrom('cabinetSplits', proposal.cabinet)),
          summaryRow('Policy priority', labelFrom('policies', proposal.policy)),
          summaryRow('Resources', labelFrom('resourceTerms', proposal.resources)),
        ]),
        forMe
          ? el('div', { class: 'coalition-actions' }, [
              el('button', {
                class: 'btn btn-primary btn-xl',
                type: 'button',
                text: 'ACCEPT AND FORM GOVERNMENT',
                onclick: function () {
                  send({ move: 'accept' });
                },
              }),
              el('button', {
                class: 'btn btn-xl',
                type: 'button',
                text: 'REJECT',
                onclick: function () {
                  send({ move: 'reject' });
                },
              }),
            ])
          : mineIsProposer
          ? el('div', { class: 'coalition-actions' }, [
              el('p', { class: 'muted', text: 'Waiting for a reply…' }),
              el('button', {
                class: 'btn btn-xl',
                type: 'button',
                text: 'WITHDRAW OFFER',
                onclick: function () {
                  send({ move: 'reject' });
                },
              }),
            ])
          : el('p', { class: 'muted', text: 'Two other players are in talks.' }),
      ]);
    }

    /* ------------------------------------------------------ paint */

    function paint() {
      if (!view || !view.result) {
        mount(root, [el('p', { class: 'muted', text: 'Waiting for the result…' })]);
        return;
      }

      var header = el('header', { class: 'election-head-top' }, [
        el('div', {}, [
          el('h1', { class: 'title title-sm', text: 'Punjab Assembly Election' }),
          el('p', { class: 'subtitle' }, [
            el('strong', { text: counting ? view.result.totalSeats + ' seats · majority ' +
              view.result.majority : countedLine() }),
          ]),
        ]),
        el('button', {
          class: 'btn btn-quiet',
          type: 'button',
          text: 'Menu',
          onclick: opts.onMenu,
        }),
      ]);

      // While the count runs, the verdict is deliberately withheld — showing
      // it above a count in progress would give the ending away.
      if (counting) {
        mount(root, [el('div', { class: 'result-inner' }, [header, countNode])]);
        paintCount();
        return;
      }

      mount(root, [
        el('div', { class: 'result-inner' }, [
          header,
          verdictBanner(),
          notice ? el('p', { class: 'notice notice-' + notice.tone, text: notice.text }) : null,
          finalBoard(),
          resultTable(),
          campaignNumbers(),
          coalitionSection(),
        ]),
      ]);
    }

    function update(next) {
      var first = !view;
      view = next;

      // Count the seats in the first time we see a result, and only then.
      // A poll arriving mid-count must not restart it.
      if (first && view && view.result && view.result.perSeat) {
        startCount();
        return;
      }
      if (counting) return;
      paint();
    }

    function stop() {
      if (countTimer !== null) window.clearTimeout(countTimer);
      countTimer = null;
    }

    return {
      root: root,
      update: update,
      setNotice: setNotice,
      stop: stop,
      skipCount: finishCount,
      isCounting: function () {
        return counting;
      },
    };
  }

  return { create: create };
})();
