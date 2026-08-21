/**
 * Priority districts, and agreements with other players.
 * ------------------------------------------------------------------
 * Naming priority districts is a statement of intent, not a claim: rivals can
 * and will campaign in the same places. What it buys is a shortlist worth
 * looking at every round, and — if you have an ally — a way to divide the map
 * between you without saying a word.
 *
 * An alliance is a pact rather than a merger. Allies see each other's priority
 * districts and nothing else: not their cash, not their heat, not what either
 * of them did quietly.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.territory = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  /* ------------------------------------------------------ priorities */

  /**
   * Pick the districts this campaign is fighting for.
   *
   * The ceiling is the number of districts Punjab has. The brief asked for up
   * to seventy; there are twenty-three, and inventing another forty-seven was
   * not an option.
   */
  function priorities(game, opts) {
    var cfg = (CMP.CAMPAIGN.territory || {}).priorityDistricts || { min: 4, max: 23 };
    var chosen = (game.priorityDistricts || []).slice();
    var root = el('div', { class: 'tr-priorities' });

    function seatsIn(ids) {
      return ids.reduce(function (t, id) {
        var d = CMP.getDistrict(id);
        return t + (d ? d.seats.length : 0);
      }, 0);
    }

    function toggle(id) {
      var at = chosen.indexOf(id);
      if (at === -1) {
        if (chosen.length >= cfg.max) return;
        chosen.push(id);
      } else {
        chosen.splice(at, 1);
      }
      game.priorityDistricts = chosen.slice();
      if (opts.onChange) opts.onChange(chosen.slice());
      paint();
    }

    function paint() {
      var leaders = CMP.campaign.currentLeaders(game.support);

      mount(root, [
        el('div', { class: 'tr-count' }, [
          el('div', { class: 'tr-count-fig' }, [
            el('strong', { class: 'tr-count-value', text: String(chosen.length) }),
            el('span', { class: 'tr-count-label', text: 'districts chosen' }),
          ]),
          el('div', { class: 'tr-count-fig' }, [
            el('strong', { class: 'tr-count-value', text: String(seatsIn(chosen)) }),
            el('span', { class: 'tr-count-label', text: 'seats in them' }),
          ]),
        ]),

        el('p', {
          class: 'g-block-note',
          text: chosen.length < cfg.min
            ? 'Choose at least ' + cfg.min + '.'
            : chosen.length >= cfg.max
              ? 'That is all ' + cfg.max + ' districts Punjab has.'
              : 'Up to ' + cfg.max + '. Priority is where you mean to fight — it ' +
                'does not stop anybody else fighting there.',
        }),

        el('div', { class: 'tr-regions' }, CMP.REGIONS.map(function (region) {
          return el('section', { class: 'tr-region' }, [
            el('h3', { class: 'tr-region-name', text: region.name }),
            el('div', { class: 'tr-grid' }, CMP.districtsInRegion(region.id).map(function (d) {
              var mine = d.seats.filter(function (n) {
                return leaders[n] === game.partyId;
              }).length;
              var on = chosen.indexOf(d.id) !== -1;

              return el('button', {
                class: 'tr-district' + (on ? ' is-on' : '') +
                  (mine === d.seats.length ? ' is-held' : ''),
                type: 'button',
                onclick: function () {
                  toggle(d.id);
                },
              }, [
                el('span', { class: 'tr-district-name', text: d.name }),
                el('span', {
                  class: 'tr-district-seats',
                  text: mine + ' / ' + d.seats.length + ' · ' + money.words(d.grant),
                }),
              ]);
            })),
          ]);
        })),
      ]);
    }

    paint();
    return root;
  }

  /* ------------------------------------------------------- alliances */

  /**
   * Offers, and the pact that comes of one.
   *
   * Offers close at the end of the deadline round and an accepted alliance is
   * locked until the result — you cannot shop for a better partner at round
   * nineteen, which is what makes agreeing early a commitment.
   */
  function alliances(game, view, opts) {
    var root = el('div', { class: 'tr-alliance' });

    function paint() {
      if (!view || game.mode !== 'multiplayer') {
        mount(root, [
          el('p', {
            class: 'g-block-note',
            text: 'Alliances are for games with other people in them.',
          }),
        ]);
        return;
      }

      var deadline = CMP.ROUNDS.allianceDeadline;
      var round = game.round || 1;
      var closed = round > deadline;
      var me = (view.players || []).filter(function (p) {
        return p.isYou;
      })[0];
      var ally = me && me.allyId
        ? (view.players || []).filter(function (p) {
            return p.id === me.allyId;
          })[0]
        : null;

      var rows = [];

      if (ally) {
        var party = CMP.getParty(ally.partyId);
        rows.push(el('div', { class: 'tr-ally', style: { '--party': party.colour } }, [
          el('strong', { class: 'tr-ally-name', text: ally.candidateName }),
          el('span', { class: 'tr-ally-party', text: party.short }),
          el('span', {
            class: 'tr-ally-note',
            text: 'Allied until the result. You each see the other’s priority districts.',
          }),
        ]));

        if ((ally.priorityDistricts || []).length) {
          rows.push(el('div', { class: 'tr-ally-targets' }, [
            el('span', { class: 'g-money-fig-label', text: 'Their priorities' }),
            el('p', {
              class: 'g-block-note',
              text: ally.priorityDistricts.map(function (id) {
                var d = CMP.getDistrict(id);
                return d ? d.name : id;
              }).join(', '),
            }),
          ]));
        }
      } else {
        rows.push(el('p', {
          class: 'g-block-note',
          text: closed
            ? 'Alliances closed at the end of round ' + deadline + '.'
            : 'Offers close at the end of round ' + deadline + '. An alliance holds ' +
              'until the result — there is no leaving it.',
        }));

        (view.allianceOffers || []).forEach(function (offer) {
          var from = (view.players || []).filter(function (p) {
            return p.id === offer.from;
          })[0];
          if (!from) return;
          rows.push(el('div', { class: 'tr-offer' }, [
            el('strong', { class: 'tr-offer-name', text: from.candidateName + ' wants an alliance' }),
            el('div', { class: 'g-actions-row' }, [
              el('button', {
                class: 'btn btn-primary btn-small',
                type: 'button',
                text: 'Accept',
                onclick: function () {
                  opts.onAlly('accept', from.id);
                },
              }),
              el('button', {
                class: 'btn btn-quiet btn-small',
                type: 'button',
                text: 'Decline',
                onclick: function () {
                  opts.onAlly('decline', from.id);
                },
              }),
            ]),
          ]));
        });

        if (!closed) {
          (view.players || []).forEach(function (p) {
            if (p.empty || p.isYou || p.isAI || p.allyId || p.eliminated) return;
            var party = CMP.getParty(p.partyId);
            rows.push(el('div', { class: 'tr-candidate', style: { '--party': party.colour } }, [
              el('span', { class: 'tr-candidate-name', text: p.candidateName }),
              el('span', { class: 'tr-candidate-party', text: party ? party.short : '' }),
              el('button', {
                class: 'btn btn-quiet btn-small',
                type: 'button',
                text: 'Invite',
                onclick: function () {
                  opts.onAlly('offer', p.id);
                },
              }),
            ]));
          });
        }
      }

      mount(root, rows);
    }

    paint();
    return root;
  }

  return { priorities: priorities, alliances: alliances };
})();
