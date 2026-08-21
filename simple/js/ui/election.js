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
  var SECTIONS = [
    { id: 'areas', label: 'Campaign', hint: 'Your seats', icon: '◆' },
    { id: 'money', label: 'Money', hint: 'Cash and debt', icon: '₹' },
    { id: 'grants', label: 'Grants', hint: 'Apply for funds', icon: '◈' },
    { id: 'loan', label: 'Loan', hint: 'Borrow at 20%', icon: '◇' },
    { id: 'corruption', label: 'Corruption', hint: 'High risk', icon: '▲', risky: true },
    { id: 'bribe', label: 'Bribe', hint: 'Highest risk', icon: '▲', risky: true },
    { id: 'map', label: 'Map', hint: 'All of Punjab', icon: '◉' },
    { id: 'seats', label: 'Constituencies', hint: 'All 117', icon: '☰' },
  ];

  function sectionById(id) {
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].id === id) return SECTIONS[i];
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

    /* ------------------------------------------------------ structure */

    var headNode = el('header', { class: 'g-head' });
    var roundNode = el('div', { class: 'g-round' });
    var playerNode = el('div', { class: 'g-player' });
    var noticeNode = el('div', { class: 'g-notice' });
    var bodyNode = el('div', { class: 'g-body' });
    var resultsNode = el('div', { class: 'g-results' });
    var summaryNode = el('div', { class: 'summary-slot' });

    var roundView = CMP.ui.round.create({});
    var resultsView = CMP.ui.scoreboard.create({
      you: function () {
        return game ? game.partyId : null;
      },
      trend: function () {
        return (game && game.seatTrend) || [];
      },
    });
    mount(resultsNode, [resultsView.root]);

    // All 117, searchable — the way to reach a seat by name rather than by
    // whose it is. Built once and reused, so the search box keeps its text.
    var seatBrowser = CMP.ui.seats.browser({
      onOpen: function (number) {
        openSeatDetail(number);
      },
    });

    var areasView = CMP.ui.areas.create({
      onOpen: function (number) {
        openSeatDetail(number);
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
        playerNode,
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
              portraitSeed: p.portraitSeed,
              isAI: p.isAI,
              isYou: p.isYou,
            };
          });
      }

      // Solo: the player plus their opponents.
      var mine = [{
        partyId: game.partyId,
        candidateName: game.candidateName,
        portraitSeed: game.portraitSeed,
        isYou: true,
      }];
      return mine.concat((game.opponents || []).map(function (o) {
        return {
          partyId: o.partyId,
          candidateName: o.candidateName,
          portraitSeed: o.portraitSeed,
          isAI: true,
        };
      }));
    }

    function mySeed() {
      var mine = roster().filter(function (p) {
        return p.partyId === game.partyId;
      })[0];
      return mine ? mine.portraitSeed : game.portraitSeed;
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
    function openCandidate(partyId) {
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

    function paintHead() {
      mount(headNode, [
        el('div', { class: 'g-head-title' }, [
          el('h1', { class: 'g-title', text: 'Chief Minister of Punjab' }),
          el('p', {
            class: 'g-subtitle',
            text: CMP.TOTAL_SEATS + ' seats · majority ' + CMP.MAJORITY,
          }),
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

    /** Everything that is not part of a round: history, closing, leaving. */
    function openMenu() {
      var view = opts.getServerView && opts.getServerView();
      var isHost = !!(view && view.youAreHost);
      var left = (game.roundsTotal || CMP.ROUNDS.total) - (game.round || 1);

      var sheet = el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { class: 'sheet-title', text: 'Menu' }),

          el('button', {
            class: 'sheet-item',
            type: 'button',
            text: 'Election history',
            onclick: function () {
              close();
              showHistorySheet();
            },
          }),

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

          el('button', {
            class: 'sheet-item',
            type: 'button',
            text: 'Back to main menu',
            onclick: function () {
              close();
              if (opts.onMenu) opts.onMenu();
            },
          }),

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

    function paintPlayer() {
      var party = CMP.getParty(game.partyId);
      var cash = CMP.campaign.remaining(game);
      var debt = CMP.campaign.debtOf(game);
      var seed = mySeed();

      mount(playerNode, [
        seed
          ? CMP.ui.portrait.render(seed, 40, game.candidateName)
          : el('span', { class: 'g-player-flag', text: party.short }),
        el('div', { class: 'g-player-who' }, [
          el('strong', { class: 'g-player-name', text: game.candidateName }),
          el('span', {
            class: 'g-player-party',
            style: { color: party.colour },
            text: party.short,
          }),
        ]),
        el('div', { class: 'g-player-figures' }, [
          el('span', { class: 'g-player-cash', text: money.words(cash) || '₹0' }),
          el('span', {
            class: 'g-player-seats',
            text: game.seatsWon + (game.seatsWon === 1 ? ' seat' : ' seats'),
          }),
        ]),
        debt
          ? el('span', { class: 'g-player-debt', title: 'Owed to the bank', text: money.words(debt) })
          : null,
      ]);
      playerNode.style.setProperty('--party', party.colour);
    }

    /* -------------------------------------------------------------- nav */

    /** The two-column menu. Lives on the home screen, not above every screen. */
    function menuGrid() {
      return el('nav', { class: 'g-menu', 'aria-label': 'Menu' }, SECTIONS.map(function (s) {
        return el('button', {
          class: 'g-menu-item' + (s.risky ? ' is-risky' : ''),
          type: 'button',
          onclick: function () {
            setSection(s.id);
          },
        }, [
          el('span', { class: 'g-menu-icon', 'aria-hidden': 'true', text: s.icon }),
          el('span', { class: 'g-menu-label', text: s.label }),
          el('span', { class: 'g-menu-hint', text: s.hint }),
        ]);
      }));
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

    function paintNotice() {
      mount(noticeNode, notice
        ? [el('p', { class: 'notice notice-' + notice.tone, text: notice.text })]
        : []);
    }

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

      // Every other screen is a destination reached from the menu, so each
      // one carries its own way back.
      var body;
      if (section === 'areas') body = [areasSection()];
      else if (section === 'money') body = moneySection();
      else if (section === 'grants') {
        body = actionsSection('grants', 'Grants',
          'Fund visible work and apply for support. No heat, and the money is never certain.');
      } else if (section === 'loan') body = loanSection();
      else if (section === 'corruption') body = riskSection('corruption');
      else if (section === 'bribe') body = riskSection('bribe');
      else if (section === 'map') body = [mapSection()];
      else if (section === 'seats') body = [seatsSection()];
      else body = [];

      // The candidate's own screen carries its own portrait, name and back
      // arrow, so it does not want a second header on top. Everything else
      // does — including the map, which is otherwise a screen with no way
      // off it.
      var meta = sectionById(section);
      var wantsHead = section !== 'areas';
      mount(bodyNode, (wantsHead && meta ? [sectionHead(meta.label)] : []).concat(body));
    }

    /* ---------------------------------------------------- campaign home */

    /**
     * Home answers one question: who is winning. No campaign actions live
     * here — tapping a candidate opens their areas, and that is where the
     * spending decisions are made.
     */
    function homeSection() {
      var counts = CMP.campaign.seatCounts(game.support);
      var people = roster();

      return [
        menuGrid(),
        leaderboardBlock(counts, people),
        majorityLine(counts),
        el('section', { class: 'g-block' }, [
          el('h2', { class: 'g-block-title', text: 'Leading from' }),
          CMP.ui.seats.leadingFrom(game, people, {
            onOpen: openSeatDetail,
            onViewAll: function () {
              openCandidate(game.partyId);
            },
          }),
        ]),
      ];
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
    function leaderboardBlock(counts, people) {
      var rows = CMP.PLAYABLE_PARTIES.map(function (p) {
        var who = people.filter(function (r) {
          return r.partyId === p.id;
        })[0];
        return {
          party: p,
          seats: counts[p.id] || 0,
          candidate: who ? who.candidateName : null,
          seed: who ? who.portraitSeed : null,
          isYou: p.id === game.partyId,
        };
      }).sort(function (a, b) {
        return b.seats - a.seats;
      });

      var PLACE = ['1st', '2nd', '3rd', '4th'];

      return el('section', { class: 'g-block' }, [
        el('h2', { class: 'g-block-title', text: 'Who’s leading?' }),
        el('ol', { class: 'lb' }, rows.map(function (row, i) {
          return el('li', {}, [el('button', {
            class: 'lb-row' + (i === 0 ? ' is-leading' : '') + (row.isYou ? ' is-you' : ''),
            type: 'button',
            style: { '--party': row.party.colour, '--party-ink': row.party.ink || '#fff' },
            onclick: function () {
              openCandidate(row.party.id);
            },
          }, [
            el('span', { class: 'lb-rank', text: String(i + 1) }),
            row.seed
              ? CMP.ui.portrait.render(row.seed, 32, row.candidate)
              : el('span', { class: 'lb-flag', text: row.party.short }),
            el('span', { class: 'lb-who' }, [
              el('strong', { class: 'lb-name', text: row.candidate || row.party.name }),
              el('span', { class: 'lb-party' }, [
                row.party.short,
                // With four faces on screen, finding your own should take no
                // effort at all.
                row.isYou ? el('span', { class: 'board-tag is-you', text: 'you' }) : null,
              ]),
            ]),
            el('span', { class: 'lb-seats', text: String(row.seats) }),
            el('span', {
              class: 'lb-status' + (i === 0 ? ' is-leading' : ''),
              text: i === 0 ? 'Leading' : PLACE[i],
            }),
            el('span', { class: 'lb-chev', 'aria-hidden': 'true', text: '›' }),
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
        var risky = action.group === 'risky' || action.id === 'underground';

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

      // A few steps rather than every increment. Ten near-identical buttons is
      // a list to read, not a decision to make.
      var amounts = [cfg.minAmount, cfg.maxAmount * 0.3, cfg.maxAmount * 0.5, cfg.maxAmount]
        .map(function (v) {
          return Math.round(v / cfg.increments) * cfg.increments;
        })
        .filter(function (v, i, all) {
          return v >= cfg.minAmount && v <= cfg.maxAmount && all.indexOf(v) === i;
        });

      return [
        el('section', { class: 'g-block' }, [
          el('h2', { class: 'g-block-title', text: 'Bank loan' }),
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
    function mapSection() {
      if (!mapView) {
        mapView = CMP.ui.map.create({
          onSelect: function (num) {
            openSeatDetail(num);
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
    function campaignHere(seat) {
      selected = Number(seat);

      CMP.ui.campaignSheet
        .open(game, seat, {
          play: function (actionId, target, amount) {
            return Promise.resolve(opts.play(actionId, target, amount));
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
      var risky = action.group === 'risky' || action.id === 'underground';

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
      }

      paintHead();
      roundView.render(game, secondsFromServer);
      mount(roundNode, [roundView.root]);
      paintPlayer();

      // While the round is being counted the menu is not offered at all —
      // paintBody clears the body, and the results panel has the screen.
      var counting = isCounting();
      resultsNode.style.display = counting ? '' : 'none';

      if (counting) {
        resultsView.render(game.lastResult, game.intermissionLeft);
        mount(bodyNode, []);
        return;
      }

      paintNotice();
      paintBody();
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
