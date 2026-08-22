/**
 * Game statistics.
 * ------------------------------------------------------------------
 * How much of this has actually happened. It used to be spread across the
 * opening screen, where it sat between somebody arriving and somebody playing;
 * it is a screen of its own now, which is a thing you go and look at.
 *
 * Every figure is counted by the server from something that happened. Nothing
 * here is estimated, sampled or made up, and zero is a real answer — a new
 * installation has had no players and should say so rather than invent
 * somebody.
 *
 * Two sources, because they answer two different questions. The counters a
 * finished election writes are about *games*: who played, how many ended in a
 * government. The event log's running totals are about *activity*: opens,
 * elections created, rounds played. Neither is derived from the other.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.stats = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

  /** Cached between visits so coming back is instant. */
  var cached = null;

  function render(opts) {
    var body = el('div', { class: 'st-body' });

    var root = el('section', { class: 'screen screen-stats' }, [
      el('div', { class: 'st-inner' }, [
        el('header', { class: 'st-head' }, [
          el('button', {
            class: 'st-back',
            type: 'button',
            'aria-label': 'Back',
            text: '‹',
            onclick: opts.onBack,
          }),
          el('div', {}, [
            el('h1', { class: 'st-title', text: 'Game Statistics' }),
            el('p', { class: 'st-sub', text: 'Counted from real game activity' }),
          ]),
        ]),
        body,
      ]),
    ]);

    function figure(value, label, note) {
      return el('div', { class: 'st-fig' }, [
        el('strong', { class: 'st-fig-value', text: String(value) }),
        el('span', { class: 'st-fig-label', text: label }),
        note ? el('span', { class: 'st-fig-note', text: note }) : null,
      ]);
    }

    function block(title, note, figures) {
      return el('section', { class: 'st-block' }, [
        el('h2', { class: 'st-block-title', text: title }),
        note ? el('p', { class: 'st-block-note', text: note }) : null,
        el('div', { class: 'st-figs' }, figures),
      ]);
    }

    function paint(data) {
      var s = data.summary || {};
      var t = data.totals || {};

      mount(body, [
        /*
         * Activity first, because it is the question people actually ask —
         * how many people have opened this and how much have they played.
         */
        block('Activity', null, [
          figure(t.linkOpens || 0, 'Link opens',
            'One per device a day, so a refresh adds nothing'),
          figure(s.players || 0, 'Players', 'People who have taken part'),
          figure(t.roundsPlayed || 0, 'Rounds played', 'Counted as each round opens'),
        ]),

        block('Elections', null, [
          figure(t.gamesCreated || 0, 'Elections created'),
          figure(t.onlineGames || 0, 'Online games started'),
          figure(s.elections || 0, 'Games played to the end'),
        ]),

        block('Results', 'Of the elections that finished.', [
          figure(s.governments || 0, 'Governments formed'),
          figure(s.coalitions || 0, 'By coalition'),
          figure(
            (s.elections || 0) - (s.governments || 0),
            'Hung assemblies'
          ),
        ]),

        partyBlock(s.byParty || []),

        el('p', {
          class: 'st-foot',
          text: 'Every figure here is counted by the server from something ' +
            'that happened. Nothing is estimated and nothing is sampled.',
        }),
      ]);
    }

    /**
     * How the parties have done, across every game.
     *
     * Parties are invented per game, so this is grouped by whatever names
     * players actually used — which is the only honest way to report it.
     */
    function partyBlock(rows) {
      if (!rows.length) return null;

      return el('section', { class: 'st-block' }, [
        el('h2', { class: 'st-block-title', text: 'Party performance' }),
        el('p', {
          class: 'st-block-note',
          text: 'Game player statistics — not a real-world poll.',
        }),
        el('div', { class: 'st-parties' }, rows.slice(0, 8).map(function (row) {
          var party = CMP.getParty ? CMP.getParty(row.party) : null;
          return el('div', {
            class: 'st-party',
            style: party ? { '--party': party.colour } : null,
          }, [
            el('span', { class: 'st-party-name', text: party ? party.short : row.party }),
            el('span', { class: 'st-party-track' }, [
              el('span', { class: 'st-party-fill', style: { width: row.share + '%' } }),
            ]),
            el('span', { class: 'st-party-share', text: row.share + '%' }),
            el('span', {
              class: 'st-party-record',
              text: row.won + ' of ' + row.played,
            }),
          ]);
        })),
      ]);
    }

    if (cached) paint(cached);
    else mount(body, [el('p', { class: 'st-note', text: 'Counting…' })]);

    CMP.net
      .stats()
      .then(function (res) {
        if (res && res.ok) {
          cached = res;
          paint(res);
        } else if (!cached) {
          mount(body, [
            el('p', {
              class: 'st-note',
              text: 'Statistics need the server, and it could not be reached.',
            }),
          ]);
        }
      })
      .catch(function () {
        if (!cached) {
          mount(body, [
            el('p', {
              class: 'st-note',
              text: 'Statistics need the server, and it could not be reached.',
            }),
          ]);
        }
      });

    return root;
  }

  return { render: render };
})();
