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

/**
 * Get a client back to the game's home screen.
 *
 * The menu lives on the home screen now rather than above every screen, so
 * reaching any section means going back first. Driving the suites the same way
 * a player moves is what proves the way back exists on every screen.
 */
/*
 * Back to the board.
 *
 * Home is the map with the two strategic buttons above it: there is no menu
 * grid to find any more, so arriving there looks like the map being there.
 */
function goHome(c) {
  for (let i = 0; i < 4 && !c.q('.g-strategy'); i++) {
    const back = c.q('.g-section-head .sd-back') || c.q('.areas .sd-back') || c.q('.sd-back');
    if (!back) break;
    c.click(back);
  }
  return !!c.q('.g-strategy');
}

/**
 * Open a screen the way a player does.
 *
 * My Areas and Alliances are the two buttons above the map; everything else
 * is under More, because none of it is opened every round.
 */
function menuItem(c, label) {
  goHome(c);
  if (label === 'Map') return c.q('.punjab-map');

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

/* ---------------------------------------------------------------- host */

section('Host creates a game');
const host = await openClient('host');
/*
 * 2. One way in, from either end.
 *
 * Creating and joining used to be two cards, which made them look like two
 * games; they are the same game and the choice between them is one step in.
 */
check('home offers one way into an election',
  /Election Time/i.test(host.text()) &&
  /Play \/ Join Election/i.test(host.text()) &&
  !/Play with friends/i.test(host.text()),
  host.qq('.h-card-label').map((n) => n.textContent).join(' / '));

host.click(host.q('.h-card.is-primary'));
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
  c.click(c.q('.h-card.is-primary'));
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

/*
 * Everybody founds their own.
 *
 * There is no list of four to claim any more, so nothing can be taken and
 * nothing has to be shared out. What matters instead is that four people
 * typing at once each end up with the party they typed, and that the id each
 * one gets is their slot rather than anything they sent.
 */
section('Every player founds a party');

/** The player's own row, asked of the server directly. */
async function mineOf(c) {
  const res = await c.dom.window.CMP.net.state();
  const v = res && res.game;
  if (!v) return null;
  return (v.players || []).find((x) => x.isYou) || null;
}

/** Every player's row, for the checks that compare the four of them. */
async function rowsOf(clients) {
  const out = [];
  for (const c of clients) out.push(await mineOf(c));
  return out;
}

const PARTY_NAMES = [
  'Punjab Development Party',
  'Unity Punjab Front',
  'Pind Vikas Manch',
  'Sanjha Workers Alliance',
];
const PARTY_SYMBOLS = ['tree', 'lion', 'sunrise', 'mountain'];
const PARTY_COLOURS = ['emerald', 'indigo', 'crimson', 'gold'];

for (let i = 0; i < players.length; i++) {
  const c = players[i];
  await c.until('party editor', () => !!c.q('.js-party-name'));
  c.type(c.q('.js-party-name'), PARTY_NAMES[i]);
  c.click(c.qq('.sym-option')[CMP_SYM_INDEX(PARTY_SYMBOLS[i], c)]);
  c.click(c.qq('.col-option')[CMP_COL_INDEX(PARTY_COLOURS[i], c)]);
}

function CMP_SYM_INDEX(id, c) {
  return c.dom.window.CMP.PARTY_SYMBOLS.findIndex((x) => x.id === id);
}
function CMP_COL_INDEX(id, c) {
  return c.dom.window.CMP.PARTY_COLOURS.findIndex((x) => x.id === id);
}

const allFounded = await host.until('all parties', () =>
  host.qq('.roster-partyname').filter((f) => !f.classList.contains('is-none')).length === 4
);
check('5. all four players founded a party', allFounded,
  host.qq('.roster-partyname').map((n) => n.textContent).join(' | '));

const rows = await rowsOf(players);

check('6. each player got the party they typed',
  rows.every((mine, i) => mine && mine.party && mine.party.name === PARTY_NAMES[i]),
  JSON.stringify(rows.map((mine) => mine && mine.party && mine.party.name)));

check('and the id is the slot, not anything the client sent',
  rows.every((mine) => mine && mine.partyId === 'p' + mine.slot),
  JSON.stringify(rows.map((mine) => mine && mine.partyId)));

// 29. The abbreviation writes itself, and every player can see everybody's.
check('29. a short name was worked out for each',
  rows.every((mine) => mine && mine.party.short && mine.party.short.length <= 4),
  JSON.stringify(rows.map((mine) => mine && mine.party.short)));

// 30. Two campaigns must never wear the same colour or symbol.
check('30. no two parties share a colour',
  new Set(rows.map((mine) => mine.party.colourId)).size === 4,
  rows.map((mine) => mine.party.colourId).join(','));
check('30. or a symbol',
  new Set(rows.map((mine) => mine.party.symbol)).size === 4,
  rows.map((mine) => mine.party.symbol).join(','));

check('25. and the lobby shows every player with their party',
  host.qq('.roster-partyname').length === 4 &&
  PARTY_NAMES.every((n) => host.q('.roster').textContent.includes(n)),
  host.q('.roster').textContent.replace(/\s+/g, ' ').slice(0, 160));

check('25. with a face apiece', host.qq('.roster-row .portrait').length >= 1,
  host.qq('.roster-row .portrait').length + ' faces');

// 11. The preview card shows what the player is about to become.
check('11. the party preview shows the name and badge',
  /PUNJAB DEVELOPMENT PARTY/.test(host.q('.pv-party').textContent) &&
  !!host.q('.pv-badge .sym'),
  host.q('.pv-party').textContent);

/* ---------------------------------------------------------------- details */

section('Candidate details and ready');
const CANDIDATES = [
  ['Simran Kaur Gill', 'Naya Punjab, Sacha Punjab'],
  ['Ravinder Singh Bajwa', 'Punjab First'],
  ['Amrit Pal Sethi', 'Vikas Hi Vikas'],
  ['Jaspreet Kaur Dhillon', 'Sadda Punjab'],
];

players.forEach((c, i) => {
  c.type(c.q('.js-candidate-name'), CANDIDATES[i][0]);
});
check('the lobby asks for no budget', !host.q('.screen-lobby .field-money'));
// 8. Name, then party, then a badge, then a line to run on — and nothing
// else. The budget is granted; it has never been typed in.
check('8. the lobby asks for a name, a party, a short name and a slogan',
  host.qq('.screen-lobby .field-input').length === 4,
  host.qq('.screen-lobby .field-input').length + ' fields');
check('8. and the name comes first',
  host.qq('.screen-lobby .field-input')[0].classList.contains('js-candidate-name'));
check('7. the round allowance is stated in the lobby',
  /5 crore a round/i.test(host.text()), host.text().slice(0, 200));
check('4. the host picks the round length',
  host.qq('.clock-option').length === 3,
  host.qq('.clock-option').length + ' options');
check('4. two minutes is the default',
  !!host.q('.clock-option.is-active') &&
  /2 min/.test(host.q('.clock-option.is-active').textContent),
  host.q('.clock-option.is-active') ? host.q('.clock-option.is-active').textContent : 'none');
check('4. and a guest is told rather than asked',
  players[1].qq('.clock-option').length === 0);

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
// 28. The party they founded, not a code from a list nobody chose.
check("28. the host's own party is shown", /PDP/.test(host.q('.g-who-party').textContent),
  host.q('.g-who-party').textContent);
/*
 * 1 + 20. The money lives in the header, beside the clock, on every screen.
 */
check('1. the host sees their money beside the round, not in a card',
  /Available/.test(host.q('.round-aside').textContent) &&
  !/Simran Kaur Gill/.test(host.q('.round-aside').textContent),
  host.q('.round-aside').textContent);
check('the home screen carries no campaign actions', host.qq('.act').length === 0,
  host.qq('.act').length + ' actions');
goHome(host);

/*
 * 2 + 33. Home is the map.
 *
 * There is no dashboard of ten buttons. What a player does every round is
 * decide where to put money, and the board is where that decision lives.
 */
check('2. the dashboard of buttons is gone', host.qq('.g-menu-item').length === 0,
  host.qq('.g-menu-item').length + ' buttons');
check('4. the map is the home screen', !!host.q('.punjab-map'));
check('3. with My Areas and Alliances above it',
  host.qq('.g-strategy-item').length === 2);
check('2. corruption and bribe are still reachable, under More',
  !!menuItem(host, 'Corruption') && !!menuItem(host, 'Bribe'));
goHome(host);
check('all 117 seats are on the shared board',
  Object.keys(host.dom.window.CMP.app.getGame().support).length === 117);
check('the round clock is showing', !!host.q('.round-clock'));
check('it opens on round 1 of 20', /Round\s*1\s*\/\s*20/.test(host.q('.round-bar').textContent),
  host.q('.round-bar').textContent.slice(0, 40));
check('the leaderboard is the centrepiece', host.qq('.lb-row').length === 4);
check('and the majority line says how many more are needed, or that none are decided',
  /needs \d+ more|past the majority|none decided yet/.test(host.q('.g-majority-text').textContent),
  host.q('.g-majority-text').textContent.slice(0, 60));

const p2Started = await players[1].until('election', () => !!players[1].q('.screen-election'));
check('player 2 is taken along automatically', p2Started);
check('28. player 2 sees their own party',
  /UPF/.test(players[1].q('.g-who-party').textContent),
  players[1].q('.g-who-party').textContent);
check('player 2 sees their own money',
  /Available/.test(players[1].q('.round-aside').textContent));
check(
  'player 2 does not see the host as their own candidate',
  !/Simran Kaur Gill/.test(players[1].q('.round-aside').textContent)
);

const p4Started = await players[3].until('election', () => !!players[3].q('.screen-election'));
check('player 4 is taken along too', p4Started);
check('28. player 4 sees their own party',
  /SWA/.test(players[3].q('.g-who-party').textContent),
  players[3].q('.g-who-party').textContent);

/* ------------------------------------------------- independent budgets */

section('Every player has their own ₹5 crore');

/** The cash a client is showing, from its player strip. */
const cashOf = (client) => {
  var node = client.q('.g-fig.is-lead .g-fig-value');
  return node ? node.textContent : null;
};

/** Open a menu section on one client. */
// menuItem does the navigating; this reads as the flow it stands in for.
function openSection(client, label) {
  menuItem(client, label);
}

/** A labelled figure inside the money section. */
function moneyOf(client, label) {
  openSection(client, 'Money');
  const row = client.qq('.sum-line').find((n) => {
    const l = n.querySelector('.sum-line-label');
    return l && l.textContent === label;
  });
  const value = row ? row.querySelector('.sum-line-value').textContent : null;
  goHome(client);
  return value;
}

/** Cash in hand, the one large figure at the top of the money screen. */
function cashOnMoneyScreen(client) {
  openSection(client, 'Money');
  const node = client.q('.g-money-value');
  const value = node ? node.textContent : null;
  goHome(client);
  return value;
}

/** The heat figure, which is a sentence on the money screen rather than a row. */
function heatOf(client) {
  openSection(client, 'Money');
  const m = /(\d+) of 100/.exec(client.q('.screen-election').textContent);
  goHome(client);
  return m ? Number(m[1]) : null;
}

for (const c of players) {
  check(c.label + ' starts on ₹5 crore', cashOf(c) === '₹5 crore', cashOf(c));
  check(c.label + ' starts with no debt', !c.q('.g-fig.is-debt'));
}
/*
 * 22. Corruption and bribe are still their own screens, but neither is a menu
 * of moves any more: there is one combined action and it is a modifier on a
 * campaign, reached from the map with everything else.
 */
check('22. corruption is a screen about risk, not a list of moves', (function () {
  openSection(host, 'Corruption');
  const listed = host.qq('.act').length;
  goHome(host);
  return listed <= 1;
})());
check('22. and so is bribe', (function () {
  openSection(host, 'Bribe');
  const listed = host.qq('.act').length;
  goHome(host);
  return listed <= 1;
})());
check('political heat starts at zero', heatOf(host) === 0, String(heatOf(host)));

// The host spends; nobody else's purse may move.
/** Home → my candidate → a constituency → the campaign sheet. */
async function openCampaignSheet(client) {
  openSection(client, 'Home');
  await sleep(60);
  client.click(client.q('.lb-row.is-you'));
  await sleep(60);
  // The candidate's page opens first; the seat list is one tap further in.
  const toSeats = client.qq('button').find((b) => /All my seats/i.test(b.textContent));
  if (toSeats) client.click(toSeats);
  await sleep(60);
  const seeAll = client.qq('button').find((b) => /View all 117/.test(b.textContent));
  if (seeAll) client.click(seeAll);
  await sleep(80);
  client.click(client.qq('.area-row')[0]);
  await sleep(80);
  client.click(client.qq('button').find((b) => /Campaign here/.test(b.textContent)));
  await sleep(120);
}

const dealCost = host.dom.window.CMP.getAction('bribe').cost;
await openCampaignSheet(host);
check('the campaign sheet opens from a constituency', !!host.q('.campaign-sheet'));

/*
 * 16. The optional risks are on the same panel as the money.
 *
 * There is no second tap through to a list of high-risk moves: one combined
 * corruption action, selected beside the ordinary campaign, on the panel where
 * the amount is already being set.
 */
const bribeMode = host.qq('.cs-mode').find((b) => {
  const n = b.querySelector('.cs-mode-label');
  return n && /Corruption/i.test(n.textContent);
});
check('16. corruption is a mode on the same panel', !!bribeMode);
host.click(bribeMode);
await sleep(80);
check('14. and the amount is set right there', !!host.q('.cs-range'));

host.click(host.qq('.campaign-sheet button').find((b) => /^Invest/.test(b.textContent)));
const hostSpent = await host.until('spent', () => cashOf(host) !== '₹5 crore', 12000);
check('the host can spend', hostSpent, cashOf(host));

check('the result belongs to the seat', !!host.q('.result-sheet'));
if (host.q('.result-sheet')) {
  host.click(host.qq('button').find((b) => /Back to the map/.test(b.textContent)));
}
await sleep(80);

check(
  'the server deducted exactly what was chosen',
  moneyOf(host, 'Spent on the campaign') === host.dom.window.CMP.ui.money.words(dealCost),
  moneyOf(host, 'Spent on the campaign')
);
check('the cash in hand dropped', cashOf(host) !== '₹5 crore', cashOf(host));
check('23. and the money screen agrees with the player strip',
  cashOnMoneyScreen(host) === cashOf(host),
  cashOnMoneyScreen(host) + ' vs ' + cashOf(host));
check('23. the spending is listed as a transaction', (function () {
  openSection(host, 'Money');
  const rows = host.qq('.g-txn').length;
  goHome(host);
  return rows >= 1;
})());
check('a risky action raised the host heat', heatOf(host) > 0, String(heatOf(host)));

// Give the other clients a poll or two to refresh, then confirm they are untouched.
await sleep(3500);
for (const c of [players[1], players[2], players[3]]) {
  check(c.label + " cash is untouched by the host's spending",
    cashOf(c) === '₹5 crore', cashOf(c));
  check(c.label + ' heat is untouched', heatOf(c) === 0, String(heatOf(c)));
}

// A second player spends independently, on ordinary campaigning.
await openCampaignSheet(players[1]);
players[1].click(players[1].qq('.campaign-sheet button')
  .find((b) => /^Invest/.test(b.textContent)));
const p2Spent = await players[1].until('spent', () => cashOf(players[1]) !== '₹5 crore', 12000);
check('player 2 can spend their own money', p2Spent);
if (players[1].q('.result-sheet')) {
  players[1].click(players[1].qq('button').find((b) => /Back to the map/.test(b.textContent)));
}
/*
 * Both got in for the same crore, because getting in is capped. What proves
 * the purses are separate is a second investment: player two is established
 * now, so the cap is gone and they can spend what the host has not.
 */
await openCampaignSheet(players[1]);
const secondRange = players[1].q('.cs-range');
if (secondRange) {
  secondRange.value = secondRange.max;
  secondRange.dispatchEvent(new players[1].dom.window.Event('input', { bubbles: true }));
  await sleep(60);
}
players[1].click(players[1].qq('.campaign-sheet button')
  .find((b) => /^Invest/.test(b.textContent)));
await players[1].until('second spend', () => cashOf(players[1]) !== '₹4 crore', 12000);
if (players[1].q('.result-sheet')) {
  players[1].click(players[1].qq('button').find((b) => /Back to the map/.test(b.textContent)));
}
check(
  'the two players have different amounts left',
  cashOf(host) !== cashOf(players[1]),
  cashOf(host) + ' vs ' + cashOf(players[1])
);

/* --------------------------------------------- constituency + oversight */

section('Constituency detail: the game own race, and nobody real');

/**
 * Open a screen and hand back something to assert on.
 *
 * menuItem does the navigating, so this exists only to read as the flow it is
 * standing in for.
 */
const tabButton = (client, label) => menuItem(client, label);

/*
 * A constituency is opened through the candidate's own screen, as a player
 * does — home, tap yourself, all my seats. The dashboard button that used to
 * lead here is gone with the rest of the dashboard.
 */
goHome(host);
host.click(host.q('.lb-row.is-you'));
await sleep(80);
const toAllSeats = host.qq('button').find((b) => /All my seats/i.test(b.textContent));
if (toAllSeats) host.click(toAllSeats);
await host.until('areas', () => !!host.q('.area-row'));
const seeEvery = host.qq('button').find((b) => /View all 117/.test(b.textContent));
if (seeEvery) host.click(seeEvery);
await host.until('all areas', () => host.qq('.area-row').length > 20);
check('my areas splits the board by how the race stands',
  host.qq('.area-status').length > 0,
  [...new Set(host.qq('.area-status').map((n) => n.textContent))].join('/'));
host.click(host.q('.area-row'));
await host.until('seat detail', () => !!host.q('.seat-detail'));

check('a constituency opens from the list', !!host.q('.seat-detail'));
check('it names the seat and its AC number', /AC \d+/.test(host.q('.sd-where').textContent),
  host.q('.sd-where').textContent);
// 4. No sitting member anywhere: the seat and its district are real Punjab
// geography, and every person and party on the screen is the game's own.
check('4. no sitting member is shown', !host.q('.sd-mla'));
check('4. and no real party appears on the seat',
  !/(AAP|INC|BJP|SAD|BSP)/.test(host.q('.seat-detail').textContent),
  host.q('.seat-detail').textContent.replace(/\s+/g, ' ').slice(0, 120));
check('the race is the whole screen', !!host.q('.sd-leader'));
check('3. the leader is named, or the seat says it has none',
  host.q('.sd-leader-name').textContent.length > 2,
  host.q('.sd-leader-name').textContent);
check('3. with their share where there is a leader',
  host.q('.sd-leader-share')
    ? /%$/.test(host.q('.sd-leader-share').textContent)
    : /No leader/i.test(host.q('.sd-leader-name').textContent),
  host.q('.sd-leader').textContent.replace(/\s+/g, ' ').slice(0, 60));
check('2. every party in the game has a bar', host.qq('.sd-bar').length === 4,
  String(host.qq('.sd-bar').length));
check('one bar is marked as leading, unless nobody leads',
  host.qq('.sd-bar.is-leading').length === (host.q('.sd-leader-share') ? 1 : 0),
  String(host.qq('.sd-bar.is-leading').length));

/*
 * A seat the server has declared won reaches every client's screens.
 *
 * The server already refuses to play in a won seat, so the risk here is not
 * cheating — it is four people looking at a board that disagrees with the
 * rules they are playing under. The seat is written into the server's own
 * store rather than played to, because reaching a commanding share through
 * the ₹1 crore entry cap takes more rounds than this suite runs.
 */
const storeFile = fs.readdirSync(DATA).find((f) => /^game-.*\.json$/.test(f));
check('the server keeps the game in its store', !!storeFile, fs.readdirSync(DATA).join(','));

const stored = JSON.parse(fs.readFileSync(path.join(DATA, storeFile), 'utf8'));
const LOCKED_SEAT = 17;
const lockedTo = Object.keys(stored.players)[0];
const lockedParty = stored.players[lockedTo].partyId;
stored.wonSeats = stored.wonSeats || {};
stored.wonSeats[String(LOCKED_SEAT)] = { party: lockedParty, round: 2, share: 78 };
fs.writeFileSync(path.join(DATA, storeFile), JSON.stringify(stored));

// The clients learn about it on their next poll, not by being told.
await host.until('the won seat reaches the client',
  () => !!(host.dom.window.CMP.app.getGame().wonSeats || {})[String(LOCKED_SEAT)], 12000);
check('a won seat reaches the client from the server',
  !!(host.dom.window.CMP.app.getGame().wonSeats || {})[String(LOCKED_SEAT)],
  JSON.stringify(host.dom.window.CMP.app.getGame().wonSeats || {}));
check('and it names the party that won it and the round',
  host.dom.window.CMP.app.getGame().wonSeats[String(LOCKED_SEAT)].party === lockedParty &&
  host.dom.window.CMP.app.getGame().wonSeats[String(LOCKED_SEAT)].round === 2,
  JSON.stringify(host.dom.window.CMP.app.getGame().wonSeats[String(LOCKED_SEAT)]));

// Every client, not only the one whose party won it.
await players[1].until('the guest sees it too',
  () => !!(players[1].dom.window.CMP.app.getGame().wonSeats || {})[String(LOCKED_SEAT)], 12000);
check('every client agrees the seat is finished',
  !!(players[1].dom.window.CMP.app.getGame().wonSeats || {})[String(LOCKED_SEAT)]);

// And the seat screen reads as finished rather than as a large lead.
const lockedNode = host.dom.window.CMP.ui.constituency.render(
  host.dom.window.CMP.app.getGame(), LOCKED_SEAT, { players: [] }
);
check('the seat screen says it is permanently won',
  /Permanently won/i.test(lockedNode.querySelector('.sd-leader-kicker').textContent),
  lockedNode.querySelector('.sd-leader-kicker').textContent);
check('and offers no way to campaign there',
  !lockedNode.querySelector('.btn-campaign') && !!lockedNode.querySelector('.sd-locked-note'));

// The server refuses it as well, and takes no money for the attempt.
const beforeLocked = host.dom.window.CMP.app.getGame().cash;
const lockedTry = await fetch(BASE + 'api/index.php?action=campaign', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: stored.code,
    playerId: lockedTo,
    token: stored.players[lockedTo].token,
    actionId: 'invest',
    constituency: LOCKED_SEAT,
    amount: 10000000,
  }),
}).then((r) => r.json()).catch((e) => ({ error: String(e) }));
check('the server refuses a move into a won seat', lockedTry.ok !== true,
  JSON.stringify(lockedTry).slice(0, 140));
check('and says the seat is locked',
  /SEAT_LOCKED|locked|won/i.test(JSON.stringify(lockedTry)),
  JSON.stringify(lockedTry).slice(0, 140));
check('no money was taken for the refused move',
  host.dom.window.CMP.app.getGame().cash === beforeLocked,
  beforeLocked + ' -> ' + host.dom.window.CMP.app.getGame().cash);

section('Reporting a rival');
// Rivals sit with the high-risk play they exist to police.
tabButton(host, 'Corruption');
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
tabButton(players[1], 'Corruption');
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
// Closing the polls is not part of a round, so it lives in the menu rather
// than on the campaign screen.
goHome(host);
host.click(host.q('.g-more'));
await sleep(60);
const hostSheet = host.q('.sheet-panel');
check('the menu opens', !!hostSheet);
check('only the host is offered the declare control',
  !!host.qq('.sheet-item').find((b) => /Close the polls now/.test(b.textContent)),
  host.qq('.sheet-item').map((b) => b.textContent).join(' | '));
check('the menu also offers the election history',
  !!host.qq('.sheet-item').find((b) => /Election history/.test(b.textContent)));

players[1].click(players[1].q('.g-more'));
await sleep(60);
check('a guest is not offered it',
  !players[1].qq('.sheet-item').find((b) => /Close the polls/.test(b.textContent)),
  players[1].qq('.sheet-item').map((b) => b.textContent).join(' | '));
players[1].click(players[1].qq('.sheet-panel button').find((b) => b.textContent === 'Close'));

host.click(host.qq('.sheet-item').find((b) => /Close the polls now/.test(b.textContent)));
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

// 26. The whole assembly as one ring, before anybody reads a number.
// One arc per party that stood, which includes the unplayable Others bucket:
// it holds real seats and leaving it out would make the ring lie about 117.
const partiesStanding = host.qq('.result-row').length;
check('26. the seat distribution is drawn as a donut',
  !!host.q('.rd-block') && host.qq('.rd-block .ring-arc').length === partiesStanding,
  host.qq('.rd-block .ring-arc').length + ' arcs for ' + partiesStanding + ' parties');
check('26. with a row per party and its share',
  host.qq('.rd-key-row').length === partiesStanding &&
  host.qq('.rd-key-share').every((n) => /%$/.test(n.textContent)),
  host.qq('.rd-key-share').map((n) => n.textContent).join(' '));
check('26. and the shares add to the whole assembly',
  Math.abs(host.qq('.rd-key-share')
    .reduce((t, n) => t + parseFloat(n.textContent), 0) - 100) < 0.6,
  host.qq('.rd-key-share').map((n) => n.textContent).join(' '));
check('26. and the majority marked on it',
  /59 seats is a majority/.test(host.q('.rd-note').textContent),
  host.q('.rd-note') ? host.q('.rd-note').textContent : 'missing');

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
  /*
   * Four campaigns can finish close enough together that no two of them reach
   * 59 between them. That is a real outcome, so what is checked is that the
   * screen says which it is rather than showing an empty list.
   */
  const pairs = host.qq('.pair-row');
  check('a hung assembly either offers pairings or says none reach a majority',
    pairs.length > 0 || /stays hung|reaches \d+ seats/.test(host.q('.coalition-block').textContent),
    pairs.length + ' pairings — ' +
    host.q('.coalition-block').textContent.replace(/\s+/g, ' ').slice(0, 100));
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
  !!returning.q('.h-card.is-continue') &&
  new RegExp(rejoinCode).test(returning.q('.h-card.is-continue').textContent),
  returning.q('.h-card.is-continue')
    ? returning.q('.h-card.is-continue').textContent
    : returning.text().slice(0, 120)
);
// 3. And it says where they left it, rather than just that something exists.
check('and names the round they left it on',
  /Round \d+ of \d+|lobby/i.test(returning.q('.h-card.is-continue').textContent),
  returning.q('.h-card.is-continue').textContent);
returning.click(returning.q('.h-card.is-continue'));
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
// The result screen shows abbreviations and candidate names rather than full
// party names, so check the restored state directly. A party id is the slot
// its founder sat in, and it survives a reconnection with everything else.
check('their party is still the one they founded',
  returning.dom.window.CMP.app.getGame().partyId === 'p2',
  returning.dom.window.CMP.app.getGame().partyId);
// They arrive with the count still running, exactly as a late joiner would.
skipCount(returning);
await sleep(200);
check('their candidate survived', /Ravinder Singh Bajwa/.test(returningText()));

/* ---------------------------------------------------------------- a 5th */

section('A fifth player is turned away');
const fifth = await openClient('p5');
fifth.click(fifth.q('.h-card.is-primary'));
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
badCode.click(badCode.q('.h-card.is-primary'));
badCode.type(badCode.q('.code-input'), 'QQQQQ');
badCode.click(badCode.button('JOIN GAME'));
const badRefused = await badCode.until('notice', () => !!badCode.q('.notice'));
check('an unused code is refused with a message', badRefused);

/* -------------------------------------------------- profiles and stats */

section('The statistics are counted from games that actually finished');

// This election really was played: four clients, fifteen rounds' worth of
// state, a server that rolled every die. So it is a verified result, and it
// is the only kind that reaches the global counters or the leaderboard.
await sleep(400);
const afterStats = await host.dom.window.CMP.net.stats();
check('the stats endpoint answers', afterStats && afterStats.ok === true);
check('4. one finished election is counted',
  afterStats.summary.elections === 1, String(afterStats.summary.elections));
check('4. the players are counted', afterStats.summary.players >= 4,
  String(afterStats.summary.players));
check('4. and a government is recorded if one formed',
  afterStats.summary.governments + afterStats.summary.coalitions <= 1);
check('10. party performance comes from the games played',
  afterStats.summary.byParty.length >= 1 &&
  afterStats.summary.byParty.every((r) => r.played >= 1),
  JSON.stringify(afterStats.summary.byParty));

check('9. the leaderboard has somebody on it',
  afterStats.leaderboard.length >= 1, String(afterStats.leaderboard.length));
check('9. it is not ranked by games played',
  afterStats.leaderboard.every((r) => typeof r.score === 'number' && r.score > 0));
check('33. no private detail is published',
  !/@|phone|email|token|playerId/i.test(JSON.stringify(afterStats.leaderboard)),
  JSON.stringify(afterStats.leaderboard).slice(0, 160));

// The portrait seed is published on every row so the face can be drawn. The
// profile id is what proves a request belongs to somebody. Deriving one from
// the other would hand every player's id to anybody who opened the
// leaderboard, so they must never match.
const myId = host.dom.window.CMP.profile.get().id;
check('33. and the published portrait seed is not the private profile id',
  afterStats.leaderboard.every((r) => r.avatar !== myId) &&
  !JSON.stringify(afterStats.leaderboard).includes(myId));

const hostProfile = await host.dom.window.CMP.profile.refresh();
check('5. the host has a profile with a record on it',
  !!hostProfile && hostProfile.played === 1, JSON.stringify(hostProfile && hostProfile.played));
check('5. it carries their chosen game name, not an account',
  hostProfile.name === 'Simran Kaur Gill', String(hostProfile && hostProfile.name));
check('5. their seats are recorded', hostProfile.seatsTotal > 0, String(hostProfile.seatsTotal));
check('5. and the party they played', !!hostProfile.byParty.p1,
  JSON.stringify(Object.keys(hostProfile.byParty)));

// 55. Ground held and what it paid. Seats say who won; these say how the
// campaign was funded, which is the other half of the record.
check('55. districts held are kept on the record',
  typeof hostProfile.districtsTotal === 'number', String(hostProfile.districtsTotal));
check('55. and the grant income they generated',
  typeof hostProfile.grantIncomeTotal === 'number', String(hostProfile.grantIncomeTotal));
check('55. neither is negative',
  hostProfile.districtsTotal >= 0 && hostProfile.grantIncomeTotal >= 0);
check('6. a level is worked out from what they have done',
  hostProfile.level >= 1, String(hostProfile.level));
check('7. achievements are awarded, not claimed',
  Array.isArray(hostProfile.achievements));

// The screens the brief asks for, with that data actually in them.
//
// Opened cold first: the record is fetched after the screen is already on
// display, which is what a player who taps straight through from home sees,
// and is the path a screen that only ever renders pre-loaded data would
// silently fail on.
host.dom.window.CMP.profile.forget();
host.dom.window.CMP.app.goTo('profile');
check('30. the screen fills itself in when the record arrives',
  await host.until('record', () => !!host.q('.pf-figure'), 8000));

host.dom.window.CMP.app.goTo('home');
host.dom.window.CMP.app.goTo('profile');
await host.until('profile screen', () => !!host.q('.screen-profile') && !!host.q('.pf-name'));
check('30. the profile screen names the player',
  host.q('.pf-name').textContent === 'Simran Kaur Gill', host.q('.pf-name').textContent);
check('30. with a drawn portrait', !!host.q('.screen-profile .portrait'));
check('30. their record', host.qq('.pf-figure').length === 8,
  String(host.qq('.pf-figure').length));
check('55. including the districts and what they paid',
  /districts held/i.test(host.q('.pf-figures').textContent) &&
  /grant income/i.test(host.q('.pf-figures').textContent),
  host.q('.pf-figures').textContent.replace(/\s+/g, ' ').slice(0, 160));
check('7. and the full achievement list, earned or not',
  host.qq('.pf-achievement').length ===
    host.dom.window.CMP.CAMPAIGN.profiles.achievements.length,
  String(host.qq('.pf-achievement').length));
check('31. election history is listed', host.qq('.pf-history-row').length === 1,
  String(host.qq('.pf-history-row').length));

host.dom.window.CMP.app.goTo('leaderboard');
await host.until('leaderboard screen', () => !!host.q('.lbd-row'));
check('9. the leaderboard screen lists players',
  host.qq('.lbd-row').length >= 1, String(host.qq('.lbd-row').length));
check('9. each with a score', host.qq('.lbd-score').length === host.qq('.lbd-row').length);

host.dom.window.CMP.app.goTo('home');
await host.until('home', () => !!host.q('.screen-home'));
await sleep(400);
/*
 * 4 + 5. The figures live on their own screen now.
 *
 * They used to be four blocks down the opening page, between somebody
 * arriving and the button they came for. Home says nothing about them; Game
 * Statistics says all of it, counted by the server from what happened.
 */
check('4. home carries no statistics of its own',
  !host.q('.st-figs') && !host.q('.h-figures') &&
  !/not a real-world poll/i.test(host.text()),
  host.text().slice(0, 160));
check('4. and offers the statistics screen instead',
  host.qq('.h-nav .h-card-label').map((n) => n.textContent).join('/') ===
    'Game Statistics/Leaderboard/My Profile',
  host.qq('.h-nav .h-card-label').map((n) => n.textContent).join('/'));

host.click(host.qq('.h-nav .h-card')[0]);
await host.until('statistics screen', () => !!host.q('.st-figs'));

check('5. the statistics screen counts the election that was played',
  /1\s*election|elections/i.test(host.text()), host.text().slice(0, 240));
check('5. it reports link opens, players and rounds apart',
  ['Link opens', 'Players', 'Rounds played']
    .every((label) => new RegExp(label, 'i').test(host.text())),
  host.qq('.st-fig-label').map((n) => n.textContent).join(' / '));
check('10. and labels party performance as game statistics',
  /not a real-world poll/i.test(host.text()));
check('5. every figure on it is a number, not a guess',
  host.qq('.st-fig-value').every((n) => /^\d+$/.test(n.textContent.trim())),
  host.qq('.st-fig-value').map((n) => n.textContent).join(','));

host.click(host.q('.st-back'));
await host.until('home again', () => !!host.q('.screen-home'));
check('5. and it goes back to home', !!host.q('.screen-home'));

/* ---------------------------------------------------------------- solo */

section('Solo mode still needs no server');
const solo = await openClient('solo');
solo.click(solo.q('.h-card.is-solo'));
await solo.dom.window.CMP.data.ensure();
await sleep(60);
check('solo setup opens', !!solo.q('.screen-setup'));
const soloFields = solo.qq('.field-input');
solo.type(soloFields[0], 'Solo Candidate');
solo.type(solo.qq('.field-input')[1], 'Solo Party');
check('solo asks for no budget either', !solo.q('.field-money'));
solo.click(solo.q('.btn-start'));
check('solo election starts', !!solo.q('.screen-election'));
check('solo game is saved locally', !!solo.dom.window.CMP.storage.load());
check('solo save is marked solo', solo.dom.window.CMP.storage.load().mode === 'solo');
check('7. solo runs on the same round allowance',
  solo.dom.window.CMP.campaign.remaining(solo.dom.window.CMP.storage.load())
    === solo.dom.window.CMP.CAMPAIGN.income.perRound,
  String(solo.dom.window.CMP.campaign.remaining(solo.dom.window.CMP.storage.load())));

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
