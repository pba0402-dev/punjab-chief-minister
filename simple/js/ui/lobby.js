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
          el('h2', { class: 'block-title', text: 'Your Candidate' }),
          el('label', { class: 'field' }, [
            el('span', { class: 'field-label', text: 'Playing as' }),
            nameInput,
          ]),
          el('p', { class: 'granted-note' }, [
            'Every campaign is funded ',
            el('strong', { text: money.words(CMP.CAMPAIGN.income.perRound) }),
            ' a round over ' + CMP.ROUNDS.total + ' rounds. Whatever you do not ',
            'spend, you keep.',
          ]),

        el('div', { class: 'lobby-section' }, [
          el('h2', { class: 'block-title', text: 'Your Party' }),
          partyNode,
        ]),
        ]),

        clockNode,

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

    /** Push the party up, debounced, so typing is not a request a keystroke. */
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
          ? [el('p', { class: 'lobby-note', text: 'Rounds run ' +
              Math.round(view.roundSeconds / 60) + ' minutes.' })]
          : []);
        return;
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

      paintRoster();
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
          el('div', { class: 'sym-grid' }, CMP.PARTY_SYMBOLS.map(function (sym) {
            var on = party.symbol === sym.id;
            return el('button', {
              class: 'sym-option' + (on ? ' is-on' : ''),
              type: 'button',
              title: sym.name,
              'aria-label': sym.name,
              'aria-pressed': on ? 'true' : 'false',
              disabled: locked,
              style: { color: on ? current.colour : 'var(--muted)' },
              onclick: function () {
                party.symbol = sym.id;
                queueParty();
                paintParties();
              },
            }, [CMP.ui.symbol.render(sym.id, 26)]);
          })),
        ]),

        el('div', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Colour' }),
          el('div', { class: 'col-grid' }, CMP.PARTY_COLOURS.map(function (swatch) {
            var on = party.colourId === swatch.id;
            return el('button', {
              class: 'col-option' + (on ? ' is-on' : ''),
              type: 'button',
              title: swatch.name,
              'aria-label': swatch.name,
              'aria-pressed': on ? 'true' : 'false',
              disabled: locked,
              style: { '--swatch': swatch.colour },
              onclick: function () {
                party.colourId = swatch.id;
                queueParty();
                paintParties();
              },
            });
          })),
        ]),

        el('label', { class: 'field' }, [
          el('span', { class: 'field-label', text: 'Slogan (optional)' }),
          el('input', {
            class: 'field-input',
            type: 'text',
            maxlength: '60',
            autocomplete: 'off',
            value: party.slogan,
            disabled: locked,
            placeholder: 'Progress for every village',
            oninput: function (e) {
              party.slogan = e.target.value;
              queueParty();
              paintPreview();
            },
          }),
        ]),

        previewNode,
      ]);

      paintPreview();
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
            current.slogan
              ? el('span', { class: 'pv-slogan', text: '\u201c' + current.slogan + '\u201d' })
              : el('span', { class: 'pv-slogan is-empty', text: 'No slogan' }),
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
