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
    var region = 'all'; // all | malwa | majha | doaba
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

    /*
     * Punjab, or one of its three parts.
     *
     * All 117 at once is the whole board and too much of it to campaign from
     * on a phone; a region is about forty seats, which is a thing you can
     * actually work. Choosing one frames it rather than hiding the rest.
     */
    var regionBar = el('div', { class: 'term-options map-regions' });

    function paintRegions() {
      var options = [{ id: 'all', name: 'All Punjab' }].concat(
        (CMP.REGIONS || []).map(function (r) {
          return { id: r.id, name: r.name };
        })
      );
      mount(regionBar, options.map(function (o) {
        return el('button', {
          class: 'term-option' + (region === o.id ? ' is-selected' : ''),
          type: 'button',
          text: o.name,
          dataset: { region: o.id },
          onclick: function () {
            focusRegion(o.id);
            paintRegions();
          },
        });
      }));
    }

    var root = el('div', { class: 'map-block' }, [
      regionBar,
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
        var won = CMP.campaign.wonBy(game, c.number);

        /*
         * Four states, and they look like four states.
         *
         * A seat that is won is the winner's colour at full strength with a
         * tick on it, because it is finished. A seat that is led is that
         * colour faded by how close the race is — and where the race is close
         * enough to be a toss-up it is marked as contested, because a
         * two-point lead and a thirty-point lead are different information
         * and opacity alone does not carry it. A seat nobody has been to is
         * unclaimed ground — which, before round one, is all 117.
         */
        var band = lead ? CMP.campaign.ratingFor(lead.margin) : null;

        node.classList.toggle('is-won', !!won);
        node.classList.toggle('is-contested', !won && !!band && band.id === 'tossup');
        node.classList.toggle('is-selected', selected === c.number);

        if (won) {
          node.setAttribute('fill', CMP.getParty(won.party).colour);
          node.setAttribute('fill-opacity', '1');
          return;
        }
        if (!lead) {
          node.setAttribute('fill', 'var(--line)');
          node.setAttribute('fill-opacity', '0.35');
          return;
        }

        var party = CMP.getParty(lead.partyId);

        node.setAttribute('fill', party.colour);
        node.setAttribute('fill-opacity', BAND_OPACITY[band.id]);
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
        if (lead) counts[lead.partyId] = (counts[lead.partyId] || 0) + 1;
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
          // What the three appearances mean, said once and small.
          el('span', { class: 'legend-key' }, [
            el('span', { class: 'legend-key-item', text: '○ open' }),
            el('span', { class: 'legend-key-item', text: '● leading' }),
            el('span', { class: 'legend-key-item', text: '⚔ contested' }),
            el('span', { class: 'legend-key-item', text: '✓ won' }),
          ]),
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
      var party = lead ? CMP.getParty(lead.partyId) : null;
      var band = lead ? CMP.campaign.ratingFor(lead.margin) : null;

      mount(readout, [
        el('span', { class: 'readout-ac', text: 'AC ' + def.number }),
        el('strong', { class: 'readout-name', text: def.name }),
        lead
          ? el('span', {
              class: 'readout-leading',
              style: { '--party': party.colour, '--party-ink': party.ink },
              text: party.short + ' LEADING',
            })
          : el('span', { class: 'readout-leading is-open', text: 'NO LEADER' }),
        lead
          ? el('span', { class: 'readout-band rating-' + band.id, text: band.label })
          : el('span', { class: 'readout-band is-open', text: 'Uncontested' }),
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
      region = 'all';
      applyView();
      paint();
    }

    /**
     * Put a region in the middle of the frame.
     *
     * Worked out from where its seats actually are rather than from a stored
     * rectangle, so it stays right if the geometry is ever rebuilt.
     */
    function focusRegion(id) {
      region = id;
      if (id === 'all') {
        view = { x: 0, y: 0, k: 1 };
        applyView();
        paint();
        return;
      }

      var xs = [];
      var ys = [];
      CMP.CONSTITUENCIES.forEach(function (c) {
        if (CMP.regionOfSeat(c.number) !== id) return;
        var shape = shapeOf(c.number);
        (shape || []).forEach(function (pt) {
          xs.push(pt[0]);
          ys.push(pt[1]);
        });
      });
      if (!xs.length) {
        paint();
        return;
      }

      var minX = Math.min.apply(null, xs);
      var maxX = Math.max.apply(null, xs);
      var minY = Math.min.apply(null, ys);
      var maxY = Math.max.apply(null, ys);
      var pad = 0.08;
      var w = Math.max(1, (maxX - minX) * (1 + pad * 2));
      var h = Math.max(1, (maxY - minY) * (1 + pad * 2));

      var k = Math.max(1, Math.min(6,
        Math.min(geo.viewBox.width / w, geo.viewBox.height / h)));
      var cx = (minX + maxX) / 2;
      var cy = (minY + maxY) / 2;

      view.k = k;
      view.x = geo.viewBox.width / 2 - cx * k;
      view.y = geo.viewBox.height / 2 - cy * k;
      clampView();
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

    /*
     * Moving around it with your fingers.
     *
     * One finger drags, two pinch, a double tap zooms in. The map is the game
     * now, so getting about it has to feel like handling a map rather than
     * like operating a control panel — which is what a pair of small +/−
     * buttons is.
     *
     * Pointer events do all three, so there is one code path for a mouse, a
     * trackpad and a thumb.
     */
    var drag = null;
    var pointers = {};
    var pinch = null;
    var lastTap = 0;

    function pointerList() {
      return Object.keys(pointers).map(function (id) {
        return pointers[id];
      });
    }

    function pinchSpan(a, b) {
      return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
    }

    svg.addEventListener('pointerdown', function (e) {
      var p = toLocal(e.clientX, e.clientY);
      pointers[e.pointerId] = p;

      var list = pointerList();
      if (list.length === 2) {
        // A second finger cancels the drag and starts a pinch.
        drag = null;
        pinch = {
          span: pinchSpan(list[0], list[1]),
          cx: (list[0].x + list[1].x) / 2,
          cy: (list[0].y + list[1].y) / 2,
        };
        svg.classList.remove('is-dragging');
        return;
      }
      if (list.length > 2) return;

      // A double tap in roughly the same place zooms in on it.
      var now = Date.now();
      if (now - lastTap < 320) {
        lastTap = 0;
        zoomAt(p.x, p.y, 1.9);
        return;
      }
      lastTap = now;

      drag = { px: p.x, py: p.y, vx: view.x, vy: view.y, moved: 0 };
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (err) {
        /* jsdom and some browsers refuse */
      }
      svg.classList.add('is-dragging');
    });

    svg.addEventListener('pointermove', function (e) {
      var p = toLocal(e.clientX, e.clientY);
      if (pointers[e.pointerId]) pointers[e.pointerId] = p;

      var list = pointerList();
      if (pinch && list.length === 2) {
        var span = pinchSpan(list[0], list[1]);
        if (pinch.span > 0 && span > 0) {
          zoomAt(pinch.cx, pinch.cy, span / pinch.span);
          pinch.span = span;
          pinch.cx = (list[0].x + list[1].x) / 2;
          pinch.cy = (list[0].y + list[1].y) / 2;
        }
        return;
      }

      if (!drag) return;
      view.x = drag.vx + (p.x - drag.px);
      view.y = drag.vy + (p.y - drag.py);
      drag.moved = Math.abs(p.x - drag.px) + Math.abs(p.y - drag.py);
      clampView();
      applyView();
    });

    function endDrag(e) {
      if (e && e.pointerId !== undefined) delete pointers[e.pointerId];
      if (pointerList().length < 2) pinch = null;
      drag = null;
      svg.classList.remove('is-dragging');
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('pointerleave', endDrag);

    build();
    paintRegions();
    applyView();

    return {
      root: root,
      render: function (nextGame, sel) {
        game = nextGame;
        if (sel !== undefined && sel !== null) selected = Number(sel);
        paint();
      },
      select: select,
      focusRegion: function (id) {
        focusRegion(id);
        paintRegions();
      },
      getMode: function () {
        return mode;
      },
      getRegion: function () {
        return region;
      },
    };
  }

  return { create: create, BAND_OPACITY: BAND_OPACITY };
})();
