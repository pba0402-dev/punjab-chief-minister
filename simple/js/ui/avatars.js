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
    var root = el('div', { class: 'av-picker' });

    function paint() {
      mount(root, faces.map(function (id, i) {
        return el('button', {
          class: 'av-option' + (id === chosen ? ' is-on' : ''),
          type: 'button',
          'aria-label': 'Candidate ' + (i + 1),
          'aria-pressed': id === chosen ? 'true' : 'false',
          onclick: function () {
            chosen = id;
            if (opts.onPick) opts.onPick(id);
            paint();
          },
          // The button already carries the label; naming the portrait again
          // inside it makes a screen reader say it twice, and it is what put
          // "C1" under both candidate 11 and candidate 21.
        }, [CMP.ui.portrait.render(id, opts.size || 46)]);
      }));
    }

    paint();
    return root;
  }

  return { list: list, picker: picker, fallback: CMP.avatarFor, unused: CMP.avatarUnused };
})();
