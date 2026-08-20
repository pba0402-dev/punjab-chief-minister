/**
 * The campaign panel (right-hand column).
 * ------------------------------------------------------------------
 * Four tabs over the same game state:
 *   Target    - the selected constituency or district, plus what you can do there
 *   Districts - the whole state as a sortable table, for spotting where to go
 *   Briefing  - the news feed
 *   Standings - projected seats, vote share and how the map breaks down
 *
 * The panel shows ratings, bands and qualitative strength rather than raw
 * model numbers: enough to decide with, not enough to solve.
 */
window.PG = window.PG || {};
PG.ui = PG.ui || {};

PG.ui.panel = (function () {
  'use strict';

  var el = PG.ui.dom.el;
  var mount = PG.ui.dom.mount;
  var fmt = PG.ui.fmt;

  var STRENGTH = [
    { max: 0.4, label: 'No presence', hint: 'You have not campaigned here.' },
    { max: 4, label: 'Light touch', hint: 'A start, but barely visible on the ground.' },
    { max: 10, label: 'Active', hint: 'Your campaign is being felt here.' },
    { max: 18, label: 'Heavy', hint: 'A serious effort. Returns are starting to flatten.' },
    { max: Infinity, label: 'Saturated', hint: 'More money here buys very little now.' },
  ];

  function strengthFor(points) {
    for (var i = 0; i < STRENGTH.length; i++) {
      if (points <= STRENGTH[i].max) return STRENGTH[i];
    }
    return STRENGTH[STRENGTH.length - 1];
  }

  function create(opts) {
    var tab = 'target';
    var game = null;
    var projection = null;
    var selection = { seat: null, district: null, region: null };
    var pendingAction = null; // action awaiting an issue / region choice
    var sortKey = 'name';
    var sortDir = 1;

    var body = el('div', { class: 'panel-body' });

    var tabs = [
      { id: 'target', label: 'Target' },
      { id: 'districts', label: 'Districts' },
      { id: 'briefing', label: 'Briefing' },
      { id: 'standings', label: 'Standings' },
    ];

    var tabBar = el(
      'div',
      { class: 'panel-tabs', role: 'tablist' },
      tabs.map(function (t) {
        return el('button', {
          class: 'panel-tab',
          type: 'button',
          role: 'tab',
          dataset: { tab: t.id },
          text: t.label,
          onclick: function () {
            setTab(t.id);
          },
        });
      })
    );

    var root = el('aside', { class: 'panel' }, [tabBar, body]);

    function setTab(id) {
      tab = id;
      Array.prototype.forEach.call(tabBar.children, function (b) {
        var on = b.dataset.tab === id;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      render();
    }

    /* ------------------------------------------------------ helpers */

    function shareBars(shares, limit) {
      var ranked = PG.model.rank(shares).slice(0, limit || 4);
      return el(
        'div',
        { class: 'share-bars' },
        ranked.map(function (r) {
          var p = PG.PARTY_BY_ID[r.id];
          var isPlayer = r.id === game.player.partyId;
          return el('div', { class: 'share-row' + (isPlayer ? ' is-you' : '') }, [
            el('span', { class: 'share-name', text: p.short }),
            el('span', { class: 'share-track' }, [
              el('span', {
                class: 'share-fill',
                style: { width: Math.max(1.5, r.share * 1.7) + '%', background: p.colour },
              }),
            ]),
            el('span', { class: 'share-val', text: fmt.pct(r.share, 1) }),
          ]);
        })
      );
    }

    function ratingChip(rating) {
      var leader = PG.PARTY_BY_ID[rating.leader];
      return el('span', { class: 'chip rating-' + rating.band }, [
        el('span', { class: 'chip-dot', style: { background: leader.colour } }),
        rating.bandLabel + ' ' + leader.short,
      ]);
    }

    function momentumLabel(v) {
      if (v >= 1.2) return { label: 'Surging', cls: 'good' };
      if (v >= 0.5) return { label: 'Building', cls: 'good' };
      if (v <= -1.2) return { label: 'Falling', cls: 'bad' };
      if (v <= -0.5) return { label: 'Slipping', cls: 'bad' };
      return { label: 'Steady', cls: 'flat' };
    }

    /* ------------------------------------------------------ actions */

    function targetForAction(action) {
      if (action.scope === 'seat') return selection.seat ? { seat: selection.seat } : null;
      if (action.scope === 'district') {
        var d =
          selection.district ||
          (selection.seat ? PG.index.seatDef(game.stateId, selection.seat).district : null);
        return d ? { district: d } : null;
      }
      if (action.scope === 'region') {
        var r =
          selection.region ||
          (selection.seat ? PG.index.seatDef(game.stateId, selection.seat).region : null) ||
          (selection.district
            ? PG.index.district(game.stateId, selection.district).region
            : null);
        return r ? { region: r } : null;
      }
      return null;
    }

    function runAction(action, target) {
      var res = PG.engine.play(game, action.id, target);
      if (!res.ok) {
        opts.onToast({ tone: 'bad', text: res.reason });
        return;
      }
      pendingAction = null;
      opts.onAction(res, action, target);
    }

    function actionCard(action) {
      var pid = game.player.partyId;
      var cost = PG.actions.costOf(game, pid, action.id);
      var left = PG.actions.usesLeft(game, pid, action.id);
      var target = targetForAction(action);
      var check = target
        ? PG.engine.canPlay(game, action.id, target)
        : { ok: false, reason: 'Select a ' + action.scope + ' first' };

      var scopeWord =
        action.scope === 'seat'
          ? target
            ? PG.index.seatDef(game.stateId, target.seat).name
            : 'a constituency'
          : action.scope === 'district'
          ? target
            ? target.district + ' district'
            : 'a district'
          : target
          ? target.region + ' region'
          : 'a region';

      return el(
        'button',
        {
          class: 'action-card' + (check.ok ? '' : ' is-disabled'),
          type: 'button',
          disabled: !check.ok,
          title: check.ok ? action.detail : check.reason,
          onclick: function () {
            if (!check.ok) return;
            if (action.needsIssue) {
              pendingAction = { action: action, target: target };
              render();
              return;
            }
            runAction(action, target);
          },
        },
        [
          el('span', { class: 'action-icon', text: action.icon }),
          el('span', { class: 'action-main' }, [
            el('span', { class: 'action-label' }, [
              action.label,
              left !== null ? el('span', { class: 'action-uses', text: left + ' left' }) : null,
            ]),
            el('span', { class: 'action-blurb', text: action.blurb }),
            el('span', { class: 'action-meta' }, [
              el('span', { class: 'action-scope', text: scopeWord }),
              el('span', { class: 'action-tempo', text: action.tempo }),
            ]),
          ]),
          el('span', { class: 'action-cost' }, [
            el('span', { class: 'action-cost-value', text: fmt.money(game, cost) }),
            !check.ok ? el('span', { class: 'action-why', text: check.reason }) : null,
          ]),
        ]
      );
    }

    function issuePicker() {
      var action = pendingAction.action;
      var target = pendingAction.target;
      var seat = game.seats[target.seat];
      var def = PG.index.seatDef(game.stateId, target.seat);
      var party = PG.PARTY_BY_ID[game.player.partyId];

      var ranked = PG.ISSUES.slice().sort(function (a, b) {
        return seat.issueSalience[b.id] - seat.issueSalience[a.id];
      });

      return el('div', { class: 'issue-picker' }, [
        el('div', { class: 'picker-head' }, [
          el('strong', { text: 'What do you promise ' + def.name + '?' }),
          el('button', {
            class: 'btn btn-ghost btn-small',
            type: 'button',
            text: 'Cancel',
            onclick: function () {
              pendingAction = null;
              render();
            },
          }),
        ]),
        el('p', {
          class: 'picker-hint',
          text:
            'A promise only pays if it matches what this seat cares about — and ' +
            party.short +
            ' is more convincing on some issues than others.',
        }),
        el(
          'div',
          { class: 'issue-list' },
          ranked.map(function (issue) {
            var sal = seat.issueSalience[issue.id];
            var cred = party.credibility[issue.id] || 0.5;
            return el(
              'button',
              {
                class: 'issue-row',
                type: 'button',
                onclick: function () {
                  runAction(action, { seat: target.seat, issue: issue.id });
                },
              },
              [
                el('span', { class: 'issue-icon', text: issue.icon }),
                el('span', { class: 'issue-main' }, [
                  el('span', { class: 'issue-label', text: issue.label }),
                  el('span', { class: 'issue-meters' }, [
                    el('span', { class: 'meter-mini' }, [
                      el('span', { class: 'meter-mini-label', text: 'Local concern' }),
                      el('span', { class: 'meter-mini-track' }, [
                        el('span', {
                          class: 'meter-mini-fill',
                          style: { width: Math.min(100, sal * 55) + '%' },
                        }),
                      ]),
                    ]),
                    el('span', { class: 'meter-mini' }, [
                      el('span', { class: 'meter-mini-label', text: 'Your credibility' }),
                      el('span', { class: 'meter-mini-track' }, [
                        el('span', {
                          class: 'meter-mini-fill is-party',
                          style: { width: cred * 100 + '%', background: party.colour },
                        }),
                      ]),
                    ]),
                  ]),
                ]),
              ]
            );
          })
        ),
      ]);
    }

    /* ------------------------------------------------------ target tab */

    function seatView(num) {
      var def = PG.index.seatDef(game.stateId, num);
      var seat = game.seats[num];
      var entry = projection.bySeat[num];
      var pid = game.player.partyId;
      var points = (seat.camp[pid] || 0) + (seat.ground[pid] || 0) * 0.75;
      var strength = strengthFor(points);
      var spend = seat.spend[pid] || 0;
      var topIssues = PG.ISSUES.slice()
        .sort(function (a, b) {
          return seat.issueSalience[b.id] - seat.issueSalience[a.id];
        })
        .slice(0, 3);

      return [
        el('div', { class: 'seat-head' }, [
          el('div', { class: 'seat-title' }, [
            el('span', { class: 'seat-num', text: '#' + def.num }),
            el('h2', { text: def.name }),
            def.reservation === 'SC' ? el('span', { class: 'tag', text: 'SC' }) : null,
          ]),
          el('div', { class: 'seat-sub' }, [
            el('button', {
              class: 'link-btn',
              type: 'button',
              text: def.district + ' district',
              onclick: function () {
                opts.onSelectDistrict(def.district);
              },
            }),
            el('span', { text: ' · ' + def.region + ' · ' + def.settlement }),
          ]),
        ]),
        el('div', { class: 'seat-rating' }, [
          ratingChip(entry.rating),
          el('span', {
            class: 'seat-gap',
            text: entry.rating.playerLeads
              ? 'You lead by ' + fmt.pct(entry.rating.margin, 1)
              : 'You trail by ' + fmt.pct(entry.rating.gap, 1),
          }),
        ]),
        shareBars(entry.shares),
        el('div', { class: 'sub-head', text: 'What matters here' }),
        el(
          'div',
          { class: 'issue-chips' },
          topIssues.map(function (issue) {
            return el('span', { class: 'issue-chip' }, [
              el('span', { text: issue.icon + ' ' + issue.label }),
              el('span', { class: 'issue-chip-track' }, [
                el('span', {
                  class: 'issue-chip-fill',
                  style: { width: Math.min(100, seat.issueSalience[issue.id] * 55) + '%' },
                }),
              ]),
            ]);
          })
        ),
        el('div', { class: 'kv-grid' }, [
          kv('Sitting member', PG.PARTY_BY_ID[seat.incumbent].short),
          kv('Your presence', strength.label),
          kv('Spent here', fmt.money(game, spend)),
          kv('Local mood', PG.ISSUE_BY_ID[seat.localIssue].label),
        ]),
        el('p', { class: 'muted-note', text: strength.hint }),
      ];
    }

    function kv(k, v) {
      return el('div', { class: 'kv' }, [
        el('span', { class: 'kv-k', text: k }),
        el('span', { class: 'kv-v', text: v }),
      ]);
    }

    function districtView(name) {
      var summary = PG.model.districtSummary(game, projection, name);
      var mom = momentumLabel(summary.momentum);
      var pid = game.player.partyId;

      return [
        el('div', { class: 'seat-head' }, [
          el('div', { class: 'seat-title' }, [el('h2', { text: name + ' district' })]),
          el('div', { class: 'seat-sub', text: summary.region + ' region' }),
        ]),
        el('div', { class: 'kv-grid kv-grid-4' }, [
          kv('Seats', String(summary.seats)),
          kv('Projected yours', String(summary.player)),
          kv('Competitive', String(summary.competitive)),
          kv('Spent', fmt.money(game, summary.spend)),
        ]),
        el('div', { class: 'district-momentum ' + mom.cls }, [
          el('span', { class: 'kv-k', text: 'Momentum' }),
          el('span', { class: 'kv-v', text: mom.label }),
        ]),
        el('div', { class: 'sub-head', text: 'Constituencies' }),
        el(
          'div',
          { class: 'seat-list' },
          summary.seatList.map(function (num) {
            var def = PG.index.seatDef(game.stateId, num);
            var entry = projection.bySeat[num];
            var leader = PG.PARTY_BY_ID[entry.rating.leader];
            return el(
              'button',
              {
                class:
                  'seat-list-row' +
                  (entry.rating.playerLeads ? ' is-yours' : '') +
                  (selection.seat === num ? ' is-selected' : ''),
                type: 'button',
                onclick: function () {
                  opts.onSelectSeat(num);
                },
              },
              [
                el('span', { class: 'slr-num', text: def.num }),
                el('span', { class: 'slr-name', text: def.name }),
                el('span', {
                  class: 'slr-band rating-' + entry.rating.band,
                  text: entry.rating.bandLabel,
                }),
                el('span', {
                  class: 'slr-leader',
                  style: { color: leader.colour },
                  text: leader.short,
                }),
              ]
            );
          })
        ),
      ];
    }

    function targetTab() {
      var head;
      if (pendingAction) return [issuePicker()];

      if (selection.seat) head = seatView(selection.seat);
      else if (selection.district) head = districtView(selection.district);
      else
        head = [
          el('div', { class: 'empty-state' }, [
            el('h2', { text: 'Pick somewhere to campaign' }),
            el('p', {
              text:
                'Click a constituency on the map, or open the Districts tab to find where you are weakest.',
            }),
          ]),
        ];

      var applicable = PG.actions.catalogue.filter(function (a) {
        if (selection.seat) return true;
        if (selection.district) return a.scope !== 'seat';
        return false;
      });

      return head.concat([
        el('div', { class: 'sub-head', text: 'Campaign actions' }),
        game.status !== 'campaign'
          ? el('p', { class: 'muted-note', text: 'Campaigning has closed.' })
          : el('div', { class: 'action-list' }, applicable.map(actionCard)),
      ]);
    }

    /* ------------------------------------------------------ districts tab */

    function districtsTab() {
      var rows = PG.index.districtOrder(game.stateId).map(function (name) {
        return PG.model.districtSummary(game, projection, name);
      });

      var cols = [
        { key: 'name', label: 'District', align: 'left' },
        { key: 'seats', label: 'Seats' },
        { key: 'player', label: 'You' },
        { key: 'competitive', label: 'Comp.' },
        { key: 'spend', label: 'Spent' },
        { key: 'momentum', label: 'Mom.' },
      ];

      rows.sort(function (a, b) {
        var av = a[sortKey];
        var bv = b[sortKey];
        if (typeof av === 'string') return av.localeCompare(bv) * sortDir;
        return (av - bv) * sortDir;
      });

      return [
        el('p', {
          class: 'panel-intro',
          text: 'Where your seats are, and where they are not. Click a row to zoom the map.',
        }),
        el('div', { class: 'table-wrap' }, [
          el('table', { class: 'data-table' }, [
            el('thead', {}, [
              el(
                'tr',
                {},
                cols.map(function (c) {
                  return el('th', {
                    class:
                      (c.align === 'left' ? 'ta-left' : '') +
                      (sortKey === c.key ? ' is-sorted' : ''),
                    text: c.label,
                    onclick: function () {
                      if (sortKey === c.key) sortDir = -sortDir;
                      else {
                        sortKey = c.key;
                        sortDir = c.key === 'name' ? 1 : -1;
                      }
                      render();
                    },
                  });
                })
              ),
            ]),
            el(
              'tbody',
              {},
              rows.map(function (r) {
                var mom = momentumLabel(r.momentum);
                return el(
                  'tr',
                  {
                    class: selection.district === r.name ? 'is-selected' : '',
                    onclick: function () {
                      opts.onSelectDistrict(r.name);
                    },
                  },
                  [
                    el('td', { class: 'ta-left' }, [
                      el('span', { class: 'dt-name', text: r.name }),
                      el('span', { class: 'dt-region', text: r.region }),
                    ]),
                    el('td', { text: r.seats }),
                    el('td', { class: 'dt-you', text: r.player }),
                    el('td', { text: r.competitive }),
                    el('td', { text: r.spend > 0 ? fmt.money(game, r.spend) : '—' }),
                    el('td', { class: 'mom-' + mom.cls, text: mom.label }),
                  ]
                );
              })
            ),
          ]),
        ]),
      ];
    }

    /* ------------------------------------------------------ briefing tab */

    function briefingTab() {
      if (!game.feed.length) {
        return [el('div', { class: 'empty-state' }, [el('p', { text: 'Nothing yet.' })])];
      }
      return [
        el('p', { class: 'panel-intro', text: 'Everything your campaign has heard.' }),
        el(
          'div',
          { class: 'feed' },
          game.feed.slice(0, 60).map(function (entry) {
            var clickable = entry.seat || entry.district;
            return el(
              'div',
              {
                class:
                  'feed-item tone-' + entry.tone + ' kind-' + entry.kind +
                  (clickable ? ' is-clickable' : ''),
                onclick: clickable
                  ? function () {
                      if (entry.seat) opts.onSelectSeat(entry.seat);
                      else opts.onSelectDistrict(entry.district);
                    }
                  : null,
              },
              [
                el('div', { class: 'feed-meta' }, [
                  el('span', { class: 'feed-week', text: 'Week ' + entry.turn }),
                  el('span', { class: 'feed-kind', text: entry.kind }),
                ]),
                el('div', { class: 'feed-title', text: entry.title }),
                entry.text ? el('div', { class: 'feed-text', text: entry.text }) : null,
              ]
            );
          })
        ),
      ];
    }

    /* ------------------------------------------------------ standings tab */

    function standingsTab() {
      var ranked = PG.PARTIES.slice().sort(function (a, b) {
        return (projection.counts[b.id] || 0) - (projection.counts[a.id] || 0);
      });
      var stateDef = PG.getState(game.stateId);
      var regions = stateDef.regions();
      var pid = game.player.partyId;

      var regionRows = Object.keys(regions).map(function (rName) {
        var mine = 0;
        var comp = 0;
        regions[rName].seats.forEach(function (n) {
          var r = projection.bySeat[n].rating;
          if (r.playerLeads) mine++;
          if (r.band === 'tossup' || r.band === 'lean') comp++;
        });
        return { name: rName, seats: regions[rName].seats.length, mine: mine, comp: comp };
      });

      return [
        el('p', { class: 'panel-intro', text: 'Projected result if the vote were held today.' }),
        el(
          'div',
          { class: 'standings' },
          ranked.map(function (p) {
            var seats = projection.counts[p.id] || 0;
            return el('div', { class: 'standing-row' + (p.id === pid ? ' is-you' : '') }, [
              el('span', { class: 'standing-name' }, [
                el('span', { class: 'standing-dot', style: { background: p.colour } }),
                p.short,
              ]),
              el('span', { class: 'standing-track' }, [
                el('span', {
                  class: 'standing-fill',
                  style: {
                    width: (seats / projection.total) * 100 + '%',
                    background: p.colour,
                  },
                }),
              ]),
              el('span', { class: 'standing-seats', text: seats }),
              el('span', { class: 'standing-vote', text: fmt.pct(projection.voteShare[p.id], 1) }),
            ]);
          })
        ),
        el('div', { class: 'sub-head', text: 'How the map breaks down' }),
        el('div', { class: 'band-grid' }, [
          bandBox('Safe', projection.playerBands.safe, 'safe'),
          bandBox('Likely', projection.playerBands.likely, 'likely'),
          bandBox('Lean', projection.playerBands.lean, 'lean'),
          bandBox('Toss-ups', projection.bands.tossup, 'tossup'),
        ]),
        el('p', {
          class: 'muted-note',
          text:
            'Safe, Likely and Lean count seats you are ahead in. Toss-ups are every seat still genuinely open — to anyone.',
        }),
        el('div', { class: 'sub-head', text: 'By region' }),
        el('div', { class: 'table-wrap' }, [
          el('table', { class: 'data-table' }, [
            el('thead', {}, [
              el('tr', {}, [
                el('th', { class: 'ta-left', text: 'Region' }),
                el('th', { text: 'Seats' }),
                el('th', { text: 'You' }),
                el('th', { text: 'Competitive' }),
              ]),
            ]),
            el(
              'tbody',
              {},
              regionRows.map(function (r) {
                return el('tr', {}, [
                  el('td', { class: 'ta-left', text: r.name }),
                  el('td', { text: r.seats }),
                  el('td', { class: 'dt-you', text: r.mine }),
                  el('td', { text: r.comp }),
                ]);
              })
            ),
          ]),
        ]),
      ];
    }

    function bandBox(label, value, cls) {
      return el('div', { class: 'band-box rating-' + cls }, [
        el('span', { class: 'band-value', text: value }),
        el('span', { class: 'band-label', text: label }),
      ]);
    }

    /* ------------------------------------------------------ render */

    function render() {
      if (!game) return;
      var content;
      if (tab === 'target') content = targetTab();
      else if (tab === 'districts') content = districtsTab();
      else if (tab === 'briefing') content = briefingTab();
      else content = standingsTab();
      mount(body, content);
      body.scrollTop = body.scrollTop; // keep position stable on re-render
    }

    function update(nextGame, nextProjection, nextSelection) {
      game = nextGame;
      projection = nextProjection;
      selection = nextSelection;
      render();
    }

    setTab('target');

    return {
      root: root,
      update: update,
      setTab: setTab,
      getTab: function () {
        return tab;
      },
      clearPending: function () {
        pendingAction = null;
      },
    };
  }

  return { create: create, strengthFor: strengthFor };
})();
