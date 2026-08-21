/**
 * A whole campaign, four players, fifteen rounds.
 * ------------------------------------------------------------------
 * Boots the real PHP server and opens FOUR independent jsdom windows against
 * it — separate localStorage, separate sessions, exactly like four devices.
 * Then it plays a complete game and watches every round turn over, checking
 * after each one that all four clients agree about what is happening.
 *
 * Rounds are shortened with CMP_ROUND_SECONDS so fifteen of them fit into a
 * test run rather than a quarter of an hour. Nothing else is changed: the
 * server still owns the clock, still ends the rounds, and still runs the same
 * pipeline it would at sixty seconds a round.
 *
 * What "synchronised" means here is worth stating, because it is not that the
 * four screens are byte-identical — they must never be. Money, heat and the
 * action log are private, and showing a rival's secret spending would break
 * the game. What must agree is the shared world: the round number, the board,
 * the projected seats, and in the end the result.
 *
 *   node tools/test-rounds.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';

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
const BASE = 'http://127.0.0.1:' + PORT + '/';
const DATA = path.join(os.tmpdir(), 'cmp-rounds-test-' + Date.now());

/* Six seconds a round: long enough for four clients to poll at least twice on
   a single-threaded dev server, short enough that fifteen rounds is a minute
   and a half rather than fifteen. */
const ROUND_SECONDS = 6;

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
  env: { ...process.env, CMP_DATA_DIR: DATA, CMP_ROUND_SECONDS: String(ROUND_SECONDS) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
process.on('exit', () => {
  try {
    php.kill();
  } catch (e) {
    /* already gone */
  }
});
process.on('uncaughtException', (e) => {
  try {
    php.kill();
  } catch (x) {
    /* already gone */
  }
  throw e;
});
const phpErrors = [];
php.stderr.on('data', (d) => {
  const s = String(d);
  if (/Fatal error|Parse error|Uncaught/i.test(s)) phpErrors.push(s.trim());
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

async function openClient(label) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    // jsdom has no layout, so scrollTo and friends are reported as "Not
    // implemented". That is the test environment talking, not the app.
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
    close: () => dom.window.close(),
  };
}

/* ------------------------------------------------------------ the lobby */

section('Four players sit down');

const clients = [];
const host = await openClient('host');
clients.push(host);

host.click(host.qq('.mode-card').find((b) => b.textContent.indexOf('PLAY WITH FRIENDS') === 0));
host.click(host.button('CREATE GAME'));
await host.until('lobby', () => !!host.q('.screen-lobby'));
// The lobby paints before the create call lands, so the code slot shows
// placeholder dots for a moment. Wait for the real thing.
await host.until('code', () =>
  /^[23479ACDEFGHJKMNPQRTUVWXY]{5}$/.test(host.q('.code-value').textContent.trim())
);
const code = host.q('.code-value').textContent.trim();
check('the host created a game', /^[23479ACDEFGHJKMNPQRTUVWXY]{5}$/.test(code), code);

for (let i = 2; i <= 4; i++) {
  const c = await openClient('p' + i);
  c.click(c.qq('.mode-card').find((b) => b.textContent.indexOf('PLAY WITH FRIENDS') === 0));
  c.click(c.button('JOIN GAME'));
  c.type(c.q('.field-input'), code);
  c.click(c.button('JOIN'));
  const joined = await c.until('lobby', () => !!c.q('.screen-lobby'));
  check('player ' + i + ' joined', joined);
  clients.push(c);
}

const PARTIES = ['Aam Aadmi Party', 'Indian National Congress', 'Bharatiya Janata Party', 'Shiromani Akali Dal'];
const NAMES = ['Simran Kaur Gill', 'Ravinder Singh Bajwa', 'Anita Sharma', 'Harjeet Singh Dhillon'];

for (let i = 0; i < clients.length; i++) {
  const c = clients[i];
  await c.until('party list', () => c.qq('.party-card').length >= 4);
  c.click(c.qq('.party-card').find((b) => b.textContent.indexOf(PARTIES[i]) !== -1));
  await sleep(250);

  const inputs = c.qq('.field-input');
  c.type(inputs[0], NAMES[i]);
  c.type(inputs[1], 'A slogan for ' + NAMES[i]);
  await sleep(900); // the details field debounces before it posts
  c.click(c.button('READY'));
  await sleep(250);
}

const allReady = await host.until('everyone ready', () => {
  const btn = host.button('START ELECTION');
  return btn && !btn.disabled;
});
check('all four are ready and the host can start', allReady);

/* ------------------------------------------------------------- the game */

section('The campaign runs for fifteen rounds');

host.click(host.button('START ELECTION'));

for (const c of clients) {
  const started = await c.until('election', () => !!c.q('.screen-election'));
  check(c.label + ' reached the campaign screen', started);
}

check('the round clock is showing', !!host.q('.round-clock'));
check(
  'every client opens on round 1',
  clients.every((c) => c.game().round === 1),
  clients.map((c) => c.game().round).join('/')
);
check(
  'every client agrees the campaign is 15 rounds',
  clients.every((c) => c.game().roundsTotal === 15)
);

/** The shared world, as one client currently sees it. */
function worldOf(c) {
  const g = c.game();
  const counts = c.dom.window.CMP.campaign.seatCounts(g.support);
  return {
    round: g.round,
    seats: counts,
    boardHash: JSON.stringify(g.support['73']),
  };
}

/** Spend on something, agreeing to the confirmation the way a player does. */
async function act(c, label) {
  const card = c.qq('.action-card').find((n) => {
    const t = n.querySelector('.action-label');
    return t && t.textContent === label;
  });
  if (!card || card.disabled) return false;
  c.click(card);
  await sleep(60);
  const go = c.q('.dialog-buttons .btn-primary, .dialog-buttons .btn-danger');
  if (!go) return false;
  c.click(go);
  await sleep(200);
  return true;
}

const ACTIONS = ['Public Rally', 'Door-to-Door Campaign', 'Apply for a Grant', 'Local Media Coverage'];

let desyncs = 0;
let roundsSeen = 0;
let summariesSeen = 0;
let loanTaken = false;
const roundLog = [];

for (let round = 1; round <= 15; round++) {
  // Everybody campaigns, on a different seat each round.
  for (let i = 0; i < clients.length; i++) {
    await act(clients[i], ACTIONS[(round + i) % ACTIONS.length]);
  }

  // The host borrows once, early, so repayment and interest are exercised
  // inside a real game rather than only in the unit tests.
  if (round === 2 && !loanTaken) {
    const tab = host.qq('.panel-tab').find((t) => t.textContent === 'Money');
    if (tab) {
      host.click(tab);
      await sleep(150);
      const chip = host.qq('.bank-chip')[0];
      if (chip) {
        host.click(chip);
        await sleep(80);
        const take = host.qq('.bank button').find((b) => /Take loan/.test(b.textContent));
        if (take && !take.disabled) {
          host.click(take);
          await sleep(80);
          const confirm = host.q('.dialog-buttons .btn-primary');
          if (confirm) {
            host.click(confirm);
            loanTaken = await host.until('loan', () => host.game().loans.length > 0, 8000);
          }
        }
      }
      const back = host.qq('.panel-tab').find((t) => t.textContent === 'Campaign');
      if (back) host.click(back);
    }
  }

  // Wait for the server to end this round and every client to notice.
  const moved = await host.until(
    'round ' + round + ' ends',
    () => host.game().round > round || host.screen() === 'result',
    (ROUND_SECONDS + 12) * 1000
  );
  if (!moved) {
    check('round ' + round + ' ended on the server clock', false, 'stuck on ' + host.game().round);
    break;
  }

  if (host.screen() === 'result') break;

  const agreed = await host.until(
    'clients catch up',
    () => clients.every((c) => c.game().round === host.game().round),
    12000
  );

  const worlds = clients.map(worldOf);
  const sameRound = worlds.every((w) => w.round === worlds[0].round);
  const sameSeats = worlds.every((w) => JSON.stringify(w.seats) === JSON.stringify(worlds[0].seats));
  const sameBoard = worlds.every((w) => w.boardHash === worlds[0].boardHash);
  if (!agreed || !sameRound || !sameSeats || !sameBoard) desyncs++;

  roundsSeen++;
  if (clients.some((c) => !!c.q('.summary-card'))) summariesSeen++;
  roundLog.push(
    'r' + round + ' -> ' + worlds[0].round +
    '  seats ' + CMPseats(worlds[0].seats) +
    (sameRound && sameSeats && sameBoard ? '  in step' : '  DESYNC')
  );
}

function CMPseats(counts) {
  return Object.keys(counts)
    .filter((k) => counts[k] > 0)
    .map((k) => k + ' ' + counts[k])
    .join(' ');
}

console.log('\n' + roundLog.map((l) => '     ' + l).join('\n'));

check('the server drove all fifteen rounds', roundsSeen >= 14, roundsSeen + ' rounds observed');
check('all four clients stayed in step throughout', desyncs === 0, desyncs + ' rounds out of step');
check('round summaries were shown', summariesSeen > 0, summariesSeen + ' rounds reported');
check('the host took a loan during the campaign', loanTaken);

if (loanTaken) {
  const g = host.game();
  check('the loan was repaid or defaulted by the end', g.loans.every((l) => l.settled),
    g.loans.filter((l) => !l.settled).length + ' outstanding');
  check('borrowing left a mark on the ledger', g.borrowed > 0, String(g.borrowed));
  check('cash never went negative', g.cash >= 0, String(g.cash));
}

/* ------------------------------------------------------------- the count */

section('Election day');

for (const c of clients) {
  const arrived = await c.until(c.label + ' at the result', () => c.screen() === 'result', 30000);
  check(c.label + ' reached the result screen', arrived);
}

// The count runs seat by seat rather than landing complete, so catch it
// mid-way before skipping to the end.
const counting = host.q('.count-live');
check('the count is shown seat by seat', !!counting);
if (counting) {
  const progress = host.q('.count-progress').textContent;
  const declaredNow = Number((progress.match(/^(\d+)/) || [0, 0])[1]);
  check('it starts partway through, not complete', declaredNow < 117, progress);
  check('it names the seats as they are declared', host.qq('.count-seat').length > 0);
  check('it shows running totals per party', host.qq('.count-row').length >= 4);
  check('and states the majority needed', /59 seats needed/.test(counting.textContent));
}

for (const c of clients) {
  const skip = c.qq('button').find((b) => /Show the result/.test(b.textContent));
  if (skip) c.click(skip);
}
await sleep(400);
check('the verdict appears once counting finishes', !host.q('.count-live') && !!host.q('.result-rows'));

const standings = clients.map((c) => {
  const rows = c.qq('.result-row').map((r) => {
    const party = r.querySelector('.result-party');
    const seats = r.querySelector('.result-seats');
    return (party ? party.textContent.trim() : '?') + ':' + (seats ? seats.textContent.trim() : '?');
  });
  return rows.join(' ');
});

check('every client shows a result', standings.every((s) => s.length > 0));
check(
  'all four clients agree on the final seat counts',
  standings.every((s) => s === standings[0]),
  standings.join('  |  ')
);
console.log('     final: ' + standings[0]);

const totalSeats = clients[0]
  .qq('.result-row .result-seats')
  .reduce((t, n) => t + Number(n.textContent.trim()), 0);
check('the seats add up to 117', totalSeats === 117, String(totalSeats));

check(
  'the verdict is stated',
  /majority|hung|government/i.test(host.q('.result-inner').textContent)
);

/* --------------------------------------------------------------- health */

section('Console and server log');
check('no console errors in any window', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
check('no PHP fatals', phpErrors.length === 0, phpErrors.slice(0, 2).join(' | '));

for (const c of clients) c.close();
php.kill();
try {
  fs.rmSync(DATA, { recursive: true, force: true });
} catch (e) {
  /* the OS can clean up its own temp directory */
}

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
