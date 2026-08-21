/**
 * Are the AI opponents a real contest?
 * ------------------------------------------------------------------
 * A scoreboard with four names on it is worth nothing if three of them are
 * scenery. This plays whole fifteen-round games of one human against three
 * opponents and reports how they finish — seats, heat, money, and how often
 * each actually wins.
 *
 * The human plays a reasonable game: three safe moves a round, aimed at the
 * closest races. That is roughly what an attentive player does, so if the
 * opponents cannot get near it they need work, and if they beat it every time
 * they are not opponents but obstacles.
 *
 * The human's party rotates between games. AAP holds 94 seats in the real
 * membership, so a human always playing AAP would be measuring the incumbency
 * baseline rather than the opponents.
 *
 *   node tools/balance-ai.mjs [games]
 */
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES = Number(process.argv[2] || 24);

const MODE = process.argv[3] || 'naive';
const runs = JSON.parse(
  execFileSync('php', [path.join(HERE, 'php-ai-probe.php'), String(GAMES), MODE], {
    maxBuffer: 1024 * 1024 * 32,
  }).toString()
);

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const money = (n) => '₹' + (n / 10000000).toFixed(2) + 'cr';

const human = { seats: [], heat: [], spent: [], wins: 0, majorities: 0 };
const ai = { seats: [], heat: [], spent: [], wins: 0, majorities: 0, defaults: 0 };
const byProfile = {};

for (const run of runs) {
  for (const row of run.standings) {
    const side = row.isHuman ? human : ai;
    side.seats.push(row.seats);
    side.heat.push(row.heat);
    side.spent.push(row.spent);
    if (row.seats >= run.majority) side.majorities++;
    if (!row.isHuman) {
      ai.defaults += row.defaults;
      const p = (byProfile[row.profile] = byProfile[row.profile] || { seats: [], heat: [], wins: 0 });
      p.seats.push(row.seats);
      p.heat.push(row.heat);
    }
  }
  const best = run.standings.slice().sort((a, b) => b.seats - a.seats)[0];
  if (best.isHuman) human.wins++;
  else {
    ai.wins++;
    byProfile[best.profile].wins++;
  }
}

console.log('One human against three opponents, ' + GAMES + ' full campaigns.');
console.log('Human baseline: ' + MODE + (MODE === 'steady'
  ? " (the opponents' own decision code)"
  : ' (safe moves only, never borrows)'));
console.log('The human plays a different party each game.\n');

console.log('side       seats (mean)   range      won     majorities   heat   spent');
console.log('-'.repeat(72));
for (const [label, s] of [['human', human], ['opponents', ai]]) {
  console.log(
    label.padEnd(11) +
      mean(s.seats).toFixed(1).padStart(8) +
      '   ' +
      (Math.min(...s.seats) + '-' + Math.max(...s.seats)).padStart(9) +
      '   ' +
      (s.wins + '/' + GAMES).padStart(6) +
      '   ' +
      (s.majorities + '/' + (label === 'human' ? GAMES : GAMES * 3)).padStart(9) +
      '   ' +
      mean(s.heat).toFixed(0).padStart(4) +
      '   ' +
      money(mean(s.spent))
  );
}

/*
 * Per party, because the parties are not interchangeable. AAP holds 94 seats
 * in the real membership and BJP two, so a pooled human-versus-AI average
 * mostly measures which party each side happened to be handed. Comparing the
 * same party played by a human against the same party played by an opponent
 * is the only comparison that isolates the decision-making.
 */
const perParty = {};
for (const run of runs) {
  for (const row of run.standings) {
    const pp = (perParty[row.party] = perParty[row.party] || { human: [], ai: [] });
    (row.isHuman ? pp.human : pp.ai).push(row.seats);
  }
}

console.log('');
console.log('same party, human versus opponent');
console.log('-'.repeat(72));
const edges = [];
for (const [party, pp] of Object.entries(perParty)) {
  const h = mean(pp.human);
  const a = mean(pp.ai);
  edges.push(a - h);
  console.log(
    '  ' + party.toUpperCase().padEnd(6) +
      ('human ' + h.toFixed(1) + ' (' + pp.human.length + ')').padEnd(20) +
      ('opponent ' + a.toFixed(1) + ' (' + pp.ai.length + ')').padEnd(22) +
      'edge ' + (a - h >= 0 ? '+' : '') + (a - h).toFixed(1)
  );
}
console.log('  mean edge to the opponents: ' +
  (mean(edges) >= 0 ? '+' : '') + mean(edges).toFixed(1) + ' seats');

console.log('\nby temperament');
console.log('-'.repeat(72));
for (const [id, p] of Object.entries(byProfile).sort((a, b) => mean(b[1].seats) - mean(a[1].seats))) {
  console.log(
    '  ' + id.padEnd(13) +
      mean(p.seats).toFixed(1).padStart(6) + ' seats   ' +
      ('heat ' + mean(p.heat).toFixed(0)).padStart(9) + '   ' +
      p.wins + ' wins   (' + p.seats.length + ' appearances)'
  );
}

const hung = runs.filter((r) => r.outcome === 'hung').length;
const allAdd = runs.every(
  (r) => r.standings.reduce((t, s) => t + s.seats, 0) + r.otherSeats === 117
);

console.log('');
console.log('games won by an opponent   ' + ai.wins + ' / ' + GAMES +
  '  (' + Math.round((ai.wins / GAMES) * 100) + '%)');
console.log('opponent defaults          ' + ai.defaults + ' across ' + GAMES * 3 + ' campaigns');
console.log('hung assemblies            ' + hung + ' / ' + GAMES);
console.log('seat totals always 117     ' + allAdd);
console.log('');
console.log('want: the human ahead on average but beaten often, opponents off the heat');
console.log('      ceiling, and the three temperaments finishing differently.');
