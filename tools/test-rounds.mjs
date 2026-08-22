/**
 * A whole campaign, four players, twenty rounds.
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
   a single-threaded dev server, short enough that twenty rounds is a minute
   and a half rather than fifteen. */
/* Campaigning is a four-step drill-down — home, candidate, seat, sheet — so a
   round has to be long enough for four clients to walk it. Six seconds was
   enough when actions sat on one screen; it is not any more. */
const ROUND_SECONDS = 11;
/* Long enough that every client polls the scoreboard at least twice, short
   enough that fifteen breaks do not double the run. */
const BREAK_SECONDS = 4;

// Read from the config rather than typed out. Three of the four names here
// used to be invented, so act() had been quietly failing on them and the
// suite was playing one move a round instead of four.
let ACTIONS = null; // set once a client is open, from CMP.ACTIONS

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

/**
 * Get a client back to the game's home screen.
 *
 * The menu lives on the home screen now rather than above every screen, so
 * reaching any section means going back first. Driving the suites the same way
 * a player moves is what proves the way back exists on every screen.
 */
function goHome(c) {
  for (let i = 0; i < 4 && !c.q('.g-strategy'); i++) {
    const back = c.q('.g-section-head .sd-back') || c.q('.areas .sd-back') || c.q('.sd-back');
    if (!back) break;
    c.click(back);
  }
  return !!c.q('.g-strategy');
}

/** One item in the game's menu grid, by its label. */
/*
 * Open a screen the way a player does.
 *
 * Home is the map with two strategic buttons above it; everything else lives
 * under More, because none of it is opened every round.
 */
function menuItem(c, label) {
  goHome(c);
  const strategy = c.qq('.g-strategy-item').find((n) => {
    const name = n.querySelector('.g-strategy-label');
    return name && name.textContent === label;
  });
  if (strategy) {
    c.click(strategy);
    return c.q('.g-section-head') || c.q('.areas');
  }
  c.click(c.q('.g-more'));
  const item = c.qq('.sheet-item').find((n) => n.textContent === label ||
    n.textContent.indexOf(label) === 0);
  if (!item) return null;
  c.click(item);
  return c.q('.g-section-head');
}

/* ------------------------------------------------------------ the lobby */

section('Four players sit down');

const clients = [];
const host = await openClient('host');
clients.push(host);

host.click(host.q('.h-card.is-primary'));
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
  c.click(c.q('.h-card.is-primary'));
  c.click(c.button('JOIN GAME'));
  c.type(c.q('.field-input'), code);
  c.click(c.button('JOIN'));
  const joined = await c.until('lobby', () => !!c.q('.screen-lobby'));
  check('player ' + i + ' joined', joined);
  clients.push(c);
}

const PARTIES = ['Punjab Development Party', 'Unity Punjab Front',
  'Pind Vikas Manch', 'Sanjha Workers Alliance'];
const NAMES = ['Simran Kaur Gill', 'Ravinder Singh Bajwa', 'Anita Sharma', 'Harjeet Singh Dhillon'];

for (let i = 0; i < clients.length; i++) {
  const c = clients[i];
  // Every player founds their own party: there is no list to claim from.
  await c.until('party editor', () => !!c.q('.js-party-name'));
  c.type(c.q('.js-party-name'), PARTIES[i]);
  await sleep(250);
  c.type(c.q('.js-candidate-name'), NAMES[i]);
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

section('The campaign runs for twenty rounds');

host.click(host.button('START ELECTION'));

for (const c of clients) {
  const started = await c.until('election', () => !!c.q('.screen-election'));
  check(c.label + ' reached the campaign screen', started);
}

ACTIONS = host.dom.window.CMP.actionsByMenu('campaign').map((a) => a.label);
check('the campaign moves are read from the config',
  ACTIONS.length === host.dom.window.CMP.CAMPAIGN.actions
    .filter((a) => a.menu === 'campaign').length && ACTIONS.length > 0,
  ACTIONS.join(', '));
check('the round clock is showing', !!host.q('.round-clock'));
check(
  'every client opens on round 1',
  clients.every((c) => c.game().round === 1),
  clients.map((c) => c.game().round).join('/')
);
check(
  'every client agrees the campaign is 20 rounds',
  clients.every((c) => c.game().roundsTotal === 20),
  clients.map((c) => c.game().roundsTotal).join('/')
);
check(
  'the campaign opens in play, not on a scoreboard',
  clients.every((c) => c.game().stage === 'playing'),
  host.game().stage
);

// Remembered now, compared at the end: a candidate's face must not change
// mid-campaign, least of all after somebody reconnects.
const openingSeeds = {};

/**
 * The shared world, as one client currently sees it. The scoreboard is part
 * of it: four clients agreeing on the board but disagreeing about who is
 * winning would be worse than showing no scoreboard at all.
 */
function worldOf(c) {
  const g = c.game();
  const counts = c.dom.window.CMP.campaign.seatCounts(g.support);
  const r = g.lastResult;
  return {
    round: g.round,
    seats: counts,
    boardHash: JSON.stringify(g.support['73']),
    scoreboard: r
      ? JSON.stringify({
          round: r.round,
          order: r.standings.map((x) => x.party + ':' + x.seats),
          lead: r.leadParty,
          needed: r.seatsNeeded,
          changes: r.changeCount,
        })
      : null,
  };
}

/** Spend on something, agreeing to the confirmation the way a player does. */
async function act(c, label) {
  // Home → my candidate → the closest seat → campaign → confirm. That is the
  // whole loop, so playing it here is what keeps this suite honest about the
  // flow a player actually uses.
  goHome(c);
  await sleep(60);

  const mine = c.q('.lb-row.is-you');
  if (!mine) return false;
  c.click(mine);
  await sleep(80);

  // The candidate's page opens first — who they are and how they stand. The
  // seat list is one tap further in, which is the order a player wants.
  const toSeats = c.qq('button').find((b) => /All my seats/i.test(b.textContent));
  if (!toSeats) return false;
  c.click(toSeats);
  await sleep(80);

  const seat = c.qq('.area-row')[0];
  if (!seat) return false;
  c.click(seat);
  await sleep(80);

  const open = c.qq('button').find((b) => /Campaign here/.test(b.textContent));
  if (!open) return false;
  c.click(open);
  await sleep(120);

  /*
   * One panel: what the money is for, how much, confirm.
   *
   * The mode falls back to ordinary campaigning when the named one is not
   * offered, because a run that downed tools would be measuring the panel's
   * vocabulary rather than the drill-down it is here to exercise.
   */
  const modes = c.qq('.cs-mode');
  const wanted = modes.find((b) => {
    const n = b.querySelector('.cs-mode-label');
    return n && new RegExp(label, 'i').test(n.textContent);
  });
  if (wanted) {
    c.click(wanted);
    await sleep(60);
  }

  const invest = c.qq('.campaign-sheet button').find((b) => /^Invest/.test(b.textContent));
  if (!invest) {
    const cancel = c.qq('.campaign-sheet button').find((b) => b.textContent === 'Cancel');
    if (cancel) c.click(cancel);
    return false;
  }
  c.click(invest);
  await sleep(250);

  const back = c.qq('button').find((b) => /Back to the map/.test(b.textContent));
  if (back) c.click(back);
  await sleep(80);
  return true;
}

/**
 * Try to spend during the results break. The server should refuse it: the
 * scoreboard on screen is the one a late move would invalidate.
 *
 * The break is short, so by the time this lands the server may legitimately
 * have opened the next round — in which case the move being accepted is
 * correct, not a leak. The response carries the game's stage, so the two
 * cases can be told apart instead of guessing from the clock.
 */
async function lateMove(c) {
  const g = c.game();
  const seat = Object.keys(g.support)[0];
  const res = await c.dom.window.CMP.net.playAction('invest', Number(seat));
  const stage = res && res.game ? res.game.stage : null;
  return { leaked: !!(res && res.ok && stage === 'results'), stage: stage };
}


let desyncs = 0;
let roundsSeen = 0;
let checkpoint = null;
let checkpointAgreed = false;
let summariesSeen = 0;
let boardsSeen = 0;
let lockFailures = 0;
let newLeaders = 0;
let loanTaken = false;
const roundLog = [];

let movesPlayed = 0;

for (let round = 1; round <= 20; round++) {
  // Everybody campaigns, through the real drill-down.
  for (let i = 0; i < clients.length; i++) {
    if (await act(clients[i], ACTIONS[(round + i) % ACTIONS.length])) movesPlayed++;
  }

  // The host borrows once, early, so repayment and interest are exercised
  // inside a real game rather than only in the unit tests.
  if (round === 2 && !loanTaken) {
    const tab = menuItem(host, 'Loan');
    if (tab) {
      await sleep(150);
      const offer = host.qq('.loan-offer').find((b) => !b.disabled);
      if (offer) {
        host.click(offer);
        await sleep(120);
        const confirm = host.q('.dialog-buttons .btn-primary');
        if (confirm) {
          host.click(confirm);
          loanTaken = await host.until('loan', () => host.game().loans.length > 0, 8000);
        }
      }
      const back = menuItem(host, 'Campaign');
      if (back) host.click(back);
    }
  }

  // The clock runs out: the round settles and the scoreboard goes up.
  const settled = await host.until(
    'round ' + round + ' settles',
    () => host.game().stage === 'results' || host.screen() === 'result',
    (ROUND_SECONDS + 12) * 1000
  );
  if (!settled) {
    check('round ' + round + ' settled on the server clock', false,
      'stuck on ' + host.game().round + '/' + host.game().stage);
    break;
  }

  if (host.screen() !== 'result') {
    // Every client should land on the same scoreboard. They get there at
    // their own polling pace, so what matters is that they converge — not
    // that they arrive in the same instant.
    const sawBoard = await host.until(
      'scoreboard',
      () => clients.every((c) => !!c.q('.round-results')),
      10000
    );
    if (sawBoard) boardsSeen++;

    const agreed = await host.until(
      'same scoreboard',
      () => {
        const seen = clients.map((c) => (c.game().lastResult ? c.game().lastResult.round : null));
        return seen.every((b) => b !== null && b === seen[0]);
      },
      10000
    );
    if (!agreed) desyncs++;

    // The server, not the client, is what actually has to refuse a late move.
    // A client that has not polled yet may still be showing its controls; the
    // rule is that pressing them achieves nothing.
    const late = await lateMove(host);
    if (late.leaked) lockFailures++;
  }

  // The break runs out: the next round opens, or the count begins.
  // Rounds ten and fifteen get a longer break, because both put something on
  // the screen that has to be read rather than glanced at.
  const breakNow = host.dom.window.CMP.campaign.breakAfter(round);
  const moved = await host.until(
    'round ' + round + ' ends',
    () => host.game().round > round || host.screen() === 'result',
    (breakNow + 12) * 1000
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

  /*
    * The checkpoint. The server decides it, so every client must be told the
    * same verdict — a review that one player saw and another did not would be
    * worse than no review at all.
    */
  if (round === 15) {
    checkpoint = host.game().lastResult ? host.game().lastResult.review : null;
    const seen = clients.map((c) => {
      const r = c.game().lastResult ? c.game().lastResult.review : null;
      return r ? JSON.stringify([r.reason, r.eliminated ? r.eliminated.playerId : null]) : null;
    });
    checkpointAgreed = seen.every((x) => x !== null && x === seen[0]);
  }

  roundsSeen++;
  if (clients.some((c) => !!c.q('.summary-card'))) summariesSeen++;
  const lastBoard = host.game().lastResult;
  if (lastBoard && lastBoard.newLeader) newLeaders++;
  if (lastBoard && !Object.keys(openingSeeds).length) {
    lastBoard.standings.forEach((row) => {
      openingSeeds[row.party] = row.avatar;
    });
  }
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

check('players actually campaigned through the drill-down', movesPlayed >= 25,
  movesPlayed + ' moves played of ' + (roundsSeen * clients.length) + ' attempted');
check('the server drove all twenty rounds', roundsSeen >= 19, roundsSeen + ' rounds observed');

/*
 * The round-fifteen checkpoint, decided on the server.
 *
 * Whatever the verdict, every client has to be told the same one. A review
 * that one player saw and another did not would be worse than no review.
 */
check('the checkpoint ran at round fifteen', !!checkpoint,
  JSON.stringify(checkpoint));
check('it gave a reason either way', !!(checkpoint && checkpoint.reason),
  checkpoint && checkpoint.reason);
check('and all four clients were told the same verdict', checkpointAgreed);
if (checkpoint && checkpoint.eliminated) {
  const row = (host.game().lastResult.standings || [])
    .find((x) => x.playerId === checkpoint.eliminated.playerId);
  check('an eliminated campaign is marked, not removed', !!row && row.eliminated === true,
    JSON.stringify(row && { party: row.party, eliminated: row.eliminated, seats: row.seats }));
}
check('all four clients stayed in step throughout', desyncs === 0, desyncs + ' rounds out of step');
check('round summaries were shown', summariesSeen > 0, summariesSeen + ' rounds reported');
check('the scoreboard appeared between rounds', boardsSeen >= roundsSeen - 1,
  boardsSeen + ' of ' + roundsSeen + ' breaks');
check('nobody could act while the round was being counted', lockFailures === 0,
  lockFailures + ' breaks with live controls');

/* The scoreboard, as the last round left it. */
const finalBoard = host.game().lastResult;
check('the scoreboard names four candidates', finalBoard.standings.length === 4);
check('every candidate has a name', finalBoard.standings.every((x) => !!x.candidateName),
  JSON.stringify(finalBoard.standings.map((x) => x.candidateName)));
check('every candidate has a portrait seed', finalBoard.standings.every((x) => !!x.avatar));
check('with four people playing there are no opponents to add',
  finalBoard.standings.filter((x) => x.isAI).length === 0,
  finalBoard.standings.filter((x) => x.isAI).length + ' AI');
check('and every candidate is one of the four humans',
  finalBoard.standings.every((x) => !!x.playerId));
check('the standings are ranked by seats',
  finalBoard.standings.every((x, i, a) => i === 0 || a[i - 1].seats >= x.seats));
check('the leader is the top of the standings',
  finalBoard.leadParty === finalBoard.standings[0].party);
check('the seats-needed figure matches the leader',
  finalBoard.seatsNeeded === Math.max(0, finalBoard.majority - finalBoard.standings[0].seats));
console.log('     leader changed hands in ' + newLeaders + ' of ' + roundsSeen + ' rounds');

const seedsNow = {};
finalBoard.standings.forEach((x) => {
  seedsNow[x.party] = x.avatar;
});
check('portraits never changed during the campaign',
  Object.keys(seedsNow).every((party) => seedsNow[party] === openingSeeds[party]),
  JSON.stringify(seedsNow) + ' vs ' + JSON.stringify(openingSeeds));
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

/*
 * The count runs seat by seat rather than landing complete, so catch it
 * mid-way before skipping to the end.
 *
 * Waiting for the first declaration rather than reading whatever is on screen
 * the instant the result opens: the count is a live thing, and a test that
 * asks it what it has done before it has done anything is asking too early.
 * That was worth one intermittent failure a run or two.
 */
const counting = host.q('.count-live');
check('the count is shown seat by seat', !!counting);
if (counting) {
  const progress = host.q('.count-progress').textContent;
  const declaredNow = Number((progress.match(/^(\d+)/) || [0, 0])[1]);
  check('it starts partway through, not complete', declaredNow < 117, progress);
  await host.until('the first seats are declared',
    () => host.qq('.count-seat').length > 0, 8000);
  check('it names the seats as they are declared', host.qq('.count-seat').length > 0,
    host.q('.count-progress').textContent);
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
