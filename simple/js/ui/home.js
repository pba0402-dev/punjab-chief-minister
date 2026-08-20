/**
 * Home screen.
 * ------------------------------------------------------------------
 * Deliberately bare: the title, the seat count, and the two ways to play.
 * Anything already in progress appears as a quiet line underneath rather
 * than competing with the two main choices.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.home = (function () {
  'use strict';

  var el = CMP.ui.dom.el;

  function render(opts) {
    var soloSave = CMP.storage.load();
    var session = CMP.net.getSession();

    return el('section', { class: 'screen screen-home' }, [
      el('div', { class: 'home-inner' }, [
        el('p', { class: 'eyebrow', text: 'Punjab Assembly Election' }),
        el('h1', { class: 'title', text: 'Chief Minister of Punjab' }),
        el('p', { class: 'subtitle' }, [
          el('strong', { text: CMP.TOTAL_SEATS + ' Assembly Constituencies' }),
        ]),

        el('h2', { class: 'choose-title', text: 'Choose How to Play' }),

        el('div', { class: 'home-actions' }, [
          el(
            'button',
            {
              class: 'mode-card',
              type: 'button',
              onclick: opts.onSolo,
            },
            [
              el('span', { class: 'mode-label', text: 'PLAY SOLO' }),
              el('span', { class: 'mode-note', text: 'One player. Start straight away.' }),
            ]
          ),
          el(
            'button',
            {
              class: 'mode-card mode-card-alt',
              type: 'button',
              onclick: opts.onMultiplayer,
            },
            [
              el('span', { class: 'mode-label', text: 'PLAY WITH FRIENDS' }),
              el('span', { class: 'mode-note', text: 'Up to 4 players, one party each.' }),
            ]
          ),
        ]),

        resumeRow(soloSave, session, opts),
      ]),
    ]);
  }

  /** One quiet line for anything already under way. Nothing if there is not. */
  function resumeRow(soloSave, session, opts) {
    var links = [];

    if (session) {
      links.push(
        el('button', {
          class: 'resume-link',
          type: 'button',
          text: 'Rejoin game ' + session.code,
          onclick: opts.onRejoin,
        })
      );
    }
    if (soloSave) {
      links.push(
        el('button', {
          class: 'resume-link',
          type: 'button',
          text: 'Continue solo campaign',
          onclick: opts.onContinueSolo,
        })
      );
    }
    if (!links.length) return null;

    return el('div', { class: 'resume-row' }, links);
  }

  return { render: render };
})();
