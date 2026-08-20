/**
 * Constituency detail.
 * ------------------------------------------------------------------
 * Two clearly separated halves.
 *
 * The top is REAL: the sitting MLA, their party and how entrenched they are.
 * That person is the incumbent the fictional campaign is fought against — they
 * take no part in the game and nothing they do here is attributed to them.
 *
 * The bottom is the FICTIONAL game race: who is leading, by how much, and the
 * projected winner. It moves as players campaign.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.constituency = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

  /** The party currently ahead in a seat, and by how much. */
  function leaderOf(support) {
    var ranked = CMP.campaign.standings(support);
    if (!ranked.length) return null;
    return {
      partyId: ranked[0].partyId,
      share: ranked[0].support,
      margin: ranked[0].support - (ranked[1] ? ranked[1].support : 0),
      ranked: ranked,
    };
  }

  /** "AAP — LEADING" for a seat, as a small element. */
  function leadingBadge(support, extraClass) {
    var lead = leaderOf(support);
    if (!lead) return null;
    var party = CMP.getParty(lead.partyId);
    return el('span', {
      class: 'leading-badge ' + (extraClass || ''),
      style: { '--party': party.colour, '--party-ink': party.ink },
    }, [
      el('span', { class: 'leading-party', text: party.short }),
      el('span', { class: 'leading-word', text: 'LEADING' }),
    ]);
  }

  /**
   * The full panel for one seat.
   * `opts.showActions` adds a footer the caller can hang buttons on.
   */
  function render(game, number, opts) {
    opts = opts || {};
    var def = null;
    for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
      if (CMP.CONSTITUENCIES[i].number === Number(number)) def = CMP.CONSTITUENCIES[i];
    }
    var support = game.support[number];
    if (!def || !support) return el('p', { class: 'muted', text: 'Unknown constituency.' });

    var sitting = CMP.getIncumbent(def.number);
    var lead = leaderOf(support);
    var rating = CMP.campaign.ratingFor(lead.margin);
    var strength = (game.incumbency && game.incumbency[number]) || null;

    return el('div', { class: 'seat-detail' }, [
      /* ---- heading ---- */
      el('div', { class: 'seat-detail-head' }, [
        el('div', {}, [
          el('h2', { class: 'seat-detail-name' }, [
            def.name,
            el('span', { class: 'seat-detail-ac', text: ' — AC ' + def.number }),
          ]),
          el('span', { class: 'seat-detail-district' }, [
            def.district + ' district',
            def.reserved ? el('span', { class: 'tag', text: def.reserved }) : null,
          ]),
        ]),
        leadingBadge(support),
      ]),

      /* ---- real incumbent ---- */
      sitting
        ? el('div', { class: 'incumbent-card' }, [
            el('div', { class: 'incumbent-row' }, [
              el('div', { class: 'incumbent-block' }, [
                el('span', { class: 'stat-label', text: 'Current MLA' }),
                el('strong', { class: 'incumbent-name', text: sitting.mla }),
              ]),
              el('div', { class: 'incumbent-block' }, [
                el('span', { class: 'stat-label', text: 'Current Party' }),
                el('span', {
                  class: 'incumbent-party',
                  style: { color: partyColourFor(sitting.party) },
                  text: sitting.party,
                }),
              ]),
              strength
                ? el('div', { class: 'incumbent-block' }, [
                    el('span', { class: 'stat-label', text: 'Incumbency Strength' }),
                    el('span', { class: 'incumbent-strength', text: strength.label }),
                  ])
                : null,
            ]),
            sitting.byElection
              ? el('span', {
                  class: 'incumbent-note',
                  text:
                    'Won a by-election in ' +
                    sitting.byElection.date +
                    ' — ' +
                    sitting.byElection.reason.toLowerCase() +
                    '.',
                })
              : null,
            el('span', {
              class: 'incumbent-note incumbent-disclaimer',
              text:
                'Real reference data. The sitting member is the incumbent this ' +
                'fictional campaign is fought against and takes no part in the game.',
            }),
          ])
        : null,

      /* ---- fictional race ---- */
      el('div', { class: 'race-block' }, [
        el('div', { class: 'group-head' }, [
          el('h3', { class: 'race-title', text: 'Current Game Race' }),
          el('span', {
            class: 'race-rating rating-' + rating.id,
            text: rating.label,
          }),
        ]),
        el(
          'div',
          { class: 'race-bars' },
          lead.ranked.map(function (row) {
            var party = CMP.getParty(row.partyId);
            var isLeader = row.partyId === lead.partyId;
            var isYou = row.partyId === game.partyId;
            return el('div', { class: 'race-row' + (isYou ? ' is-you' : '') }, [
              el('span', { class: 'race-name' }, [
                el('span', { class: 'race-dot', style: { background: party.colour } }),
                party.short,
                isYou ? el('span', { class: 'race-you', text: 'you' }) : null,
              ]),
              el('span', { class: 'race-track' }, [
                el('span', {
                  class: 'race-fill',
                  style: { width: Math.max(2, row.support * 1.6) + '%', background: party.colour },
                }),
              ]),
              el('span', { class: 'race-value', text: row.support.toFixed(1) + '%' }),
              isLeader ? el('span', { class: 'race-lead', text: 'LEADING' }) : null,
            ]);
          })
        ),
        el('div', { class: 'projected' }, [
          el('span', { class: 'stat-label', text: 'Projected Winner' }),
          el('span', {
            class: 'projected-party',
            style: { color: CMP.getParty(lead.partyId).colour },
            text: CMP.getParty(lead.partyId).name,
          }),
          el('span', {
            class: 'projected-note',
            text:
              rating.id === 'tossup'
                ? 'Too close to call — this one is still winnable.'
                : 'Ahead by ' + lead.margin.toFixed(1) + ' points.',
          }),
        ]),
      ]),

      opts.footer || null,
    ]);
  }

  /** Real party codes may be outside the four; colour them sensibly anyway. */
  function partyColourFor(code) {
    var party = CMP.getParty(String(code || '').toLowerCase());
    return party ? party.colour : '#a89b89';
  }

  return {
    render: render,
    leaderOf: leaderOf,
    leadingBadge: leadingBadge,
    partyColourFor: partyColourFor,
  };
})();
