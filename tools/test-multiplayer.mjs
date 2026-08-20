/**
 * Multiplayer lobby, end to end through the real UI.
 * ------------------------------------------------------------------
 * Boots the PHP server and opens FOUR independent jsdom windows against it —
 * separate localStorage, separate sessions, exactly like four devices. Then
 * plays the lobby with clicks and keystrokes only: create, join by code, pick
 * parties, fill details, ready up, host starts.
 *
 * jsdom has no fetch, so each window gets Node's fetch bridged in, with
 * relative URLs resolved against the server. Nothing else is stubbed.
 *
 *   node tools/test-multiplayer.mjs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'simple');
const PORT = 8791;
const BASE = 'http://127.0.0.1:' + PORT + '/';
const DATA = path.join(os.tmpdir(), 'cmp-mp-test-' + Date.now());

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

async function openClient(label, seedSession) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => consoleErrors.push(label + ' jsdomError: ' + e.message));
  vc.on('error', (...a) => consoleErrors.push(label + ' console.error: ' + a.join(' ')));

  const dom = await JSDOM.fromURL(BASE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      // jsdom ships no fetch; bridge Node's, resolving relative URLs.
      window.fetch = (url, opts) => fetch(new URL(url, BASE).toString(), opts);
      if (seedSession) {
        // A fresh jsdom window has its own empty localStorage, so a returning
        // player's saved session has to be put back the way a real browser
        // would still have it.
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

  const q = (sel) => dom.window.document.querySelector(sel);
  const qq = (sel) => Array.from(dom.window.document.querySelectorAll(sel));

  return {
    label,
    dom,
    q,
    qq,
    text: () => dom.window.document.body.textContent,
    click: (node) => {
      if (!node) throw new Error(label + ': tried to click a missing element');
      node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    type: (node, value) => {
      node.value = value;
      node.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    },
    button: (label2) => qq('button').find((b) => b.textContent.indexOf(label2) === 0),
    /** Wait until a predicate holds, letting polls land in between. */
    until: async (name, fn, timeout = 9000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (fn()) return true;
        await sleep(120);
      }
      return false;
    },
    close: () => dom.window.close(),
  };
}

/* ---------------------------------------------------------------- host */

section('Host creates a game');
const host = await openClient('host');
check('home shows both ways to play', /PLAY SOLO/.test(host.text()) && /PLAY WITH FRIENDS/.test(host.text()));

host.click(host.qq('.mode-card').find((b) => b.textContent.indexOf('PLAY WITH FRIENDS') === 0));
check('multiplayer screen opens', !!host.q('.screen-multiplayer'));
check('CREATE GAME is offered', !!host.button('CREATE GAME'));
check('JOIN GAME is offered', !!host.button('JOIN GAME'));

host.click(host.button('CREATE GAME'));
await host.until('lobby', () => !!host.q('.screen-lobby'));
check('host lands in the lobby', !!host.q('.screen-lobby'));

const code = host.q('.code-value').textContent.trim();
check('a game code is shown', /^[23479ACDEFGHJKMNPQRTUVWXY]{5}$/.test(code), code);
check('the sharing instruction is shown', /Share this code with your friends/.test(host.text()));
check('there is a copy control', !!host.q('.btn-copy'));

await host.until('count', () => host.q('.lobby-count').textContent.trim() === '1 / 4');
check('lobby shows 1 / 4', host.q('.lobby-count').textContent.trim() === '1 / 4');
check('four roster rows are shown', host.qq('.roster-row').length === 4);
check('three slots read Empty', host.qq('.roster-row.is-empty').length === 3);
check('host is badged as host', /Host/.test(host.q('.roster-row').textContent));
check('host sees START ELECTION', !!host.button('START ELECTION'));

console.log('  game code: ' + code);

/* ---------------------------------------------------------------- joiners */

section('Three friends join with the code');
const players = [host];
for (const label of ['p2', 'p3', 'p4']) {
  const c = await openClient(label);
  c.click(c.qq('.mode-card').find((b) => b.textContent.indexOf('PLAY WITH FRIENDS') === 0));
  c.type(c.q('.code-input'), label === 'p3' ? code.toLowerCase() : code);
  c.click(c.button('JOIN GAME'));
  const ok = await c.until('lobby', () => !!c.q('.screen-lobby'));
  check(label + ' reaches the lobby', ok);
  players.push(c);
}
check('a lowercase code worked', !!players[2].q('.screen-lobby'));

// The host's lobby should catch up on its own, without any interaction.
const grew = await host.until('4/4', () => host.q('.lobby-count').textContent.trim() === '4 / 4');
check("the host's lobby updates by itself", grew, host.q('.lobby-count').textContent);
check('no empty slots remain', host.qq('.roster-row.is-empty').length === 0);
check('joiners have no START ELECTION button at all', !players[1].button('START ELECTION'));
check('joiners have no host block', !players[1].q('.host-block'));

/* ---------------------------------------------------------------- parties */

section('Party selection is exclusive');
function partyCard(client, short) {
  return client.qq('.party-card').find((c) => {
    const el = c.querySelector('.party-short');
    return el && el.textContent === short;
  });
}

host.click(partyCard(host, 'AAP'));
await host.until('aap', () => !!host.q('.party-card.is-selected'));
check('host takes AAP', partyCard(host, 'AAP').classList.contains('is-selected'));

const p2SeesTaken = await players[1].until(
  'aap taken',
  () => partyCard(players[1], 'AAP') && partyCard(players[1], 'AAP').classList.contains('is-taken')
);
check('AAP shows as taken for everyone else', p2SeesTaken);
check('the taken card is disabled', partyCard(players[1], 'AAP').disabled === true);

// Clicking it anyway must change nothing.
players[1].click(partyCard(players[1], 'AAP'));
await sleep(600);
check(
  'clicking a taken party does not steal it',
  !partyCard(players[1], 'AAP').classList.contains('is-selected')
);

players[1].click(partyCard(players[1], 'INC'));
players[2].click(partyCard(players[2], 'BJP'));
players[3].click(partyCard(players[3], 'SAD'));
const allPicked = await host.until('all parties', () =>
  host.qq('.roster-flag').filter((f) => !f.classList.contains('is-none')).length === 4
);
check('all four parties are claimed', allPicked);

/* ---------------------------------------------------------------- details */

section('Candidate details and ready');
const CANDIDATES = [
  ['Simran Kaur Gill', 'Naya Punjab, Sacha Punjab', '100000000'],
  ['Ravinder Singh Bajwa', 'Punjab First', '90000000'],
  ['Amrit Pal Sethi', 'Vikas Hi Vikas', '80000000'],
  ['Jaspreet Kaur Dhillon', 'Sadda Punjab', '70000000'],
];

players.forEach((c, i) => {
  const fields = c.qq('.screen-lobby .field-input');
  c.type(fields[0], CANDIDATES[i][0]);
  c.type(fields[1], CANDIDATES[i][1]);
  c.type(c.q('.field-money'), CANDIDATES[i][2]);
});
check('budget shows Indian grouping in the lobby', host.q('.field-money').value === '₹10,00,00,000');

await sleep(1200); // let the debounced save fire

const namesLanded = await host.until('names', () =>
  /Ravinder Singh Bajwa/.test(host.text()) && /Jaspreet Kaur Dhillon/.test(host.text())
);
check("everyone's candidate appears on the host's roster", namesLanded);

// Ready up, host last.
for (const c of [players[1], players[2], players[3]]) {
  c.click(c.button('READY'));
}
const threeReady = await host.until('3 ready', () => host.qq('.status-ready').length === 3);
check('three players show as Ready', threeReady, host.qq('.status-ready').length + ' ready');
check('the host still shows as Waiting', host.qq('.status-waiting').length === 1);

const startBtn = () => host.button('START ELECTION');
check('START is disabled while someone is not ready', startBtn().disabled === true);
check('the host is told why', /ready/i.test(host.q('.start-hint').textContent), host.q('.start-hint').textContent);

host.click(host.button('READY'));
const allReady = await host.until('all ready', () => startBtn() && startBtn().disabled === false);
check('START enables once everyone is ready', allReady);
check('four players show as Ready', host.qq('.status-ready').length === 4);

/* ---------------------------------------------------------------- start */

section('Host starts the election');
host.click(startBtn());
const hostStarted = await host.until('election', () => !!host.q('.screen-election'));
check('the host moves to the election screen', hostStarted);
const onElection = (c) => (c.q('.screen-election') ? c.q('.screen-election').textContent : '');
check("the host's own party is shown", /Aam Aadmi Party/.test(onElection(host)));
check('the host sees their candidate', /Simran Kaur Gill/.test(onElection(host)));
check('all 117 constituencies render', host.qq('.seat').length === 117);

const p2Started = await players[1].until('election', () => !!players[1].q('.screen-election'));
check('player 2 is taken along automatically', p2Started);
check('player 2 sees their own party', /Indian National Congress/.test(onElection(players[1])));
check('player 2 sees their own candidate', /Ravinder Singh Bajwa/.test(onElection(players[1])));
check(
  'player 2 does not see the host as their candidate',
  !/Simran Kaur Gill/.test(onElection(players[1]))
);

const p4Started = await players[3].until('election', () => !!players[3].q('.screen-election'));
check('player 4 is taken along too', p4Started);
check('player 4 sees Shiromani Akali Dal', /Shiromani Akali Dal/.test(onElection(players[3])));

/* ---------------------------------------------------------------- reconnect */

section('Reconnecting after closing the browser');
const rejoinCode = code;
const p2Session = players[1].dom.window.CMP.net.getSession();
check('player 2 had a stored session', !!p2Session && p2Session.code === rejoinCode);
players[1].close();

const returning = await openClient('p2-return', p2Session);
check(
  'the returning player is offered their game',
  new RegExp('Rejoin game ' + rejoinCode).test(returning.text()),
  returning.text().slice(0, 120)
);
returning.click(returning.qq('.resume-link').find((b) => /Rejoin game/.test(b.textContent)));
// The lobby renders immediately; the poll then carries them into the election
// that started while they were away. Wait for that, not just for any screen.
const backIn = await returning.until('back', () => !!returning.q('.screen-election'));
check('they get back into the same game, already under way', backIn);
const returningText = () =>
  (returning.q('.screen-election') || returning.q('.screen-lobby') || { textContent: '' }).textContent;
check('their party is still INC', /Indian National Congress/.test(returningText()));
check('their candidate survived', /Ravinder Singh Bajwa/.test(returningText()));

/* ---------------------------------------------------------------- a 5th */

section('A fifth player is turned away');
const fifth = await openClient('p5');
fifth.click(fifth.qq('.mode-card').find((b) => b.textContent.indexOf('PLAY WITH FRIENDS') === 0));
fifth.type(fifth.q('.code-input'), code);
fifth.click(fifth.button('JOIN GAME'));
const refused = await fifth.until('notice', () => !!fifth.q('.notice'));
check('they are refused', refused);
check('they stay on the multiplayer screen', !!fifth.q('.screen-multiplayer'));
check(
  'the reason is explained',
  /already started|full/i.test(fifth.q('.notice') ? fifth.q('.notice').textContent : ''),
  fifth.q('.notice') ? fifth.q('.notice').textContent : 'no notice'
);

const badCode = await openClient('bad');
badCode.click(badCode.qq('.mode-card').find((b) => b.textContent.indexOf('PLAY WITH FRIENDS') === 0));
badCode.type(badCode.q('.code-input'), 'QQQQQ');
badCode.click(badCode.button('JOIN GAME'));
const badRefused = await badCode.until('notice', () => !!badCode.q('.notice'));
check('an unused code is refused with a message', badRefused);

/* ---------------------------------------------------------------- solo */

section('Solo mode still needs no server');
const solo = await openClient('solo');
solo.click(solo.qq('.mode-card').find((b) => b.textContent.indexOf('PLAY SOLO') === 0));
check('solo setup opens', !!solo.q('.screen-setup'));
solo.click(solo.qq('.party-card').find((c) => c.textContent.includes('BJP')));
const soloFields = solo.qq('.field-input');
solo.type(soloFields[0], 'Solo Candidate');
solo.type(soloFields[1], 'Solo slogan');
solo.type(solo.q('.field-money'), '10000000');
solo.click(solo.q('.btn-start'));
check('solo election starts', !!solo.q('.screen-election'));
check('solo game is saved locally', !!solo.dom.window.CMP.storage.load());
check('solo save is marked solo', solo.dom.window.CMP.storage.load().mode === 'solo');

/* ---------------------------------------------------------------- console */

section('Console and server log');
const realErrors = consoleErrors.filter((e) => !/Could not parse CSS|Not implemented/.test(e));
check('no console errors in any window', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
check('no PHP fatals', phpErrors.length === 0, phpErrors.slice(0, 2).join(' | '));

[host, players[1], players[2], players[3], returning, fifth, badCode, solo].forEach((c) => {
  try {
    c.close();
  } catch (e) {
    /* already closed */
  }
});
php.kill();
fs.rmSync(DATA, { recursive: true, force: true });

console.log('\n' + '-'.repeat(56));
console.log(pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  failures.forEach((f) => console.log('  FAILED: ' + f));
  process.exit(1);
}
console.log('All checks passed.');
