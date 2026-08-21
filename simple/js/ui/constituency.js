/**
 * One constituency, compactly.
 * ------------------------------------------------------------------
 * Who is leading here, by how much, against whom — and, kept firmly separate
 * below it, who the real sitting MLA is.
 *
 * That separation is the only thing on this screen that is not negotiable. The
 * sitting member is a real person and appears as reference only: they take no
 * part in the game, and nothing a player does is attributed to them. The
 * candidates above them are invented, and are the ones actually contesting the
 * fictional election.
 *
 * Everything else here is deliberately small. A player opening a seat wants
 * four numbers and a name, not a page of analysis.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.constituency = (function () {
  'use strict';

  var el = CMP.ui.dom.el;

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

  /** Real party codes may be outside the four; colour them sensibly anyway. */
  function partyColourFor(code) {
    var party = CMP.getParty(String(code || '').toLowerCase());
    return party ? party.colour : '#a89b89';
  }

  function candidateFor(partyId, roster) {
    for (var i = 0; i < (roster || []).length; i++) {
      if (roster[i].partyId === partyId) return roster[i];
    }
    return null;
  }

  /**
   * How the race here has moved, round by round. Offered rather than shown:
   * the four numbers above answer the question, and a chart is for the player
   * who wants to know whether their spending is working.
   */
  function historyChart(history, current, partyId) {
    var points = (history || []).slice();
    if (points.length < 2) {
      return el('p', {
        class: 'history-empty',
        text: points.length
          ? 'One round recorded. The trend appears from round two.'
          : 'No rounds finished yet.',
      });
    }
    if (current) points = points.concat([{ round: points[points.length - 1].round + 1, support: current }]);

    var w = 320;
    var h = 84;
    var padL = 4;
    var padB = 14;
    var minRound = points[0].round;
    var span = Math.max(1, points[points.length - 1].round - minRound);

    // Scale to the range the data occupies, not to zero: five parties in a
    // close seat all sit between 15 and 30 per cent, and a zero-based axis
    // would draw that as five flat lines in a heap.
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

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('class', 'history-chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Support by round in this constituency');

    function add(tag, attrs) {
      var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
      svg.appendChild(node);
      return node;
    }
    function x(round) {
      return padL + ((round - minRound) / span) * (w - padL * 2);
    }
    function y(value) {
      return (h - padB) - ((value - lo) / (hi - lo)) * (h - padB - 8);
    }

    add('line', { x1: padL, y1: h - padB, x2: w - padL, y2: h - padB, class: 'history-axis' });
    CMP.PARTIES.forEach(function (party) {
      var d = points.map(function (p, i) {
        return (i ? 'L' : 'M') + x(p.round).toFixed(1) + ' ' + y(p.support[party.id] || 0).toFixed(1);
      }).join(' ');
      add('path', {
        d: d,
        class: 'history-line' + (party.id === partyId ? ' is-you' : ''),
        stroke: party.colour,
      });
    });

    return el('div', { class: 'history-block' }, [
      svg,
      el('div', { class: 'history-scale' }, [
        el('span', { text: 'Round ' + minRound }),
        el('span', { text: lo.toFixed(0) + '%–' + hi.toFixed(0) + '%' }),
        el('span', { text: 'now' }),
      ]),
    ]);
  }

  /**
   * The panel for one seat.
   * `opts.players` is the roster, `opts.history` the round-by-round board,
   * `opts.onBack` a way out, `opts.footer` anything to hang underneath.
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
    var leadParty = CMP.getParty(lead.partyId);
    var leadCandidate = candidateFor(lead.partyId, opts.players);
    var previous = (game.leaders || {})[String(number)];
    var showHistory = false;

    var historyNode = el('div', { class: 'seat-history' });
    function paintHistory() {
      CMP.ui.dom.mount(historyNode, [
        el('button', {
          class: 'seat-history-toggle',
          type: 'button',
          text: showHistory ? 'Hide support by round' : 'Support by round',
          onclick: function () {
            showHistory = !showHistory;
            paintHistory();
          },
        }),
        showHistory ? historyChart(opts.history, support, game.partyId) : null,
      ]);
    }
    paintHistory();

    return el('div', { class: 'seat-detail' }, [
      /* ---- which seat ---- */
      el('header', { class: 'sd-head' }, [
        opts.onBack
          ? el('button', {
              class: 'sd-back',
              type: 'button',
              'aria-label': 'Back',
              text: '‹',
              onclick: opts.onBack,
            })
          : null,
        el('div', { class: 'sd-title' }, [
          el('h2', { class: 'sd-name', text: def.name }),
          el('p', { class: 'sd-where' }, [
            'AC ' + def.number + ' · ' + def.district,
            def.reserved ? el('span', { class: 'tag', text: def.reserved }) : null,
          ]),
        ]),
      ]),

      /* ---- who is winning it ---- */
      el('div', {
        class: 'sd-leader',
        style: { '--party': leadParty.colour, '--party-ink': leadParty.ink || '#fff' },
      }, [
        leadCandidate && leadCandidate.portraitSeed
          ? CMP.ui.portrait.render(leadCandidate.portraitSeed, 44, leadCandidate.candidateName)
          : el('span', { class: 'sd-leader-flag', text: leadParty.short }),
        el('div', { class: 'sd-leader-body' }, [
          el('span', { class: 'sd-leader-kicker', text: 'Leading' }),
          el('strong', {
            class: 'sd-leader-name',
            text: leadCandidate ? leadCandidate.candidateName : leadParty.name,
          }),
          el('span', { class: 'sd-leader-party', text: leadParty.short }),
        ]),
        el('div', { class: 'sd-leader-figures' }, [
          el('strong', { class: 'sd-leader-share', text: lead.share.toFixed(1) + '%' }),
          el('span', { class: 'sd-rating rating-' + rating.id, text: rating.label }),
        ]),
      ]),

      /* ---- the rest of the field ---- */
      el('div', { class: 'sd-bars' }, lead.ranked.map(function (row, i) {
        var party = CMP.getParty(row.partyId);
        var who = candidateFor(row.partyId, opts.players);
        return el('div', {
          class: 'sd-bar' + (i === 0 ? ' is-leading' : '') +
            (row.partyId === game.partyId ? ' is-you' : ''),
          style: { '--party': party.colour },
        }, [
          el('span', { class: 'sd-bar-party', text: party.short }),
          el('span', { class: 'sd-bar-track' }, [
            el('span', { class: 'sd-bar-fill', style: { width: row.support + '%' } }),
          ]),
          el('span', { class: 'sd-bar-value', text: row.support.toFixed(1) + '%' }),
          who ? el('span', { class: 'sd-bar-who', text: who.candidateName }) : null,
        ]);
      })),

      /* ---- did it change hands ---- */
      previous && previous !== lead.partyId
        ? el('p', { class: 'sd-change' }, [
            el('span', { class: 'sd-change-kicker', text: 'Changed hands' }),
            CMP.getParty(previous).short + ' → ' + leadParty.short,
          ])
        : null,

      /* ---- the real sitting member, kept apart ---- */
      sitting
        ? el('div', { class: 'sd-mla' }, [
            el('span', { class: 'sd-mla-kicker', text: 'Current MLA' }),
            el('strong', { class: 'sd-mla-name', text: sitting.mla }),
            el('span', {
              class: 'sd-mla-party',
              style: { color: partyColourFor(sitting.party) },
              text: sitting.party,
            }),
            el('span', { class: 'sd-mla-note', text: 'Real reference. Takes no part in the game.' }),
          ])
        : null,

      historyNode,
      opts.footer || null,
    ]);
  }

  return {
    render: render,
    leaderOf: leaderOf,
    leadingBadge: leadingBadge,
    partyColourFor: partyColourFor,
    historyChart: historyChart,
  };
})();
