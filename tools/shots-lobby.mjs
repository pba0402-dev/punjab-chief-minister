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

/** Ask the OS for a free port, so a stale server can never hijack a run. */
async function freePort() {
  const net = await import('net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'simple');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'cmp-lobby-shots');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = await freePort();
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
process.on('exit', () => { try { php.kill(); } catch (e) {} });
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
  [host, 'aap', 'Simran Kaur Gill', 'Naya Punjab, Sacha Punjab', true],
  [others[0], 'inc', 'Ravinder Singh Bajwa', 'Punjab First', true],
  [others[1], 'bjp', 'Amrit Pal Sethi', 'Vikas Hi Vikas', false],
  [others[2], 'sad', 'Jaspreet Kaur Dhillon', 'Sadda Punjab', true],
];
for (const [who, party, name, slogan, ready] of roster) {
  await post('party', { ...creds(who), partyId: party });
  await post('details', { ...creds(who), candidateName: name, slogan });
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
  constituency:
    "var g=CMP.state.startElection({partyId:'aap',candidateName:'Simran Kaur Gill'," +
    "slogan:'Naya Punjab, Sacha Punjab',seed:'shot-seat'});g.mode='solo';" +
    "CMP.storage.save(g);CMP.app.setGame(g);CMP.app.goTo('election');" +
    "document.querySelectorAll('.panel-tab')[1].click();",
  campaign:
    "var g=CMP.state.startElection({partyId:'aap',candidateName:'Simran Kaur Gill'," +
    "slogan:'Naya Punjab, Sacha Punjab',seed:'shot'});g.mode='solo';" +
    "CMP.storage.save(g);CMP.app.setGame(g);CMP.app.goTo('election');" +
    "var seats=Object.keys(g.support);" +
    "CMP.campaign.play(g,'rally',seats[12],CMP.rng.rollsFor(g));" +
    "CMP.campaign.play(g,'community',seats[12],CMP.rng.rollsFor(g));" +
    "CMP.campaign.play(g,'deal',seats[12],{outcome:0.05,consequence:0.99,consequencePick:0.5});" +
    "g.seatsWon=CMP.campaign.seatsLed(g);CMP.storage.save(g);CMP.app.goTo('election');",
};

/* Play a game right through so the result screen has something to show. */
const resultGame = await post('create');
const rCreds = [{ code: resultGame.code, playerId: resultGame.playerId, token: resultGame.token }];
for (let i = 1; i < 4; i++) {
  const j = await post('join', { code: resultGame.code });
  rCreds.push({ code: resultGame.code, playerId: j.playerId, token: j.token });
}
const rNames = [
  ['aap', 'Simran Kaur Gill', 'Naya Punjab, Sacha Punjab'],
  ['inc', 'Ravinder Singh Bajwa', 'Punjab First'],
  ['bjp', 'Amrit Pal Sethi', 'Vikas Hi Vikas'],
  ['sad', 'Jaspreet Kaur Dhillon', 'Sadda Punjab'],
];
for (let i = 0; i < 4; i++) {
  await post('party', { ...rCreds[i], partyId: rNames[i][0] });
  await post('details', { ...rCreds[i], candidateName: rNames[i][1], slogan: rNames[i][2] });
  await post('ready', { ...rCreds[i], ready: true });
}
await post('start', rCreds[0]);
// A few moves each, then a report, then close the polls.
for (let i = 0; i < 4; i++) {
  await post('campaign', { ...rCreds[i], actionId: 'rally', constituency: 20 + i });
  await post('campaign', { ...rCreds[i], actionId: 'community', constituency: 40 + i });
}
await post('campaign', { ...rCreds[3], actionId: 'deal', constituency: 60 });
await post('report', { ...rCreds[0], accusedId: rCreds[3].playerId, reason: 'spending' });
await post('report', { ...rCreds[1], accusedId: rCreds[3].playerId, reason: 'influence' });
await post('declare', rCreds[0]);

const R_SESSION = JSON.stringify({
  code: resultGame.code,
  playerId: rCreds[0].playerId,
  token: rCreds[0].token,
});
SCENES.result =
  "window.localStorage.setItem('cmp.punjab.session.v1', " + JSON.stringify(R_SESSION) +
  ");CMP.app.goTo('lobby');";

const CASES = [
  { w: 1200, h: 1500 },
  { w: 390, h: 1400 },
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
