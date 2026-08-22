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
    var selectedDistrict = null;
    var cellNodes = {};
    var lineNodes = [];
    var labelNodes = {};
    var tickNodes = {};

    /*
     * The camera is the viewBox.
     *
     * It used to be a transform on a group inside a fixed viewBox, which meant
     * choosing a region cropped Punjab rather than framing one part of it: the
     * other two were still drawn, just outside the frame, and a pinch brought
     * them straight back. Making the viewBox the camera makes the frame the
     * region — what is outside it is not drawn at all, and zooming out stops
     * at the region's own bounds instead of at Punjab's.
     */
    var BASE = { x: 0, y: 0, w: geo.viewBox.width, h: geo.viewBox.height };
    var frame = rectOf(BASE);   // the region, fitted: also the zoom-out limit
    var cam = rectOf(BASE);     // what is on screen this frame
    var camGoal = null;         // where an animation is heading, if one is
    var camAnim = null;
    var camFallback = null;

    var MAX_ZOOM = 14;          // against the region, not against Punjab
    var REGION_MS = 280;        // the brief asks for 200-350ms

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
    var summary = el('div', { class: 'map-summary' });

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
      summary,
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

    function rectOf(r) {
      return { x: r.x, y: r.y, w: r.w, h: r.h };
    }

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

    /** Which region a district's border lines belong to, by its map name. */
    function regionOfDistrictName(name) {
      var list = CMP.DISTRICTS || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === name || list[i].id === name) return list[i].region;
      }
      return null;
    }

    function build() {
      cellNodes = {};
      lineNodes = [];
      labelNodes = {};
      tickNodes = {};
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
          // A drag that happens to finish over a seat is a drag, not a tap.
          if (dragged) return;
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
        var reg = regionOfDistrictName(name);
        (mode === 'tiles' ? d.hexBorder : d.border).forEach(function (line) {
          var node = svgEl('path', { class: 'map-district-line', d: pathOf(line, false) });
          borderLayer.appendChild(node);
          // Tagged so showing one region can hide the other two outright
          // rather than merely framing them out.
          lineNodes.push({ node: node, region: reg, district: name });
        });
      });

      CMP.CONSTITUENCIES.forEach(function (c) {
        var a = anchorOf(c.number);
        var label = svgEl('text', {
          class: 'map-seat-num',
          x: a[0],
          y: a[1],
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          text: c.number,
        });
        labelNodes[c.number] = label;
        labelLayer.appendChild(label);

        /*
         * The tick for a seat that is finished.
         *
         * The legend promises one and the stroke around a won cell was not
         * it: a colour and an outline both say "somebody is ahead here", and
         * the whole point of a won seat is that it is a different kind of
         * thing. Built once and shown when it applies, because building 117
         * of these on every repaint is a cost the map does not need.
         */
        var tick = svgEl('text', {
          class: 'map-seat-tick',
          x: a[0],
          y: a[1],
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          text: '✓',
        });
        tickNodes[c.number] = tick;
        labelLayer.appendChild(tick);
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

        var tick = tickNodes[c.number];
        if (tick) tick.classList.toggle('is-on', !!won);

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

      /*
       * What is selected, drawn over the board rather than instead of it.
       *
       * A district is every one of its seats outlined, so the seat borders
       * inside it survive and it reads as a group rather than as a blob. Both
       * are clipped to the region on screen: a highlight floating over an
       * empty corner of Doaba because the selection is in Majha is worse than
       * no highlight.
       */
      if (selectedDistrict) {
        var d = CMP.getDistrict && CMP.getDistrict(selectedDistrict);
        ((d && d.seats) || []).forEach(function (n) {
          if (!inRegion(n)) return;
          highlightLayer.appendChild(
            svgEl('path', { class: 'map-district-sel', d: pathOf(shapeOf(n), true) })
          );
        });
      }

      if (selected !== null && inRegion(selected)) {
        highlightLayer.appendChild(
          svgEl('path', { class: 'map-selection', d: pathOf(shapeOf(selected), true) })
        );
      }

      paintDistrictLines();
      paintSummary();
      paintLegend();
      showReadout(selected);
    }

    /**
     * Who is ahead in each district, on its own border.
     *
     * A district is a group of seats and colouring it in one colour would
     * hide the seats, which are the truth — so the border carries it instead.
     * The rule is seats led, and a district every seat of which is won reads
     * as controlled rather than merely ahead.
     */
    function districtLeader(d) {
      var won = game.wonSeats || {};
      var counts = {};
      var wonCount = 0;
      var owner = null;

      d.seats.forEach(function (n) {
        var w = won[String(n)];
        if (w) {
          wonCount += 1;
          counts[w.party] = (counts[w.party] || 0) + 1;
          return;
        }
        var lead = CMP.ui.constituency.leaderOf(game.support[n] || {});
        if (lead) counts[lead.partyId] = (counts[lead.partyId] || 0) + 1;
      });

      var best = null;
      Object.keys(counts).forEach(function (id) {
        if (!best || counts[id] > counts[best]) best = id;
      });
      if (wonCount === d.seats.length && best) owner = best;
      return { party: best, owner: owner, seats: best ? counts[best] : 0 };
    }

    function paintDistrictLines() {
      var byName = {};
      (CMP.DISTRICTS || []).forEach(function (d) {
        byName[d.name] = d;
        byName[d.id] = d;
      });

      var cache = {};
      lineNodes.forEach(function (entry) {
        var d = byName[entry.district];
        if (!d) return;
        if (!cache[d.id]) cache[d.id] = districtLeader(d);
        var lead = cache[d.id];
        var party = lead.party ? CMP.getParty(lead.party) : null;

        entry.node.classList.toggle('has-leader', !!party);
        entry.node.classList.toggle('is-controlled', !!lead.owner);
        if (party) entry.node.style.setProperty('--party', party.colour);
        else entry.node.style.removeProperty('--party');
      });
    }

    function inRegion(num) {
      return region === 'all' || CMP.regionOfSeat(num) === region;
    }

    /** Seats on screen right now: the region, or all 117. */
    function seatsOnScreen() {
      return CMP.CONSTITUENCIES.filter(function (c) {
        return inRegion(c.number);
      }).map(function (c) {
        return c.number;
      });
    }

    /**
     * How the parties stand across what is on screen.
     *
     * Won and leading are counted apart and added for the headline, because a
     * party leading nine seats here and one holding nine are not in the same
     * position — and the number a player wants at a glance is still "how much
     * of this is mine".
     */
    function standingOnScreen() {
      var nums = seatsOnScreen();
      var won = game.wonSeats || {};
      var rows = {};

      function row(id) {
        if (!rows[id]) rows[id] = { party: id, won: 0, leading: 0 };
        return rows[id];
      }

      nums.forEach(function (n) {
        var w = won[String(n)];
        if (w) {
          row(w.party).won += 1;
          return;
        }
        var lead = CMP.ui.constituency.leaderOf(game.support[n]);
        if (lead) row(lead.partyId).leading += 1;
      });

      return CMP.PARTIES.map(function (party) {
        var r = rows[party.id] || { party: party.id, won: 0, leading: 0 };
        return {
          party: party,
          won: r.won,
          leading: r.leading,
          total: r.won + r.leading,
        };
      }).sort(function (a, b) {
        return b.total - a.total || b.won - a.won;
      });
    }

    /**
     * A line above the map saying how the part you are looking at stands.
     *
     * Counted from the board rather than stored, so it is right the moment a
     * round settles, and it changes with the region because that is the whole
     * point of choosing one.
     */
    function paintSummary() {
      var name = region === 'all'
        ? 'All Punjab'
        : ((CMP.getRegion && CMP.getRegion(region) || {}).name || region);
      var rows = standingOnScreen();
      var live = rows.filter(function (r) {
        return r.total > 0;
      });

      mount(summary, [
        el('span', { class: 'map-summary-name', text: name }),
        live.length
          ? el('span', { class: 'map-summary-rows' }, live.map(function (r) {
              return el('span', {
                class: 'map-summary-row' + (r.party.id === game.partyId ? ' is-you' : ''),
                style: { '--party': r.party.colour },
                title: r.party.name + ' — ' + r.won + ' won, ' + r.leading + ' leading',
              }, [
                el('span', { class: 'map-summary-dot' }),
                el('span', { class: 'map-summary-short', text: r.party.short }),
                el('span', { class: 'map-summary-n', text: String(r.total) }),
                r.won
                  ? el('span', { class: 'map-summary-won', text: '\u2713' + r.won })
                  : null,
              ]);
            }))
          : el('span', {
              class: 'map-summary-none',
              text: 'Nobody has campaigned here yet.',
            }),
        el('span', {
          class: 'map-summary-seats',
          text: seatsOnScreen().length + ' seats',
        }),
      ]);
    }

    /*
     * Who the colours belong to.
     *
     * The parties are invented at the start of every game, so the legend has
     * to name them rather than assume anybody recognises a colour — and it
     * names them properly, because a player who called their party the Unity
     * Punjab Front did not call it UPF.
     */
    function paintLegend() {
      var counts = {};
      CMP.CONSTITUENCIES.forEach(function (c) {
        if (!inRegion(c.number)) return;
        var lead = CMP.ui.constituency.leaderOf(game.support[c.number]);
        if (lead) counts[lead.partyId] = (counts[lead.partyId] || 0) + 1;
      });

      mount(
        legend,
        [el('span', { class: 'legend-title', text: 'Leading' })].concat(
        CMP.PARTIES.map(function (p) {
          var n = counts[p.id] || 0;
          return el('span', {
            class: 'legend-item' + (p.id === game.partyId ? ' is-you' : ''),
            title: p.name,
          }, [
            el('span', { class: 'legend-swatch', style: { background: p.colour } }),
            el('span', { class: 'legend-label', text: p.name }),
            el('span', { class: 'legend-count', text: n }),
          ]);
        })).concat([
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

    /**
     * The line under the map: where you are pointing, and who holds it.
     *
     * The district comes first when there is one, because the panel can spend
     * on either and the two readings are different — leading nine seats of a
     * district and leading this one are not the same news.
     */
    function districtLine() {
      if (!selectedDistrict) return null;
      var d = CMP.getDistrict && CMP.getDistrict(selectedDistrict);
      if (!d) return null;

      var lead = districtLeader(d);
      var party = lead.party ? CMP.getParty(lead.party) : null;

      return el('span', { class: 'readout-district' }, [
        el('span', { class: 'readout-district-name', text: d.name }),
        el('span', {
          class: 'readout-district-seats',
          text: d.seats.length + ' seats',
        }),
        party
          ? el('span', {
              class: 'readout-district-lead' + (lead.owner ? ' is-controlled' : ''),
              style: { '--party': party.colour },
              text: (lead.owner ? party.short + ' controls' : party.short + ' ahead in ') +
                (lead.owner ? '' : lead.seats + ' of ' + d.seats.length),
            })
          : el('span', { class: 'readout-district-lead is-open', text: 'No leader' }),
      ]);
    }

    function showReadout(num) {
      if (num === null || num === undefined || !game.support[num]) {
        mount(readout, [
          districtLine(),
          el('span', { class: 'muted', text: 'Hover or tap a constituency.' }),
        ]);
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
        districtLine(),
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
      // The district comes with the seat: the campaign panel can target
      // either, so the map highlights both and lets the panel say which.
      selectedDistrict = CMP.campaign && CMP.campaign.areaOf
        ? CMP.campaign.areaOf(selected)
        : null;
      paint();
      if (notify && opts.onSelect) opts.onSelect(selected, selectedDistrict);
    }

    /** Highlight a district without moving the selection off its seat. */
    function highlightDistrict(id) {
      selectedDistrict = id || null;
      paint();
    }

    function setMode(next) {
      if (next === mode) return;
      mode = next;
      Array.prototype.forEach.call(modeToggle.children, function (b) {
        b.classList.toggle('is-selected', b.dataset.mode === mode);
      });
      build();
      // The region survives a change of view: somebody working Majha in the
      // map view wants Majha in the tiles view, not all of Punjab back.
      setRegion(region, false);
      paintRegions();
    }

    /* -------------------------------------------------------- camera */

    function applyCamera() {
      svg.setAttribute('viewBox',
        cam.x + ' ' + cam.y + ' ' + cam.w + ' ' + cam.h);

      // Labels are drawn in map units, so they grow with the zoom unless they
      // are told what the zoom is. `k` is against Punjab rather than against
      // the region, so a seat label is the same size whichever way you got to
      // it.
      var k = BASE.w / cam.w;
      labelLayer.setAttribute('style', '--map-k:' + k);
      labelLayer.classList.toggle('show-nums', mode === 'tiles' || k >= 2.4);
    }

    /**
     * Keep the camera inside the region, and its shape the region's shape.
     *
     * Aspect is locked to the frame rather than recomputed, so a pinch cannot
     * slowly stretch the map — and the pan limits are the frame's edges, so
     * the board can never be pushed off-screen.
     */
    function clampCamera(c) {
      var minW = frame.w / MAX_ZOOM;
      if (c.w > frame.w) c.w = frame.w;
      else if (c.w < minW) c.w = minW;
      c.h = c.w * (frame.h / frame.w);

      c.x = Math.min(frame.x + frame.w - c.w, Math.max(frame.x, c.x));
      c.y = Math.min(frame.y + frame.h - c.h, Math.max(frame.y, c.y));
      return c;
    }

    function reducedMotion() {
      try {
        return !!(window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      } catch (e) {
        return false;
      }
    }

    function stopCamera() {
      if (camAnim !== null && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(camAnim);
      }
      if (camFallback !== null) window.clearTimeout(camFallback);
      camAnim = null;
      camFallback = null;
      camGoal = null;
    }

    /** Where the camera is going: the goal if it is moving, else where it is. */
    function camNow() {
      return rectOf(camGoal || cam);
    }

    function animateCamera(target, ms) {
      stopCamera();
      var to = clampCamera(rectOf(target));

      if (!ms || reducedMotion() || !window.requestAnimationFrame) {
        cam = to;
        applyCamera();
        return;
      }

      var from = rectOf(cam);
      camGoal = rectOf(to);
      var t0 = null;

      function step(ts) {
        if (t0 === null) t0 = ts;
        var t = Math.min(1, (ts - t0) / ms);
        var e = 1 - Math.pow(1 - t, 3);   // ease-out: fast away, gentle arrival
        cam.x = from.x + (to.x - from.x) * e;
        cam.y = from.y + (to.y - from.y) * e;
        cam.w = from.w + (to.w - from.w) * e;
        cam.h = from.h + (to.h - from.h) * e;
        applyCamera();
        if (t < 1) {
          camAnim = window.requestAnimationFrame(step);
        } else {
          camAnim = null;
          camGoal = null;
        }
      }
      camAnim = window.requestAnimationFrame(step);

      /*
       * And a guarantee that it arrives.
       *
       * requestAnimationFrame only runs when frames are being painted, which
       * is not always: a background tab, a throttled renderer, a headless
       * browser advancing virtual time. Losing the animation is a shrug;
       * losing the *destination* would leave somebody who picked Majha
       * looking at Punjab. So the end state is also scheduled on a plain
       * timer, which lands a little after the animation should have.
       */
      camFallback = window.setTimeout(function () {
        camFallback = null;
        if (!camGoal) return;
        cam = rectOf(camGoal);
        applyCamera();
        stopCamera();
      }, ms + 120);
    }

    /* ---------------------------------------------------- fitting a region */

    /**
     * Grow the shorter side until the rectangle is the shape of the frame on
     * screen, so a region fills it instead of sitting letterboxed inside it.
     */
    function fitAspect(r) {
      var box = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
      var aspect = box && box.width && box.height
        ? box.width / box.height
        : BASE.w / BASE.h;
      if (!isFinite(aspect) || aspect <= 0) aspect = BASE.w / BASE.h;

      if (r.w / r.h < aspect) {
        var w2 = r.h * aspect;
        r.x -= (w2 - r.w) / 2;
        r.w = w2;
      } else {
        var h2 = r.w / aspect;
        r.y -= (h2 - r.h) / 2;
        r.h = h2;
      }
      return r;
    }

    /** The bounding box of a set of seats, in map units. */
    function boundsOfSeats(nums) {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nums.forEach(function (n) {
        (shapeOf(n) || []).forEach(function (pt) {
          if (pt[0] < minX) minX = pt[0];
          if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] < minY) minY = pt[1];
          if (pt[1] > maxY) maxY = pt[1];
        });
      });
      if (!isFinite(minX)) return null;
      return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
    }

    /** A camera rectangle around some seats, with room to breathe. */
    function frameAround(nums, pad) {
      var b = boundsOfSeats(nums);
      if (!b) return rectOf(BASE);
      var w = Math.max(1, b.maxX - b.minX);
      var h = Math.max(1, b.maxY - b.minY);
      var px = w * pad;
      var py = h * pad;
      return fitAspect({ x: b.minX - px, y: b.minY - py, w: w + px * 2, h: h + py * 2 });
    }

    function seatsInRegion(id) {
      return CMP.CONSTITUENCIES.filter(function (c) {
        return CMP.regionOfSeat(c.number) === id;
      }).map(function (c) {
        return c.number;
      });
    }

    function regionFrame(id) {
      if (id === 'all') return fitAspect(rectOf(BASE));
      var nums = seatsInRegion(id);
      return nums.length ? frameAround(nums, 0.06) : fitAspect(rectOf(BASE));
    }

    /**
     * Show one region and nothing else.
     *
     * The frame is the region's own bounds, so it is fitted and centred
     * without anybody having to zoom out afterwards; everything outside it is
     * hidden rather than merely off-frame, so panning about inside Majha never
     * turns up a corner of Malwa.
     */
    function markRegion() {
      var all = region === 'all';
      CMP.CONSTITUENCIES.forEach(function (c) {
        var node = cellNodes[c.number];
        var out = !all && CMP.regionOfSeat(c.number) !== region;
        if (node) node.classList.toggle('is-outside', out);
        var label = labelNodes[c.number];
        if (label) label.classList.toggle('is-outside', out);
        var tick = tickNodes[c.number];
        if (tick) tick.classList.toggle('is-outside', out);
      });
      lineNodes.forEach(function (entry) {
        entry.node.classList.toggle('is-outside', !all && entry.region !== region);
      });
      outlinePath.classList.toggle('is-outside', !all);
      svg.classList.toggle('is-region', !all);
    }

    function setRegion(id, animate) {
      region = id;
      frame = regionFrame(id);
      markRegion();
      animateCamera(rectOf(frame), animate === false ? 0 : REGION_MS);
      paint();
    }

    function focusRegion(id) {
      setRegion(id, true);
    }

    /** Fill the frame with one district, keeping the region it belongs to. */
    function focusDistrict(districtId, animate) {
      var d = CMP.getDistrict && CMP.getDistrict(districtId);
      if (!d || !d.seats || !d.seats.length) return;
      animateCamera(frameAround(d.seats, 0.22), animate === false ? 0 : REGION_MS);
    }

    /** Fill the frame with one seat. */
    function focusSeat(num, animate) {
      if (num === null || num === undefined) return;
      animateCamera(frameAround([Number(num)], 0.8), animate === false ? 0 : REGION_MS);
    }

    function reset() {
      selected = null;
      setRegion('all', true);
      paintRegions();
    }

    /* ------------------------------------------------------ zooming */

    function zoomToward(gx, gy, factor, ms) {
      var base = camNow();
      var w2 = base.w / factor;
      var r = w2 / base.w;
      animateCamera({
        x: gx - (gx - base.x) * r,
        y: gy - (gy - base.y) * r,
        w: w2,
        h: base.h * r,
      }, ms || 0);
    }

    function zoomBy(f) {
      var c = camNow();
      zoomToward(c.x + c.w / 2, c.y + c.h / 2, f, 220);
    }

    /*
     * Screen to map, worked out from the camera rather than from the browser.
     *
     * `getScreenCTM` would do it, but it reports the matrix as it is *now* —
     * which during an animation is a frame behind the finger, and the map
     * appears to lag. The viewBox is fitted xMidYMid meet, so the arithmetic
     * is short and exact.
     */
    function frameBox() {
      return svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    }

    function toLocal(clientX, clientY) {
      var box = frameBox();
      if (!box || !box.width || !box.height) {
        return { x: cam.x + cam.w / 2, y: cam.y + cam.h / 2 };
      }
      var scale = Math.min(box.width / cam.w, box.height / cam.h);
      var offX = box.left + (box.width - cam.w * scale) / 2;
      var offY = box.top + (box.height - cam.h * scale) / 2;
      return { x: cam.x + (clientX - offX) / scale, y: cam.y + (clientY - offY) / scale };
    }

    /** Map units per screen pixel, for dragging. */
    function unitsPerPixel() {
      var box = frameBox();
      if (!box || !box.width || !box.height) return 0;
      return cam.w / Math.min(box.width, box.height * (cam.w / cam.h));
    }

    svg.addEventListener(
      'wheel',
      function (e) {
        e.preventDefault();
        stopCamera();
        var p = toLocal(e.clientX, e.clientY);
        // Proportional to the wheel rather than a fixed step, so a trackpad
        // pinch is as continuous as a touchscreen one.
        var f = Math.exp(-e.deltaY * 0.0022);
        zoomToward(p.x, p.y, Math.max(0.4, Math.min(2.5, f)), 0);
      },
      { passive: false }
    );

    /*
     * Moving around it with your fingers.
     *
     * One finger drags, two pinch, a double tap zooms in on what was tapped.
     * The map is the game now, so getting about it has to feel like handling a
     * map rather than like operating a control panel — which is what a pair of
     * small +/- buttons is.
     *
     * Pointer events do all three, so there is one code path for a mouse, a
     * trackpad and a thumb. Everything is in client pixels: a finger that
     * moves 40px moves the map 40px whatever the zoom, which is the whole of
     * what "follows the finger" means.
     */
    var drag = null;
    var dragged = false;   // the last gesture moved the map rather than picking
    var pointers = {};
    var pinch = null;
    var lastTap = 0;
    var lastTapAt = null;

    function pointerList() {
      return Object.keys(pointers).map(function (id) {
        return pointers[id];
      });
    }

    function span(a, b) {
      return Math.sqrt(Math.pow(a.cx - b.cx, 2) + Math.pow(a.cy - b.cy, 2));
    }

    svg.addEventListener('pointerdown', function (e) {
      pointers[e.pointerId] = { cx: e.clientX, cy: e.clientY };

      var list = pointerList();
      if (list.length === 2) {
        // A second finger cancels the drag and starts a pinch.
        drag = null;
        stopCamera();
        dragged = true;
        pinch = {
          span: span(list[0], list[1]),
          cx: (list[0].cx + list[1].cx) / 2,
          cy: (list[0].cy + list[1].cy) / 2,
        };
        svg.classList.remove('is-dragging');
        return;
      }
      if (list.length > 2) return;

      // A double tap in roughly the same place zooms in on it, smoothly.
      var now = Date.now();
      var near = lastTapAt &&
        Math.abs(e.clientX - lastTapAt.cx) < 34 &&
        Math.abs(e.clientY - lastTapAt.cy) < 34;
      if (now - lastTap < 320 && near) {
        lastTap = 0;
        lastTapAt = null;
        var p = toLocal(e.clientX, e.clientY);
        zoomToward(p.x, p.y, 2, 260);
        return;
      }
      lastTap = now;
      lastTapAt = { cx: e.clientX, cy: e.clientY };

      stopCamera();
      dragged = false;
      drag = { cx: e.clientX, cy: e.clientY, moved: 0 };
      try {
        svg.setPointerCapture(e.pointerId);
      } catch (err) {
        /* jsdom and some browsers refuse */
      }
      svg.classList.add('is-dragging');
    });

    svg.addEventListener('pointermove', function (e) {
      if (pointers[e.pointerId]) {
        pointers[e.pointerId] = { cx: e.clientX, cy: e.clientY };
      }

      var list = pointerList();
      if (pinch && list.length === 2) {
        var now = span(list[0], list[1]);
        var mx = (list[0].cx + list[1].cx) / 2;
        var my = (list[0].cy + list[1].cy) / 2;

        // Pan and zoom together: the midpoint drifting is the fingers moving
        // across the map, and ignoring it makes a pinch feel pinned.
        if (pinch.span > 0 && now > 0) {
          var p = toLocal(pinch.cx, pinch.cy);
          zoomToward(p.x, p.y, now / pinch.span, 0);
          panByPixels(mx - pinch.cx, my - pinch.cy);
        }
        pinch.span = now;
        pinch.cx = mx;
        pinch.cy = my;
        return;
      }

      if (!drag) return;
      var dx = e.clientX - drag.cx;
      var dy = e.clientY - drag.cy;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 8) dragged = true;
      drag.cx = e.clientX;
      drag.cy = e.clientY;
      panByPixels(dx, dy);
    });

    /** Move the map with the finger: dragging right shows what is to the left. */
    function panByPixels(dx, dy) {
      var box = frameBox();
      if (!box || !box.width || !box.height) return;
      var scale = Math.min(box.width / cam.w, box.height / cam.h);
      if (!scale) return;
      cam.x -= dx / scale;
      cam.y -= dy / scale;
      clampCamera(cam);
      applyCamera();
    }

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
    setRegion('all', false);

    return {
      root: root,
      render: function (nextGame, sel) {
        game = nextGame;
        if (sel !== undefined && sel !== null) {
          selected = Number(sel);
          // Selecting from outside goes through the same door as a tap, so
          // the district highlight follows either way.
          selectedDistrict = CMP.campaign && CMP.campaign.areaOf
            ? CMP.campaign.areaOf(selected)
            : null;
        }
        paint();
      },
      select: select,
      focusRegion: function (id) {
        focusRegion(id);
        paintRegions();
      },
      focusDistrict: focusDistrict,
      focusSeat: focusSeat,
      highlightDistrict: highlightDistrict,
      reset: reset,
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
