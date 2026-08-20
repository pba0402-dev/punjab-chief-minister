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
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  function create(opts) {
    var view = null; // the server's game view
    var notice = null;
    var draft = { partnerId: '', chiefMinisterId: '', cabinet: '', policy: '', resources: '' };

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

    /* ------------------------------------------------------ sections */

    function resultTable() {
      var result = view.result;
      return el('div', { class: 'result-block' }, [
        el('h2', { class: 'result-heading', text: 'Punjab Election Result' }),
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
        return el('div', { class: 'verdict ' + (winnerIsYou ? 'verdict-win' : 'verdict-lose') }, [
          el('span', { class: 'verdict-kicker', text: 'Majority Government' }),
          el('h1', { class: 'verdict-title', text: result.winner.seats + ' of ' + result.totalSeats }),
          el('div', { class: 'verdict-office' }, [
            el('span', { class: 'stat-label', text: 'Chief Minister of Punjab' }),
            el('strong', { class: 'verdict-name', text: result.winner.candidate || '—' }),
            el('span', {
              class: 'verdict-party',
              style: { color: CMP.getParty(result.winner.party).colour },
              text: CMP.getParty(result.winner.party).name,
            }),
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
        el('p', { class: 'verdict-congrats', text: 'Begin coalition negotiations.' }),
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
        options.length
          ? el('p', { class: 'muted', text: 'Pairings that would reach ' + view.result.majority + ' seats:' })
          : el('p', { class: 'muted', text: 'No pairing involving you reaches a majority.' }),
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

      mount(root, [
        el('div', { class: 'result-inner' }, [
          el('header', { class: 'election-head-top' }, [
            el('div', {}, [
              el('h1', { class: 'title title-sm', text: 'Punjab Assembly Election' }),
              el('p', { class: 'subtitle' }, [
                el('strong', { text: view.result.totalSeats + ' seats · majority ' + view.result.majority }),
              ]),
            ]),
            el('button', {
              class: 'btn btn-quiet',
              type: 'button',
              text: 'Menu',
              onclick: opts.onMenu,
            }),
          ]),
          verdictBanner(),
          notice ? el('p', { class: 'notice notice-' + notice.tone, text: notice.text }) : null,
          resultTable(),
          coalitionSection(),
        ]),
      ]);
    }

    function update(next) {
      view = next;
      paint();
    }

    return { root: root, update: update, setNotice: setNotice };
  }

  return { create: create };
})();
