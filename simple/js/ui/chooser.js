/**
 * Choosing a candidate and a party — the one implementation.
 * ------------------------------------------------------------------
 * Playing alone and playing with friends are the same decisions, so they are
 * the same screens. This holds them, and the solo setup screen and the
 * multiplayer lobby both use it rather than each keeping a version.
 *
 * They had drifted a long way apart. Solo showed large candidate cards with
 * four measures and three regions; the lobby showed no candidate at all and a
 * grid of 26px symbols. A player who founded a party alone and then founded
 * one with friends was doing the same thing twice, differently.
 *
 * THE RAIL, AND WHY IT IS BUILT ONCE
 *
 * A rail is created on first use and never rebuilt. Choosing something toggles
 * a class on buttons that are already there — nothing is remounted, and no
 * scroll position is written.
 *
 * That is not a nicety. Rebuilding the rail on selection is what made picking
 * the tenth candidate scroll back to the first: a new element starts at
 * scrollLeft 0, so the selection was right and the view was wrong. Keeping the
 * element alive keeps "what is chosen" and "where the rail is scrolled"
 * independent, which is the only arrangement in which neither can disturb the
 * other.
 *
 * Cards are keyed by their own id rather than by position, so a card's
 * identity does not depend on where it sits in the list.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.chooser = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

  /**
   * A set of rails that outlive the screens they appear on.
   *
   * One of these per screen. It hands back the same element every time it is
   * asked for a rail, so a step change that rebuilds the page around it does
   * not disturb it — and it remembers where each rail was scrolled to, for
   * the case where moving a live node between parents does not preserve it.
   */
  function rails() {
    var kept = {};

    function rail(id, spec) {
      if (kept[id]) return kept[id].node;

      var cards = {};
      var node = el('div', {
        class: spec.className,
        role: 'radiogroup',
        'aria-label': spec.label,
      }, spec.items.map(function (item, i) {
        var card = spec.card(item, i);
        card.dataset.railId = String(item.id);
        card.addEventListener('click', function () {
          if (card.disabled) return;
          spec.onPick(item.id);
          sync(id);
        });
        cards[item.id] = card;
        return card;
      }));

      kept[id] = { node: node, cards: cards, chosen: spec.chosen };
      sync(id);
      return node;
    }

    /**
     * Mark the chosen card, and bring it into view only if it is not already.
     *
     * "Only if" matters: scrolling on every repaint would fight a player who
     * had scrolled to look at something, and scrolling to a card already on
     * screen is a jolt with no purpose.
     */
    function sync(id) {
      var entry = kept[id];
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
      // scroll. Guarding keeps the headless tests honest rather than
      // pretending they measured something.
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

    function remember() {
      Object.keys(kept).forEach(function (id) {
        var entry = kept[id];
        if (entry.node.clientWidth) entry.at = entry.node.scrollLeft;
      });
    }

    function restore() {
      Object.keys(kept).forEach(function (id) {
        var entry = kept[id];
        if (typeof entry.at === 'number' && entry.node.clientWidth) {
          entry.node.scrollLeft = entry.at;
        }
      });
    }

    function has(id) {
      return !!kept[id];
    }

    function nodeOf(id) {
      return kept[id] ? kept[id].node : null;
    }

    return {
      rail: rail,
      sync: sync,
      remember: remember,
      restore: restore,
      has: has,
      nodeOf: nodeOf,
    };
  }

  /* ------------------------------------------------------- the candidate */

  /**
   * The cast, as a rail of large cards.
   *
   * A face was a small circle in a grid, which is a swatch rather than a
   * character. This is the person the whole campaign is fought as — and since
   * regional support multiplies what a campaign in that region buys, it is
   * also the only choice on these screens with consequences.
   */
  function candidateRail(store, get, set, opts) {
    opts = opts || {};
    return store.rail('candidate', {
      className: 'cd-rail',
      label: 'Your candidate',
      items: CMP.ui.avatars.list().map(function (id) {
        return { id: id };
      }),
      chosen: get,
      onPick: function (id) {
        if (opts.locked && opts.locked()) return;
        set(id);
        if (CMP.audio) CMP.audio.play('select');
        if (opts.onPick) opts.onPick(id);
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

  /** A bar, for a number that means something out of a hundred. */
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
   * What choosing this candidate means.
   *
   * The four measures, then where they are strong — and the strong and weak
   * lines are derived from the regional numbers every time rather than
   * written down, so they cannot drift away from the bars above them.
   */
  function candidateDetail(avatarId, game) {
    var stats = CMP.candidateStats(avatarId);
    var summary = CMP.regionalSummary(avatarId);

    return el('div', { class: 'cd-detail' }, [
      el('div', { class: 'cd-stats' }, [
        stat('Popularity', stats.popularity),
        /*
         * Corruption is the one where less is better, so it is the one drawn
         * in the warning colour. Four identical bars would have a reader
         * assume 47 was good news.
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
       * Reads js/data/grants-config.js and nothing else — not today's grant
       * amounts, not the engine's grant rules — because the grant system is
       * going to be redesigned and this should not have to be rebuilt with it.
       */
      el('section', { class: 'cd-block' }, [
        el('h3', { class: 'cd-block-title', text: 'Grant potential' }),
        el('div', { class: 'cd-regions' }, (CMP.REGIONS || []).map(function (region) {
          var value = CMP.grantPotential(
            CMP.grantContextFor(game || null, region.id, avatarId));
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

  /* ----------------------------------------------------------- the party */

  /**
   * The symbols, as a rail of cards.
   *
   * A symbol is the face of a party — it goes on the scoreboard, the map and
   * every badge in the game — and picking one out of sixteen small squares
   * made it feel like choosing a bullet point.
   */
  function symbolRail(store, get, set, opts) {
    opts = opts || {};
    var node = store.rail('symbol', {
      className: 'pick-rail',
      label: 'Party symbol',
      items: CMP.PARTY_SYMBOLS,
      chosen: get,
      onPick: function (id) {
        if (opts.locked && opts.locked()) return;
        set(id);
        if (CMP.audio) CMP.audio.play('select');
        if (opts.onPick) opts.onPick(id);
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
    return node;
  }

  /**
   * The colours.
   *
   * Optional: one is assigned when nobody chooses, and the assigned one is
   * shown so it is not a surprise later.
   */
  function colourGrid(chosenId, assignedId, set, opts) {
    opts = opts || {};
    return el('div', { class: 'col-grid' }, CMP.PARTY_COLOURS.map(function (swatch) {
      var on = chosenId === swatch.id;
      return el('button', {
        class: 'col-option' + (on ? ' is-on' : '') +
          (!chosenId && assignedId === swatch.id ? ' is-assigned' : ''),
        type: 'button',
        title: swatch.name,
        'aria-label': swatch.name,
        'aria-pressed': on ? 'true' : 'false',
        disabled: !!(opts.locked && opts.locked()),
        style: { '--swatch': swatch.colour },
        onclick: function () {
          set(swatch.id);
        },
      });
    }));
  }

  /**
   * A colour for somebody who never opened the swatches.
   *
   * Derived from what they did choose, so it is stable — the same symbol and
   * face give the same colour every time rather than a new one on each
   * repaint — and it is not the same colour for everybody who skips it.
   */
  function assignedColour(seedParts) {
    var all = CMP.PARTY_COLOURS;
    var seed = (seedParts || []).join('');
    var h = 0;
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
    return all[h % all.length].id;
  }

  /* --------------------------------------------------------- party names */

  var NAME_A = ['Punjab', 'Punjab', 'People’s Punjab', 'New Punjab', 'United Punjab'];
  var NAME_B = ['Development', 'Progress', 'Reform', 'Farmers’', 'Welfare',
    'Democratic', 'Unity', 'Citizens’'];
  var NAME_C = ['Party', 'Alliance', 'Front', 'Congress', 'Morcha', 'Union'];

  /**
   * A party name for somebody who did not want to think of one.
   *
   * Assembled rather than drawn from a fixed list, so two players who both
   * skip the field are unlikely to end up as the same party — and so the list
   * does not have to be long to avoid repeating.
   */
  function generatedName() {
    function pick(list) {
      return list[Math.floor(Math.random() * list.length)];
    }
    return pick(NAME_A) + ' ' + pick(NAME_B) + ' ' + pick(NAME_C);
  }

  return {
    rails: rails,
    candidateRail: candidateRail,
    candidateDetail: candidateDetail,
    symbolRail: symbolRail,
    colourGrid: colourGrid,
    assignedColour: assignedColour,
    generatedName: generatedName,
    stat: stat,
    mount: mount,
  };
})();
