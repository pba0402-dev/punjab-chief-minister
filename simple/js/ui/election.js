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

/*
 * The four systems a campaign is run from, always in reach.
 *
 * Home, Grant, Alliances and Loan were three buttons above the board that
 * scrolled away with it, and everything else was behind More. They are a bar
 * under the title now: wherever you are, the other three are one tap, and the
 * one you are on says so.
 *
 * The list lives out here rather than inside create() because three things
 * ask what the four tabs are: which one to open on, which one to write down,
 * and which one is lit.
 */
  var NAV = [
    { id: 'home', label: 'Home', glyph: '◈' },
    { id: 'priorities', label: 'Grant', glyph: '₹' },
    { id: 'allies', label: 'Alliances', glyph: '⚭' },
    { id: 'loan', label: 'Loan', glyph: '◑' },
  ];

  /** True when this section is one of the four, rather than a screen below them. */
  function onTheBar(id) {
    for (var i = 0; i < NAV.length; i++) {
      if (NAV[i].id === id) return true;
    }
    return false;
  }

  /**
   * Which tab the current view belongs to.
   *
   * The four are destinations; everything else - a candidate, their seats,
   * the money ledger, all 117 - is somewhere you got to from the board, so
   * Home stays lit while you are down there. Exactly one is always on.
   */
  function navFor(current) {
    return onTheBar(current) ? current : 'home';
  }

/*
 * Which tab a reload comes back to.
 *
 * A refresh used to land on Home wherever you were, which reads as the game
 * having lost your place — worst on a phone, where a reload is often not
 * something you chose. So the tab is written down when you move and read back
 * when the screen is built.
 *
 * Only the four tabs on the bar are restored. The rest — the risky screens,
 * a rival's areas, a seat panel — are places you go for one thing and leave,
 * and a reload that reopened somebody's bribe screen would be answering a
 * question nobody asked. Anything else, or anything unrecognised, is Home.
 */
  function openingSection() {
    var saved = CMP.storage && CMP.storage.recall
      ? CMP.storage.recall('section')
      : null;
    return onTheBar(saved) ? saved : 'home';
  }

  function rememberSection(next) {
    if (!CMP.storage || !CMP.storage.remember) return;
    CMP.storage.remember('section', onTheBar(next) ? next : 'home');
  }

  function create(opts) {
    var game = null;
    var selected = null;      // the seat a campaign action would target
    var openSeat = null;      // the seat whose panel is open over the board
    var fullSeat = null;      // the seat whose full screen replaced the body
    var openParty = null;     // the candidate whose areas are open
    var section = openingSection();
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
    var navNode = el('nav', { class: 'g-nav', 'aria-label': 'Game sections' });

    /*
     * The seat panel opens over the board, not instead of it.
     *
     * Whether to spend in a seat is a question about its surroundings - who
     * holds the district, what is next to it, how far the region's money
     * stretches - and a panel that replaced the map made the player carry all
     * of that in their head. It sits outside .g-inner so it can be pinned to
     * the bottom of a phone without inheriting the page's own padding.
     */
    var panelNode = el('div', { class: 'g-panel-layer' });

    var root = el('section', { class: 'screen screen-election screen-game' }, [
      el('div', { class: 'g-inner' }, [
        headNode,
        navNode,
        roundNode,
        noticeNode,
        resultsNode,
        bodyNode,
      ]),
      panelNode,
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
      if (CMP.audio) CMP.audio.play('tap');
      section = next;
      openSeat = null;
      fullSeat = null;
      paintPanel();
      rememberSection(next);
      if (next === 'areas' && !openParty) openParty = game.partyId;
      if (next !== 'areas') openParty = null;
      // The bar has to follow the view. Every route into a section comes
      // through here, so this is the one place that has to remember.
      paintNav();
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
      paintNav();
      paintBody();
      toTop();
    }

    function openCandidateSeats(partyId) {
      openParty = partyId;
      openSeat = null;
      section = 'areas';
      paintNav();
      paintBody();
      toTop();
    }

    /**
     * The seat panel, made once and pointed at whichever seat is open.
     *
     * One panel rather than one per seat, because tapping around the map
     * should feel like reading a board rather than opening and closing
     * windows - and because the spend control inside it holds state that
     * ought to reset when the seat changes and not when it repaints.
     */
    var districtView = CMP.ui.district.create({
      players: function () {
        return roster();
      },
      canSpend: function () {
        return !isCounting() && CMP.campaign.roundIsLive(game);
      },
      /*
       * Spending goes through the game's own play(), so the entry cap, the
       * region purse, the won-seat lock and - in a game with other people in
       * it - the server's authority all still apply. The panel asks; it never
       * decides.
       */
      play: function (seat, amount) {
        return Promise.resolve(opts.play('invest', Number(seat), amount))
          .then(function (res) {
            if (res && res.ok) {
              notice = null;
              lastReport = res.report || lastReport;
              game = res.game || game;
              render(game);
            }
            return res;
          });
      },
      onFull: function (seat) {
        fullSeat = Number(seat);
        closeSeatPanel();
        paintBody();
        toTop();
      },
      onClose: function () {
        closeSeatPanel();
      },
    });

    function closeSeatPanel() {
      openSeat = null;
      if (mapView) mapView.select(null);
      paintPanel();
    }

    /**
     * Open a seat.
     *
     * The board stays where it is and the panel opens over it; tapping a
     * different seat points the same panel somewhere else rather than closing
     * one thing and opening another.
     */
    function openSeatDetail(number) {
      openSeat = Number(number);
      selected = Number(number);
      fullSeat = null;
      if (mapView) mapView.select(openSeat);
      paintPanel();
      // The board only needs repainting for the selection ring; the panel is
      // its own layer and does not disturb the section underneath.
      if (!mapView) paintBody();
    }

    function paintPanel() {
      if (openSeat === null) {
        mount(panelNode, []);
        panelNode.classList.remove('is-open');
        return;
      }
      districtView.show(game, openSeat);
      mount(panelNode, [
        /*
         * The scrim is what makes the panel a panel rather than a card that
         * happens to be on top. It is light because the page is paper: a dark
         * scrim over ivory reads as the lights going out.
         */
        el('div', {
          class: 'g-panel-scrim',
          onclick: function () {
            closeSeatPanel();
          },
        }),
        districtView.root,
      ]);
      panelNode.classList.add('is-open');
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

    /*
     * Tell the round strip how tall the bar is.
     *
     * Both are sticky and both want the top of the screen, so the strip is
     * offset by whatever the bar actually measures rather than by a number
     * written down here — the labels wrap at narrow widths and a guess would
     * be wrong on exactly the phones that can least afford the overlap.
     */
    function measureNav() {
      if (!navNode || !navNode.offsetHeight || !root.style) return;
      root.style.setProperty('--nav-h', navNode.offsetHeight + 'px');
    }

    function paintNav() {
      var here = navFor(section);
      mount(navNode, NAV.map(function (item) {
        var on = here === item.id;
        return el('button', {
          class: 'g-nav-item' + (on ? ' is-on' : ''),
          type: 'button',
          'aria-current': on ? 'page' : null,
          onclick: function () {
            setSection(item.id);
          },
        }, [
          el('span', { class: 'g-nav-glyph', 'aria-hidden': 'true', text: item.glyph }),
          el('span', { class: 'g-nav-label', text: item.label }),
        ]);
      }));
      measureNav();
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
     * A volume, as a slider that writes straight through.
     *
     * Its own control rather than a step on the switch: turning music down is
     * a different thing from turning it off, and a game that only offers the
     * second forces the choice.
     */
    function volumeRow(key, label) {
      var value = CMP.settings.get(key);
      var out = el('span', {
        class: 'sheet-item-state',
        text: Math.round(value * 100) + '%',
      });

      var slider = el('input', {
        class: 'sheet-range',
        type: 'range',
        min: '0',
        max: '100',
        step: '5',
        value: String(Math.round(value * 100)),
        'aria-label': label,
        oninput: function (e) {
          var next = Number(e.target.value) / 100;
          CMP.settings.set(key, next);
          out.textContent = Math.round(next * 100) + '%';
        },
      });

      return el('div', { class: 'sheet-item is-volume' }, [
        el('span', { class: 'sheet-item-body' }, [
          el('span', { class: 'sheet-item-note', text: label }),
          slider,
        ]),
        out,
      ]);
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

    /**
     * A row in the menu that goes somewhere.
     *
     * One shape for all of them, so the menu reads as four choices rather
     * than as a pile of controls. The chevron is what distinguishes a row
     * that opens something from a switch that changes something.
     */
    function menuRow(glyph, title, note, onclick, cls) {
      return el('button', {
        class: 'sheet-item is-row' + (cls ? ' ' + cls : ''),
        type: 'button',
        onclick: onclick,
      }, [
        el('span', { class: 'sheet-item-glyph', 'aria-hidden': 'true', text: glyph }),
        el('span', { class: 'sheet-item-body' }, [
          el('strong', { class: 'sheet-item-title', text: title }),
          el('span', { class: 'sheet-item-note', text: note }),
        ]),
        el('span', { class: 'sheet-item-chev', 'aria-hidden': 'true', text: '›' }),
      ]);
    }

    /*
     * Sub-sheets open on top of the menu, so leaving one for a dialog has to
     * take both down. Anything appended to the body with class .sheet is one
     * of ours, and none of them survives a decision.
     */
    function shutMenuChain() {
      var open = document.querySelectorAll('body > .sheet');
      for (var i = 0; i < open.length; i++) {
        if (open[i].parentNode) open[i].parentNode.removeChild(open[i]);
      }
    }

    /** A sheet with a title, a body and a Close. The shape all of these share. */
    function subSheet(title, rows) {
      var sheet = el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { class: 'sheet-title', text: title }),
        ].concat(rows).concat([
          el('button', {
            class: 'btn btn-quiet btn-wide',
            type: 'button',
            text: 'Close',
            onclick: function () { shut(); },
          }),
        ])),
      ]);
      function shut() {
        if (sheet.parentNode) sheet.parentNode.removeChild(sheet);
      }
      sheet.addEventListener('click', function (e) {
        if (e.target === sheet) shut();
      });
      document.body.appendChild(sheet);
      return shut;
    }

    /**
     * Sound and music.
     *
     * The switches remember what the player asked for whether or not anything
     * is playing yet - see js/settings.js, which says so rather than offering
     * a switch that quietly does nothing.
     */
    function openSoundSheet() {
      subSheet('Sound & Music', [
        el('div', { class: 'sheet-group' }, [
          settingRow('music', '♪', 'Music', 'Background music'),
          volumeRow('musicVolume', 'Music volume'),
          settingRow('sound', '▶', 'Sound effects', 'Taps, results and alerts'),
          volumeRow('soundVolume', 'Sound volume'),
          CMP.audio && !CMP.audio.ready()
            ? el('p', {
                class: 'sheet-note',
                text: 'No audio files are installed yet, so these remember ' +
                  'what you asked for and nothing plays.',
              })
            : null,
        ]),
      ]);
    }

    /**
     * Game settings.
     *
     * What is genuinely a setting, and nothing that is a move. The host's
     * control over when the count begins lives here too: it changes how the
     * game runs rather than what happens on the board.
     */
    function openSettingsSheet() {
      var view = opts.getServerView && opts.getServerView();
      var isHost = !!(view && view.youAreHost);
      var left = (game.roundsTotal || CMP.ROUNDS.total) - (game.round || 1);

      subSheet('Game Settings', [
        el('div', { class: 'sheet-group' }, [
          menuRow('◱', 'About the map',
            'What the shapes do and do not claim',
            function () {
              shutMenuChain();
              showAboutSheet();
            }),
          isHost
            ? menuRow('▣',
                left > 0 ? 'Close the polls now' : 'Begin the count',
                left > 0
                  ? 'End the campaign early and count the votes'
                  : 'Every round is done; read the result',
                function () {
                  shutMenuChain();
                  confirmDeclare(left);
                },
                'is-danger')
            : null,
          game.mode === 'multiplayer'
            ? menuRow('✕', 'End this game',
                'Finish here for good. Nobody will be able to rejoin.',
                function () {
                  shutMenuChain();
                  confirmEndGame();
                },
                'is-danger')
            : null,
        ]),
      ]);
    }

    /** Everything that is not part of a round: sound, settings, help, leaving. */
    function openMenu() {
      var sheet = el('div', { class: 'sheet' }, [
        el('div', { class: 'sheet-panel', role: 'dialog', 'aria-modal': 'true' }, [
          el('h2', { class: 'sheet-title', text: 'Menu' }),

          /*
           * Four rows, and none of them is a move.
           *
           * Money, Grants, Corruption, Bribe, all 117 constituencies and the
           * election history were in this menu once. They are gone from it on
           * purpose: it is the place you go while a round is running, and a
           * list of eleven destinations is not that. What is left is the four
           * things that are about the sitting rather than about the game -
           * how it sounds, how it runs, how it works, and how to leave.
           *
           * The audio controls used to be inline here, which meant the menu
           * opened on four sliders. They are one row now, like the rest.
           */
          el('div', { class: 'sheet-group' }, [
            menuRow('♪', 'Sound & Music',
              'Music, effects and their volumes', function () {
                shutMenuChain();
                openSoundSheet();
              }),
            menuRow('⚙', 'Game Settings',
              'How this election runs', function () {
                shutMenuChain();
                openSettingsSheet();
              }),
            menuRow('ℹ', 'Help / Tutorial',
              'The Election Briefing, in ten short chapters', function () {
                shutMenuChain();
                if (opts.onBriefing) opts.onBriefing();
              }),
          ]),

          /*
           * Leaving, kept apart from the four and worded so nobody has to
           * guess what it does. Stepping away and finishing for good are
           * different acts, and they are not next to each other.
           */
          menuRow('⏻', 'Exit game',
            game.mode === 'multiplayer'
              ? 'The election carries on. You can rejoin from the home screen.'
              : 'Your progress is saved. Pick it up from the home screen.',
            function () {
              shutMenuChain();
              confirmExit();
            },
            'is-exit'),

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
        if (e.target === sheet && sheet.parentNode) {
          sheet.parentNode.removeChild(sheet);
        }
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

      /*
       * The figures are the way into what is behind them.
       *
       * Money came off the menu, and a ledger nothing opens is a ledger
       * nobody reads — so the figure that summarises it opens it, which is
       * how the grant purse beside it has always worked.
       */
      mount(roundView.aside, [
        figure('Available', money.words(cash) || '₹0', 'is-lead', function () {
          setSection('money');
        }),
        figure('Grant', money.words(grants) || '₹0', grants ? 'is-grant' : null,
          grants ? function () { setSection('grants'); } : null),
        figure('Spent', money.words(game.roundSpent || 0) || '₹0', null, function () {
          setSection('money');
        }),
        debt ? figure('Owed', money.words(debt), 'is-debt', function () {
          setSection('loan');
        }) : null,
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
        mount(roundView.action, []);
        return;
      }

      if (game.roundReady) {
        var view = opts.getServerView && opts.getServerView();
        var waiting = view && typeof view.readyOf === 'number'
          ? Math.max(0, view.readyOf - (view.readyCount || 0))
          : 0;

        mount(roundView.action, [
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
       * Opposite the round it ends, on the same line.
       *
       * It used to be a full-width two-line button at the foot of the screen,
       * under everything else — which meant scrolling past the whole board to
       * finish a turn, and a large target for something that cannot be undone
       * within the round. It asks before it acts, so it does not need to be
       * hard to reach as well.
       */
      mount(roundView.action, [
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
    /*
     * A back arrow is only worth its space where it is the way out.
     *
     * Grant, Alliances and Loan are on the bar at the bottom of every screen,
     * so a second control that also goes Home is a duplicate — and worse, it
     * suggests those screens are somewhere you descended into rather than one
     * of four places you switch between. The screens reached from More or
     * from the map keep theirs, because for those it is the only way back.
     */
    function sectionHead(title, note) {
      var onBar = onTheBar(section);
      return el('header', {
        class: 'g-section-head' + (onBar ? ' is-flush' : ''),
      }, [
        onBar ? null : el('button', {
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
      /*
       * The full seat screen - history, ratings, the changed-hands note - is
       * still a screen of its own, reached from the panel. The panel itself
       * does not come through here at all: it is a layer over whatever this
       * paints.
       */
      if (fullSeat !== null) {
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
      // Loan, Grant and Alliances were three buttons here and are the
      // navigation bar now, which is on every screen rather than only this one.
      return [
        mapSection(),
        leaderboardBlock(counts, people),
      ];
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

    /**
     * The other players: who you work with, and who you watch.
     *
     * Reporting a rival used to live on the corruption screen, with the risky
     * play it exists to police. That screen has gone — corruption is a mode on
     * the campaign panel now — and rivals belong here anyway: an alliance and
     * an investigation are the two things one campaign does about another.
     */
    function alliesSection() {
      var blocks = [
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
    /*
     * What the board is framing, so the standing underneath can agree with it.
     *
     * The map is the one that knows, so it says; this only remembers what it
     * last said. All Punjab until somebody chooses otherwise.
     */
    var mapScope = { level: 'all', region: null, district: null };

    /** Seats a party leads or holds, inside whatever is being looked at. */
    function seatsInScope(partyId) {
      var seats = seatNumbersInScope();
      var won = game.wonSeats || {};
      var n = 0;
      for (var i = 0; i < seats.length; i++) {
        var num = seats[i];
        var w = won[String(num)];
        if (w) {
          if (w.party === partyId) n += 1;
          continue;
        }
        var lead = CMP.ui.constituency.leaderOf(game.support[num] || {});
        if (lead && lead.partyId === partyId) n += 1;
      }
      return n;
    }

    function seatNumbersInScope() {
      if (mapScope.level === 'district' && mapScope.district) {
        var d = CMP.getDistrict ? CMP.getDistrict(mapScope.district) : null;
        return (d && d.seats) || [];
      }
      if (mapScope.level === 'zone' && mapScope.region) {
        return (CMP.CONSTITUENCIES || []).filter(function (c) {
          return CMP.regionOfSeat(c.number) === mapScope.region;
        }).map(function (c) {
          return c.number;
        });
      }
      return (CMP.CONSTITUENCIES || []).map(function (c) {
        return c.number;
      });
    }

    /** What this part of the board is called, for the heading. */
    function scopeName() {
      if (mapScope.level === 'district' && mapScope.district) {
        var d = CMP.getDistrict ? CMP.getDistrict(mapScope.district) : null;
        return d ? d.name : null;
      }
      if (mapScope.level === 'zone' && mapScope.region) {
        var r = CMP.getRegion ? CMP.getRegion(mapScope.region) : null;
        return r ? r.name : null;
      }
      return null;
    }

    /**
     * What a campaign has left to spend, right now.
     *
     * Your own is always known. An opponent's is known when this client is
     * running them — playing alone, they are local objects — and not when a
     * server is, because what a rival has left is theirs. Null means "not
     * ours to show", and the row prints a dash rather than a figure.
     *
     * This is the live balance and nothing else: not what they started with,
     * not what they have spent, not what the districts have paid them. It
     * comes off the same field the ledger and the round strip read, so
     * spending a rupee moves all three together.
     */
    function moneyOf(partyId) {
      if (partyId === game.partyId) return CMP.campaign.heldTotal(game);
      var others = game.opponents || [];
      for (var i = 0; i < others.length; i++) {
        if (others[i].partyId === partyId) {
          return CMP.campaign.heldTotal(withBoardOf(others[i]));
        }
      }
      return null;
    }

    /*
     * An opponent carries its own purse but not the board, and heldTotal
     * wants both — general cash plus whatever the region grants hold.
     */
    function withBoardOf(actor) {
      var view = {};
      Object.keys(actor).forEach(function (k) {
        view[k] = actor[k];
      });
      view.support = game.support;
      view.wonSeats = game.wonSeats;
      return view;
    }

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
              // Nobody leads anything yet, but everybody already has money —
              // and before round one that is the only thing to compare.
              el('span', {
                class: 'lb-money' + (moneyOf(row.party.id) === null ? ' is-hidden' : ''),
                text: moneyOf(row.party.id) === null
                  ? '—'
                  : (money.words(moneyOf(row.party.id)) || '₹0'),
              }),
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
      /*
       * Scoped to whatever the map is framing.
       *
       * Choosing a district and then reading an all-Punjab standing under it
       * is two screens disagreeing about what the player is looking at.
       */
      var where = scopeName();
      var scoped = mapScope.level !== 'all';
      var shown = scoped
        ? CMP.PLAYABLE_PARTIES.map(function (p) {
            return {
              party: p,
              seats: seatsInScope(p.id),
              candidate: (people.filter(function (r) {
                return r.partyId === p.id;
              })[0] || {}).candidateName || null,
              isYou: p.id === game.partyId,
            };
          }).sort(function (a, b) {
            return b.seats - a.seats;
          })
        : rows;

      var anyHidden = false;

      return el('section', { class: 'g-block' }, [
        el('h2', { class: 'g-block-title' }, [
          'Who’s leading',
          where ? el('span', { class: 'lb-where', text: where }) : null,
        ]),
        el('ol', { class: 'lb' }, shown.map(function (row, i) {
          var who = people.filter(function (r) {
            return r.partyId === row.party.id;
          })[0];
          var purse = moneyOf(row.party.id);
          if (purse === null) anyHidden = true;

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
            /*
             * What they have left, small and secondary — it is the answer to
             * "can they come after me here", which is a different question
             * from "who is winning" and a quieter one.
             */
            el('span', {
              class: 'lb-money' + (purse === null ? ' is-hidden' : ''),
              text: purse === null ? '—' : (money.words(purse) || '₹0'),
            }),
            el('span', {
              class: 'lb-tag' + (i === 0 ? ' is-leading' : ''),
              text: row.isYou ? 'You' : i === 0 ? 'Leading' : '',
            }),
          ])]);
        })),
        anyHidden
          ? el('p', {
              class: 'lb-note',
              text: 'What the other campaigns have left is their own.',
            })
          : null,
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

        /*
         * The campaign so far, as seats rather than rupees.
         *
         * It was a sheet under More, which is now four settings and nothing
         * else. This screen is already the record of what has happened —
         * every movement of money since round one — so the other record of
         * the same campaign belongs beside it rather than nowhere.
         */
        (game.seatTrend || []).length > 1
          ? el('section', { class: 'g-block' }, [
              el('h2', { class: 'g-block-title', text: 'Seats, round by round' }),
              CMP.ui.scoreboard.historyChart(game.seatTrend || []),
            ])
          : null,
      ].filter(Boolean);
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

    /**
     * The loan that is running, in place of the ones that are not on offer.
     *
     * Everything the bargain was: what was borrowed, what was taken as
     * interest, what actually arrived, what falls due and when.
     */
    function activeLoanPanel(loan) {
      var due = loan.dueRound - (game.round || 1);
      var received = loan.amount - loan.interest;

      return el('div', { class: 'loan-active' }, [
        el('span', { class: 'loan-active-tag', text: 'Active loan' }),
        el('strong', { class: 'loan-active-amount', text: money.words(loan.amount) }),

        el('div', { class: 'sum-lines' }, [
          line2('Received', money.words(received)),
          line2('Interest', money.words(loan.interest)),
          line2('Total repayment', money.words(loan.repay), true),
          line2('Due', 'Round ' + loan.dueRound +
            (due > 0 ? ' · in ' + due + (due === 1 ? ' round' : ' rounds') : ' · now')),
        ]),

        el('p', {
          class: 'g-block-note',
          text: 'It is repaid automatically when the round arrives. If the ' +
            'campaign is short, the balance goes below zero and later income ' +
            'pays it down.',
        }),
      ]);
    }

    function line2(label, value, strong) {
      return el('div', { class: 'sum-line' + (strong ? ' is-strong' : '') }, [
        el('span', { class: 'sum-line-label', text: label }),
        el('strong', { class: 'sum-line-value', text: value }),
      ]);
    }

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
              el('span', {
                class: 'sum-line-label',
                text: 'Interest, taken when the loan is made',
              }),
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

          /*
           * One loan at a time.
           *
           * While one is running there is nothing to choose, so the offers
           * come off and the active loan takes their place. Showing four
           * amounts that would all be refused is a worse screen than showing
           * none.
           */
          game.borrowingBlocked
            ? el('p', { class: 'g-blocked', text: 'No bank will lend to you after your default.' })
            : outstanding.length
              ? activeLoanPanel(outstanding[0])
              : CMP.campaign.balanceOf(game) < 0
                ? el('p', { class: 'g-blocked' }, [
                    el('strong', { class: 'loan-locked-title', text: 'Loan locked' }),
                    el('span', {
                      class: 'loan-locked-note',
                      text: 'Clear your outstanding debt before borrowing again. ' +
                        'Your balance is ' + money.words(CMP.campaign.balanceOf(game)) + '.',
                    }),
                  ])
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
                  offer.ok
                    ? el('span', { class: 'loan-terms' }, [
                        el('span', {
                          class: 'loan-line',
                          text: 'Receive ' + money.words(offer.received),
                        }),
                        el('span', {
                          class: 'loan-line',
                          text: 'Repay ' + money.words(offer.repay),
                        }),
                        el('span', {
                          class: 'loan-line is-quiet',
                          text: 'Due round ' + offer.dueRound,
                        }),
                      ])
                    : el('span', { class: 'loan-terms is-blocked', text: offer.error }),
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
          /*
           * A tap on the board opens the seat, and nothing else.
           *
           * It used to go straight into the campaign sheet, which answered
           * "how much" before the player had been told who was in the seat or
           * what it would leave them. The panel is that missing step; the
           * spend is one button inside it.
           */
          onSelect: function (num) {
            openSeatDetail(num);
          },
          /*
           * The standing under the board follows the board.
           *
           * Choosing a district and then reading an all-Punjab standing under
           * it is two screens disagreeing about what is being looked at.
           */
          onScope: function (next) {
            mapScope = next;
            paintBody();
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

      return CMP.ui.constituency.render(game, fullSeat, {
        players: roster(),
        history: historyFor(fullSeat),
        onBack: function () {
          fullSeat = null;
          paintBody();
          toTop();
        },
        footer: canCampaign
          ? el('button', {
              class: 'btn btn-primary btn-wide btn-campaign',
              type: 'button',
              text: 'Campaign here',
              onclick: function () {
                campaignHere(fullSeat);
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
          // So the standings can show a face rather than an abbreviation.
          players: roster(),
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
      paintNav();
      // The panel is a layer over the board, so a board that moved - a rival
      // spending, a round settling - has to reach it too.
      if (openSeat !== null) districtView.update(game);
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
