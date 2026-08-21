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
    // A returning player has already told us who they are. Asking again every
    // time was the single most pointless thing this screen did.
    var me = CMP.profile.get();
    var draft = {
      partyId: null,
      candidateName: me ? me.name : '',
      slogan: '',
      portraitSeed: (me && me.portraitSeed) || CMP.ui.avatars.list()[0],
      roundSeconds: CMP.ROUNDS.seconds,
    };
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
            el('h1', { class: 'title title-sm', text: 'Election Time' }),
            el('p', { class: 'subtitle' }, [
              el('strong', { text: 'Punjab Assembly' }),
              ' · ' + CMP.TOTAL_SEATS + ' seats',
            ]),
          ]),

          el('div', { class: 'block' }, [
            el('h2', { class: 'block-title', text: 'Select your party' }),
            el('div', { class: 'party-grid' }, CMP.PLAYABLE_PARTIES.map(partyCard)),
            errors.partyId
              ? el('span', { class: 'field-error', text: errors.partyId })
              : null,
          ]),

          el('div', { class: 'block' }, [
            el('h2', {
              class: 'block-title',
              text: me ? 'Your candidate' : 'Who are you?',
            }),

            el('label', { class: 'field' }, [
              el('span', {
                class: 'field-label',
                text: me ? 'Playing as' : 'Your name',
              }),
              el('input', {
                class: 'field-input' + (errors.candidateName ? ' has-error' : ''),
                type: 'text',
                maxlength: '60',
                autocomplete: 'off',
                value: draft.candidateName,
                placeholder: 'The name other players will see',
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

            el('p', {
              class: 'granted-note',
              text: me
                ? 'Saved to your profile. Change it here any time.'
                : 'Saved once, so you never have to type it again.',
            }),

            /* ---- the face ---- */
            el('div', { class: 'field' }, [
              el('span', { class: 'field-label', text: 'Your face' }),
              CMP.ui.avatars.picker({
                selected: draft.portraitSeed,
                onPick: function (seed) {
                  draft.portraitSeed = seed;
                  if (CMP.profile.has()) CMP.profile.setAvatar(seed);
                },
              }),
              el('p', {
                class: 'granted-note',
                text: 'Drawn characters, not photographs. Nobody here is real.',
              }),
            ]),

            /* ---- the line you run on ---- */
            el('label', { class: 'field' }, [
              el('span', { class: 'field-label', text: 'Slogan (optional)' }),
              el('input', {
                class: 'field-input',
                type: 'text',
                maxlength: '80',
                autocomplete: 'off',
                value: draft.slogan,
                placeholder: 'The line your campaign runs on',
                oninput: function (e) {
                  draft.slogan = e.target.value;
                },
              }),
            ]),

            /* ---- how long a round runs ---- */
            el('div', { class: 'field' }, [
              el('span', { class: 'field-label', text: 'Round length' }),
              el('div', { class: 'clock-options' }, CMP.ROUNDS.durationOptions.map(function (secs) {
                return el('button', {
                  class: 'clock-option' + (draft.roundSeconds === secs ? ' is-active' : ''),
                  type: 'button',
                  onclick: function () {
                    draft.roundSeconds = secs;
                    paint();
                  },
                }, [
                  el('strong', { class: 'clock-option-value', text: Math.round(secs / 60) + ' min' }),
                  el('span', {
                    class: 'clock-option-note',
                    text: secs === 120 ? 'Brisk' : secs === 180 ? 'Steady' : 'Considered',
                  }),
                ]);
              })),
            ]),

            el('p', { class: 'granted-note' }, [
              el('strong', { text: CMP.ui.money.words(CMP.CAMPAIGN.income.perRound) }),
              ' a round for ' + CMP.ROUNDS.total + ' rounds. Whatever you do not ',
              'spend, you keep.',
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
      // The face and the name are the player's, not this game's: they follow
      // them into the next election too.
      if (CMP.profile.has()) {
        CMP.profile.rename(draft.candidateName);
        CMP.profile.setAvatar(draft.portraitSeed);
      } else {
        CMP.profile.create(draft.candidateName, draft.portraitSeed);
      }

      var started = CMP.state.startElection(draft);
      started.roundSeconds = draft.roundSeconds;
      started.roundEndsAt = Date.now() + draft.roundSeconds * 1000;
      opts.onStart(started);
    }

    paint();
    return root;
  }

  return { render: render };
})();
