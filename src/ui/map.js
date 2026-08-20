/**
 * The election map.
 * ------------------------------------------------------------------
 * One SVG, two ways of looking at the same 117 seats:
 *   geo  - Voronoi cells over the real outline of Punjab
 *   hex  - one equal tile per seat, so a marginal in Amritsar city is as
 *          easy to click as a 3,000 km2 seat in Fazilka
 *
 * The map only ever renders what the player is allowed to know: it is handed
 * a fogged projection, never the underlying truth.
 */
window.PG = window.PG || {};
PG.ui = PG.ui || {};

PG.ui.map = (function () {
  'use strict';

  var svgEl = PG.ui.dom.svg;
  var el = PG.ui.dom.el;
  var fmt = PG.ui.fmt;

  var BAND_OPACITY = { safe: 1, likely: 0.82, lean: 0.6, tossup: 0.36 };
  var NEUTRAL = '#39415a';

  function create(opts) {
    var stateId = opts.stateId;
    var geo = PG.getState(stateId).geometry();
    var idx = PG.index.get(stateId);

    var view = { x: 0, y: 0, k: 1 };
    var mode = 'geo';
    var colourMode = 'projection';
    var selected = null;
    var focusDistrict = null;
    var hovered = null;
    var projection = null;
    var game = null;

    /* ------------------------------------------------------- scaffolding */

    var cellLayer = svgEl('g', { class: 'map-cells' });
    var borderLayer = svgEl('g', { class: 'map-borders' });
    var labelLayer = svgEl('g', { class: 'map-labels' });
    var highlightLayer = svgEl('g', { class: 'map-highlight' });
    var outlinePath = svgEl('path', {
      class: 'map-outline',
      d: pathFrom(geo.outline, true),
    });

    var zoomGroup = svgEl('g', { class: 'map-zoom' }, [
      outlinePath,
      cellLayer,
      borderLayer,
      highlightLayer,
      labelLayer,
    ]);

    var svg = svgEl(
      'svg',
      {
        class: 'map-svg',
        viewBox: '0 0 ' + geo.viewBox.width + ' ' + geo.viewBox.height,
        preserveAspectRatio: 'xMidYMid meet',
        role: 'application',
        'aria-label': 'Interactive map of ' + PG.getState(stateId).name + ' assembly constituencies',
      },
      [zoomGroup]
    );

    var tooltip = el('div', { class: 'map-tooltip', 'aria-hidden': 'true' });

    var zoomLabel = el('span', { class: 'map-zoom-level', text: '100%' });
    var controls = el('div', { class: 'map-controls' }, [
      el('button', {
        class: 'map-btn',
        type: 'button',
        title: 'Zoom in',
        'aria-label': 'Zoom in',
        text: '+',
        onclick: function () {
          zoomBy(1.4);
        },
      }),
      el('button', {
        class: 'map-btn',
        type: 'button',
        title: 'Zoom out',
        'aria-label': 'Zoom out',
        text: '−',
        onclick: function () {
          zoomBy(1 / 1.4);
        },
      }),
      el('button', {
        class: 'map-btn map-btn-wide',
        type: 'button',
        title: 'Reset view',
        'aria-label': 'Reset view',
        text: 'Reset',
        onclick: reset,
      }),
      zoomLabel,
    ]);

    var root = el('div', { class: 'map-root' }, [svg, tooltip, controls]);

    /* ------------------------------------------------------- geometry */

    function pathFrom(points, close) {
      var d = '';
      for (var i = 0; i < points.length; i++) {
        d += (i === 0 ? 'M' : 'L') + points[i][0] + ' ' + points[i][1];
      }
      return d + (close ? 'Z' : '');
    }

    function shapeFor(seatNum) {
      var g = idx.geoByNum[seatNum];
      if (mode === 'hex') {
        return geo.hexPoints.map(function (p) {
          return [g.hex[0] + p[0], g.hex[1] + p[1]];
        });
      }
      return g.cell;
    }

    function anchorFor(seatNum) {
      var g = idx.geoByNum[seatNum];
      return mode === 'hex' ? g.hex : g.centroid;
    }

    /* ------------------------------------------------------- colouring */

    function fillFor(seatNum) {
      if (!projection) return { fill: NEUTRAL, opacity: 0.5 };
      var entry = projection.bySeat[seatNum];
      var rating = entry.rating;

      if (colourMode === 'battleground') {
        var band = rating.band;
        if (rating.playerLeads) {
          return { fill: PG.PARTY_BY_ID[game.player.partyId].colour, opacity: BAND_OPACITY[band] };
        }
        if (band === 'tossup' || band === 'lean') {
          return { fill: '#e8b230', opacity: band === 'tossup' ? 0.85 : 0.6 };
        }
        return { fill: '#6b7590', opacity: band === 'safe' ? 0.75 : 0.5 };
      }

      if (colourMode === 'campaign') {
        var spend = (game.seats[seatNum].spend[game.player.partyId] || 0);
        var t = Math.min(1, spend / 14);
        if (t <= 0.001) return { fill: NEUTRAL, opacity: 0.35 };
        return {
          fill: fmt.mix('#4b5570', PG.PARTY_BY_ID[game.player.partyId].colour, t),
          opacity: 0.45 + t * 0.55,
        };
      }

      return {
        fill: PG.PARTY_BY_ID[rating.leader].colour,
        opacity: BAND_OPACITY[rating.band],
      };
    }

    /* ------------------------------------------------------- rendering */

    var cellNodes = {};

    function buildCells() {
      PG.ui.dom.clear(cellLayer);
      cellNodes = {};
      idx.seatDefs.forEach(function (def) {
        var node = svgEl('path', {
          class: 'map-cell',
          d: pathFrom(shapeFor(def.num), true),
          dataset: { seat: def.num },
          tabindex: '-1',
        });
        cellNodes[def.num] = node;
        cellLayer.appendChild(node);
      });
    }

    function buildBorders() {
      PG.ui.dom.clear(borderLayer);
      idx.districtOrder.forEach(function (name) {
        var d = geo.districts[name];
        var lines = mode === 'hex' ? d.hexBorder : d.border;
        lines.forEach(function (line) {
          borderLayer.appendChild(
            svgEl('path', {
              class: 'map-district-border',
              d: pathFrom(line, false),
              dataset: { district: name },
            })
          );
        });
      });
    }

    function buildLabels() {
      PG.ui.dom.clear(labelLayer);
      idx.districtOrder.forEach(function (name) {
        var d = geo.districts[name];
        var c = mode === 'hex' ? d.hexCentroid : d.centroid;
        labelLayer.appendChild(
          svgEl('text', {
            class: 'map-district-label',
            x: c.x,
            y: c.y,
            'text-anchor': 'middle',
            dataset: { district: name },
            text: (PG.index.district(stateId, name) || {}).short || name,
          })
        );
      });
      idx.seatDefs.forEach(function (def) {
        var a = anchorFor(def.num);
        labelLayer.appendChild(
          svgEl('text', {
            class: 'map-seat-label',
            x: a[0],
            y: a[1],
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            dataset: { seat: def.num },
            text: def.num,
          })
        );
      });
    }

    function paint() {
      idx.seatDefs.forEach(function (def) {
        var node = cellNodes[def.num];
        if (!node) return;
        var c = fillFor(def.num);
        node.setAttribute('fill', c.fill);
        node.setAttribute('fill-opacity', c.opacity);
        var dim = focusDistrict && def.district !== focusDistrict;
        node.classList.toggle('is-dimmed', !!dim);
        node.classList.toggle('is-selected', selected === def.num);
      });

      PG.ui.dom.clear(highlightLayer);
      if (selected !== null && cellNodes[selected]) {
        highlightLayer.appendChild(
          svgEl('path', {
            class: 'map-selection',
            d: pathFrom(shapeFor(selected), true),
          })
        );
      }
      if (focusDistrict) {
        var d = geo.districts[focusDistrict];
        (mode === 'hex' ? d.hexBorder : d.border).forEach(function (line) {
          highlightLayer.appendChild(
            svgEl('path', { class: 'map-district-focus', d: pathFrom(line, false) })
          );
        });
      }

      updateLabelVisibility();
    }

    function updateLabelVisibility() {
      var showSeats = view.k >= 2.6 || mode === 'hex';
      var showDistricts = view.k < 4.5;
      labelLayer.classList.toggle('show-seats', showSeats);
      labelLayer.classList.toggle('show-districts', showDistricts);
      labelLayer.setAttribute('style', '--map-k:' + view.k);
    }

    /* ------------------------------------------------------- zoom + pan */

    function applyView() {
      zoomGroup.setAttribute(
        'transform',
        'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')'
      );
      zoomLabel.textContent = Math.round(view.k * 100) + '%';
      updateLabelVisibility();
    }

    function clampView() {
      var w = geo.viewBox.width;
      var h = geo.viewBox.height;
      var maxX = w * (view.k - 1);
      var maxY = h * (view.k - 1);
      view.x = Math.min(0, Math.max(-maxX, view.x));
      view.y = Math.min(0, Math.max(-maxY, view.y));
    }

    function zoomAt(px, py, factor) {
      var k2 = Math.max(1, Math.min(14, view.k * factor));
      if (k2 === view.k) return;
      var ratio = k2 / view.k;
      view.x = px - (px - view.x) * ratio;
      view.y = py - (py - view.y) * ratio;
      view.k = k2;
      clampView();
      applyView();
    }

    function zoomBy(factor) {
      zoomAt(geo.viewBox.width / 2, geo.viewBox.height / 2, factor);
    }

    function reset() {
      view = { x: 0, y: 0, k: 1 };
      focusDistrict = null;
      applyView();
      paint();
    }

    function toLocal(clientX, clientY) {
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

    var pointers = {};
    var dragStart = null;
    var pinchStart = null;
    var moved = 0;

    svg.addEventListener('pointerdown', function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        moved = 0;
        var p = toLocal(e.clientX, e.clientY);
        dragStart = { px: p.x, py: p.y, vx: view.x, vy: view.y };
        svg.setPointerCapture(e.pointerId);
        svg.classList.add('is-dragging');
      } else if (ids.length === 2) {
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        pinchStart = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          k: view.k,
        };
        dragStart = null;
      }
    });

    svg.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);

      if (ids.length >= 2 && pinchStart) {
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart.dist > 0) {
          var mid = toLocal((a.x + b.x) / 2, (a.y + b.y) / 2);
          var target = pinchStart.k * (dist / pinchStart.dist);
          zoomAt(mid.x, mid.y, Math.max(1, Math.min(14, target)) / view.k);
        }
        return;
      }

      if (dragStart) {
        var p = toLocal(e.clientX, e.clientY);
        // Keep the model point that was under the cursor at drag start under it.
        view.x = dragStart.vx + (p.x - dragStart.px);
        view.y = dragStart.vy + (p.y - dragStart.py);
        moved = Math.abs(p.x - dragStart.px) + Math.abs(p.y - dragStart.py);
        hideTooltip();
        clampView();
        applyView();
      }
    });

    function endPointer(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinchStart = null;
      if (Object.keys(pointers).length === 0) {
        dragStart = null;
        svg.classList.remove('is-dragging');
      }
    }
    svg.addEventListener('pointerup', endPointer);
    svg.addEventListener('pointercancel', endPointer);
    svg.addEventListener('pointerleave', function (e) {
      endPointer(e);
      hideTooltip();
    });

    /* ------------------------------------------------------- interaction */

    function seatFromEvent(e) {
      var t = e.target;
      if (t && t.dataset && t.dataset.seat) return +t.dataset.seat;
      return null;
    }

    svg.addEventListener('click', function (e) {
      if (moved > 6) return; // that was a drag, not a click
      var num = seatFromEvent(e);
      if (num === null) {
        var district = e.target && e.target.dataset && e.target.dataset.district;
        if (district && opts.onDistrict) opts.onDistrict(district);
        return;
      }
      select(num, { notify: true });
    });

    svg.addEventListener('dblclick', function (e) {
      var p = toLocal(e.clientX, e.clientY);
      zoomAt(p.x, p.y, 1.8);
    });

    function handleHover(e) {
      if (dragStart || pinchStart) return; // no tooltips mid-drag
      var num = seatFromEvent(e);
      if (num === hovered) {
        if (num !== null) moveTooltip(e);
        return;
      }
      if (hovered !== null && cellNodes[hovered]) {
        cellNodes[hovered].classList.remove('is-hovered');
      }
      hovered = num;
      if (num === null) {
        hideTooltip();
        return;
      }
      cellNodes[num].classList.add('is-hovered');
      showTooltip(num, e);
    }

    svg.addEventListener('pointermove', handleHover);

    /* ------------------------------------------------------- tooltip */

    function showTooltip(num, e) {
      if (!projection) return;
      var def = idx.byNum[num];
      var entry = projection.bySeat[num];
      var ranked = entry.rating.ranked.slice(0, 3);
      tooltip.innerHTML = '';
      tooltip.appendChild(
        el('div', { class: 'tt-head' }, [
          el('span', { class: 'tt-num', text: '#' + def.num }),
          el('strong', { text: def.name }),
          def.reservation === 'SC' ? el('span', { class: 'tt-tag', text: 'SC' }) : null,
        ])
      );
      tooltip.appendChild(
        el('div', { class: 'tt-sub', text: def.district + ' · ' + def.region })
      );
      tooltip.appendChild(
        el(
          'div',
          { class: 'tt-bars' },
          ranked.map(function (r) {
            var p = PG.PARTY_BY_ID[r.id];
            return el('div', { class: 'tt-bar-row' }, [
              el('span', { class: 'tt-party', text: p.short }),
              el('span', { class: 'tt-track' }, [
                el('span', {
                  class: 'tt-fill',
                  style: { width: Math.max(2, r.share * 1.6) + '%', background: p.colour },
                }),
              ]),
              el('span', { class: 'tt-val', text: fmt.pct(r.share, 0) }),
            ]);
          })
        )
      );
      tooltip.appendChild(
        el('div', { class: 'tt-foot rating-' + entry.rating.band }, [
          el('span', { text: entry.rating.bandLabel + ' ' + PG.PARTY_BY_ID[entry.rating.leader].short }),
        ])
      );
      tooltip.classList.add('is-visible');
      moveTooltip(e);
    }

    function moveTooltip(e) {
      var box = root.getBoundingClientRect();
      var x = e.clientX - box.left + 16;
      var y = e.clientY - box.top + 16;
      var tw = tooltip.offsetWidth || 210;
      var th = tooltip.offsetHeight || 120;
      if (x + tw > box.width - 8) x = e.clientX - box.left - tw - 16;
      if (y + th > box.height - 8) y = e.clientY - box.top - th - 16;
      tooltip.style.transform = 'translate(' + Math.max(4, x) + 'px,' + Math.max(4, y) + 'px)';
    }

    function hideTooltip() {
      tooltip.classList.remove('is-visible');
      if (hovered !== null && cellNodes[hovered]) cellNodes[hovered].classList.remove('is-hovered');
      hovered = null;
    }

    /* ------------------------------------------------------- public api */

    function select(num, o) {
      selected = num;
      paint();
      if (o && o.notify && opts.onSelect) opts.onSelect(num);
    }

    function focusOn(districtName, o) {
      focusDistrict = districtName || null;
      if (districtName && o && o.zoom !== false) {
        var d = geo.districts[districtName];
        var c = mode === 'hex' ? d.hexCentroid : d.centroid;
        var k = mode === 'hex' ? 2.2 : 3;
        view.k = k;
        view.x = geo.viewBox.width / 2 - c.x * k;
        view.y = geo.viewBox.height / 2 - c.y * k;
        clampView();
        applyView();
      }
      paint();
    }

    function setMode(next) {
      if (next === mode) return;
      mode = next;
      buildCells();
      buildBorders();
      buildLabels();
      reset();
    }

    function setColourMode(next) {
      colourMode = next;
      paint();
    }

    function update(nextGame, nextProjection) {
      game = nextGame;
      projection = nextProjection;
      paint();
    }

    buildCells();
    buildBorders();
    buildLabels();
    applyView();

    return {
      root: root,
      update: update,
      select: select,
      focusOn: focusOn,
      setMode: setMode,
      setColourMode: setColourMode,
      reset: reset,
      getMode: function () {
        return mode;
      },
      getColourMode: function () {
        return colourMode;
      },
      getSelected: function () {
        return selected;
      },
    };
  }

  return { create: create, BAND_OPACITY: BAND_OPACITY };
})();
