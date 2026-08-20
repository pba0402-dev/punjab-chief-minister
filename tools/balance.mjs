/**
 * Balance harness.
 * ------------------------------------------------------------------
 * Plays whole campaigns headlessly with bots of different skill and reports
 * how often each wins. The game is balanced when skill clearly beats
 * spraying money around, and doing nothing clearly loses.
 *
 *   node tools/balance.mjs [runs]
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const FILES = [
  'src/data/issues.js',
  'src/data/parties.js',
  'src/data/strategies.js',
  'src/data/punjab-seats.js',
  'src/data/punjab-geometry.js',
  'src/data/states.js',
  'src/data/lookup.js',
  'src/engine/rng.js',
  'src/engine/model.js',
  'src/engine/actions.js',
  'src/engine/events.js',
  'src/engine/ai.js',
  'src/engine/engine.js',
];

const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const PG = sandbox.PG;

/* ------------------------------------------------------------- bots */

function competitiveTargets(game, projection) {
  const pid = game.player.partyId;
  return PG.PUNJAB_SEATS.map((def) => {
    const r = projection.bySeat[def.num].rating;
    return { num: def.num, district: def.district, gap: r.gap, leads: r.playerLeads };
  })
    // Winnable and close first: seats you narrowly lead or narrowly trail.
    .filter((s) => s.gap < 8)
    .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap));
}

const BOTS = {
  /** Does nothing at all. The floor. */
  idle: function () {},

  /** Spends the full purse, but on seats picked at random. */
  scattergun: function (game, projection, rng) {
    while (game.actionsLeft > 0) {
      const num = 1 + Math.floor(rng() * 117);
      const pick = rng() < 0.5 ? 'rally' : 'canvass';
      if (!PG.engine.play(game, pick, { seat: num }).ok) break;
    }
  },

  /** Piles everything into seats it already wins comfortably. */
  fortress: function (game, projection) {
    const pid = game.player.partyId;
    const safe = PG.PUNJAB_SEATS.map((d) => ({
      num: d.num,
      gap: projection.bySeat[d.num].rating.gap,
    }))
      .filter((s) => s.gap < -12)
      .sort((a, b) => a.gap - b.gap);
    let i = 0;
    while (game.actionsLeft > 0 && safe.length) {
      const t = safe[i++ % safe.length];
      if (!PG.engine.play(game, 'rally', { seat: t.num }).ok) break;
    }
  },

  /** Plays the game the way it is meant to be played. */
  strategist: function (game, projection) {
    const pid = game.player.partyId;
    const party = PG.PARTY_BY_ID[pid];
    const targets = competitiveTargets(game, projection);

    // Which district holds the most winnable seats right now?
    const byDistrict = {};
    targets.forEach((t) => {
      byDistrict[t.district] = (byDistrict[t.district] || 0) + 1;
    });
    const hotDistricts = Object.keys(byDistrict).sort((a, b) => byDistrict[b] - byDistrict[a]);

    // Early: build the machine and blanket the biggest battlegrounds.
    if (game.turn <= 3 && hotDistricts.length) {
      PG.engine.play(game, 'volunteers', { district: hotDistricts[0] });
      PG.engine.play(game, 'advertising', { district: hotDistricts[0] });
    }
    // Middle: spend the rationed tours on the richest districts.
    if (game.turn >= 3 && game.turn <= 8 && hotDistricts.length) {
      PG.engine.play(game, 'leadershipTour', { district: hotDistricts[0] });
    }
    if (game.turn === 4) {
      const region = PG.PUNJAB_DISTRICTS[hotDistricts[0]].region;
      PG.engine.play(game, 'alliance', { region: region });
    }

    // Then grind the marginals, closest first, never over-watering one seat.
    let i = 0;
    while (game.actionsLeft > 0 && targets.length && i < targets.length * 3) {
      const t = targets[i++ % targets.length];
      const seat = game.seats[t.num];
      const spent = seat.spend[pid] || 0;
      if (spent > 16) continue;

      const localCred = party.credibility[seat.localIssue] || 0.5;
      let played;
      if (localCred >= 0.8 && spent < 8) {
        played = PG.engine.play(game, 'promise', { seat: t.num, issue: seat.localIssue });
      } else if (spent > 11) {
        played = PG.engine.play(game, 'candidateWork', { seat: t.num });
      } else {
        played = PG.engine.play(game, 'rally', { seat: t.num });
      }
      if (!played.ok) {
        played = PG.engine.play(game, 'canvass', { seat: t.num });
        if (!played.ok) break;
      }
    }
  },
};

/* ------------------------------------------------------------- runner */

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function playOne(botName, seed, partyId, difficulty) {
  const game = PG.engine.newGame({
    stateId: 'punjab',
    partyId: partyId,
    candidateName: 'Bot',
    strategyId: 'grassroots',
    difficulty: difficulty,
    seed: seed,
  });
  const rng = mulberry(PG.rng.hashString(seed + botName));
  const turns = PG.getState('punjab').campaign.turns;
  for (let t = 0; t < turns; t++) {
    const projection = PG.model.projectAll(game, { fog: true });
    BOTS[botName](game, projection, rng);
    PG.engine.endTurn(game);
  }
  const result = PG.engine.runElection(game);
  return {
    seats: result.playerSeats,
    won: result.outcome === 'majority',
    government: result.governmentFormed,
    spent: game.budget.spent,
    budget: game.budget.total,
  };
}

const RUNS = Number(process.argv[2] || 60);
const PARTIES = PG.PLAYABLE_PARTIES.map((p) => p.id);
const seeds = Array.from({ length: RUNS }, (_, i) => 'balance-' + i);

function summarise(rows) {
  const seats = rows.map((r) => r.seats).sort((a, b) => a - b);
  const mean = seats.reduce((a, b) => a + b, 0) / seats.length;
  return {
    mean: mean,
    median: seats[Math.floor(seats.length / 2)],
    min: seats[0],
    max: seats[seats.length - 1],
    majorities: rows.filter((r) => r.won).length,
    governments: rows.filter((r) => r.government).length,
    spend: rows.reduce((t, r) => t + r.spent / r.budget, 0) / rows.length,
    n: rows.length,
  };
}

function pad(s, n) {
  s = String(s);
  return s + ' '.repeat(Math.max(0, n - s.length));
}
function padL(s, n) {
  s = String(s);
  return ' '.repeat(Math.max(0, n - s.length)) + s;
}

for (const difficulty of ['easy', 'normal', 'hard']) {
  console.log('\n=== ' + difficulty.toUpperCase() + ' — ' + RUNS + ' campaigns per bot ===');
  console.log(
    pad('bot', 13) + padL('mean', 7) + padL('median', 8) + padL('range', 10) +
      padL('majority', 10) + padL('any govt', 10) + padL('purse used', 12)
  );
  for (const bot of Object.keys(BOTS)) {
    const rows = [];
    seeds.forEach((seed, i) => {
      rows.push(playOne(bot, seed, PARTIES[i % PARTIES.length], difficulty));
    });
    const s = summarise(rows);
    console.log(
      pad(bot, 13) +
        padL(s.mean.toFixed(1), 7) +
        padL(s.median, 8) +
        padL(s.min + '-' + s.max, 10) +
        padL(Math.round((s.majorities / s.n) * 100) + '%', 10) +
        padL(Math.round((s.governments / s.n) * 100) + '%', 10) +
        padL(Math.round(s.spend * 100) + '%', 12)
    );
  }
}

/* Per-party check on normal, so no party is a trap. */
console.log('\n=== PARTY SPREAD (strategist, normal) ===');
console.log(pad('party', 30) + padL('mean seats', 12) + padL('majority', 10));
for (const pid of PARTIES) {
  const rows = seeds.map((seed) => playOne('strategist', seed, pid, 'normal'));
  const s = summarise(rows);
  console.log(
    pad(PG.PARTY_BY_ID[pid].name, 30) +
      padL(s.mean.toFixed(1), 12) +
      padL(Math.round((s.majorities / s.n) * 100) + '%', 10)
  );
}
