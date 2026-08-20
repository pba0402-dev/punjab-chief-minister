/**
 * Election screen.
 * ------------------------------------------------------------------
 * The campaign header, then all 117 constituencies laid out by district.
 * This is the structure the interactive map will replace in a later
 * version — every constituency already has its own tile and data hook.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.election = (function () {
  'use strict';

  var el = CMP.ui.dom.el;

  function render(game, opts) {
    var party = CMP.getParty(game.partyId);
    var needed = Math.max(0, game.majority - game.seatsWon);

    return el('section', { class: 'screen screen-election', style: { '--party': party.colour } }, [
      el('header', { class: 'election-head' }, [
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

        el('div', { class: 'campaign-card', style: { '--party-ink': party.ink } }, [
          el('span', { class: 'campaign-flag', text: party.short }),
          el('div', { class: 'campaign-body' }, [
            el('span', { class: 'campaign-party', text: party.name }),
            el('strong', { class: 'campaign-name', text: game.candidateName }),
            el('span', { class: 'campaign-slogan', text: '“' + game.slogan + '”' }),
          ]),
        ]),

        el('div', { class: 'stat-row' }, [
          stat('Election Budget', CMP.ui.money.format(game.budget), CMP.ui.money.words(game.budget)),
          stat('Seats Won', String(game.seatsWon), 'of ' + game.totalSeats),
          stat('Majority Required', String(game.majority), needed + ' more needed', true),
        ]),
      ]),

      el('div', { class: 'election-body' }, [
        el('div', { class: 'section-head' }, [
          el('h2', { class: 'block-title', text: 'Constituencies' }),
          el('p', {
            class: 'section-note',
            text:
              'All ' +
              CMP.TOTAL_SEATS +
              ' seats across ' +
              CMP.DISTRICTS.length +
              ' districts. The interactive map and campaigning arrive in the next version.',
          }),
        ]),
        el('div', { class: 'district-list' }, CMP.DISTRICTS.map(districtBlock)),
      ]),
    ]);
  }

  function stat(label, value, sub, highlight) {
    return el('div', { class: 'stat' + (highlight ? ' stat-highlight' : '') }, [
      el('span', { class: 'stat-label', text: label }),
      el('span', { class: 'stat-value', text: value }),
      sub ? el('span', { class: 'stat-sub', text: sub }) : null,
    ]);
  }

  function districtBlock(district) {
    var seats = CMP.CONSTITUENCIES.filter(function (c) {
      return c.district === district;
    });

    return el('div', { class: 'district' }, [
      el('div', { class: 'district-head' }, [
        el('h3', { class: 'district-name', text: district }),
        el('span', {
          class: 'district-count',
          text: seats.length + (seats.length === 1 ? ' seat' : ' seats'),
        }),
      ]),
      el(
        'ul',
        { class: 'seat-grid' },
        seats.map(function (c) {
          return el('li', { class: 'seat', dataset: { number: c.number } }, [
            el('span', { class: 'seat-number', text: c.number }),
            el('span', { class: 'seat-name', text: c.name }),
            c.reserved ? el('span', { class: 'seat-tag', text: c.reserved }) : null,
          ]);
        })
      ),
    ]);
  }

  return { render: render };
})();
