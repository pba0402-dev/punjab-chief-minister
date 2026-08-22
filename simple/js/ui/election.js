/**
 * The game screen.
 * ------------------------------------------------------------------
 * Every screen answers one question, and campaigning is a drill-down rather
 * than a wall:
 *
 *   HOME          who is winning
 *   CANDIDATE     where am I winning, close, or losing
 *   CONSTITUENCY  what is happening here
 *   CAMPAIGN      how much do I want to spend here
 *
 * That is the core loop. Home carries no campaign actions at all — tapping
 * your own candidate opens your areas, tapping a seat opens it, and CAMPAIGN
 * HERE opens the controls. The map is the same journey by another route.
 *
 * Tapping a rival's row opens their position too, but only what an election
 * makes public: seats and support. Never their cash, their heat, or what they
 * have been doing quietly.
 *
 * The screen resolves nothing itself. It calls opts.play() and opts.borrow(),
 * which are the local engine in solo and the server in multiplayer, and it
 * never shows the odds behind a risky action: a cost, a risk word and an
 * expected effect, and the player decides with that.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.election = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  /**
   * The menu, as a two-column grid on the home screen rather than a strip of
   * tabs across the top. Eight destinations fit on a phone without scrolling
   * sideways, and each one opens a screen of its own: click, open, decide,
   * back.
   *
   * CAMPAIGN is first because it is what a player is here to do. It opens the
   * candidate's own seats, and the spending decision happens two taps later at
   * a named constituency, never from this menu.
   */
  /*
   * The menu: ten destinations, two columns, one word under each.
   *
   * A sentence under every item reads as a manual, and a player who has
   * opened Money twice already does not need to be told it is where the cash
   * is. One word is enough to disambiguate, which is all a label owes anybody.
   */
  /*
   * The menu: eight destinations, two columns.
   *
   * Loan, Grant and Alliances used to be here and are not any more. They are not
   * gone — My Areas is reached from the map and the constituency list, which
   * is where somebody thinking about territory already is, and Alliances is
   * under More with the other things that are about the election rather than
   * about this round. Eight buttons fit a phone without scrolling; ten did not.
   */
  /*
   * Every screen in the game, and where it is reached from.
   *
   * There is no dashboard of buttons any more. Home is the map, because what
   * a player does every round is decide where to put money and the place that
   * decision lives is the board. My Areas and Alliances sit above the map as
   * the two strategic screens; the rest are under More, because none of them
   * is a thing anybody opens every round.
   *
   * The list survives because a screen still needs a title and a way back.
   */
  var SECTIONS = [
    { id: 'areas', label: 'Campaign', hint: 'Seats', icon: '◆' },
    { id: 'money', label: 'Money', hint: 'Cash', icon: '₹' },
    { id: 'grants', label: 'Grants', hint: 'Districts', icon: '◈' },
    { id: 'loan', label: 'Loan', hint: '20%', icon: '◇' },
    { id: 'corruption', label: 'Corruption', hint: 'Risk', icon: '▲', risky: true },
    { id: 'bribe', label: 'Bribe', hint: 'Risk', icon: '▲', risky: true },
    { id: 'map', label: 'Map', hint: 'Punjab', icon: '◉' },
    { id: 'seats', label: 'Constituencies', hint: '117', icon: '☰' },
    { id: 'priorities', label: 'Grant', hint: 'Regions', icon: '₹' },
    { id: 'allies', label: 'Alliances', hint: 'Partners', icon: '⚭' },
  ];

  function sectionById(id) {
    var all = SECTIONS;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) return all[i];
    }
    return null;
  }

  function create(opts) {
    var game = null;
    var selected = null;      // the seat a campaign action would target
    var openSeat = null;      // the seat whose detail panel is open
    var openParty = null;     // the candidate whose areas are open
    var section = 'home';
    var lastReport = null;
    var notice = null;
    var busy = false;
    var mapView = null;
    var oversight = null;
    var seatHistory = {};
    var lastRound = 0;
    var openingShown = false;

    /* ------------------------------------------------------ structure */

    var headNode = el('header', { class: 'g-head' });
    var roundNode = el('div', { class: 'g-round' });
    var noticeNode = el('div', { class: 'g-notice' });
    var bodyNode = el('div', { class: 'g-body' });
    var resultsNode = el('div', { class: 'g-results' });
    var endNode = el('div', { class: 'g-end' });
    var summaryNode = el('div', { class: 'summary-slot' });

    var roundView = CMP.ui.round.create({
      readyCount: function () {
        var view = opts.getServerView && opts.getServerView();
        if (view && typeof view.readyOf === 'number') {
          return { count: view.readyCount || 0, of: view.readyOf || 0 };
        }
        return null;
      },
    });
    var resultsShown = false;   // the sequence has run for this round

    var resultsView = CMP.ui.scoreboard.create({
      you: function () {
        return game ? game.partyId : null;
      },
      /*
       * The results read the board the engine already settled rather than
       * working anything out for themselves — there is one election result
       * in this game and this is a presentation of it.
       */
      game: function () {
        return game;
      },
      trend: function () {
        return (game && game.seatTrend) || [];
      },
      /*
       * The sequence has finished, so give the board back.
       *
       * The round is still being counted underneath — the server owns that
       * clock — but the player has seen what happened and should not be held
       * on a screen they have finished reading.
       */
      onFinished: function () {
        resultsShown = true;
        if (game) render(game);
      },
    });
    mount(resultsNode, [resultsView.root]);

    // All 117, searchable — the way to reach a seat by name rather than by
    // whose it is. Built once and reused, so the search box keeps its text.
    var candidateView = CMP.ui.candidate.create({
      onBack: function () {
        openParty = null;
        setSection('home');
      },
      onOpenSeat: function (number) {
        openSeatDetail(number);
      },
      onAllSeats: function (id) {
        openCandidateSeats(id);
      },
    });

    /*
     * Grants: what the campaign earns, and where the next of it is.
     *
     * This is where My Areas was. That screen led with how many seats you
     * were leading, which is a fact about the board rather than a decision
     * about money, and it pushed the question a player comes here with —
     * where does the next crore a round come from — below the fold.
     */
    var grantView = CMP.ui.grant.create({
      onDistrict: function (districtId) {
        var d = CMP.getDistrict(districtId);
        if (!d || !d.seats.length) return;
        campaignHere(d.seats[0], districtId);
      },
    });

    var seatBrowser = CMP.ui.seats.browser({
      onOpen: function (number) {
        openSeatDetail(number);
      },
    });

    var areasView = CMP.ui.areas.create({
      onOpen: function (number) {
        openSeatDetail(number);
      },

      onAllocate: function (actionId, seats, amount) {
        return allocate(actionId, seats, amount);
      },

      onChanged: function () {
        paintPlayer();
        paintBody();
        paintEndRound();
      },
    });

    /**
     * One allocation across many seats. Solo resolves it here; multiplayer
     * asks the server, which rolls every seat itself.
     */
    function allocate(actionId, seats, amount) {
      if (game.mode === 'multiplayer') {
        return CMP.net.allocate(actionId, seats, amount).then(function (res) {
          if (res.ok && res.game && opts.onServerGame) opts.onServerGame(res.game);
          var bulk = (res.game && res.game.lastBulk) || {};
          return res.ok
            ? { ok: true, seats: bulk.seats || seats.length, spent: bulk.spent || amount, reports: [] }
            : { ok: false, reason: res.error };
        });
      }

      // A fresh roll per seat, from the game's own sequence, so a bulk
      // allocation is exactly the same dice as playing each seat by hand.
      var out = CMP.campaign.campaignBulk(game, actionId, seats, amount, function () {
        return CMP.rng.rollsFor(game);
      });
      if (out.ok) CMP.storage.save(game);
      return out;
    }

    var areasView = CMP.ui.areas.create({
      onOpen: function (number) {
        openSeatDetail(number);
      },
      onAllocate: function (actionId, seats, amount) {
        return allocate(actionId, seats, amount);
      },
      onChanged: function () {
        paintPlayer();
        paintBody();
        paintEndRound();
      },
      onBack: function () {
        openParty = null;
        setSection('home');
      },
    });

    // screen-election is what the rest of the app and the suites use to mean
    // "the player is in a campaign"; screen-game is the hook this design
    // styles against. Keeping both means the redesign did not quietly rename
    // a thing other code depends on.
    var root = el('section', { class: 'screen screen-election screen-game' }, [
      el('div', { class: 'g-inner' }, [
        headNode,
        roundNode,
        endNode,
        noticeNode,
        summaryNode,
        resultsNode,
        bodyNode,
      ]),
    ]);

    /* --------------------------------------------------------- helpers */

    function isCounting() {
      return !!(game && game.stage === 'results' && game.lastResult);
    }

    function roster() {
      var view = opts.getServerView && opts.getServerView();
      if (view && view.players) {
        return view.players
          .filter(function (p) {
            return !p.empty && p.partyId;
          })
          .map(function (p) {
            return {
              partyId: p.partyId,
              candidateName: p.candidateName,
              avatar: p.avatar,
              isAI: p.isAI,
              isYou: p.isYou,
            };
          });
      }

      // Solo: the player plus their opponents.
      var mine = [{
        partyId: game.partyId,
        candidateName: game.candidateName,
        avatar: game.avatar,
        isYou: true,
      }];
      return mine.concat((game.opponents || []).map(function (o) {
        return {
          partyId: o.partyId,
          candidateName: o.candidateName,
          avatar: o.avatar,
          isAI: true,
        };
      }));
    }

    function mySeed() {
      var mine = roster().filter(function (p) {
        return p.partyId === game.partyId;
      })[0];
      return mine ? mine.avatar : game.avatar;
    }

    function seatDef(number) {
      for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
        if (CMP.CONSTITUENCIES[i].number === Number(number)) return CMP.CONSTITUENCIES[i];
      }
      return null;
    }

    function pickDefaultSeat() {
      var best = null;
      Object.keys(game.support).forEach(function (number) {
        var view = CMP.campaign.seatView(game, number);
        if (!view) return;
        if (!best || view.margin < best.margin) best = view;
      });
      return best ? Number(best.number) : CMP.CONSTITUENCIES[0].number;
    }

    function setNotice(text, tone) {
      notice = text ? { text: text, tone: tone || 'bad' } : null;
      paintNotice();
    }

    function setSection(next) {
      section = next;
      openSeat = null;
      if (next === 'areas' && !openParty) openParty = game.partyId;
      if (next !== 'areas') openParty = null;
      paintBody();
    }

    /** Open a candidate's areas — your own strategy centre, or a rival's position. */
    /*
     * Tapping a party opens who they are and how they stand — not 117 rows.
     *
     * The full seat list is one more tap from there, which is the right order:
     * most of the time the question is "how are they doing", and only
     * sometimes "where exactly".
     */
    function openCandidate(partyId) {
      openParty = partyId;
      openSeat = null;
      section = 'candidate';
      paintBody();
      toTop();
    }

    function openCandidateSeats(partyId) {
      openParty = partyId;
      openSeat = null;
      section = 'areas';
      paintBody();
      toTop();
    }

    function openSeatDetail(number) {
      openSeat = Number(number);
      selected = Number(number);
      paintBody();
      toTop();
    }

    function toTop() {
      if (root.scrollIntoView) root.scrollIntoView({ block: 'start' });
    }

    /**
     * A seat's round-by-round history. Solo has it locally; multiplayer
     * fetches it once per seat, because fifteen full boards on every poll
     * would dwarf everything else in the response.
     */
    function historyFor(number) {
      if (game.mode !== 'multiplayer') {
        return (game.history || [])
          .map(function (h) {
            return { round: h.round, support: h.board[number] };
          })
          .filter(function (h) {
            return !!h.support;
          });
      }
      var key = String(number);
      if (Object.prototype.hasOwnProperty.call(seatHistory, key)) return seatHistory[key];

      seatHistory[key] = [];
      CMP.net.seatHistory(number).then(function (res) {
        if (!res.ok) return;
        seatHistory[String(res.constituency)] = res.history || [];
        if (openSeat === Number(res.constituency)) paintBody();
      });
      return seatHistory[key];
    }

    /* ---------------------------------------------------------- header */

    /*
     * The game screen does not repeat its own name.
     *
     * A player who is nineteen rounds into an election knows which game they
     * are in. The two lines that used to sit here — the title and the seat
     * count — are on the home screen, where somebody deciding whether to play
     * actually needs them. What is left is a bar: who you are, what you hold,
     * and the way out.
     */
    function paintHead() {
      var party = CMP.getParty(game.partyId);

      mount(headNode, [
        el('div', { class: 'g-who' }, [
          el('span', {
            class: 'g-who-party',
            style: { '--party': party.colour },
            text: party.short,
          }),
          el('span', { class: 'g-who-you', text: 'You' }),
        ]),
        // Not the game menu — this is everything that is not part of a
        // round: the election history, leaving, declaring early.
        el('button', {
          class: 'g-more',
          type: 'button',
          'aria-label': 'More',
          onclick: openMenu,
        }, [
          el('span', { class: 'g-more-bars', 'aria-hidden': 'true' }),
          el('span', { class: 'g-more-label', text: 'More' }),
        ]),
      ]);
    }

    /**
     * One switch in the menu.
     *
     * It says what it is for and what state it is in, and it keeps that state
     * across games — a preference somebody sets once should not need setting
     * again next election.
     */
    function settingRow(key, glyph, label, note) {
      var on = CMP.settings.get(key);
      var row = el('button', {
        class: 'sheet-item is-toggle' + (on ? ' is-on' : ''),
        type: 'button',
        role: 'switch',
        'aria-checked': on ? 'true' : 'false',
      }, [
        el('span', { class: 'sheet-item-glyph', 'aria-hidden': 'true', text: glyph }),
        el('span', { class: 'sheet-item-body' }, [
          el('strong', { class: 'sheet-item-title', text: label }),
          el('span', { class: 'sheet-item-note', text: note }),
        ]),
        el('span', { class: 'sheet-item-state', text: on ? 'On' : 'Off' }),
      ]);

      row.addEventListener('click', function () {
        var now = CMP.settings.toggle(key);
        row.classList.toggle('is-on', now);
        row.setAttribute('aria-checked', now ? 'true' : 'false');
        row.querySelector('.sheet-item-state').textContent = now ? 'On' : 'Off';
      });
      return row;
    }

    /**
     * Leaving, with a question first.
     *
     * Exit is one tap from the map, so it asks — and it says which kind of
     * leaving this is, because in multiplayer the election carries on without
     * you and solo it waits.
     */
    function confirmExit() {
      CMP.ui.dialog
        .confirm({
          title: 'Exit game?',
          body: game.mode === 'multiplayer'
            ? 'The election carries on without you. You can rejoin it from the ' +
              'home screen while it is still running.'
            : 'Your progress is saved. You can pick this election up again from ' +
              'the home screen.',
          confirmLabel: 'Exit game',
        })
        .then(function (yes) {
          if (yes && opts.onMenu) opts.onMenu();
        });
    }

    /**
     * What the map is and is not claiming.
     *
     * This used to sit under the board on every screen, taking space during
     * play to say something a player needs once. It is still said, in the
     * place people go to read rather than the place they go to campaign.
     */
    function showAboutSheet() {
      var sheet = el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { class: 'sheet-title', text: 'About the map' }),
          el('p', { class: 'sheet-note' }, [
            'Constituency names, numbers and districts are real public ' +
            'information. Positions and neighbours are real; the cell shapes ' +
            'are approximate and are not official constituency boundaries. ' +
            'The tiles view makes no geographic claim at all.',
          ]),
          el('p', { class: 'sheet-note' }, [
            'Everything else in this game is invented: the parties, the ' +
            'candidates, and every percentage and seat on the board.',
          ]),
          el('button', {
            class: 'btn btn-quiet btn-wide',
            type: 'button',
            text: 'Close',
            onclick: function () {
              if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
            },
          }),
        ]),
      ]);
      document.body.appendChild(sheet);
    }

    /** Everything that is not part of a round: history, sound, leaving. */
    function openMenu() {
      var view = opts.getServerView && opts.getServerView();
      var isHost = !!(view && view.youAreHost);
      var left = (game.roundsTotal || CMP.ROUNDS.total) - (game.round || 1);

      var sheet = el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { class: 'sheet-title', text: 'Menu' }),

          /*
           * Everything that came off the dashboard.
           *
           * The map is the game now, and none of these is a thing anybody
           * opens every round: money is a ledger you check, grants and loans
           * are occasional decisions, and the risky screens are where you go
           * to read about heat rather than to campaign — campaigning with a
           * bribe happens on the map with everything else.
           */
          el('div', { class: 'sheet-group' }, [
            { id: 'money', label: 'Money' },
            { id: 'grants', label: 'Grants' },
            { id: 'loan', label: 'Loan' },
            { id: 'corruption', label: 'Corruption' },
            { id: 'bribe', label: 'Bribe' },
            { id: 'seats', label: 'All 117 constituencies' },
          ].map(function (item) {
            return el('button', {
              class: 'sheet-item',
              type: 'button',
              text: item.label,
              onclick: function () {
                close();
                setSection(item.id);
              },
            });
          })),

          el('button', {
            class: 'sheet-item',
            type: 'button',
            text: 'Election history',
            onclick: function () {
              close();
              showHistorySheet();
            },
          }),

          /*
           * Sound, and what the map is not claiming.
           *
           * The audio switches remember what the player asked for whether or
           * not anything is playing yet — see js/settings.js, which says so
           * rather than offering a switch that quietly does nothing.
           */
          el('div', { class: 'sheet-group' }, [
            settingRow('music', '\u266a', 'Music', 'Background music'),
            settingRow('sound', '\u25b6', 'Sound', 'Game sound effects'),
          ]),

          el('button', {
            class: 'sheet-item',
            type: 'button',
            onclick: function () {
              close();
              showAboutSheet();
            },
          }, [
            el('strong', { class: 'sheet-item-title', text: 'About the map' }),
            el('span', {
              class: 'sheet-item-note',
              text: 'What the shapes do and do not claim',
            }),
          ]),

          isHost
            ? el('button', {
                class: 'sheet-item is-danger',
                type: 'button',
                text: left > 0 ? 'Close the polls now' : 'Begin the count',
                onclick: function () {
                  close();
                  confirmDeclare(left);
                },
              })
            : null,

          // Stepping away and finishing for good are different things and
          // are worded so nobody has to guess which is which.
          el('button', {
            class: 'sheet-item is-exit',
            type: 'button',
            onclick: function () {
              close();
              confirmExit();
            },
          }, [
            el('strong', { class: 'sheet-item-title', text: '\u23fb  Exit game' }),
            el('span', {
              class: 'sheet-item-note',
              text: game.mode === 'multiplayer'
                ? 'The election carries on. You can rejoin from the home screen.'
                : 'Your progress is saved. Pick it up from the home screen.',
            }),
          ]),

          game.mode === 'multiplayer'
            ? el('button', {
                class: 'sheet-item is-danger',
                type: 'button',
                onclick: function () {
                  close();
                  confirmEndGame();
                },
              }, [
                el('strong', { class: 'sheet-item-title', text: 'End this game' }),
                el('span', {
                  class: 'sheet-item-note',
                  text: 'Finish here for good. You will not be able to rejoin.',
                }),
              ])
            : null,

          el('button', {
            class: 'btn btn-quiet btn-wide',
            type: 'button',
            text: 'Close',
            onclick: function () {
              close();
            },
          }),
        ]),
      ]);

      function close() {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      }
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) close();
      });
      document.body.appendChild(sheet);
    }

    /**
     * Ending a game is the one thing here that cannot be undone, so it says
     * exactly what it costs and makes the safe answer the easy one.
     */
    function confirmEndGame() {
      var sheet = el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { class: 'sheet-title', text: 'End this game?' }),
          el('p', {
            class: 'sheet-text',
            text: 'You will not be able to rejoin this game later. The other ' +
              'players carry on without you, and your seats stay on the board.',
          }),
          el('p', {
            class: 'sheet-text is-quiet',
            text: 'If you only want to stop for now, close this and choose ' +
              '"Leave for now" instead — that keeps your place.',
          }),
          el('button', {
            class: 'btn btn-primary btn-wide',
            type: 'button',
            text: 'Keep playing',
            onclick: function () {
              close();
            },
          }),
          el('button', {
            class: 'btn btn-danger btn-wide',
            type: 'button',
            text: 'End the game for good',
            onclick: function () {
              close();
              if (opts.onEndGame) opts.onEndGame();
            },
          }),
        ]),
      ]);

      function close() {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      }
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) close();
      });
      document.body.appendChild(sheet);
    }

    function showHistorySheet() {
      var sheet = el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { class: 'sheet-title', text: 'Election history' }),
          CMP.ui.scoreboard.historyChart((game && game.seatTrend) || []),
          CMP.ui.scoreboard.historyTable((game && game.seatTrend) || []),
          el('button', {
            class: 'btn btn-quiet btn-wide',
            type: 'button',
            text: 'Close',
            onclick: function () {
              if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
            },
          }),
        ]),
      ]);
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
      });
      document.body.appendChild(sheet);
    }

    function confirmDeclare(left) {
      CMP.ui.dialog
        .confirm({
          eyebrow: 'Host',
          title: left > 0 ? 'End the campaign early?' : 'Begin the count?',
          body: left > 0
            ? 'There are still ' + left + ' rounds to play. Closing now counts the ' +
              'seats as they stand, for everybody.'
            : 'The seats will be counted as they stand.',
          confirmLabel: 'Close the polls',
          danger: true,
        })
        .then(function (yes) {
          if (yes && opts.onDeclare) opts.onDeclare();
        });
    }

    /* ----------------------------------------------------- player strip */

    /*
     * The money, beside the clock.
     *
     * Three figures, in the header, on every screen. It used to be a card of
     * its own under the round bar, which cost a third of a phone screen to say
     * what fits in a corner — and meant a player deep in the map had to come
     * back to Home to find out what they could afford.
     *
     * What is here is what changes: what you can spend, what the districts are
     * paying, and what has gone this round. Available is the one that decides
     * anything, so it is the one that is larger.
     */
    function paintPlayer() {
      var cash = CMP.campaign.remaining(game);
      var grants = CMP.campaign.grantTotal(game);
      var debt = CMP.campaign.debtOf(game);

      function figure(label, value, cls, onclick) {
        return el(onclick ? 'button' : 'div', {
          class: 'g-fig' + (cls ? ' ' + cls : ''),
          type: onclick ? 'button' : null,
          onclick: onclick || null,
        }, [
          el('span', { class: 'g-fig-label', text: label }),
          el('strong', { class: 'g-fig-value', text: value }),
        ]);
      }

      mount(roundView.aside, [
        figure('Available', money.words(cash) || '₹0', 'is-lead'),
        figure('Grant', money.words(grants) || '₹0', grants ? 'is-grant' : null,
          grants ? function () { setSection('grants'); } : null),
        figure('Spent', money.words(game.roundSpent || 0) || '₹0'),
        debt ? figure('Owed', money.words(debt), 'is-debt') : null,
      ]);
    }

    /* -------------------------------------------------------------- nav */

    /*
     * END ROUND.
     *
     * Sits at the foot of the screen, under everything a player might still
     * want to do, so it is reached by finishing rather than by accident. It
     * only locks the player who pressed it: everybody else plays on until they
     * say the same or the clock runs out.
     */
    function paintEndRound() {
      if (!game || isCounting() || !CMP.campaign.roundIsLive(game)) {
        mount(endNode, []);
        return;
      }

      if (game.roundReady) {
        var view = opts.getServerView && opts.getServerView();
        var waiting = view && typeof view.readyOf === 'number'
          ? Math.max(0, view.readyOf - (view.readyCount || 0))
          : 0;

        mount(endNode, [
          el('div', { class: 'g-ready' }, [
            el('span', { class: 'g-ready-tick', 'aria-hidden': 'true', text: '✓' }),
            el('div', { class: 'g-ready-text' }, [
              el('strong', { class: 'g-ready-title', text: "You're ready" }),
              el('span', {
                class: 'g-ready-note',
                text: waiting > 0
                  ? 'Waiting for ' + waiting + ' more player' + (waiting === 1 ? '' : 's')
                  : 'The round is closing.',
              }),
            ]),
          ]),
        ]);
        return;
      }

      /*
       * Compact, and up with the round it ends.
       *
       * It used to be a full-width two-line button at the foot of the screen,
       * under everything else — which meant scrolling past the whole board to
       * finish a turn, and a large target for something that cannot be undone
       * within the round. It asks before it acts, so it does not need to be
       * hard to reach as well.
       */
      mount(endNode, [
        el('button', {
          class: 'btn btn-end',
          type: 'button',
          text: 'End round',
          onclick: confirmEndRound,
        }),
      ]);
    }

    /**
     * Ending a round cannot be undone within that round, so it says what has
     * been spent and what is left before asking.
     */
    function confirmEndRound() {
      var spentThisRound = game.roundSpent || 0;
      var left = CMP.campaign.remaining(game);
      var grants = CMP.campaign.grantTotal(game);

      var sheet = el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { class: 'sheet-title', text: 'Finish this round?' }),

          el('div', { class: 'sum-lines' }, [
            el('div', { class: 'sum-line' }, [
              el('span', { class: 'sum-line-label', text: 'Spent this round' }),
              el('strong', { class: 'sum-line-value', text: money.words(spentThisRound) || '₹0' }),
            ]),
            el('div', { class: 'sum-line' }, [
              el('span', { class: 'sum-line-label', text: 'Left to carry forward' }),
              el('strong', { class: 'sum-line-value', text: money.words(left) || '₹0' }),
            ]),
            grants
              ? el('div', { class: 'sum-line' }, [
                  el('span', { class: 'sum-line-label', text: 'Held in region grants' }),
                  el('strong', { class: 'sum-line-value', text: money.words(grants) }),
                ])
              : null,
          ]),

          el('p', {
            class: 'sheet-text',
            text: 'You will not be able to spend, campaign or change anything ' +
              'else until the next round. Whatever you have not spent stays ' +
              'with you.',
          }),

          el('button', {
            class: 'btn btn-quiet btn-wide',
            type: 'button',
            text: 'Continue playing',
            onclick: function () {
              close();
            },
          }),
          el('button', {
            class: 'btn btn-primary btn-wide',
            type: 'button',
            text: 'End round',
            onclick: function () {
              close();
              endRound();
            },
          }),
        ]),
      ]);

      function close() {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      }
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) close();
      });
      document.body.appendChild(sheet);
    }

    function endRound() {
      // Locally first, so the button responds at once; the server is the
      // authority and its answer overwrites this on the next poll.
      game.roundReady = true;
      paintEndRound();
      paintBody();

      if (game.mode === 'multiplayer') {
        CMP.net.endRound().then(function (res) {
          if (!res.ok && !res.offline) {
            game.roundReady = false;
            setNotice(res.error, 'bad');
          }
          paintEndRound();
        });
        return;
      }

      // Solo: nobody to wait for, so the round settles immediately.
      if (opts.onEndRoundSolo) opts.onEndRoundSolo();
    }

    /*
     * The one line worth saying before the first round.
     *
     * Everybody is on nothing, which is a genuine change from how this used
     * to open, so it is stated once and then got out of the way. Shown for a
     * moment on round one only — a splash that appears every round would be
     * something to dismiss rather than something to read.
     */
    function maybeShowOpening() {
      if (openingShown || !game || game.round !== 1 || game.stage !== 'playing') return;
      openingShown = true;

      var sheet = el('div', { class: 'sheet is-opening' }, [
        el('div', { class: 'sheet-panel op-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('span', { class: 'op-kicker', text: 'Election started' }),
          el('p', {
            class: 'op-line',
            text: (CMP.TOTAL_SEATS || 117) + ' constituencies. Every player begins ' +
              'with 0 seats.',
          }),
          el('p', {
            class: 'op-line is-quiet',
            text: 'No constituency has a leader yet. Build your campaign.',
          }),
          el('strong', { class: 'op-round', text: 'Round 1 of ' + (game.roundsTotal || CMP.ROUNDS.total) }),
          el('button', {
            class: 'btn btn-primary btn-wide',
            type: 'button',
            text: 'Begin',
            onclick: close,
          }),
        ]),
      ]);

      function close() {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      }
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) close();
      });
      document.body.appendChild(sheet);

      // Gone by itself if nobody touches it: this is an announcement, not a
      // question.
      window.setTimeout(close, 4000);
    }

    function paintNotice() {
      mount(noticeNode, notice
        ? [el('p', { class: 'notice notice-' + notice.tone, text: notice.text })]
        : []);
    }

    /** Every screen but home opens with a way back to it. */
    function sectionHead(title, note) {
      return el('header', { class: 'g-section-head' }, [
        el('button', {
          class: 'sd-back',
          type: 'button',
          'aria-label': 'Back to the election',
          text: '‹',
          onclick: function () {
            setSection('home');
          },
        }),
        el('div', { class: 'g-section-titles' }, [
          el('h2', { class: 'g-section-title', text: title }),
          note ? el('p', { class: 'g-section-note', text: note }) : null,
        ]),
      ]);
    }

    /*
     * The four places worth one tap from anywhere.
     *
     * Home, because a player deep in the map should never have to guess their
     * way out; and the three screens a round is actually played from. It sits
     * under the header on every screen but Home, where the menu grid is the
     * same thing said larger.
     */
    /* --------------------------------------------------------- the body */

    function paintBody() {
      if (isCounting()) {
        mount(bodyNode, []);
        return;
      }
      if (openSeat !== null) {
        mount(bodyNode, [seatPanel()]);
        return;
      }

      if (section === 'home') {
        mount(bodyNode, homeSection());
        return;
      }

      // Every other screen is reached from More or from the map, so each one
      // carries its own way back.
      var body;
      if (section === 'candidate') body = [candidateSection()];
      else if (section === 'areas') body = [areasSection()];
      else if (section === 'money') body = moneySection();
      else if (section === 'grants') body = grantsSection();
      else if (section === 'loan') body = loanSection();
      else if (section === 'corruption') body = riskSection('corruption');
      else if (section === 'bribe') body = riskSection('bribe');
      else if (section === 'map') body = [toMyAreas(), mapSection()];
      else if (section === 'seats') body = [seatsSection()];
      else if (section === 'priorities') body = prioritiesSection();
      else if (section === 'allies') body = alliesSection();
      else body = [];

      // The candidate's own screen carries its own portrait, name and back
      // arrow, so it does not want a second header on top.
      var meta = sectionById(section);
      var wantsHead = section !== 'areas' && section !== 'candidate';
      mount(bodyNode, (wantsHead && meta ? [sectionHead(meta.label)] : []).concat(body));
    }

    /**
     * The way through to My Areas.
     *
     * It came off the main grid — eight buttons fit a phone and ten did not —
     * and lives here instead, on the two screens somebody thinking about
     * territory is already looking at.
     */
    function toMyAreas() {
      return el('button', {
        class: 'g-jump',
        type: 'button',
        onclick: function () {
          setSection('priorities');
        },
      }, [
        el('span', { class: 'g-jump-icon', 'aria-hidden': 'true', text: '₹' }),
        el('span', { class: 'g-jump-body' }, [
          el('strong', { class: 'g-jump-label', text: 'Grant' }),
          el('span', {
            class: 'g-jump-note',
            text: 'Regions, what they pay and where to attack',
          }),
        ]),
        el('span', { class: 'g-jump-chev', 'aria-hidden': 'true', text: '›' }),
      ]);
    }

    /* ---------------------------------------------------- campaign home */

    /**
     * Home answers one question: who is winning. No campaign actions live
     * here — tapping a candidate opens their areas, and that is where the
     * spending decisions are made.
     */
    /*
     * Home, which is now mostly the map.
     *
     * It used to be ten buttons and a scoreboard, and the map was one of the
     * ten. That had the game backwards: what a player is doing every round is
     * deciding where to put money, and the place that decision lives is the
     * board. So the board is here, and the rest is two buttons and a menu.
     *
     * Money, grants, loans and the risky screens are all still reachable —
     * under More — but none of them is a thing anybody opens every round.
     */
    function homeSection() {
      var counts = CMP.campaign.heldSeats(game);
      var people = roster();

      /*
       * The board, and who is leading. That is the screen.
       *
       * Under the map there used to be the seat you last touched, the four
       * appearances a cell can have, the majority as a bar, the standings as
       * percentages, and a paragraph about what the shapes do not claim.
       * All true, all of it competing with the one thing somebody looks down
       * for: who is winning.
       *
       * Nothing was deleted. The district panel opens when a district is
       * tapped, and what the map is not claiming is under More.
       */
      return [
        el('div', { class: 'g-strategy' }, [
          strategyButton('loan', '⌾', 'Loan', 'Borrow against what is coming'),
          strategyButton('priorities', '₹', 'Grant', 'Regions and targets'),
          strategyButton('allies', '⚭', 'Alliances', 'Partners'),
        ]),
        mapSection(),
        leaderboardBlock(counts, people),
      ];
    }

    function strategyButton(id, icon, label, note) {
      return el('button', {
        class: 'g-strategy-item',
        type: 'button',
        onclick: function () {
          setSection(id);
        },
      }, [
        el('span', { class: 'g-strategy-icon', 'aria-hidden': 'true', text: icon }),
        el('span', { class: 'g-strategy-body' }, [
          el('strong', { class: 'g-strategy-label', text: label }),
          el('span', { class: 'g-strategy-note', text: note }),
        ]),
      ]);
    }

    /*
     * Where grant money lives, and where it can go.
     *
     * A purse per region, and under each the districts that are paying into
     * it — because a player looking at fifteen crore of Majha money mostly
     * wants to know which districts are keeping it coming and what happens if
     * they lose one.
     */
    function grantsSection() {
      /*
       * A grant is paid for seats won, not seats led.
       *
       * The distinction is the whole screen. Leading nine of nine districts
       * pays nothing and can evaporate in a round; winning nine of nine pays
       * every round to the end of the election and cannot be taken back. So
       * the count under each district is won-of-total, and what is only led
       * is shown as progress toward it rather than as a holding.
       */
      var leaders = CMP.campaign.currentLeaders(game.support);
      var opening = game.openingDistricts || [];
      var wonSeats = game.wonSeats || {};

      function wonIn(d) {
        return d.seats.filter(function (n) {
          return (wonSeats[String(n)] || {}).party === game.partyId;
        }).length;
      }

      var blocks = CMP.REGIONS.map(function (region) {
        var held = [];
        var close = [];

        CMP.districtsInRegion(region.id).forEach(function (d) {
          var mine = wonIn(d);
          var leading = d.seats.filter(function (n) {
            return leaders[n] === game.partyId;
          }).length;
          if (mine === d.seats.length) held.push({ d: d, mine: mine, leading: leading });
          else if (mine || leading >= d.seats.length - 2) {
            close.push({ d: d, mine: mine, leading: leading });
          }
        });

        var paying = held.filter(function (row) {
          return opening.indexOf(row.d.id) === -1;
        });
        var perRound = paying.reduce(function (t, row) {
          return t + row.d.grant;
        }, 0);

        return el('section', { class: 'g-block' }, [
          el('div', { class: 'g-block-head' }, [
            el('h2', { class: 'g-block-title', text: region.name }),
            el('strong', {
              class: 'g-grant-balance',
              text: money.words(CMP.campaign.grantIn(game, region.id)) || '₹0',
            }),
          ]),
          el('p', {
            class: 'g-block-note',
            text: perRound
              ? money.words(perRound) + ' a round from ' + paying.length +
                ' district' + (paying.length === 1 ? '' : 's') + ' you control.'
              : 'No districts here are paying yet.',
          }),

          held.length
            ? el('div', { class: 'g-districts' }, held.map(function (row) {
                var inherited = opening.indexOf(row.d.id) !== -1;
                return el('div', { class: 'g-district is-held' }, [
                  el('span', { class: 'g-district-name' }, [
                    row.d.name,
                    el('span', { class: 'g-district-state', text: 'District controlled ✓' }),
                  ]),
                  el('span', {
                    class: 'g-district-seats',
                    text: row.mine + ' / ' + row.d.seats.length + ' won',
                  }),
                  el('span', {
                    class: 'g-district-grant' + (inherited ? ' is-quiet' : ''),
                    text: inherited
                      ? 'inherited'
                      : money.words(row.d.grant) + ' a round · grant active',
                  }),
                ]);
              }))
            : null,

          close.length
            ? el('div', { class: 'g-districts' }, close.map(function (row) {
                var short = row.d.seats.length - row.mine;
                return el('div', { class: 'g-district' }, [
                  el('span', { class: 'g-district-name' }, [
                    row.d.name,
                    row.leading > row.mine
                      ? el('span', {
                          class: 'g-district-state is-quiet',
                          text: 'leading ' + row.leading + ' · not yet won',
                        })
                      : null,
                  ]),
                  el('span', {
                    class: 'g-district-seats',
                    text: row.mine + ' / ' + row.d.seats.length + ' won',
                  }),
                  el('span', {
                    class: 'g-district-grant is-quiet',
                    text: 'win ' + short + ' more for ' + money.words(row.d.grant),
                  }),
                ]);
              }))
            : null,
        ]);
      });

      return [
        el('p', {
          class: 'g-block-note',
          text: 'Win every seat in a district — won, not led — and it pays you ' +
            'every round for the rest of the election. The money is locked to ' +
            'its own region: Malwa money fights Malwa seats and nothing else.',
        }),
      ].concat(blocks);
    }

    /**
     * The districts this campaign means to fight for.
     *
     * Saved to the server as they are picked, because an ally is shown them
     * and a list that only existed in one browser would be no use to anybody.
     */
    /*
     * MY AREAS: region, then district, then campaign the lot.
     *
     * Built once and reused so the open region and the selection survive a
     * repaint — a screen that folded itself up every time the clock ticked
     * would be unusable.
     */
    function prioritiesSection() {
      grantView.render(game);
      return [grantView.root];
    }

    function alliesSection() {
      return [
        CMP.ui.territory.alliances(game, opts.getServerView && opts.getServerView(), {
          onAlly: function (move, otherId) {
            CMP.net.ally(move, otherId).then(function (res) {
              if (!res.ok && !res.offline) setNotice(res.error, 'bad');
              else setNotice(null);
              paintBody();
            });
          },
        }),
      ];
    }

    function candidateSection() {
      var id = openParty || game.partyId;
      var person = roster().filter(function (p) {
        return p.partyId === id;
      })[0];
      candidateView.render(game, id, person, id === game.partyId);
      return candidateView.root;
    }

    function areasSection() {
      var partyId = openParty || game.partyId;
      var who = roster().filter(function (p) {
        return p.partyId === partyId;
      })[0];
      areasView.render(game, partyId, who, partyId === game.partyId);
      return areasView.root;
    }

    /** WHO'S LEADING — the centrepiece. */
    /*
     * Who is leading, as a scoreboard rather than four cards.
     *
     * A row is a rank, a party, a seat count and a bar as long as that count.
     * The bar is the chart the brief asks for — reading four numbers takes
     * longer than seeing four bars, and it costs no extra height at all.
     *
     * Faces and full candidate names moved to the player's own page, one tap
     * away, which is where somebody who wants them is going anyway.
     */
    function leaderboardBlock(counts, people) {
      var rows = CMP.PLAYABLE_PARTIES.map(function (p) {
        var who = people.filter(function (r) {
          return r.partyId === p.id;
        })[0];
        return {
          party: p,
          seats: counts[p.id] || 0,
          candidate: who ? who.candidateName : null,
          isYou: p.id === game.partyId,
        };
      }).sort(function (a, b) {
        return b.seats - a.seats;
      });

      var most = Math.max(1, rows[0].seats);
      var total = CMP.TOTAL_SEATS || 117;

      /*
       * Nobody is leading yet.
       *
       * Before the first round is settled every campaign is on nothing, and
       * ranking four zeroes one to four would invent a leader out of sort
       * order. So the block says what is actually true and still lists
       * everybody, because tapping through to a rival is how you look them up.
       */
      var anySeats = rows.some(function (row) {
        return row.seats > 0;
      });

      if (!anySeats) {
        /*
         * Nobody is leading yet.
         *
         * Before the first round is settled every campaign is on nothing, and
         * ranking four zeroes one to four would invent a leader out of sort
         * order. So it says so in three words and still lists everybody,
         * because tapping through to a rival is how you look them up.
         */
        return el('section', { class: 'g-block' }, [
          el('h2', { class: 'g-block-title', text: 'Who’s leading?' }),
          el('p', { class: 'lb-none-title', text: 'No leader yet' }),
          el('ol', { class: 'lb is-flat' }, rows.map(function (row) {
            var who = people.filter(function (r) {
              return r.partyId === row.party.id;
            })[0];
            return el('li', {}, [el('button', {
              class: 'lb-row' + (row.isYou ? ' is-you' : ''),
              type: 'button',
              style: { '--party': row.party.colour },
              title: row.candidate || row.party.name,
              onclick: function () {
                openCandidate(row.party.id);
              },
            }, [
              CMP.ui.portrait.render(who && who.avatar, 36, row.candidate || row.party.name),
              el('span', { class: 'lb-party', text: row.party.short }),
              el('strong', { class: 'lb-seats', text: '0' }),
              el('span', { class: 'lb-seats-label', text: 'seats' }),
              el('span', {
                class: 'lb-tag' + (row.isYou ? ' is-leading' : ''),
                text: row.isYou ? 'You' : '',
              }),
            ])]);
          })),
        ]);
      }

      /*
       * A face, a party and a number of seats.
       *
       * The bars, the ranks, the percentage line and the majority line all
       * went: they were four ways of saying the same thing, and the seat
       * count says it. Tapping a row still opens that campaign, which is
       * where the detail lives.
       */
      return el('section', { class: 'g-block' }, [
        el('h2', { class: 'g-block-title', text: 'Who’s leading?' }),
        el('ol', { class: 'lb' }, rows.map(function (row, i) {
          var who = people.filter(function (r) {
            return r.partyId === row.party.id;
          })[0];
          return el('li', {}, [el('button', {
            class: 'lb-row' + (i === 0 ? ' is-leading' : '') + (row.isYou ? ' is-you' : ''),
            type: 'button',
            style: { '--party': row.party.colour },
            title: row.candidate || row.party.name,
            onclick: function () {
              openCandidate(row.party.id);
            },
          }, [
            CMP.ui.portrait.render(who && who.avatar, 36, row.candidate || row.party.name),
            el('span', { class: 'lb-party', text: row.party.short }),
            el('strong', { class: 'lb-seats', text: String(row.seats) }),
            el('span', { class: 'lb-seats-label', text: row.seats === 1 ? 'seat' : 'seats' }),
            el('span', {
              class: 'lb-tag' + (i === 0 ? ' is-leading' : ''),
              text: row.isYou ? 'You' : i === 0 ? 'Leading' : '',
            }),
          ])]);
        })),
      ]);
    }

    /** One line, not a chart. */
    function majorityLine(counts) {
      var top = CMP.PLAYABLE_PARTIES.map(function (p) {
        return { party: p, seats: counts[p.id] || 0 };
      }).sort(function (a, b) {
        return b.seats - a.seats;
      })[0];
      var needed = Math.max(0, CMP.MAJORITY - top.seats);

      /*
       * Nobody is ahead of anybody on nothing.
       *
       * Naming whichever campaign happened to sort first as "0 of 59" reads
       * as a standing, and it is not one — it is four campaigns level before a
       * seat has been decided.
       */
      if (top.seats === 0) {
        return el('div', { class: 'g-majority is-open' }, [
          el('span', { class: 'g-majority-track' }, [
            el('span', { class: 'g-majority-fill', style: { width: '0%' } }),
          ]),
          el('p', { class: 'g-majority-text' }, [
            el('strong', { text: CMP.MAJORITY + ' seats' }),
            ' form a government · ',
            el('span', { text: 'none decided yet' }),
          ]),
        ]);
      }

      return el('div', {
        class: 'g-majority',
        style: { '--party': top.party.colour },
      }, [
        el('span', { class: 'g-majority-track' }, [
          el('span', {
            class: 'g-majority-fill',
            style: { width: Math.min(100, (top.seats / CMP.MAJORITY) * 100) + '%' },
          }),
        ]),
        el('p', { class: 'g-majority-text' }, needed === 0
          ? [
              el('strong', { text: top.party.short + ' ' + top.seats + ' seats' }),
              ' · ',
              el('span', { class: 'is-clear', text: 'past the majority of ' + CMP.MAJORITY }),
            ]
          : [
              el('strong', { text: top.party.short + ' ' + top.seats }),
              ' of ' + CMP.MAJORITY + ' · ',
              el('span', { text: 'needs ' + needed + ' more' }),
            ]),
      ]);
    }

    /* ------------------------------------------------------- action list */

    /**
     * One compact row per action, for the sections that still list them —
     * grants and high risk. Campaigning proper goes through the constituency
     * sheet, where an amount can be chosen alongside the move.
     */
    /**
     * What a risky move might win and what it might cost, in words.
     *
     * Every figure here is read off the same config the engine plays from, so
     * the two can never drift apart. The exact odds are deliberately not
     * shown: a player choosing one of these is meant to be taking a gamble,
     * not reading a payout table.
     */
    function riskDetail(action) {
      var best = 0;
      var worst = 0;
      var heat = 0;
      (action.outcomes || []).forEach(function (o) {
        best = Math.max(best, o.support || 0);
        worst = Math.min(worst, o.support || 0);
        heat = Math.max(heat, o.heat || 0);
      });

      var seats = (action.reach && action.reach.seats) || 1;
      var inv = CMP.CAMPAIGN.investigation;
      var fines = (inv.outcomes || [])
        .map(function (o) {
          return o.fine || 0;
        })
        .filter(function (f) {
          return f > 0;
        });
      var maxFine = fines.length ? Math.max.apply(null, fines) : 0;

      // Heat is what an inquiry is opened on, so how much a move adds is the
      // honest way to describe the risk of one without inventing a number.
      var heatWord = heat >= 34 ? 'Sharply raises' : heat >= 26 ? 'Raises' : 'Slightly raises';

      function line(label, value) {
        return el('div', { class: 'act-line' }, [
          el('span', { class: 'act-line-label', text: label }),
          el('span', { class: 'act-line-value', text: value }),
        ]);
      }

      return el('div', { class: 'act-detail' }, [
        line('Possible reward',
          best > 0
            ? 'Up to +' + best.toFixed(1) + ' support' + (seats > 1 ? ' across ' + seats + ' seats' : '')
            : 'Money, with no support gained'),
        line('If it backfires',
          worst < 0 ? worst.toFixed(1) + ' support' : 'Nothing gained'),
        line('Investigation risk', heatWord + ' political heat'),
        line('Possible fine', maxFine ? 'Up to ' + money.words(maxFine) : 'None'),
      ]);
    }

    function actionList(menu) {
      var actions = CMP.actionsByMenu(menu);
      var explain = menu === 'corruption' || menu === 'bribe';

      return el('div', { class: 'act-list' }, actions.map(function (action) {
        var check = CMP.campaign.canPlay(game, action.id, selected);
        var risky = action.group === 'risky';

        return el('div', {
          class: 'act' + (risky ? ' is-risky' : '') + (check.ok ? '' : ' is-blocked')
            + (explain ? ' has-detail' : ''),
        }, [
          el('span', { class: 'act-icon', 'aria-hidden': 'true', text: action.icon }),
          el('span', { class: 'act-body' }, [
            el('strong', { class: 'act-name', text: action.label }),
            el('span', { class: 'act-meta' }, [
              el('span', {
                class: 'act-cost',
                text: action.cost ? money.words(action.cost) : 'No cost',
              }),
              el('span', { class: 'act-risk' + (risky ? ' is-high' : ''), text: action.riskLabel }),
            ]),
          ]),
          el('button', {
            class: 'act-use' + (risky ? ' is-risky' : ''),
            type: 'button',
            text: 'Use',
            disabled: !check.ok || busy,
            title: check.ok ? action.impactLabel : check.reason,
            onclick: function () {
              runAction(action);
            },
          }),
          explain ? riskDetail(action) : null,
          !check.ok ? el('span', { class: 'act-why', text: check.reason }) : null,
        ]);
      }));
    }

    function actionsSection(menu, title, blurb) {
      return [
        el('section', { class: 'g-block' }, [
          el('div', { class: 'g-block-head' }, [
            el('h2', { class: 'g-block-title', text: title }),
            menu !== 'grants' ? targetChip() : null,
          ]),
          blurb ? el('p', { class: 'g-block-note', text: blurb }) : null,
          actionList(menu),
        ]),
      ];
    }

    /** Which seat these section-level actions would land on. */
    function targetChip() {
      var def = seatDef(selected);
      return el('button', {
        class: 'g-target',
        type: 'button',
        onclick: function () {
          openCandidate(game.partyId);
        },
      }, [
        el('span', { class: 'g-target-label', text: 'Target' }),
        el('span', { class: 'g-target-name', text: def ? def.name : 'Choose' }),
        el('span', { class: 'g-target-chev', 'aria-hidden': 'true', text: '›' }),
      ]);
    }

    /* -------------------------------------------------------------- money */

    /**
     * Everything about the campaign's money in one place: what is left, what
     * has gone, what is owed, what came in from grants and what oversight has
     * taken back — then every transaction behind those figures.
     */
    function moneySection() {
      var debt = CMP.campaign.debtOf(game);
      var level = CMP.campaign.heatLevel(game.heat);
      var ledger = moneyLedger();

      function row(label, value, tone) {
        return el('div', { class: 'sum-line' + (tone ? ' ' + tone : '') }, [
          el('span', { class: 'sum-line-label', text: label }),
          el('strong', { class: 'sum-line-value', text: value }),
        ]);
      }

      return [
        el('section', { class: 'g-block' }, [
          el('div', { class: 'g-money-head' }, [
            el('span', { class: 'g-money-label', text: 'Cash in hand' }),
            el('strong', {
              class: 'g-money-value',
              text: money.words(CMP.campaign.remaining(game)) || '₹0',
            }),
          ]),
          el('div', { class: 'sum-lines' }, [
            row('Spent on the campaign', money.words(game.spent) || '₹0'),
            row('Debt outstanding', debt ? money.words(debt) : '₹0', debt ? 'is-debt' : ''),
            row('Grants received', ledger.grants ? money.words(ledger.grants) : '₹0'),
            row('Fines paid', ledger.fines ? money.words(ledger.fines) : '₹0',
              ledger.fines ? 'is-debt' : ''),
          ]),
        ]),

        el('section', { class: 'g-block' }, [
          el('h2', { class: 'g-block-title', text: 'Political heat' }),
          el('div', { class: 'g-heat-track' }, [
            el('span', {
              class: 'g-heat-fill',
              style: {
                width: (game.heat / CMP.CAMPAIGN.heat.max) * 100 + '%',
                background: level.colour,
              },
            }),
          ]),
          el('p', {
            class: 'g-block-note',
            text: Math.round(game.heat) + ' of ' + CMP.CAMPAIGN.heat.max + ' — ' + level.label +
              '. Heat falls a little every round on its own.',
          }),
        ]),

        actionsSection('grants', 'Apply for funding',
          'Public money for visible work. No heat, and never certain.')[0],

        el('div', { class: 'g-actions-row' }, [
          el('button', {
            class: 'btn btn-primary btn-small',
            type: 'button',
            text: 'Borrow money',
            onclick: function () {
              setSection('loan');
            },
          }),
          el('button', {
            class: 'btn btn-quiet btn-small',
            type: 'button',
            text: 'Where it came from',
            onclick: function () {
              showBreakdown();
            },
          }),
        ]),

        transactionsBlock(ledger.rows),
      ];
    }

    /**
     * Every movement of money this campaign, newest first, read back off the
     * action log and the loan book. Nothing is stored twice — this is the same
     * record the engine writes as it plays.
     */
    function moneyLedger() {
      var rows = [];

      (game.actions || []).forEach(function (a) {
        var seat = a.constituency ? seatDef(a.constituency) : null;

        if (a.cost) {
          rows.push({
            round: a.round,
            turn: a.turn,
            label: a.label,
            note: seat ? seat.name : null,
            amount: -a.cost,
          });
        }
        if (a.funds) {
          rows.push({
            round: a.round,
            turn: a.turn,
            label: a.label,
            note: a.outcomeLabel || 'received',
            amount: a.funds,
          });
        }
      });

      (game.loans || []).forEach(function (loan) {
        rows.push({
          round: loan.takenRound,
          label: 'Loan taken',
          note: 'due round ' + loan.dueRound,
          amount: loan.amount,
        });
        if (loan.settled) {
          rows.push({
            round: loan.dueRound,
            label: loan.defaulted ? 'Loan defaulted' : 'Loan repaid',
            note: money.words(loan.interest) + ' interest',
            amount: -loan.repay,
          });
        }
      });

      // Newest first, and within a round the later move first.
      rows.sort(function (a, b) {
        if ((b.round || 0) !== (a.round || 0)) return (b.round || 0) - (a.round || 0);
        return (b.turn || 0) - (a.turn || 0);
      });

      // These two are running totals the engine already keeps, so the summary
      // and the list can never disagree about a fine nobody logged.
      return { rows: rows, grants: game.granted || 0, fines: game.finesPaid || 0 };
    }

    function transactionsBlock(rows) {
      if (!rows.length) {
        return el('section', { class: 'g-block' }, [
          el('h2', { class: 'g-block-title', text: 'Transactions' }),
          el('p', { class: 'g-block-note', text: 'Nothing has moved yet.' }),
        ]);
      }

      return el('section', { class: 'g-block' }, [
        el('h2', { class: 'g-block-title', text: 'Transactions' }),
        el('div', { class: 'g-txns' }, rows.slice(0, 25).map(function (t) {
          return el('div', { class: 'g-txn' + (t.amount < 0 ? ' is-out' : ' is-in') }, [
            el('span', { class: 'g-txn-round', text: 'R' + (t.round || 1) }),
            el('span', { class: 'g-txn-body' }, [
              el('strong', { class: 'g-txn-label', text: t.label }),
              t.note ? el('span', { class: 'g-txn-note', text: t.note }) : null,
            ]),
            el('strong', {
              class: 'g-txn-amount',
              text: (t.amount < 0 ? '−' : '+') + money.words(Math.abs(t.amount)),
            }),
          ]);
        })),
        rows.length > 25
          ? el('p', { class: 'g-block-note', text: 'Showing the last 25 of ' + rows.length + '.' })
          : null,
      ]);
    }

    function showBreakdown() {
      var sheet = el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { class: 'sheet-title', text: 'Where the money came from' }),
          CMP.ui.bank.breakdown(game),
          el('button', {
            class: 'btn btn-quiet btn-wide',
            type: 'button',
            text: 'Close',
            onclick: function () {
              if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
            },
          }),
        ]),
      ]);
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
      });
      document.body.appendChild(sheet);
    }

    /* --------------------------------------------------------------- loan */

    function loanSection() {
      var cfg = CMP.FINANCE.loan;
      var debt = CMP.campaign.debtOf(game);
      var outstanding = (game.loans || []).filter(function (l) {
        return !l.settled;
      });

      /*
       * What this campaign can actually borrow.
       *
       * The lender works it out from cash in hand, the allowances certain to
       * arrive before the bill falls due, and the grants districts already
       * held are already paying — less what is already owed. Offering amounts
       * above that and refusing them afterwards would be a worse screen than
       * simply not offering them.
       */
      var most = CMP.campaign.maxLoan(game);
      var capacity = CMP.campaign.repaymentCapacity(game);

      var amounts = [cfg.minAmount, most * 0.35, most * 0.7, most]
        .map(function (v) {
          return Math.round(v / cfg.increments) * cfg.increments;
        })
        .filter(function (v, i, all) {
          return v >= cfg.minAmount && v <= most && all.indexOf(v) === i;
        });

      return [
        el('section', { class: 'g-block' }, [
          el('h2', { class: 'g-block-title', text: 'Bank loan' }),

          el('div', { class: 'g-money-head' }, [
            el('span', { class: 'g-money-label', text: 'Available to borrow' }),
            el('strong', { class: 'g-money-value', text: money.words(most) || '₹0' }),
          ]),

          el('div', { class: 'sum-lines' }, [
            el('div', { class: 'sum-line' }, [
              el('span', { class: 'sum-line-label', text: 'Cash in hand' }),
              el('strong', { class: 'sum-line-value', text: money.words(capacity.cash) || '₹0' }),
            ]),
            el('div', { class: 'sum-line' }, [
              el('span', { class: 'sum-line-label', text: 'Allowances before it falls due' }),
              el('strong', { class: 'sum-line-value', text: money.words(capacity.income) || '₹0' }),
            ]),
            capacity.grants
              ? el('div', { class: 'sum-line' }, [
                  el('span', { class: 'sum-line-label', text: 'Grants already being paid' }),
                  el('strong', { class: 'sum-line-value', text: money.words(capacity.grants) }),
                ])
              : null,
            capacity.owed
              ? el('div', { class: 'sum-line is-debt' }, [
                  el('span', { class: 'sum-line-label', text: 'Already owed' }),
                  el('strong', { class: 'sum-line-value', text: '−' + money.words(capacity.owed) }),
                ])
              : null,
          ]),

          el('p', {
            class: 'g-block-note',
            text: most > 0
              ? 'Nothing above ' + money.words(most) + ' is offered — the bank lends ' +
                'against what you can service, not what you would like.'
              : 'Your current repayment capacity is too low for a loan.',
          }),

          el('div', { class: 'sum-lines' }, [
            el('div', { class: 'sum-line' }, [
              el('span', { class: 'sum-line-label', text: 'Interest' }),
              el('strong', { class: 'sum-line-value', text: Math.round(cfg.interestRate * 100) + '%' }),
            ]),
            el('div', { class: 'sum-line' }, [
              el('span', { class: 'sum-line-label', text: 'Repayment' }),
              el('strong', { class: 'sum-line-value', text: cfg.repayAfterRounds + ' rounds later' }),
            ]),
            el('div', { class: 'sum-line' + (debt ? ' is-debt' : '') }, [
              el('span', { class: 'sum-line-label', text: 'Owed now' }),
              el('strong', {
                class: 'sum-line-value',
                text: debt ? money.words(debt) + ' of ' + money.words(cfg.debtLimit) : '₹0',
              }),
            ]),
          ]),

          game.borrowingBlocked
            ? el('p', { class: 'g-blocked', text: 'No bank will lend to you after your default.' })
            : el('div', { class: 'loan-offers' }, amounts.map(function (amount) {
                var offer = CMP.campaign.loanOffer(game, amount);
                return el('button', {
                  class: 'loan-offer' + (offer.ok ? '' : ' is-blocked'),
                  type: 'button',
                  // The exact figure, so nothing reading this screen has to
                  // parse "₹1.65 crore" back into rupees.
                  dataset: { amount: String(amount) },
                  disabled: !offer.ok || busy,
                  onclick: function () {
                    borrow(amount);
                  },
                }, [
                  el('strong', { class: 'loan-amount', text: money.words(amount) }),
                  el('span', {
                    class: 'loan-terms',
                    text: offer.ok
                      ? 'repay ' + money.words(offer.repay) + ' · round ' + offer.dueRound
                      : offer.error,
                  }),
                ]);
              })),

          outstanding.length
            ? el('div', { class: 'loan-open' }, [
                el('h3', { class: 'g-sub-title', text: 'Outstanding' }),
                el('div', { class: 'sum-lines' }, outstanding.map(function (l) {
                  var due = l.dueRound - (game.round || 1);
                  return el('div', { class: 'sum-line' + (due <= 0 ? ' is-debt' : '') }, [
                    el('span', {
                      class: 'sum-line-label',
                      text: due <= 0 ? 'due this round' : 'due round ' + l.dueRound,
                    }),
                    el('strong', { class: 'sum-line-value', text: money.words(l.repay) }),
                  ]);
                })),
              ])
            : null,
        ]),
      ];
    }

    function borrow(amount) {
      if (busy) return;
      var offer = CMP.campaign.loanOffer(game, amount);
      if (!offer.ok) {
        setNotice(offer.error);
        return;
      }

      CMP.ui.dialog
        .confirm({
          eyebrow: 'Bank loan',
          title: 'Borrow ' + money.words(offer.amount) + '?',
          lines: [
            { label: 'You receive', value: money.words(offer.amount) },
            { label: 'Interest at ' + Math.round(offer.interestRate * 100) + '%', value: money.words(offer.interest) },
            { label: 'You repay', value: money.words(offer.repay), strong: true },
            { label: 'Due end of', value: 'Round ' + offer.dueRound },
          ],
          note: 'Miss it and you default: heat, lost support, a campaign ' +
            'restriction, and no further credit.',
          confirmLabel: 'Borrow',
        })
        .then(function (yes) {
          if (!yes) return;
          busy = true;
          paintBody();
          Promise.resolve(opts.borrow(amount)).then(
            function (res) {
              busy = false;
              if (res && res.ok === false) setNotice(res.reason || res.error);
              render(res && res.game ? res.game : game);
            },
            function () {
              busy = false;
              setNotice('Could not reach the game server.');
              render(game);
            }
          );
        });
    }

    /* --------------------------------------------------- corruption, bribe */

    var RISK_BLURB = {
      corruption: 'Bigger swings, uncertain results, and heat. Every one of these ' +
        'can backfire, and the odds are never shown.',
      bribe: 'The riskiest moves in the game. Worse than campaigning on average, ' +
        'and the heat lands whichever way the roll goes.',
    };

    function riskSection(menu) {
      var blocks = [
        el('section', { class: 'g-block' }, [
          el('div', { class: 'g-block-head' }, [
            el('h2', { class: 'g-block-title is-risky', text: 'Every move here carries risk' }),
            targetChip(),
          ]),
          el('p', { class: 'g-block-note', text: RISK_BLURB[menu] }),
          actionList(menu),
        ]),
      ];

      // Reporting a rival belongs with the risky play it exists to police.
      if (game.mode === 'multiplayer') {
        if (!oversight) oversight = CMP.ui.oversight.create({});
        oversight.update(opts.getServerView && opts.getServerView());
        blocks.push(el('section', { class: 'g-block' }, [
          el('h2', { class: 'g-block-title', text: 'Rivals' }),
          oversight.root,
        ]));
      }
      return blocks;
    }

    /* --------------------------------------------------------------- map */

    /**
     * The map is the second route to a constituency. Tapping a seat opens it,
     * and CAMPAIGN HERE works exactly as it does from the areas list.
     */
    /*
     * The map, which is where a round is played.
     *
     * Tapping a seat opens the campaign panel over the top of it rather than
     * navigating anywhere: pick a seat, put money in, come back to the map.
     * That loop is the game, and every screen transition in the middle of it
     * was a screen transition in the middle of it.
     */
    function mapSection() {
      if (!mapView) {
        mapView = CMP.ui.map.create({
          onSelect: function (num) {
            campaignHere(num);
          },
        });
      }
      mapView.render(game, selected);
      return el('section', { class: 'g-block g-block-flush' }, [mapView.root]);
    }

    /* ------------------------------------------------------ constituencies */

    function seatsSection() {
      seatBrowser.render(game, roster());
      return el('section', { class: 'g-block' }, [seatBrowser.root]);
    }

    /**
     * One constituency. Its job is to say what is happening here, and offer
     * exactly one thing to do about it — the campaign controls open over the
     * top rather than unrolling underneath.
     */
    function seatPanel() {
      var canCampaign = !isCounting() && CMP.campaign.roundIsLive(game);

      return CMP.ui.constituency.render(game, openSeat, {
        players: roster(),
        history: historyFor(openSeat),
        onBack: function () {
          openSeat = null;
          paintBody();
          toTop();
        },
        footer: canCampaign
          ? el('button', {
              class: 'btn btn-primary btn-wide btn-campaign',
              type: 'button',
              text: 'Campaign here',
              onclick: function () {
                campaignHere(openSeat);
              },
            })
          : el('p', { class: 'g-block-note', text: 'The round is closed. Wait for the next one.' }),
      });
    }

    /**
     * Pick a move and an amount, play it, show what it did, and offer the
     * next seat. The player never gets sent back out to a dashboard to do it
     * again — that round trip was the whole problem with the old flow.
     */
    function campaignHere(seat, districtId) {
      selected = Number(seat);

      CMP.ui.campaignSheet
        .open(game, seat, {
          district: districtId || CMP.campaign.areaOf(seat),
          /*
           * The board follows the panel.
           *
           * Switching the target to a district frames the district; picking a
           * seat inside it frames the seat. The map stays behind the sheet
           * throughout, so the answer to "where is this" is always visible
           * rather than something to go and look up.
           */
          onFocus: function (kind, id) {
            if (!mapView) return;
            if (kind === 'seat') {
              mapView.select(id);
              mapView.focusSeat(id);
            } else {
              mapView.highlightDistrict(id);
              mapView.focusDistrict(id);
            }
          },
          play: function (actionId, target, amount) {
            return Promise.resolve(opts.play(actionId, target, amount));
          },
          playBulk: function (actionId, seats, total) {
            return Promise.resolve(allocate(actionId, seats, total)).then(function (res) {
              return res && res.ok
                ? { ok: true, report: res.reports && res.reports[0], game: game }
                : { ok: false, reason: (res && res.reason) || 'That could not be played.' };
            });
          },
          onNotice: setNotice,
        })
        .then(function (played) {
          if (!played) return;

          notice = null;
          lastReport = played.report;
          game = played.game || game;

          var next = CMP.ui.areas.nextClosest(game, game.partyId, seat);
          render(game);

          return CMP.ui.campaignSheet.result(game, seat, played.report, played.before, {
            nextSeat: next,
            onNext: function (number) {
              openSeatDetail(number);
              campaignHere(number);
            },
            onAreas: function () {
              openSeat = null;
              openCandidate(game.partyId);
            },
          });
        });
    }

    /* --------------------------------------------------------------- log */

    function logBlock() {
      var recent = (game.actions || []).slice(-5).reverse();
      if (!recent.length) return null;

      return el('section', { class: 'g-block' }, [
        el('h2', { class: 'g-block-title', text: 'Recent moves' }),
        el('div', { class: 'log' }, recent.map(function (a) {
          var def = a.constituency ? seatDef(a.constituency) : null;
          return el('div', { class: 'log-row log-' + a.group }, [
            el('span', { class: 'log-round', text: a.round ? 'R' + a.round : '' }),
            el('span', { class: 'log-action', text: a.label }),
            el('span', { class: 'log-where', text: def ? def.name : '—' }),
            el('span', {
              class: 'log-result ' + (a.support > 0 ? 'up' : a.support < 0 ? 'down' : ''),
              text: a.support ? (a.support > 0 ? '+' : '') + a.support.toFixed(1) + '%' : '—',
            }),
          ]);
        })),
      ]);
    }

    /* ------------------------------------------------------------ playing */

    /**
     * Everything that spends money is confirmed first: the cost, what it
     * leaves behind, and for a risky move that the result is not knowable.
     * Never the odds themselves.
     */
    function runAction(action) {
      if (busy) return;
      var check = CMP.campaign.canPlay(game, action.id, selected);
      if (!check.ok) {
        setNotice(check.reason);
        return;
      }

      var cash = CMP.campaign.remaining(game);
      var def = action.needsConstituency ? seatDef(selected) : null;
      var risky = action.group === 'risky';

      CMP.ui.dialog
        .confirm({
          eyebrow: def ? def.name + ' · AC ' + def.number : 'Campaign-wide',
          title: action.label + '?',
          lines: [
            { label: 'Cost', value: money.words(action.cost) || '₹0' },
            { label: 'Cash after', value: money.words(Math.max(0, cash - action.cost)) || '₹0', strong: true },
            { label: 'Risk', value: action.riskLabel },
            { label: 'Effect', value: action.impactLabel },
          ],
          note: risky ? 'The result is not certain, and this will raise your political heat.' : null,
          danger: risky,
          confirmLabel: 'Go ahead',
        })
        .then(function (yes) {
          if (yes) send(action);
        });
    }

    function send(action) {
      busy = true;
      paintBody();

      Promise.resolve(opts.play(action.id, selected)).then(
        function (res) {
          busy = false;
          if (!res || !res.ok) {
            setNotice((res && res.reason) || 'That action could not be played.');
            paintBody();
            return;
          }
          notice = null;
          lastReport = res.report;
          render(res.game || game);
          showReport();
        },
        function () {
          busy = false;
          setNotice('Could not reach the game server.');
          paintBody();
        }
      );
    }

    /**
     * What just happened, as a short sheet. It replaced a permanent panel on
     * the main screen: an outcome matters for a moment and then it is history,
     * and the campaign log below keeps the record.
     */
    function showReport() {
      if (!lastReport) return;
      var r = lastReport;
      var good = r.support > 0 || r.opponentSupport < 0 || r.funds > 0;
      var def = r.constituency ? seatDef(r.constituency) : null;

      var sheet = el('div', { class: 'sheet' }, [
        el('div', {
          class: 'sheet-panel report-sheet ' + (good ? 'is-good' : 'is-bad'),
          role: 'status',
        }, [
          el('span', { class: 'report-where', text: def ? def.name : 'Campaign-wide' }),
          el('h2', { class: 'sheet-title', text: r.outcomeLabel }),
          el('p', { class: 'report-text', text: r.text }),
          el('div', { class: 'report-deltas' }, [
            r.support
              ? el('span', {
                  class: 'delta ' + (r.support > 0 ? 'up' : 'down'),
                  text: (r.support > 0 ? '+' : '') + r.support.toFixed(1) + '%',
                })
              : null,
            r.funds ? el('span', { class: 'delta up', text: money.words(r.funds) + ' in' }) : null,
            r.heatAfter > r.heatBefore
              ? el('span', {
                  class: 'delta heat',
                  text: '+' + Math.round(r.heatAfter - r.heatBefore) + ' heat',
                })
              : null,
            r.reach && r.reach.length
              ? el('span', { class: 'delta', text: 'felt in ' + r.reach.length + ' more' })
              : null,
          ]),
          r.consequence
            ? el('p', { class: 'report-consequence' }, [
                el('strong', { text: r.consequence.label + '. ' }),
                r.consequence.text,
              ])
            : null,
          el('button', {
            class: 'btn btn-primary btn-wide',
            type: 'button',
            text: 'Continue',
            onclick: function () {
              if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
            },
          }),
        ]),
      ]);
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet && sheet.parentNode) sheet.parentNode.removeChild(sheet);
      });
      document.body.appendChild(sheet);
    }

    /* ------------------------------------------------------------ public */

    function render(next, secondsFromServer) {
      game = next;
      if (selected === null || !game.support[selected]) selected = pickDefaultSeat();

      if (game.round !== lastRound) {
        lastRound = game.round;
        seatHistory = {};
        // A new round is a new set of results to sit through.
        resultsShown = false;
      }

      paintHead();
      roundView.render(game, secondsFromServer);
      mount(roundNode, [roundView.root]);
      paintPlayer();

      // While the round is being counted the menu is not offered at all —
      // paintBody clears the body, and the results panel has the screen.
      var counting = isCounting() && !resultsShown;
      resultsNode.style.display = counting ? '' : 'none';

      if (counting) {
        resultsView.render(game.lastResult, game.intermissionLeft);
        mount(bodyNode, []);
        return;
      }

      paintNotice();
      paintBody();
      paintEndRound();
      maybeShowOpening();
    }

    return {
      root: root,
      render: render,
      showSummary: function (summary) {
        var card = CMP.ui.round.summary(game, summary);
        mount(summaryNode, card ? [card] : []);
      },
      stop: function () {
        roundView.stop();
      },
      setReport: function (report) {
        lastReport = report;
      },
    };
  }

  return { create: create };
})();
