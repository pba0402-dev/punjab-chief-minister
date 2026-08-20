/**
 * The constituency map.
 * ------------------------------------------------------------------
 * All 117 seats, each coloured by whoever currently leads it in the game.
 * Click a seat to target it; the colours move as players campaign.
 *
 * Two views of the same data:
 *   map   — cells over the real outline of Punjab. Positions and adjacency are
 *           real; the cell shapes are approximate, and the map says so.
 *   tiles — one equal tile per seat. Makes no geographic claim at all, and a
 *           marginal in an Amritsar ward is as easy to hit as a huge rural seat.
 *
 * Colour shows the leader; strength of colour shows how safe the lead is, so a
 * washed-out seat reads as still winnable.
 */
window.CMP = window.CMP || {};
CMP.ui = CMP.ui || {};

CMP.ui.map = (function () {
  'use strict';

  var el = CMP.ui.dom.el;
  var mount = CMP.ui.dom.mount;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /** Faded means uncertain: a toss-up should not look decided. */
  var BAND_OPACITY = { safe: 1, likely: 0.82, lean: 0.62, tossup: 0.38 };

  function svgEl(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'dataset') {
          Object.keys(v).forEach(function (d) {
            node.dataset[d] = v[d];
          });
        } else if (k === 'text') {
          node.textContent = v;
        } else {
          node.setAttribute(k, v);
        }
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function create(opts) {
    var geo = CMP.GEOMETRY;
    var game = null;
    var mode = 'map'; // map | tiles
    var selected = null;
    var view = { x: 0, y: 0, k: 1 };
    var cellNodes = {};

    var cellLayer = svgEl('g');
    var borderLayer = svgEl('g');
    var highlightLayer = svgEl('g');
    var labelLayer = svgEl('g', { class: 'map-labels' });
    var outlinePath = svgEl('path', { class: 'map-outline', d: pathOf(geo.outline, true) });

    var zoomGroup = svgEl('g', {}, [outlinePath, cellLayer, borderLayer, highlightLayer, labelLayer]);
    var svg = svgEl(
      'svg',
      {
        class: 'punjab-map',
        viewBox: '0 0 ' + geo.viewBox.width + ' ' + geo.viewBox.height,
        preserveAspectRatio: 'xMidYMid meet',
        role: 'application',
        'aria-label': 'Map of the 117 Punjab assembly constituencies',
      },
      [zoomGroup]
    );

    var readout = el('div', { class: 'map-readout' });
    var legend = el('div', { class: 'map-legend' });

    var modeToggle = el('div', { class: 'term-options map-modes' }, [
      modeButton('map', 'Map'),
      modeButton('tiles', 'Tiles'),
    ]);

    var zoomControls = el('div', { class: 'map-zoom' }, [
      zoomButton('+', function () {
        zoomBy(1.4);
      }),
      zoomButton('−', function () {
        zoomBy(1 / 1.4);
      }),
      zoomButton('⤢', reset),
    ]);

    var root = el('div', { class: 'map-block' }, [
      el('div', { class: 'map-toolbar' }, [modeToggle, zoomControls]),
      el('div', { class: 'map-frame' }, [svg]),
      readout,
      legend,
      el('p', {
        class: 'map-note',
        text:
          'Positions and neighbours are real; cell shapes are approximate and ' +
          'are not official constituency boundaries. Tiles view makes no ' +
          'geographic claim at all.',
      }),
    ]);

    function modeButton(id, label) {
      return el('button', {
        class: 'term-option' + (mode === id ? ' is-selected' : ''),
        type: 'button',
        text: label,
        dataset: { mode: id },
        onclick: function () {
          setMode(id);
        },
      });
    }

    function zoomButton(label, fn) {
      return el('button', { class: 'map-zoom-btn', type: 'button', text: label, onclick: fn });
    }

    /* ------------------------------------------------------ geometry */

    function pathOf(points, close) {
      var d = '';
      for (var i = 0; i < points.length; i++) {
        d += (i === 0 ? 'M' : 'L') + points[i][0] + ' ' + points[i][1];
      }
      return d + (close ? 'Z' : '');
    }

    function seatGeo(num) {
      for (var i = 0; i < geo.seats.length; i++) {
        if (geo.seats[i].num === num) return geo.seats[i];
      }
      return null;
    }

    function shapeOf(num) {
      var g = seatGeo(num);
      if (!g) return [];
      if (mode === 'tiles') {
        return geo.hexPoints.map(function (p) {
          return [g.hex[0] + p[0], g.hex[1] + p[1]];
        });
      }
      return g.cell;
    }

    function anchorOf(num) {
      var g = seatGeo(num);
      return mode === 'tiles' ? g.hex : g.centroid;
    }

    /* ------------------------------------------------------ building */

    function build() {
      cellNodes = {};
      mount(cellLayer, []);
      mount(borderLayer, []);
      mount(labelLayer, []);

      CMP.CONSTITUENCIES.forEach(function (c) {
        var node = svgEl('path', {
          class: 'map-cell',
          d: pathOf(shapeOf(c.number), true),
          dataset: { seat: c.number },
        });
        node.addEventListener('click', function () {
          select(c.number, true);
        });
        node.addEventListener('mouseenter', function () {
          showReadout(c.number);
        });
        cellNodes[c.number] = node;
        cellLayer.appendChild(node);
      });

      Object.keys(geo.districts).forEach(function (name) {
        var d = geo.districts[name];
        (mode === 'tiles' ? d.hexBorder : d.border).forEach(function (line) {
          borderLayer.appendChild(svgEl('path', { class: 'map-district-line', d: pathOf(line, false) }));
        });
      });

      CMP.CONSTITUENCIES.forEach(function (c) {
        var a = anchorOf(c.number);
        labelLayer.appendChild(
          svgEl('text', {
            class: 'map-seat-num',
            x: a[0],
            y: a[1],
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            text: c.number,
          })
        );
      });
    }

    /* ------------------------------------------------------ painting */

    function paint() {
      if (!game) return;

      CMP.CONSTITUENCIES.forEach(function (c) {
        var node = cellNodes[c.number];
        if (!node) return;
        var support = game.support[c.number];
        if (!support) return;

        var lead = CMP.ui.constituency.leaderOf(support);
        var party = CMP.getParty(lead.partyId);
        var band = CMP.campaign.ratingFor(lead.margin);

        node.setAttribute('fill', party.colour);
        node.setAttribute('fill-opacity', BAND_OPACITY[band.id]);
        node.classList.toggle('is-selected', selected === c.number);
      });

      mount(highlightLayer, []);
      if (selected !== null) {
        highlightLayer.appendChild(
          svgEl('path', { class: 'map-selection', d: pathOf(shapeOf(selected), true) })
        );
      }

      labelLayer.setAttribute('style', '--map-k:' + view.k);
      labelLayer.classList.toggle('show-nums', mode === 'tiles' || view.k >= 2.4);

      paintLegend();
      showReadout(selected);
    }

    function paintLegend() {
      var counts = {};
      CMP.CONSTITUENCIES.forEach(function (c) {
        var support = game.support[c.number];
        if (!support) return;
        var lead = CMP.ui.constituency.leaderOf(support);
        counts[lead.partyId] = (counts[lead.partyId] || 0) + 1;
      });

      mount(
        legend,
        CMP.PARTIES.map(function (p) {
          var n = counts[p.id] || 0;
          return el('span', { class: 'legend-item' + (p.id === game.partyId ? ' is-you' : '') }, [
            el('span', { class: 'legend-swatch', style: { background: p.colour } }),
            el('span', { class: 'legend-label', text: p.short }),
            el('span', { class: 'legend-count', text: n }),
          ]);
        }).concat([
          el('span', { class: 'legend-majority', text: 'majority ' + CMP.MAJORITY }),
        ])
      );
    }

    /** The line under the map: which seat, who leads it, by how much. */
    function showReadout(num) {
      if (num === null || num === undefined || !game.support[num]) {
        mount(readout, [el('span', { class: 'muted', text: 'Hover or tap a constituency.' })]);
        return;
      }
      var def = null;
      for (var i = 0; i < CMP.CONSTITUENCIES.length; i++) {
        if (CMP.CONSTITUENCIES[i].number === Number(num)) def = CMP.CONSTITUENCIES[i];
      }
      var support = game.support[num];
      var lead = CMP.ui.constituency.leaderOf(support);
      var party = CMP.getParty(lead.partyId);
      var band = CMP.campaign.ratingFor(lead.margin);
      var sitting = CMP.getIncumbent(Number(num));

      mount(readout, [
        el('span', { class: 'readout-ac', text: 'AC ' + def.number }),
        el('strong', { class: 'readout-name', text: def.name }),
        el('span', {
          class: 'readout-leading',
          style: { '--party': party.colour, '--party-ink': party.ink },
          text: party.short + ' LEADING',
        }),
        el('span', { class: 'readout-band rating-' + band.id, text: band.label }),
        sitting ? el('span', { class: 'readout-mla', text: 'MLA: ' + sitting.mla + ' (' + sitting.party + ')' }) : null,
      ]);
    }

    /* ------------------------------------------------------ interaction */

    function select(num, notify) {
      selected = Number(num);
      paint();
      if (notify && opts.onSelect) opts.onSelect(selected);
    }

    function setMode(next) {
      if (next === mode) return;
      mode = next;
      Array.prototype.forEach.call(modeToggle.children, function (b) {
        b.classList.toggle('is-selected', b.dataset.mode === mode);
      });
      build();
      reset();
    }

    function applyView() {
      zoomGroup.setAttribute(
        'transform',
        'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')'
      );
      labelLayer.setAttribute('style', '--map-k:' + view.k);
      labelLayer.classList.toggle('show-nums', mode === 'tiles' || view.k >= 2.4);
    }

    function clampView() {
      var maxX = geo.viewBox.width * (view.k - 1);
      var maxY = geo.viewBox.height * (view.k - 1);
      view.x = Math.min(0, Math.max(-maxX, view.x));
      view.y = Math.min(0, Math.max(-maxY, view.y));
    }

    function zoomAt(px, py, factor) {
      var k2 = Math.max(1, Math.min(12, view.k * factor));
      if (k2 === view.k) return;
      var ratio = k2 / view.k;
      view.x = px - (px - view.x) * ratio;
      view.y = py - (py - view.y) * ratio;
      view.k = k2;
      clampView();
      applyView();
    }

    function zoomBy(f) {
      zoomAt(geo.viewBox.width / 2, geo.viewBox.height / 2, f);
    }

    function reset() {
      view = { x: 0, y: 0, k: 1 };
      applyView();
      paint();
    }

    function toLocal(clientX, clientY) {
      if (!svg.getScreenCTM || !svg.createSVGPoint) return { x: 0, y: 0 };
      var ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      var pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      var p = pt.matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }

    svg.addEventListener(
      'wheel',
      function (e) {
        e.preventDefault();
        var p = toLocal(e.clientX, e.clientY);
        zoomAt(p.x, p.y, e.deltaY < 0 ? 1.18 : 1 / 1.18);
      },
      { passive: false }
    );

    var drag = null;
    svg.addEventListener('pointerdown', function (e) {
      var p = toLocal(e.clientX, e.clientY);
      drag = { px: p.x, py: p.y, vx: view.x, vy: view.y, moved: 0 };
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (err) {
        /* jsdom and some browsers refuse */
      }
      svg.classList.add('is-dragging');
    });
    svg.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var p = toLocal(e.clientX, e.clientY);
      view.x = drag.vx + (p.x - drag.px);
      view.y = drag.vy + (p.y - drag.py);
      drag.moved = Math.abs(p.x - drag.px) + Math.abs(p.y - drag.py);
      clampView();
      applyView();
    });
    function endDrag() {
      drag = null;
      svg.classList.remove('is-dragging');
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('pointerleave', endDrag);

    build();
    applyView();

    return {
      root: root,
      render: function (nextGame, sel) {
        game = nextGame;
        if (sel !== undefined && sel !== null) selected = Number(sel);
        paint();
      },
      select: select,
      getMode: function () {
        return mode;
      },
    };
  }

  return { create: create, BAND_OPACITY: BAND_OPACITY };
})();
