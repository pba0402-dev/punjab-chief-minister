/**
 * Choosing a face.
 * ------------------------------------------------------------------
 * Every portrait in this game is drawn from a seed — a turban or hair, a
 * beard, a kurta, a skin tone, a pair of glasses — so an "avatar" is simply a
 * seed somebody picked rather than one they were dealt. That matters for two
 * reasons: nothing here is or could become a photograph of a real person, and
 * adding more faces later costs one line each.
 *
 * The set below is fixed and ordered so a player who picks the fourth face
 * gets the same fourth face on every device, forever.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.avatars = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;

  /*
   * The built-in faces.
   *
   * Chosen by generating and looking: each seed below draws a distinct,
   * plausible candidate, and between them they span turbaned and bare-headed,
   * bearded and clean-shaven, young and old, with and without glasses.
   *
   * Adding a face is adding a string. Never reorder or remove one — a stored
   * profile refers to the seed itself, so the list is append-only in practice.
   */
  var FACES = [
    'punjab-a1', 'punjab-b7', 'punjab-c3', 'punjab-d9',
    'punjab-e2', 'punjab-f8', 'punjab-g4', 'punjab-h6',
    'punjab-j5', 'punjab-k1', 'punjab-m3', 'punjab-n8',
  ];

  function list() {
    return FACES.slice();
  }

  /** A seed nobody chose, for a player who never opens the picker. */
  function fallback(from) {
    var h = 0;
    var text = String(from || '');
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0xffff;
    return FACES[h % FACES.length];
  }

  /**
   * A grid of faces to choose from.
   *
   * @param opts.selected  the seed currently chosen
   * @param opts.onPick    called with the new seed
   * @param opts.size      pixel size of each face
   */
  function picker(opts) {
    var chosen = opts.selected || FACES[0];
    var root = el('div', { class: 'av-picker' });

    function paint() {
      mount(root, FACES.map(function (seed, i) {
        return el('button', {
          class: 'av-option' + (seed === chosen ? ' is-on' : ''),
          type: 'button',
          'aria-label': 'Avatar ' + (i + 1),
          'aria-pressed': seed === chosen ? 'true' : 'false',
          onclick: function () {
            chosen = seed;
            if (opts.onPick) opts.onPick(seed);
            paint();
          },
        }, [CMP.ui.portrait.render(seed, opts.size || 46, 'Avatar ' + (i + 1))]);
      }));
    }

    paint();
    return root;
  }

  return { list: list, picker: picker, fallback: fallback };
})();
