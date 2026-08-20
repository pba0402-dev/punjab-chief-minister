# Punjab Chief Minister

A browser-based election strategy game. You run a statewide campaign across all
**117 Punjab Legislative Assembly constituencies** over ten weeks with a fixed
purse, and try to win the **59 seats** needed to form a government and become
Chief Minister.

Inspired by the seat-counting loop of *270*, but built around Indian assembly
constituencies rather than the US Electoral College.

> **This is a fictional strategy game.** The constituency names, numbers,
> districts and SC reservations are real reference data. Every party, candidate,
> poll number and vote share in the game is invented. It is not a prediction,
> a model of any real election, or a campaign tool.

---

## Running it

No build step and no dependencies are needed to play:

```
open index.html          # or just double-click it
```

To produce the single-file build (used for sharing):

```
node tools/build.mjs     # -> dist/punjab-cm.html
```

Development tooling (needs `npm install` for jsdom):

```
npm test                 # build + 110 headless checks through the real UI
npm run balance          # play whole campaigns with bots, report win rates
npm run audit            # render at 7 viewport widths, flag layout overflow
npm run data             # regenerate constituency + map geometry data
```

---

## How the game works

**Setup** — pick one of four fictional parties, name your candidate, choose an
opening strategy and a difficulty.

**Ten weeks** — each week you get 5 campaign actions and draw on one purse.
Rivals campaign too, events fire, and your intelligence briefing tells you what
moved.

**Election day** — all 117 seats are simulated at once, then the result is
declared.

### The central tension

You cannot campaign everywhere. Roughly 50 actions across 117 seats means the
only question that matters is *where does a rupee buy the most seats*. Campaign
points feed a diminishing-returns curve, so saturating one constituency is
always wrong; and a seat you already win by 20 points is worth nothing extra.

Actions are deliberately unequal:

| Action | Scope | Cost | Character |
| --- | --- | --- | --- |
| Door-to-Door Canvass | seat | ₹2 cr | small, permanent, best value per rupee |
| Public Rally | seat | ₹6 cr | big burst that decays, spills into neighbours |
| Media & Print Blitz | district | ₹9 cr | covers a whole district, favours urban seats |
| Strengthen Local Candidate | seat | ₹5 cr | permanent, immune to decay and to rivals |
| Volunteer Mobilisation | district | ₹4 cr | compounds — later work there lands harder |
| Development Promise | seat | ₹7 cr | huge if it matches the seat's real concern, near-worthless if not |
| Leadership Tour | district | ₹14 cr | strongest action in the game, only 2 uses |
| Alliance & Outreach | region | ₹18 cr | permanent regional swing, with a backlash elsewhere |

### What the player is allowed to know

Polling is fogged, and the fog shrinks as the campaign progresses (±6 points in
week 1, ±1.6 in the final stretch). Seats are shown as **Safe / Likely / Lean /
Toss-up**, and your presence in a seat as a qualitative band rather than a
number. Enough to decide with; not enough to solve.

---

## Architecture

The four layers never reach into each other. Election maths lives nowhere near
the DOM.

```
src/
  data/         reference data + configuration (no logic)
    punjab-seats.js      GENERATED - the 117 constituencies
    punjab-geometry.js   GENERATED - map polygons, hex tiles, district borders
    states.js            state registry: seats, majority rule, budgets, tuning
    parties.js           fictional parties: colours, leans, credibility, traits
    issues.js            voter issues and how salient they are by settlement
    strategies.js        opening strategies
    lookup.js            cached indexes over the above

  engine/       rules and simulation - pure, no DOM, no storage
    rng.js               seeded PRNG; nothing else may call Math.random
    model.js             landscape generation, vote shares, ratings, election day
    actions.js           the campaign action catalogue (the balance sheet)
    events.js            the event deck
    ai.js                rival campaigns
    engine.js            game state, turn loop, briefings, result

  persistence/
    storage.js           save/load behind an adapter interface

  ui/           rendering only - reads state, calls the engine
    map.js, hud.js, panel.js, setup.js, results.js, app.js, dom.js, styles.css
```

### Adding another state later

`src/data/states.js` is a registry. A new state needs an entry there plus its
own seats and geometry files — the engine and UI read `totalSeats`,
`majority()`, `campaign`, `currency` and `tuning` from the state definition and
never assume Punjab. Nothing outside `parties.js` knows a party by name.

Not built yet, but the seams are in place for: other states, Lok Sabha and a
Prime Minister mode, real historical data, accounts and leaderboards.

---

## Data provenance

**Real reference data** (`src/data/punjab-seats.js`, generated by
`tools/build-data.mjs` from `tools/acs.json`):

- All 117 constituency numbers, names and districts, cross-checked between the
  Wikipedia list of Punjab Legislative Assembly constituencies and the
  district-wise listing on punjabdata.com, with individual constituencies
  verified where the two disagreed (Sri Hargobindpur, Baba Bakala, Phagwara,
  Garhshankar, Balachaur, Amargarh).
- 23 districts, including Malerkotla, which was carved out of Sangrur in 2021.
- 34 SC-reserved seats — matching the official count.
- The three cultural regions: Majha 25, Doaba 23, Malwa 69 seats.

**Editorial classification:** each seat is tagged `urban` / `semi-urban` /
`rural`. This is a game-design judgement used to shape simulated voter
profiles, not official data.

**Map geometry** (`tools/build-geometry.mjs`): the state outline is the real
OpenStreetMap boundary of Punjab. Constituency shapes are **not** official
boundaries — they are Voronoi cells built around the geocoded centre of each
constituency's town (Nominatim, with hand-checked corrections for city-ward
seats such as Amritsar North/South and the Ludhiana wards) and clipped to the
state outline. They are geographically faithful in position and adjacency, and
approximate in shape. The hex cartogram is derived from the same positions.

**Everything political is invented**: party support, candidate quality,
incumbency, issue salience, events and results are all generated at runtime
from the game seed.

---

## Testing

`npm test` drives the real built game in jsdom — clicking the map, spending
money, ending turns, running the election, saving and reloading — and fails on
any console error. 110 checks, covering the invariants that matter: 117 seats
present, majority is 59, seat totals stay at 117 every single week, vote shares
sum to 100 in every constituency, and the same seed with the same moves gives
the same result.

`npm run balance` plays full campaigns with four bots. Current figures on
*Competitive* difficulty, 80 campaigns each:

| Bot | mean seats | majority |
| --- | --- | --- |
| does nothing | 17 | 0% |
| spends at random | 32 | 0% |
| piles into safe seats | 32 | 0% |
| targets marginals | 54 | 31% |

Skill is worth about 22 seats over spending the same money badly, which is the
point of the game.
