/**
 * Constituency detail.
 * ------------------------------------------------------------------
 * Two clearly separated halves.
 *
 * The top is REAL: the sitting MLA, their party and how entrenched they are.
 * That person is the incumbent the fictional campaign is fought against — they
 * take no part in the game and nothing they do here is attributed to them.
 *
 * The bottom is the FICTIONAL game race: the candidates standing, who is
 * leading, by how much, the projected winner, and how the race has moved round
 * by round. It moves as players campaign.
 *
 * Candidates are the ones players named for themselves at setup. A party
 * nobody is playing is shown with no candidate rather than an invented one —
 * making up a name here would put a fictional person next to a real MLA on the
 * same screen, which is exactly the confusion the split above is there to
 * prevent.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.constituency = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

  /** The party currently ahead in a seat, and by how much. */
  function leaderOf(support) {
    var ranked = CMP.campaign.standings(support);
    if (!ranked.length) return null;
    return {
      partyId: ranked[0].partyId,
      share: ranked[0].support,
      margin: ranked[0].support - (ranked[1] ? ranked[1].support : 0),
      ranked: ranked,
    };
  }

  /** "AAP — LEADING" for a seat, as a small element. */
  function leadingBadge(support, extraClass) {
    var lead = leaderOf(support);
    if (!lead) return null;
    var party = CMP.getParty(lead.partyId);
    return el('span', {
      class: 'leading-badge ' + (extraClass || ''),
      style: { '--party': party.colour, '--party-ink': party.ink },
    }, [
      el('span', { class: 'leading-party', text: party.short }),
      el('span', { class: 'leading-word', text: 'LEADING' }),
    ]);
  }

  /**
   * Every party's candidate, in the order they stand in this seat.
   * `players` is the roster: solo has one entry, multiplayer up to four.
   */
  function candidateTable(game, ranked, players) {
    var byParty = {};
    (players || []).forEach(function (p) {
      if (p && p.partyId) byParty[p.partyId] = p;
    });

    return el('table', { class: 'candidates' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { text: 'Candidate' }),
          el('th', { text: 'Party' }),
          el('th', { class: 'is-num', text: 'Support' }),
        ]),
      ]),
      el(
        'tbody',
        {},
        ranked.map(function (row, i) {
          var party = CMP.getParty(row.partyId);
          var who = byParty[row.partyId];
          var isYou = row.partyId === game.partyId;
          return el('tr', { class: (isYou ? 'is-you' : '') + (i === 0 ? ' is-leading' : '') }, [
            el('td', { class: 'candidate-name' }, [
              who && who.candidateName
                ? el('span', { text: who.candidateName })
                : el('span', { class: 'muted', text: 'No declared candidate' }),
              isYou ? el('span', { class: 'race-you', text: 'you' }) : null,
            ]),
            el('td', {}, [
              el('span', { class: 'race-dot', style: { background: party.colour } }),
              party.short,
            ]),
            el('td', { class: 'is-num', text: row.support.toFixed(1) + '%' }),
          ]);
        })
      ),
    ]);
  }

  /**
   * How this seat has moved, round by round. One line per party, drawn as a
   * plain SVG — a number changing on its own says nothing about whether a
   * campaign is working, and this is the smallest thing that does.
   */
  function historyChart(history, current, partyId) {
    var points = (history || []).slice();
    if (points.length < 2) {
      return el('p', {
        class: 'history-empty',
        text: points.length
          ? 'One round recorded so far. The trend appears from round two.'
          : 'No rounds finished yet — the trend appears once one has.',
      });
    }
    // The live standing is the newest point, so the chart ends where the bars do.
    if (current) points = points.concat([{ round: points[points.length - 1].round + 1, support: current }]);

    var w = 320;
    var h = 96;
    var padL = 4;
    var padB = 16;
    var maxRound = points[points.length - 1].round;
    var minRound = points[0].round;
    var span = Math.max(1, maxRound - minRound);

    // Scale to the range the data actually occupies, not to zero. Five
    // parties in a close seat all sit between 15 and 30 per cent, and an
    // axis starting at zero would draw that as five flat lines in a heap —
    // which is exactly the movement the chart exists to show.
    var lo = Infinity;
    var hi = -Infinity;
    points.forEach(function (p) {
      CMP.PARTIES.forEach(function (party) {
        var v = p.support[party.id] || 0;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      });
    });
    if (!isFinite(lo)) {
      lo = 0;
      hi = 100;
    }
    var pad = Math.max(1.5, (hi - lo) * 0.18);
    lo = Math.max(0, lo - pad);
    hi = Math.min(100, hi + pad);
    if (hi - lo < 3) hi = lo + 3;

    function x(round) {
      return padL + ((round - minRound) / span) * (w - padL * 2);
    }
    function y(value) {
      return (h - padB) - ((value - lo) / (hi - lo)) * (h - padB - 8);
    }

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('class', 'history-chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Support by round for this constituency');

    function add(tag, attrs) {
      var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
      svg.appendChild(node);
      return node;
    }

    add('line', { x1: padL, y1: h - padB, x2: w - padL, y2: h - padB, class: 'history-axis' });

    CMP.PARTIES.forEach(function (party) {
      var d = points
        .map(function (p, i) {
          return (i ? 'L' : 'M') + x(p.round).toFixed(1) + ' ' + y(p.support[party.id] || 0).toFixed(1);
        })
        .join(' ');
      add('path', {
        d: d,
        class: 'history-line' + (party.id === partyId ? ' is-you' : ''),
        stroke: party.colour,
      });
      var last = points[points.length - 1];
      add('circle', {
        cx: x(last.round).toFixed(1),
        cy: y(last.support[party.id] || 0).toFixed(1),
        r: party.id === partyId ? 3.4 : 2.2,
        fill: party.colour,
      });
    });

    var labels = el('div', { class: 'history-scale' }, [
      el('span', { text: 'Round ' + minRound }),
      el('span', { text: lo.toFixed(0) + '% – ' + hi.toFixed(0) + '%' }),
      el('span', { text: 'now' }),
    ]);

    return el('div', { class: 'history-block' }, [svg, labels]);
  }

  /**
   * The full panel for one seat.
   * `opts.showActions` adds a footer the caller can hang buttons on.
   * `opts.players` is the roster, and `opts.history` the round-by-round board.
   */
  function render(game, number, opts) {
    opts = opts || {};
    var def = null;
    for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
      if (CMP.CONSTITUENCIES[i].number === Number(number)) def = CMP.CONSTITUENCIES[i];
    }
    var support = game.support[number];
    if (!def || !support) return el('p', { class: 'muted', text: 'Unknown constituency.' });

    var sitting = CMP.getIncumbent(def.number);
    var lead = leaderOf(support);
    var rating = CMP.campaign.ratingFor(lead.margin);
    var strength = (game.incumbency && game.incumbency[number]) || null;

    return el('div', { class: 'seat-detail' }, [
      /* ---- heading ---- */
      el('div', { class: 'seat-detail-head' }, [
        el('div', {}, [
          el('h2', { class: 'seat-detail-name' }, [
            def.name,
            el('span', { class: 'seat-detail-ac', text: ' — AC ' + def.number }),
          ]),
          el('span', { class: 'seat-detail-district' }, [
            def.district + ' district',
            def.reserved ? el('span', { class: 'tag', text: def.reserved }) : null,
          ]),
        ]),
        leadingBadge(support),
      ]),

      /* ---- real incumbent ---- */
      sitting
        ? el('div', { class: 'incumbent-card' }, [
            el('div', { class: 'incumbent-row' }, [
              el('div', { class: 'incumbent-block' }, [
                el('span', { class: 'stat-label', text: 'Current MLA' }),
                el('strong', { class: 'incumbent-name', text: sitting.mla }),
              ]),
              el('div', { class: 'incumbent-block' }, [
                el('span', { class: 'stat-label', text: 'Current Party' }),
                el('span', {
                  class: 'incumbent-party',
                  style: { color: partyColourFor(sitting.party) },
                  text: sitting.party,
                }),
              ]),
              strength
                ? el('div', { class: 'incumbent-block' }, [
                    el('span', { class: 'stat-label', text: 'Incumbency Strength' }),
                    el('span', { class: 'incumbent-strength', text: strength.label }),
                  ])
                : null,
            ]),
            sitting.byElection
              ? el('span', {
                  class: 'incumbent-note',
                  text:
                    'Won a by-election in ' +
                    sitting.byElection.date +
                    ' — ' +
                    sitting.byElection.reason.toLowerCase() +
                    '.',
                })
              : null,
            el('span', {
              class: 'incumbent-note incumbent-disclaimer',
              text:
                'Real reference data. The sitting member is the incumbent this ' +
                'fictional campaign is fought against and takes no part in the game.',
            }),
          ])
        : null,

      /* ---- fictional race ---- */
      el('div', { class: 'race-block' }, [
        el('div', { class: 'group-head' }, [
          el('h3', { class: 'race-title', text: 'Current Game Race' }),
          el('span', {
            class: 'race-rating rating-' + rating.id,
            text: rating.label,
          }),
        ]),
        el(
          'div',
          { class: 'race-bars' },
          lead.ranked.map(function (row) {
            var party = CMP.getParty(row.partyId);
            var isLeader = row.partyId === lead.partyId;
            var isYou = row.partyId === game.partyId;
            return el('div', { class: 'race-row' + (isYou ? ' is-you' : '') }, [
              el('span', { class: 'race-name' }, [
                el('span', { class: 'race-dot', style: { background: party.colour } }),
                party.short,
                isYou ? el('span', { class: 'race-you', text: 'you' }) : null,
              ]),
              el('span', { class: 'race-track' }, [
                el('span', {
                  class: 'race-fill',
                  style: { width: Math.max(2, row.support * 1.6) + '%', background: party.colour },
                }),
              ]),
              el('span', { class: 'race-value', text: row.support.toFixed(1) + '%' }),
              isLeader ? el('span', { class: 'race-lead', text: 'LEADING' }) : null,
            ]);
          })
        ),
        candidateTable(game, lead.ranked, opts.players),
        el('div', { class: 'projected' }, [
          el('span', { class: 'stat-label', text: 'Projected Winner' }),
          el('span', {
            class: 'projected-party',
            style: { color: CMP.getParty(lead.partyId).colour },
            text: CMP.getParty(lead.partyId).name,
          }),
          el('span', {
            class: 'projected-note',
            text:
              rating.id === 'tossup'
                ? 'Too close to call — this one is still winnable.'
                : 'Ahead by ' + lead.margin.toFixed(1) + ' points.',
          }),
        ]),
      ]),

      /* ---- how the race has moved ---- */
      el('div', { class: 'history-card' }, [
        el('div', { class: 'group-head' }, [
          el('h3', { class: 'race-title', text: 'Support by Round' }),
          el('span', { class: 'group-note', text: 'Every round since the campaign opened.' }),
        ]),
        historyChart(opts.history, support, game.partyId),
      ]),

      opts.footer || null,
    ]);
  }

  /** Real party codes may be outside the four; colour them sensibly anyway. */
  function partyColourFor(code) {
    var party = CMP.getParty(String(code || '').toLowerCase());
    return party ? party.colour : '#a89b89';
  }

  return {
    render: render,
    leaderOf: leaderOf,
    leadingBadge: leadingBadge,
    partyColourFor: partyColourFor,
    historyChart: historyChart,
  };
})();
