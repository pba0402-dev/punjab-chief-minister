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
 * The default sort is the closest race first, because that is where a move
 * changes a seat rather than padding a lead.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.areas = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
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

    var headNode = el('div', { class: 'ar-head' });
    var controlsNode = el('div', { class: 'ar-controls' });
    var listNode = el('div', { class: 'area-list' });
    var countNode = el('p', { class: 'ar-count' });

    var root = el('section', { class: 'areas' }, [headNode, controlsNode, countNode, listNode]);

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

    function paintControls() {
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
      partyId = nextParty;
      candidate = nextCandidate;
      isYou = !!youAre;
      paintHead();
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
