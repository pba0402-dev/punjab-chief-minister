/**
 * build-geometry.mjs
 * ------------------------------------------------------------------
 * Turns the verified constituency list + real geocoded centres into
 * renderable map geometry:
 *   1. Voronoi cells clipped to the real Punjab state outline  (geographic map)
 *   2. A hex cartogram grid, one hex per seat                  (seat map)
 *   3. District aggregates + a neighbour graph
 *
 * Output: src/data/punjab-geometry.js  (a plain script assigning PG.GEOMETRY)
 *
 * IMPORTANT: constituency names / numbers / districts / reservation come from
 * verified public sources. Cell shapes are derived from approximate town
 * centres and are NOT official boundary data. See README "Data provenance".
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, f), 'utf8'));

const acs = read('acs.json');
const coords = read('coords.json');
const overrides = read('overrides.json');
const boundary = read('punjab_boundary.json');

/* ---------------------------------------------------------------- projection */
const LAT0 = 30.95;
const K = Math.cos((LAT0 * Math.PI) / 180);
const project = (lat, lon) => ({ x: lon * K, y: -lat });

const ringLL = boundary.coordinates[0].map(([lon, lat]) => project(lat, lon));

// Fit into a 1000-wide viewBox with a small margin.
const xs = ringLL.map((p) => p.x);
const ys = ringLL.map((p) => p.y);
const minX = Math.min.apply(null, xs);
const maxX = Math.max.apply(null, xs);
const minY = Math.min.apply(null, ys);
const maxY = Math.max.apply(null, ys);
const PAD = 12;
const W = 1000;
const scale = (W - PAD * 2) / (maxX - minX);
const H = Math.round((maxY - minY) * scale + PAD * 2);
const toView = (p) => ({ x: (p.x - minX) * scale + PAD, y: (p.y - minY) * scale + PAD });

const outline = ringLL.map(toView);

/* ---------------------------------------------------------------- sites */
const sites = acs.map((row) => {
  const num = row[0];
  const name = row[1];
  const district = row[2];
  const reservation = row[3];
  const c = overrides[String(num)] || coords[String(num)];
  if (!c) throw new Error('no coords for ' + num + ' ' + name);
  const v = toView(project(c.lat, c.lon));
  return { num, name, district, reservation, lat: c.lat, lon: c.lon, x: v.x, y: v.y };
});

// Nudge any near-coincident sites so the Voronoi stays well defined.
for (let i = 0; i < sites.length; i++) {
  for (let j = i + 1; j < sites.length; j++) {
    const d = Math.hypot(sites[i].x - sites[j].x, sites[i].y - sites[j].y);
    if (d < 0.75) {
      const a = (i * 2.399963 + j) % (Math.PI * 2);
      sites[j].x += Math.cos(a) * 1.2;
      sites[j].y += Math.sin(a) * 1.2;
    }
  }
}

/* ---------------------------------------------------------------- voronoi */
// Clip a polygon to the half-plane closer to `a` than to `b` (Sutherland-Hodgman).
function clipHalfPlane(poly, a, b) {
  const nx = b.x - a.x;
  const ny = b.y - a.y;
  const c = (b.x * b.x + b.y * b.y - a.x * a.x - a.y * a.y) / 2;
  const f = (p) => nx * p.x + ny * p.y - c; // <= 0 means closer to a
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i];
    const Q = poly[(i + 1) % poly.length];
    const fp = f(P);
    const fq = f(Q);
    if (fp <= 0) out.push(P);
    if ((fp <= 0) !== (fq <= 0)) {
      const t = fp / (fp - fq);
      out.push({ x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t });
    }
  }
  return out;
}

const round = (n) => Math.round(n * 100) / 100;

function voronoiCell(site) {
  let poly = outline;
  // Nearest-first ordering shrinks the polygon fast, so distant sites rarely cut.
  const others = sites
    .filter((s) => s !== site)
    .sort(
      (p, q) =>
        Math.hypot(p.x - site.x, p.y - site.y) - Math.hypot(q.x - site.x, q.y - site.y)
    );
  for (let i = 0; i < others.length; i++) {
    poly = clipHalfPlane(poly, site, others[i]);
    if (poly.length < 3) break;
  }
  // Drop near-duplicate vertices introduced by successive clipping.
  const simp = [];
  for (const p of poly) {
    const q = { x: round(p.x), y: round(p.y) };
    const last = simp[simp.length - 1];
    if (!last || Math.hypot(last.x - q.x, last.y - q.y) > 0.05) simp.push(q);
  }
  if (simp.length > 1) {
    const first = simp[0];
    const last = simp[simp.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 0.05) simp.pop();
  }
  return simp;
}

const polyArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

const polyCentroid = (pts) => {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cr = p.x * q.y - q.x * p.y;
    a += cr;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return { x: pts[0].x, y: pts[0].y };
  return { x: round(cx / (6 * a)), y: round(cy / (6 * a)) };
};

for (const s of sites) {
  s.cell = voronoiCell(s);
  if (s.cell.length < 3) throw new Error('degenerate cell for ' + s.num + ' ' + s.name);
  s.area = polyArea(s.cell);
  s.centroid = polyCentroid(s.cell);
}

/* ------------------------------------------------- neighbours via shared edges */
const key = (p) => p.x.toFixed(1) + ',' + p.y.toFixed(1);
const edgeOwners = new Map();
for (const s of sites) {
  for (let i = 0; i < s.cell.length; i++) {
    const p = s.cell[i];
    const q = s.cell[(i + 1) % s.cell.length];
    const k = [key(p), key(q)].sort().join('|');
    if (!edgeOwners.has(k)) edgeOwners.set(k, []);
    edgeOwners.get(k).push(s.num);
  }
}
const neighbours = new Map(sites.map((s) => [s.num, new Set()]));
for (const owners of edgeOwners.values()) {
  if (owners.length === 2 && owners[0] !== owners[1]) {
    neighbours.get(owners[0]).add(owners[1]);
    neighbours.get(owners[1]).add(owners[0]);
  }
}
// Any cell that ended up isolated gets its geometrically closest peers instead.
for (const s of sites) {
  if (neighbours.get(s.num).size === 0) {
    sites
      .filter((o) => o !== s)
      .sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))
      .slice(0, 4)
      .forEach((o) => {
        neighbours.get(s.num).add(o.num);
        neighbours.get(o.num).add(s.num);
      });
  }
}

/* ---------------------------------------------------------------- hex cartogram */
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// Pointy-top hexes: find a spacing where enough hex centres fall inside Punjab.
function hexCandidates(size) {
  const hw = Math.sqrt(3) * size;
  const vh = 1.5 * size;
  const cells = [];
  for (let row = -1; PAD + row * vh < H + vh; row++) {
    const yc = PAD + row * vh;
    for (let col = -1; PAD + col * hw < W + hw; col++) {
      const xc = PAD + col * hw + (Math.abs(row % 2) ? hw / 2 : 0);
      if (pointInPoly({ x: xc, y: yc }, outline)) cells.push({ x: xc, y: yc, row, col });
    }
  }
  return largestConnected(cells);
}

/* Punjab's south-west salient is narrow enough that it can produce an island of
   hexes. Keep only the largest connected blob so the cartogram reads as one map. */
function largestConnected(cells) {
  const at = new Map(cells.map((c) => [c.row + ':' + c.col, c]));
  const seen = new Set();
  let best = [];
  for (const start of cells) {
    const sk = start.row + ':' + start.col;
    if (seen.has(sk)) continue;
    const blob = [];
    const stack = [start];
    seen.add(sk);
    while (stack.length) {
      const c = stack.pop();
      blob.push(c);
      const odd = Math.abs(c.row % 2) === 1;
      const deltas = odd
        ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
        : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
      for (const [dr, dc] of deltas) {
        const k = c.row + dr + ':' + (c.col + dc);
        if (at.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push(at.get(k));
        }
      }
    }
    if (blob.length > best.length) best = blob;
  }
  return best;
}

const SEATS = sites.length;
let lo = 8;
let hi = 80;
let hexSize = 24;
let hexCells = [];
for (let iter = 0; iter < 40; iter++) {
  const mid = (lo + hi) / 2;
  const cells = hexCandidates(mid);
  if (cells.length >= SEATS) {
    lo = mid;
    hexSize = mid;
    hexCells = cells;
  } else {
    hi = mid;
  }
}
if (hexCells.length < SEATS) {
  hexSize = 18;
  hexCells = hexCandidates(18);
}

/* Trim to exactly one hex per seat. Every cell then gets filled, so the
   cartogram renders as a solid blob with no holes and no stray islands.
   Shave the most peripheral cells first, never breaking connectivity. */
const nearestSite = (c) =>
  Math.min.apply(null, sites.map((s) => Math.hypot(s.x - c.x, s.y - c.y)));
while (hexCells.length > SEATS) {
  const ranked = hexCells
    .map((c) => {
      const odd = Math.abs(c.row % 2) === 1;
      const deltas = odd
        ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
        : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
      const degree = deltas.filter(([dr, dc]) =>
        hexCells.some((o) => o.row === c.row + dr && o.col === c.col + dc)
      ).length;
      return { c, degree, far: nearestSite(c) };
    })
    .sort((a, b) => a.degree - b.degree || b.far - a.far);
  let removed = false;
  for (const cand of ranked) {
    const trial = hexCells.filter((c) => c !== cand.c);
    if (largestConnected(trial).length === trial.length) {
      hexCells = trial;
      removed = true;
      break;
    }
  }
  if (!removed) break;
}

// Globally-greedy assignment: repeatedly take the cheapest (seat, hex) pair.
const pairs = [];
for (const s of sites) {
  for (const h of hexCells) pairs.push({ s, h, d: Math.hypot(s.x - h.x, s.y - h.y) });
}
pairs.sort((a, b) => a.d - b.d);
const takenSeat = new Set();
const takenHex = new Set();
for (const p of pairs) {
  if (takenSeat.size === sites.length) break;
  if (takenSeat.has(p.s.num) || takenHex.has(p.h)) continue;
  takenSeat.add(p.s.num);
  takenHex.add(p.h);
  p.s.hex = { x: round(p.h.x), y: round(p.h.y) };
}
const unplaced = sites.filter((s) => !s.hex);
if (unplaced.length) {
  throw new Error('unplaced hexes: ' + unplaced.map((s) => s.num).join(','));
}

/* Greedy alone leaves a few seats stranded far from their district cluster.
   Hill-climb over swap + relocate moves, scoring geographic fidelity against
   district cohesion, until no single move improves the layout. */
const COHESION = 0.85;
const free = hexCells.filter((h) => !takenHex.has(h)).map((h) => ({ x: round(h.x), y: round(h.y) }));
const byDistrict = {};
for (const s of sites) (byDistrict[s.district] ||= []).push(s);

const d2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

function layoutCost() {
  let cost = 0;
  for (const s of sites) cost += d2(s.x, s.y, s.hex.x, s.hex.y);
  for (const members of Object.values(byDistrict)) {
    const mx = members.reduce((t, m) => t + m.hex.x, 0) / members.length;
    const my = members.reduce((t, m) => t + m.hex.y, 0) / members.length;
    for (const m of members) cost += COHESION * d2(m.hex.x, m.hex.y, mx, my);
  }
  return cost;
}

let best = layoutCost();
for (let sweep = 0; sweep < 60; sweep++) {
  let improved = false;
  for (let i = 0; i < sites.length; i++) {
    // swap with another seat
    for (let j = i + 1; j < sites.length; j++) {
      const a = sites[i].hex;
      const b = sites[j].hex;
      sites[i].hex = b;
      sites[j].hex = a;
      const c = layoutCost();
      if (c < best - 1e-6) {
        best = c;
        improved = true;
      } else {
        sites[i].hex = a;
        sites[j].hex = b;
      }
    }
    // move onto a currently unused hex
    for (let k = 0; k < free.length; k++) {
      const a = sites[i].hex;
      sites[i].hex = free[k];
      const c = layoutCost();
      if (c < best - 1e-6) {
        best = c;
        free[k] = a;
        improved = true;
      } else {
        sites[i].hex = a;
      }
    }
  }
  if (!improved) {
    console.log('hex layout converged after ' + (sweep + 1) + ' sweep(s), cost ' + best.toFixed(0));
    break;
  }
}

// Drawn hexes are inset slightly so tiles read as separate. District outlines
// are traced on the full-size hex so neighbouring tiles share exact edges and
// the outline stitches into one ring per district.
const hexPoints = [];
const hexPointsFull = [];
for (let i = 0; i < 6; i++) {
  const a = (Math.PI / 180) * (60 * i - 30);
  hexPoints.push([round(Math.cos(a) * hexSize * 0.92), round(Math.sin(a) * hexSize * 0.92)]);
  hexPointsFull.push([round(Math.cos(a) * hexSize), round(Math.sin(a) * hexSize)]);
}

/* ------------------------------------------------- district boundary outlines
   An edge shared by two cells of the same district is interior; anything else
   is a district border. Stitch the border edges into polylines so the map can
   draw one crisp stroke per district instead of doubling every cell edge. */
function boundaryPaths(polysByMember) {
  const count = new Map();
  const store = new Map();
  for (const poly of polysByMember) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ka = p[0].toFixed(1) + ',' + p[1].toFixed(1);
      const kb = q[0].toFixed(1) + ',' + q[1].toFixed(1);
      if (ka === kb) continue;
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      count.set(k, (count.get(k) || 0) + 1);
      if (!store.has(k)) store.set(k, [p, q]);
    }
  }
  const edges = [];
  for (const [k, n] of count) if (n === 1) edges.push(store.get(k));

  // Walk edges into polylines.
  const at = new Map();
  const kk = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  edges.forEach((e, i) => {
    for (const p of e) {
      const k = kk(p);
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(i);
    }
  });
  const used = new Set();
  const paths = [];
  for (let i = 0; i < edges.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const line = [edges[i][0], edges[i][1]];
    // extend forward then backward
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const end = dir === 0 ? line[line.length - 1] : line[0];
        const cands = at.get(kk(end)) || [];
        let nextIdx = -1;
        for (const c of cands) if (!used.has(c)) { nextIdx = c; break; }
        if (nextIdx === -1) break;
        used.add(nextIdx);
        const e = edges[nextIdx];
        const other = kk(e[0]) === kk(end) ? e[1] : e[0];
        if (dir === 0) line.push(other);
        else line.unshift(other);
      }
    }
    if (line.length > 1) paths.push(line.map((p) => [round(p[0]), round(p[1])]));
  }
  return paths;
}

/* ---------------------------------------------------------------- districts */
const districts = {};
for (const s of sites) {
  if (!districts[s.district]) districts[s.district] = { name: s.district, seats: [] };
  districts[s.district].seats.push(s.num);
}
for (const d of Object.values(districts)) {
  const members = sites.filter((s) => d.seats.indexOf(s.num) !== -1);
  const totalArea = members.reduce((t, m) => t + m.area, 0);
  d.centroid = {
    x: round(members.reduce((t, m) => t + m.centroid.x * m.area, 0) / totalArea),
    y: round(members.reduce((t, m) => t + m.centroid.y * m.area, 0) / totalArea),
  };
  d.hexCentroid = {
    x: round(members.reduce((t, m) => t + m.hex.x, 0) / members.length),
    y: round(members.reduce((t, m) => t + m.hex.y, 0) / members.length),
  };
  d.border = boundaryPaths(members.map((m) => m.cell.map((p) => [p.x, p.y])));
  d.hexBorder = boundaryPaths(
    members.map((m) => hexPointsFull.map((p) => [round(m.hex.x + p[0]), round(m.hex.y + p[1])]))
  );
}

/* ---------------------------------------------------------------- emit */
const geometry = {
  viewBox: { width: W, height: H },
  outline: outline.map((p) => [round(p.x), round(p.y)]),
  hexSize: round(hexSize),
  hexPoints,
  seats: sites.map((s) => ({
    num: s.num,
    cell: s.cell.map((p) => [p.x, p.y]),
    centroid: [s.centroid.x, s.centroid.y],
    hex: [s.hex.x, s.hex.y],
    lat: s.lat,
    lon: s.lon,
    neighbours: Array.from(neighbours.get(s.num)).sort((a, b) => a - b),
  })),
  districts,
};

const outPath = path.join(HERE, '..', 'src', 'data', 'punjab-geometry.js');
fs.writeFileSync(
  outPath,
  '/* GENERATED by tools/build-geometry.mjs - do not edit by hand. */\n' +
    'window.PG = window.PG || {};\n' +
    'PG.GEOMETRY = ' +
    JSON.stringify(geometry) +
    ';\n'
);

const avgN = sites.reduce((t, s) => t + neighbours.get(s.num).size, 0) / sites.length;
console.log('viewBox ' + W + ' x ' + H);
console.log('seats: ' + geometry.seats.length);
console.log('hexSize: ' + geometry.hexSize + '  candidates: ' + hexCells.length);
console.log('districts: ' + Object.keys(districts).length);
console.log('avg neighbours: ' + avgN.toFixed(2));
console.log(
  'cell area min ' +
    Math.min.apply(null, sites.map((s) => s.area)).toFixed(1) +
    '  max ' +
    Math.max.apply(null, sites.map((s) => s.area)).toFixed(1)
);
console.log('written: ' + (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB');
