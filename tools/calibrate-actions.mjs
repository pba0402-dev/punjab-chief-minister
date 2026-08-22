/**
 * Flatten what a rupee buys, whichever move it is spent on.
 * ------------------------------------------------------------------
 * Reach was introduced when a campaign had five crore for the whole election
 * and three moves a round: raw support has sharply diminishing returns once a
 * seat is normalised to 100, so spending more bought almost nothing and money
 * was irrelevant. Letting dearer moves touch more seats fixed that.
 *
 * The twenty-round economy removes both of those conditions — twenty times the
 * money, no move cap — and reach became the opposite problem. A wide move
 * returned four to six times the support per crore of a narrow one, so "always
 * buy the dearest thing you can afford" won 21 games in 24. That is precisely
 * the failure the brief has forbidden from the beginning: money deciding it.
 *
 * This measures what each move actually returns per crore and scales its
 * outcomes until they all sit near the same line. Reach stays — a media
 * campaign is still seen in several seats, which is true and reads well — but
 * it buys breadth rather than value. Choosing the right seat goes back to
 * mattering more than the size of the cheque.
 *
 *   node tools/calibrate-actions.mjs           report only
 *   node tools/calibrate-actions.mjs --write   rewrite campaign-config.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const APP = path.join(ROOT, 'simple');
const CONFIG = path.join(APP, 'api', 'campaign-config.json');
const CR = 10000000;
const WRITE = process.argv.includes('--write');
const SAMPLES = 3000;

/** The move everything else is measured against. */
const BASELINE = 'rally';

function loadEngine() {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  for (const f of [
    'js/data/parties.js', 'js/data/assets.js', 'js/data/asset-map.js',
    'js/data/avatars.js', 'js/data/constituencies.js',
    'js/data/regions.js', 'js/data/actions.js', 'js/engine/rng.js',
    'js/engine/campaign.js', 'js/engine/ai.js', 'js/state.js',
  ]) {
    win.eval(fs.readFileSync(path.join(APP, f), 'utf8'));
  }
  return win;
}

/**
 * What a crore actually buys, in seats.
 *
 * The board starts empty, so the thing a move buys is influence in a seat —
 * and what influence is worth is the chance that seat is still yours when the
 * undecided part of it is rolled on polling day. Measuring the support delta
 * would say nothing now: the first move in an untouched seat always reads as
 * a hundred per cent of very little.
 *
 * So this spends a fixed sum on one action, over and over, the way a campaign
 * running that one plan would — a fresh seat each time until the board is
 * covered, then round again — and asks how many seats it ends up expected to
 * win. Reach is included, because a move that is seen in three seats really
 * does contest three seats.
 */
function efficiencyOf(win, actionId) {
  const CMP = win.CMP;
  const E = CMP.campaign;
  const action = CMP.getAction(actionId);
  const rand = CMP.rng.create('calibrate:' + actionId);
  const k = CMP.CAMPAIGN.election.undecidedWeight || 0;

  const BUDGET = 60 * CR;
  let seats = 0;
  let runs = 0;

  for (let i = 0; i < Math.max(6, Math.round(SAMPLES / 40)); i++) {
    const g = CMP.state.startElection({
      candidateName: 'Bot',
      partyName: 'Calibration Party',
      seed: 'cal' + i,
    });
    g.cash = BUDGET;
    const me = g.partyId;

    let seat = 1;
    for (let move = 0; move < 400 && g.cash >= action.cost; move++) {
      const target = action.needsConstituency === false ? null : seat;
      const res = E.play(g, actionId, target, {
        outcome: rand(), consequence: 1, consequencePick: 0.5,
      });
      if (!res || !res.ok) break;
      seat = (seat % 117) + 1;
    }

    /*
     * Expected seats, not seats led.
     *
     * A seat this campaign leads with almost nothing in it is a coin toss on
     * the day, and counting it as a seat would be the very mistake this whole
     * measurement exists to avoid.
     */
    let expected = 0;
    Object.keys(g.support).forEach((key) => {
      const cell = g.support[key];
      let total = 0;
      Object.keys(cell).forEach((id) => {
        total += Math.max(0, cell[id] || 0);
      });
      const undecided = k > 0 ? k / (k + total) : 0;
      const share = E.shareOf(cell, me) / 100;
      // The decided part is yours in proportion to your share of it; the
      // undecided part is a draw between however many parties are standing.
      expected += (1 - undecided) * share + undecided / (CMP.PARTIES.length || 4);
    });

    seats += expected;
    runs++;
  }

  const mean = seats / Math.max(1, runs);
  return { mean: mean, perCrore: mean / (BUDGET / CR) };
}

/* ------------------------------------------------------------- measure */

let win = loadEngine();
const CMP = win.CMP;

const SUBJECTS = CMP.actionsByGroup('safe')
  .concat(CMP.actionsByGroup('risky'))
  .map((a) => a.id);

console.log('before:');
const before = {};
for (const id of SUBJECTS) {
  before[id] = efficiencyOf(win, id);
  const a = CMP.getAction(id);
  console.log(
    '  ' + a.label.padEnd(23) +
    (a.cost / CR).toFixed(2).padStart(6) + ' Cr' +
    before[id].mean.toFixed(3).padStart(9) + ' seats' +
    before[id].perCrore.toFixed(3).padStart(9) + ' per Cr'
  );
}

const target = before[BASELINE].perCrore;
console.log('\ntarget: ' + target.toFixed(3) + ' seats a crore (' + BASELINE + ')');

/*
 * Risky moves are deliberately worse than campaigning — the upside is real,
 * the downside is worse, and the heat lands either way. They are calibrated to
 * a discount on the safe line rather than to it.
 */
const RISK_DISCOUNT = 0.75;

const factors = {};
for (const id of SUBJECTS) {
  const a = CMP.getAction(id);
  const wanted = target * (a.group === 'risky' ? RISK_DISCOUNT : 1);
  const got = before[id].perCrore;

  // A move whose mean effect is negative by design (a negative campaign works
  // on the opponent, not on you) is left alone: scaling it toward a positive
  // line would invert what it does.
  factors[id] = got > 0.02 ? wanted / got : 1;
}

console.log('\nscaling outcomes by:');
for (const id of SUBJECTS) {
  console.log('  ' + CMP.getAction(id).label.padEnd(23) + factors[id].toFixed(3));
}

if (!WRITE) {
  console.log('\n(report only — pass --write to apply)');
  win.close();
  process.exit(0);
}

/* --------------------------------------------------------------- write */

const raw = fs.readFileSync(CONFIG, 'utf8');
const config = JSON.parse(raw);

function applyTo(action) {
  const f = factors[action.id];
  if (!f || Math.abs(f - 1) < 0.02) return;
  for (const o of action.outcomes || []) {
    if (o.support) o.support = Math.round(o.support * f * 100) / 100;
    if (o.opponentSupport) o.opponentSupport = Math.round(o.opponentSupport * f * 100) / 100;
  }
}

for (const a of config.actions) applyTo(a);
for (const a of config.bribe.actions) applyTo(a);

fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n');
console.log('\nwritten: ' + path.relative(ROOT, CONFIG));
console.log('now run: npm run data:campaign, then re-measure');
win.close();
