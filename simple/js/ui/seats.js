/**
 * Where the seats are.
 * ------------------------------------------------------------------
 * Two views of the same 117 constituencies.
 *
 * "Leading from" answers the question a player actually has after reading the
 * leaderboard: forty-eight seats, but which ones? It groups the board by
 * whoever leads each seat and lists a handful under each party, with the rest
 * one tap away. Names, not numbers — a seat count means nothing until you can
 * see it is Batala and Majitha rather than somewhere you have never worked.
 *
 * The full list is the same data with a search box and a filter, for when a
 * player is looking for one particular seat rather than browsing.
 *
 * Neither view counts anything. Both read the leaders the round settled.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.seats = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

  /** How many seats are listed per party before the rest are folded away. */
  var PREVIEW = 6;

  function partyOf(id) {
    return CMP.getParty(id);
  }

  var byNumber = null;
  function seatDef(number) {
    if (!byNumber) {
      byNumber = {};
      CMP.CONSTITUENCIES.forEach(function (c) {
        byNumber[c.number] = c;
      });
    }
    return byNumber[Number(number)] || null;
  }

  /** Who leads each seat, and by how much, straight off the shared board. */
  function survey(game) {
    var rows = [];
    Object.keys(game.support || {}).forEach(function (key) {
      var def = seatDef(key);
      if (!def) return;
      var ranked = CMP.campaign.standings(game.support[key]);
      // A seat nobody has campaigned in is still on the list — it is one of
      // the 117 — but it has no leader and no numbers to show.
      rows.push({
        number: def.number,
        name: def.name,
        district: def.district,
        contested: ranked.length > 0,
        leader: ranked.length ? ranked[0].partyId : null,
        share: ranked.length ? ranked[0].support : 0,
        margin: ranked.length
          ? ranked[0].support - (ranked[1] ? ranked[1].support : 0)
          : 0,
      });
    });
    rows.sort(function (a, b) {
      return a.number - b.number;
    });
    return rows;
  }

  /** The candidate standing for a party, if anybody is. */
  function candidateFor(partyId, roster) {
    for (var i = 0; i < (roster || []).length; i++) {
      if (roster[i].partyId === partyId) return roster[i].candidateName;
    }
    return null;
  }

  /* --------------------------------------------------------- one row */

  /**
   * `showCandidate` is off inside a "leading from" group, where every row
   * would carry the same name — the group header says it once instead. It is
   * on in the full list, where each row can be led by anybody.
   */
  function seatRow(row, roster, onOpen, showCandidate) {
    // An uncontested seat has no leader to colour it or to name.
    var party = row.contested ? partyOf(row.leader) : null;
    var sub = row.contested && showCandidate
      ? (candidateFor(row.leader, roster) || row.district)
      : row.district;

    return el('button', {
      class: 'seat-row' + (row.contested ? '' : ' is-open'),
      type: 'button',
      style: party
        ? { '--party': party.colour, '--party-ink': party.ink || '#fff' }
        : null,
      onclick: function () {
        onOpen(row.number);
      },
    }, [
      el('span', { class: 'seat-row-main' }, [
        el('span', { class: 'seat-row-name', text: row.name }),
        el('span', { class: 'seat-row-sub', text: sub }),
      ]),
      el('span', {
        class: 'seat-row-party',
        text: party ? party.short : 'OPEN',
      }),
      el('span', { class: 'seat-row-chev', 'aria-hidden': 'true', text: '›' }),
    ]);
  }

  /* ------------------------------------------------------ leading from */

  /**
   * The board grouped by who leads it. Parties in seat order, a few named
   * seats each, and a way through to the rest.
   */
  function leadingFrom(game, roster, opts) {
    opts = opts || {};
    var rows = survey(game);
    var groups = {};
    rows.forEach(function (row) {
      // Grouped by who leads, so seats nobody leads are not in any group.
      // Before round one that is the whole board, and the screen says so.
      if (!row.contested) return;
      (groups[row.leader] = groups[row.leader] || []).push(row);
    });

    var order = Object.keys(groups).sort(function (a, b) {
      return groups[b].length - groups[a].length;
    });

    // Before anybody has campaigned there is nothing to group, and the
    // screen says so rather than showing an empty frame.
    if (!order.length) {
      return el('div', { class: 'leading-from' }, [
        el('div', { class: 'lf-empty' }, [
          el('strong', { class: 'lf-empty-title', text: 'No seat has a leader yet' }),
          el('span', {
            class: 'lf-empty-note',
            text: 'All ' + rows.length + ' constituencies are uncontested. ' +
              'Campaign somewhere and this fills in when the round is settled.',
          }),
        ]),
      ]);
    }

    return el('div', { class: 'leading-from' }, order.map(function (partyId) {
      var party = partyOf(partyId);
      var list = groups[partyId];
      // The tightest races first: those are the seats worth knowing about.
      var shown = list.slice().sort(function (a, b) {
        return a.margin - b.margin;
      }).slice(0, PREVIEW);

      return el('section', {
        class: 'lf-group',
        style: { '--party': party.colour, '--party-ink': party.ink || '#fff' },
      }, [
        el('h3', { class: 'lf-head' }, [
          el('span', { class: 'lf-party', text: party.short }),
          candidateFor(partyId, roster)
            ? el('span', { class: 'lf-candidate', text: candidateFor(partyId, roster) })
            : null,
          el('span', { class: 'lf-count', text: 'leading in ' + list.length }),
        ]),
        el('div', { class: 'seat-list' }, shown.map(function (row) {
          return seatRow(row, roster, opts.onOpen, false);
        })),
        list.length > shown.length
          ? el('p', {
              class: 'lf-more',
              text: 'and ' + (list.length - shown.length) + ' more',
            })
          : null,
      ]);
    }).concat([
      el('button', {
        class: 'btn btn-quiet btn-wide',
        type: 'button',
        text: 'View all ' + rows.length,
        onclick: opts.onViewAll,
      }),
    ]));
  }

  /* ------------------------------------------------ the searchable list */

  /**
   * All 117, with a search box and a filter by who leads. This is the view
   * for finding one seat rather than browsing the picture.
   */
  function browser(opts) {
    opts = opts || {};
    var game = null;
    var roster = [];
    var query = '';
    var filter = 'all';

    var listNode = el('div', { class: 'seat-list' });
    var countNode = el('p', { class: 'seat-count' });

    var searchNode = el('input', {
      class: 'field-input seat-search',
      type: 'search',
      placeholder: 'Search 117 constituencies',
      'aria-label': 'Search constituencies',
      oninput: function (e) {
        query = e.target.value.trim().toLowerCase();
        paintList();
      },
    });

    var filtersNode = el('div', { class: 'seat-filters' });

    var root = el('div', { class: 'seat-browser' }, [
      searchNode,
      filtersNode,
      countNode,
      listNode,
    ]);

    function paintFilters() {
      var options = [{ id: 'all', label: 'All' }]
        .concat(CMP.PLAYABLE_PARTIES.map(function (p) {
          return { id: p.id, label: p.short, colour: p.colour };
        }))
        .concat([{ id: 'tossup', label: 'Toss-up' }]);

      mount(filtersNode, options.map(function (o) {
        return el('button', {
          class: 'seat-filter' + (filter === o.id ? ' is-active' : ''),
          type: 'button',
          text: o.label,
          style: o.colour ? { '--party': o.colour } : null,
          onclick: function () {
            filter = o.id;
            paintFilters();
            paintList();
          },
        });
      }));
    }

    function paintList() {
      var rows = survey(game).filter(function (row) {
        if (filter === 'tossup') {
          if (CMP.campaign.ratingFor(row.margin).id !== 'tossup') return false;
        } else if (filter !== 'all' && row.leader !== filter) {
          return false;
        }
        if (!query) return true;
        return row.name.toLowerCase().indexOf(query) !== -1
          || row.district.toLowerCase().indexOf(query) !== -1
          || String(row.number) === query;
      });

      countNode.textContent = rows.length === 1
        ? '1 constituency'
        : rows.length + ' constituencies';

      mount(listNode, rows.length
        ? rows.map(function (row) {
            return seatRow(row, roster, opts.onOpen, true);
          })
        : [el('p', { class: 'muted', text: 'Nothing matches “' + query + '”.' })]);
    }

    function render(next, nextRoster) {
      game = next;
      roster = nextRoster || [];
      paintFilters();
      paintList();
    }

    return { root: root, render: render };
  }

  return {
    survey: survey,
    leadingFrom: leadingFrom,
    browser: browser,
    seatRow: seatRow,
  };
})();
