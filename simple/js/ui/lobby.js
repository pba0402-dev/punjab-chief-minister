/**
 * Multiplayer lobby.
 * ------------------------------------------------------------------
 * Built once, then patched on every poll. That matters: the lobby refreshes
 * every couple of seconds, and rebuilding the DOM would throw away whatever
 * the player is halfway through typing and drop their caret. So the inputs
 * are created once and only their values are reconciled — and never while
 * the field has focus.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.lobby = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var money = CMP.ui.money;

  function create(opts) {
    var view = null;
    var busy = false;
    var notice = null;
    var detailsTimer = null;

    /* ------------------------------------------------ persistent nodes */

    var codeText = el('span', { class: 'code-value', text: '·····' });
    var copyBtn = el('button', {
      class: 'btn btn-quiet btn-copy',
      type: 'button',
      text: 'Copy',
      onclick: copyCode,
    });

    /*
     * The same rails the solo setup screen uses.
     *
     * Playing alone and playing with friends are the same decisions, so they
     * are the same screens - see js/ui/chooser.js. This lobby used to show no
     * candidate at all and a grid of 26px symbols, which meant a player who
     * founded a party alone and then founded one with friends was doing the
     * same thing twice, differently.
     *
     * They are built once and never rebuilt, which is also what keeps their
     * scroll position through the poll that repaints this screen every couple
     * of seconds.
     */
    var store = CMP.ui.chooser.rails();
    var candidateNode = el('div', { class: 'lobby-candidate' });
    var candidateDetailNode = el('div', { class: 'cd-detail-slot' });

    var countText = el('span', { class: 'lobby-count', text: '0 / 4' });
    var rosterNode = el('div', { class: 'roster' });
    var partyNode = el('div', { class: 'party-editor' });
    var previewNode = el('div', { class: 'party-preview' });
    var noticeNode = el('div', { class: 'notice-slot' });

    /*
     * The party this player is founding.
     *
     * Held here rather than read back off the server on every poll: somebody
     * halfway through typing a name should not have it replaced by what the
     * server last heard. It is pushed up on a debounce and only pulled down
     * when they are not in the middle of it — see paintOwnFields.
     */
    var party = {
      name: '',
      short: '',
      shortEdited: false,
      symbol: CMP.PARTY_SYMBOLS[0].id,
      colourId: CMP.PARTY_COLOURS[0].id,
      // Optional, the same as it is on the solo screen: one is assigned until
      // somebody picks, and the assigned one is shown so it is not a surprise.
      colourChosen: false,
      slogan: '',
    };
    var partyTimer = null;
    var partyTouched = false;

    var nameInput = el('input', {
      class: 'field-input js-candidate-name',
      type: 'text',
      maxlength: '60',
      autocomplete: 'off',
      placeholder: 'Enter the name of your CM face',
      oninput: queueDetails,
    });

    // How long each round runs. The host chooses once, before the election
    // starts, and it applies to all twenty rounds.
    var roundSeconds = CMP.ROUNDS.seconds;
    // Published once on arrival; see paintClock.
    var clockPublished = false;

    var clockNode = el('div', { class: 'lobby-clock' });

    var readyBtn = el('button', {
      class: 'btn btn-xl btn-ready',
      type: 'button',
      text: 'READY',
      onclick: toggleReady,
    });

    var startBtn = el('button', {
      class: 'btn btn-primary btn-xl',
      type: 'button',
      text: 'START ELECTION',
      onclick: startElection,
    });
    var startHint = el('p', { class: 'start-hint' });
    var hostBlock = el('div', { class: 'host-block' }, [startBtn, startHint]);

    var backBtn = el('button', {
      class: 'btn btn-quiet btn-wide',
      type: 'button',
      text: '',
      onclick: function () {
        goStep(step - 1);
      },
    });
    var nextBtn = el('button', {
      class: 'btn btn-primary btn-xl',
      type: 'button',
      text: 'Continue',
      onclick: function () {
        goStep(step + 1);
      },
    });
    var walkBlock = el('div', { class: 'lobby-walk' }, [nextBtn, backBtn]);

    var footNode = el('div', { class: 'lobby-foot' }, [readyBtn]);

    var codeCard = el('div', { class: 'code-card' }, [
      el('span', { class: 'code-label', text: 'Your Game Code' }),
      el('div', { class: 'code-row' }, [codeText, copyBtn]),
      el('span', { class: 'code-note', text: 'Share this code with your friends' }),
    ]);

    /*
     * The lobby, in steps.
     *
     * Candidate, then party, then - for the host only - the round length, and
     * then the waiting room. The same order the solo screen asks in, because
     * they are the same decisions; the difference is that this one ends in a
     * room with other people in it rather than in an election.
     *
     * The sections are built once and shown one at a time rather than
     * rebuilt. This screen is patched on a poll every couple of seconds, and
     * anything rebuilt under a step change would take the caret out of a
     * half-typed party name with it.
     */
    var stepperNode = el('ol', { class: 'setup-steps lobby-steps' });
    var candidateSection = null;
    var partySection = null;
    var clockSection = null;
    var waitingSection = null;
    var step = 0;

    var root = el('section', { class: 'screen screen-lobby' }, [
      el('div', { class: 'lobby-inner' }, [
        el('header', { class: 'lobby-head' }, [
          el('button', {
            class: 'back-link',
            type: 'button',
            text: '← Leave game',
            onclick: leaveGame,
          }),
          el('h1', { class: 'title title-sm', text: 'Punjab Election' }),
        ]),

        codeCard,

        noticeNode,

        stepperNode,

        waitingSection = el('div', { class: 'lobby-step', dataset: { step: 'waiting' } }, [
          el('div', { class: 'lobby-section' }, [
            el('div', { class: 'lobby-section-head' }, [
              el('h2', { class: 'block-title', text: 'Players' }),
              countText,
            ]),
            rosterNode,
          ]),
        ]),

        candidateSection = el('div', { class: 'lobby-step', dataset: { step: 'candidate' } }, [
        el('div', { class: 'lobby-section' }, [
          el('h2', { class: 'block-title', text: 'Your Candidate' }),
          el('label', { class: 'field' }, [
            el('span', { class: 'field-label', text: 'Playing as' }),
            nameInput,
          ]),
          candidateNode,
          candidateDetailNode,
          el('p', { class: 'granted-note' }, [
            'Every campaign is funded ',
            el('strong', { text: money.words(CMP.CAMPAIGN.income.perRound) }),
            ' a round over ' + CMP.ROUNDS.total + ' rounds. Whatever you do not ',
            'spend, you keep.',
          ]),

        ]),
        ]),

        partySection = el('div', { class: 'lobby-step', dataset: { step: 'party' } }, [
          el('div', { class: 'lobby-section' }, [
            el('h2', { class: 'block-title', text: 'Your Party' }),
            partyNode,
          ]),
        ]),

        clockSection = el('div', { class: 'lobby-step', dataset: { step: 'clock' } }, [
          clockNode,
        ]),

        footNode,
      ]),
    ]);

    /* -------------------------------------------------------- the steps */

    /** Which steps this player actually has. A guest never sets the clock. */
    function stepList() {
      var mine = me();
      var isHost = !!(mine && mine.isHost);
      var out = [
        { id: 'candidate', label: 'Your candidate', node: function () { return candidateSection; } },
        { id: 'party', label: 'Your party', node: function () { return partySection; } },
      ];
      if (isHost) {
        out.push({ id: 'clock', label: 'Round length', node: function () { return clockSection; } });
      }
      out.push({ id: 'waiting', label: 'Waiting room', node: function () { return waitingSection; } });
      return out;
    }

    function paintSteps() {
      var steps = stepList();
      if (step >= steps.length) step = steps.length - 1;

      steps.forEach(function (entry, i) {
        var node = entry.node();
        if (node) node.hidden = i !== step;
      });
      /*
       * A guest has no clock step, but is still told what the host chose.
       *
       * The round length applies to everybody, so hiding it from a joiner
       * would be hiding a rule of the game they are about to play. It rides
       * in the waiting room, read-only, rather than as a control that would
       * do nothing if they touched it.
       */
      if (clockSection && !steps.some(function (e) { return e.id === 'clock'; })) {
        clockSection.hidden = steps[step].id !== 'waiting';
      }

      /*
       * The game code stays put.
       *
       * It was going to live on the waiting room, on the grounds that the
       * first thing on the screen should be the choice being asked for rather
       * than a string of letters. But people join while the host is still
       * choosing, and a host who wants to send the code should not have to
       * walk three steps forward to find it.
       */

      mount(stepperNode, steps.map(function (entry, i) {
        return el('li', {
          class: 'setup-step' + (i === step ? ' is-on' : '') + (i < step ? ' is-done' : ''),
        }, [
          el('span', { class: 'setup-step-no', text: i < step ? '\u2713' : String(i + 1) }),
          el('span', { class: 'setup-step-label', text: entry.label }),
        ]);
      }));
    }

    function goStep(next) {
      var steps = stepList();
      step = Math.max(0, Math.min(steps.length - 1, next));
      if (CMP.audio) CMP.audio.play('tap');
      paintSteps();
      paintFoot();
      if (root.scrollIntoView) root.scrollIntoView({ block: 'start' });
    }

    /* ------------------------------------------------ actions */

    function setNotice(text, tone) {
      notice = text ? { text: text, tone: tone || 'bad' } : null;
      paintNotice();
    }

    function paintNotice() {
      mount(
        noticeNode,
        notice ? [el('p', { class: 'notice notice-' + notice.tone, text: notice.text })] : []
      );
    }

    function me() {
      if (!view) return null;
      for (var i = 0; i < view.players.length; i++) {
        if (!view.players[i].empty && view.players[i].isYou) return view.players[i];
      }
      return null;
    }

    function copyCode() {
      var code = view ? view.code : '';
      if (!code) return;

      function done() {
        copyBtn.textContent = 'Copied';
        window.setTimeout(function () {
          copyBtn.textContent = 'Copy';
        }, 1600);
      }

      if (navigator.share) {
        navigator
          .share({ title: 'Chief Minister of Punjab', text: 'Join my election. Game code: ' + code })
          .then(done)
          .catch(fallbackCopy);
        return;
      }
      fallbackCopy();

      function fallbackCopy() {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(done, legacyCopy);
        } else {
          legacyCopy();
        }
      }

      function legacyCopy() {
        var scratch = document.createElement('textarea');
        scratch.value = code;
        scratch.setAttribute('readonly', '');
        scratch.style.position = 'absolute';
        scratch.style.left = '-9999px';
        document.body.appendChild(scratch);
        scratch.select();
        try {
          document.execCommand('copy');
          done();
        } catch (e) {
          setNotice('Could not copy automatically — the code is ' + code + '.', 'info');
        }
        document.body.removeChild(scratch);
      }
    }

    /** Push the party up, debounced, so typing is not a request a keystroke. */
    /**
     * The cast, and what choosing one means.
     *
     * The candidate is not only a portrait: regional support multiplies what
     * a campaign in that region buys, and the server applies it, so this has
     * to reach the server. It rides on the details call, which already exists
     * for the name.
     */
    function paintCandidate() {
      if (!store.has('candidate')) {
        mount(candidateNode, [
          CMP.ui.chooser.candidateRail(store,
            function () {
              var me = CMP.profile.get();
              return (me && me.avatar) || CMP.ui.avatars.list()[0];
            },
            function (id) {
              if (CMP.profile.has()) CMP.profile.setAvatar(id);
              else CMP.profile.create(nameInput.value.trim() || 'Player', id);
              queueDetails();
            },
            {
              locked: function () {
                return view && view.phase !== 'lobby';
              },
              onPick: paintCandidateDetail,
            }),
        ]);
      }
      paintCandidateDetail();
    }

    function paintCandidateDetail() {
      var me = CMP.profile.get();
      var id = (me && me.avatar) || CMP.ui.avatars.list()[0];
      mount(candidateDetailNode, [CMP.ui.chooser.candidateDetail(id, null)]);
    }

    function queueParty() {
      partyTouched = true;
      if (partyTimer) window.clearTimeout(partyTimer);
      partyTimer = window.setTimeout(sendParty, 600);
    }

    function sendParty() {
      partyTimer = null;
      if (!party.short) party.short = CMP.suggestShort(party.name);
      CMP.net.setParty(party).then(function (res) {
        setNotice(res.ok ? null : res.error);
        if (res.game) update(res.game);
      });
    }

    function queueDetails() {
      // Debounced: typing should not fire a request per keystroke.
      if (detailsTimer) window.clearTimeout(detailsTimer);
      detailsTimer = window.setTimeout(sendDetails, 600);
    }

    function sendDetails() {
      detailsTimer = null;

      // The name they have just typed is the name their profile carries, and
      // this is the first moment there is one to start.
      var name = nameInput.value.trim();
      if (name && !CMP.profile.has()) CMP.profile.create(name);

      CMP.net
        .setDetails(nameInput.value, '', CMP.profile.get())
        .then(function (res) {
          if (!res.ok && !res.offline) setNotice(res.error);
          if (res.game) update(res.game);
        });
    }

    function toggleReady() {
      var mine = me();
      if (!mine) return;
      // Flush anything still sitting in the debounce before readying up.
      if (detailsTimer) {
        window.clearTimeout(detailsTimer);
        sendDetails();
      }
      var next = !mine.ready;
      CMP.net.setReady(next).then(function (res) {
        setNotice(res.ok ? null : res.error);
        if (res.game) update(res.game);
        CMP.net.refresh();
      });
    }

    /** The round length, host only. Everyone else is told what was chosen. */
    function paintClock() {
      var mine = me();
      var isHost = !!(mine && mine.isHost);

      if (!isHost) {
        mount(clockNode, view && view.roundSeconds
          ? [el('div', { class: 'lobby-section lobby-clock-told' }, [
              el('h2', { class: 'block-title', text: 'Round length' }),
              el('p', { class: 'lobby-note' }, [
                el('strong', {
                  text: 'Rounds run ' + Math.round(view.roundSeconds / 60) + ' minutes.',
                }),
                ' Set by the host.',
              ]),
            ])]
          : []);
        return;
      }

      /*
       * Publish the default, once.
       *
       * A host who is happy with two minutes never clicks anything, so
       * publishing only on change left the other three unable to see the
       * round length of the game they were joining. The server treats an
       * unset length as "use the configured default" either way — this just
       * says so out loud, so the lobby can show it.
       */
      if (view && !view.roundSeconds && !clockPublished) {
        clockPublished = true;
        CMP.net.setRoundLength(roundSeconds).then(function (res) {
          if (res && res.game) update(res.game);
        });
      }

      mount(clockNode, [
        el('div', { class: 'lobby-section' }, [
          el('h2', { class: 'block-title', text: 'Round length' }),
          el('div', { class: 'clock-options' }, CMP.ROUNDS.durationOptions.map(function (secs) {
            return el('button', {
              class: 'clock-option' + (roundSeconds === secs ? ' is-active' : ''),
              type: 'button',
              onclick: function () {
                roundSeconds = secs;
                paintClock();
                // Published now rather than at the start, so the other three
                // can see what they are joining.
                CMP.net.setRoundLength(secs).then(function (res) {
                  if (res && res.game) update(res.game);
                });
              },
            }, [
              el('strong', { class: 'clock-option-value', text: Math.round(secs / 60) + ' min' }),
              el('span', {
                class: 'clock-option-note',
                text: secs === 120 ? 'Brisk' : secs === 180 ? 'Steady' : 'Considered',
              }),
            ]);
          })),
          el('p', {
            class: 'granted-note',
            text: 'Applies to all ' + CMP.ROUNDS.total + ' rounds. A round also ends ' +
              'the moment everybody has pressed END ROUND.',
          }),
        ]),
      ]);
    }

    function startElection() {
      CMP.net.start(roundSeconds).then(function (res) {
        setNotice(res.ok ? null : res.error);
        if (res.game) update(res.game);
        CMP.net.refresh();
      });
    }

    function leaveGame() {
      CMP.net.leave().then(function () {
        opts.onLeave();
      });
    }

    /* ------------------------------------------------ patching */

    function update(next) {
      view = next;

      codeText.textContent = view.code;
      countText.textContent = view.connectedCount + ' / ' + view.maxPlayers;

      paintSteps();
      paintRoster();
      paintCandidate();
      paintParties();
      paintOwnFields();
      paintClock();
      paintFoot();
    }

    function paintRoster() {
      mount(
        rosterNode,
        view.players.map(function (slot) {
          if (slot.empty) {
            return el('div', { class: 'roster-row is-empty' }, [
              el('span', { class: 'roster-slot', text: 'Player ' + slot.slot }),
              el('span', { class: 'roster-status', text: 'Empty' }),
            ]);
          }

          // The party each player founded, straight off their own row —
          // the registry is not pointed at this game until it starts.
          var party = slot.party && slot.party.name
            ? CMP.normalisePartyDef(slot.party)
            : null;
          var named = party && party.name !== 'Unnamed Party';
          var status = !slot.connected
            ? { label: 'Disconnected', cls: 'off' }
            : slot.ready
            ? { label: 'Ready', cls: 'ready' }
            : { label: 'Waiting', cls: 'waiting' };

          return el(
            'div',
            {
              class:
                'roster-row' + (slot.isYou ? ' is-you' : '') + (slot.connected ? '' : ' is-off'),
              style: party ? { '--party': party.colour } : null,
            },
            [
              el('span', { class: 'roster-slot' }, [
                'Player ' + slot.slot,
                slot.isHost ? el('span', { class: 'roster-host', text: 'Host' }) : null,
                slot.isYou ? el('span', { class: 'roster-you', text: 'You' }) : null,
              ]),
              slot.avatar
                ? CMP.ui.portrait.render(slot.avatar, 32, slot.candidateName || 'a candidate')
                : null,
              el('span', { class: 'roster-party' }, [
                el('span', {
                  class: 'roster-candidate',
                  text: slot.candidateName || 'Choosing…',
                }),
                named
                  ? el('span', { class: 'roster-partyname' }, [
                      CMP.ui.symbol.render(party.symbol, 14),
                      party.name,
                    ])
                  : el('span', { class: 'roster-partyname is-none', text: 'No party yet' }),
              ]),
              el('span', { class: 'roster-status status-' + status.cls, text: status.label }),
            ]
          );
        })
      );
    }

    /**
     * Founding a party, in the lobby.
     *
     * The same six decisions the solo screen asks for, laid out to be filled
     * in while other people are still joining. The preview underneath is the
     * point: six choices made in isolation produce a party nobody has
     * actually looked at.
     */
    function paintParties() {
      var locked = view.phase !== 'lobby';
      var current = CMP.normalisePartyDef({
        id: 'preview',
        name: party.name || 'Your party',
        short: party.short,
        slogan: party.slogan,
        symbol: party.symbol,
        colourId: party.colourId,
      });

      mount(partyNode, [
        el('label', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Party name' }),
          el('input', {
            class: 'field-input js-party-name',
            type: 'text',
            maxlength: '40',
            autocomplete: 'off',
            value: party.name,
            disabled: locked,
            placeholder: 'Punjab Development Party',
            oninput: function (e) {
              party.name = e.target.value;
              if (!party.shortEdited) {
                party.short = CMP.suggestShort(party.name);
                var badge = partyNode.querySelector('.js-party-short');
                if (badge) badge.value = party.short;
              }
              queueParty();
              paintPreview();
            },
          }),
        ]),

        el('label', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Short name' }),
          el('input', {
            class: 'field-input js-party-short is-short',
            type: 'text',
            maxlength: '4',
            autocomplete: 'off',
            value: party.short,
            disabled: locked,
            placeholder: 'PDP',
            oninput: function (e) {
              party.shortEdited = true;
              party.short = e.target.value.toUpperCase();
              e.target.value = party.short;
              queueParty();
              paintPreview();
            },
          }),
        ]),

        el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Symbol' }),
          symbolRail(locked),
        ]),

        el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Colour (optional)' }),
          CMP.ui.chooser.colourGrid(
            party.colourChosen ? party.colourId : null,
            assignedColour(),
            function (id) {
              party.colourId = id;
              party.colourChosen = true;
              queueParty();
              paintParties();
            },
            { locked: function () { return locked; } }),
        ]),

        previewNode,
      ]);

      paintPreview();
    }

    function symbolRail(locked) {
      var node = CMP.ui.chooser.symbolRail(store,
        function () { return party.symbol; },
        function (id) { party.symbol = id; },
        {
          locked: function () { return locked; },
          onPick: function () {
            queueParty();
            paintParties();
          },
        });
      node.style.setProperty('--party', currentColour());
      return node;
    }

    /*
     * A colour nobody chose, derived from what they did choose.
     *
     * Optional means optional here too: a player who never opens the swatches
     * still gets a party that looks like a party, and not the same colour as
     * everybody else who skipped it.
     */
    function assignedColour() {
      return CMP.ui.chooser.assignedColour([party.symbol, (CMP.profile.get() || {}).avatar]);
    }

    function currentColour() {
      var id = party.colourChosen ? party.colourId : assignedColour();
      for (var i = 0; i < CMP.PARTY_COLOURS.length; i++) {
        if (CMP.PARTY_COLOURS[i].id === id) return CMP.PARTY_COLOURS[i].colour;
      }
      return CMP.PARTY_COLOURS[0].colour;
    }

    /** The card, as it currently stands. Repainted without losing focus. */
    function paintPreview() {
      var current = CMP.normalisePartyDef({
        id: 'preview',
        name: party.name || 'Your party',
        short: party.short,
        slogan: party.slogan,
        symbol: party.symbol,
        colourId: party.colourId,
      });
      var mine = me();

      mount(previewNode, [
        el('div', {
          class: 'pv-card',
          style: { '--party': current.colour, '--party-ink': current.ink },
        }, [
          el('div', { class: 'pv-face' }, [
            CMP.ui.portrait.render(
              (mine && mine.avatar) || CMP.AVATARS[0],
              56,
              (mine && mine.candidateName) || 'your candidate'
            ),
          ]),
          el('div', { class: 'pv-who' }, [
            el('strong', {
              class: 'pv-name',
              text: ((mine && mine.candidateName) || 'Your name').toUpperCase(),
            }),
            el('span', { class: 'pv-party', text: current.name.toUpperCase() }),
            /*
             * No slogan line.
             *
             * The player is never asked for one, so this could only ever
             * have said "No slogan" - a field's absence announced as
             * though it were a fact about their party.
             */
          ]),
          el('div', { class: 'pv-badge' }, [
            CMP.ui.symbol.render(current.symbol, 26),
            el('span', { class: 'pv-short', text: current.short }),
          ]),
        ]),
      ]);
    }

    /**
     * Reconcile our own inputs with the server, but never while the player is
     * typing in them — otherwise a poll would fight the keyboard.
     */
    function paintOwnFields() {
      var mine = me();
      if (!mine) return;
      // An edit is still queued: the server's copy is stale by definition, so
      // leave the fields alone or we would revert what was just typed.
      if (detailsTimer) return;

      if (document.activeElement !== nameInput && nameInput.value !== mine.candidateName) {
        nameInput.value = mine.candidateName;
      }

      /*
       * The party, the same way.
       *
       * Only ever pulled down before this player has touched it — after that
       * their draft is the truth and the server is following, not leading.
       */
      if (!partyTouched && !partyTimer && mine.party && mine.party.name) {
        party.name = mine.party.name;
        party.short = mine.party.short;
        party.symbol = mine.party.symbol;
        party.colourId = mine.party.colourId;
        party.slogan = mine.party.slogan || '';
        paintParties();
      }
    }

    /**
     * What to press, on whichever step this is.
     *
     * Everything before the waiting room offers one thing: carry on. The
     * waiting room is where READY lives, and where the host's START ELECTION
     * appears — because that is the only step on which the other players
     * matter, and it is the only one where waiting for them makes sense.
     */
    function paintFoot() {
      var mine = me();
      var locked = view.phase !== 'lobby';
      var steps = stepList();
      var here = steps[step] || steps[steps.length - 1];
      var onWaiting = here.id === 'waiting';

      readyBtn.textContent = mine && mine.ready ? 'READY ✓' : 'READY';
      readyBtn.classList.toggle('is-ready', !!(mine && mine.ready));
      readyBtn.disabled = locked || !mine;
      readyBtn.hidden = !onWaiting;

      /*
       * Back and Continue, and nothing else.
       *
       * Going back has to keep every choice — a player who steps back to look
       * at their candidate and forward again must find the same candidate
       * selected and the rail where they left it. Nothing here is rebuilt, so
       * nothing here can lose it.
       */
      if (!onWaiting) {
        if (!walkBlock.parentNode) footNode.appendChild(walkBlock);
        backBtn.hidden = step === 0;
        backBtn.textContent = step === 0 ? '' : '← ' + steps[step - 1].label;
        nextBtn.textContent = steps[step + 1]
          ? (steps[step + 1].id === 'waiting' ? 'Waiting room' : 'Continue')
          : 'Continue';
      } else if (walkBlock.parentNode) {
        walkBlock.parentNode.removeChild(walkBlock);
      }

      if (view.youAreHost && onWaiting) {
        if (!hostBlock.parentNode) footNode.appendChild(hostBlock);
        startBtn.disabled = !!view.startBlockedReason || locked;
        startHint.textContent = view.startBlockedReason || 'Everyone is ready.';
      } else if (hostBlock.parentNode) {
        hostBlock.parentNode.removeChild(hostBlock);
      }

      // A step further back than a guest now has, after the host left.
      if (step >= steps.length) {
        step = steps.length - 1;
        paintSteps();
      }
    }

    return {
      root: root,
      update: update,
      setNotice: setNotice,
    };
  }

  return { create: create };
})();
