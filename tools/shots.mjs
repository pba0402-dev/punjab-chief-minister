/**
 * Screenshot harness (dev only).
 * Wraps the built game in a copy that drives itself into a given state, then
 * renders it with headless Chrome so the UI can actually be looked at.
 *
 *   node tools/shots.mjs [outDir]
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'punjab-shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const bundle = fs.readFileSync(path.join(ROOT, 'dist', 'punjab-cm.html'), 'utf8');

const SCENES = {
  setup: '',

  campaign: `
    var app = PG.__app;
    var g = PG.engine.newGame({
      stateId: 'punjab', partyId: 'ppp', candidateName: 'Harleen Kaur Sandhu',
      slogan: 'Khet, Kaam, Khushhali', strategyId: 'grassroots',
      difficulty: 'normal', seed: 'shot-demo'
    });
    PG.__begin(g);
    for (var t = 0; t < 4; t++) {
      var proj = PG.model.projectAll(g, { fog: true });
      var picks = PG.PUNJAB_SEATS
        .map(function (d) { return { n: d.num, gap: proj.bySeat[d.num].rating.gap }; })
        .filter(function (s) { return s.gap < 8; })
        .sort(function (a, b) { return Math.abs(a.gap) - Math.abs(b.gap); });
      PG.engine.play(g, 'volunteers', { district: 'Ludhiana' });
      if (t === 2) PG.engine.play(g, 'leadershipTour', { district: 'Bathinda' });
      for (var i = 0; i < 6 && picks[i]; i++) PG.engine.play(g, 'rally', { seat: picks[i].n });
      PG.engine.endTurn(g);
    }
    PG.__begin(g);
    PG.__select(73);
  `,

  district: `
    var g = PG.engine.newGame({
      stateId: 'punjab', partyId: 'pdp', candidateName: 'Ravinder Singh Bajwa',
      strategyId: 'airwar', difficulty: 'normal', seed: 'shot-district'
    });
    for (var t = 0; t < 3; t++) {
      PG.engine.play(g, 'advertising', { district: 'Jalandhar' });
      PG.engine.play(g, 'volunteers', { district: 'Amritsar' });
      PG.engine.endTurn(g);
    }
    PG.__begin(g);
    PG.__district('Ludhiana');
    PG.__tab('districts');
  `,

  results: `
    var g = PG.engine.newGame({
      stateId: 'punjab', partyId: 'ppp', candidateName: 'Harleen Kaur Sandhu',
      strategyId: 'grassroots', difficulty: 'easy', seed: 'shot-win'
    });
    for (var t = 0; t < 10; t++) {
      var proj = PG.model.projectAll(g, { fog: true });
      var picks = PG.PUNJAB_SEATS
        .map(function (d) { return { n: d.num, gap: proj.bySeat[d.num].rating.gap, d: d.district }; })
        .filter(function (s) { return s.gap < 8; })
        .sort(function (a, b) { return Math.abs(a.gap) - Math.abs(b.gap); });
      if (t < 3) PG.engine.play(g, 'volunteers', { district: picks[0] ? picks[0].d : 'Ludhiana' });
      if (t >= 3 && t <= 6 && picks[0]) PG.engine.play(g, 'leadershipTour', { district: picks[0].d });
      for (var i = 0; i < 6 && picks[i]; i++) PG.engine.play(g, 'rally', { seat: picks[i].n });
      PG.engine.endTurn(g);
    }
    PG.engine.runElection(g);
    PG.__begin(g);
  `,
};

// Small hooks the scenes drive the app through, injected only into the copies.
const HOOKS = `
  PG.__begin = function (g) { PG.__app.loadGame(g); };
  PG.__select = function (n) { PG.__app.selectSeat(n); };
  PG.__district = function (d) { PG.__app.selectDistrict(d, { zoom: true }); };
  PG.__tab = function (t) { PG.__app.setTab(t); };
`;

const sizes = { desktop: [1600, 1000], mobile: [412, 900] };

for (const [name, code] of Object.entries(SCENES)) {
  for (const [sizeName, [w, h]] of Object.entries(sizes)) {
    if (sizeName === 'mobile' && name === 'district') continue;
    const file = path.join(OUT, name + '-' + sizeName + '.html');
    const png = path.join(OUT, name + '-' + sizeName + '.png');
    const injected = bundle.replace(
      '</body>',
      '<script>window.addEventListener("load", function () {' +
        HOOKS +
        'try {' +
        code +
        '} catch (e) { document.title = "SCENE ERROR: " + e.message; console.error(e); }' +
        '});</script></body>'
    );
    fs.writeFileSync(file, injected);
    execFileSync(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--virtual-time-budget=4000',
        '--window-size=' + w + ',' + h,
        '--screenshot=' + png,
        'file:///' + file.replace(/\\/g, '/'),
      ],
      { stdio: 'pipe', timeout: 90000 }
    );
    console.log('shot: ' + path.basename(png));
  }
}
console.log('\nwrote to ' + OUT);
