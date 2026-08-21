/**
 * A candidate's areas — the strategy centre.
 * ------------------------------------------------------------------
 * Opened by tapping a candidate on the leaderboard. It answers one question:
 * where is this party winning, where is it close, and where is it losing.
 *
 * For your own candidate that is where you decide to spend. For a rival it is
 * public information only — where they lead and where they are vulnerable, and
 * nothing about their money, their heat, or what they have been doing quietly.
 * Anyone watching an election can count seats; nobody can read a rival's bank
 * statement.
 *
 * It opens as a summary — the shape of the campaign in one screenful — and
 * the full list of 117 is one tap further in. Somebody deciding where to spend
 * wants the five closest races, not a scroll through every seat in Punjab.
 *
 * The default sort is the closest race first, because that is where a move
 * changes a seat rather than padding a lead.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.areas = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var svg = CMP.ui.dom.svg;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  /** A seat is "close" when the margin is inside this many points. */
  var CLOSE_MARGIN = 6;

  var FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'leading', label: 'Leading' },
    { id: 'close', label: 'Close' },
    { id: 'losing', label: 'Losing' },
    { id: 'safe', label: 'Uncontested' },
  ];

  var SORTS = [
    { id: 'closest', label: 'Closest race' },
    { id: 'lead', label: 'Largest lead' },
    { id: 'name', label: 'Name' },
    { id: 'district', label: 'District' },
  ];

  /**
   * Every seat, from this party's point of view: their share, the best rival,
   * and which of the four buckets it falls into.
   */
  function survey(game, partyId) {
    var rows = [];
    Object.keys(game.support || {}).forEach(function (key) {
      var def = null;
      for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
        if (CMP.CONSTITUENCIES[i].number === Number(key)) def = CMP.CONSTITUENCIES[i];
      }
      if (!def) return;

      var seat = game.support[key];
      var mine = seat[partyId] || 0;
      var rivalId = null;
      var rival = 0;
      Object.keys(seat).forEach(function (pid) {
        if (pid !== partyId && seat[pid] > rival) {
          rival = seat[pid];
          rivalId = pid;
        }
      });

      var margin = mine - rival;
      var bucket;
      if (margin > CLOSE_MARGIN) bucket = 'safe';
      else if (margin > 0) bucket = 'leading';
      else if (margin > -CLOSE_MARGIN) bucket = 'close';
      else bucket = 'losing';

      rows.push({
        number: def.number,
        name: def.name,
        district: def.district,
        mine: mine,
        rivalId: rivalId,
        rival: rival,
        margin: margin,
        bucket: bucket,
        leading: margin > 0,
      });
    });
    return rows;
  }

  /**
   * Where this party stands across all 117, as a ring. Three slices only —
   * leading, close, behind — because a chart with a slice for every bucket
   * would need a legend to read, and this needs to be read at a glance.
   */
  function shapeRing(rows) {
    var leading = 0;
    var close = 0;
    var behind = 0;
    rows.forEach(function (row) {
      if (row.bucket === 'close') close++;
      else if (row.leading) leading++;
      else behind++;
    });

    var total = rows.length || 1;
    var slices = [
      { label: 'Leading', count: leading, colour: 'var(--wheat)' },
      { label: 'Close', count: close, colour: 'var(--river)' },
      { label: 'Behind', count: behind, colour: 'var(--line)' },
    ];

    // A stroked circle with a dash pattern draws a ring without any path
    // arithmetic, and gets the arcs exactly right at every size.
    var R = 42;
    var C = 2 * Math.PI * R;
    var offset = 0;

    var arcs = slices.map(function (slice) {
      var length = (slice.count / total) * C;
      var node = svg('circle', {
        class: 'ring-arc',
        cx: '50',
        cy: '50',
        r: String(R),
        fill: 'none',
        stroke: slice.colour,
        'stroke-width': '13',
        'stroke-dasharray': length + ' ' + (C - length),
        'stroke-dashoffset': String(-offset),
      });
      offset += length;
      return node;
    });

    var chart = svg('svg', {
      class: 'ring',
      viewBox: '0 0 100 100',
      role: 'img',
      'aria-label': leading + ' leading, ' + close + ' close, ' + behind + ' behind',
    }, [
      svg('circle', {
        cx: '50', cy: '50', r: String(R),
        fill: 'none', stroke: 'var(--line-soft)', 'stroke-width': '13',
      }),
    ].concat(arcs));

    return el('div', { class: 'ar-ring-block' }, [
      el('div', { class: 'ar-ring-wrap' }, [
        chart,
        el('div', { class: 'ar-ring-centre' }, [
          el('strong', { class: 'ar-ring-value', text: String(leading) }),
          el('span', { class: 'ar-ring-label', text: 'leading' }),
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

  /**
   * Average support across all 117 seats, for each party.
   *
   * This is a figure the game computes from its own board. It is not a poll,
   * it does not come from anywhere outside the game, and it says nothing about
   * how anybody would actually vote in Punjab.
   */
  function statewideSupport(game) {
    var totals = {};
    var seats = Object.keys(game.support || {});
    seats.forEach(function (key) {
      var seat = game.support[key];
      Object.keys(seat).forEach(function (pid) {
        totals[pid] = (totals[pid] || 0) + seat[pid];
      });
    });

    var rows = CMP.PLAYABLE_PARTIES.map(function (p) {
      return {
        party: p,
        share: seats.length ? Math.round((totals[p.id] || 0) / seats.length * 10) / 10 : 0,
      };
    }).sort(function (a, b) {
      return b.share - a.share;
    });

    return el('div', { class: 'ar-support' }, rows.map(function (row) {
      return el('div', { class: 'ar-support-row', style: { '--party': row.party.colour } }, [
        el('span', { class: 'ar-support-name', text: row.party.short }),
        el('span', { class: 'ar-support-track' }, [
          el('span', { class: 'ar-support-fill', style: { width: row.share + '%' } }),
        ]),
        el('strong', { class: 'ar-support-share', text: row.share.toFixed(1) + '%' }),
      ]);
    }));
  }

  function bucketLabel(row) {
    if (row.bucket === 'safe') return { text: 'Safe', tone: 'is-safe' };
    if (row.bucket === 'leading') return { text: 'Leading', tone: 'is-leading' };
    if (row.bucket === 'close') return { text: 'Close', tone: 'is-close' };
    return { text: 'Behind', tone: 'is-losing' };
  }

  /** One compact, entirely clickable row. */
  function areaRow(row, partyId, onOpen) {
    var party = CMP.getParty(partyId);
    var rival = row.rivalId ? CMP.getParty(row.rivalId) : null;
    var tag = bucketLabel(row);

    return el('button', {
      class: 'area-row ' + tag.tone,
      type: 'button',
      style: { '--party': party.colour, '--rival': rival ? rival.colour : 'transparent' },
      onclick: function () {
        onOpen(row.number);
      },
    }, [
      el('span', { class: 'area-main' }, [
        el('span', { class: 'area-name', text: row.name }),
        el('span', { class: 'area-sub' }, [
          el('span', { class: 'area-mine', text: party.short + ' ' + row.mine.toFixed(1) + '%' }),
          rival
            ? el('span', { class: 'area-rival', text: rival.short + ' ' + row.rival.toFixed(1) + '%' })
            : null,
        ]),
      ]),
      el('span', { class: 'area-status ' + tag.tone, text: tag.text }),
      el('span', { class: 'area-chev', 'aria-hidden': 'true', text: '›' }),
    ]);
  }

  /**
   * The page. `opts.isYou` decides whether this is a strategy centre or a
   * look at somebody else's position.
   */
  function create(opts) {
    opts = opts || {};
    var game = null;
    var partyId = null;
    var candidate = null;
    var isYou = false;
    var filter = 'all';
    var sort = 'closest';
    var query = '';
    var showAll = false;   // summary first, the full 117 on request

    var headNode = el('div', { class: 'ar-head' });
    var summaryNode = el('div', { class: 'ar-summary' });
    var controlsNode = el('div', { class: 'ar-controls' });
    var listNode = el('div', { class: 'area-list' });
    var countNode = el('p', { class: 'ar-count' });

    var root = el('section', { class: 'areas' }, [
      headNode,
      summaryNode,
      controlsNode,
      countNode,
      listNode,
    ]);

    function paintHead() {
      var party = CMP.getParty(partyId);
      var counts = CMP.campaign.seatCounts(game.support);
      var seats = counts[partyId] || 0;

      mount(headNode, [
        el('div', { class: 'ar-title' }, [
          opts.onBack
            ? el('button', {
                class: 'sd-back',
                type: 'button',
                'aria-label': 'Back',
                text: '‹',
                onclick: opts.onBack,
              })
            : null,
          candidate && candidate.portraitSeed
            ? CMP.ui.portrait.render(candidate.portraitSeed, 46, candidate.candidateName)
            : el('span', { class: 'ar-flag', text: party.short }),
          el('div', { class: 'ar-who' }, [
            el('strong', { class: 'ar-name', text: candidate ? candidate.candidateName : party.name }),
            el('span', { class: 'ar-party', style: { color: party.colour } }, [
              party.short,
              isYou ? el('span', { class: 'board-tag is-you', text: 'you' }) : null,
              candidate && candidate.isAI ? el('span', { class: 'board-tag', text: 'AI' }) : null,
            ]),
          ]),
        ]),
        el('div', { class: 'ar-figures' }, [
          el('span', { class: 'ar-figure' }, [
            el('strong', { text: String(seats) }),
            el('span', { class: 'ar-figure-label', text: 'seats leading' }),
          ]),
          // A rival's purse is nobody's business. Seats are public; money is not.
          isYou
            ? el('span', { class: 'ar-figure' }, [
                el('strong', { text: money.words(CMP.campaign.remaining(game)) || '₹0' }),
                el('span', { class: 'ar-figure-label', text: 'available' }),
              ])
            : el('span', { class: 'ar-figure is-private' }, [
                el('strong', { text: '—' }),
                el('span', { class: 'ar-figure-label', text: 'private' }),
              ]),
        ]),
      ]);
    }

    /**
     * Spend across many seats at once.
     *
     * Money now carries forward, so a campaign that has saved for four rounds
     * is holding more than any single move can absorb. Without a way to
     * commit it broadly, saving would be a trap. Two shapes cover almost
     * every real decision: press where the races are close, or take a
     * district whole.
     */
    function bulkBlock(rows, closest) {
      var available = CMP.campaign.remaining(game) + CMP.campaign.grantTotal(game);
      var leaders = CMP.campaign.currentLeaders(game.support);

      // Districts worth finishing: ones where a couple of seats would
      // complete the set and start the grant.
      var nearly = (CMP.DISTRICTS || []).map(function (d) {
        var mine = d.seats.filter(function (n) {
          return leaders[n] === partyId;
        }).length;
        return { d: d, mine: mine, short: d.seats.length - mine };
      }).filter(function (row) {
        return row.short > 0 && row.short <= 3;
      }).sort(function (a, b) {
        return a.short - b.short || b.d.grant - a.d.grant;
      }).slice(0, 3);

      function bulkButton(label, note, seats, title) {
        return el('button', {
          class: 'ar-bulk',
          type: 'button',
          disabled: !seats.length,
          onclick: function () {
            CMP.ui.allocate.open({
              game: game,
              seats: seats,
              title: title,
              onPlay: opts.onAllocate,
              onClose: function () {
                if (opts.onChanged) opts.onChanged();
              },
            });
          },
        }, [
          el('span', { class: 'ar-bulk-label', text: label }),
          el('span', { class: 'ar-bulk-note', text: note }),
        ]);
      }

      var closeSeats = closest.slice(0, 12).map(function (r) {
        return r.number;
      });

      return el('section', { class: 'ar-block' }, [
        el('h3', { class: 'ar-block-title', text: 'Campaign in bulk' }),
        el('p', {
          class: 'ar-block-note',
          text: money.words(available) + ' to put to work. One decision, many seats.',
        }),
        el('div', { class: 'ar-bulks' }, [
          closeSeats.length
            ? bulkButton(
                'The closest ' + closeSeats.length + ' races',
                'Where a move changes a seat',
                closeSeats,
                'the closest races'
              )
            : null,
        ].concat(nearly.map(function (row) {
          return bulkButton(
            row.d.name,
            row.short + ' more seat' + (row.short === 1 ? '' : 's') + ' to hold it · ' +
              money.words(row.d.grant) + ' a round',
            row.d.seats,
            row.d.name
          );
        }))),
      ]);
    }

    /** Five rows under a heading — the top of a sorted survey. */
    function topFive(title, note, rows) {
      if (!rows.length) return null;
      return el('section', { class: 'ar-block' }, [
        el('h3', { class: 'ar-block-title', text: title }),
        note ? el('p', { class: 'ar-block-note', text: note }) : null,
        el('div', { class: 'area-list' }, rows.slice(0, 5).map(function (row) {
          return areaRow(row, partyId, opts.onOpen);
        })),
      ]);
    }

    /**
     * The summary: the shape of the campaign, then the five seats worth
     * knowing about in each direction. Everything else is behind one button.
     */
    function paintSummary() {
      if (showAll) {
        mount(summaryNode, []);
        return;
      }

      var rows = survey(game, partyId);

      var strongest = rows.filter(function (r) {
        return r.leading;
      }).sort(function (a, b) {
        return b.margin - a.margin;
      });

      var closest = rows.filter(function (r) {
        return r.bucket === 'close';
      }).sort(function (a, b) {
        return Math.abs(a.margin) - Math.abs(b.margin);
      });

      mount(summaryNode, [
        shapeRing(rows),

        el('section', { class: 'ar-block' }, [
          el('h3', { class: 'ar-block-title', text: 'Statewide support' }),
          el('p', {
            class: 'ar-block-note',
            text: 'Average share across all 117 seats. This is fictional game data, ' +
              'not a real-world opinion poll.',
          }),
          statewideSupport(game),
        ]),

        isYou ? bulkBlock(rows, closest) : null,

        topFive('Top 5 strongest seats', null, strongest),
        topFive('Closest 5 races', 'Where one move could change a seat.', closest),

        el('button', {
          class: 'btn btn-quiet btn-wide ar-view-all',
          type: 'button',
          text: 'View all 117 constituencies',
          onclick: function () {
            showAll = true;
            paintSummary();
            paintControls();
            paintList();
          },
        }),
      ]);
    }

    function paintControls() {
      if (!showAll) {
        mount(controlsNode, []);
        countNode.textContent = '';
        return;
      }

      mount(controlsNode, [
        el('input', {
          class: 'field-input seat-search',
          type: 'search',
          value: query,
          placeholder: 'Search constituency',
          'aria-label': 'Search constituencies',
          oninput: function (e) {
            query = e.target.value.trim().toLowerCase();
            paintList();
          },
        }),
        el('div', { class: 'seat-filters' }, FILTERS.map(function (f) {
          return el('button', {
            class: 'seat-filter' + (filter === f.id ? ' is-active' : ''),
            type: 'button',
            text: f.label,
            onclick: function () {
              filter = f.id;
              paintControls();
              paintList();
            },
          });
        })),
        el('label', { class: 'ar-sort' }, [
          el('span', { class: 'ar-sort-label', text: 'Sort' }),
          el('select', {
            class: 'ar-sort-select',
            onchange: function (e) {
              sort = e.target.value;
              paintList();
            },
          }, SORTS.map(function (o) {
            return el('option', { value: o.id, selected: sort === o.id ? true : null, text: o.label });
          })),
        ]),
      ]);
    }

    function paintList() {
      if (!showAll) {
        mount(listNode, []);
        return;
      }

      var rows = survey(game, partyId).filter(function (row) {
        if (filter !== 'all' && row.bucket !== filter) return false;
        if (!query) return true;
        return row.name.toLowerCase().indexOf(query) !== -1
          || row.district.toLowerCase().indexOf(query) !== -1;
      });

      rows.sort(function (a, b) {
        if (sort === 'closest') return Math.abs(a.margin) - Math.abs(b.margin);
        if (sort === 'lead') return b.margin - a.margin;
        if (sort === 'district') return a.district.localeCompare(b.district) || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name);
      });

      countNode.textContent = rows.length === 1 ? '1 constituency' : rows.length + ' constituencies';
      mount(listNode, rows.length
        ? rows.map(function (row) {
            return areaRow(row, partyId, opts.onOpen);
          })
        : [el('p', { class: 'muted', text: 'Nothing here matches.' })]);
    }

    function render(nextGame, nextParty, nextCandidate, youAre) {
      game = nextGame;
      candidate = nextCandidate;
      // A different candidate is a different question, so it opens on the
      // summary again rather than inheriting the last one's filters.
      if (nextParty !== partyId) {
        showAll = false;
        filter = 'all';
        query = '';
      }
      isYou = !!youAre;
      partyId = nextParty;
      paintHead();
      paintSummary();
      paintControls();
      paintList();
    }

    return { root: root, render: render };
  }

  /** The seat this party is closest to taking or losing, other than one. */
  function nextClosest(game, partyId, exclude) {
    var rows = survey(game, partyId).filter(function (row) {
      return row.number !== Number(exclude);
    });
    rows.sort(function (a, b) {
      return Math.abs(a.margin) - Math.abs(b.margin);
    });
    return rows.length ? rows[0].number : null;
  }

  return {
    create: create,
    survey: survey,
    nextClosest: nextClosest,
    CLOSE_MARGIN: CLOSE_MARGIN,
  };
})();
