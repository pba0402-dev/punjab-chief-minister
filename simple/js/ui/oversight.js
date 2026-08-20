/**
 * Rivals panel: watch, report, and see what investigations found.
 * ------------------------------------------------------------------
 * Reporting is deliberately a judgement call, not a weapon. A player sees only
 * what is public — how many reports stand against a rival, their Political
 * Heat, and any findings already made. The evidence score behind an
 * investigation is never sent to the browser, so nobody can tell in advance
 * whether an accusation will stick.
 *
 * You may report each rival once. That is enforced on the server too.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.oversight = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  function create(opts) {
    var view = null;
    var notice = null;
    var pending = null; // { accusedId } while choosing a reason

    var root = el('div', { class: 'oversight' });

    function me() {
      if (!view) return null;
      for (var i = 0; i < view.players.length; i++) {
        if (!view.players[i].empty && view.players[i].isYou) return view.players[i];
      }
      return null;
    }

    function setNotice(text, tone) {
      notice = text ? { text: text, tone: tone || 'bad' } : null;
      paint();
    }

    function submit(accusedId, reason) {
      CMP.net.report(accusedId, reason).then(function (res) {
        pending = null;
        if (!res.ok) {
          setNotice(res.error);
          if (res.game) update(res.game);
          return;
        }
        notice = null;
        if (res.game) update(res.game);
        CMP.net.refresh();
      });
    }

    function heatChip(heat) {
      var level = CMP.campaign.heatLevel(heat);
      return el('span', {
        class: 'rival-heat',
        style: { color: level.colour },
        text: Math.round(heat) + ' / ' + CMP.CAMPAIGN.heat.max + ' ' + level.label,
      });
    }

    function rivalRow(p) {
      var party = CMP.getParty(p.partyId);
      var threshold = CMP.CAMPAIGN.investigation.reportsToOpen;
      var last = (p.investigations || []).slice(-1)[0];

      return el(
        'div',
        {
          class: 'rival-row' + (p.disqualified ? ' is-out' : ''),
          style: party ? { '--party': party.colour } : null,
        },
        [
          el('div', { class: 'rival-main' }, [
            el('span', { class: 'rival-name' }, [
              el('span', { class: 'rival-flag', text: party ? party.short : '—' }),
              p.candidateName || 'Player ' + p.slot,
            ]),
            el('span', { class: 'rival-meta' }, [
              heatChip(p.heat),
              el('span', { class: 'rival-spent', text: money.words(p.spent) + ' spent' }),
            ]),
          ]),

          el('div', { class: 'rival-status' }, [
            p.reportsAgainst > 0
              ? el('span', {
                  class: 'rival-reports',
                  text:
                    p.reportsAgainst +
                    ' ' +
                    (p.reportsAgainst === 1 ? 'report' : 'reports') +
                    ' · ' +
                    (p.reportsAgainst + 1 >= threshold ? 'one more opens an inquiry' : 'no inquiry yet'),
                })
              : null,
            p.restricted ? el('span', { class: 'rival-flagged', text: 'RESTRICTED' }) : null,
            p.disqualified ? el('span', { class: 'rival-out', text: 'DISQUALIFIED' }) : null,
            last
              ? el('span', {
                  class: 'rival-finding finding-' + last.outcomeId,
                  text: last.outcomeLabel + (last.fine ? ' · ' + money.words(last.fine) : ''),
                })
              : null,
          ]),

          p.disqualified
            ? null
            : p.youReported
            ? el('span', { class: 'rival-done', text: 'You have reported this player' })
            : el('button', {
                class: 'btn btn-small btn-report',
                type: 'button',
                text: 'REPORT',
                onclick: function () {
                  pending = { accusedId: p.id, name: p.candidateName || 'Player ' + p.slot };
                  paint();
                },
              }),
        ]
      );
    }

    function reasonPicker() {
      return el('div', { class: 'reason-picker' }, [
        el('div', { class: 'picker-head' }, [
          el('strong', { text: 'Report ' + pending.name }),
          el('button', {
            class: 'btn btn-quiet btn-small',
            type: 'button',
            text: 'Cancel',
            onclick: function () {
              pending = null;
              paint();
            },
          }),
        ]),
        el('p', {
          class: 'muted',
          text:
            'You can report each rival once. A report is not a verdict — an ' +
            'inquiry may clear them, and a wrong call spends your only report on them.',
        }),
        el(
          'div',
          { class: 'reason-list' },
          CMP.CAMPAIGN.investigation.reasons.map(function (r) {
            return el('button', {
              class: 'reason-option',
              type: 'button',
              text: r.label,
              onclick: function () {
                submit(pending.accusedId, r.id);
              },
            });
          })
        ),
      ]);
    }

    function ownRecord() {
      var mine = me();
      if (!mine) return null;
      var invs = mine.investigations || [];
      if (!mine.reportsAgainst && !invs.length && !mine.restricted && !mine.disqualified) {
        return el('p', { class: 'muted', text: 'Nothing has been raised against you.' });
      }

      return el('div', { class: 'own-record' }, [
        mine.disqualified
          ? el('p', { class: 'notice', text: 'You have been disqualified from this election.' })
          : null,
        mine.restricted
          ? el('p', {
              class: 'notice notice-info',
              text: 'You are under a campaign restriction — risky strategies are unavailable.',
            })
          : null,
        mine.reportsAgainst
          ? el('p', {
              class: 'muted',
              text:
                mine.reportsAgainst +
                ' ' +
                (mine.reportsAgainst === 1 ? 'report stands' : 'reports stand') +
                ' against you.',
            })
          : null,
        el(
          'div',
          { class: 'finding-list' },
          invs.slice(-4).reverse().map(function (inv) {
            return el('div', { class: 'finding-row finding-' + inv.outcomeId }, [
              el('strong', { text: inv.outcomeLabel }),
              el('span', { class: 'finding-text', text: inv.text }),
              inv.fine
                ? el('span', { class: 'finding-fine', text: 'Fine ' + money.format(inv.fine) })
                : null,
              inv.note ? el('span', { class: 'finding-note', text: inv.note }) : null,
            ]);
          })
        ),
      ]);
    }

    function paint() {
      if (!view) {
        mount(root, []);
        return;
      }
      if (pending) {
        mount(root, [reasonPicker()]);
        return;
      }

      var mine = me();
      var rivals = view.players.filter(function (p) {
        return !p.empty && !p.isYou;
      });

      mount(root, [
        notice ? el('p', { class: 'notice notice-' + notice.tone, text: notice.text }) : null,
        el('div', { class: 'lobby-section' }, [
          el('div', { class: 'group-head' }, [
            el('h2', { class: 'block-title', text: 'Rival Campaigns' }),
            el('span', { class: 'group-note', text: 'Two reports from different players open an inquiry.' }),
          ]),
          rivals.length
            ? el('div', { class: 'rival-list' }, rivals.map(rivalRow))
            : el('p', { class: 'muted', text: 'No rivals in this game.' }),
        ]),
        el('div', { class: 'lobby-section' }, [
          el('h2', { class: 'block-title', text: 'Your Record' }),
          ownRecord(),
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
