/**
 * One candidate, mid-election.
 * ------------------------------------------------------------------
 * Tapping a party on the scoreboard opens this: who they are, how they stand,
 * where they are strongest, and — if they are you — what you have to spend.
 *
 * A rival's money is not shown, and neither is their heat or anything they did
 * quietly. Anyone watching an election can count seats and see which districts
 * somebody holds; nobody can read a rival's bank statement. That line has held
 * since the first multiplayer brief and it holds here.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.candidate = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var svg = CMP.ui.dom.svg;
  var money = CMP.ui.money;

  function create(opts) {
    var game = null;
    var partyId = null;
    var who = null;
    var isYou = false;

    var root = el('section', { class: 'cd' });

    /* ------------------------------------------------------- reading */

    function stand() {
      var counts = CMP.campaign.heldSeats(game);
      var leaders = CMP.campaign.currentLeaders(game.support);

      var held = [];
      var contested = [];
      (CMP.DISTRICTS || []).forEach(function (d) {
        var mine = d.seats.filter(function (n) {
          return leaders[n] === partyId;
        }).length;
        if (mine === d.seats.length) held.push(d);
        else if (mine > 0) contested.push(d);
      });

      /*
       * Every seat somebody has campaigned in, strongest first, with the
       * margin over whoever is second.
       *
       * Uncontested seats are left out entirely. Ranking a seat nobody has
       * touched as "closest race, margin 0.0" would fill the list with 117
       * ties before a round had been played.
       */
      var rows = [];
      Object.keys(game.support).forEach(function (key) {
        var ranked = CMP.campaign.standings(game.support[key]);
        if (!ranked.length) return;

        var mine = 0;
        var best = 0;
        var bestId = null;
        ranked.forEach(function (row) {
          if (row.partyId === partyId) mine = row.support;
          else if (row.support > best) {
            best = row.support;
            bestId = row.partyId;
          }
        });
        rows.push({
          number: Number(key),
          mine: mine,
          rival: best,
          rivalId: bestId,
          margin: Math.round((mine - best) * 10) / 10,
        });
      });
      rows.sort(function (a, b) {
        return b.margin - a.margin;
      });

      return {
        seats: counts[partyId] || 0,
        support: CMP.campaign.averageSupport(game.support, partyId),
        held: held,
        contested: contested,
        leading: rows.filter(function (r) {
          return r.margin > 0;
        }),
        rows: rows,
      };
    }

    /* ------------------------------------------------------ painting */

    /** Leading, close, behind — the same ring the candidate page has used. */
    function ring(s) {
      var leading = 0;
      var close = 0;
      var behind = 0;
      s.rows.forEach(function (r) {
        if (Math.abs(r.margin) <= 6) close++;
        else if (r.margin > 0) leading++;
        else behind++;
      });

      var total = s.rows.length || 1;
      var R = 42;
      var C = 2 * Math.PI * R;
      var offset = 0;

      var slices = [
        { label: 'Leading', count: leading, colour: 'var(--wheat)' },
        { label: 'Close', count: close, colour: 'var(--river)' },
        { label: 'Behind', count: behind, colour: 'var(--line)' },
      ];

      var arcs = slices.map(function (slice) {
        var length = (slice.count / total) * C;
        var node = svg('circle', {
          class: 'ring-arc',
          cx: '50', cy: '50', r: String(R),
          fill: 'none', stroke: slice.colour, 'stroke-width': '13',
          'stroke-dasharray': length + ' ' + (C - length),
          'stroke-dashoffset': String(-offset),
        });
        offset += length;
        return node;
      });

      return el('div', { class: 'ar-ring-block' }, [
        el('div', { class: 'ar-ring-wrap' }, [
          svg('svg', {
            class: 'ring', viewBox: '0 0 100 100', role: 'img',
            'aria-label': leading + ' leading, ' + close + ' close, ' + behind + ' behind',
          }, [
            svg('circle', {
              cx: '50', cy: '50', r: String(R), fill: 'none',
              stroke: 'var(--line-soft)', 'stroke-width': '13',
            }),
          ].concat(arcs)),
          el('div', { class: 'ar-ring-centre' }, [
            el('strong', { class: 'ar-ring-value', text: String(s.seats) }),
            el('span', { class: 'ar-ring-label', text: 'seats' }),
          ]),
        ]),
        el('ul', { class: 'ar-ring-key' }, slices.map(function (slice) {
          return el('li', { class: 'ar-key-row' }, [
            el('span', { class: 'ar-key-dot', style: { background: slice.colour } }),
            el('span', { class: 'ar-key-label', text: slice.label }),
            el('strong', { class: 'ar-key-count', text: String(slice.count) }),
          ]);
        })),
      ]);
    }

    function figure(value, label, cls) {
      return el('div', { class: 'cd-fig' + (cls ? ' ' + cls : '') }, [
        el('strong', { class: 'cd-fig-value', text: value }),
        el('span', { class: 'cd-fig-label', text: label }),
      ]);
    }

    function paint() {
      if (!game || !partyId) return;

      var party = CMP.getParty(partyId);
      var s = stand();
      var total = CMP.TOTAL_SEATS || 117;
      var districts = (CMP.DISTRICTS || []).length || 23;

      /* ---- who ---- */
      var head = el('div', { class: 'cd-head' }, [
        opts.onBack
          ? el('button', {
              class: 'sd-back',
              type: 'button',
              'aria-label': 'Back',
              text: '‹',
              onclick: opts.onBack,
            })
          : null,
        who && who.avatar
          ? CMP.ui.portrait.render(who.avatar, 52, who.candidateName)
          : el('span', { class: 'ar-flag', text: party.short }),
        el('div', { class: 'cd-who' }, [
          el('strong', {
            class: 'cd-name',
            text: (who && who.candidateName) || party.name,
          }),
          el('span', { class: 'cd-party', style: { '--party': party.colour } }, [
            party.short,
            isYou ? el('span', { class: 'board-tag is-you', text: 'you' }) : null,
            who && who.isAI ? el('span', { class: 'board-tag', text: 'AI' }) : null,
          ]),
          who && who.slogan
            ? el('span', { class: 'cd-slogan', text: '“' + who.slogan + '”' })
            : null,
        ]),
      ]);

      /* ---- how they stand ---- */
      var figures = el('div', { class: 'cd-figs' }, [
        figure(String(s.seats), 'seats', 'is-lead'),
        figure(Math.round(s.support * 10) / 10 + '%', 'support'),
        figure(s.held.length + ' / ' + districts, 'districts'),

        /*
         * Money is the one figure that is not public.
         *
         * Knowing exactly what a rival can afford would tell them where you
         * can and cannot be fought, which is most of the game. Your own is
         * shown because it is yours.
         */
        isYou
          ? figure(money.words(CMP.campaign.remaining(game)) || '₹0', 'available')
          : figure('—', 'private', 'is-private'),
        isYou && CMP.campaign.grantTotal(game)
          ? figure(money.words(CMP.campaign.grantTotal(game)), 'in grants')
          : null,
      ]);

      /* ---- where they hold ground ---- */
      var districtBlock = s.held.length
        ? el('section', { class: 'ar-block' }, [
            el('h3', { class: 'ar-block-title', text: 'Districts controlled' }),
            el('div', { class: 'cd-districts' }, s.held.map(function (d) {
              var region = CMP.getRegion(d.region);
              return el('div', { class: 'cd-district' }, [
                el('span', { class: 'cd-district-name', text: d.name }),
                el('span', { class: 'cd-district-region', text: region ? region.name : '' }),
                el('span', {
                  class: 'cd-district-grant',
                  text: d.seats.length + ' seats · ' + money.words(d.grant),
                }),
              ]);
            })),
          ])
        : el('section', { class: 'ar-block' }, [
            el('h3', { class: 'ar-block-title', text: 'Districts controlled' }),
            el('p', { class: 'ar-block-note', text: 'None held outright yet.' }),
          ]);

      /* ---- the five they hold most safely ---- */
      var top = s.leading.slice(0, 5);
      var topBlock = top.length
        ? el('section', { class: 'ar-block' }, [
            el('h3', { class: 'ar-block-title', text: 'Top 5 strongest seats' }),
            el('div', { class: 'cd-seats' }, top.map(function (r) {
              var def = seatDef(r.number);
              var rival = r.rivalId ? CMP.getParty(r.rivalId) : null;
              return el('button', {
                class: 'cd-seat',
                type: 'button',
                onclick: function () {
                  if (opts.onOpenSeat) opts.onOpenSeat(r.number);
                },
              }, [
                el('span', { class: 'cd-seat-name', text: def ? def.name : ('Seat ' + r.number) }),
                el('span', { class: 'cd-seat-margin', text: '+' + r.margin.toFixed(1) }),
                el('span', {
                  class: 'cd-seat-rival',
                  text: rival ? 'over ' + rival.short : '',
                }),
              ]);
            })),
          ])
        : null;

      mount(root, [
        head,
        figures,
        ring(s),
        el('p', {
          class: 'ar-block-note',
          text: 'Average share across all ' + total + ' seats. Fictional game ' +
            'data, not a real-world opinion poll.',
        }),
        districtBlock,
        topBlock,
        el('button', {
          class: 'btn btn-quiet btn-wide',
          type: 'button',
          text: isYou ? 'All my seats' : 'All their seats',
          onclick: function () {
            if (opts.onAllSeats) opts.onAllSeats(partyId);
          },
        }),
      ]);
    }

    function seatDef(number) {
      for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
        if (CMP.CONSTITUENCIES[i].number === Number(number)) return CMP.CONSTITUENCIES[i];
      }
      return null;
    }

    function render(nextGame, nextParty, nextWho, youAre) {
      game = nextGame;
      partyId = nextParty;
      who = nextWho;
      isYou = !!youAre;
      paint();
    }

    return { root: root, render: render };
  }

  return { create: create };
})();
