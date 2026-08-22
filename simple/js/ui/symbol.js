/**
 * Party symbols, drawn.
 * ------------------------------------------------------------------
 * Sixteen ordinary things — a tree, a lamp, a river — each drawn here as
 * geometry rather than loaded as a picture. Two reasons that matters: the page
 * ships nothing it did not draw, and no symbol here is or could drift into
 * being a real party's symbol, because there is nothing to drift from.
 *
 * Every one is drawn on the same 48-unit square, from the same weight of
 * stroke, so a row of them reads as one set rather than as clip art collected
 * from four places. They take the party's colour from `currentColor`.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.symbol = (function () {
  'use strict';

  var svg = CMP.ui.dom.svg;

  // One weight, one cap, one join — the whole set is drawn with this pen.
  function pen(extra) {
    var base = {
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2.6',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    };
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        base[k] = extra[k];
      });
    }
    return base;
  }

  function path(d, extra) {
    var attrs = pen(extra);
    attrs.d = d;
    return svg('path', attrs);
  }

  function line(x1, y1, x2, y2, extra) {
    var attrs = pen(extra);
    attrs.x1 = String(x1);
    attrs.y1 = String(y1);
    attrs.x2 = String(x2);
    attrs.y2 = String(y2);
    return svg('line', attrs);
  }

  function circle(cx, cy, r, extra) {
    var attrs = pen(extra);
    attrs.cx = String(cx);
    attrs.cy = String(cy);
    attrs.r = String(r);
    return svg('circle', attrs);
  }

  /* ------------------------------------------------------- the drawings */

  var DRAW = {
    star: function () {
      return [
        path('M24 6 L29.2 18.4 L42.6 19.6 L32.5 28.4 L35.5 41.5 L24 34.6 ' +
             'L12.5 41.5 L15.5 28.4 L5.4 19.6 L18.8 18.4 Z',
             { fill: 'currentColor', 'stroke-width': '2' }),
      ];
    },

    tree: function () {
      return [
        path('M24 8 C17 15 14 20 15 25 C16 29 20 30 24 30 C28 30 32 29 33 25 ' +
             'C34 20 31 15 24 8 Z'),
        path('M24 12 C20 18 18 22 19 26'),
        line(24, 30, 24, 42),
        path('M24 34 L18 30'),
        path('M24 37 L30 33'),
      ];
    },

    lion: function () {
      return [
        // The mane, as a ring of points rather than a circle.
        path('M24 5 L28 10 L34 8 L35 15 L42 17 L38 23 L42 29 L35 31 L34 38 ' +
             'L28 36 L24 42 L20 36 L14 38 L13 31 L6 29 L10 23 L6 17 L13 15 ' +
             'L14 8 L20 10 Z'),
        circle(24, 23, 8.5),
        circle(21, 21, 1.1, { fill: 'currentColor', stroke: 'none' }),
        circle(27, 21, 1.1, { fill: 'currentColor', stroke: 'none' }),
        path('M21.5 27 C23 28.5 25 28.5 26.5 27'),
      ];
    },

    sunrise: function () {
      return [
        path('M8 34 A16 16 0 0 1 40 34'),
        line(6, 40, 42, 40),
        line(24, 6, 24, 11),
        line(11, 12, 14.5, 15.5),
        line(37, 12, 33.5, 15.5),
        line(4, 25, 9, 25),
        line(44, 25, 39, 25),
      ];
    },

    mountain: function () {
      return [
        path('M4 38 L17 17 L24 27 L31 12 L44 38 Z'),
        path('M13.5 24.5 L20.5 24.5'),
        path('M27 20 L35 20'),
      ];
    },

    wheel: function () {
      var spokes = [];
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2;
        spokes.push(line(
          24 + Math.cos(a) * 5,
          24 + Math.sin(a) * 5,
          24 + Math.cos(a) * 16,
          24 + Math.sin(a) * 16
        ));
      }
      return [circle(24, 24, 17), circle(24, 24, 5)].concat(spokes);
    },

    book: function () {
      return [
        path('M24 13 C20 9.5 13 9 7 10.5 L7 37 C13 35.5 20 36 24 39.5'),
        path('M24 13 C28 9.5 35 9 41 10.5 L41 37 C35 35.5 28 36 24 39.5'),
        line(24, 13, 24, 39.5),
      ];
    },

    flower: function () {
      var petals = [];
      for (var i = 0; i < 6; i++) {
        var attrs = pen({ transform: 'rotate(' + ((i / 6) * 360) + ' 24 22)' });
        attrs.cx = '24';
        attrs.cy = '13.5';
        attrs.rx = '4.6';
        attrs.ry = '8';
        petals.push(svg('ellipse', attrs));
      }
      return petals.concat([circle(24, 22, 4), line(24, 26, 24, 42)]);
    },

    handshake: function () {
      return [
        path('M6 22 L14 18 L24 22 L34 18 L42 22'),
        path('M14 18 L18 27 C19 29 22 30 24 28.5'),
        path('M34 18 L30 27 C29 29 26 30 24 28.5'),
        path('M9 24 L9 32'),
        path('M39 24 L39 32'),
      ];
    },

    torch: function () {
      return [
        path('M24 5 C20 12 17.5 15.5 18.5 20 C19.2 23 21.4 24.5 24 24.5 ' +
             'C26.6 24.5 28.8 23 29.5 20 C30.5 15.5 28 12 24 5 Z'),
        path('M17 27.5 L31 27.5'),
        path('M19.5 27.5 L21.5 43'),
        path('M28.5 27.5 L26.5 43'),
      ];
    },

    crown: function () {
      return [
        path('M7 33 L10 14 L18 23 L24 10 L30 23 L38 14 L41 33 Z'),
        line(9, 39, 39, 39),
      ];
    },

    river: function () {
      return [
        path('M5 15 C13 10 19 20 27 15 C35 10 40 18 44 15'),
        path('M5 25 C13 20 19 30 27 25 C35 20 40 28 44 25'),
        path('M5 35 C13 30 19 40 27 35 C35 30 40 38 44 35'),
      ];
    },

    shield: function () {
      return [
        path('M24 5 L40 11 L40 24 C40 33 33 40 24 43.5 C15 40 8 33 8 24 ' +
             'L8 11 Z'),
        path('M24 15 L24 32'),
        path('M16 23.5 L32 23.5'),
      ];
    },

    wheat: function () {
      return [
        line(24, 44, 24, 20),
        path('M24 20 C20 20 18 17 18 14 C21 14 24 16 24 20 Z',
             { fill: 'currentColor', 'stroke-width': '1.8' }),
        path('M24 20 C28 20 30 17 30 14 C27 14 24 16 24 20 Z',
             { fill: 'currentColor', 'stroke-width': '1.8' }),
        path('M24 27 C20 27 18 24 18 21 C21 21 24 23 24 27 Z',
             { fill: 'currentColor', 'stroke-width': '1.8' }),
        path('M24 27 C28 27 30 24 30 21 C27 21 24 23 24 27 Z',
             { fill: 'currentColor', 'stroke-width': '1.8' }),
        path('M24 34 C20 34 18 31 18 28 C21 28 24 30 24 34 Z',
             { fill: 'currentColor', 'stroke-width': '1.8' }),
        path('M24 34 C28 34 30 31 30 28 C27 28 24 30 24 34 Z',
             { fill: 'currentColor', 'stroke-width': '1.8' }),
        path('M24 10 C22 12 22 15 24 17 C26 15 26 12 24 10 Z',
             { fill: 'currentColor', 'stroke-width': '1.8' }),
      ];
    },

    lamp: function () {
      return [
        path('M13 30 C13 22 18 17 24 17 C30 17 35 22 35 30 Z'),
        path('M9 30 L39 30'),
        line(24, 30, 24, 40),
        path('M18 43 L30 43'),
        path('M24 10 L24 14'),
        path('M14 13 L16.5 16'),
        path('M34 13 L31.5 16'),
      ];
    },

    bridge: function () {
      return [
        path('M4 30 C4 18 13 11 24 11 C35 11 44 18 44 30'),
        line(4, 38, 44, 38),
        line(13, 15.5, 13, 38),
        line(24, 11, 24, 38),
        line(35, 15.5, 35, 38),
      ];
    },
  };

  /* ------------------------------------------------------------ drawing */

  /**
   * One symbol, at a given size, in the colour of whatever it sits inside.
   *
   * Marked as decoration for a screen reader when it appears beside the name
   * it stands for, which is nearly everywhere — the party is already named in
   * text, and hearing "star" after it helps nobody.
   */
  function render(id, size, label) {
    var draw = DRAW[id] || DRAW.star;
    var attrs = {
      class: 'sym',
      viewBox: '0 0 48 48',
      width: String(size || 24),
      height: String(size || 24),
    };
    if (label) {
      attrs.role = 'img';
      attrs['aria-label'] = label;
    } else {
      attrs['aria-hidden'] = 'true';
    }
    return svg('svg', attrs, draw());
  }

  function ids() {
    return Object.keys(DRAW);
  }

  return { render: render, ids: ids };
})();
