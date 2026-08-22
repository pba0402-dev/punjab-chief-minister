/**
 * Incumbents, election day, coalitions and investigations.
 * ------------------------------------------------------------------
 * Drives the API directly for the systems that only exist server-side.
 * The parts that matter most here are the ones that are easy to get subtly
 * wrong: reports must not be inflatable by one player, three reports must not
 * be a guaranteed conviction, a fine must never push a budget negative, and a
 * hung assembly must actually open coalition talks.
 *
 *   node tools/test-systems.mjs
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
const ROUND_SECONDS = 8;
const BREAK_SECONDS = 2;
const DATA = path.join(os.tmpdir(), 'cmp-sys-test-' + Date.now());

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

fs.mkdirSync(DATA, { recursive: true });
const php = spawn('php', ['-S', '127.0.0.1:' + PORT, '-t', ROOT], {
  cwd: ROOT,
  // Short rounds. This suite is about incumbents, investigations and
  // coalitions rather than the clock, but a round only allows so many moves,
  // and one check below needs a fresh round rather than a sixty-second wait.
  // Eight seconds is short enough to wait for and long enough that no section
  // here runs out of campaign underneath itself.
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
  } catch (e) {}
});
const phpErrors = [];
php.stderr.on('data', (d) => {
  const s = String(d);
  if (/Fatal error|Parse error|Uncaught|Warning/i.test(s)) phpErrors.push(s.trim());
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE + '?action=health')).ok) break;
  } catch (e) {}
  await sleep(150);
}

const J = async (a, p) =>
  (
    await fetch(BASE + '?action=' + a, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p || {}),
    })
  ).json();
const G = async (a, p) => (await fetch(BASE + '?action=' + a + '&' + new URLSearchParams(p))).json();

// Parties are invented now, so a test that wants a game has to found some.
const NAMES = ['Party One', 'Party Two', 'Party Three', 'Party Four'];
const SYMBOLS = ['star', 'tree', 'lion', 'river'];
const COLOURS = ['saffron', 'indigo', 'emerald', 'crimson'];

/**
 * Stand up a full four-player game already in the campaign phase.
 *
 * `count` is how many humans sit down; any chair left empty is filled by an
 * opponent when the host starts, exactly as it is in a real game.
 */
async function startGame(count) {
  count = count || 2;
  const names = NAMES;
  const host = await J('create');
  if (!host.code) console.log('  create failed: ' + JSON.stringify(host).slice(0, 300));
  const creds = [{ code: host.code, playerId: host.playerId, token: host.token }];
  for (let i = 1; i < count; i++) {
    const j = await J('join', { code: host.code });
    creds.push({ code: host.code, playerId: j.playerId, token: j.token });
  }
  for (let i = 0; i < count; i++) {
    await J('party', {
      ...creds[i],
      name: names[i],
      short: 'P' + (i + 1),
      symbol: SYMBOLS[i],
      colourId: COLOURS[i],
    });
    await J('details', { ...creds[i], candidateName: 'Candidate ' + (i + 1), slogan: 'Slogan ' + (i + 1) });
    await J('ready', { ...creds[i], ready: true });
  }
  const started = await J('start', creds[0]);
  return { code: host.code, creds, started };
}

/* --------------------------------------------------------- empty board */

/*
 * A new election starts on nothing.
 *
 * Not "nearly nothing", and not "a starting position somebody could argue
 * about" — every one of the 117 constituencies holds no influence, has no
 * leader and shows no percentage until somebody spends money in it. That is
 * the single fact this whole change exists to make true, so it is checked at
 * the database level rather than by reading the screen.
 */
section('A new election starts on nothing');

const g1 = await startGame();
if (!g1.started || !g1.started.game) {
  console.log('  start failed: ' + JSON.stringify(g1.started));
}
const view1 = g1.started.game;
check('the election starts', view1.phase === 'election');

const me1 = view1.players.find((p) => p.isYou);
check('the board is dealt', Object.keys(view1.board).length === 117);
check('and it is one board everyone shares', !me1.support,
  'players should not carry their own copy');
check('the round clock has started', view1.round === 1 && view1.secondsLeft > 0,
  'round ' + view1.round + ', ' + view1.secondsLeft + 's left');

const seatsWithAnything = Object.entries(view1.board)
  .filter(([, seat]) => Object.values(seat || {}).some((v) => Number(v) > 0));
check('117 of 117 constituencies are empty', seatsWithAnything.length === 0,
  seatsWithAnything.length + ' had support: ' +
  seatsWithAnything.slice(0, 3).map(([n, s]) => n + '=' + JSON.stringify(s)).join(' '));

check('no constituency has a leader',
  Object.keys(view1.leaders || {}).length === 0,
  Object.keys(view1.leaders || {}).length + ' leaders');

check('every player is on zero seats',
  view1.players.every((p) => (p.seatsLed || 0) === 0),
  JSON.stringify(view1.players.map((p) => p.seatsLed)));

// Nothing anywhere in what the server sends should look like a poll, an MLA
// or a real party. This is the check that would catch seed data creeping back
// in through some other door.
const wire = JSON.stringify(view1);
check('no real party codes are shipped',
  !/"(aap|inc|bjp|sad|bsp)"/i.test(wire),
  (wire.match(/"(aap|inc|bjp|sad|bsp)"/i) || [''])[0]);
check('and no sitting-member data',
  !/\bmla\b|byElection|incumben/i.test(wire),
  (wire.match(/\bmla\b|byElection|incumben/i) || [''])[0]);

/* --------------------------------------------------------- the parties */

section('Parties are invented, not chosen');

check('every party in the game has a name',
  (view1.parties || []).length === 4 && view1.parties.every((p) => p.name),
  JSON.stringify((view1.parties || []).map((p) => p.name)));
check('and an abbreviation, a symbol and a colour',
  view1.parties.every((p) => p.short && p.symbol && p.colour),
  JSON.stringify(view1.parties.map((p) => p.short + '/' + p.symbol + '/' + p.colour)));
check('ids are slots, so two parties may share a name',
  view1.parties.every((p, i) => p.id === 'p' + (i + 1)),
  view1.parties.map((p) => p.id).join(','));
check('the ones the players typed are the ones that came back',
  view1.parties[0].name === 'Party One' && view1.parties[1].name === 'Party Two',
  view1.parties.slice(0, 2).map((p) => p.name).join(' / '));

// Opponents fill the empty chairs and must be told apart from each other.
const aiParties = view1.parties.slice(2);
check('opponents invent their own parties',
  aiParties.every((p) => p.name && p.name !== 'Unnamed Party'),
  JSON.stringify(aiParties.map((p) => p.name)));
check('and no two parties share a colour',
  new Set(view1.parties.map((p) => p.colour)).size === 4,
  view1.parties.map((p) => p.colour).join(','));
check('or a symbol',
  new Set(view1.parties.map((p) => p.symbol)).size === 4,
  view1.parties.map((p) => p.symbol).join(','));

/* ------------------------------------------------------- reporting */

section('Reporting');
const [a, b, c, d] = g1.creds;
const accused = view1.players.find((p) => p.slot === 4).id;

const r1 = await J('report', { ...a, accusedId: accused, reason: 'spending' });
check('a first report is accepted', r1.ok === true, r1.error);
const acc1 = r1.game.players.find((p) => p.id === accused);
check('it is counted', acc1.reportsAgainst === 1, String(acc1.reportsAgainst));
check('one report opens nothing', (acc1.investigations || []).length === 0);

const dup = await J('report', { ...a, accusedId: accused, reason: 'rules' });
check('the same player cannot report twice', dup.ok === false, dup.error);
check('the refusal says so plainly', /already reported/i.test(dup.error || ''), dup.error);
const afterDup = await G('state', a);
check('the count did not move', afterDup.game.players.find((p) => p.id === accused).reportsAgainst === 1);

const self = await J('report', { ...a, accusedId: a.playerId, reason: 'other' });
check('you cannot report yourself', self.ok === false, self.error);
const badReason = await J('report', { ...b, accusedId: accused, reason: 'nonsense' });
check('a report needs a valid reason', badReason.ok === false, badReason.error);

const r2 = await J('report', { ...b, accusedId: accused, reason: 'activity' });
check('a second, different reporter opens an investigation', r2.ok === true, r2.error);
const acc2 = r2.game.players.find((p) => p.id === accused);
check('an investigation is on record', (acc2.investigations || []).length === 1);
check('the finding is one of the configured outcomes',
  ['CLEARED', 'WARNING', 'FINE', 'MAJOR FINE', 'CAMPAIGN RESTRICTION', 'DISQUALIFICATION']
    .includes(acc2.investigations[0].outcomeLabel),
  acc2.investigations[0].outcomeLabel);
check('reports are consumed once acted on', acc2.reportsAgainst === 0, String(acc2.reportsAgainst));

// Reports being consumed must not reopen the door: two players cycling reports
// at a third would otherwise grind them down with repeated inquiries.
const recycled = await J('report', { ...a, accusedId: accused, reason: 'rules' });
check('a reporter cannot report the same player again after an inquiry',
  recycled.ok === false, JSON.stringify(recycled).slice(0, 100));
check('the refusal is the same one', /already reported/i.test(recycled.error || ''), recycled.error);
const stillClear = await G('state', a);
check('no second inquiry was triggered',
  (stillClear.game.players.find((p) => p.id === accused).investigations || []).length === 1);
console.log('     finding: ' + acc2.investigations[0].outcomeLabel);

check('the evidence score is never sent to clients',
  !JSON.stringify(r2.game).includes('"evidence"'));

/* ------------------------------------------- reports are not verdicts */

section('Reports are not verdicts');

/*
 * How the evidence score shifts the odds is sampled in test-campaign.mjs,
 * which can put a player in any state it likes and take hundreds of samples in
 * the time three HTTP round-trips take here. What is worth checking through
 * the real API is that the whole path works: three reports open an inquiry, a
 * finding comes back, and the score behind it never leaves the server.
 */
const gv = await startGame(4);
const clean = gv.started.game.players.find((p) => p.slot === 4).id;
await J('report', { ...gv.creds[0], accusedId: clean, reason: 'other' });
await J('report', { ...gv.creds[1], accusedId: clean, reason: 'other' });
const verdictRes = await J('report', { ...gv.creds[2], accusedId: clean, reason: 'other' });
const accV = verdictRes.game.players.find((p) => p.id === clean);
const finding = (accV.investigations || []).slice(-1)[0];

check('an inquiry opened and resolved', !!finding, JSON.stringify(accV.investigations || []));
check('the finding has a label a player can read', !!(finding && finding.outcomeLabel));
check('the finding explains itself', !!(finding && finding.text && finding.text.length > 10));
check('it records how many reports stood', finding && finding.reports >= 2, String(finding && finding.reports));
check('a clean player is not automatically guilty',
  !finding.disqualified, finding.outcomeId);
check('the evidence score never leaves the server',
  !JSON.stringify(verdictRes.game).includes('evidence'));

/* ------------------------------------------------------- fines */

section('Fines come out of cash');
const gf = await startGame(4);
const poorId = gf.started.game.players.find((p) => p.slot === 4).id;
const poor = gf.creds[3];

// A round allows a fixed number of moves, so this spends what one round
// allows rather than emptying the purse in a burst. The case where a fine
// exceeds what is in hand is covered deterministically in test-campaign.mjs,
// which can put a player on any balance it likes; what matters here is that
// the whole path through the real API keeps cash out of the negative.
/*
 * Spend until the money stops it.
 *
 * A round is bounded by money, not by a move counter, and one corruption
 * costs a crore against an allowance of five — so the loop has to be able to
 * run past five before it sees the refusal it is here to check.
 */
let spendGuard = 0;
let refusal = null;
while (spendGuard++ < 12) {
  /*
   * The first attempt gets into the seat at the entry cap; every one after it
   * is unrestricted and asks for three crore, so what stops the run is the
   * purse rather than the entry rule.
   */
  const res = await J('campaign', {
    ...poor,
    actionId: 'bribe',
    constituency: 20,
    amount: spendGuard === 1 ? 10000000 : 3 * 10000000,
  });
  if (!res.ok) {
    refusal = res.error;
    break;
  }
}
const before = (await G('state', poor)).game.players.find((p) => p.isYou);
// A round is bounded by money now, not by a move counter: what stops a
// player is running out, and the refusal says so.
check('a round ends when the money does',
  /More than you can spend|capped at/.test(refusal || ''), JSON.stringify(refusal));
check('spending it moved real money', before.spent > 0, '₹' + before.spent);

await J('report', { ...gf.creds[0], accusedId: poorId, reason: 'spending' });
await J('report', { ...gf.creds[1], accusedId: poorId, reason: 'rules' });
const after = (await G('state', poor)).game.players.find((p) => p.isYou);
check('cash never goes negative', after.cash >= 0, String(after.cash));
check('a fine is taken from cash in hand', after.finesPaid <= before.cash,
  after.finesPaid + ' fined against ' + before.cash + ' held');
check('spending never exceeds what came in',
  after.spent <= (after.incomeTotal || 0) + (after.grantTotalEarned || 0)
    + after.borrowed + after.granted + after.raised,
  after.spent + ' spent against ' + (after.incomeTotal || 0) + ' of income');

/* --------------------------------------------------- restriction */

section('Campaign restriction');
// Restriction is one outcome among several, so sample rather than hope, and
// report what actually came up if it never appears.
let restrictedSeen = false;
const seenOutcomes = {};
for (let i = 0; i < 60 && !restrictedSeen; i++) {
  const g = await startGame(4);
  const tid = g.started.game.players.find((p) => p.slot === 4).id;
  const tc = g.creds[3];
  // Three risky moves is a full round's allowance, and enough heat to make a
  // restriction one of the likelier findings.
  for (let k = 0; k < 3; k++) await J('campaign', { ...tc, actionId: 'bribe', constituency: 30 + k });
  await J('report', { ...g.creds[0], accusedId: tid, reason: 'influence' });
  const res = await J('report', { ...g.creds[1], accusedId: tid, reason: 'influence' });
  const acc = res.game.players.find((p) => p.id === tid);
  const last = (acc.investigations || []).slice(-1)[0];
  if (last) seenOutcomes[last.outcomeId] = (seenOutcomes[last.outcomeId] || 0) + 1;
  if (last && (last.restrictTurns > 0 || last.outcomeId === 'restriction')) {
    restrictedSeen = true;
    const blocked = await J('campaign', { ...tc, actionId: 'bribe', constituency: 50 });
    check('a restricted player cannot use risky strategies', blocked.ok === false, blocked.error);
    check('the reason explains the restriction', /restriction/i.test(blocked.error || ''), blocked.error);
    // The risky moves above used this round's allowance, so wait for the next
    // round before checking that safe campaigning is still open to them —
    // otherwise the refusal would be about moves, not about the restriction.
    // A round now settles into a short results break before the next one
    // opens, so wait out both.
    await sleep((ROUND_SECONDS + BREAK_SECONDS + 2) * 1000);
    const safe = await J('campaign', { ...tc, actionId: 'invest', constituency: 50 });
    check('but safe campaigning still works', safe.ok === true, safe.error);
    const stillBlocked = await J('campaign', { ...tc, actionId: 'bribe', constituency: 51 });
    check('and the restriction outlives the round it started in',
      stillBlocked.ok === false && /restriction/i.test(stillBlocked.error || ''),
      stillBlocked.error);
  }
}
check('a campaign restriction can be imposed', restrictedSeen,
  'outcomes seen: ' + JSON.stringify(seenOutcomes));
console.log('     findings sampled: ' + JSON.stringify(seenOutcomes));

/* ------------------------------------------------------- election */

section('Election day');
const ge = await startGame(4);
const nonHost = await J('declare', ge.creds[1]);
check('only the host can close the polls', nonHost.ok === false, nonHost.error);

const declared = await J('declare', ge.creds[0]);
check('the host can declare', declared.ok === true, declared.error);
const result = declared.game.result;
check('a result is produced', !!result);
check('every seat is decided', Object.keys(result.perSeat).length === 117);
check('seats add up to 117',
  result.standings.reduce((t, s) => t + s.seats, 0) === 117,
  String(result.standings.reduce((t, s) => t + s.seats, 0)));
check('the majority is 59', result.majority === 59);
check('the outcome is a majority or a hung assembly',
  ['majority', 'hung'].includes(result.outcome), result.outcome);
console.log('     ' + result.standings.map((s) => s.party.toUpperCase() + ' ' + s.seats).join('  ') +
  '   -> ' + result.outcome);
check('the phase moved on',
  ['government', 'hung'].includes(declared.game.phase), declared.game.phase);

/* ------------------------------------------------------- coalition */

section('Coalition negotiation');
// Measure how often an election ends hung, and keep one that does so the
// talks can be exercised end to end.
let hung = null;
let hungCount = 0;
const SAMPLE = 25;
for (let i = 0; i < SAMPLE; i++) {
  const g = await startGame(4);
  const dec = await J('declare', g.creds[0]);
  if (dec.game.result.outcome === 'hung') {
    hungCount++;
    if (!hung) hung = { g, dec };
  }
}
console.log('     hung assemblies: ' + hungCount + ' of ' + SAMPLE + ' elections');

/*
 * An election nobody contested hangs, and it should.
 *
 * These games are declared the moment they start, so no seat has had a rupee
 * spent in it and all 117 fall to the polling-day roll — four campaigns
 * splitting a board none of them worked for. Nobody reaching 59 out of that is
 * the correct result, and it is the reason leaving seats uncontested is a
 * gamble rather than a free saving.
 */
check('an election nobody contested hangs', hungCount === SAMPLE,
  hungCount + ' of ' + SAMPLE);
check('a hung assembly was captured for the talks', !!hung);

/*
 * And a seat somebody campaigns in stops being uncontested.
 *
 * This is the other half of the same claim, and the mechanism the whole
 * change rests on: influence is created by spending, a seat with influence in
 * it has a leader, and a seat with one campaign in it is led by that campaign.
 * A round's allowance buys five rallies, so five is what is checked.
 */
const pushed = await startGame(2);
const pushCreds = pushed.creds[0];
let contested = 0;
for (let seat = 1; seat <= 8; seat++) {
  const res = await J('campaign', { ...pushCreds, actionId: 'invest', constituency: seat });
  if (res.ok) contested++;
}
const pushView = (await G('state', pushCreds)).game;
const pushMe = pushView.players.find((x) => x.isYou);
console.log('     one campaign, ' + contested + ' rallies affordable of 8 attempted');

check('a round buys what a round can pay for', contested >= 4 && contested < 8,
  contested + ' of 8');
// Read off the board rather than off `leaders`, which is the settled map from
// the last round end and is deliberately empty until a round has ended.
const touched = Object.entries(pushView.board)
  .filter(([, seat]) => Object.values(seat || {}).some((v) => Number(v) > 0));
check('a seat campaigned in stops being uncontested', touched.length === contested,
  touched.length + ' seats have influence, for ' + contested + ' rallies');
check('and the campaign that paid for it leads it',
  touched.every(([, seat]) => Object.keys(seat)[0] === pushMe.partyId),
  JSON.stringify(touched.slice(0, 2)));
check('every other seat is still empty',
  Object.keys(pushView.board).length - touched.length === 117 - contested);
check('so it now holds seats it did not start with', pushMe.seatsLed === contested,
  pushMe.seatsLed + ' vs ' + contested);

if (hung) {
  const { g, dec } = hung;
  check('coalition options are offered', (dec.game.possibleCoalitions || []).length > 0,
    String((dec.game.possibleCoalitions || []).length));
  const pair = dec.game.possibleCoalitions[0];
  check('a listed pairing reaches the majority', pair.combined >= 59, String(pair.combined));

  const proposerCreds = g.creds.find((cr) => cr.playerId === pair.a.playerId);
  const partnerCreds = g.creds.find((cr) => cr.playerId === pair.b.playerId);

  const badTerms = await J('coalition', {
    ...proposerCreds, move: 'propose', partnerId: pair.b.playerId,
    chiefMinisterId: pair.a.playerId, cabinet: 'nonsense', policy: 'jobs', resources: 'equal',
  });
  check('invalid terms are refused', badTerms.ok === false, badTerms.error);

  const proposal = await J('coalition', {
    ...proposerCreds, move: 'propose', partnerId: pair.b.playerId,
    chiefMinisterId: pair.a.playerId, cabinet: 'leader', policy: 'jobs', resources: 'equal',
  });
  check('an offer can be made', proposal.ok === true, proposal.error);
  check('the offer is visible to both', !!proposal.game.coalition.proposal);
  check('the combined total is recorded',
    proposal.game.coalition.proposal.combined >= 59,
    String(proposal.game.coalition.proposal.combined));

  const outsider = g.creds.find(
    (cr) => cr.playerId !== pair.a.playerId && cr.playerId !== pair.b.playerId
  );
  if (outsider) {
    const meddle = await J('coalition', { ...outsider, move: 'accept' });
    check('an outsider cannot accept it', meddle.ok === false, meddle.error);
  }

  const rejected = await J('coalition', { ...partnerCreds, move: 'reject', note: 'Not enough cabinet' });
  check('the partner can walk away', rejected.ok === true, rejected.error);
  check('the talks are recorded as failed', rejected.game.coalition.status === 'failed');
  check('the table is cleared for another try', !rejected.game.coalition.proposal);

  const second = await J('coalition', {
    ...proposerCreds, move: 'propose', partnerId: pair.b.playerId,
    chiefMinisterId: pair.b.playerId, cabinet: 'generous', policy: 'farm', resources: 'partnerFirst',
  });
  check('another offer can follow a failure', second.ok === true, second.error);

  const accepted = await J('coalition', { ...partnerCreds, move: 'accept' });
  check('the partner can accept', accepted.ok === true, accepted.error);
  const co = accepted.game.coalition;
  check('a coalition government is formed', co.status === 'formed');
  check('it has two members', co.members.length === 2);
  check('the combined seats reach the majority', co.combined >= 59, String(co.combined));
  check('a Chief Minister is agreed', co.chiefMinisterId === pair.b.playerId);
  check('a Deputy is agreed', co.deputyId === pair.a.playerId);
  check('cabinet, policy and resource terms are kept',
    !!co.cabinet && !!co.policy && !!co.resources);
  check('the phase becomes government', accepted.game.phase === 'government');
  console.log('     coalition: ' + co.combined + ' seats, CM is the partner');
}

/* ------------------------------------------------------- persistence */

section('Persistence');
const files = fs.readdirSync(DATA).filter((f) => f.startsWith('game-'));
check('games are on disk', files.length > 0);
const raw = JSON.parse(fs.readFileSync(path.join(DATA, files[files.length - 1]), 'utf8'));
check('the saved game keeps player records', Object.values(raw.players)[0].record !== undefined);
check('the saved game keeps coalition state', raw.coalition !== undefined);
// Nothing about a real election is stored, which is checked here rather than
// on screen because a screen can be made to hide what a file still holds.
check('nothing about a real election is stored',
  raw.incumbency === undefined && !/\bmla\b/i.test(JSON.stringify(raw)));
check('and every party on disk is one somebody founded',
  Object.values(raw.players).every((pl) => pl.party && pl.party.name),
  JSON.stringify(Object.values(raw.players).map((pl) => pl.party && pl.party.name)));

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
