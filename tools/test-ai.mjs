/**
 * Opponents, portraits and the leaderboard, through the real interface.
 * ------------------------------------------------------------------
 * Two people sit down; the other two parties are taken by opponents. This
 * plays several rounds against a real server and checks the things that make
 * a four-way scoreboard mean anything:
 *
 *   - four candidates appear, two of them opponents
 *   - the opponents have names, faces and money of their own
 *   - they actually campaign, and it costs them
 *   - both humans see identical standings
 *   - a face never changes, including across a reconnection
 *
 * Rounds and breaks are shortened with the same environment overrides the
 * other suites use. Nothing else is changed: the server still owns the clock
 * and still resolves every move.
 *
 *   node tools/test-ai.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';

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
const BASE = 'http://127.0.0.1:' + PORT + '/';
const DATA = path.join(os.tmpdir(), 'cmp-ai-test-' + Date.now());
const ROUND_SECONDS = 5;
const BREAK_SECONDS = 3;
const ROUNDS_TO_PLAY = 5;

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
  env: {
    ...process.env,
    CMP_DATA_DIR: DATA,
    CMP_ROUND_SECONDS: String(ROUND_SECONDS),
    CMP_INTERMISSION_SECONDS: String(BREAK_SECONDS),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.on('exit', () => {
  try {
    php.kill();
  } catch (e) {
    /* already gone */
  }
});
const phpErrors = [];
php.stderr.on('data', (d) => {
  const t = String(d);
  if (/Fatal error|Parse error|Uncaught/i.test(t)) phpErrors.push(t.trim());
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE + 'api/index.php?action=health')).ok) break;
  } catch (e) {
    /* not up yet */
  }
  await sleep(150);
}

/* ---------------------------------------------------------------- clients */

const consoleErrors = [];
const openWindows = [];

async function openClient(label, seedSession) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (/Not implemented/i.test(e.message)) return;
    consoleErrors.push(label + ' jsdomError: ' + e.message);
  });
  vc.on('error', (...a) => consoleErrors.push(label + ' console.error: ' + a.join(' ')));

  const dom = await JSDOM.fromURL(BASE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = (url, opts) => fetch(new URL(url, BASE).toString(), opts);
      if (seedSession) {
        window.localStorage.setItem('cmp.punjab.session.v1', JSON.stringify(seedSession));
      }
      window.addEventListener('error', (e) =>
        consoleErrors.push(label + ' window.error: ' + e.message)
      );
    },
  });

  await new Promise((resolve) => {
    const done = () => setTimeout(resolve, 80);
    if (dom.window.document.readyState === 'complete') done();
    else dom.window.addEventListener('load', done, { once: true });
  });

  openWindows.push(dom);
  const q = (sel) => dom.window.document.querySelector(sel);
  const qq = (sel) => Array.from(dom.window.document.querySelectorAll(sel));

  return {
    label,
    dom,
    q,
    qq,
    text: () => dom.window.document.body.textContent,
    game: () => dom.window.CMP.app.getGame(),
    screen: () => dom.window.CMP.app.getScreen(),
    session: () => dom.window.CMP.net.getSession(),
    click: (node) => {
      if (!node) throw new Error(label + ': tried to click a missing element');
      node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    type: (node, value) => {
      node.value = value;
      node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    },
    button: (l) => qq('button').find((b) => b.textContent.indexOf(l) === 0),
    until: async (name, fn, timeout = 25000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (fn()) return true;
        await sleep(100);
      }
      return false;
    },
  };
}

/* ------------------------------------------------------------ two humans */

section('Two people sit down');

const host = await openClient('host');
host.click(host.qq('.h-play-btn').find((b) => /Play with friends/i.test(b.textContent)));
host.click(host.button('CREATE GAME'));
await host.until('lobby', () => !!host.q('.screen-lobby'));
await host.until('code', () =>
  /^[23479ACDEFGHJKMNPQRTUVWXY]{5}$/.test(host.q('.code-value').textContent.trim())
);
const code = host.q('.code-value').textContent.trim();

const guest = await openClient('guest');
guest.click(guest.qq('.h-play-btn').find((b) => /Play with friends/i.test(b.textContent)));
guest.click(guest.button('JOIN GAME'));
guest.type(guest.q('.field-input'), code);
guest.click(guest.button('JOIN'));
check('a second player joined', await guest.until('lobby', () => !!guest.q('.screen-lobby')));

const humans = [host, guest];
const NAMES = ['Simran Kaur Gill', 'Ravinder Singh Bajwa'];
const PARTIES = ['Aam Aadmi Party', 'Indian National Congress'];

for (let i = 0; i < humans.length; i++) {
  const c = humans[i];
  await c.until('parties', () => c.qq('.party-card').length >= 4);
  c.click(c.qq('.party-card').find((b) => b.textContent.indexOf(PARTIES[i]) !== -1));
  await sleep(250);
  const inputs = c.qq('.field-input');
  c.type(inputs[0], NAMES[i]);
  await sleep(900);
  c.click(c.button('READY'));
  await sleep(250);
}

check('the host can start with two players',
  await host.until('startable', () => {
    const b = host.button('START ELECTION');
    return b && !b.disabled;
  }));

/* --------------------------------------------------------- the opponents */

section('The empty parties get opponents');

host.click(host.button('START ELECTION'));
for (const c of humans) {
  check(c.label + ' reached the campaign', await c.until('election', () => !!c.q('.screen-election')));
}

// Play a round out so a scoreboard exists to inspect.
async function playRound(c) {
  const card = c.qq('.action-card').find((n) => {
    const t = n.querySelector('.action-label');
    return t && t.textContent === 'Public Rally';
  });
  if (card && !card.disabled) {
    c.click(card);
    await sleep(60);
    const go = c.q('.dialog-buttons .btn-primary, .dialog-buttons .btn-danger');
    if (go) c.click(go);
    await sleep(150);
  }
}

let opponentsSeen = null;
let firstSeeds = null;
let boardsAgreed = 0;
let roundsPlayed = 0;

for (let round = 1; round <= ROUNDS_TO_PLAY; round++) {
  for (const c of humans) await playRound(c);

  const settled = await host.until(
    'round ' + round + ' settles',
    () => host.game().stage === 'results' || host.screen() === 'result',
    (ROUND_SECONDS + 12) * 1000
  );
  if (!settled || host.screen() === 'result') break;

  await host.until('both see it', () =>
    humans.every((c) => c.game().lastResult && c.game().lastResult.round === round), 12000);

  const boards = humans.map((c) => c.game().lastResult);
  if (boards.every((b) => b && JSON.stringify(b.standings.map((x) => x.party + ':' + x.seats)) ===
      JSON.stringify(boards[0].standings.map((x) => x.party + ':' + x.seats)))) {
    boardsAgreed++;
  }

  if (!opponentsSeen) opponentsSeen = boards[0].standings.filter((x) => x.isAI);
  if (!firstSeeds) {
    firstSeeds = {};
    boards[0].standings.forEach((x) => {
      firstSeeds[x.party] = x.portraitSeed;
    });
  }
  roundsPlayed++;

  await host.until(
    'round ' + round + ' ends',
    () => host.game().round > round || host.screen() === 'result',
    (BREAK_SECONDS + 12) * 1000
  );
  if (host.screen() === 'result') break;
}

check('rounds were played', roundsPlayed >= 3, roundsPlayed + ' rounds');
check('the scoreboard shows four candidates',
  host.game().lastResult.standings.length === 4);
check('two of them are opponents', opponentsSeen && opponentsSeen.length === 2,
  opponentsSeen ? opponentsSeen.length + ' AI' : 'none');
check('the opponents took the parties nobody claimed',
  opponentsSeen && opponentsSeen.every((x) => x.party === 'bjp' || x.party === 'sad'),
  opponentsSeen ? opponentsSeen.map((x) => x.party).join(',') : '');
check('each opponent has a candidate name',
  opponentsSeen && opponentsSeen.every((x) => /\S+\s+\S+/.test(x.candidateName || '')),
  opponentsSeen ? opponentsSeen.map((x) => x.candidateName).join(' / ') : '');
check('and the two are not the same person',
  opponentsSeen && opponentsSeen[0].candidateName !== opponentsSeen[1].candidateName);
check('each opponent has a portrait',
  opponentsSeen && opponentsSeen.every((x) => !!x.portraitSeed));
console.log('     opponents: ' +
  (opponentsSeen || []).map((x) => x.party.toUpperCase() + ' ' + x.candidateName).join(', '));

check('both humans saw identical standings every round', boardsAgreed === roundsPlayed,
  boardsAgreed + ' of ' + roundsPlayed);

/* The opponents must actually be playing, not sitting there as decoration. */
const state = await (await fetch(BASE + 'api/index.php?action=state&code=' + code +
  '&playerId=' + host.session().playerId + '&token=' + host.session().token)).json();
const aiRows = state.game.players.filter((p) => !p.empty && p.isAI);
check('the server seated two opponents', aiRows.length === 2, aiRows.length + ' seated');
check('they campaigned with their own money',
  aiRows.every((p) => p.spent > 0), aiRows.map((p) => p.spent).join('/'));
// Grant money is held in region purses rather than in cash, so the useful
// identity is that nothing was spent that never came in, and no purse went
// negative on the way.
check('they never spent money that did not come in',
  aiRows.every((p) => p.spent <= (p.incomeTotal || 0) + (p.grantTotalEarned || 0)
    + p.borrowed + p.granted + p.raised),
  aiRows.map((p) => p.spent + ' out against ' +
    ((p.incomeTotal || 0) + (p.grantTotalEarned || 0) + p.borrowed + p.granted + p.raised) +
    ' in').join(' | '));
check('and their cash never went below zero',
  aiRows.every((p) => p.cash >= 0), aiRows.map((p) => p.cash).join('/'));
check('they show as connected, being always at their desk',
  aiRows.every((p) => p.connected));
check('nothing can authenticate as an opponent',
  !JSON.stringify(state.game).includes('"token"'));
console.log('     opponent spending: ' +
  aiRows.map((p) => p.partyId.toUpperCase() + ' ₹' + (p.spent / 100000).toFixed(0) + 'L, heat ' +
    Math.round(p.heat)).join(' · '));

/* ---------------------------------------------------------- the portraits */

section('A face does not change');

const rejoined = await openClient('rejoin', host.session());
// A returning player lands on the home screen with their game offered as a
// resume line, exactly as they would after closing the tab.
const resume = rejoined.qq('.resume-link').find((b) => /Rejoin game/.test(b.textContent));
check('the returning player is offered their game back', !!resume,
  rejoined.qq('.resume-link').map((b) => b.textContent).join(' | '));
if (resume) rejoined.click(resume);

const back = await rejoined.until('back in',
  () => !!rejoined.q('.screen-election') || !!rejoined.q('.screen-result'), 25000);
check('a returning player rejoins the same game', back);

await rejoined.until('scoreboard',
  () => !!(rejoined.game() && rejoined.game().lastResult), 20000);
const seedsAfter = {};
((rejoined.game() && rejoined.game().lastResult
  ? rejoined.game().lastResult.standings
  : [])).forEach((x) => {
  seedsAfter[x.party] = x.portraitSeed;
});
check('the returning player sees the scoreboard again',
  Object.keys(seedsAfter).length === 4, Object.keys(seedsAfter).length + ' candidates');
check('every portrait survived the reconnection',
  Object.keys(firstSeeds).every((p) => seedsAfter[p] === firstSeeds[p]),
  JSON.stringify(seedsAfter) + ' vs ' + JSON.stringify(firstSeeds));

/* Portraits are drawn from the seed, so the same seed must draw the same face. */
const drawA = host.dom.window.CMP.ui.portrait.describe('seed-abc');
const drawB = rejoined.dom.window.CMP.ui.portrait.describe('seed-abc');
check('the same seed draws the same face in any window',
  JSON.stringify(drawA) === JSON.stringify(drawB));
check('different seeds draw different faces',
  JSON.stringify(drawA) !== JSON.stringify(host.dom.window.CMP.ui.portrait.describe('seed-xyz')));

// Round results now open on what changed; the standings, with faces, are one
// tap further in. Walk there the way a player does.
const toStandings = host.qq('button').find((b) => /^Continue$|who.s leading/i.test(b.textContent));
if (toStandings) host.click(toStandings);
await sleep(120);

const faces = host.qq('.board-row .portrait');
check('every candidate on screen has a drawn portrait', faces.length === 4, faces.length + ' drawn');
check('portraits are vector drawings, not images',
  faces.every((n) => n.tagName.toLowerCase() === 'svg'));
check('each portrait is labelled for a screen reader',
  faces.every((n) => /Illustration of/.test(n.getAttribute('aria-label') || '')));

/* ------------------------------------------------------------ territory */

/*
 * An opponent that only ever plays the closest race is not an opponent.
 *
 * A district pays its grant every round for the rest of the game, so the two
 * seats that complete one are worth far more than two seats anywhere else,
 * and grant money is locked to the region that earned it. An opponent blind
 * to both finishes about fifteen seats behind a human who is not.
 */
section('Opponents play for ground, not only for seats');

const w = host.dom.window;
const ai = w.CMP.ai;
const board = host.game().support;

// A district the party is one seat away from completing.
const district = w.CMP.DISTRICTS.find((d) => d.seats.length >= 3);
const leaders = w.CMP.campaign.currentLeaders(board);
const held = district.seats.filter((n) => leaders[n] === 'aap');

const nearly = {
  partyId: 'aap',
  openingDistricts: [],
  grants: {},
  cash: 100000000,
};

// Hand the party every seat in it but one, on a copy of the board.
const rigged = JSON.parse(JSON.stringify(board));
district.seats.slice(0, -1).forEach((n) => {
  Object.keys(rigged[String(n)]).forEach((pid) => {
    rigged[String(n)][pid] = pid === 'aap' ? 60 : 10;
  });
});
const missing = String(district.seats[district.seats.length - 1]);
Object.keys(rigged[missing]).forEach((pid) => {
  rigged[missing][pid] = pid === 'aap' ? 20 : 40;
});

const target = ai.districtTarget(rigged, 'aap', nearly);
check('a nearly-complete district is spotted', !!target,
  district.name + ', held ' + held.length + ' of ' + district.seats.length);
check('what it names is within reach',
  !!target && target.missing.length > 0 && target.missing.length <= 3,
  target ? target.missing.length + ' seats missing' : 'none');

const riggedLeaders = w.CMP.campaign.currentLeaders(rigged);
check('and every seat it names is one the party does not yet lead',
  !!target && target.missing.every((n) => riggedLeaders[n] !== 'aap'),
  target ? target.missing.join(',') : 'none');

// With the appetite turned all the way up, that is where it campaigns.
const always = { targetSpread: 6, territoryFocus: 1 };
const picked = ai.chooseSeat(rigged, 'aap', always, () => 0.5, nearly);
check('an opponent playing for ground goes there',
  !!target && target.missing.indexOf(picked) !== -1,
  'picked ' + picked + ', wanted one of ' + (target ? target.missing.join(',') : '-'));

// Districts the deal handed over pay nothing, so finishing one is worth no
// more than any other seat — and if every district is an inherited one there
// is no territory worth chasing at all.
const inherited = ai.districtTarget(rigged, 'aap', {
  partyId: 'aap',
  openingDistricts: w.CMP.DISTRICTS.map((d) => d.id),
  grants: {},
});
check('a district the deal handed over is not worth chasing', !inherited,
  inherited ? JSON.stringify(inherited.missing) : 'none');

// Grant money is region-locked, so it has to be spent where it was earned.
const withPurse = {
  partyId: 'aap',
  openingDistricts: w.CMP.DISTRICTS.map((d) => d.id),
  grants: { malwa: 200000000 },
  cash: 0,
};
const inMalwa = ai.chooseSeat(board, 'aap', { targetSpread: 6, territoryFocus: 0 },
  () => 0.5, withPurse);
check('grant money is spent in the region that earned it',
  w.CMP.regionOfSeat(Number(inMalwa)) === 'malwa',
  'seat ' + inMalwa + ' is in ' + w.CMP.regionOfSeat(Number(inMalwa)));

/* --------------------------------------------------------------- health */

section('Console and server log');
check('no console errors in any window', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check('no PHP fatals', phpErrors.length === 0, phpErrors.slice(0, 2).join(' | '));

openWindows.forEach((d) => {
  try {
    d.window.close();
  } catch (e) {
    /* already closed */
  }
});
php.kill();
try {
  fs.rmSync(DATA, { recursive: true, force: true });
} catch (e) {
  /* the OS can clean its own temp directory */
}

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
