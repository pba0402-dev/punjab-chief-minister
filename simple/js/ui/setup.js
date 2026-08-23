/**
 * Founding a party, in four steps.
 * ------------------------------------------------------------------
 * This screen used to ask which of four real parties you wanted to be. It now
 * asks you to invent one — and it asks in the order the decisions actually
 * depend on each other, rather than as one long form.
 *
 *   1  Your candidate   who you are running as, and where they are strong
 *   2  Your party       symbol, colour, name
 *   3  Round length     how long each of the twenty rounds runs
 *   4  Start            the preview, and one button
 *
 * The candidate comes first because it is the only choice with consequences:
 * regional support multiplies what a campaign in that region buys, so the
 * face is a strategy and not a portrait. Everything after it is identity.
 *
 * Nothing here is required except a candidate and a symbol. A blank party
 * name becomes a generated one, an unchosen colour becomes an assigned one,
 * and a returning player's own name is already known. A setup screen that
 * refuses to start over a field somebody did not care about is a setup screen
 * standing between a person and the game.
 *
 * Holds a draft in memory and hands it to CMP.state on submit — it never
 * writes to the save itself.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.setup = (function () {
  'use strict';

  var el = CMP.ui.dom.el;

  var STEPS = [
    { id: 'candidate', label: 'Your candidate' },
    { id: 'party', label: 'Your party' },
    { id: 'clock', label: 'Round length' },
    { id: 'start', label: 'Start election' },
  ];

  /**
   * A party name for somebody who did not want to think of one.
   *
   * Assembled rather than drawn from a fixed list, so two players who both
   * skip the field are unlikely to end up as the same party — and so the list
   * does not have to be long to avoid repeating.
   */
  function generatedName() {
    return CMP.ui.chooser.generatedName();
  }

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
      partyColour: null,
      colourChosen: false,
      slogan: '',
      avatar: (me && me.avatar) || CMP.ui.avatars.list()[0],
      roundSeconds: CMP.ROUNDS.seconds,
    };
    var errors = {};
    var step = 0;

    var root = el('section', { class: 'screen screen-setup' });

    /**
     * A colour, whether or not anybody chose one.
     *
     * Optional means optional: a player who never opens the swatches still
     * gets a party that looks like a party, and one that is not the same
     * colour as the last player who skipped it either.
     */
    function colourId() {
      if (draft.partyColour) return draft.partyColour;
      return CMP.ui.chooser.assignedColour([draft.partySymbol, draft.avatar]);
    }

    function setError(field) {
      if (!errors[field]) return null;
      return el('span', { class: 'field-error', text: errors[field] });
    }

    /** The party as it currently stands, for the preview and the swatches. */
    function partySoFar() {
      return CMP.normalisePartyDef({
        id: 'preview',
        name: draft.partyName || 'Your party',
        short: draft.partyShort || CMP.suggestShort(draft.partyName || 'Your party'),
        slogan: '',
        symbol: draft.partySymbol,
        colourId: colourId(),
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
      return el('input', {
        class: 'field-input' + (errors[key] ? ' has-error' : ''),
        type: 'text',
        autocomplete: 'off',
        value: draft[key],
        maxlength: attrs.maxlength,
        placeholder: attrs.placeholder,
        oninput: function (e) {
          draft[key] = e.target.value;
          if (errors[key]) {
            delete errors[key];
            e.target.classList.remove('has-error');
            var msg = e.target.parentNode.querySelector('.field-error');
            if (msg) msg.remove();
          }
          if (attrs.onchange) attrs.onchange(e.target.value);
        },
      });
    }

    /*
     * The rails, and the two screens that use them, are shared.
     *
     * Playing alone and playing with friends are the same decisions, so they
     * are the same screens — see js/ui/chooser.js, which the multiplayer
     * lobby uses too. This file arranges them into four steps; it does not
     * own them.
     */
    var store = CMP.ui.chooser.rails();

    /* ------------------------------------------------------ step 1: who */

    /**
     * A bar, for a number that means something out of a hundred.
     *
     * Percentages rather than paragraphs: the point of this screen is that a
     * player understands a candidate in about five seconds, and four short
     * bars do that where four sentences do not.
     */
    function candidateRail() {
      return CMP.ui.chooser.candidateRail(store,
        function () { return draft.avatar; },
        function (id) {
          draft.avatar = id;
          if (CMP.profile.has()) CMP.profile.setAvatar(id);
        },
        {
          // Only what depends on the choice is redrawn. The rail itself is
          // never touched, which is what keeps its scroll position.
          onPick: paintDetail,
        });
    }

    function candidateDetail() {
      return CMP.ui.chooser.candidateDetail(draft.avatar, null);
    }

    /*
     * The two nodes that follow a choice.
     *
     * Everything on a step that depends on what is selected lives in one of
     * these, so choosing repaints a panel rather than the screen — and the
     * rail above it is never touched, which is what keeps its scroll
     * position.
     */
    var detailNode = el('div', { class: 'cd-detail-slot' });
    var partySideNode = el('div', { class: 'party-side-slot' });

    function paintDetail() {
      CMP.ui.dom.mount(detailNode, [candidateDetail()]);
    }

    function paintPartySide() {
      // The symbol carries the party colour, and the swatches show which one
      // is assigned when nobody has chosen: both follow the symbol.
      var symNode = store.nodeOf('symbol');
      if (symNode) symNode.style.setProperty('--party', partySoFar().colour);
      CMP.ui.dom.mount(partySideNode, partySide());
    }

    function stepCandidate() {
      return [
        el('div', { class: 'block' }, [
          me
            ? el('p', { class: 'setup-playing' }, [
                el('span', { class: 'setup-playing-label', text: 'Playing as' }),
                el('strong', { class: 'setup-playing-name', text: me.name }),
              ])
            : field('Your name',
                textInput('candidateName', {
                  maxlength: '40',
                  placeholder: 'The name other players will see',
                }),
                'Saved once, so you never have to type it again.'),
          me ? null : setError('candidateName'),

          candidateRail(),
          detailNode,
        ]),
      ];
    }

    /* ---------------------------------------------------- step 2: party */

    function symbolRail() {
      var node = CMP.ui.chooser.symbolRail(store,
        function () { return draft.partySymbol; },
        function (id) { draft.partySymbol = id; },
        { onPick: paintPartySide });
      /*
       * The party colour lives on the rail, not on every card, so a colour
       * change does not have to rebuild a single button.
       */
      node.style.setProperty('--party', partySoFar().colour);
      return node;
    }

    function colourGrid() {
      return CMP.ui.chooser.colourGrid(
        draft.colourChosen ? draft.partyColour : null,
        colourId(),
        function (id) {
          draft.partyColour = id;
          draft.colourChosen = true;
          paintPartySide();
        });
    }

    function stepParty() {
      return [
        el('div', { class: 'block' }, [
          el('div', { class: 'field' }, [
            el('span', { class: 'field-label', text: 'Symbol' }),
            symbolRail(),
          ]),
          partySideNode,
        ]),
      ];
    }

    /** Everything on the party step that follows the symbol. */
    function partySide() {
      return [
          el('div', { class: 'field' }, [
            el('span', { class: 'field-label', text: 'Colour (optional)' }),
            colourGrid(),
            el('p', {
              class: 'granted-note',
              text: draft.colourChosen
                ? 'Used on the map, the scoreboard and every card that is yours.'
                : 'One is picked for you. Choose another if you would rather.',
            }),
          ]),

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
                }
              },
            }),
            'Leave it blank and one will be chosen for you.'),
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
              },
            }),
            el('p', {
              class: 'granted-note',
              text: 'Up to four letters. This is what appears on the ' +
                'scoreboard, the map and every compact card.',
            }),
          ]),
      ];
    }

    /* ---------------------------------------------------- step 3: clock */

    var CLOCK_NOTE = {
      120: 'Fast strategic game',
      180: 'Balanced game',
      300: 'More time for strategy',
    };
    var CLOCK_WORD = { 120: 'Quick', 180: 'Standard', 300: 'Considered' };

    function stepClock() {
      return [
        el('div', { class: 'block' }, [
          el('div', { class: 'clock-options' },
            CMP.ROUNDS.durationOptions.map(function (secs) {
              return el('button', {
                class: 'clock-option' + (draft.roundSeconds === secs ? ' is-active' : ''),
                type: 'button',
                onclick: function () {
                  draft.roundSeconds = secs;
                  if (CMP.audio) CMP.audio.play('tap');
                  paint();
                },
              }, [
                el('strong', {
                  class: 'clock-option-value',
                  text: Math.round(secs / 60) + ' min',
                }),
                el('span', {
                  class: 'clock-option-word',
                  text: CLOCK_WORD[secs] || '',
                }),
                el('span', {
                  class: 'clock-option-note',
                  text: CLOCK_NOTE[secs] || '',
                }),
              ]);
            })),
          el('p', { class: 'granted-note' }, [
            el('strong', { text: CMP.ui.money.words(CMP.CAMPAIGN.income.perRound) }),
            ' a round for ' + CMP.ROUNDS.total + ' rounds. Whatever you do not ',
            'spend, you keep.',
          ]),
        ]),
      ];
    }

    /* ---------------------------------------------------- step 4: start */

    /**
     * What you are about to become.
     *
     * Everything chosen above, in the arrangement the scoreboard will use, so
     * a colour that turns out to be unreadable against a symbol is something
     * you find out here rather than in round four.
     */
    function preview() {
      var party = partySoFar();
      var name = draft.partyName || generatedPreviewName();
      return el('div', {
        class: 'pv-card',
        style: { '--party': party.colour, '--party-ink': party.ink },
      }, [
        el('div', { class: 'pv-face' }, [
          CMP.ui.portrait.render(draft.avatar, 72, draft.candidateName || 'your candidate'),
        ]),
        el('div', { class: 'pv-who' }, [
          el('strong', {
            class: 'pv-name',
            text: (draft.candidateName || (me && me.name) || 'Your name').toUpperCase(),
          }),
          el('span', { class: 'pv-party', text: name.toUpperCase() }),
        ]),
        el('div', { class: 'pv-badge' }, [
          CMP.ui.symbol.render(draft.partySymbol, 32),
          el('span', { class: 'pv-short', text: party.short }),
        ]),
      ]);
    }

    /*
     * A generated name is decided once, not on every repaint.
     *
     * Otherwise the preview would show a different party every time anything
     * on the screen changed, and the name the player finally started with
     * would be one they had never seen.
     */
    var previewName = null;
    function generatedPreviewName() {
      if (!previewName) previewName = generatedName();
      return previewName;
    }

    function stepStart() {
      var stats = CMP.candidateStats(draft.avatar);
      var summary = CMP.regionalSummary(draft.avatar);
      return [
        el('div', { class: 'block' }, [
          preview(),
          el('div', { class: 'setup-recap' }, [
            recapLine('Candidate', stats.label),
            recapLine('Strongest',
              summary.strongest.length
                ? summary.strongest.map(function (r) { return r.name; }).join(' · ')
                : 'Even everywhere'),
            recapLine('Round length', Math.round(draft.roundSeconds / 60) + ' minutes'),
          ]),
        ]),
      ];
    }

    function recapLine(label, value) {
      return el('div', { class: 'setup-recap-line' }, [
        el('span', { class: 'setup-recap-label', text: label }),
        el('strong', { class: 'setup-recap-value', text: value }),
      ]);
    }

    /* ------------------------------------------------------------ paint */

    function stepper() {
      return el('ol', { class: 'setup-steps' }, STEPS.map(function (s, i) {
        return el('li', {
          class: 'setup-step' + (i === step ? ' is-on' : '') + (i < step ? ' is-done' : ''),
        }, [
          el('span', { class: 'setup-step-no', text: i < step ? '✓' : String(i + 1) }),
          el('span', { class: 'setup-step-label', text: s.label }),
        ]);
      }));
    }

    function paint() {
      var body = step === 0 ? stepCandidate()
        : step === 1 ? stepParty()
        : step === 2 ? stepClock()
        : stepStart();

      var last = step === STEPS.length - 1;

      // Where the rails are scrolled to, before the step around them is
      // rebuilt. See restoreRails, and §13 of the brief this answers.
      store.remember();

      CMP.ui.dom.mount(root, [
        el('div', { class: 'setup-inner' }, [
          el('header', { class: 'setup-head' }, [
            el('button', {
              class: 'back-link',
              type: 'button',
              text: step === 0 ? '← Back' : '← ' + STEPS[step - 1].label,
              onclick: function () {
                if (step === 0) return opts.onBack();
                step -= 1;
                paint();
                toTop();
              },
            }),
            el('h1', { class: 'title title-sm', text: STEPS[step].label }),
            el('p', { class: 'subtitle' }, [
              el('strong', { text: 'Punjab Assembly' }),
              ' · ' + CMP.TOTAL_SEATS + ' seats to contest',
            ]),
          ]),

          stepper(),
        ].concat(body).concat([
          el('div', { class: 'setup-foot' }, [
            el('button', {
              class: 'btn btn-primary btn-xl btn-start',
              type: 'button',
              text: last ? 'START ELECTION' : 'Continue',
              onclick: function () {
                if (last) return submit();
                step += 1;
                if (CMP.audio) CMP.audio.play('tap');
                paint();
                toTop();
              },
            }),
          ]),
        ])),
      ]);

      if (step === 0) paintDetail();
      if (step === 1) paintPartySide();
      store.restore();
    }

    function toTop() {
      if (root.scrollIntoView) root.scrollIntoView({ block: 'start' });
    }

    /**
     * Everything optional is filled in, and then it is checked.
     *
     * The order matters: a blank party name is not an error, it is a name
     * nobody chose, so it is generated before validation rather than
     * rejected by it. What is left for validation is the handful of things
     * the game genuinely cannot start without.
     */
    function submit() {
      if (!draft.candidateName) draft.candidateName = (me && me.name) || '';
      if (!draft.partyName.trim()) draft.partyName = generatedPreviewName();
      if (!draft.partyShort) draft.partyShort = CMP.suggestShort(draft.partyName);
      draft.partyColour = colourId();
      draft.slogan = '';

      var check = CMP.state.validateSetup(draft);
      errors = check.errors;
      if (!check.ok) {
        /*
         * A field that failed is on a step, and the step it is on may not be
         * the one being looked at. Going there is the difference between an
         * error message and an error message somebody can act on.
         */
        step = errors.candidateName ? 0 : 1;
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

  return { render: render, generatedName: generatedName };
})();
