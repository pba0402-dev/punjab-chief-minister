/**
 * Renders the home and leaderboard screens against a real API, so the live
 * statistics are looked at with real data in them rather than an empty state.
 *
 * Starts PHP's built-in server on a throwaway data directory, writes the
 * profiles a few finished elections would have produced, then screenshots at
 * the phone widths the brief names. Nothing here touches production: the data
 * directory is created by mkdtemp and deleted at the end, and no seeding route
 * exists in the API.
 *
 *   node tools/shots-profile.mjs [outDir]
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'simple');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'cmp-shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const NL = String.fromCharCode(10);

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-profile-'));

/* ------------------------------------------------------------- php */

const PHP_PORT = 8801;
const php = spawn(
  'php',
  ['-S', '127.0.0.1:' + PHP_PORT, '-t', ROOT],
  { env: { ...process.env, CMP_DATA_DIR: DATA }, stdio: 'ignore' }
);
await new Promise((r) => setTimeout(r, 900));

function api(action, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PHP_PORT,
        path: '/api/index.php?action=' + action,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let out = '';
        res.on('data', (d) => (out += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(out));
          } catch (e) {
            reject(new Error(out.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

/* --------------------------------------------------- some real results */

/*
 * Written straight into the throwaway data directory rather than through the
 * API.
 *
 * The record endpoint is deliberately self-reported: what it stores never
 * reaches the leaderboard, because a browser's account of its own solo game is
 * not evidence. Only a game the server played itself counts for rank — and
 * playing four full elections to take a screenshot is not a good trade.
 *
 * So this writes the files a real run would have produced, into a directory
 * created by mkdtemp and deleted at the end. There is no seeding route in the
 * API and none is added here: nothing in this file can touch a live install.
 */
const PARTIES = ['aap', 'inc', 'bjp', 'sad'];
const PEOPLE = [
  { name: 'Simran Kaur Gill', runs: [[62, true], [48, false], [71, true], [39, false], [55, false]] },
  { name: 'Harjit Toor', runs: [[59, true], [44, false], [33, false]] },
  { name: 'Rupinder Randhawa', runs: [[77, true], [51, false]] },
  { name: 'Lakhwinder Singh', runs: [[41, false], [29, false]] },
  { name: 'Manpreet Dhillon', runs: [[35, false]] },
];

const ACHIEVEMENTS = { 62: ['firstwin', 'majority'], 71: ['majority'], 77: ['majority', 'landslide'] };

fs.mkdirSync(path.join(DATA, 'profiles'), { recursive: true });

const ids = {};
const counters = { players: 0, started: 0, elections: 0, governments: 0, coalitions: 0, byParty: {} };
const now = Math.floor(Date.now() / 1000);

PEOPLE.forEach((person, i) => {
  const id = String(i + 1).repeat(32).slice(0, 32);
  ids[person.name] = id;
  counters.players++;

  const profile = {
    id,
    name: person.name,
    avatar: id,
    createdAt: now - 86400,
    lastSeen: now,
    played: 0,
    won: 0,
    seatsTotal: 0,
    bestResult: 0,
    coalitionWins: 0,
    verifiedPlayed: 0,
    verifiedWon: 0,
    verifiedSeats: 0,
    byParty: {},
    achievements: [],
    history: [],
  };

  person.runs.forEach(([seats, won], r) => {
    const party = PARTIES[r % 4];
    const coalition = !won && seats > 45;

    profile.played++;
    profile.verifiedPlayed++;
    profile.seatsTotal += seats;
    profile.verifiedSeats += seats;
    profile.bestResult = Math.max(profile.bestResult, seats);
    if (won) {
      profile.won++;
      profile.verifiedWon++;
    }
    if (coalition) profile.coalitionWins++;

    const row = profile.byParty[party] || { played: 0, won: 0, seats: 0 };
    row.played++;
    row.seats += seats;
    if (won) row.won++;
    profile.byParty[party] = row;

    (ACHIEVEMENTS[seats] || []).forEach((aid) => {
      if (!profile.achievements.some((a) => a.id === aid)) {
        profile.achievements.push({ id: aid, at: now - (10 - r) * 3600 });
      }
    });

    profile.history.push({
      at: now - (10 - r) * 3600,
      party,
      seats,
      won,
      coalition,
      outcome: won ? 'majority' : coalition ? 'hung' : 'lost',
      verified: true,
    });

    const pc = counters.byParty[party] || { played: 0, won: 0 };
    pc.played++;
    if (won) pc.won++;
    counters.byParty[party] = pc;
  });

  fs.writeFileSync(
    path.join(DATA, 'profiles', id + '.json'),
    JSON.stringify(profile, null, 2)
  );
});

// One election per set of four contests, near enough for a screenshot.
counters.elections = 6;
counters.started = 9;
counters.governments = 4;
counters.coalitions = 1;
fs.writeFileSync(path.join(DATA, 'counters.json'), JSON.stringify(counters, null, 2));

const stats = await api('stats', {});
console.log(
  'seeded: ' + stats.summary.players + ' players, ' +
  stats.summary.elections + ' elections, ' +
  stats.leaderboard.length + ' on the leaderboard'
);

/* ------------------------------------------------------------- shots */

/*
 * The profile screen is not shot here.
 *
 * It paints when its request comes back, and headless Chrome takes the
 * picture without waiting for a repaint that a post-load timer or promise
 * triggers — so what came out was its loading state, every time, however long
 * the virtual-time budget. That is a limit of the camera, not of the screen:
 * tools/test-multiplayer.mjs opens it against a real API and checks the name,
 * the portrait, the six figures, the achievements and the history are all
 * there, including the path where the data arrives after the screen does.
 */
const SCENES = {
  'home-live': "CMP.profile.create('Simran Kaur Gill');",
  'leaderboard-live': "CMP.app.goTo('leaderboard');",
};

const CASES = [
  { w: 430, h: 932 },
  { w: 390, h: 844 },
  { w: 375, h: 812 },
  { w: 320, h: 700 },
];

function auditScript(setup) {
  return [
    '<script>window.addEventListener("load",function(){',
    'var NL=String.fromCharCode(10);',
    'try{' + setup + '}catch(e){document.title="SCENE ERROR "+e.message;}',
    'setTimeout(function(){',
    'var W=document.documentElement.clientWidth, bad=[];',
    'var all=document.querySelectorAll("*");',
    'function inScroller(n){',
    '  for(var p=n.parentElement;p;p=p.parentElement){',
    '    var o=getComputedStyle(p).overflowX;',
    '    if(o==="auto"||o==="scroll")return true;',
    '  }',
    '  return false;',
    '}',
    'for(var i=0;i<all.length;i++){',
    '  var n=all[i]; if(n.id==="audit")continue;',
    '  if(inScroller(n))continue;',
    '  var r=n.getBoundingClientRect();',
    '  if(r.width>0&&(r.right>W+1||r.left<-1)){',
    '    var c=(typeof n.className==="string")?n.className:"";',
    '    bad.push(n.tagName.toLowerCase()+(c?"."+c.trim().split(/ +/).join("."):"")+" R="+Math.round(r.right));',
    '  }',
    '}',
    'var d=document.createElement("pre"); d.id="audit";',
    'd.style.cssText="position:fixed;left:0;right:0;top:0;z-index:99999;background:#000;'
      + 'color:#0f0;font:11px monospace;padding:5px;margin:0;white-space:pre-wrap";',
    'd.textContent="clientW="+W+"  scrollW="+document.documentElement.scrollWidth',
    '  +"  overflowing="+bad.length+(bad.length?NL+bad.slice(0,8).join(NL):"");',
    'document.body.appendChild(d);',
    '},900);',
    '});</script>',
  ].join(NL);
}

/*
 * The scenes are written into simple/ as temporary files and served by PHP
 * itself, so the page and the API share an origin with no proxy in between.
 * A proxy would have to get POST bodies exactly right to be invisible, and
 * getting that subtly wrong looks like an application bug.
 */
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sceneFiles = [];

for (const name of Object.keys(SCENES)) {
  const file = path.join(ROOT, '__scene-' + name + '.html');
  fs.writeFileSync(
    file,
    indexHtml.replace('</body>', auditScript(SCENES[name]) + '</body>')
  );
  sceneFiles.push(file);
}

const BASE = 'http://127.0.0.1:' + PHP_PORT;

const frame = (w, h, src) =>
  '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}' +
  'iframe{width:' + w + 'px;height:' + h + 'px;border:0;display:block}</style>' +
  '<iframe src="' + src + '"></iframe>';

const holder = path.join(os.tmpdir(), 'cmp-profile-frames');
if (!fs.existsSync(holder)) fs.mkdirSync(holder, { recursive: true });

for (const name of Object.keys(SCENES)) {
  for (const c of CASES) {
    const file = path.join(holder, name + '-' + c.w + '.html');
    fs.writeFileSync(file, frame(c.w, c.h, BASE + '/__scene-' + name + '.html'));
    const shot = path.join(OUT, name + '-' + c.w + '.png');
    await run(CHROME, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      // Without this Chrome draws the frame it has and exits, which for a
      // screen that paints when a request comes back means photographing
      // its loading state.
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=12000',
      '--window-size=' + Math.max(520, c.w) + ',' + c.h,
      '--screenshot=' + shot,
      'file:///' + file.replace(/\\/g, '/'),
    ]);
    console.log('shot: ' + path.basename(shot));
  }
}

sceneFiles.forEach((f) => fs.rmSync(f, { force: true }));
php.kill();
fs.rmSync(DATA, { recursive: true, force: true });
console.log(NL + 'wrote to ' + OUT);
