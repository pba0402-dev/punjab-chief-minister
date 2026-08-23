/**
 * The Election Briefing.
 * ------------------------------------------------------------------
 * Ten short chapters on how the game works, and a handful of tips.
 *
 * Every number in here is read out of CMP.CAMPAIGN at render time rather than
 * written into the prose. That is the whole design of this file: a tutorial
 * that quotes figures it does not read is a tutorial that goes quietly wrong
 * the first time somebody tunes the grant table, and a wrong tutorial is
 * worse than none. If a rule changes, this changes with it.
 *
 * What it deliberately does not do: explain how any of this would work
 * outside the game. Two of the campaign modes have names borrowed from things
 * that are crimes in the real world. Here they are numbers on a board with
 * consequences attached, and that is the only way they are described.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.briefing = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

  /** ₹ in crore, the unit the rest of the game speaks in. */
  function crore(rupees) {
    var cr = (rupees || 0) / 10000000;
    var shown = cr >= 10 || cr === Math.round(cr)
      ? String(Math.round(cr))
      : String(Math.round(cr * 100) / 100);
    return '₹' + shown + ' crore';
  }

  /**
   * The chapters.
   *
   * Built on each render so the figures are current. Each is a title, a lede
   * that answers the question in one line, and a few points — because this is
   * read on a phone by somebody who wants to start playing.
   */
  function chapters() {
    var C = CMP.CAMPAIGN || {};
    var rounds = C.rounds || {};
    var loan = ((C.finance || {}).loan) || {};
    var spend = C.spending || {};
    var income = (C.income || {}).perRound || 0;
    var grant = ((C.territory || {}).grant) || {};
    var total = CMP.TOTAL_SEATS || 117;
    var majority = CMP.MAJORITY || 59;

    return [
      {
        title: 'What you are doing',
        lede: 'Winning more of the ' + total + ' Punjab Assembly seats than ' +
          'anyone else, in ' + (rounds.total || 20) + ' rounds.',
        points: [
          majority + ' seats is a majority — half of ' + total + ', plus one.',
          'Short of that you can still govern, but only with somebody else. ' +
            'That is what Alliances are for.',
          'Every party, candidate, share and result in this game is invented ' +
            'by the game and its players. Only the constituency names, ' +
            'numbers and districts are real.',
        ],
      },
      {
        title: 'The board',
        lede: 'The map is the game. Everything else is a way of deciding ' +
          'where to press on it.',
        points: [
          'Each shape is one constituency. Its colour is whoever leads there ' +
            'right now — nothing on the map is a prediction.',
          'Seats group into districts, and districts into the three regions: ' +
            'Malwa, Majha and Doaba.',
          'Pale means nobody has taken a lead there yet. Those are the ' +
            'cheapest places to start.',
        ],
      },
      {
        title: 'Campaigning',
        lede: 'Tap a seat, choose what to put into it, and confirm.',
        points: [
          'More money buys more support, but not in a straight line: the ' +
            'second crore in a seat does less than the first.',
          'The first time anyone campaigns in a seat they may spend at most ' +
            crore(spend.entryMaximum) + '. That cap is on everybody equally, ' +
            'so nobody buys their way in ahead of the field.',
          'Once you have a presence there the cap is gone and you can spend ' +
            'what you like.',
        ],
      },
      {
        title: 'Taking a seat outright',
        lede: 'Get far enough ahead in a seat and it is settled for good.',
        points: [
          'A settled seat is marked with a tick and cannot be campaigned in ' +
            'again — by anyone, including you.',
          'It is the only thing on this board that cannot be undone.',
          'That makes it worth doing where it is cheap, and worth ignoring ' +
            'where it is not.',
        ],
      },
      {
        title: 'Districts and grants',
        lede: 'Lead every seat in a district and the district pays you, ' +
          'every round.',
        points: [
          'Grants run from about ' + crore(grant.min) + ' to ' +
            crore(grant.max) + ' a round, depending on the district.',
          'The money is locked to the region that earned it. A Majha grant ' +
            'is spent in Majha.',
          'So where you fight decides what you can afford next, which is the ' +
            'decision this whole game turns on.',
        ],
      },
      {
        title: 'Money',
        lede: 'Three figures, at the top of every screen.',
        points: [
          'Available is what you can spend anywhere.',
          'Grant is what you have earned from districts, spendable only in ' +
            'the region it came from.',
          'Spent is what has gone this round. Income of ' + crore(income) +
            ' arrives at the start of each round on top of it.',
        ],
      },
      {
        title: 'Borrowing',
        lede: 'The bank will lend, and it takes its cut immediately.',
        points: [
          'Interest is ' + Math.round((loan.interestRate || 0.2) * 100) +
            '%, deducted the moment the loan is made — borrow ' +
            crore(loan.minAmount) + ' and less than that arrives.',
          'It falls due ' + (loan.repayAfterRounds || 4) + ' rounds later, ' +
            'and it is taken automatically whether you have it or not. Your ' +
            'balance can go negative.',
          'One loan at a time, and none at all after round ' +
            (loan.noBorrowingAfterRound || 16) + '.',
        ],
      },
      {
        title: 'Alliances',
        lede: 'Two campaigns that cannot win alone can govern together.',
        points: [
          'An alliance is offered, and has to be accepted. Nobody is ' +
            'allied without agreeing to it.',
          'Offers close after round ' + (rounds.allianceDeadline || 10) +
            ' — a partnership struck on election night is not a partnership.',
          'Allied seats count together for forming a government, and only ' +
            'for that. The seats stay whoever won them.',
        ],
      },
      {
        title: 'Election night',
        lede: 'Read out region by region, district by district, then the ' +
          'overall standing.',
        points: [
          'Malwa first, then Majha, then Doaba — the order the results ' +
            'come in.',
          'Each district card shows who took it and by how much.',
          'There is a Skip on every screen. It is there because the second ' +
            'time you watch it you already know.',
        ],
      },
      {
        title: 'Actually winning',
        lede: 'Three things separate a good campaign from a busy one.',
        points: [
          'Take districts, not seats. A district pays every round for the ' +
            'rest of the game; a seat pays nothing.',
          'Finish what you start. Leading eleven seats in a twelve-seat ' +
            'district earns exactly nothing.',
          'Watch what the grant is locked to. Money you cannot spend where ' +
            'the fight is has not helped you.',
        ],
      },
    ];
  }

  /** Short, and none of them repeats a chapter. */
  var TIPS = [
    'A pale seat is cheaper than a contested one. Early on, that is most of the map.',
    'The district border thickens when you lead every seat inside it. That is the moment it starts paying.',
    'Spending twice in one seat in one round is usually worse than spending once in two.',
    'If a rival is one seat from a district, that seat is worth more to you than its size suggests.',
    'Borrow for something specific. Interest is charged whether the money worked or not.',
    'The round strip is the whole state of your campaign. If it says nothing is spent, nothing is happening.',
  ];

  function render(opts) {
    var list = chapters();
    var open = 0;
    var body = el('div', { class: 'br-chapters' });

    function paint() {
      mount(body, list.map(function (ch, i) {
        var on = i === open;
        return el('section', { class: 'br-chapter' + (on ? ' is-open' : '') }, [
          el('button', {
            class: 'br-chapter-head',
            type: 'button',
            'aria-expanded': on ? 'true' : 'false',
            onclick: function () {
              open = on ? -1 : i;
              if (CMP.audio) CMP.audio.play('tap');
              paint();
            },
          }, [
            el('span', { class: 'br-chapter-no', text: String(i + 1) }),
            el('span', { class: 'br-chapter-titles' }, [
              el('strong', { class: 'br-chapter-title', text: ch.title }),
              el('span', { class: 'br-chapter-lede', text: ch.lede }),
            ]),
            el('span', {
              class: 'br-chapter-chev',
              'aria-hidden': 'true',
              text: on ? '–' : '+',
            }),
          ]),
          on
            ? el('ul', { class: 'br-points' }, ch.points.map(function (p) {
                return el('li', { class: 'br-point', text: p });
              }))
            : null,
        ]);
      }));
    }

    paint();

    return el('section', { class: 'screen screen-briefing' }, [
      el('div', { class: 'br-inner' }, [
        el('header', { class: 'br-head' }, [
          el('button', {
            class: 'br-back',
            type: 'button',
            'aria-label': 'Back',
            text: '‹',
            onclick: opts.onBack,
          }),
          el('div', { class: 'br-titles' }, [
            el('p', { class: 'br-eyebrow', text: 'How to play' }),
            el('h1', { class: 'br-title', text: 'The Election Briefing' }),
          ]),
        ]),

        body,

        el('section', { class: 'br-tips' }, [
          el('h2', { class: 'br-tips-title', text: 'Quick tips' }),
          el('ul', { class: 'br-tip-list' }, TIPS.map(function (t) {
            return el('li', { class: 'br-tip', text: t });
          })),
        ]),

        el('button', {
          class: 'btn btn-primary btn-wide',
          type: 'button',
          text: 'Back to the election',
          onclick: opts.onBack,
        }),
      ]),
    ]);
  }

  return { render: render, chapters: chapters, tips: TIPS };
})();
