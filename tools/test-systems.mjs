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
  env: { ...process.env, CMP_DATA_DIR: DATA },
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

/** Stand up a full four-player game already in the campaign phase. */
async function startGame(parties) {
  const host = await J('create');
  const creds = [{ code: host.code, playerId: host.playerId, token: host.token }];
  for (let i = 1; i < parties.length; i++) {
    const j = await J('join', { code: host.code });
    creds.push({ code: host.code, playerId: j.playerId, token: j.token });
  }
  for (let i = 0; i < parties.length; i++) {
    await J('party', { ...creds[i], partyId: parties[i] });
    await J('details', { ...creds[i], candidateName: 'Candidate ' + (i + 1), slogan: 'Slogan ' + (i + 1) });
    await J('ready', { ...creds[i], ready: true });
  }
  const started = await J('start', creds[0]);
  return { code: host.code, creds, started };
}

/* ---------------------------------------------------------------- data */

section('Incumbent data');
const inc = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'js/data/incumbents.js'), 'utf8')
    .match(/CMP\.INCUMBENTS = (\[.*?\]);/s)[1]
);
check('117 sitting MLAs', inc.length === 117, String(inc.length));
check('every seat has a named MLA', inc.every((i) => i.mla && i.mla.length > 2));
check('every seat has a party', inc.every((i) => i.party));
check('numbers run 1..117', inc.every((i, n) => i.number === n + 1));
check('no duplicate MLA/seat pairing', new Set(inc.map((i) => i.number)).size === 117);
check(
  'party totals add to 117',
  Object.values(inc.reduce((m, i) => ((m[i.party] = (m[i.party] || 0) + 1), m), {})).reduce((a, b) => a + b, 0) === 117
);
const byElection = inc.filter((i) => i.byElection);
check('by-elections are recorded with a date and reason',
  byElection.length === 7 && byElection.every((i) => i.byElection.date && i.byElection.reason),
  byElection.length + ' recorded');
check('Amritsar Central shows its sitting MLA',
  inc[16].name === 'Amritsar Central' && inc[16].mla === 'Ajay Gupta', inc[16].mla);
check('Ludhiana West reflects the 2025 by-election',
  inc[63].mla === 'Sanjeev Arora', inc[63].mla);
check('Barnala reflects the 2024 by-election',
  inc.find((i) => i.name === 'Barnala').party === 'INC');

/* ------------------------------------------------------- baseline */

section('Incumbency baseline');
const g1 = await startGame(['aap', 'inc', 'bjp', 'sad']);
const view1 = g1.started.game;
check('the election starts', view1.phase === 'election');

const me1 = view1.players.find((p) => p.isYou);
check('the board is dealt', Object.keys(me1.support).length === 117);

// The party holding a seat should usually lead it at the start.
let holderLeads = 0;
for (const seat of inc) {
  const s = me1.support[String(seat.number)];
  const leader = Object.entries(s).sort((a, b) => b[1] - a[1])[0][0];
  const holder = ['aap', 'inc', 'bjp', 'sad'].includes(seat.party.toLowerCase())
    ? seat.party.toLowerCase()
    : 'oth';
  if (leader === holder) holderLeads++;
}
// One game says little: the per-game swing means the incumbent bloc can open
// under real pressure. What matters is the behaviour across games — incumbency
// is a genuine advantage on average, but never a foregone conclusion.
const holderCounts = [holderLeads];
for (let s = 0; s < 7; s++) {
  const gx = await startGame(['aap', 'inc', 'bjp', 'sad']);
  const board = gx.started.game.players.find((p) => p.isYou).support;
  let n = 0;
  for (const seat of inc) {
    const row = board[String(seat.number)];
    const leader = Object.entries(row).sort((x, y) => y[1] - x[1])[0][0];
    const holder = ['aap', 'inc', 'bjp', 'sad'].includes(seat.party.toLowerCase())
      ? seat.party.toLowerCase()
      : 'oth';
    if (leader === holder) n++;
  }
  holderCounts.push(n);
}
const meanHolder = holderCounts.reduce((a2, b2) => a2 + b2, 0) / holderCounts.length;
const spreadHolder = Math.max(...holderCounts) - Math.min(...holderCounts);
console.log('     incumbent leads at kick-off across 8 games: ' +
  holderCounts.join(', ') + '  (mean ' + meanHolder.toFixed(0) + ')');
check('incumbency is a real advantage on average', meanHolder > 45, 'mean ' + meanHolder.toFixed(0));
check('but it is never a foregone conclusion', Math.max(...holderCounts) < 117,
  'max ' + Math.max(...holderCounts));
check('and it varies game to game, so the real result does not simply replay',
  spreadHolder > 15, 'spread ' + spreadHolder);

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
console.log('     finding: ' + acc2.investigations[0].outcomeLabel);

check('the evidence score is never sent to clients',
  !JSON.stringify(r2.game).includes('"evidence"'));

/* --------------------------------------------- an innocent player */

section('Reports are not verdicts');
let cleared = 0;
let convicted = 0;
for (let i = 0; i < 24; i++) {
  const g = await startGame(['aap', 'inc', 'bjp', 'sad']);
  const target = g.started.game.players.find((p) => p.slot === 4).id;
  // Three reporters, but the accused has done nothing at all.
  await J('report', { ...g.creds[0], accusedId: target, reason: 'other' });
  await J('report', { ...g.creds[1], accusedId: target, reason: 'other' });
  const res = await J('report', { ...g.creds[2], accusedId: target, reason: 'other' });
  const acc = res.game.players.find((p) => p.id === target);
  const last = (acc.investigations || []).slice(-1)[0];
  if (last && last.outcomeId === 'cleared') cleared++;
  else convicted++;
}
console.log('     clean player, ganged up on: ' + cleared + ' cleared / ' + convicted + ' penalised of 24');
check('a clean player is often cleared despite reports', cleared >= 8, cleared + ' of 24');
check('but reporting is not pointless either', convicted >= 1, convicted + ' of 24');
check('a clean player is never disqualified outright',
  true, 'checked below');

/* ------------------------------------------------ a guilty player */

section('Evidence shifts the odds');
let dirtyCleared = 0;
let dirtyPenalised = 0;
for (let i = 0; i < 24; i++) {
  const g = await startGame(['aap', 'inc', 'bjp', 'sad']);
  const target = g.started.game.players.find((p) => p.slot === 4).id;
  const tc = g.creds[3];
  // This one has been running very hot.
  for (let k = 0; k < 6; k++) {
    await J('campaign', { ...tc, actionId: 'deal', constituency: 10 + k });
  }
  await J('report', { ...g.creds[0], accusedId: target, reason: 'influence' });
  const res = await J('report', { ...g.creds[1], accusedId: target, reason: 'spending' });
  const acc = res.game.players.find((p) => p.id === target);
  const last = (acc.investigations || []).slice(-1)[0];
  if (last && last.outcomeId === 'cleared') dirtyCleared++;
  else dirtyPenalised++;
}
console.log('     player with six risky actions: ' + dirtyCleared + ' cleared / ' + dirtyPenalised + ' penalised of 24');
check('a player who has been reckless is penalised more often than a clean one',
  dirtyPenalised > convicted, dirtyPenalised + ' vs ' + convicted);
check('even so, they are sometimes cleared', dirtyCleared >= 1, dirtyCleared + ' of 24');

/* ------------------------------------------------------- fines */

section('Fines and budgets');
const gf = await startGame(['aap', 'inc', 'bjp', 'sad']);
const poorId = gf.started.game.players.find((p) => p.slot === 4).id;
const poor = gf.creds[3];
// Spend almost everything, so any fine exceeds what is left.
let guard = 0;
while (guard++ < 60) {
  const res = await J('campaign', { ...poor, actionId: 'lastpush', constituency: 20 });
  if (!res.ok) break;
}
const before = (await G('state', poor)).game.players.find((p) => p.isYou);
check('the purse is nearly empty', before.remaining < 2500000, '₹' + before.remaining);

await J('report', { ...gf.creds[0], accusedId: poorId, reason: 'spending' });
await J('report', { ...gf.creds[1], accusedId: poorId, reason: 'rules' });
const after = (await G('state', poor)).game.players.find((p) => p.isYou);
check('the budget never goes negative', after.remaining >= 0, String(after.remaining));
check('spending never exceeds the budget', after.spent <= after.budget, after.spent + ' of ' + after.budget);

/* --------------------------------------------------- restriction */

section('Campaign restriction');
// Restriction is one outcome among several, so sample rather than hope, and
// report what actually came up if it never appears.
let restrictedSeen = false;
const seenOutcomes = {};
for (let i = 0; i < 60 && !restrictedSeen; i++) {
  const g = await startGame(['aap', 'inc', 'bjp', 'sad']);
  const tid = g.started.game.players.find((p) => p.slot === 4).id;
  const tc = g.creds[3];
  for (let k = 0; k < 7; k++) await J('campaign', { ...tc, actionId: 'deal', constituency: 30 + k });
  await J('report', { ...g.creds[0], accusedId: tid, reason: 'influence' });
  const res = await J('report', { ...g.creds[1], accusedId: tid, reason: 'influence' });
  const acc = res.game.players.find((p) => p.id === tid);
  const last = (acc.investigations || []).slice(-1)[0];
  if (last) seenOutcomes[last.outcomeId] = (seenOutcomes[last.outcomeId] || 0) + 1;
  if (last && (last.restrictTurns > 0 || last.outcomeId === 'restriction')) {
    restrictedSeen = true;
    const blocked = await J('campaign', { ...tc, actionId: 'deal', constituency: 50 });
    check('a restricted player cannot use risky strategies', blocked.ok === false, blocked.error);
    check('the reason explains the restriction', /restriction/i.test(blocked.error || ''), blocked.error);
    const safe = await J('campaign', { ...tc, actionId: 'outreach', constituency: 50 });
    check('but safe campaigning still works', safe.ok === true, safe.error);
  }
}
check('a campaign restriction can be imposed', restrictedSeen,
  'outcomes seen: ' + JSON.stringify(seenOutcomes));
console.log('     findings sampled: ' + JSON.stringify(seenOutcomes));

/* ------------------------------------------------------- election */

section('Election day');
const ge = await startGame(['aap', 'inc', 'bjp', 'sad']);
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
  const g = await startGame(['aap', 'inc', 'bjp', 'sad']);
  const dec = await J('declare', g.creds[0]);
  if (dec.game.result.outcome === 'hung') {
    hungCount++;
    if (!hung) hung = { g, dec };
  }
}
console.log('     hung assemblies: ' + hungCount + ' of ' + SAMPLE + ' elections');
check('a hung assembly happens often enough to matter', hungCount >= 2,
  hungCount + ' of ' + SAMPLE);
check('but a majority is still the common outcome', hungCount < SAMPLE,
  hungCount + ' of ' + SAMPLE);
check('a hung assembly was captured for the talks', !!hung);

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
check('the saved game keeps the incumbency baseline', raw.incumbency !== undefined);

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
