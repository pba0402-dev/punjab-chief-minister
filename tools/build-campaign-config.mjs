/**
 * Generates simple/js/data/actions.js from simple/api/campaign-config.json.
 *
 * The JSON is the single source of truth: PHP reads it directly, and this
 * turns it into a plain script the browser can load with no fetch — which
 * matters because solo play has to work straight off the filesystem.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'simple', 'api', 'campaign-config.json');
const OUT = path.join(HERE, '..', 'simple', 'js', 'data', 'actions.js');

const raw = fs.readFileSync(SRC, 'utf8');
const config = JSON.parse(raw);

/* Sanity checks, so a bad edit fails here rather than mid-game. */
const problems = [];
if (!config.startingBudget || config.startingBudget <= 0) problems.push('startingBudget missing');
if (!Array.isArray(config.actions) || !config.actions.length) problems.push('no actions');

const ids = new Set();
for (const a of config.actions || []) {
  if (ids.has(a.id)) problems.push('duplicate action id: ' + a.id);
  ids.add(a.id);
  if (!a.cost || a.cost <= 0) problems.push(a.id + ': cost must be positive');
  if (!Array.isArray(a.outcomes) || !a.outcomes.length) problems.push(a.id + ': no outcomes');
  const total = (a.outcomes || []).reduce((t, o) => t + (o.weight || 0), 0);
  if (total <= 0) problems.push(a.id + ': outcome weights total zero');
  if (['safe', 'risky'].indexOf(a.group) === -1) problems.push(a.id + ': group must be safe or risky');
}
for (const c of config.consequences || []) {
  if (!c.weight || c.weight <= 0) problems.push('consequence ' + c.id + ': weight must be positive');
}

/* The round clock and the money system. */
const r = config.rounds || {};
if (!(r.total > 0)) problems.push('rounds.total must be positive');
if (!(r.seconds > 0)) problems.push('rounds.seconds must be positive');
if (!(r.actionsPerRound > 0)) problems.push('rounds.actionsPerRound must be positive');
if (!(r.intermissionSeconds > 0)) problems.push('rounds.intermissionSeconds must be positive');

/* The scoreboard and the opponents. */
const sb = config.scoreboard || {};
if (!(sb.closeRaceSeats > 0)) problems.push('scoreboard.closeRaceSeats must be positive');
if (!(sb.maxSeatChangesShown > 0)) problems.push('scoreboard.maxSeatChangesShown must be positive');

const ai = config.ai || {};
if (!Array.isArray(ai.profiles) || !ai.profiles.length) problems.push('ai.profiles missing');
for (const prof of ai.profiles || []) {
  if (!(prof.riskAppetite >= 0 && prof.riskAppetite <= 1)) {
    problems.push('ai profile ' + prof.id + ': riskAppetite must be 0..1');
  }
  if (!(prof.targetSpread > 0)) problems.push('ai profile ' + prof.id + ': targetSpread must be positive');
}
if (!Array.isArray(ai.givenNames) || ai.givenNames.length < 8) problems.push('ai.givenNames too short');
if (!Array.isArray(ai.surnames) || ai.surnames.length < 4) problems.push('ai.surnames too short');
if (!Array.isArray(ai.slogans) || !ai.slogans.length) problems.push('ai.slogans missing');

const loan = (config.finance || {}).loan || {};
if (!(loan.interestRate > 0)) problems.push('finance.loan.interestRate must be positive');
if (!(loan.repayAfterRounds > 0)) problems.push('finance.loan.repayAfterRounds must be positive');
if (!(loan.debtLimit >= loan.maxAmount)) problems.push('finance.loan.debtLimit must allow one full loan');
if (loan.noBorrowingAfterRound + loan.repayAfterRounds > r.total) {
  // Otherwise the last loans a player can take would fall due after election
  // day, which quietly turns late borrowing into free money.
  problems.push('finance.loan.noBorrowingAfterRound is late enough that a loan could never fall due');
}

/* The two ways of raising money mid-campaign resolve through the same code
   path as every other action, so they have to be shaped like one. */
for (const key of ['grant', 'underground']) {
  const f = (config.funding || {})[key];
  if (!f) {
    problems.push('funding.' + key + ' missing');
    continue;
  }
  if (ids.has(f.id)) problems.push('funding.' + key + ' duplicates an action id');
  ids.add(f.id);
  if (!Array.isArray(f.outcomes) || !f.outcomes.length) problems.push(f.id + ': no outcomes');
  if ((f.outcomes || []).reduce((t, o) => t + (o.weight || 0), 0) <= 0) {
    problems.push(f.id + ': outcome weights total zero');
  }
}

for (const e of (config.events || {}).list || []) {
  if (!e.weight || e.weight <= 0) problems.push('event ' + e.id + ': weight must be positive');
  if (['good', 'bad'].indexOf(e.kind) === -1) problems.push('event ' + e.id + ': kind must be good or bad');
}

if (problems.length) {
  console.error('campaign-config.json is not valid:');
  problems.forEach((p) => console.error('  - ' + p));
  process.exit(1);
}

// Drop the comment keys from what ships to the browser.
const clean = JSON.parse(raw, (key, value) => (key.startsWith('_') ? undefined : value));

const body = `/**
 * Campaign actions, costs, outcomes, heat, consequences, rounds and money.
 * GENERATED by tools/build-campaign-config.mjs from api/campaign-config.json.
 * Do not edit here — edit the JSON, which PHP reads for multiplayer, and
 * re-run: npm run data:campaign
 *
 * Everything tunable about the campaign system lives in that one file: costs,
 * support effects, risk levels, heat, outcome probabilities, consequences,
 * round length, loan terms and event chances. Nothing in the UI hard-codes any
 * of these numbers.
 */
window.CMP = window.CMP || {};

CMP.CAMPAIGN = ${JSON.stringify(clean, null, 2)};

CMP.STARTING_BUDGET = CMP.CAMPAIGN.startingBudget;
CMP.ROUNDS = CMP.CAMPAIGN.rounds;
CMP.SCOREBOARD = CMP.CAMPAIGN.scoreboard;
CMP.FINANCE = CMP.CAMPAIGN.finance;
CMP.EVENTS = CMP.CAMPAIGN.events;

/**
 * Campaign strategies and the two ways of raising money, in one list. Grants
 * and undisclosed funding are shaped like any other action — a cost and a
 * weighted outcome table — so the engine resolves all three the same way and
 * the interface needs no special case for them.
 */
CMP.ACTIONS = CMP.CAMPAIGN.actions.concat(
  ['grant', 'underground'].map(function (id) {
    var entry = JSON.parse(JSON.stringify(CMP.CAMPAIGN.funding[id]));
    entry.group = 'funding';
    return entry;
  })
);

CMP.getAction = function (id) {
  for (var i = 0; i < CMP.ACTIONS.length; i++) {
    if (CMP.ACTIONS[i].id === id) return CMP.ACTIONS[i];
  }
  return null;
};

CMP.actionsByGroup = function (group) {
  return CMP.ACTIONS.filter(function (a) {
    return a.group === group;
  });
};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);

const safe = config.actions.filter((a) => a.group === 'safe').length;
const risky = config.actions.filter((a) => a.group === 'risky').length;
console.log('starting budget: ₹' + config.startingBudget.toLocaleString('en-IN'));
console.log('actions: ' + safe + ' safe, ' + risky + ' risky, 2 funding');
console.log('rounds: ' + r.total + ' x ' + r.seconds + 's, ' +
  r.actionsPerRound + ' moves each (' + r.total * r.actionsPerRound + ' a campaign)');
console.log(
  'loans: ' + Math.round(loan.interestRate * 100) + '% due after ' +
  loan.repayAfterRounds + ' rounds, none after round ' + loan.noBorrowingAfterRound
);
console.log('opponents: ' + ai.profiles.map((p) => p.id).join(', ') +
  ', ' + ai.givenNames.length * ai.surnames.length + ' possible names');
console.log('intermission: ' + r.intermissionSeconds + 's between rounds');
console.log('events: ' + (config.events.list || []).length +
  ' at ' + Math.round(config.events.chancePerRound * 100) + '% a round');
console.log('consequences: ' + config.consequences.length);
console.log('written: ' + path.relative(path.join(HERE, '..'), OUT));
