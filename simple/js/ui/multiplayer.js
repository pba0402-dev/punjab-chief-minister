/**
 * Multiplayer entry screen.
 * ------------------------------------------------------------------
 * Two things only: start a game and get a code, or type a friend's code and
 * join theirs. Both land in the same lobby.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.multiplayer = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

  function render(opts) {
    var root = el('section', { class: 'screen screen-multiplayer' });
    var busy = false;
    var message = null;

    function setMessage(text, tone) {
      message = text ? { text: text, tone: tone || 'bad' } : null;
      paint();
    }

    function createGame() {
      if (busy) return;
      busy = true;
      paint();
      // The profile goes with the request, so a finished election can be
      // credited afterwards. A player without one simply is not credited.
      CMP.net.create(CMP.profile.get()).then(function (res) {
        busy = false;
        if (!res.ok) {
          setMessage(res.error || 'Could not create a game.');
          return;
        }
        opts.onJoined(res.code);
      });
    }

    function joinGame(rawCode) {
      var code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 5) {
        setMessage('A game code is 5 characters, like P7K4Q.');
        return;
      }
      if (busy) return;
      busy = true;
      paint();
      CMP.net.join(code, CMP.profile.get()).then(function (res) {
        busy = false;
        if (!res.ok) {
          setMessage(res.error || 'Could not join that game.');
          return;
        }
        opts.onJoined(res.code);
      });
    }

    function paint() {
      var codeInput = el('input', {
        class: 'field-input code-input',
        type: 'text',
        maxlength: '7',
        autocomplete: 'off',
        autocapitalize: 'characters',
        spellcheck: 'false',
        'aria-label': 'Game code',
        placeholder: 'P7K4Q',
        oninput: function (e) {
          var pos = e.target.selectionStart;
          e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
          try {
            e.target.setSelectionRange(pos, pos);
          } catch (err) {
            /* ignore */
          }
        },
        onkeydown: function (e) {
          if (e.key === 'Enter') joinGame(e.target.value);
        },
      });

      mount(root, [
        el('div', { class: 'mp-inner' }, [
          el('header', { class: 'setup-head' }, [
            el('button', {
              class: 'back-link',
              type: 'button',
              text: '← Back',
              onclick: opts.onBack,
            }),
            el('h1', { class: 'title title-sm', text: 'Play with Friends' }),
            el('p', { class: 'subtitle' }, [
              el('strong', { text: '2 to 4 players, one party each' }),
            ]),
          ]),

          message
            ? el('p', { class: 'notice notice-' + message.tone, text: message.text })
            : null,

          el('div', { class: 'mp-panel' }, [
            el('h2', { class: 'block-title', text: 'Create Game' }),
            el('p', {
              class: 'mp-note',
              text: 'You become the host. Share the code your friends need to join.',
            }),
            el('button', {
              class: 'btn btn-primary btn-xl',
              type: 'button',
              disabled: busy,
              text: busy ? 'Creating…' : 'CREATE GAME',
              onclick: createGame,
            }),
          ]),

          el('div', { class: 'mp-divider' }, [el('span', { text: 'or' })]),

          el('div', { class: 'mp-panel' }, [
            el('h2', { class: 'block-title', text: 'Join Game' }),
            el('label', { class: 'field' }, [
              el('span', { class: 'field-label', text: 'Enter Game Code' }),
              codeInput,
            ]),
            el('button', {
              class: 'btn btn-xl',
              type: 'button',
              disabled: busy,
              text: busy ? 'Joining…' : 'JOIN GAME',
              onclick: function () {
                joinGame(codeInput.value);
              },
            }),
          ]),
        ]),
      ]);
    }

    paint();
    return root;
  }

  return { render: render };
})();
