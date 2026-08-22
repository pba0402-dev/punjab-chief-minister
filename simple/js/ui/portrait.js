/**
 * Faces.
 * ------------------------------------------------------------------
 * A portrait is an image file, loaded from `assets/portraits/` and keyed by
 * the id a save has been storing all along. This file used to draw all
 * twenty-four of them as inline SVG; it does not any more, and there is no
 * second path that still does — one asset system, not two.
 *
 * What has not changed is the contract. `render(id, size, label)` still hands
 * back one element sized to `size` with the class `portrait`, so every screen
 * that shows a face carries on working without knowing any of this happened.
 *
 * A missing file is a fallback, never a crash and never a broken-image icon:
 * the element is built as a labelled placeholder and the image is laid over it
 * only once the browser confirms it loaded. Nothing here assumes the pictures
 * are present, because during development they will not always be.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.portrait = (function () {
  'use strict';

  var el = CMP.ui.dom.el;

  /** Every face, in a fixed order. A stored choice is an id from this list. */
  function ids() {
    return (CMP.AVATARS || []).slice();
  }

  /**
   * The first two letters of a name, for the placeholder.
   *
   * A blank circle where a face should be tells somebody nothing; initials at
   * least say which candidate is missing their picture.
   */
  function initials(label) {
    var text = String(label || '').trim();
    if (!text) return '';
    var words = text.split(/\s+/);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  }

  /**
   * One portrait, at a given size.
   *
   * The wrapper is the thing with the size and the class, and the image sits
   * inside it. That way a file that never arrives leaves a correctly-sized
   * labelled circle in the layout rather than a hole, and every screen keeps
   * the shape it had.
   */
  function render(id, size, label) {
    var px = Number(size) || 48;
    var src = CMP.assetUrl ? CMP.assetUrl('portraits', id) : null;

    var root = el('span', {
      class: 'portrait',
      style: { width: px + 'px', height: px + 'px' },
      role: 'img',
      'aria-label': label
        ? 'Portrait of ' + label
        : 'Portrait of a candidate',
      dataset: { avatar: String(id === null || id === undefined ? '' : id) },
    }, [
      el('span', {
        class: 'portrait-fallback',
        'aria-hidden': 'true',
        // Sized here rather than in the stylesheet: `em` in a rule would be
        // the inherited font size, not this circle's, so the initials came
        // out the same tiny size in a 64px card as in a 28px row.
        style: { fontSize: Math.max(9, Math.round(px * 0.34)) + 'px' },
        // A person's initials where there is a person, and the id where there
        // is not — which is the picker, where "C1" for both candidate 11 and
        // candidate 21 told nobody which slot was missing its picture.
        text: initials(label) || String(id === null || id === undefined ? '?' : id),
      }),
    ]);

    if (!src) return root;

    /*
     * Only shown once it has actually loaded.
     *
     * An <img> that 404s draws the browser's own broken-image glyph, which is
     * worse than the placeholder underneath it. So the image starts hidden and
     * the load event is what reveals it.
     */
    var img = el('img', {
      class: 'portrait-img',
      src: src,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      width: String(px),
      height: String(px),
    });
    img.addEventListener('load', function () {
      root.classList.add('has-image');
    });
    img.addEventListener('error', function () {
      root.classList.add('no-image');
      if (img.parentNode) img.parentNode.removeChild(img);
    });
    root.appendChild(img);

    return root;
  }

  /**
   * What a face is, now that it is a file rather than a construction.
   *
   * Kept because the tests use it to check that two ids really are two
   * different pictures.
   */
  function describe(id) {
    return { id: String(id), src: CMP.assetUrl ? CMP.assetUrl('portraits', id) : null };
  }

  return {
    render: render,
    ids: ids,
    describe: describe,
    get count() {
      return (CMP.AVATARS || []).length;
    },
  };
})();
