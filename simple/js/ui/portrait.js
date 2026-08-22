/**
 * Faces.
 * ------------------------------------------------------------------
 * Twenty-four candidates, each one drawn here rather than assembled from a
 * seed. That is a deliberate change from what this file used to do: a
 * generator gives you unlimited faces and no good ones, because nobody ever
 * looks at any single result and decides it is right. These were drawn one at
 * a time and looked at.
 *
 * They are invented people. Not one is drawn from a photograph, a real
 * candidate or a real officeholder, and the set exists precisely so that the
 * game never needs a photograph of anybody. What they are meant to look like
 * is a cast: a range of ages, of dress, of bearing, the sort of people who
 * would plausibly be standing for something in Punjab — turbaned and
 * bare-headed, in a dupatta and in a jacket, thirty and seventy.
 *
 * Every one is drawn on the same 100-unit square with the same construction —
 * shoulders, neck, head, hair, features — so a grid of them reads as one cast
 * and not as twenty-four separate drawings. What varies between them is the
 * numbers, which is what makes them a set.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.portrait = (function () {
  'use strict';

  var svg = CMP.ui.dom.svg;

  /* ---------------------------------------------------------- materials */

  // Skin, hair and cloth, kept as small named ranges rather than free colour,
  // so that a new face cannot land outside the palette the rest sit in.
  var SKIN = {
    light: { base: '#E8C39E', shade: '#D2A87F', line: '#8A6B4C' },
    warm: { base: '#DDAE81', shade: '#C4926A', line: '#7C5B3E' },
    mid: { base: '#C68C5F', shade: '#AB744C', line: '#68452B' },
    deep: { base: '#A9714A', shade: '#8D5B3A', line: '#553320' },
    rich: { base: '#8A5836', shade: '#6F452A', line: '#3F2416' },
  };

  var HAIR = {
    black: '#1E1A18',
    dark: '#2E2521',
    brown: '#4A362A',
    grey: '#7E7873',
    silver: '#B9B4AE',
    white: '#D9D5D0',
  };

  /* ------------------------------------------------------------ the cast */

  /*
   * One entry per candidate.
   *
   * head    face width and jaw: wide/oval/narrow, and how square the jaw is
   * skin    a key into SKIN
   * hair    style + colour. 'turban' takes a cloth colour of its own.
   * brow    thickness and angle, which does most of the work of an expression
   * beard   none | stubble | short | full | flowing | moustache
   * eyes    how open, and whether there are lines at the corners
   * age     0 young, 1 middle, 2 older — drives lines, not colour
   * dress   kurta | jacket | shawl | dupatta | waistcoat
   * cloth   the garment colour
   */
  var CAST = [
    { id: 'a1', head: [1.00, 0.55], skin: 'warm', hair: { style: 'turban', colour: '#D8562F' },
      brow: [3.2, -2], beard: 'full', beardColour: 'black', eyes: [1.0, 0], age: 1,
      dress: 'kurta', cloth: '#2C3A52' },

    { id: 'a2', head: [0.94, 0.35], skin: 'light', hair: { style: 'bun', colour: 'black' },
      brow: [2.4, -1], beard: 'none', eyes: [1.05, 0], age: 0,
      dress: 'dupatta', cloth: '#B24A6B' },

    { id: 'a3', head: [1.03, 0.7], skin: 'mid', hair: { style: 'turban', colour: '#2F6DA8' },
      brow: [3.6, 1], beard: 'flowing', beardColour: 'grey', eyes: [0.9, 1], age: 2,
      dress: 'shawl', cloth: '#6B6154' },

    { id: 'a4', head: [0.96, 0.45], skin: 'deep', hair: { style: 'short', colour: 'black' },
      brow: [3.0, -1], beard: 'stubble', beardColour: 'black', eyes: [1.0, 0], age: 0,
      dress: 'jacket', cloth: '#243447' },

    { id: 'a5', head: [0.92, 0.3], skin: 'warm', hair: { style: 'long', colour: 'dark' },
      brow: [2.2, 0], beard: 'none', eyes: [1.05, 0], age: 1,
      dress: 'dupatta', cloth: '#3E7A63' },

    { id: 'a6', head: [1.05, 0.65], skin: 'light', hair: { style: 'turban', colour: '#E0B227' },
      brow: [3.4, 0], beard: 'full', beardColour: 'dark', eyes: [0.95, 0], age: 1,
      dress: 'waistcoat', cloth: '#3B3F4C' },

    { id: 'a7', head: [0.90, 0.4], skin: 'rich', hair: { style: 'bun', colour: 'black' },
      brow: [2.6, -2], beard: 'none', eyes: [1.0, 0], age: 1,
      dress: 'jacket', cloth: '#5B3A6E' },

    { id: 'a8', head: [1.02, 0.6], skin: 'mid', hair: { style: 'receding', colour: 'grey' },
      brow: [3.0, 1], beard: 'moustache', beardColour: 'grey', eyes: [0.9, 1], age: 2,
      dress: 'kurta', cloth: '#8C8272' },

    { id: 'a9', head: [0.98, 0.5], skin: 'warm', hair: { style: 'turban', colour: '#3E7A63' },
      brow: [3.2, -1], beard: 'short', beardColour: 'black', eyes: [1.0, 0], age: 0,
      dress: 'kurta', cloth: '#C9C2B4' },

    { id: 'a10', head: [0.93, 0.35], skin: 'light', hair: { style: 'short', colour: 'brown' },
      brow: [2.4, 0], beard: 'none', eyes: [1.05, 0], age: 0,
      dress: 'jacket', cloth: '#2E5F86' },

    { id: 'a11', head: [1.06, 0.72], skin: 'deep', hair: { style: 'turban', colour: '#7A4E9E' },
      brow: [3.6, 2], beard: 'flowing', beardColour: 'silver', eyes: [0.85, 1], age: 2,
      dress: 'shawl', cloth: '#4A4238' },

    { id: 'a12', head: [0.91, 0.32], skin: 'mid', hair: { style: 'long', colour: 'black' },
      brow: [2.5, -1], beard: 'none', eyes: [1.0, 0], age: 0,
      dress: 'dupatta', cloth: '#C4763A' },

    { id: 'a13', head: [1.00, 0.58], skin: 'light', hair: { style: 'swept', colour: 'dark' },
      brow: [3.0, -2], beard: 'stubble', beardColour: 'dark', eyes: [1.0, 0], age: 1,
      dress: 'waistcoat', cloth: '#2F4038' },

    { id: 'a14', head: [0.95, 0.42], skin: 'rich', hair: { style: 'turban', colour: '#B9B4AE' },
      brow: [3.2, 0], beard: 'full', beardColour: 'white', eyes: [0.88, 1], age: 2,
      dress: 'kurta', cloth: '#D6CFC0' },

    { id: 'a15', head: [0.92, 0.36], skin: 'warm', hair: { style: 'bun', colour: 'grey' },
      brow: [2.4, 1], beard: 'none', eyes: [0.92, 1], age: 2,
      dress: 'shawl', cloth: '#7C6E8C' },

    { id: 'a16', head: [1.04, 0.68], skin: 'mid', hair: { style: 'short', colour: 'black' },
      brow: [3.4, -2], beard: 'short', beardColour: 'black', eyes: [1.0, 0], age: 1,
      dress: 'jacket', cloth: '#1F3B52' },

    { id: 'a17', head: [0.97, 0.48], skin: 'light', hair: { style: 'turban', colour: '#2B7C8C' },
      brow: [3.0, 0], beard: 'moustache', beardColour: 'dark', eyes: [1.0, 0], age: 1,
      dress: 'kurta', cloth: '#B4A88E' },

    { id: 'a18', head: [0.90, 0.3], skin: 'deep', hair: { style: 'long', colour: 'dark' },
      brow: [2.6, -1], beard: 'none', eyes: [1.05, 0], age: 1,
      dress: 'dupatta', cloth: '#2F6F5E' },

    { id: 'a19', head: [1.01, 0.62], skin: 'warm', hair: { style: 'receding', colour: 'silver' },
      brow: [3.2, 2], beard: 'full', beardColour: 'silver', eyes: [0.85, 1], age: 2,
      dress: 'waistcoat', cloth: '#544C42' },

    { id: 'a20', head: [0.94, 0.38], skin: 'rich', hair: { style: 'short', colour: 'black' },
      brow: [2.8, -1], beard: 'stubble', beardColour: 'black', eyes: [1.0, 0], age: 0,
      dress: 'kurta', cloth: '#A8452F' },

    { id: 'a21', head: [0.99, 0.54], skin: 'mid', hair: { style: 'turban', colour: '#C9A227' },
      brow: [3.4, -1], beard: 'flowing', beardColour: 'black', eyes: [0.95, 0], age: 1,
      dress: 'shawl', cloth: '#3A4A5C' },

    { id: 'a22', head: [0.91, 0.34], skin: 'light', hair: { style: 'bun', colour: 'brown' },
      brow: [2.4, 0], beard: 'none', eyes: [1.05, 0], age: 1,
      dress: 'jacket', cloth: '#8C4A6E' },

    { id: 'a23', head: [1.03, 0.66], skin: 'deep', hair: { style: 'swept', colour: 'grey' },
      brow: [3.2, 1], beard: 'moustache', beardColour: 'grey', eyes: [0.9, 1], age: 2,
      dress: 'jacket', cloth: '#33465E' },

    { id: 'a24', head: [0.96, 0.44], skin: 'warm', hair: { style: 'turban', colour: '#D9D5D0' },
      brow: [3.0, -1], beard: 'short', beardColour: 'dark', eyes: [1.0, 0], age: 0,
      dress: 'kurta', cloth: '#4A6E8C' },
  ];

  function faceFor(id) {
    for (var i = 0; i < CAST.length; i++) {
      if (CAST[i].id === id) return CAST[i];
    }
    return CAST[0];
  }

  /* ---------------------------------------------------------- the pencil */

  function p(tag, attrs) {
    return svg(tag, attrs);
  }

  function ellipse(cx, cy, rx, ry, fill, extra) {
    var a = { cx: String(cx), cy: String(cy), rx: String(rx), ry: String(ry), fill: fill };
    if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
    return p('ellipse', a);
  }

  function shape(d, fill, extra) {
    var a = { d: d, fill: fill || 'none' };
    if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
    return p('path', a);
  }

  function stroke(d, colour, width, extra) {
    return shape(d, 'none', Object.assign({
      stroke: colour,
      'stroke-width': String(width),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }, extra || {}));
  }

  /* ------------------------------------------------------------ the head */

  /**
   * Hair, which is where most of the difference between two faces lives.
   *
   * A turban is drawn as a wrapped volume with a visible fold and a front
   * knot, sitting on the brow rather than perched on top — a band across the
   * forehead reads as a hat, and this is not a hat.
   */
  function hairFor(f, w, skin) {
    var colour = HAIR[f.hair.colour] || f.hair.colour;
    var style = f.hair.style;

    if (style === 'turban') {
      var cloth = f.hair.colour && f.hair.colour.charAt(0) === '#'
        ? f.hair.colour
        : (HAIR[f.hair.colour] || '#D8562F');
      return [
        // The wrapped mass, wider than the head and coming down to the brow.
        shape('M' + (50 - 25 * w) + ' 42 C' + (50 - 27 * w) + ' 16 ' +
              (50 - 14 * w) + ' 8 50 8 C' + (50 + 14 * w) + ' 8 ' +
              (50 + 27 * w) + ' 16 ' + (50 + 25 * w) + ' 42 ' +
              'C' + (50 + 18 * w) + ' 34 ' + (50 - 18 * w) + ' 34 ' +
              (50 - 25 * w) + ' 42 Z', cloth),
        // Two folds, which is what makes it cloth rather than a dome.
        stroke('M' + (50 - 22 * w) + ' 33 C' + (50 - 10 * w) + ' 22 ' +
               (50 + 10 * w) + ' 22 ' + (50 + 22 * w) + ' 33',
               'rgba(0,0,0,0.22)', 1.6),
        stroke('M' + (50 - 20 * w) + ' 26 C' + (50 - 8 * w) + ' 16 ' +
               (50 + 8 * w) + ' 16 ' + (50 + 20 * w) + ' 26',
               'rgba(255,255,255,0.16)', 1.6),
        // The front knot.
        shape('M' + (50 - 4 * w) + ' 16 L50 9 L' + (50 + 4 * w) + ' 16 ' +
              'L50 20 Z', 'rgba(0,0,0,0.18)'),
      ];
    }

    if (style === 'bun') {
      return [
        // The bun itself, behind the crown.
        ellipse(50, 15, 10.5, 8.5, colour),
        // Hair over the crown and down past the ears, parted rather than
        // dropped over the brow — a cap that reaches the eyebrows reads as a
        // helmet, which is what this used to look like.
        shape('M' + (50 - 25 * w) + ' 38 C' + (50 - 27 * w) + ' 17 ' +
              (50 - 13 * w) + ' 11 50 11 C' + (50 + 13 * w) + ' 11 ' +
              (50 + 27 * w) + ' 17 ' + (50 + 25 * w) + ' 38 ' +
              'C' + (50 + 23 * w) + ' 30 ' + (50 + 17 * w) + ' 25 ' +
              (50 + 6 * w) + ' 24 C' + (50 + 2 * w) + ' 27 ' +
              (50 - 2 * w) + ' 27 ' + (50 - 6 * w) + ' 24 ' +
              'C' + (50 - 17 * w) + ' 25 ' + (50 - 23 * w) + ' 30 ' +
              (50 - 25 * w) + ' 38 Z', colour),
      ];
    }

    if (style === 'long') {
      return [
        shape('M' + (50 - 27 * w) + ' 68 C' + (50 - 31 * w) + ' 30 ' +
              (50 - 24 * w) + ' 12 50 12 C' + (50 + 24 * w) + ' 12 ' +
              (50 + 31 * w) + ' 30 ' + (50 + 27 * w) + ' 68 ' +
              'L' + (50 + 22 * w) + ' 68 C' + (50 + 24 * w) + ' 36 ' +
              (50 + 20 * w) + ' 28 50 28 C' + (50 - 20 * w) + ' 28 ' +
              (50 - 24 * w) + ' 36 ' + (50 - 22 * w) + ' 68 Z', colour),
      ];
    }

    if (style === 'receding') {
      return [
        shape('M' + (50 - 24 * w) + ' 34 C' + (50 - 25 * w) + ' 20 ' +
              (50 - 14 * w) + ' 17 ' + (50 - 8 * w) + ' 20 ' +
              'C' + (50 - 4 * w) + ' 18 ' + (50 + 4 * w) + ' 18 ' +
              (50 + 8 * w) + ' 20 C' + (50 + 14 * w) + ' 17 ' +
              (50 + 25 * w) + ' 20 ' + (50 + 24 * w) + ' 34 ' +
              'C' + (50 + 20 * w) + ' 26 ' + (50 + 12 * w) + ' 24 50 25 ' +
              'C' + (50 - 12 * w) + ' 24 ' + (50 - 20 * w) + ' 26 ' +
              (50 - 24 * w) + ' 34 Z', colour),
      ];
    }

    if (style === 'swept') {
      return [
        shape('M' + (50 - 26 * w) + ' 36 C' + (50 - 28 * w) + ' 14 ' +
              (50 - 6 * w) + ' 9 ' + (50 + 16 * w) + ' 14 ' +
              'C' + (50 + 26 * w) + ' 17 ' + (50 + 27 * w) + ' 27 ' +
              (50 + 25 * w) + ' 36 C' + (50 + 22 * w) + ' 24 ' +
              (50 + 6 * w) + ' 21 ' + (50 - 26 * w) + ' 36 Z', colour),
      ];
    }

    // short
    return [
      shape('M' + (50 - 25 * w) + ' 36 C' + (50 - 27 * w) + ' 14 ' +
            (50 - 14 * w) + ' 10 50 10 C' + (50 + 14 * w) + ' 10 ' +
            (50 + 27 * w) + ' 14 ' + (50 + 25 * w) + ' 36 ' +
            'C' + (50 + 20 * w) + ' 24 ' + (50 - 20 * w) + ' 24 ' +
            (50 - 25 * w) + ' 36 Z', colour),
    ];
  }

  /** Beards, which change a face more than anything except age. */
  function beardFor(f, w, skin) {
    if (f.beard === 'none') return [];
    var colour = HAIR[f.beardColour] || f.beardColour || HAIR.black;
    var jaw = 62 + f.head[1] * 6;

    if (f.beard === 'moustache') {
      return [shape('M' + (50 - 9 * w) + ' 58.6 C' + (50 - 4.5 * w) + ' 55.8 ' +
                    (50 + 4.5 * w) + ' 55.8 ' + (50 + 9 * w) + ' 58.6 ' +
                    'C' + (50 + 4.5 * w) + ' 60.6 ' + (50 - 4.5 * w) + ' 60.6 ' +
                    (50 - 9 * w) + ' 58.6 Z', colour)];
    }

    if (f.beard === 'stubble') {
      // A shadow along the jaw rather than a shape: stubble is not a beard,
      // and drawing it as one is what makes a face look like a sticker.
      return [
        shape('M' + (50 - 21 * w) + ' 51 C' + (50 - 21 * w) + ' ' + (jaw + 4) +
              ' ' + (50 - 11 * w) + ' ' + (jaw + 5) + ' 50 ' + (jaw + 5) +
              ' C' + (50 + 11 * w) + ' ' + (jaw + 5) + ' ' + (50 + 21 * w) +
              ' ' + (jaw + 4) + ' ' + (50 + 21 * w) + ' 51 Z',
              colour, { opacity: '0.22' }),
      ];
    }

    /*
     * The beard follows the jaw rather than filling the lower face.
     *
     * A block of colour from the cheekbones down reads as a mask, not as
     * hair — especially a grey one. So this is drawn as a band that hugs the
     * jawline, opens around the mouth, and comes to a point below the chin,
     * with the moustache as a separate stroke so the philtrum is still there.
     */
    var drop = f.beard === 'flowing' ? 17 : (f.beard === 'full' ? 9 : 5);
    var outer = 20 * w;
    var top = 52;

    return [
      // The jaw band: down one side, round the chin, back up the other, then
      // an inner edge that leaves the mouth and the philtrum clear.
      shape('M' + (50 - outer) + ' ' + top +
            ' C' + (50 - outer - 1) + ' ' + (jaw + 3) +
            ' ' + (50 - 11 * w) + ' ' + (jaw + drop) + ' 50 ' + (jaw + drop) +
            ' C' + (50 + 11 * w) + ' ' + (jaw + drop) +
            ' ' + (50 + outer + 1) + ' ' + (jaw + 3) +
            ' ' + (50 + outer) + ' ' + top +
            ' C' + (50 + 13 * w) + ' ' + (top + 3) +
            ' ' + (50 + 9 * w) + ' 64 50 64' +
            ' C' + (50 - 9 * w) + ' 64 ' + (50 - 13 * w) + ' ' + (top + 3) +
            ' ' + (50 - outer) + ' ' + top + ' Z', colour),

      // The moustache, above the mouth and clear of it.
      shape('M' + (50 - 8.5 * w) + ' 58.4 C' + (50 - 4 * w) + ' 55.6 ' +
            (50 + 4 * w) + ' 55.6 ' + (50 + 8.5 * w) + ' 58.4 ' +
            'C' + (50 + 4 * w) + ' 60.4 ' + (50 - 4 * w) + ' 60.4 ' +
            (50 - 8.5 * w) + ' 58.4 Z', colour),

      // One line where the beard meets the cheek, so it sits on the face
      // rather than floating in front of it. Drawn as a single stroke across:
      // two meeting in the middle left a notch under the mouth.
      stroke('M' + (50 - outer) + ' ' + top +
             ' C' + (50 - 13 * w) + ' ' + (top + 3) + ' ' + (50 - 9 * w) + ' 64 50 64' +
             ' C' + (50 + 9 * w) + ' 64 ' + (50 + 13 * w) + ' ' + (top + 3) +
             ' ' + (50 + outer) + ' ' + top, 'rgba(0,0,0,0.16)', 1),
    ];
  }

  /** Clothing, which is only ever the top of a shoulder — but it reads. */
  function dressFor(f) {
    var c = f.cloth;
    var dark = 'rgba(0,0,0,0.22)';

    if (f.dress === 'dupatta') {
      return [
        shape('M14 100 C16 84 30 76 50 76 C70 76 84 84 86 100 Z', c),
        shape('M34 78 C38 90 40 96 40 100 L28 100 C28 92 30 84 34 78 Z', dark),
        shape('M66 78 C62 90 60 96 60 100 L72 100 C72 92 70 84 66 78 Z', dark),
      ];
    }
    if (f.dress === 'jacket') {
      return [
        shape('M14 100 C16 84 30 76 50 76 C70 76 84 84 86 100 Z', c),
        shape('M50 76 L40 100 L34 100 L44 77 Z', 'rgba(255,255,255,0.14)'),
        shape('M50 76 L60 100 L66 100 L56 77 Z', 'rgba(255,255,255,0.14)'),
        shape('M44 77 L50 88 L56 77 C54 76 46 76 44 77 Z', '#EDE8DE'),
      ];
    }
    if (f.dress === 'waistcoat') {
      return [
        shape('M14 100 C16 84 30 76 50 76 C70 76 84 84 86 100 Z', '#EDE8DE'),
        shape('M50 76 C40 78 34 86 32 100 L14 100 C16 84 30 76 50 76 Z', c),
        shape('M50 76 C60 78 66 86 68 100 L86 100 C84 84 70 76 50 76 Z', c),
      ];
    }
    if (f.dress === 'shawl') {
      return [
        shape('M14 100 C16 84 30 76 50 76 C70 76 84 84 86 100 Z', c),
        shape('M14 100 C16 88 24 80 34 77 C30 84 28 92 28 100 Z', dark),
        shape('M86 100 C84 88 76 80 66 77 C70 84 72 92 72 100 Z', dark),
      ];
    }
    // kurta
    return [
      shape('M14 100 C16 84 30 76 50 76 C70 76 84 84 86 100 Z', c),
      stroke('M50 78 L50 100', 'rgba(0,0,0,0.18)', 1.4),
    ];
  }

  /* ------------------------------------------------------------ drawing */

  /**
   * One portrait, at a given size.
   *
   * `id` is one of the cast. Anything unrecognised draws the first, so a save
   * written before a face existed still shows a face.
   */
  function render(id, size, label) {
    var f = faceFor(id);
    var skin = SKIN[f.skin];
    var w = f.head[0];
    var jaw = f.head[1];
    var chin = 62 + jaw * 6;

    var eyeOpen = f.eyes[0];
    var lines = f.eyes[1];
    var browW = f.brow[0];
    var browTilt = f.brow[1];

    var parts = [];

    // Ground, so a portrait on any background is its own object.
    parts.push(p('circle', { cx: '50', cy: '50', r: '50', fill: 'var(--portrait-bg, #1A1D24)' }));

    // Shoulders first: everything else overlaps them.
    parts = parts.concat(dressFor(f));

    // Neck, with the shadow under the jaw that stops the head floating.
    parts.push(shape('M42 62 L42 80 C46 83 54 83 58 80 L58 62 Z', skin.shade));

    // The head.
    parts.push(shape(
      'M' + (50 - 26 * w) + ' 40 C' + (50 - 26 * w) + ' 22 ' +
      (50 - 15 * w) + ' 14 50 14 C' + (50 + 15 * w) + ' 14 ' +
      (50 + 26 * w) + ' 22 ' + (50 + 26 * w) + ' 40 ' +
      'C' + (50 + 26 * w) + ' 54 ' + (50 + 20 * w) + ' ' + chin + ' 50 ' + (chin + 4) +
      ' C' + (50 - 20 * w) + ' ' + chin + ' ' + (50 - 26 * w) + ' 54 ' +
      (50 - 26 * w) + ' 40 Z', skin.base));

    // A little modelling down one side, which is the whole difference between
    // a shape and a face.
    parts.push(shape(
      'M' + (50 + 26 * w) + ' 40 C' + (50 + 26 * w) + ' 54 ' +
      (50 + 20 * w) + ' ' + chin + ' 50 ' + (chin + 4) +
      ' C' + (50 + 12 * w) + ' ' + (chin - 4) + ' ' + (50 + 18 * w) + ' 50 ' +
      (50 + 18 * w) + ' 34 Z', skin.shade, { opacity: '0.55' }));

    // Ears.
    parts.push(ellipse(50 - 26 * w, 42, 3.2, 5.4, skin.shade));
    parts.push(ellipse(50 + 26 * w, 42, 3.2, 5.4, skin.shade));

    parts = parts.concat(hairFor(f, w, skin));

    // Brows.
    // Brows sit closer to the eye than a cartoon puts them, and thin toward
    // the nose, which is most of what makes an expression readable.
    var browColour = f.hair.colour && f.hair.colour.charAt(0) === '#'
      ? (HAIR[f.beardColour] || HAIR.dark)
      : (HAIR[f.hair.colour] || HAIR.black);
    [-1, 1].forEach(function (side) {
      parts.push(stroke(
        'M' + (50 + side * 15.5 * w) + ' ' + (42 + browTilt) +
        ' Q' + (50 + side * 10.5 * w) + ' ' + (39.2 + browTilt) + ' ' +
        (50 + side * 5.2 * w) + ' ' + (41.4 + browTilt),
        browColour, browW * 0.8));
    });

    // Eyes: a white, an iris, a lid line. The lid is what stops them staring.
    /*
     * Eyes, drawn small.
     *
     * The single thing that decides whether a face reads as a person or as an
     * emoji is how big the eyes are — a wide white oval with a dark disc in it
     * is a cartoon whatever else is around it. So these are almond-shaped,
     * roughly life-proportioned against the head, cut across the top by a lid
     * that actually overlaps the iris, and the white is a warm off-white
     * rather than paper.
     */
    [-1, 1].forEach(function (side) {
      var ex = 50 + side * 10.5 * w;
      var half = 4.1;
      var open = 2.3 * eyeOpen;

      // The eye opening: two arcs meeting at the corners, so it is an almond
      // rather than an oval.
      parts.push(shape(
        'M' + (ex - half) + ' 47 Q' + ex + ' ' + (47 - open - 0.6) + ' ' +
        (ex + half) + ' 47 Q' + ex + ' ' + (47 + open) + ' ' + (ex - half) + ' 47 Z',
        '#E8E2D6'));

      // Iris and pupil, sized to the opening and clipped by the lid above.
      parts.push(ellipse(ex, 47, 1.95, Math.min(1.95, open + 0.5), '#4A3020'));
      parts.push(ellipse(ex, 47, 0.95, Math.min(0.95, open), '#1A1210'));
      parts.push(ellipse(ex + 0.7, 46.3, 0.5, 0.5, '#FFFFFF', { opacity: '0.85' }));

      // The upper lid, which is what stops them staring.
      parts.push(stroke(
        'M' + (ex - half - 0.6) + ' 46.9 Q' + ex + ' ' + (47 - open - 1.5) + ' ' +
        (ex + half + 0.6) + ' 46.9', skin.line, 1.15));

      // A soft lower lid, no darker than the skin.
      parts.push(stroke(
        'M' + (ex - half + 0.4) + ' 48.4 Q' + ex + ' ' + (47 + open + 0.9) + ' ' +
        (ex + half - 0.4) + ' 48.4', skin.shade, 0.8, { opacity: '0.7' }));

      if (lines) {
        parts.push(stroke('M' + (ex + side * 5.2) + ' 45.6 L' +
          (ex + side * 7.6) + ' 44.2', skin.line, 0.8, { opacity: '0.45' }));
        parts.push(stroke('M' + (ex + side * 5.2) + ' 48.6 L' +
          (ex + side * 7.6) + ' 49.8', skin.line, 0.8, { opacity: '0.35' }));
      }
    });

    // Nose: two strokes, never an outline.
    // The nose is a shadow down one side and a soft base — never an outline,
    // which is the other thing that turns a face into a cartoon.
    parts.push(stroke('M' + (50 - 0.6 * w) + ' 49 L' + (50 - 2.4 * w) + ' 54.6',
      skin.line, 1.1, { opacity: '0.42' }));
    parts.push(stroke('M' + (50 - 2.4 * w) + ' 54.8 Q50 56.4 ' +
      (50 + 2.4 * w) + ' 54.8', skin.line, 1.1, { opacity: '0.6' }));

    parts = parts.concat(beardFor(f, w, skin));

    // Mouth, drawn last so a beard does not swallow it.
    // A closed mouth, drawn as a line with a little weight to it rather than
    // a smile. Nobody in this cast is grinning at the camera.
    parts.push(stroke('M' + (50 - 5.6 * w) + ' 61.6 Q50 63.4 ' +
      (50 + 5.6 * w) + ' 61.6', '#7E4238', 1.5));
    parts.push(stroke('M' + (50 - 4.2 * w) + ' 63.4 Q50 64.4 ' +
      (50 + 4.2 * w) + ' 63.4', skin.shade, 0.9, { opacity: '0.55' }));

    // Age, as lines rather than as colour.
    if (f.age === 2) {
      parts.push(stroke('M' + (50 - 14 * w) + ' 33 C' + (50 - 6 * w) + ' 31 ' +
        (50 + 6 * w) + ' 31 ' + (50 + 14 * w) + ' 33', skin.line, 1,
        { opacity: '0.4' }));
      parts.push(stroke('M' + (50 - 12 * w) + ' 57 C' + (50 - 9 * w) + ' 60 ' +
        (50 - 9 * w) + ' 62 ' + (50 - 10 * w) + ' 64', skin.line, 1,
        { opacity: '0.35' }));
      parts.push(stroke('M' + (50 + 12 * w) + ' 57 C' + (50 + 9 * w) + ' 60 ' +
        (50 + 9 * w) + ' 62 ' + (50 + 10 * w) + ' 64', skin.line, 1,
        { opacity: '0.35' }));
    }

    return svg('svg', {
      class: 'portrait',
      viewBox: '0 0 100 100',
      width: String(size || 48),
      height: String(size || 48),
      role: 'img',
      'aria-label': label
        ? 'Illustration of ' + label
        : 'Illustration of a fictional candidate',
    }, parts);
  }

  /** Every face, in a fixed order. A stored choice is an id from this list. */
  function ids() {
    return CAST.map(function (f) {
      return f.id;
    });
  }

  /**
   * What a face is made of. Only the tests use this — it is how they check
   * that two ids really do draw two different people.
   */
  function describe(id) {
    var f = faceFor(id);
    return {
      id: f.id,
      skin: f.skin,
      hair: f.hair.style,
      beard: f.beard,
      age: f.age,
      dress: f.dress,
    };
  }

  return { render: render, ids: ids, describe: describe, count: CAST.length };
})();
