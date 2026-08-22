/**
 * Founding a party.
 * ------------------------------------------------------------------
 * This screen used to ask which of four real parties you wanted to be. It now
 * asks you to invent one: a name, a badge, a symbol, a colour, a line to run
 * on, and a face. That is the difference between playing a tracker and
 * playing a game.
 *
 * The preview at the bottom is the point of the layout. Six fields chosen in
 * isolation produce a party nobody has actually looked at, so the card is
 * assembled as you type and is the last thing you see before you start.
 *
 * Holds a draft in memory and hands it to CMP.state on submit — it never
 * writes to the save itself.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.setup = (function () {
  'use strict';

  var el = CMP.ui.dom.el;

  function render(opts) {
    // A returning player has already told us who they are. Asking again every
    // time was the single most pointless thing this screen did.
    var me = CMP.profile.get();
    var draft = {
      candidateName: me ? me.name : '',
      partyName: '',
      partyShort: '',
      partyShortEdited: false,
      partySymbol: CMP.PARTY_SYMBOLS[0].id,
      partyColour: CMP.PARTY_COLOURS[0].id,
      slogan: '',
      avatar: (me && me.avatar) || CMP.ui.avatars.list()[0],
      roundSeconds: CMP.ROUNDS.seconds,
    };
    var errors = {};

    var root = el('section', { class: 'screen screen-setup' });

    function setError(field) {
      if (!errors[field]) return null;
      return el('span', { class: 'field-error', text: errors[field] });
    }

    function clearError(field, input) {
      if (!errors[field]) return;
      delete errors[field];
      input.classList.remove('has-error');
      var msg = input.parentNode.querySelector('.field-error');
      if (msg) msg.remove();
    }

    /** The party as it currently stands, for the preview and the swatches. */
    function partySoFar() {
      return CMP.normalisePartyDef({
        id: 'preview',
        name: draft.partyName || 'Your party',
        short: draft.partyShort,
        slogan: draft.slogan,
        symbol: draft.partySymbol,
        colourId: draft.partyColour,
      });
    }

    function field(label, node, note) {
      return el('label', { class: 'field' }, [
        el('span', { class: 'field-label', text: label }),
        node,
        note ? el('p', { class: 'granted-note', text: note }) : null,
      ]);
    }

    function textInput(key, attrs) {
      var input = el('input', {
        class: 'field-input' + (errors[key] ? ' has-error' : ''),
        type: 'text',
        autocomplete: 'off',
        value: draft[key],
        maxlength: attrs.maxlength,
        placeholder: attrs.placeholder,
        oninput: function (e) {
          draft[key] = e.target.value;
          clearError(key, e.target);
          if (attrs.onchange) attrs.onchange(e.target.value);
        },
      });
      return input;
    }

    /* ---------------------------------------------------------- pickers */

    function symbolGrid() {
      var party = partySoFar();
      return el('div', { class: 'sym-grid' }, CMP.PARTY_SYMBOLS.map(function (sym) {
        var on = draft.partySymbol === sym.id;
        return el('button', {
          class: 'sym-option' + (on ? ' is-on' : ''),
          type: 'button',
          title: sym.name,
          'aria-label': sym.name,
          'aria-pressed': on ? 'true' : 'false',
          style: { color: on ? party.colour : 'var(--muted)' },
          onclick: function () {
            draft.partySymbol = sym.id;
            paint();
          },
        }, [CMP.ui.symbol.render(sym.id, 28)]);
      }));
    }

    function colourGrid() {
      return el('div', { class: 'col-grid' }, CMP.PARTY_COLOURS.map(function (swatch) {
        var on = draft.partyColour === swatch.id;
        return el('button', {
          class: 'col-option' + (on ? ' is-on' : ''),
          type: 'button',
          title: swatch.name,
          'aria-label': swatch.name,
          'aria-pressed': on ? 'true' : 'false',
          style: { '--swatch': swatch.colour },
          onclick: function () {
            draft.partyColour = swatch.id;
            paint();
          },
        });
      }));
    }

    /* ---------------------------------------------------------- preview */

    /**
     * What you are about to become.
     *
     * Everything chosen above, in the arrangement the scoreboard will use, so
     * a colour that turns out to be unreadable against a symbol is something
     * you find out here rather than in round four.
     */
    function preview() {
      var party = partySoFar();
      return el('div', {
        class: 'pv-card',
        style: { '--party': party.colour, '--party-ink': party.ink },
      }, [
        el('div', { class: 'pv-face' }, [
          CMP.ui.portrait.render(draft.avatar, 64, draft.candidateName || 'your candidate'),
        ]),
        el('div', { class: 'pv-who' }, [
          el('strong', {
            class: 'pv-name',
            text: (draft.candidateName || 'Your name').toUpperCase(),
          }),
          el('span', { class: 'pv-party', text: party.name.toUpperCase() }),
          draft.slogan
            ? el('span', { class: 'pv-slogan', text: '“' + draft.slogan + '”' })
            : el('span', { class: 'pv-slogan is-empty', text: 'No slogan' }),
        ]),
        el('div', { class: 'pv-badge' }, [
          CMP.ui.symbol.render(draft.partySymbol, 30),
          el('span', { class: 'pv-short', text: party.short }),
        ]),
      ]);
    }

    /* ------------------------------------------------------------ paint */

    function paint() {
      CMP.ui.dom.mount(root, [
        el('div', { class: 'setup-inner' }, [
          el('header', { class: 'setup-head' }, [
            el('button', {
              class: 'back-link',
              type: 'button',
              text: '← Back',
              onclick: opts.onBack,
            }),
            el('h1', { class: 'title title-sm', text: 'Found your party' }),
            el('p', { class: 'subtitle' }, [
              el('strong', { text: 'Punjab Assembly' }),
              ' · ' + CMP.TOTAL_SEATS + ' seats to contest',
            ]),
          ]),

          /* ---- who you are ---- */
          el('div', { class: 'block' }, [
            el('h2', { class: 'block-title', text: me ? 'You' : 'Who are you?' }),

            field(me ? 'Playing as' : 'Your name',
              textInput('candidateName', {
                maxlength: '40',
                placeholder: 'The name other players will see',
              }),
              me
                ? 'Saved to your profile. Change it here any time.'
                : 'Saved once, so you never have to type it again.'),
            setError('candidateName'),

            el('div', { class: 'field' }, [
              el('span', { class: 'field-label', text: 'Your face' }),
              CMP.ui.avatars.picker({
                selected: draft.avatar,
                onPick: function (id) {
                  draft.avatar = id;
                  if (CMP.profile.has()) CMP.profile.setAvatar(id);
                  paint();
                },
              }),
              el('p', {
                class: 'granted-note',
                text: 'Drawn characters, not photographs. Nobody here is real.',
              }),
            ]),
          ]),

          /* ---- the party ---- */
          el('div', { class: 'block' }, [
            el('h2', { class: 'block-title', text: 'Your party' }),

            field('Party name',
              textInput('partyName', {
                maxlength: '40',
                placeholder: 'Punjab Development Party',
                onchange: function (value) {
                  // The badge follows the name until somebody edits it, and
                  // then it stops following, because it is theirs now.
                  if (!draft.partyShortEdited) {
                    draft.partyShort = CMP.suggestShort(value);
                    var badge = root.querySelector('.js-short');
                    if (badge) badge.value = draft.partyShort;
                    var card = root.querySelector('.pv-card');
                    if (card) card.replaceWith(preview());
                  }
                },
              })),
            setError('partyName'),

            el('label', { class: 'field' }, [
              el('span', { class: 'field-label', text: 'Short name' }),
              el('input', {
                class: 'field-input js-short is-short',
                type: 'text',
                maxlength: '4',
                autocomplete: 'off',
                value: draft.partyShort,
                placeholder: 'PDP',
                oninput: function (e) {
                  draft.partyShortEdited = true;
                  draft.partyShort = e.target.value.toUpperCase();
                  e.target.value = draft.partyShort;
                  var card = root.querySelector('.pv-card');
                  if (card) card.replaceWith(preview());
                },
              }),
              el('p', {
                class: 'granted-note',
                text: 'Up to four letters. This is what appears on the ' +
                  'scoreboard, the map and every compact card.',
              }),
            ]),

            el('div', { class: 'field' }, [
              el('span', { class: 'field-label', text: 'Symbol' }),
              symbolGrid(),
            ]),

            el('div', { class: 'field' }, [
              el('span', { class: 'field-label', text: 'Colour' }),
              colourGrid(),
            ]),

            field('Slogan (optional)',
              textInput('slogan', {
                maxlength: '60',
                placeholder: 'Progress for every village',
                onchange: function () {
                  var card = root.querySelector('.pv-card');
                  if (card) card.replaceWith(preview());
                },
              })),
          ]),

          /* ---- the clock ---- */
          el('div', { class: 'block' }, [
            el('h2', { class: 'block-title', text: 'The clock' }),
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

          /* ---- and away ---- */
          el('div', { class: 'setup-foot' }, [
            el('h2', { class: 'block-title', text: 'Your candidate' }),
            preview(),
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
      if (!draft.partyShort) draft.partyShort = CMP.suggestShort(draft.partyName);

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
      // them into the next election too. The party does not — a new election
      // is a new party if they want one.
      if (CMP.profile.has()) {
        CMP.profile.rename(draft.candidateName);
        CMP.profile.setAvatar(draft.avatar);
      } else {
        CMP.profile.create(draft.candidateName, draft.avatar);
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
