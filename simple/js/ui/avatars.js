/**
 * Choosing a face.
 * ------------------------------------------------------------------
 * The cast lives in `CMP.ui.portrait`; this is the grid you pick from and the
 * rule for handing somebody a face they did not pick.
 *
 * An avatar is an id into that cast, so it is small, it means the same thing
 * on every device forever, and it can never become a photograph of anybody.
 * The order is fixed: a player who chose the fourth face gets the fourth face
 * back, so the list is append-only in practice.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.avatars = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

  function list() {
    return CMP.AVATARS.slice();
  }

  /**
   * A grid of faces to choose from.
   *
   * @param opts.selected  the avatar currently chosen
   * @param opts.onPick    called with the new avatar id
   * @param opts.size      pixel size of each face
   */
  function picker(opts) {
    var faces = list();
    var chosen = opts.selected || faces[0];
    var root = el('div', { class: 'pick-rail av-picker', role: 'radiogroup' });

    /**
     * The cast, as cards you scroll through.
     *
     * A face was a 46px circle in a grid of twenty-four, which is a swatch
     * rather than a character. They are cards now — a large portrait, one
     * row, the chosen one lifted — because this is the person the whole
     * campaign is fought as.
     */
    function paint() {
      mount(root, faces.map(function (id, i) {
        var on = id === chosen;
        return el('button', {
          class: 'pick-card av-option' + (on ? ' is-on' : ''),
          type: 'button',
          role: 'radio',
          'aria-label': 'Candidate ' + (i + 1),
          'aria-checked': on ? 'true' : 'false',
          onclick: function () {
            chosen = id;
            if (CMP.audio) CMP.audio.play('select');
            if (opts.onPick) opts.onPick(id);
            paint();
          },
          // The button already carries the label; naming the portrait again
          // inside it makes a screen reader say it twice, and it is what put
          // "C1" under both candidate 11 and candidate 21.
        }, [
          el('span', { class: 'pick-card-art' }, [
            CMP.ui.portrait.render(id, opts.size || 78),
          ]),
          el('span', { class: 'pick-card-name', text: 'Candidate ' + (i + 1) }),
        ]);
      }));
    }

    paint();
    return root;
  }

  return { list: list, picker: picker, fallback: CMP.avatarFor, unused: CMP.avatarUnused };
})();
