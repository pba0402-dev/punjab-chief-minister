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
  var NAME_A = ['Punjab', 'Punjab', 'People’s Punjab', 'New Punjab', 'United Punjab'];
  var NAME_B = ['Development', 'Progress', 'Reform', 'Farmers’', 'Welfare',
    'Democratic', 'Unity', 'Citizens’'];
  var NAME_C = ['Party', 'Alliance', 'Front', 'Congress', 'Morcha', 'Union'];

  function generatedName() {
    function pick(list) {
      return list[Math.floor(Math.random() * list.length)];
    }
    return pick(NAME_A) + ' ' + pick(NAME_B) + ' ' + pick(NAME_C);
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
      var all = CMP.PARTY_COLOURS;
      var seed = (draft.partySymbol || '') + (draft.avatar || '');
      var h = 0;
      for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
      return all[h % all.length].id;
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

    /* ------------------------------------------------------- the carousels */

    /**
     * A rail that survives the thing it is used for.
     *
     * The bug this exists to kill: choosing a candidate repainted the whole
     * screen, which threw the rail away and built a new one — and a new
     * element starts at scrollLeft 0, so picking the tenth candidate scrolled
     * you back to the first. The selection was right and the view was wrong,
     * which is the worst combination because it looks like the click failed.
     *
     * So the rail is built once and never rebuilt. Choosing something toggles
     * a class on buttons that are already there; nothing is remounted, no
     * scroll position is written, and the two pieces of state — what is
     * chosen, and where the rail is scrolled — never touch each other.
     *
     * Cards are keyed by their own id rather than by position, so the
     * identity of a card does not depend on where it sits in the list.
     */
    var rails = {};

    function rail(id, spec) {
      if (rails[id]) return rails[id].node;

      var cards = {};
      var node = el('div', {
        class: spec.className,
        role: 'radiogroup',
        'aria-label': spec.label,
      }, spec.items.map(function (item, i) {
        var card = spec.card(item, i);
        card.dataset.railId = String(item.id);
        card.addEventListener('click', function () {
          spec.onPick(item.id);
          syncRail(id);
        });
        cards[item.id] = card;
        return card;
      }));

      rails[id] = { node: node, cards: cards, chosen: spec.chosen };
      syncRail(id);
      return node;
    }

    /**
     * Mark the chosen card, and bring it into view only if it is not already.
     *
     * "Only if" matters: scrolling on every repaint would fight a player who
     * had scrolled somewhere to look at something, and scrolling to a card
     * that is already on screen is a jolt with no purpose.
     */
    function syncRail(id) {
      var entry = rails[id];
      if (!entry) return;
      var chosen = String(entry.chosen());

      Object.keys(entry.cards).forEach(function (key) {
        var card = entry.cards[key];
        var on = key === chosen;
        card.classList.toggle('is-on', on);
        card.setAttribute('aria-checked', on ? 'true' : 'false');
        var state = card.querySelector('.cd-card-state');
        if (state) state.textContent = on ? 'Selected' : '';
      });

      bringIntoView(entry.node, entry.cards[chosen]);
    }

    function bringIntoView(node, card) {
      if (!card || !node || typeof node.scrollLeft !== 'number') return;
      // jsdom has no layout, so every offset is zero and there is nothing to
      // scroll; guarding here keeps the tests honest rather than pretending.
      if (!node.clientWidth) return;

      var left = card.offsetLeft;
      var right = left + card.offsetWidth;
      var viewLeft = node.scrollLeft;
      var viewRight = viewLeft + node.clientWidth;
      if (left >= viewLeft && right <= viewRight) return;

      var target = Math.max(0, left - (node.clientWidth - card.offsetWidth) / 2);
      if (node.scrollTo) node.scrollTo({ left: target, behavior: 'smooth' });
      else node.scrollLeft = target;
    }

    /**
     * Put the rails back where they were, after a step change rebuilt around
     * them.
     *
     * Moving a live node into a new parent is not guaranteed to preserve its
     * scroll offset, and §13 of the brief is explicit: going to the party
     * step and back must not lose where the candidate rail was.
     */
    function rememberRails() {
      Object.keys(rails).forEach(function (id) {
        var entry = rails[id];
        if (entry.node.clientWidth) entry.at = entry.node.scrollLeft;
      });
    }

    function restoreRails() {
      Object.keys(rails).forEach(function (id) {
        var entry = rails[id];
        if (typeof entry.at === 'number' && entry.node.clientWidth) {
          entry.node.scrollLeft = entry.at;
        }
      });
    }

    /* ------------------------------------------------------ step 1: who */

    /**
     * A bar, for a number that means something out of a hundred.
     *
     * Percentages rather than paragraphs: the point of this screen is that a
     * player understands a candidate in about five seconds, and four short
     * bars do that where four sentences do not.
     */
    function stat(label, value, cls) {
      return el('div', { class: 'cd-stat ' + (cls || '') }, [
        el('span', { class: 'cd-stat-label', text: label }),
        el('span', { class: 'cd-stat-track' }, [
          el('span', { class: 'cd-stat-fill', style: { width: value + '%' } }),
        ]),
        el('span', { class: 'cd-stat-value', text: value + '%' }),
      ]);
    }

    /**
     * The cast, as a rail of large cards.
     *
     * A face was a 46px circle in a grid of twenty-four, which is a swatch
     * rather than a character. They are cards now — a large portrait, the
     * character's own description, one row — because this is the person the
     * whole campaign is fought as, and because the choice has consequences
     * that a swatch could never carry.
     */
    function candidateRail() {
      return rail('candidate', {
        className: 'cd-rail',
        label: 'Your candidate',
        items: CMP.ui.avatars.list().map(function (id) {
          return { id: id };
        }),
        chosen: function () {
          return draft.avatar;
        },
        onPick: function (id) {
          draft.avatar = id;
          if (CMP.profile.has()) CMP.profile.setAvatar(id);
          if (CMP.audio) CMP.audio.play('select');
          // Only what depends on the choice is redrawn. The rail itself is
          // not touched, which is the whole point.
          paintDetail();
        },
        card: function (item, i) {
          var stats = CMP.candidateStats(item.id);
          return el('button', {
            class: 'cd-card',
            type: 'button',
            role: 'radio',
            'aria-label': 'Candidate ' + (i + 1) + ', ' + stats.label,
            dataset: { avatar: item.id },
          }, [
            el('span', { class: 'cd-card-art' }, [CMP.ui.portrait.render(item.id, 132)]),
            el('span', { class: 'cd-card-body' }, [
              el('strong', { class: 'cd-card-name', text: stats.label }),
              el('span', { class: 'cd-card-blurb', text: stats.blurb }),
            ]),
            el('span', { class: 'cd-card-tick', 'aria-hidden': 'true', text: '✓' }),
            el('span', { class: 'cd-card-state', text: '' }),
          ]);
        },
      });
    }

    /**
     * What choosing this candidate means.
     *
     * The four measures first, then where they are strong — and the strong
     * and weak lines are derived from the regional numbers every time rather
     * than written down, so they cannot drift away from the bars above them.
     */
    function candidateDetail() {
      var stats = CMP.candidateStats(draft.avatar);
      var summary = CMP.regionalSummary(draft.avatar);

      return el('div', { class: 'cd-detail' }, [
        el('div', { class: 'cd-stats' }, [
          stat('Popularity', stats.popularity),
          /*
           * Corruption is the one where less is better, so it is the one
           * measure drawn in the warning colour. A player reading four
           * identical bars would otherwise assume 47 was good news.
           */
          stat('Corruption', stats.corruption, 'is-bad'),
          stat('Leadership', stats.leadership),
          stat('Campaign strength', stats.campaignStrength),
        ]),

        el('section', { class: 'cd-block' }, [
          el('h3', { class: 'cd-block-title', text: 'Regional support' }),
          el('div', { class: 'cd-regions' }, summary.ranked.map(function (r) {
            return el('div', { class: 'cd-region' }, [
              el('span', { class: 'cd-region-name', text: r.name }),
              el('span', { class: 'cd-region-track' }, [
                el('span', { class: 'cd-region-fill', style: { width: r.value + '%' } }),
              ]),
              el('span', { class: 'cd-region-value', text: r.value + '%' }),
            ]);
          })),
          /*
           * Said plainly, because this is the only number on the screen that
           * changes the game rather than describing it.
           */
          el('p', {
            class: 'cd-note',
            text: 'Where your candidate is strong, the same money buys more ' +
              'influence. Where they are weak, it buys less.',
          }),
        ]),

        summary.even
          ? el('p', { class: 'cd-summary is-even', text: 'Even across all three regions.' })
          : el('div', { class: 'cd-summary' }, [
              summary.strongest.length
                ? el('div', { class: 'cd-summary-part' }, [
                    el('span', { class: 'cd-summary-label', text: 'Strongest' }),
                    el('strong', {
                      class: 'cd-summary-value',
                      text: summary.strongest.map(function (r) { return r.name; }).join(' · '),
                    }),
                  ])
                : null,
              summary.weakest
                ? el('div', { class: 'cd-summary-part is-weak' }, [
                    el('span', { class: 'cd-summary-label', text: 'Weaker in' }),
                    el('strong', { class: 'cd-summary-value', text: summary.weakest.name }),
                  ])
                : null,
            ]),

        /*
         * Grant potential, kept at arm's length on purpose.
         *
         * This reads js/data/grants-config.js and nothing else — not today's
         * grant amounts, not the engine's grant rules — because the grant
         * system is going to be redesigned and this screen should not have to
         * be rebuilt with it. It is an opportunity reading, and it says so.
         */
        el('section', { class: 'cd-block' }, [
          el('h3', { class: 'cd-block-title', text: 'Grant potential' }),
          el('div', { class: 'cd-regions' }, (CMP.REGIONS || []).map(function (region) {
            var value = CMP.grantPotential(
              CMP.grantContextFor(null, region.id, draft.avatar));
            return el('div', { class: 'cd-region is-grant' }, [
              el('span', { class: 'cd-region-name', text: region.name }),
              el('span', { class: 'cd-region-track' }, [
                el('span', { class: 'cd-region-fill', style: { width: value + '%' } }),
              ]),
              el('span', { class: 'cd-region-value', text: value + '%' }),
            ]);
          })),
          el('p', {
            class: 'cd-note',
            text: 'How promising each region looks for grants — an ' +
              'opportunity, not an amount. Grants are earned by taking ' +
              'districts outright.',
          }),
        ]),
      ]);
    }

    /*
     * The two nodes that follow a choice.
     *
     * Everything on a step that depends on what is selected lives in one of
     * these, so a selection repaints a panel rather than the screen — and the
     * rail above it is never touched.
     */
    var detailNode = el('div', { class: 'cd-detail-slot' });
    var partySideNode = el('div', { class: 'party-side-slot' });

    function paintDetail() {
      CMP.ui.dom.mount(detailNode, [candidateDetail()]);
    }

    function paintPartySide() {
      // The symbol carries the party colour, and the colour swatches show
      // which one is assigned when nobody has chosen: both follow the symbol.
      if (rails.symbol) {
        rails.symbol.node.style.setProperty('--party', partySoFar().colour);
      }
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
      var node = rail('symbol', {
        className: 'pick-rail',
        label: 'Party symbol',
        items: CMP.PARTY_SYMBOLS,
        chosen: function () {
          return draft.partySymbol;
        },
        onPick: function (id) {
          draft.partySymbol = id;
          if (CMP.audio) CMP.audio.play('select');
          paintPartySide();
        },
        card: function (sym) {
          return el('button', {
            class: 'pick-card sym-option',
            type: 'button',
            role: 'radio',
            title: sym.name,
            'aria-label': sym.name,
          }, [
            el('span', { class: 'pick-card-art' }, [CMP.ui.symbol.render(sym.id, 56)]),
            el('span', { class: 'pick-card-name', text: sym.name }),
          ]);
        },
      });
      /*
       * The party colour lives on the rail, not on every card.
       *
       * It changes when a colour is chosen, and a card that carried its own
       * copy would have to be rebuilt to follow it — which is exactly the
       * remount this whole arrangement exists to avoid.
       */
      node.style.setProperty('--party', partySoFar().colour);
      return node;
    }

    function colourGrid() {
      var chosen = colourId();
      return el('div', { class: 'col-grid' }, CMP.PARTY_COLOURS.map(function (swatch) {
        var on = draft.colourChosen && draft.partyColour === swatch.id;
        return el('button', {
          class: 'col-option' + (on ? ' is-on' : '') +
            (!draft.colourChosen && chosen === swatch.id ? ' is-assigned' : ''),
          type: 'button',
          title: swatch.name,
          'aria-label': swatch.name,
          'aria-pressed': on ? 'true' : 'false',
          style: { '--swatch': swatch.colour },
          onclick: function () {
            draft.partyColour = swatch.id;
            draft.colourChosen = true;
            paintPartySide();
          },
        });
      }));
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
      rememberRails();

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
      restoreRails();
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
