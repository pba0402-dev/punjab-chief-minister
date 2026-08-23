/**
 * The opening screen.
 * ------------------------------------------------------------------
 * Five things and nothing else: what the game is, who you are, the way in,
 * what you left unfinished, and two places to go. Everything that used to be
 * spread down this page — the counters, the leaderboard, party performance,
 * your recent elections — is a screen of its own now, because none of it is
 * something you come here to read. You come here to play.
 *
 * That matters most on a phone in portrait, where the old page put four
 * blocks of statistics between the title and the button somebody came for.
 *
 * The hierarchy is deliberately steep. One gold card, at a size nothing else
 * on the page comes near; a quieter card under it for playing alone; then the
 * two reference screens, set as a plain list. A player who has never seen the
 * game should not have to read anything to know what to press.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.home = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var SVG = 'http://www.w3.org/2000/svg';

  /*
   * The small line drawings on the cards.
   *
   * Line art at one weight, so they read as part of the typography rather
   * than as a set of icons dropped on top of it — and only on the cards where
   * the words alone do not immediately say what kind of thing this is.
   */
  var ICONS = {
    // A ballot paper, marked. The act the whole game is about.
    play: ['M6 3h12v18H6z', 'M9.2 12.4l2.1 2.1 4.1-4.6'],
    // One figure, alone at the lectern.
    solo: ['M12 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M6 21v-2a6 6 0 0 1 12 0v2'],
    // Carry on, in the direction you were already going.
    resume: ['M5 12h14', 'M12 5l7 7-7 7'],
    // Columns.
    stats: ['M5 20V11', 'M12 20V4', 'M19 20v-6', 'M3 20h18'],
    // A card with a face on it.
    profile: ['M3 5h18v14H3z', 'M8.5 11.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
      'M6 16c.6-1.6 1.5-2.4 2.5-2.4s1.9.8 2.5 2.4', 'M14 10h4', 'M14 14h4'],
  };

  function icon(name) {
    var svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', 'h-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    (ICONS[name] || []).forEach(function (d) {
      var p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  function render(opts) {
    var saved = CMP.storage.load();
    var me = CMP.profile.get();
    var resumeNode = el('div', { class: 'h-resume' });

    /** One of the three facts under the title. */
    function fact(value, label) {
      return el('div', { class: 'h-fact' }, [
        el('strong', { class: 'h-fact-value', text: value }),
        el('span', { class: 'h-fact-label', text: label }),
      ]);
    }

    /**
     * A card you press to go somewhere.
     *
     * One shape for all of them, so the page reads as a short list of choices
     * rather than as a collection of differently-sized boxes. What varies
     * between them is weight, never shape.
     */
    function card(label, sub, onclick, cls, glyph) {
      return el('button', {
        class: 'h-card' + (cls ? ' ' + cls : ''),
        type: 'button',
        onclick: onclick,
      }, [
        glyph ? el('span', { class: 'h-card-icon' }, [icon(glyph)]) : null,
        el('span', { class: 'h-card-body' }, [
          el('span', { class: 'h-card-label', text: label }),
          el('span', { class: 'h-card-sub', text: sub }),
        ]),
        el('span', { class: 'h-card-chev', 'aria-hidden': 'true', text: '›' }),
      ]);
    }

    var root = el('section', { class: 'screen screen-home' }, [
      el('div', { class: 'h-inner' }, [
        /* ---- what this is ---- */
        el('header', { class: 'h-hero' }, [
          /*
           * A rule, a mark, a rule.
           *
           * Official paper announces itself before it says anything, and this
           * is the honest cheap version of that: three empty elements, and
           * the title reads as a masthead rather than as the first line of a
           * page.
           */
          el('p', { class: 'h-crest', 'aria-hidden': 'true' }, [
            el('span', { class: 'h-crest-rule' }),
            el('span', { class: 'h-crest-mark', text: '✦' }),
            el('span', { class: 'h-crest-rule' }),
          ]),
          el('h1', { class: 'h-title', text: 'Election Time' }),
          el('p', { class: 'h-sub', text: 'Punjab Assembly' }),

          // The three facts that define the game, as figures rather than a
          // sentence. Somebody deciding whether to play needs the shape of
          // it, not a paragraph about it.
          el('div', { class: 'h-facts' }, [
            fact('117', 'Seats'),
            fact(String(CMP.MAJORITY || 59), 'Majority'),
            fact(String(CMP.ROUNDS.total), 'Rounds'),
          ]),

          me
            ? el('p', { class: 'h-welcome' }, ['Welcome back, ', el('strong', { text: me.name })])
            : null,
        ]),

        /*
         * The way in, which is one button.
         *
         * Creating an election and joining one were two cards of their own,
         * which made them look like two games. They are the same game from
         * either end, so the choice between them belongs one step in — where
         * it is a question about what you are doing rather than a fork in the
         * road before you have decided anything.
         */
        el('div', { class: 'h-play' }, [
          card(
            'Play / Join Election',
            'Create an election or join one with friends',
            opts.onMultiplayer,
            'is-primary',
            'play'
          ),
          card(
            'Election Time',
            'Play on your own against three opponents',
            opts.onSolo,
            'is-solo',
            'solo'
          ),
        ]),

        /* ---- anything already in progress ---- */
        resumeNode,

        /*
         * And the two places to go.
         *
         * The leaderboard was a third card here and is not any more: it is a
         * table of other people's results, which is the last thing the way
         * into a game should be competing with. It is still there, on the
         * statistics screen, beside the rest of the public figures.
         */
        el('nav', { class: 'h-nav' }, [
          el('p', { class: 'h-nav-title', text: 'Also here' }),
          card('Game Statistics', 'Elections played, and who is winning',
            opts.onStats, 'is-quiet', 'stats'),
          card('My Profile', 'Your record, your face and your name',
            opts.onProfile, 'is-quiet', 'profile'),
        ]),

        /*
         * The three pages a store review and a privacy request both need to
         * be able to find. Small, at the foot, and always there.
         */
        el('footer', { class: 'h-foot' }, [
          el('a', { class: 'h-foot-link', href: 'privacy.html', text: 'Privacy' }),
          el('a', { class: 'h-foot-link', href: 'terms.html', text: 'Terms' }),
          el('a', { class: 'h-foot-link', href: 'support.html', text: 'Support' }),
        ]),
      ]),
    ]);

    /**
     * What is waiting to be picked up.
     *
     * Closing a tab is not quitting. A multiplayer game somebody stepped away
     * from is still theirs, so it is offered back by code — and asked of the
     * server rather than read out of this browser, because the whole point is
     * that it survives a browser that forgot.
     *
     * A game the player deliberately ended is never offered. That is what
     * ending means, and an "end game" that kept suggesting itself afterwards
     * would be no different from leaving. Nothing at all is shown when there
     * is nothing to continue — an empty Continue card is a promise the game
     * cannot keep.
     */
    function paintResume(openGames) {
      var rows = [];

      (openGames || []).forEach(function (entry) {
        var where = entry.round > 0
          ? 'Round ' + entry.round + ' of ' + (entry.roundsTotal || CMP.ROUNDS.total)
          : 'Waiting in the lobby';
        rows.push(card('Continue Election', where + ' · game ' + entry.code,
          function () {
            CMP.net.adopt(entry);
            if (opts.onRejoin) opts.onRejoin();
          }, 'is-continue', 'resume'));
      });

      if (saved && CMP.state.isValid(saved)) {
        rows.push(card('Continue Election',
          'Round ' + (saved.round || 1) + ' of ' +
            (saved.roundsTotal || CMP.ROUNDS.total),
          opts.onContinueSolo, 'is-continue', 'resume'));
      }

      mount(resumeNode, rows);
    }

    // Show whatever this browser already knows about immediately, then ask
    // the server for anything it has forgotten.
    var session = CMP.net.getSession();
    paintResume(session ? [{ code: session.code, round: 0, roundsTotal: 0,
      playerId: session.playerId, token: session.token }] : []);

    if (me) {
      CMP.net.resumable(me.id).then(function (res) {
        if (res && res.ok) paintResume(res.games);
      });
    }

    return root;
  }

  return { render: render };
})();
