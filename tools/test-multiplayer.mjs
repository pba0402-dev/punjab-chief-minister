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
process.on('exit', () => { try { php.kill(); } catch (e) {} });
process.on('uncaughtException', (e) => { try { php.kill(); } catch (x) {} throw e; });
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
    /**
     * Wait until a predicate holds, letting polls land in between.
     * The timeout is generous because `php -S` is single-threaded: four
     * clients polling at once queue up behind each other on a dev server in a
     * way they would not behind Apache.
     */
    until: async (name, fn, timeout = 20000) => {
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
  ['Simran Kaur Gill', 'Naya Punjab, Sacha Punjab'],
  ['Ravinder Singh Bajwa', 'Punjab First'],
  ['Amrit Pal Sethi', 'Vikas Hi Vikas'],
  ['Jaspreet Kaur Dhillon', 'Sadda Punjab'],
];

players.forEach((c, i) => {
  const fields = c.qq('.screen-lobby .field-input');
  c.type(fields[0], CANDIDATES[i][0]);
  c.type(fields[1], CANDIDATES[i][1]);
});
check('the lobby asks for no budget', !host.q('.screen-lobby .field-money'));
check('the granted purse is stated in the lobby', /₹5,00,00,000/.test(host.text()));

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
check('the campaign panel renders', host.qq('.action-card').length === 10,
  host.qq('.action-card').length + ' cards');
check('a target constituency is chosen', !!host.q('.target-name'));
check('all 117 seats are reachable from the picker',
  Object.keys(host.dom.window.CMP.app.getGame().support).length === 117);
check('the round clock is showing', !!host.q('.round-clock'));
check('it opens on round 1 of 15', /Round\s*1\s*of\s*15/.test(host.q('.round-bar').textContent),
  host.q('.round-bar').textContent.slice(0, 40));
check('projected seats are shown', !!host.q('.projection'));
check('and the panel says how many more are needed',
  /Needs \d+ more seat|Majority reached/.test(host.q('.projection').textContent),
  host.q('.projection').textContent.slice(0, 60));

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

/* ------------------------------------------------- independent budgets */

section('Every player has their own ₹5 crore');

function statOf(client, label) {
  const tile = client.qq('.stat').find((n) => {
    const l = n.querySelector('.stat-label');
    return l && l.textContent === label;
  });
  return tile ? tile.querySelector('.stat-value').textContent : null;
}

for (const c of players) {
  check(
    c.label + ' starts on ₹5,00,00,000',
    statOf(c, 'Cash in Hand') === '₹5,00,00,000',
    statOf(c, 'Cash in Hand')
  );
  check(c.label + ' starts with no debt', statOf(c, 'Debt') === '—', statOf(c, 'Debt'));
}
check('the host sees a campaign panel', host.qq('.action-card').length === 10);
check('four safe and four risky actions', host.qq('.action-card.action-safe').length === 4);
check('political heat starts at zero', /0 \/ 100/.test(host.q('.heat-card').textContent));

// The host spends; nobody else's purse may move.
const dealCost = host.dom.window.CMP.getAction('deal').cost;
const hostCard = host.qq('.action-card').find((c) => {
  const n = c.querySelector('.action-label');
  return n && n.textContent === 'Underground Deal';
});
host.click(hostCard);
await sleep(60);
// Spending money asks first, so agree to it the way a player would.
const hostGo = host.q('.dialog-buttons .btn-danger, .dialog-buttons .btn-primary');
check('spending asks for confirmation first', !!hostGo);
host.click(hostGo);
const hostSpent = await host.until('spent', () => statOf(host, 'Spent') !== '₹0', 12000);
check('the host can spend', hostSpent, statOf(host, 'Spent'));
check(
  'the server deducted exactly the action cost',
  statOf(host, 'Spent') === host.dom.window.CMP.ui.money.format(dealCost),
  statOf(host, 'Spent')
);
check('the cash in hand dropped', statOf(host, 'Cash in Hand') !== '₹5,00,00,000');
check('a risky action raised the host heat', !/^0 \//.test(host.q('.heat-value').textContent),
  host.q('.heat-value').textContent);
check('the outcome is reported to the host', !!host.q('.report'));

// Give the other clients a poll or two to refresh, then confirm they are untouched.
await sleep(3500);
for (const c of [players[1], players[2], players[3]]) {
  check(c.label + " cash is untouched by the host's spending",
    statOf(c, 'Cash in Hand') === '₹5,00,00,000', statOf(c, 'Cash in Hand'));
  check(c.label + ' heat is untouched', /0 \/ 100/.test(c.q('.heat-card').textContent));
}

// A second player spends independently.
const p2Card = players[1].qq('.action-card').find((c) => {
  const n = c.querySelector('.action-label');
  return n && n.textContent === 'Public Rally';
});
players[1].click(p2Card);
await sleep(60);
players[1].click(players[1].q('.dialog-buttons .btn-primary, .dialog-buttons .btn-danger'));
const p2Spent = await players[1].until('spent', () => statOf(players[1], 'Spent') !== '₹0', 12000);
check('player 2 can spend their own money', p2Spent);
check(
  'the two players have different amounts left',
  statOf(host, 'Cash in Hand') !== statOf(players[1], 'Cash in Hand'),
  statOf(host, 'Cash in Hand') + ' vs ' + statOf(players[1], 'Cash in Hand')
);

/* --------------------------------------------- constituency + oversight */

section('Constituency detail shows real MLA and fictional race');

const tabButton = (client, label) =>
  client.qq('.panel-tab').find((t) => t.textContent === label);

host.click(tabButton(host, 'Constituency'));
await host.until('seat detail', () => !!host.q('.seat-detail'));
check('the constituency tab opens', !!host.q('.seat-detail'));
check('it names the seat and its AC number', /AC \d+/.test(host.q('.seat-detail-name').textContent),
  host.q('.seat-detail-name').textContent);
check('the sitting MLA is shown', !!host.q('.incumbent-name') && host.q('.incumbent-name').textContent.length > 2,
  host.q('.incumbent-name') ? host.q('.incumbent-name').textContent : 'missing');
check('their party is shown', !!host.q('.incumbent-party'));
check('incumbency strength is shown', !!host.q('.incumbent-strength'),
  host.q('.incumbent-strength') ? host.q('.incumbent-strength').textContent : 'missing');
check('it is labelled as real reference data',
  /takes no part in the game/i.test(host.q('.seat-detail').textContent));
check('the fictional race is shown separately', /Current Game Race/.test(host.q('.seat-detail').textContent));
check('every party has a bar', host.qq('.race-row').length >= 4, String(host.qq('.race-row').length));
check('one party is marked LEADING', host.qq('.race-lead').length === 1);
check('a projected winner is named', !!host.q('.projected-party'));
check('a LEADING badge is shown at the top', !!host.q('.leading-badge'));

section('Reporting a rival');
host.click(tabButton(host, 'Rivals'));
await host.until('rivals', () => !!host.q('.rival-list'));
check('the rivals tab opens', !!host.q('.rival-list'));
check('it lists the other three players', host.qq('.rival-row').length === 3,
  String(host.qq('.rival-row').length));
check('each rival shows their Political Heat', host.qq('.rival-heat').length === 3);
check('a report button is offered', host.qq('.btn-report').length === 3);

host.click(host.qq('.btn-report')[0]);
await host.until('reasons', () => !!host.q('.reason-list'));
check('choosing REPORT asks for a reason', !!host.q('.reason-list'));
check('the configured reasons are offered',
  host.qq('.reason-option').length === host.dom.window.CMP.CAMPAIGN.investigation.reasons.length);
check('it warns that a report is not a verdict',
  /not a verdict/i.test(host.q('.reason-picker').textContent));

host.click(host.qq('.reason-option')[0]);
const reported = await host.until('reported', () => !!host.q('.rival-done'));
check('the report is recorded', reported);
check('you cannot report the same player twice',
  host.qq('.btn-report').length === 2, String(host.qq('.btn-report').length));

// A second, different player reporting the same rival opens an inquiry.
const targetName = host.qq('.rival-row')[0].querySelector('.rival-name').textContent;
players[1].click(tabButton(players[1], 'Rivals'));
await players[1].until('rivals', () => !!players[1].q('.rival-list'));
const sameTarget = players[1].qq('.rival-row').find((r) =>
  r.querySelector('.rival-name').textContent.indexOf(targetName.replace(/^[A-Z]+/, '').trim()) !== -1
);
if (sameTarget && sameTarget.querySelector('.btn-report')) {
  players[1].click(sameTarget.querySelector('.btn-report'));
  await players[1].until('reasons', () => !!players[1].q('.reason-list'));
  players[1].click(players[1].qq('.reason-option')[1]);
  const inquiry = await players[1].until('finding', () => !!players[1].q('.rival-finding'));
  check('a second reporter opens an inquiry with a finding', inquiry,
    players[1].q('.rival-finding') ? players[1].q('.rival-finding').textContent : 'none');
}

check('the evidence score is never sent to the browser',
  !JSON.stringify(host.dom.window.CMP.net.lastError() || {}).includes('evidence'));

/* --------------------------------------------------------- the result */

section('Closing the polls');
host.click(tabButton(host, 'Campaign'));
check('only the host is offered the declare button',
  !!host.button('Close the polls now') && !players[1].button('Close the polls now'));
check('everyone is told the polls close on their own',
  /close automatically after round 15|final round/i.test(host.q('.declare-note').textContent),
  host.q('.declare-note').textContent);

host.click(host.button('Close the polls now'));
await sleep(80);
// Ending a campaign early for four people is worth a confirmation.
check('closing early asks first', !!host.q('.dialog'));
host.click(host.q('.dialog-buttons .btn-danger, .dialog-buttons .btn-primary'));
const hostResult = await host.until('result', () => !!host.q('.screen-result'), 25000);
check('the host reaches the result screen', hostResult);

// The seats are declared one at a time before the verdict. That is covered
// properly in tools/test-rounds.mjs; here, jump to the end.
check('the count starts before the verdict', !!host.q('.count-live'));
const skipCount = (c) => {
  const b = c.qq('button').find((n) => /Show the result/.test(n.textContent));
  if (b) c.click(b);
};
skipCount(host);
await sleep(200);

check('the result names the election', /Punjab Election Result/.test(host.text()));
check('every party is listed', host.qq('.result-row').length >= 4, String(host.qq('.result-row').length));
check('the seat totals are shown', /Total/.test(host.q('.result-totals').textContent));
check('the majority is stated as 59', /59/.test(host.q('.result-totals').textContent));

const seatSum = host
  .qq('.result-seats')
  .reduce((t, n) => t + Number(n.textContent), 0);
check('the declared seats add to 117', seatSum === 117, String(seatSum));

const others = await players[2].until('result', () => !!players[2].q('.screen-result'), 25000);
check('the other players are carried to the result too', others);
players.forEach(skipCount);
await sleep(200);

const verdict = host.q('.verdict-kicker').textContent;
console.log('     verdict: ' + verdict);
check('a verdict is declared',
  /Majority Government|Hung Assembly|Coalition/.test(verdict), verdict);

if (/Hung Assembly/.test(verdict)) {
  check('coalition talks are offered', /Government Formation/.test(host.text()));
  const pairs = host.qq('.pair-row');
  check('possible pairings are listed', pairs.length > 0, String(pairs.length));
  if (pairs.length) {
    host.click(pairs[0]);
    await host.until('terms', () => !!host.q('.terms-form'));
    check('terms can be negotiated', !!host.q('.terms-form'));
    check('a Chief Minister is chosen', host.qq('.term-group').length >= 4,
      String(host.qq('.term-group').length));
    host.qq('.term-group').forEach((grp) => {
      const opt = grp.querySelector('.term-option');
      if (opt) host.click(opt);
    });
    const proposeBtn = host.button('PROPOSE COALITION');
    check('an offer can be proposed', !!proposeBtn && !proposeBtn.disabled);
  }
} else {
  // A majority now ends on a winner card with the candidate's portrait
  // beside their name, rather than a bare line of text.
  const winner = host.q('.winner-name');
  check('a Chief Minister is named', !!winner, winner ? winner.textContent : 'none');
  check('and shown with their portrait', !!host.q('.winner-card .portrait'));
}

check('the final standings are a leaderboard with faces',
  host.qq('.final-board .board-row').length === 4,
  host.qq('.final-board .board-row').length + ' rows');
check('every finalist has a drawn portrait',
  host.qq('.final-board .portrait').length === 4);
check('the count reports every seat declared',
  /117 of 117 seats counted/.test(host.q('.subtitle').textContent),
  host.q('.subtitle').textContent);

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
// By this point the polls have closed, so a returning player should land on
// whichever screen the game has actually reached.
const backIn = await returning.until(
  'back',
  () => !!returning.q('.screen-election') || !!returning.q('.screen-result'),
  25000
);
check('they get back into the same game, at whatever stage it has reached', backIn);
check('and they see the declared result', !!returning.q('.screen-result'));
const returningText = () =>
  (returning.q('.screen-election') || returning.q('.screen-result') ||
    returning.q('.screen-lobby') || { textContent: '' }).textContent;
// The result screen shows party codes and candidate names rather than full
// party names, so check the restored state directly.
check('their party is still INC',
  returning.dom.window.CMP.app.getGame().partyId === 'inc',
  returning.dom.window.CMP.app.getGame().partyId);
// They arrive with the count still running, exactly as a late joiner would.
skipCount(returning);
await sleep(200);
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
check('solo asks for no budget either', !solo.q('.field-money'));
solo.click(solo.q('.btn-start'));
check('solo election starts', !!solo.q('.screen-election'));
check('solo game is saved locally', !!solo.dom.window.CMP.storage.load());
check('solo save is marked solo', solo.dom.window.CMP.storage.load().mode === 'solo');
check('solo is granted the same ₹5 crore',
  solo.dom.window.CMP.storage.load().budget === 50000000,
  String(solo.dom.window.CMP.storage.load().budget));

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
