/**
 * Party symbols.
 * ------------------------------------------------------------------
 * A symbol is an image file, loaded from `assets/party-symbols/` and keyed by
 * the id the lobby and the server have always validated against — `tree`,
 * `lamp`, `river`. This file used to draw all sixteen as inline SVG; it does
 * not any more, and nothing else does either.
 *
 * `render(id, size, label)` still hands back one element of the given size
 * with the class `sym`, so the picker, the lobby and the leaderboard carry on
 * unchanged.
 *
 * One real difference worth knowing: a drawn symbol took the party's colour
 * from `currentColor`, and an image cannot. Party colour still reaches the
 * screen everywhere it did — borders, badges, bars, the map — but the symbol
 * itself is now whatever colour its file is.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.symbol = (function () {
  'use strict';

  var el = CMP.ui.dom.el;

  function ids() {
    return (CMP.PARTY_SYMBOLS || []).map(function (s) {
      return s.id;
    });
  }

  /** The symbol's own name, for the placeholder and the label. */
  function nameOf(id) {
    var list = CMP.PARTY_SYMBOLS || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i].name;
    }
    return String(id || '');
  }

  /**
   * One symbol, at a given size.
   *
   * A file that never arrives leaves the symbol's name in its place, which is
   * still a way to tell two parties apart — and never the browser's
   * broken-image glyph.
   */
  function render(id, size, label) {
    var px = Number(size) || 24;
    var src = CMP.assetUrl ? CMP.assetUrl('symbols', id) : null;
    var name = nameOf(id);

    var attrs = {
      class: 'sym',
      style: { width: px + 'px', height: px + 'px' },
      dataset: { symbol: String(id === null || id === undefined ? '' : id) },
    };
    if (label) {
      attrs.role = 'img';
      attrs['aria-label'] = label;
    } else {
      // The symbol sits beside the party's name almost everywhere it appears,
      // and hearing "tree" after it helps nobody.
      attrs['aria-hidden'] = 'true';
    }

    var root = el('span', attrs, [
      el('span', {
        class: 'sym-fallback',
        'aria-hidden': 'true',
        style: { fontSize: Math.max(7, Math.round(px * 0.26)) + 'px' },
        text: name,
      }),
    ]);

    if (!src) return root;

    var img = el('img', {
      class: 'sym-img',
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

  return { render: render, ids: ids };
})();
