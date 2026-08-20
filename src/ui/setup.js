/**
 * Setup screen (Phase 1).
 * ------------------------------------------------------------------
 * Party, candidate, opening strategy, difficulty. Nothing here knows any
 * party or strategy by name -- it renders whatever the data files declare.
 */
window.PG = window.PG || {};
PG.ui = PG.ui || {};

PG.ui.setup = (function () {
  'use strict';

  var el = PG.ui.dom.el;
  var mount = PG.ui.dom.mount;
  var fmt = PG.ui.fmt;

  function create(opts) {
    var stateDef = PG.getState(opts.stateId || PG.DEFAULT_STATE);
    var choice = {
      partyId: PG.PLAYABLE_PARTIES[0].id,
      candidateName: '',
      slogan: '',
      strategyId: PG.STRATEGIES[0].id,
      difficulty: 'normal',
    };

    var root = el('div', { class: 'setup-screen' });

    function partyCard(p) {
      var on = choice.partyId === p.id;
      return el(
        'button',
        {
          class: 'party-card' + (on ? ' is-active' : ''),
          type: 'button',
          style: { '--party': p.colour },
          onclick: function () {
            choice.partyId = p.id;
            if (!choice.slogan) choice.slogan = '';
            render();
          },
        },
        [
          el('span', { class: 'party-flag' }, [el('span', { class: 'party-mark', text: p.short })]),
          el('span', { class: 'party-body' }, [
            el('strong', { class: 'party-name', text: p.name }),
            el('span', { class: 'party-tag', text: p.tagline }),
            el('span', { class: 'party-trait' }, [
              el('span', { class: 'trait-label', text: p.trait.label }),
              el('span', { class: 'trait-blurb', text: p.trait.blurb }),
            ]),
          ]),
        ]
      );
    }

    function strategyCard(s) {
      var on = choice.strategyId === s.id;
      return el(
        'button',
        {
          class: 'choice-card' + (on ? ' is-active' : ''),
          type: 'button',
          onclick: function () {
            choice.strategyId = s.id;
            render();
          },
        },
        [
          el('span', { class: 'choice-icon', text: s.icon }),
          el('span', { class: 'choice-body' }, [
            el('strong', { text: s.label }),
            el('span', { class: 'choice-blurb', text: s.blurb }),
            el('span', { class: 'choice-detail', text: s.detail }),
          ]),
        ]
      );
    }

    function difficultyCard(d) {
      var on = choice.difficulty === d.id;
      return el(
        'button',
        {
          class: 'choice-card choice-card-slim' + (on ? ' is-active' : ''),
          type: 'button',
          onclick: function () {
            choice.difficulty = d.id;
            render();
          },
        },
        [
          el('span', { class: 'choice-body' }, [
            el('strong', { text: d.label }),
            el('span', { class: 'choice-blurb', text: d.blurb }),
            el('span', {
              class: 'choice-detail',
              text: 'Purse: ' + stateDef.currency.symbol + d.budget + ' ' + stateDef.currency.unit,
            }),
          ]),
        ]
      );
    }

    function render() {
      var party = PG.PARTY_BY_ID[choice.partyId];
      var saves = PG.storage.list();
      var majority = stateDef.majority(stateDef.totalSeats);

      mount(root, [
        el('div', { class: 'setup-inner' }, [
          el('header', { class: 'setup-head' }, [
            el('span', { class: 'setup-kicker', text: stateDef.electionName }),
            el('h1', { class: 'setup-title' }, [
              'Become the ',
              el('span', { class: 'accent', text: stateDef.officeShort }),
              ' of ' + stateDef.name,
            ]),
            el('p', { class: 'setup-lede' }, [
              stateDef.totalSeats +
                ' assembly constituencies. Ten weeks. One purse. Win ' +
                majority +
                ' seats and you form the government.',
            ]),
            el('p', { class: 'setup-disclaimer' }, [
              'A fictional strategy game. The constituency names, numbers and districts are real; ',
              'the parties, candidates and all political support are invented.',
            ]),
          ]),

          saves.length
            ? el('section', { class: 'setup-section setup-continue' }, [
                el('h2', { class: 'setup-h2', text: 'Continue' }),
                el(
                  'div',
                  { class: 'save-list' },
                  saves.map(function (m) {
                    return el('div', { class: 'save-row' }, [
                      el('span', { class: 'save-dot', style: { background: m.colour } }),
                      el('span', { class: 'save-main' }, [
                        el('strong', { text: m.candidate + ' · ' + m.party }),
                        el('span', {
                          class: 'save-sub',
                          text:
                            (m.status === 'results'
                              ? 'Result declared'
                              : 'Week ' + m.turn + ' of ' + m.turns) +
                            (m.seats !== null && m.seats !== undefined
                              ? ' · projected ' + m.seats + ' seats'
                              : '') +
                            ' · ' + m.slot,
                        }),
                      ]),
                      el('button', {
                        class: 'btn btn-small',
                        type: 'button',
                        text: 'Resume',
                        onclick: function () {
                          opts.onLoad(m.slot);
                        },
                      }),
                      el('button', {
                        class: 'btn btn-ghost btn-small',
                        type: 'button',
                        text: 'Delete',
                        onclick: function () {
                          PG.storage.remove(m.slot);
                          render();
                        },
                      }),
                    ]);
                  })
                ),
              ])
            : null,

          el('section', { class: 'setup-section' }, [
            el('h2', { class: 'setup-h2', text: '1. Choose your party' }),
            el('div', { class: 'party-grid' }, PG.PLAYABLE_PARTIES.map(partyCard)),
          ]),

          el('section', { class: 'setup-section' }, [
            el('h2', { class: 'setup-h2', text: '2. Your candidature' }),
            el('div', { class: 'field-row' }, [
              el('label', { class: 'field' }, [
                el('span', { class: 'field-label', text: 'Candidate name' }),
                el('input', {
                  class: 'field-input',
                  type: 'text',
                  maxlength: '40',
                  value: choice.candidateName,
                  placeholder: 'e.g. Harleen Kaur Sandhu',
                  oninput: function (e) {
                    choice.candidateName = e.target.value;
                    var btn = root.querySelector('.setup-start');
                    if (btn) btn.disabled = false;
                  },
                }),
              ]),
              el('label', { class: 'field' }, [
                el('span', { class: 'field-label', text: 'Campaign slogan' }),
                el('input', {
                  class: 'field-input',
                  type: 'text',
                  maxlength: '48',
                  value: choice.slogan,
                  placeholder: party.slogan,
                  oninput: function (e) {
                    choice.slogan = e.target.value;
                  },
                }),
              ]),
            ]),
          ]),

          el('section', { class: 'setup-section' }, [
            el('h2', { class: 'setup-h2', text: '3. Opening strategy' }),
            el('div', { class: 'choice-grid' }, PG.STRATEGIES.map(strategyCard)),
          ]),

          el('section', { class: 'setup-section' }, [
            el('h2', { class: 'setup-h2', text: '4. Difficulty' }),
            el(
              'div',
              { class: 'choice-grid choice-grid-3' },
              Object.keys(stateDef.difficulties).map(function (k) {
                return difficultyCard(stateDef.difficulties[k]);
              })
            ),
          ]),

          el('footer', { class: 'setup-foot' }, [
            el('div', { class: 'setup-summary' }, [
              el('span', { class: 'summary-dot', style: { background: party.colour } }),
              el('span', {
                text:
                  (choice.candidateName || 'Your candidate') +
                  ' · ' +
                  party.short +
                  ' · ' +
                  PG.STRATEGY_BY_ID[choice.strategyId].label +
                  ' · ' +
                  stateDef.difficulties[choice.difficulty].label,
              }),
            ]),
            el('button', {
              class: 'btn btn-primary btn-large setup-start',
              type: 'button',
              text: 'Launch the campaign',
              onclick: function () {
                opts.onStart({
                  stateId: stateDef.id,
                  partyId: choice.partyId,
                  candidateName: choice.candidateName,
                  slogan: choice.slogan,
                  strategyId: choice.strategyId,
                  difficulty: choice.difficulty,
                });
              },
            }),
          ]),
        ]),
      ]);
    }

    render();
    return { root: root, render: render };
  }

  return { create: create };
})();
