/**
 * Home screen.
 * ------------------------------------------------------------------
 * The first thing anyone sees. Shows the title and the seat count, then
 * either CONTINUE GAME / NEW GAME if a save exists, or START NEW ELECTION
 * if it does not.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.home = (function () {
  'use strict';

  var el = CMP.ui.dom.el;

  function render(opts) {
    var saved = CMP.storage.load();

    return el('section', { class: 'screen screen-home' }, [
      el('div', { class: 'home-inner' }, [
        el('p', { class: 'eyebrow', text: 'Punjab Assembly Election' }),
        el('h1', { class: 'title', text: 'Chief Minister of Punjab' }),
        el('p', { class: 'subtitle' }, [
          el('strong', { text: CMP.TOTAL_SEATS + ' Assembly Constituencies' }),
        ]),
        el('p', {
          class: 'lede',
          text:
            'Lead a party through the Punjab Assembly election. Win ' +
            CMP.MAJORITY +
            ' of the ' +
            CMP.TOTAL_SEATS +
            ' seats and you become Chief Minister.',
        }),

        saved ? savedCard(saved, opts) : null,

        el('div', { class: 'home-actions' }, [
          saved
            ? el('button', {
                class: 'btn btn-primary btn-xl',
                type: 'button',
                text: 'CONTINUE GAME',
                onclick: opts.onContinue,
              })
            : null,
          saved
            ? el('button', {
                class: 'btn btn-quiet btn-xl',
                type: 'button',
                text: 'NEW GAME',
                onclick: function () {
                  confirmNewGame(opts);
                },
              })
            : el('button', {
                class: 'btn btn-primary btn-xl',
                type: 'button',
                text: 'START NEW ELECTION',
                onclick: opts.onNew,
              }),
        ]),

        el('p', {
          class: 'disclaimer',
          text:
            'A fictional strategy game. Constituency names and districts are real public information; everything else is invented. Not a prediction of any real election.',
        }),
      ]),
    ]);
  }

  /** A short summary of the campaign waiting to be resumed. */
  function savedCard(saved, opts) {
    var party = CMP.getParty(saved.partyId);
    return el('div', { class: 'saved-card', style: { '--party': party.colour } }, [
      el('span', { class: 'saved-flag', text: party.short }),
      el('div', { class: 'saved-body' }, [
        el('strong', { class: 'saved-name', text: saved.candidateName }),
        el('span', {
          class: 'saved-meta',
          text:
            party.name +
            ' · ' +
            saved.seatsWon +
            ' of ' +
            saved.totalSeats +
            ' seats · ' +
            CMP.ui.money.format(saved.budget),
        }),
      ]),
    ]);
  }

  /** NEW GAME wipes a save, so ask once before doing it. */
  function confirmNewGame(opts) {
    var overlay = el('div', { class: 'overlay' });

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    CMP.ui.dom.mount(overlay, [
      el('div', { class: 'modal' }, [
        el('h2', { text: 'Start a new election?' }),
        el('p', {
          text: 'Your saved campaign will be deleted. This cannot be undone.',
        }),
        el('div', { class: 'modal-actions' }, [
          el('button', {
            class: 'btn btn-quiet',
            type: 'button',
            text: 'Cancel',
            onclick: close,
          }),
          el('button', {
            class: 'btn btn-danger',
            type: 'button',
            text: 'Delete and start new',
            onclick: function () {
              close();
              opts.onNew({ clear: true });
            },
          }),
        ]),
      ]),
    ]);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.body.appendChild(overlay);
  }

  return { render: render };
})();
