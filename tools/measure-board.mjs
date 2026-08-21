/**
 * Opening-board balance.
 * ------------------------------------------------------------------
 * Two things have to hold at once, and they pull against each other:
 *
 *   - incumbency must be a real advantage, or the verified MLA data is
 *     decoration and the "player vs incumbent" idea means nothing;
 *   - the real result must not simply replay, or the game is decided before
 *     anyone campaigns and hung assemblies never happen.
 *
 * This reports both so the config can be tuned against evidence rather than
 * guesswork.
 *
 *   node tools/measure-board.mjs [games]
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', 'simple');
const GAMES = Number(process.argv[2] || 60);

const sandbox = { console, Date, Math, JSON };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of [
  'js/data/parties.js',
  'js/data/constituencies.js',
  'js/data/incumbents.js',
  'js/data/actions.js',
  'js/engine/rng.js',
  'js/engine/campaign.js',
  'js/engine/ai.js',
  'js/state.js',
]) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), sandbox, { filename: f });
}
const CMP = sandbox.CMP;

const holderOf = (seat) =>
  ['aap', 'inc', 'bjp', 'sad'].includes(seat.party.toLowerCase()) ? seat.party.toLowerCase() : 'oth';

const holderCounts = [];
const leaderCounts = [];
let majorities = 0;
const winners = {};

for (let i = 0; i < GAMES; i++) {
  const g = CMP.state.startElection({
    partyId: 'aap',
    candidateName: 'X',
    slogan: 'Y',
    seed: 'board-' + i,
  });

  let holders = 0;
  const counts = {};
  for (const seat of CMP.INCUMBENTS) {
    const row = g.support[seat.number];
    const leader = Object.entries(row).sort((a, b) => b[1] - a[1])[0][0];
    counts[leader] = (counts[leader] || 0) + 1;
    if (leader === holderOf(seat)) holders++;
  }
  holderCounts.push(holders);

  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  leaderCounts.push(top[1]);
  if (top[1] >= CMP.MAJORITY) majorities++;
  winners[top[0]] = (winners[top[0]] || 0) + 1;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const cfg = CMP.CAMPAIGN.incumbency;

console.log('config:  advantages ' + cfg.levels.map((l) => l.advantage).join('/') +
  '   swing ±' + (cfg.partySwingSpread / 2) + '   seat spread ±' + (cfg.spread / 2));
console.log('');
console.log('incumbent holds their own seat:  mean ' + mean(holderCounts).toFixed(0) +
  ' / 117   range ' + Math.min(...holderCounts) + '-' + Math.max(...holderCounts));
console.log('largest bloc at kick-off:        mean ' + mean(leaderCounts).toFixed(0) +
  ' / 117   range ' + Math.min(...leaderCounts) + '-' + Math.max(...leaderCounts));
console.log('games already past 59:           ' + majorities + ' / ' + GAMES +
  '  (' + Math.round((majorities / GAMES) * 100) + '%)');
console.log('who leads:                       ' +
  Object.entries(winners).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join('  '));
console.log('');
console.log('want: incumbent mean 60-85, a wide range, and 40-70% already past 59');
