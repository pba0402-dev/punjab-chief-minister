/**
 * preview-map.mjs - dev-only sanity check.
 * Rasterises the generated Voronoi cells to a PNG so the map can be eyeballed
 * without a browser. Not part of the game build.
 *   node tools/preview-map.mjs [out.png] [--hex]
 */
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(HERE, '..', 'src', 'data', 'punjab-geometry.js'), 'utf8');
const GEO = JSON.parse(src.slice(src.indexOf('PG.GEOMETRY = ') + 14, src.lastIndexOf(';')));

const outFile = process.argv[2] || 'map-preview.png';
const HEX = process.argv.includes('--hex');

const SCALE = 0.62;
const Wd = Math.round(GEO.viewBox.width * SCALE);
const Hd = Math.round(GEO.viewBox.height * SCALE);
const px = new Uint8Array(Wd * Hd * 3).fill(18);

const districtNames = Object.keys(GEO.districts).sort();
function colorFor(i, n) {
  const h = ((i * 360) / n + 15) % 360;
  const s = 0.55 + ((i % 3) * 0.12);
  const l = 0.42 + ((i % 4) * 0.07);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const ax = poly[i][0], ay = poly[i][1];
    const bx = poly[j][0], by = poly[j][1];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

const seatDistrict = {};
for (const [name, d] of Object.entries(GEO.districts)) {
  for (const n of d.seats) seatDistrict[n] = districtNames.indexOf(name);
}

const shapes = GEO.seats.map((s) => {
  const poly = HEX
    ? GEO.hexPoints.map((p) => [s.hex[0] + p[0], s.hex[1] + p[1]])
    : s.cell;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { s, poly, x0, y0, x1, y1, col: colorFor(seatDistrict[s.num], districtNames.length) };
});

for (let yy = 0; yy < Hd; yy++) {
  for (let xx = 0; xx < Wd; xx++) {
    const x = (xx + 0.5) / SCALE;
    const y = (yy + 0.5) / SCALE;
    for (const sh of shapes) {
      if (x < sh.x0 || x > sh.x1 || y < sh.y0 || y > sh.y1) continue;
      if (inPoly(x, y, sh.poly)) {
        const o = (yy * Wd + xx) * 3;
        px[o] = sh.col[0];
        px[o + 1] = sh.col[1];
        px[o + 2] = sh.col[2];
        break;
      }
    }
  }
}

// --- minimal PNG encoder -----------------------------------------------
const raw = Buffer.alloc(Hd * (Wd * 3 + 1));
for (let y = 0; y < Hd; y++) {
  raw[y * (Wd * 3 + 1)] = 0;
  Buffer.from(px.buffer, y * Wd * 3, Wd * 3).copy(raw, y * (Wd * 3 + 1) + 1);
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body));
  return Buffer.concat([len, body, crc]);
}
let table = null;
function crc32(buf) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(Wd, 0);
ihdr.writeUInt32BE(Hd, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(outFile, png);
console.log('wrote ' + outFile + ' (' + Wd + 'x' + Hd + ', ' + (png.length / 1024).toFixed(0) + ' KB)');
