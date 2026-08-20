/**
 * Multiplayer API test run.
 * ------------------------------------------------------------------
 * Boots the PHP built-in server against simple/ and drives the lobby the way
 * four separate devices would: create, join, pick parties, fill details, ready
 * up, start. Also covers the awkward cases — duplicate parties, a fifth
 * player, a non-host trying to start, disconnect and host transfer.
 *
 *   node tools/test-api.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';


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
const PORT = await freePort();
const BASE = 'http://127.0.0.1:' + PORT + '/api/index.php';
const DATA = path.join(os.tmpdir(), 'cmp-api-test-' + Date.now());

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    failures.push(name + (detail ? ' — ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}
const section = (t) => console.log('\n' + t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- server */

fs.mkdirSync(DATA, { recursive: true });
const php = spawn('php', ['-S', '127.0.0.1:' + PORT, '-t', ROOT], {
  cwd: ROOT,
  env: { ...process.env, CMP_DATA_DIR: DATA },
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.on('exit', () => { try { php.kill(); } catch (e) {} });
process.on('uncaughtException', (e) => { try { php.kill(); } catch (x) {} throw e; });
const phpErrors = [];
php.stderr.on('data', (d) => {
  const s = String(d);
  if (/Fatal error|Parse error|Warning|Uncaught/i.test(s)) phpErrors.push(s.trim());
});

// Wait for it to accept connections.
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(BASE + '?action=health');
    if (r.ok) break;
  } catch (e) {
    /* not up yet */
  }
  await sleep(150);
}

/* ---------------------------------------------------------------- client */

async function call(action, payload, method) {
  const url = BASE + '?action=' + action;
  let res;
  if ((method || 'POST') === 'GET') {
    const qs = new URLSearchParams(payload || {}).toString();
    res = await fetch(url + '&' + qs);
  } else {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  }
  const json = await res.json();
  json._status = res.status;
  return json;
}

/** A player handle that remembers its own credentials, like a real client. */
function player(code, id, token) {
  const creds = () => ({ code, playerId: id, token });
  return {
    code,
    id,
    token,
    state: () => call('state', creds(), 'GET'),
    party: (partyId) => call('party', { ...creds(), partyId }),
    details: (candidateName, slogan, budget) =>
      call('details', { ...creds(), candidateName, slogan, budget }),
    ready: (r) => call('ready', { ...creds(), ready: r === undefined ? true : r }),
    start: () => call('start', creds()),
    leave: () => call('leave', creds()),
  };
}

/* ---------------------------------------------------------------- health */

section('Health');
const health = await call('health', {}, 'GET');
check('api responds', health.ok === true);
check('data dir is writable', health.writable === true);
check('php 8+', parseInt(health.php, 10) >= 8, health.php);

/* ---------------------------------------------------------------- create */

section('Create game');
const created = await call('create');
check('create succeeds', created.ok === true);
check('returns a game code', typeof created.code === 'string');
check('code is 5 characters', created.code && created.code.length === 5, created.code);
check(
  'code uses only unambiguous characters',
  /^[23479ACDEFGHJKMNPQRTUVWXY]{5}$/.test(created.code || ''),
  created.code
);
check('returns a player id and token', !!created.playerId && !!created.token);
check('code is not the internal id', created.code !== created.playerId);
check('creator is host', created.game.youAreHost === true);
check('lobby shows 1 player', created.game.playerCount === 1);
check('lobby has 4 slots', created.game.players.length === 4);
check('slots 2-4 are empty', created.game.players.slice(1).every((s) => s.empty === true));

const p1 = player(created.code, created.playerId, created.token);

// Codes should differ between games.
const second = await call('create');
check('a second game gets a different code', second.code !== created.code);
await player(second.code, second.playerId, second.token).leave();

/* ---------------------------------------------------------------- join */

section('Join game');
// QQQQQ is well-formed but belongs to no game; ZZZZZ and "abc" are malformed
// because Z is not in the alphabet and the length is wrong.
const unknownCode = await call('join', { code: 'QQQQQ' });
check(
  'a valid but unused code is refused',
  unknownCode.ok === false && unknownCode._status === 404,
  'status ' + unknownCode._status
);
const malformed = await call('join', { code: 'abc' });
check('a malformed code is refused', malformed.ok === false && malformed._status === 400);
const outsideAlphabet = await call('join', { code: 'ZZZZZ' });
check('a code using excluded characters is refused', outsideAlphabet.ok === false);

const j2 = await call('join', { code: created.code.toLowerCase() });
check('joining is case-insensitive', j2.ok === true);
const p2 = player(created.code, j2.playerId, j2.token);
check('second player gets slot 2', j2.game.players[1].empty === false);
check('lobby now shows 2 players', j2.game.playerCount === 2);
check('second player is not host', j2.game.youAreHost === false);

const j3 = await call('join', { code: created.code });
const p3 = player(created.code, j3.playerId, j3.token);
const j4 = await call('join', { code: created.code });
const p4 = player(created.code, j4.playerId, j4.token);
check('three players join', j3.ok === true && j4.ok === true);
check('lobby shows 4 / 4', j4.game.playerCount === 4);

const j5 = await call('join', { code: created.code });
check('a fifth player is refused', j5.ok === false, JSON.stringify(j5).slice(0, 90));
check('refusal explains the game is full', /full/i.test(j5.error || ''), j5.error);

/* ---------------------------------------------------------------- parties */

section('Party selection');
const r1 = await p1.party('aap');
check('player 1 takes AAP', r1.ok === true);
check('AAP shows as taken', (r1.game.takenParties || []).includes('aap'));

const clash = await p2.party('aap');
check('player 2 cannot also take AAP', clash.ok === false, clash.error);
check('the clash explains itself', /already taken/i.test(clash.error || ''), clash.error);
check('clash still returns the current lobby', !!clash.game);

check('player 2 takes INC', (await p2.party('inc')).ok === true);
check('player 3 takes BJP', (await p3.party('bjp')).ok === true);
check('player 4 takes SAD', (await p4.party('sad')).ok === true);

const afterParties = await p1.state();
check('all four parties are taken', afterParties.game.takenParties.length === 4);
check('unknown party is refused', (await p1.party('xyz')).ok === false);

// Swapping frees the old party.
await p4.party('');
const freed = await p1.state();
check('clearing a party frees it', !freed.game.takenParties.includes('sad'));
check('player 4 can retake SAD', (await p4.party('sad')).ok === true);

/* ---------------------------------------------------------------- details */

section('Player details and ready');
const notReadyYet = await p1.ready(true);
check('cannot ready up with no details', notReadyYet.ok === false, notReadyYet.error);

await p1.details('Simran Kaur Gill', 'Naya Punjab, Sacha Punjab', 100000000);
await p2.details('Ravinder Singh Bajwa', 'Punjab First', 90000000);
await p3.details('Amrit Pal Sethi', 'Vikas Hi Vikas', 80000000);
await p4.details('Jaspreet Kaur Dhillon', 'Sadda Punjab', 70000000);

const withDetails = await p1.state();
const me = withDetails.game.players.find((s) => s.isYou);
check('details are stored', me.candidateName === 'Simran Kaur Gill');
check('slogan is stored', me.slogan === 'Naya Punjab, Sacha Punjab');
check('every player is granted ₹5 crore', me.budget === 50000000, 'got ' + me.budget);
check('nothing is spent yet', me.spent === 0);
check('remaining equals the full purse', me.remaining === 50000000);
check('political heat starts at zero', me.heat === 0);
check('player reads as complete', me.complete === true);

// The client sends a budget on purpose here: the server must ignore it.
const tooLong = await p1.details('x'.repeat(200), 'y'.repeat(200), 999999999999999);
const capped = tooLong.game.players.find((s) => s.isYou);
check('long name is truncated', capped.candidateName.length <= 60, 'len ' + capped.candidateName.length);
check(
  'a client cannot set its own budget',
  capped.budget === 50000000,
  'got ' + capped.budget
);
await p1.details('Simran Kaur Gill', 'Naya Punjab, Sacha Punjab', 100000000);

/* ---------------------------------------------------------------- start */

section('Start rules');
const earlyStart = await p1.start();
check('host cannot start before everyone is ready', earlyStart.ok === false, earlyStart.error);

check('player 1 readies', (await p1.ready(true)).ok === true);
check('player 2 readies', (await p2.ready(true)).ok === true);
check('player 3 readies', (await p3.ready(true)).ok === true);

const stillBlocked = await p1.start();
check('one unready player still blocks the start', stillBlocked.ok === false, stillBlocked.error);

await p4.ready(true);
const nonHostStart = await p2.start();
check('a non-host cannot start', nonHostStart.ok === false && nonHostStart._status === 403, nonHostStart.error);

const started = await p1.start();
check('host starts the election', started.ok === true, started.error);
check('phase becomes election', started.game.phase === 'election');
check('turn becomes 1', started.game.turn === 1);

const lateJoin = await call('join', { code: created.code });
check('nobody can join after the start', lateJoin.ok === false, lateJoin.error);
check('party changes are refused after the start', (await p2.party('bjp')).ok === false);

/* ---------------------------------------------------------------- auth */

section('Authentication');
const noToken = await call('state', { code: created.code, playerId: p1.id, token: 'wrong' }, 'GET');
check('a bad token is rejected', noToken.ok === false && noToken._status === 403);
const noPlayer = await call('state', { code: created.code, playerId: 'nope', token: 'x' }, 'GET');
check('an unknown player is rejected', noPlayer.ok === false && noPlayer._status === 403);

/* ------------------------------------------------- reconnect + host move */

section('Disconnect, reconnect and host transfer');
const game2 = await call('create');
const h = player(game2.code, game2.playerId, game2.token);
const gj = await call('join', { code: game2.code });
const g = player(game2.code, gj.playerId, gj.token);

await h.party('aap');
await h.details('Host Candidate', 'Host slogan', 50000000);
await g.party('inc');
await g.details('Guest Candidate', 'Guest slogan', 50000000);

// A player who goes quiet is reported as disconnected but keeps their slot.
console.log('  (waiting for the connection timeout to elapse…)');
await sleep(21000);
const afterSilence = await g.state(); // only the guest checks in
check('the quiet host is shown as disconnected', afterSilence.game.players[0].connected === false);
check('the quiet host keeps their slot', afterSilence.game.players[0].empty === false);
check('their party is still theirs', afterSilence.game.players[0].partyId === 'aap');
check('host role moves to the connected player', afterSilence.game.youAreHost === true, 'guest should now host');
check('host id points at the guest', afterSilence.game.hostId === g.id);

// The original host comes back with the same credentials.
const reconnected = await h.state();
check('the original host reconnects with the same code', reconnected.ok === true);
check('they are connected again', reconnected.game.players[0].connected === true);
check('their details survived', reconnected.game.players[0].candidateName === 'Host Candidate');
check('their budget survived', reconnected.game.players[0].budget === 50000000);

/* ---------------------------------------------------------------- leave */

section('Leaving');
const left = await g.leave();
check('leaving succeeds', left.ok === true);
const afterLeave = await h.state();
check('the slot is freed', afterLeave.game.playerCount === 1);
check('host returns to the remaining player', afterLeave.game.youAreHost === true);

/* ---------------------------------------------------------------- persist */

section('Persistence');
const files = fs.readdirSync(DATA).filter((f) => f.startsWith('game-'));
check('games are stored on the server', files.length >= 1, files.length + ' file(s)');
const raw = JSON.parse(fs.readFileSync(path.join(DATA, files[0]), 'utf8'));
check('stored game has a code', typeof raw.code === 'string');
check('stored game has players', Object.keys(raw.players).length >= 1);
check('stored game keeps a constituency container', raw.constituencies !== undefined);
check('the data directory is protected from the web', fs.existsSync(path.join(DATA, '.htaccess')));

const publicFields = JSON.stringify(afterLeave.game);
check('tokens are never sent to clients', !publicFields.includes(h.token));

/* ---------------------------------------------------------------- errors */

section('Server log');
check('no PHP warnings or fatals', phpErrors.length === 0, phpErrors.slice(0, 2).join(' | '));

php.kill();
fs.rmSync(DATA, { recursive: true, force: true });

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
