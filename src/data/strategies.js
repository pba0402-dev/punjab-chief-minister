/**
 * Opening campaign strategies.
 * ------------------------------------------------------------------
 * The player commits to one before the first week. Each is a real trade-off
 * rather than a flavour choice: you are buying an advantage with money,
 * profile or flexibility.
 */
window.PG = window.PG || {};

PG.STRATEGIES = [
  {
    id: 'grassroots',
    label: 'Grassroots First',
    icon: '\u{1F331}',
    blurb: 'Booth committees before billboards.',
    detail:
      'Start with an organisation already built in your six strongest districts, so everything you do there works better. Costs you 8% of your purse.',
    apply: function (game, ctx) {
      game.budget.total = Math.round(game.budget.total * 0.92);
      var org = {};
      ctx.strongestDistricts.slice(0, 6).forEach(function (d) {
        org[d] = 0.12;
      });
      game.org[game.player.partyId] = org;
    },
  },
  {
    id: 'airwar',
    label: 'Air War',
    icon: '\u{1F4E1}',
    blurb: 'Own the airwaves from day one.',
    detail:
      'Media blitzes are 30% more effective all campaign. Powerful in the cities, thin in the villages.',
    apply: function (game) {
      game.bonus.ad = 1.3;
    },
  },
  {
    id: 'warchest',
    label: 'War Chest',
    icon: '\u{1F4B0}',
    blurb: 'Raise first, spend later.',
    detail:
      'An extra 18% in the bank, but the weeks spent fundraising leave you less visible: your personal standing starts lower.',
    apply: function (game) {
      game.budget.total = Math.round(game.budget.total * 1.18);
      game.leadership[game.player.partyId] -= 0.9;
    },
  },
  {
    id: 'starPower',
    label: 'Star Campaigner',
    icon: '\u{1F31F}',
    blurb: 'Make it about you.',
    detail:
      'Begin as a recognised face across the state, and get a third Leadership Tour to spend.',
    apply: function (game) {
      game.leadership[game.player.partyId] += 1.4;
      game.bonus.tours = 1;
    },
  },
];

PG.STRATEGY_BY_ID = PG.STRATEGIES.reduce(function (m, s) {
  m[s.id] = s;
  return m;
}, {});
