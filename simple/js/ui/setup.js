/**
 * Setup screen.
 * ------------------------------------------------------------------
 * Party selection, then candidate details, then START ELECTION.
 * Holds a draft in memory and hands it to CMP.state on submit — it never
 * writes to the save itself.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.setup = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var money = CMP.ui.money;

  function render(opts) {
    var draft = { partyId: null, candidateName: '', slogan: '' };
    var errors = {};

    var root = el('section', { class: 'screen screen-setup' });

    function setError(field, node) {
      if (!errors[field]) return null;
      return el('span', { class: 'field-error', text: errors[field] });
    }

    function partyCard(party) {
      var selected = draft.partyId === party.id;
      return el(
        'button',
        {
          class: 'party-card' + (selected ? ' is-selected' : ''),
          type: 'button',
          'aria-pressed': selected ? 'true' : 'false',
          style: { '--party': party.colour, '--party-ink': party.ink },
          onclick: function () {
            draft.partyId = party.id;
            delete errors.partyId;
            paint();
          },
        },
        [
          el('span', { class: 'party-flag', text: party.short }),
          el('span', { class: 'party-text' }, [
            el('strong', { class: 'party-short', text: party.short }),
            el('span', { class: 'party-name', text: party.name }),
          ]),
          el('span', { class: 'party-tick', 'aria-hidden': 'true', text: '✓' }),
        ]
      );
    }

    function paint() {
      var selectedParty = draft.partyId ? CMP.getParty(draft.partyId) : null;

      CMP.ui.dom.mount(root, [
        el('div', { class: 'setup-inner' }, [
          el('header', { class: 'setup-head' }, [
            el('button', {
              class: 'back-link',
              type: 'button',
              text: '← Back',
              onclick: opts.onBack,
            }),
            el('h1', { class: 'title title-sm', text: 'Chief Minister of Punjab' }),
            el('p', { class: 'subtitle' }, [
              el('strong', { text: CMP.TOTAL_SEATS + ' Assembly Constituencies' }),
            ]),
          ]),

          el('div', { class: 'block' }, [
            el('h2', { class: 'block-title', text: 'Select Your Party' }),
            el('div', { class: 'party-grid' }, CMP.PLAYABLE_PARTIES.map(partyCard)),
            errors.partyId
              ? el('span', { class: 'field-error', text: errors.partyId })
              : null,
          ]),

          el('div', { class: 'block' }, [
            el('h2', { class: 'block-title', text: 'Candidate Details' }),

            el('label', { class: 'field' }, [
              el('span', { class: 'field-label', text: 'Chief Minister Candidate Name' }),
              el('input', {
                class: 'field-input' + (errors.candidateName ? ' has-error' : ''),
                type: 'text',
                maxlength: '60',
                autocomplete: 'off',
                value: draft.candidateName,
                placeholder: 'Enter the name of your CM face',
                oninput: function (e) {
                  draft.candidateName = e.target.value;
                  if (errors.candidateName) {
                    delete errors.candidateName;
                    e.target.classList.remove('has-error');
                    var msg = e.target.parentNode.querySelector('.field-error');
                    if (msg) msg.remove();
                  }
                },
              }),
              setError('candidateName'),
            ]),

            el('label', { class: 'field' }, [
              el('span', { class: 'field-label', text: 'Election Slogan' }),
              el('input', {
                class: 'field-input' + (errors.slogan ? ' has-error' : ''),
                type: 'text',
                maxlength: '80',
                autocomplete: 'off',
                value: draft.slogan,
                placeholder: 'The line your campaign runs on',
                oninput: function (e) {
                  draft.slogan = e.target.value;
                  if (errors.slogan) {
                    delete errors.slogan;
                    e.target.classList.remove('has-error');
                    var msg = e.target.parentNode.querySelector('.field-error');
                    if (msg) msg.remove();
                  }
                },
              }),
              setError('slogan'),
            ]),

            el('p', { class: 'granted-note' }, [
              'Every candidate is given ',
              el('strong', { text: CMP.ui.money.format(CMP.STARTING_BUDGET) }),
              ' to run the campaign.',
            ]),
          ]),

          el('div', { class: 'setup-foot' }, [
            selectedParty
              ? el('p', { class: 'setup-summary' }, [
                  el('span', {
                    class: 'summary-dot',
                    style: { background: selectedParty.colour },
                  }),
                  el('span', {
                    text:
                      (draft.candidateName || 'Your candidate') +
                      ' · ' +
                      selectedParty.short,
                  }),
                ])
              : el('p', { class: 'setup-summary muted', text: 'Choose a party to begin.' }),
            el('button', {
              class: 'btn btn-primary btn-xl btn-start',
              type: 'button',
              text: 'START ELECTION',
              onclick: submit,
            }),
          ]),
        ]),
      ]);
    }

    function submit() {
      var check = CMP.state.validateSetup(draft);
      errors = check.errors;
      if (!check.ok) {
        paint();
        var first = root.querySelector('.has-error, .field-error');
        if (first && first.scrollIntoView) {
          first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        if (first && first.focus) first.focus();
        return;
      }
      opts.onStart(CMP.state.startElection(draft));
    }

    paint();
    return root;
  }

  return { render: render };
})();
