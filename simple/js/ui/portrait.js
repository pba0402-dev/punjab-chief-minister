/**
 * Candidate portraits.
 * ------------------------------------------------------------------
 * Every candidate on the scoreboard has a face, so four players are told apart
 * at a glance rather than by reading four party codes.
 *
 * These are DRAWN, not photographed. Each portrait is a small piece of vector
 * illustration built from a seed: a face shape, a skin tone, a turban or hair,
 * a beard, sometimes glasses, sometimes the lines of an older face. That is a
 * deliberate choice rather than a shortcut. A photographic portrait of a
 * fictional candidate would sooner or later resemble somebody real, and this
 * game already puts real sitting MLAs on screen as reference — a drawn face
 * can never be mistaken for one of them, and nothing here is derived from any
 * real person's likeness.
 *
 * The seed is assigned once, when a player sits down, and stored with the
 * game. The same seed always draws the same face, so a candidate looks the
 * same in round one, in round fifteen, and after a disconnection and a rejoin.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.portrait = (function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* Warm, muted tones. Deliberately a range, so four candidates in a row do
     not look like the same person in four hats. */
  var SKIN = [
    { base: '#e8b98d', shade: '#cf9d70', line: '#a97a52' },
    { base: '#d9a274', shade: '#bd8659', line: '#96653f' },
    { base: '#c68a5c', shade: '#a97046', line: '#83522f' },
    { base: '#a9714a', shade: '#8c5936', line: '#6b4025' },
    { base: '#f0cba6', shade: '#d9b088', line: '#b08a63' },
  ];

  var TURBAN = [
    { base: '#2f6fb5', shade: '#245691' },
    { base: '#c8552f', shade: '#a44124' },
    { base: '#e0e3e8', shade: '#c1c6ce' },
    { base: '#3f8a5c', shade: '#2f6b46' },
    { base: '#8b4a8f', shade: '#6f3a72' },
    { base: '#d8a72c', shade: '#b3881f' },
    { base: '#3a3f4a', shade: '#2a2e37' },
    { base: '#b8332f', shade: '#932623' },
  ];

  var HAIR = [
    { base: '#241c15', shade: '#171009' },
    { base: '#3b2f24', shade: '#2a2018' },
    { base: '#6b6259', shade: '#544c44' },
    { base: '#9a948c', shade: '#7d766e' },
    { base: '#cfcac3', shade: '#aca69f' },
  ];

  var KURTA = [
    { base: '#f2efe8', shade: '#d9d5cc' },
    { base: '#dfe6ee', shade: '#c3ccd6' },
    { base: '#e6ded2', shade: '#cbc2b4' },
    { base: '#d5dcd6', shade: '#b9c1ba' },
    { base: '#efe2dd', shade: '#d3c4be' },
  ];

  /**
   * A tiny deterministic stream. Not the game's RNG: portraits never touch
   * gameplay, and keeping them off that stream means adding a face can never
   * shift a single campaign roll.
   */
  function stream(seed) {
    var h = 2166136261;
    var text = String(seed == null ? '' : seed);
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return function () {
      h += 0x6d2b79f5;
      var t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** The features one seed describes. Pure data — useful for testing. */
  function describe(seed) {
    var next = stream(seed);
    var pick = function (list) {
      return list[Math.floor(next() * list.length) % list.length];
    };

    var wearsTurban = next() < 0.55;
    var age = 0.3 + next() * 0.6; // 0 young, 1 old

    return {
      skin: pick(SKIN),
      turban: wearsTurban ? pick(TURBAN) : null,
      hair: wearsTurban ? null : pick(HAIR),
      beard: wearsTurban
        ? (next() < 0.75 ? 'full' : 'short')
        : ['none', 'stubble', 'short', 'full'][Math.floor(next() * 4) % 4],
      moustache: next() < 0.8,
      glasses: next() < 0.35 ? (next() < 0.5 ? 'round' : 'square') : null,
      kurta: pick(KURTA),
      jaw: 0.85 + next() * 0.3,
      age: age,
      greying: age > 0.65,
      brow: next() < 0.5,
    };
  }

  function node(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      el.setAttribute(k, attrs[k]);
    });
    return el;
  }

  /**
   * Draw one portrait. `size` is the pixel width; the drawing is square.
   * Head and shoulders, centred, on a plain ground — the composition of an
   * official candidate photograph, without being one.
   */
  function render(seed, size, label) {
    var f = describe(seed);
    var svg = node('svg', {
      viewBox: '0 0 100 100',
      width: size || 48,
      height: size || 48,
      class: 'portrait',
      role: 'img',
      'aria-label': label ? 'Illustration of ' + label : 'Candidate illustration',
    });

    var id = 'pt' + Math.abs(Math.floor(stream(seed)() * 1e9)).toString(36);

    var defs = node('defs', {});
    var clip = node('clipPath', { id: id + 'c' });
    clip.appendChild(node('circle', { cx: 50, cy: 50, r: 50 }));
    defs.appendChild(clip);

    var grad = node('linearGradient', { id: id + 'g', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(node('stop', { offset: '0', 'stop-color': '#3a3630' }));
    grad.appendChild(node('stop', { offset: '1', 'stop-color': '#221f1a' }));
    defs.appendChild(grad);
    svg.appendChild(defs);

    var g = node('g', { 'clip-path': 'url(#' + id + 'c)' });
    svg.appendChild(g);

    // Ground
    g.appendChild(node('rect', { x: 0, y: 0, width: 100, height: 100, fill: 'url(#' + id + 'g)' }));

    // Shoulders and kurta
    g.appendChild(node('path', {
      d: 'M50 66 C26 66 12 80 8 100 L92 100 C88 80 74 66 50 66 Z',
      fill: f.kurta.base,
    }));
    g.appendChild(node('path', {
      d: 'M50 68 L42 100 L58 100 Z',
      fill: f.kurta.shade,
    }));
    // Collar
    g.appendChild(node('path', {
      d: 'M42 68 L50 80 L58 68 L54 66 L50 74 L46 66 Z',
      fill: f.kurta.shade,
    }));

    // Neck
    g.appendChild(node('path', { d: 'M42 56 L42 70 Q50 76 58 70 L58 56 Z', fill: f.skin.shade }));

    // Ears
    g.appendChild(node('ellipse', { cx: 27, cy: 46, rx: 4, ry: 6, fill: f.skin.shade }));
    g.appendChild(node('ellipse', { cx: 73, cy: 46, rx: 4, ry: 6, fill: f.skin.shade }));

    // Head
    var jawW = 23 * f.jaw;
    g.appendChild(node('path', {
      d: 'M50 18 C' + (50 + jawW) + ' 18 ' + (50 + jawW) + ' 34 ' + (50 + jawW) + ' 42' +
        ' C' + (50 + jawW) + ' 58 ' + (50 + jawW * 0.6) + ' 66 50 66' +
        ' C' + (50 - jawW * 0.6) + ' 66 ' + (50 - jawW) + ' 58 ' + (50 - jawW) + ' 42' +
        ' C' + (50 - jawW) + ' 34 ' + (50 - jawW) + ' 18 50 18 Z',
      fill: f.skin.base,
    }));

    // Brow shadow
    g.appendChild(node('path', {
      d: 'M32 38 Q50 32 68 38 L68 41 Q50 36 32 41 Z',
      fill: f.skin.shade,
      opacity: '0.35',
    }));

    // Eyes
    [39, 61].forEach(function (x) {
      g.appendChild(node('ellipse', { cx: x, cy: 44, rx: 4.4, ry: 2.6, fill: '#f6f2ea' }));
      g.appendChild(node('circle', { cx: x, cy: 44, r: 1.9, fill: '#2b1f14' }));
      g.appendChild(node('circle', { cx: x + 0.6, cy: 43.3, r: 0.6, fill: '#ffffff', opacity: '0.8' }));
    });

    // Eyebrows
    var browY = f.brow ? 38 : 39;
    var browColour = f.greying ? '#8d867d' : (f.hair ? f.hair.base : '#2a2119');
    g.appendChild(node('path', {
      d: 'M33 ' + browY + ' Q39 ' + (browY - 2.6) + ' 44.5 ' + browY,
      stroke: browColour, 'stroke-width': 2.2, fill: 'none', 'stroke-linecap': 'round',
    }));
    g.appendChild(node('path', {
      d: 'M55.5 ' + browY + ' Q61 ' + (browY - 2.6) + ' 67 ' + browY,
      stroke: browColour, 'stroke-width': 2.2, fill: 'none', 'stroke-linecap': 'round',
    }));

    // Nose
    g.appendChild(node('path', {
      d: 'M50 46 L47 54 Q50 56 53 54 Z',
      fill: f.skin.shade, opacity: '0.75',
    }));

    // Age lines
    if (f.age > 0.6) {
      g.appendChild(node('path', {
        d: 'M35 52 Q39 55 43 53', stroke: f.skin.line, 'stroke-width': 0.8,
        fill: 'none', opacity: '0.5',
      }));
      g.appendChild(node('path', {
        d: 'M57 53 Q61 55 65 52', stroke: f.skin.line, 'stroke-width': 0.8,
        fill: 'none', opacity: '0.5',
      }));
    }

    // Mouth
    g.appendChild(node('path', {
      d: 'M44 59 Q50 62 56 59',
      stroke: f.skin.line, 'stroke-width': 1.4, fill: 'none', 'stroke-linecap': 'round',
    }));

    var facial = f.greying
      ? { base: '#b8b2aa', shade: '#9a938b' }
      : (f.hair || { base: '#241c15', shade: '#171009' });

    // Beard
    if (f.beard === 'stubble') {
      g.appendChild(node('path', {
        d: 'M31 48 Q34 66 50 68 Q66 66 69 48 Q64 62 50 63 Q36 62 31 48 Z',
        fill: facial.base, opacity: '0.28',
      }));
    } else if (f.beard === 'short') {
      g.appendChild(node('path', {
        d: 'M31 46 Q33 66 50 69 Q67 66 69 46 Q65 60 50 61 Q35 60 31 46 Z',
        fill: facial.base,
      }));
    } else if (f.beard === 'full') {
      g.appendChild(node('path', {
        d: 'M30 42 Q30 70 50 76 Q70 70 70 42 Q66 62 50 63 Q34 62 30 42 Z',
        fill: facial.base,
      }));
      g.appendChild(node('path', {
        d: 'M40 66 Q50 72 60 66 Q50 70 40 66 Z',
        fill: facial.shade,
      }));
    }

    // Moustache
    if (f.moustache) {
      g.appendChild(node('path', {
        d: 'M42 56.5 Q50 54.5 58 56.5 Q50 59.5 42 56.5 Z',
        fill: facial.base,
      }));
    }

    // Turban or hair
    if (f.turban) {
      // A dastaar sits tall and comes forward to a point above the brow,
      // built from layered wraps rather than a single smooth cap.
      g.appendChild(node('path', {
        d: 'M23 39 Q21 14 39 7 Q52 3 64 9 Q78 16 77 39' +
           ' Q70 31 50 30 Q30 31 23 39 Z',
        fill: f.turban.base,
      }));

      // The wraps, angled the way the cloth is actually wound.
      g.appendChild(node('path', {
        d: 'M23 33 Q34 16 52 11 Q36 20 27 38 Z',
        fill: f.turban.shade, opacity: '0.55',
      }));
      g.appendChild(node('path', {
        d: 'M30 15 Q48 6 63 11', stroke: f.turban.shade, 'stroke-width': 1.6,
        fill: 'none', opacity: '0.8', 'stroke-linecap': 'round',
      }));
      g.appendChild(node('path', {
        d: 'M25 24 Q44 12 68 17', stroke: f.turban.shade, 'stroke-width': 1.6,
        fill: 'none', opacity: '0.75', 'stroke-linecap': 'round',
      }));
      g.appendChild(node('path', {
        d: 'M23 32 Q45 20 74 28', stroke: f.turban.shade, 'stroke-width': 1.6,
        fill: 'none', opacity: '0.7', 'stroke-linecap': 'round',
      }));

      // The front point, slightly off centre as it is when tied.
      g.appendChild(node('path', {
        d: 'M44 26 L49 11 L55 25 Q50 28 44 26 Z',
        fill: f.turban.shade, opacity: '0.9',
      }));

      // The band along the brow.
      g.appendChild(node('path', {
        d: 'M23 37 Q50 28 77 37 Q50 33 23 37 Z',
        fill: f.turban.shade,
      }));
    } else {
      var receding = f.age > 0.7;
      g.appendChild(node('path', {
        d: receding
          ? 'M29 38 Q31 22 50 21 Q69 22 71 38 Q68 28 50 27 Q32 28 29 38 Z'
          : 'M28 40 Q28 18 50 18 Q72 18 72 40 Q68 26 50 25 Q32 26 28 40 Z',
        fill: f.hair.base,
      }));
      g.appendChild(node('path', {
        d: 'M32 30 Q42 22 56 23 Q42 26 33 36 Z',
        fill: f.hair.shade, opacity: '0.6',
      }));
    }

    // Glasses
    if (f.glasses) {
      var rx = f.glasses === 'round' ? 6.5 : 7;
      var ry = f.glasses === 'round' ? 6.5 : 5;
      var stroke = { stroke: '#2f2a24', 'stroke-width': 1.4, fill: 'none' };
      [39, 61].forEach(function (x) {
        var lens = node(f.glasses === 'round' ? 'circle' : 'rect',
          f.glasses === 'round'
            ? { cx: x, cy: 44, r: rx }
            : { x: x - rx, y: 44 - ry, width: rx * 2, height: ry * 2, rx: 1.6 });
        Object.keys(stroke).forEach(function (k) {
          lens.setAttribute(k, stroke[k]);
        });
        g.appendChild(lens);
      });
      g.appendChild(node('path', {
        d: 'M46 44 L54 44', stroke: '#2f2a24', 'stroke-width': 1.2,
      }));
    }

    // A soft vignette, so the faces sit together as a set.
    g.appendChild(node('rect', {
      x: 0, y: 0, width: 100, height: 100,
      fill: 'none', stroke: 'rgba(0,0,0,0.35)', 'stroke-width': 6,
    }));

    return svg;
  }

  return { render: render, describe: describe };
})();
