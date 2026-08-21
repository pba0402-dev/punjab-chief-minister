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

    var countText = el('span', { class: 'lobby-count', text: '0 / 4' });
    var rosterNode = el('div', { class: 'roster' });
    var partyNode = el('div', { class: 'party-grid party-grid-compact' });
    var noticeNode = el('div', { class: 'notice-slot' });

    var nameInput = el('input', {
      class: 'field-input',
      type: 'text',
      maxlength: '60',
      autocomplete: 'off',
      placeholder: 'Enter the name of your CM face',
      oninput: queueDetails,
    });

    var sloganInput = el('input', {
      class: 'field-input',
      type: 'text',
      maxlength: '80',
      autocomplete: 'off',
      placeholder: 'The line your campaign runs on',
      oninput: queueDetails,
    });

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

    var footNode = el('div', { class: 'lobby-foot' }, [readyBtn]);

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

        el('div', { class: 'code-card' }, [
          el('span', { class: 'code-label', text: 'Your Game Code' }),
          el('div', { class: 'code-row' }, [codeText, copyBtn]),
          el('span', { class: 'code-note', text: 'Share this code with your friends' }),
        ]),

        noticeNode,

        el('div', { class: 'lobby-section' }, [
          el('div', { class: 'lobby-section-head' }, [
            el('h2', { class: 'block-title', text: 'Players' }),
            countText,
          ]),
          rosterNode,
        ]),

        el('div', { class: 'lobby-section' }, [
          el('h2', { class: 'block-title', text: 'Your Party' }),
          partyNode,
        ]),

        el('div', { class: 'lobby-section' }, [
          el('h2', { class: 'block-title', text: 'Your Candidate' }),
          el('label', { class: 'field' }, [
            el('span', { class: 'field-label', text: 'Chief Minister Candidate Name' }),
            nameInput,
          ]),
          el('label', { class: 'field' }, [
            el('span', { class: 'field-label', text: 'Election Slogan' }),
            sloganInput,
          ]),
          el('p', { class: 'granted-note' }, [
            'Every player is given ',
            el('strong', { text: money.format(CMP.STARTING_BUDGET) }),
            ' of their own to spend.',
          ]),
        ]),

        footNode,
      ]),
    ]);

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

    function pickParty(partyId) {
      if (busy) return;
      var mine = me();
      var next = mine && mine.partyId === partyId ? '' : partyId;
      busy = true;
      CMP.net.setParty(next).then(function (res) {
        busy = false;
        setNotice(res.ok ? null : res.error);
        if (res.game) update(res.game);
        CMP.net.refresh();
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
        .setDetails(nameInput.value, sloganInput.value, CMP.profile.get())
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

    function startElection() {
      CMP.net.start().then(function (res) {
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

      paintRoster();
      paintParties();
      paintOwnFields();
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

          var party = slot.partyId ? CMP.getParty(slot.partyId) : null;
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
              el('span', { class: 'roster-party' }, [
                party
                  ? el('span', { class: 'roster-flag', text: party.short })
                  : el('span', { class: 'roster-flag is-none', text: '—' }),
                el('span', {
                  class: 'roster-candidate',
                  text: slot.candidateName || (party ? party.name : 'Choosing…'),
                }),
              ]),
              el('span', { class: 'roster-status status-' + status.cls, text: status.label }),
            ]
          );
        })
      );
    }

    function paintParties() {
      var mine = me();
      mount(
        partyNode,
        CMP.PLAYABLE_PARTIES.map(function (party) {
          var takenByOther =
            view.takenParties.indexOf(party.id) !== -1 &&
            !(mine && mine.partyId === party.id);
          var isMine = !!(mine && mine.partyId === party.id);

          return el(
            'button',
            {
              class:
                'party-card party-card-compact' +
                (isMine ? ' is-selected' : '') +
                (takenByOther ? ' is-taken' : ''),
              type: 'button',
              disabled: takenByOther || view.phase !== 'lobby',
              'aria-pressed': isMine ? 'true' : 'false',
              style: { '--party': party.colour, '--party-ink': party.ink },
              onclick: function () {
                pickParty(party.id);
              },
            },
            [
              el('span', { class: 'party-flag', text: party.short }),
              el('span', { class: 'party-text' }, [
                el('strong', { class: 'party-short', text: party.short }),
                el('span', {
                  class: 'party-name',
                  text: takenByOther ? 'Taken' : party.name,
                }),
              ]),
              isMine ? el('span', { class: 'party-tick', text: '✓' }) : null,
            ]
          );
        })
      );
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
      if (document.activeElement !== sloganInput && sloganInput.value !== mine.slogan) {
        sloganInput.value = mine.slogan;
      }
    }

    function paintFoot() {
      var mine = me();
      var locked = view.phase !== 'lobby';

      readyBtn.textContent = mine && mine.ready ? 'READY ✓' : 'READY';
      readyBtn.classList.toggle('is-ready', !!(mine && mine.ready));
      readyBtn.disabled = locked || !mine;

      if (view.youAreHost) {
        if (!hostBlock.parentNode) footNode.appendChild(hostBlock);
        startBtn.disabled = !!view.startBlockedReason || locked;
        startHint.textContent = view.startBlockedReason || 'Everyone is ready.';
      } else if (hostBlock.parentNode) {
        hostBlock.parentNode.removeChild(hostBlock);
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
