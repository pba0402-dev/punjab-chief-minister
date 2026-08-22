/**
 * The opening screen.
 * ------------------------------------------------------------------
 * Six things and nothing else: what the game is, who you are, the way in, what
 * you left unfinished, and three places to go. Everything that used to be
 * spread down this page — the counters, the leaderboard, party performance,
 * your recent elections — is a screen of its own now, because none of it is
 * something you come here to read. You come here to play.
 *
 * That matters most on a phone in portrait, where the old page put four blocks
 * of statistics between the title and the button somebody actually came for.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.home = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

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
     * rather than as a collection of differently-sized boxes.
     */
    function card(label, sub, onclick, cls) {
      return el('button', {
        class: 'h-card' + (cls ? ' ' + cls : ''),
        type: 'button',
        onclick: onclick,
      }, [
        el('span', { class: 'h-card-label', text: label }),
        el('span', { class: 'h-card-sub', text: sub }),
      ]);
    }

    var root = el('section', { class: 'screen screen-home' }, [
      el('div', { class: 'h-inner' }, [
        /* ---- what this is ---- */
        el('header', { class: 'h-hero' }, [
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
            'is-primary'
          ),
          card(
            'Election Time',
            'Play on your own against three opponents',
            opts.onSolo,
            'is-solo'
          ),
        ]),

        /* ---- anything already in progress ---- */
        resumeNode,

        /* ---- and the three places to go ---- */
        el('nav', { class: 'h-nav' }, [
          card('Game Statistics', 'Election activity and game statistics',
            opts.onStats, 'is-quiet'),
          card('Leaderboard', 'Who is winning, across every election',
            opts.onLeaderboard, 'is-quiet'),
          card('My Profile', 'Your record, your face and your name',
            opts.onProfile, 'is-quiet'),
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
        rows.push(el('button', {
          class: 'h-card is-continue',
          type: 'button',
          onclick: function () {
            CMP.net.adopt(entry);
            if (opts.onRejoin) opts.onRejoin();
          },
        }, [
          el('span', { class: 'h-card-label', text: 'Continue Election' }),
          el('span', { class: 'h-card-sub', text: where + ' · game ' + entry.code }),
        ]));
      });

      if (saved && CMP.state.isValid(saved)) {
        rows.push(el('button', {
          class: 'h-card is-continue',
          type: 'button',
          onclick: opts.onContinueSolo,
        }, [
          el('span', { class: 'h-card-label', text: 'Continue Election' }),
          el('span', {
            class: 'h-card-sub',
            text: 'Round ' + (saved.round || 1) + ' of ' +
              (saved.roundsTotal || CMP.ROUNDS.total),
          }),
        ]));
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
