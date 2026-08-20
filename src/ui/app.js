/**
 * Application shell.
 * ------------------------------------------------------------------
 * Routes between the setup screen and the campaign screen, owns the current
 * game object, and is the only place that calls both the engine and the
 * renderers. Engine code never reaches into here.
 */
window.PG = window.PG || {};
PG.ui = PG.ui || {};

PG.ui.app = (function () {
  'use strict';

  var el = PG.ui.dom.el;
  var mount = PG.ui.dom.mount;
  var fmt = PG.ui.fmt;

  function start(rootNode) {
    var game = null;
    var projection = null;
    var selection = { seat: null, district: null, region: null };
    var map = null;
    var hud = null;
    var panel = null;
    var results = null;
    var dock = null;
    var toastHost = el('div', { class: 'toast-host' });
    var screen = el('div', { class: 'screen' });

    mount(rootNode, [screen, toastHost]);

    /* --------------------------------------------------------- toasts */

    function toast(o) {
      var node = el('div', { class: 'toast tone-' + (o.tone || 'neutral') }, [
        o.title ? el('strong', { text: o.title }) : null,
        el('span', { text: o.text }),
      ]);
      toastHost.appendChild(node);
      window.setTimeout(function () {
        node.classList.add('is-out');
        window.setTimeout(function () {
          if (node.parentNode) node.parentNode.removeChild(node);
        }, 320);
      }, o.tone === 'bad' ? 3200 : 2400);
    }

    /* --------------------------------------------------------- routing */

    function showSetup() {
      game = null;
      var view = PG.ui.setup.create({
        stateId: PG.DEFAULT_STATE,
        onStart: function (choice) {
          beginGame(PG.engine.newGame(choice));
        },
        onLoad: function (slot) {
          var loaded = PG.storage.load(slot);
          if (!loaded) {
            toast({ tone: 'bad', text: 'That save could not be read.' });
            return;
          }
          beginGame(loaded);
        },
      });
      mount(screen, [view.root]);
      document.body.dataset.screen = 'setup';
    }

    function beginGame(next) {
      game = next;
      selection = { seat: null, district: null, region: null };
      buildGameScreen();
      if (game.status === 'results') {
        refresh();
        results.show(game);
      } else {
        refresh();
      }
    }

    /* --------------------------------------------------------- game screen */

    function buildGameScreen() {
      hud = PG.ui.hud.create({
        onMenu: openMenu,
        onSave: function () {
          quickSave(true);
        },
      });

      map = PG.ui.map.create({
        stateId: game.stateId,
        onSelect: function (num) {
          selectSeat(num);
        },
        onDistrict: function (name) {
          selectDistrict(name, { zoom: false });
        },
      });

      panel = PG.ui.panel.create({
        onSelectSeat: selectSeat,
        onSelectDistrict: function (name) {
          selectDistrict(name);
        },
        onAction: onAction,
        onToast: toast,
      });

      results = PG.ui.results.create({
        onRestart: function () {
          showSetup();
        },
      });

      dock = buildDock();

      var mapPane = el('section', { class: 'map-pane' }, [
        buildMapToolbar(),
        map.root,
        buildLegend(),
      ]);

      mount(screen, [
        hud.root,
        el('main', { class: 'game-main' }, [mapPane, panel.root]),
        dock.root,
        results.root,
      ]);
      document.body.dataset.screen = 'game';
    }

    /* --------------------------------------------------------- toolbar */

    var toolbarButtons = {};

    function toggleGroup(name, items, current, onPick) {
      var group = el(
        'div',
        { class: 'toggle-group', role: 'group', 'aria-label': name },
        items.map(function (item) {
          var b = el('button', {
            class: 'toggle' + (item.id === current ? ' is-active' : ''),
            type: 'button',
            text: item.label,
            title: item.title || item.label,
            onclick: function () {
              onPick(item.id);
              Array.prototype.forEach.call(group.children, function (c) {
                c.classList.toggle('is-active', c === b);
              });
            },
          });
          return b;
        })
      );
      return group;
    }

    function buildMapToolbar() {
      var modeGroup = toggleGroup(
        'Map style',
        [
          { id: 'geo', label: 'Geographic', title: 'Constituencies drawn over the map of Punjab' },
          { id: 'hex', label: 'Seat map', title: 'One equal tile per seat — easier to click' },
        ],
        'geo',
        function (id) {
          map.setMode(id);
          map.update(game, projection);
          if (selection.seat) map.select(selection.seat, { notify: false });
          if (selection.district) map.focusOn(selection.district, { zoom: false });
        }
      );

      var colourGroup = toggleGroup(
        'Colour by',
        [
          { id: 'projection', label: 'Projection', title: 'Who is currently ahead in each seat' },
          { id: 'battleground', label: 'Battleground', title: 'Your seats, the open seats and theirs' },
          { id: 'campaign', label: 'Your spend', title: 'Where your money has gone' },
        ],
        'projection',
        function (id) {
          map.setColourMode(id);
          renderLegend();
        }
      );

      toolbarButtons.mode = modeGroup;
      toolbarButtons.colour = colourGroup;

      return el('div', { class: 'map-toolbar' }, [
        el('div', { class: 'toolbar-section' }, [
          el('span', { class: 'toolbar-label', text: 'View' }),
          modeGroup,
        ]),
        el('div', { class: 'toolbar-section' }, [
          el('span', { class: 'toolbar-label', text: 'Colour' }),
          colourGroup,
        ]),
      ]);
    }

    var legendNode = el('div', { class: 'map-legend' });

    function buildLegend() {
      renderLegend();
      return legendNode;
    }

    function renderLegend() {
      if (!game) return;
      var modeId = map ? map.getColourMode() : 'projection';
      var items;

      if (modeId === 'campaign') {
        items = [
          { colour: '#39415a', label: 'No spending' },
          { colour: fmt.mix('#4b5570', PG.PARTY_BY_ID[game.player.partyId].colour, 0.5), label: 'Some' },
          { colour: PG.PARTY_BY_ID[game.player.partyId].colour, label: 'Heavy' },
        ];
      } else if (modeId === 'battleground') {
        var pc = PG.PARTY_BY_ID[game.player.partyId].colour;
        items = [
          { colour: pc, label: 'You lead', opacity: 1 },
          { colour: pc, label: 'You lead narrowly', opacity: 0.5 },
          { colour: '#e8b230', label: 'Toss-up' },
          { colour: '#6b7590', label: 'Rival leads' },
        ];
      } else {
        items = PG.PARTIES.map(function (p) {
          return { colour: p.colour, label: p.short };
        }).concat([{ colour: '#8b93a7', label: 'Faded = uncertain', opacity: 0.4 }]);
      }

      mount(
        legendNode,
        items.map(function (i) {
          return el('span', { class: 'legend-item' }, [
            el('span', {
              class: 'legend-swatch',
              style: { background: i.colour, opacity: i.opacity === undefined ? 1 : i.opacity },
            }),
            i.label,
          ]);
        })
      );
    }

    /* --------------------------------------------------------- dock */

    function buildDock() {
      var info = el('div', { class: 'dock-info' });
      var hint = el('div', { class: 'dock-hint' });
      var actionBtn = el('button', {
        class: 'btn btn-primary btn-large dock-end',
        type: 'button',
        text: 'End week',
        onclick: onEndTurn,
      });

      var root = el('footer', { class: 'dock' }, [
        info,
        hint,
        el('div', { class: 'dock-right' }, [actionBtn]),
      ]);

      function render() {
        var stateDef = PG.getState(game.stateId);

        if (selection.seat) {
          var def = PG.index.seatDef(game.stateId, selection.seat);
          var entry = projection.bySeat[selection.seat];
          var leader = PG.PARTY_BY_ID[entry.rating.leader];
          mount(info, [
            el('span', { class: 'dock-num', text: '#' + def.num }),
            el('span', { class: 'dock-name', text: def.name }),
            el('span', { class: 'dock-district', text: def.district }),
            el('span', { class: 'dock-band rating-' + entry.rating.band }, [
              el('span', { class: 'chip-dot', style: { background: leader.colour } }),
              entry.rating.bandLabel + ' ' + leader.short,
            ]),
            el('span', {
              class: 'dock-margin',
              text: entry.rating.playerLeads
                ? '+' + fmt.pct(entry.rating.margin, 1) + ' you'
                : '−' + fmt.pct(entry.rating.gap, 1) + ' you',
            }),
          ]);
        } else if (selection.district) {
          var s = PG.model.districtSummary(game, projection, selection.district);
          mount(info, [
            el('span', { class: 'dock-name', text: selection.district + ' district' }),
            el('span', { class: 'dock-district', text: s.seats + ' seats' }),
            el('span', { class: 'dock-margin', text: s.player + ' projected yours · ' + s.competitive + ' competitive' }),
          ]);
        } else {
          mount(info, [
            el('span', { class: 'dock-empty', text: 'Click a constituency on the map to campaign there.' }),
          ]);
        }

        var phase = PG.engine.phaseFor(stateDef, game.turn);
        if (game.status === 'electionDay') {
          hint.textContent = 'Campaigning is over. ' + stateDef.name + ' votes.';
          actionBtn.textContent = 'Count the votes';
          actionBtn.classList.add('is-election');
        } else if (game.status === 'results') {
          hint.textContent = 'The result has been declared.';
          actionBtn.textContent = 'See the result';
          actionBtn.classList.add('is-election');
        } else {
          hint.textContent =
            game.actionsLeft > 0
              ? game.actionsLeft +
                ' ' +
                fmt.plural(game.actionsLeft, 'action') +
                ' left · ' +
                phase.blurb
              : 'No actions left this week.';
          actionBtn.textContent =
            game.turn >= stateDef.campaign.turns ? 'End the campaign' : 'End week ' + game.turn;
          actionBtn.classList.remove('is-election');
        }
      }

      return { root: root, render: render };
    }

    /* --------------------------------------------------------- selection */

    function selectSeat(num) {
      selection = {
        seat: num,
        district: PG.index.seatDef(game.stateId, num).district,
        region: PG.index.seatDef(game.stateId, num).region,
      };
      panel.clearPending();
      panel.setTab('target');
      map.select(num, { notify: false });
      refresh();
    }

    function selectDistrict(name, o) {
      selection = {
        seat: null,
        district: name,
        region: PG.index.district(game.stateId, name).region,
      };
      panel.clearPending();
      panel.setTab('target');
      map.focusOn(name, o || {});
      refresh();
    }

    /* --------------------------------------------------------- turns */

    function onAction(res, action, target) {
      refresh();
      var where =
        target.seat !== undefined
          ? PG.index.seatDef(game.stateId, target.seat).name
          : target.district || target.region;
      toast({
        tone: 'good',
        title: action.label,
        text: where + ' · ' + fmt.money(game, res.cost),
      });
      if (game.actionsLeft === 0) {
        toast({ tone: 'neutral', text: 'That was your last action this week.' });
      }
    }

    function onEndTurn() {
      if (game.status === 'results') {
        results.show(game);
        return;
      }
      if (game.status === 'electionDay') {
        runElection();
        return;
      }
      var res = PG.engine.endTurn(game);
      if (!res.ok) {
        toast({ tone: 'bad', text: res.reason });
        return;
      }
      panel.clearPending();
      refresh();
      quickSave(false);
      var latest = game.feed.filter(function (f) {
        return f.turn === game.turn - 1 && (f.kind === 'event' || f.kind === 'brief');
      });
      if (latest.length) {
        toast({
          tone: latest[0].tone,
          title: latest[0].title,
          text: latest[0].text,
        });
      }
      if (game.status === 'electionDay') {
        toast({ tone: 'neutral', title: 'Campaigning has closed', text: 'Time to count the votes.' });
      }
    }

    function runElection() {
      PG.engine.runElection(game);
      quickSave(false);
      refresh();
      map.setColourMode('projection');
      window.setTimeout(function () {
        results.show(game);
      }, 450);
    }

    /* --------------------------------------------------------- projection */

    function computeProjection() {
      if (game.status === 'results' && game.result) {
        var stateDef = PG.getState(game.stateId);
        var tuning = stateDef.tuning;
        var bySeat = {};
        var counts = {};
        var bands = { safe: 0, likely: 0, lean: 0, tossup: 0 };
        var playerBands = { safe: 0, likely: 0, lean: 0, tossup: 0 };
        PG.PARTIES.forEach(function (p) {
          counts[p.id] = 0;
        });
        stateDef.seats().forEach(function (def) {
          var r = game.result.perSeat[def.num];
          var rating = PG.model.rate(r.shares, game.player.partyId, tuning);
          bySeat[def.num] = { shares: r.shares, rating: rating };
          counts[rating.leader]++;
          bands[rating.band]++;
          if (rating.playerLeads) playerBands[rating.band]++;
        });
        var voteShare = {};
        game.result.standings.forEach(function (s) {
          voteShare[s.id] = s.voteShare;
        });
        return {
          bySeat: bySeat,
          counts: counts,
          bands: bands,
          playerBands: playerBands,
          voteShare: voteShare,
          playerSeats: game.result.playerSeats,
          total: game.result.total,
          majority: game.result.majority,
        };
      }
      return PG.model.projectAll(game, { fog: true });
    }

    function refresh() {
      projection = computeProjection();
      hud.render(game, projection);
      map.update(game, projection);
      panel.update(game, projection, selection);
      dock.render();
      renderLegend();
    }

    /* --------------------------------------------------------- saves */

    function quickSave(announce) {
      var res = PG.storage.save(game, PG.storage.AUTOSAVE);
      if (announce) {
        toast(
          res.ok
            ? { tone: 'good', text: 'Campaign saved.' }
            : { tone: 'bad', text: res.reason }
        );
      }
    }

    /* --------------------------------------------------------- menu */

    function openMenu() {
      var overlay = el('div', { class: 'modal-overlay' });
      function close() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
      var slotInput = el('input', {
        class: 'field-input',
        type: 'text',
        maxlength: '24',
        placeholder: 'slot name, e.g. malwa-push',
      });

      mount(overlay, [
        el('div', { class: 'modal' }, [
          el('h2', { text: 'Campaign menu' }),
          el('div', { class: 'modal-row' }, [
            el('button', {
              class: 'btn',
              type: 'button',
              text: 'Save to a named slot',
              onclick: function () {
                var name = (slotInput.value || '').trim().replace(/[^a-z0-9-_ ]/gi, '');
                if (!name) {
                  toast({ tone: 'bad', text: 'Give the slot a name first.' });
                  return;
                }
                var r = PG.storage.save(game, name);
                toast(
                  r.ok ? { tone: 'good', text: 'Saved as "' + name + '".' } : { tone: 'bad', text: r.reason }
                );
                close();
              },
            }),
            slotInput,
          ]),
          el('div', { class: 'modal-actions' }, [
            el('button', {
              class: 'btn',
              type: 'button',
              text: 'Restart this campaign',
              onclick: function () {
                var fresh = PG.engine.newGame({
                  stateId: game.stateId,
                  partyId: game.player.partyId,
                  candidateName: game.player.name,
                  slogan: game.player.slogan,
                  strategyId: game.player.strategyId,
                  difficulty: game.difficulty,
                  seed: game.seed,
                });
                close();
                beginGame(fresh);
                toast({ tone: 'neutral', text: 'Same map, week one.' });
              },
            }),
            el('button', {
              class: 'btn',
              type: 'button',
              text: 'New campaign',
              onclick: function () {
                close();
                showSetup();
              },
            }),
            el('button', {
              class: 'btn btn-ghost',
              type: 'button',
              text: 'Close',
              onclick: close,
            }),
          ]),
          el('p', { class: 'modal-note' }, [
            'Your campaign autosaves at the end of every week. Saves live in this browser (' +
              PG.storage.adapterId() +
              ').',
          ]),
        ]),
      ]);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
      screen.appendChild(overlay);
    }

    /* --------------------------------------------------------- boot */

    var auto = PG.storage.load(PG.storage.AUTOSAVE);
    if (auto) {
      beginGame(auto);
      toast({ tone: 'neutral', text: 'Resumed your saved campaign. Menu → New campaign to start over.' });
    } else {
      showSetup();
    }

    return {
      getGame: function () {
        return game;
      },
      refresh: refresh,
      showResults: function () {
        if (results && game && game.result) results.show(game);
      },
      showSetup: showSetup,
      loadGame: beginGame,
      selectSeat: selectSeat,
      selectDistrict: selectDistrict,
      setTab: function (t) {
        if (panel) panel.setTab(t);
      },
    };
  }

  return { start: start };
})();
