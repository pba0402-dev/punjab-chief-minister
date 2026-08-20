/**
 * Screenshots the multiplayer screens against a live PHP server.
 * Seeds a real four-player lobby over the API first, then loads the page as
 * one of those players so the shot shows a genuinely populated lobby.
 *
 *   node tools/shots-lobby.mjs [outDir]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'simple');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'cmp-lobby-shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8793;
const BASE = 'http://127.0.0.1:' + PORT + '/';
const API = BASE + 'api/index.php';
const DATA = path.join(os.tmpdir(), 'cmp-shot-data-' + Date.now());
const NL = String.fromCharCode(10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

const php = spawn('php', ['-S', '127.0.0.1:' + PORT, '-t', ROOT], {
  cwd: ROOT,
  env: { ...process.env, CMP_DATA_DIR: DATA },
  stdio: 'ignore',
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(API + '?action=health')).ok) break;
  } catch (e) {
    /* waiting */
  }
  await sleep(150);
}

const post = async (action, payload) =>
  (
    await fetch(API + '?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    })
  ).json();

/* Seed a lobby: host plus three friends, three of them ready. */
const host = await post('create');
const creds = (r) => ({ code: host.code, playerId: r.playerId, token: r.token });
const others = [];
for (let i = 0; i < 3; i++) others.push(await post('join', { code: host.code }));

const roster = [
  [host, 'aap', 'Simran Kaur Gill', 'Naya Punjab, Sacha Punjab', 100000000, true],
  [others[0], 'inc', 'Ravinder Singh Bajwa', 'Punjab First', 90000000, true],
  [others[1], 'bjp', 'Amrit Pal Sethi', 'Vikas Hi Vikas', 80000000, false],
  [others[2], 'sad', 'Jaspreet Kaur Dhillon', 'Sadda Punjab', 70000000, true],
];
for (const [who, party, name, slogan, budget, ready] of roster) {
  await post('party', { ...creds(who), partyId: party });
  await post('details', { ...creds(who), candidateName: name, slogan, budget });
  if (ready) await post('ready', { ...creds(who), ready: true });
}

const SESSION = JSON.stringify({
  code: host.code,
  playerId: host.playerId,
  token: host.token,
});

const SCENES = {
  home: '',
  multiplayer: "CMP.app.goTo('multiplayer');",
  lobby:
    "window.localStorage.setItem('cmp.punjab.session.v1', " +
    JSON.stringify(SESSION) +
    ");CMP.app.goTo('lobby');",
};

const CASES = [
  { w: 1200, h: 950 },
  { w: 390, h: 900 },
];

const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

for (const [scene, setup] of Object.entries(SCENES)) {
  // Serve a copy of the page with the scene script appended, same origin.
  const sceneFile = path.join(ROOT, '__shot-' + scene + '.html');
  fs.writeFileSync(
    sceneFile,
    indexHtml.replace(
      '</body>',
      '<script>window.addEventListener("load",function(){try{' +
        setup +
        '}catch(e){document.title="ERR "+e.message;}});</script></body>'
    )
  );

  for (const c of CASES) {
    const wrapper = path.join(ROOT, '__wrap-' + scene + '-' + c.w + '.html');
    fs.writeFileSync(
      wrapper,
      '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#000}' +
        'iframe{width:' + c.w + 'px;height:' + c.h + 'px;border:0;display:block}</style>' +
        '<iframe src="/__shot-' + scene + '.html"></iframe>'
    );

    const png = path.join(OUT, scene + '-' + c.w + '.png');
    await run(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--virtual-time-budget=7000',
        '--window-size=' + (c.w + 100) + ',' + (c.h + 16),
        '--screenshot=' + png,
        BASE + path.basename(wrapper),
      ],
      { timeout: 90000 }
    ).catch((e) => console.log('  ! ' + scene + '-' + c.w + ': ' + e.message.split(NL)[0]));
    console.log('shot: ' + path.basename(png));
    fs.unlinkSync(wrapper);
  }
  fs.unlinkSync(sceneFile);
}

php.kill();
fs.rmSync(DATA, { recursive: true, force: true });
console.log(NL + 'game code was ' + host.code + '  ->  ' + OUT);
