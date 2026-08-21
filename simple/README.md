# Chief Minister of Punjab

Choose a party, name your candidate, and fight a fifteen-round campaign across
all 117 Punjab assembly constituencies. Each round lasts sixty seconds and
gives you three moves. Spend your grant, borrow against it if you dare, and try
to be leading 59 seats when the polls close. Solo or with up to three friends.

> A fictional strategy game. Constituency names, numbers and districts are real
> public information. Everything else is invented. It is not a prediction of any
> real election.

## Running it

No build step, no dependencies:

```
open simple/index.html      # or double-click it
```

From the repository root:

```
npm run serve               # php -S on http://127.0.0.1:8080 (multiplayer needs PHP)
npm run test:all            # all six suites below
npm run test:campaign       # engine parity, rounds, loans, funding, balance
npm run test:v1             # solo flow, rounds, borrowing and the count
npm run test:api            # the multiplayer API
npm run test:systems        # incumbents, elections, coalitions, investigations
npm run test:mp             # four browsers in one lobby, start to result
npm run test:rounds         # four browsers through all fifteen rounds
npm run measure:board       # opening-board balance across 60 games
node tools/balance-money.mjs 40   # does money decide the game?
npm run shots:v1            # render at 1400 / 768 / 390 / 360 px
npm run shots:lobby         # render the multiplayer screens
npm run data:v1             # regenerate the constituency data file
npm run data:campaign       # regenerate actions.js from campaign-config.json
npm run data:incumbents     # regenerate the sitting-MLA data
npm run data:map            # regenerate the map geometry
```

Solo mode works by opening `simple/index.html` directly. Multiplayer needs the
page served by PHP, since the lobby talks to `api/index.php`.

## The campaign: fifteen rounds of sixty seconds

A campaign is **15 rounds**, each **60 seconds**, and each round gives every
player **3 moves**. Forty-five moves a campaign, for everybody.

That cap is the most important balance decision in the game. Without it, a
round rewards whoever clicks fastest, and a large purse converts straight into
support at the speed of the mouse. With it, the question stops being *how much
can I spend* and becomes *which three seats are worth it this minute*.

### The clock belongs to the server

In multiplayer the deadline is a server timestamp. Every response carries the
server's own time, and clients work out the seconds remaining from those two
rather than trusting their own clock — so a machine set wrongly still plays the
same round as everybody else, and a refresh mid-round rejoins at the right
second.

Rounds turn over lazily: whichever request arrives first after the clock runs
out processes the round end, under the same lock as every other change. Clients
poll every 2.5s, so a round ends within a second or two of expiry, and nothing
depends on a cron job the host may not have. If everyone closed their laptop,
the round ends the moment one of them comes back.

### What happens when a round ends

In this order, because the steps feed each other:

1. Loans falling due are repaid — or defaulted on.
2. At most one random event per player, most rounds none.
3. Events move the shared board.
4. Leaders and projected seats are recounted from the settled board.
5. Political heat cools slightly.
6. A snapshot of all 117 seats is added to the history.
7. The game is saved.
8. The next round opens — or, after round 15, the polls close and the count
   begins.

Each player then sees a summary of what the round did to them: money spent,
money raised, cash in hand, debt outstanding, support change, seats gained or
lost, heat change, and any events. It sits **in** the page rather than over it —
the next round is already running by the time it appears, and a modal that had
to be dismissed would spend a player's seconds for them.

## One board, four players

Everyone campaigns on the **same** board and sees the same constituency
leaders and the same projected seats. What stays private is money, political
heat, the loan book and the action log — a rival's secret spending is never
shipped to another client.

`npm run test:rounds` proves it: four independent browser windows play all
fifteen rounds against a real server, and after every single round the test
checks that all four agree on the round number, the board and the seat counts.
They finish on identical results.

## Money: cash and debt are different numbers

Every player is **granted ₹5,00,00,000**. It is never typed in, and in
multiplayer the server grants it, so a client cannot set its own purse.

Cash is what can be spent and **never goes below zero**. Debt is tracked
separately and stays separate all the way to the screen: a player carrying two
crore of borrowing is not two crore richer, they have moved a problem two
rounds down the road.

### The bank

| | |
| --- | --- |
| Interest | 20% |
| Repayment falls | 2 rounds later |
| One loan | ₹10 lakh to ₹1 crore |
| Total debt limit | ₹2 crore |
| No borrowing after | round 12 |

Borrowing late is refused because the bill would land after election day, which
would quietly make late borrowing free money. Loans can be stacked up to the
debt limit, and the terms are quoted and confirmed before anything is signed.

**Defaulting** — being unable to cover a repayment — costs more than the money:
heat, lost support, a three-round campaign restriction, and no bank will lend to
you again. Without that, the best play would be to borrow the maximum every
round and never repay.

### Raising money mid-campaign

Two routes, with opposite characters. Both are fictional game mechanics and
neither describes any real-world method.

- **Apply for a Grant** — ₹20 lakh of visible development work and a funding
  application. No heat. Usually returns less than it cost on its own; worth
  doing because the development also moves support.
- **Underground Funding** — free to accept, can pay several times over, and is
  the fastest way to raise heat in the game. It can also simply never arrive.

## Where the money goes, and why the dear ones reach further

| Safe campaign | Cost | Reach | | Risky strategies | Cost | Reach |
| --- | --- | --- | --- | --- | --- | --- |
| Village Outreach | ₹10 lakh | 1 seat | | Negative Campaign | ₹30 lakh | 3 seats |
| Public Rally | ₹15 lakh | 1 seat | | Secret Influence | ₹40 lakh | 4 seats |
| Community Development | ₹20 lakh | 3 seats | | Underground Deal | ₹60 lakh | 5 seats |
| Media Campaign | ₹25 lakh | 4 seats | | Last-Minute Push | ₹70 lakh | 6 seats |

Every seat is normalised to 100 across five parties, so a large gain in one seat
is compressed on the way in: +4 raw lands as roughly +3, while +2 raw lands as
roughly +1.9. Raw support therefore has sharply diminishing returns, and at
three moves a round an action costing two and a half times as much bought barely
a tenth more effect — money was very nearly irrelevant, which is as wrong as
money deciding everything.

So the dearer actions **reach further** instead of hitting harder. A doorstep
campaign moves one constituency; media coverage is seen in several. The extra
seats take a fraction of the effect, and bad outcomes spread the same way — a
media campaign that goes wrong goes wrong in public.

### Does money decide the game?

The brief says it must not. `node tools/balance-money.mjs` plays whole campaigns
for four approaches that vary one thing at a time and reports how they finish.
Over 60 games:

| strategy | | mean seats | games won |
| --- | --- | --- | --- |
| careful | cheap moves, aimed at the closest races | 68.6 | 36/60 |
| bigspender | borrows and spends, same aim | 68.3 | 23/60 |
| gambler | borrows and spends on risky strategies | 61.3 | 1/60 |
| scattergun | spends like careful, picks seats at random | 63.5 | 0/60 |

Money edge (bigspender − careful): **−0.3 seats**. Aim edge (careful −
scattergun): **+5.1 seats**. Spending more buys reach and costs interest, and
comes out roughly a wash; choosing the right seat is worth five seats a
campaign. No approach takes more than 60% of games. `npm run test:campaign`
fails the build if that stops being true.

## Real MLA data

Every constituency carries its sitting member: name, party, and the by-election
that put them there where one applies. Generated by
`tools/build-incumbents.mjs` from `tools/incumbents.json`, joined onto the
verified 117 seats **by name** — the widely-mirrored MLA lists number seats
102-108 differently from the official ECI numbering used elsewhere here, and a
wrong pairing would put a real person on the wrong seat. The build fails rather
than emit a partial join.

Current as of **August 2026**: the 2022 membership plus seven by-elections
(Jalandhar West, Dera Baba Nanak, Chabbewal, Gidderbaha, Barnala, Ludhiana West,
Tarn Taran). That gives AAP 94, INC 16, SAD 3, BJP 2, and one each for BSP and
an independent — 117.

> The sitting members are **real people**. They are the incumbents this
> fictional campaign is fought against, and they take no part in it. The players
> are invented candidates; every support figure, campaign action, investigation
> and result in this game is fiction, and none of it is a prediction of any real
> election.

The constituency screen keeps the halves apart: real MLA above, fictional game
race below, with a LEADING indicator and a projected winner that move as players
campaign.

### The baseline, and why it does not replay the real result

The party holding a seat starts ahead in it, by an amount rolled per seat. On its
own that would hand the game to the largest incumbent bloc before anyone
campaigned, so each game also rolls **one swing per party** across every seat.

Measured over 60 games (`npm run measure:board`): incumbents hold their own seat
in **74 of 117 on average**, range 22 to 110. Incumbency is a real advantage —
chance alone would give 23 — but the map differs every game, and the incumbent
party leads the board in roughly two games in three rather than all of them.

## The map

All 117 seats, coloured by whoever leads them in the game, fading as the lead
narrows so a toss-up does not read as decided. Click a seat to target it; the
map repaints after every campaign action. Hovering names the seat, its leader,
its rating and its real sitting MLA. The legend's party counts always total 117.

Two views:

- **Map** — cells over the real OpenStreetMap outline of Punjab, positioned
  from the geocoded centre of each constituency's town.
- **Tiles** — one equal hex per seat, so a marginal in an Amritsar ward is as
  easy to hit as a huge rural seat.

> **On boundaries.** These are **not** official constituency boundaries, and
> none has been invented to look like one. Positions and adjacency are real —
> every seat sits where it is, beside the seats it really borders — and each
> cell shape is an approximation of the area it covers. The map says so on
> screen, and the tiles view makes no geographic claim at all.

`tools/build-map-data.mjs` re-checks the join against the constituency list and
fails rather than ship a mismatch: a wrong shape would put a seat in the wrong
place.

## Election day and government formation

The polls close on their own when round 15 ends; the host can also close them
early, with a confirmation, since that ends the campaign for everybody. All 117
seats are then decided from the shared board with a little noise added, so a
narrow lead on the last evening is never a certainty.

The count is **progressive**: seats are declared in order with running totals
building underneath, and the verdict is withheld until it finishes — showing it
above a count in progress would give the ending away. There is a control to
skip to the end.

- **59 or more** — majority government, and that candidate becomes Chief
  Minister of Punjab.
- **Nobody reaches 59** — hung assembly, and coalition talks open.

### Coalitions

Coalitions take two human partners. Pairings that would reach 59 are listed; one
player proposes terms — Chief Minister, Deputy, cabinet split, a policy priority,
and how campaign resources are shared next time — and the other accepts or walks
away. A rejection clears the table so another pairing can be tried. About **a
quarter of elections end hung**, so this is a live part of the game rather than a
corner case.

## Reports and investigations

A fictional oversight mechanic layered on Political Heat.

Any player may report a rival **once**, choosing from five fictional reasons. A
second report from a *different* player opens an investigation; a third makes it
high priority. Repeat reports from the same player are refused, so the count
cannot be inflated by one person.

The finding is rolled against a hidden **evidence score** built from risky
actions taken, current heat, previous penalties, the number of reports and a
random factor. Players never see it — only the public report count and the
accused player's heat.

That matters, because **reports are not verdicts**. Sampled over 60 findings
each, counting a warning apart from the outcomes that actually cost a campaign
something:

| | cleared | warning | fine, restriction or worse |
| --- | --- | --- | --- |
| a clean player, ganged up on | 38 | 15 | **7** |
| a player who took six risky actions | 11 | 15 | **34** |

Ganging up on someone who has done nothing usually fails, and almost never does
real damage — 12% of the time against 57% for a genuinely reckless player. But
neither is certain, and a clean player is never disqualified outright. Findings run from
CLEARED through WARNING, FINE, MAJOR FINE and CAMPAIGN RESTRICTION to
DISQUALIFICATION, which needs high evidence *and* three reports and is rare.

Fines come out of **actual cash in hand**, not an abstract allowance — borrowed
money is cash like any other, so a campaign running on credit can still be
fined. Cash **can never go negative**: if a fine cannot be paid, what is there
is taken and the rest becomes a campaign restriction and lost support instead.

## Risk and Political Heat

Safe actions vary a little. Risky ones roll on a weighted table that can pay
big, do nothing, or backfire outright — **the odds are never shown to the
player**, only a cost, a risk word and an impact word. Anything that spends
money is confirmed first, stating the cost and what it leaves behind: the round
is sixty seconds long, and a mis-click should not be the reason a campaign runs
out of cash.

**Political Heat** runs 0–100 (Low / Moderate / High / Critical). Safe play
barely moves it; risky play sends it up fast. Heat does not punish on a
schedule — it raises the *odds* of trouble after each action, and below the
configured floor nothing fires at all. At high heat you can draw rumours, media
scrutiny, a controversy, an opponent attack, a public backlash or an
investigation, each taking support off you in the seats you have been working
hardest.

Heat also **cools slightly between rounds**. Without that it only ever climbs,
so a single risky round would mark a player for the rest of the campaign and the
whole risk system becomes a one-way door rather than a dial.

The balance test plays whole campaigns both ways: living on risky strategies
finishes around 61 seats with heat pinned near 100, against 69 for careful play.
Risk is a real option, not a free win.

### Everything is configurable

`api/campaign-config.json` is the single balance sheet: costs, support effects,
reach, risk labels, heat, outcome weights, consequences, round length, the moves
allowed per round, loan terms and event chances. PHP reads it directly;
`npm run data:campaign` regenerates `js/data/actions.js` from it for the
browser. Nothing in the UI hard-codes a number.

The rules exist twice — `js/engine/campaign.js` for solo, `api/lib/Campaign.php`
for multiplayer, because a client cannot be trusted to roll its own dice.
`npm run test:campaign` proves the two agree: same seeded random sequence, same
outcome for the same roll, same cost and heat.

## Multiplayer

Two to four players, one party each, over a shared server — not localStorage,
because four people are on four devices.

- **Create Game** issues a five-character code (`P7K4Q`) drawn from `random_int`
  over an alphabet with no look-alike characters. It is never derived from a
  database id, and a mistyped code is rejected rather than quietly corrected
  onto someone else's game.
- **Join Game** takes that code, case-insensitively, into the same lobby.
- **One party per player.** Once AAP is taken it is disabled for everyone else,
  and the server refuses it even if a stale client tries anyway. Unclaimed
  parties are left free for the AI opponents a later version will add.
- **Ready system.** You cannot ready up without a party, candidate, slogan and
  budget; the host cannot start until every *connected* player is ready.
- **Disconnects.** A quiet player shows as Disconnected but keeps their slot,
  party and details. If the host drops, the role passes to the longest-present
  connected player automatically.
- **Reconnect.** Credentials live in localStorage, so closing the tab and coming
  back rejoins the same seat rather than taking a new one.

### Why polling, not WebSockets

The game runs on shared hosting, which cannot hold a socket open. Clients poll
`?action=state` every 2.5s, and that poll doubles as the heartbeat keeping a
player marked connected. Unglamorous, and it works everywhere.

### The API

`api/index.php` is one front controller. Routes are chosen with `?action=`, so
no rewrite rules are needed on any host.

| Action | Does |
| --- | --- |
| `create` | new game, you are the host |
| `join` | take a free slot with a code |
| `state` | the lobby, and a heartbeat |
| `party` | claim or release a party |
| `details` | candidate, slogan, budget |
| `ready` | ready up or stand down |
| `start` | host only — deals the board and opens round 1 |
| `campaign` | play one move; the server rolls the outcome |
| `loan` | quote a loan, or take one |
| `history` | how one seat's race has moved, round by round |
| `report` | report a rival to the oversight system |
| `declare` | host only — close the polls early |
| `coalition` | propose, accept or reject terms |
| `leave` | free your slot |
| `health` | php version, game count, writability |

Every authenticated request settles any rounds whose time has run out before it
does anything else, so a client that has been asleep cannot act in a round that
finished five minutes ago.

Auth is a `playerId` + `token` pair issued once at create/join, compared with
`hash_equals` and never included in any response.

Storage sits behind the `Store` interface in `api/lib/Store.php`, which
currently ships `FileStore`: one JSON file per game under `api/data/` (web-denied,
created at runtime), with writes serialised by `flock`. Moving to MySQL means
writing one more class with the same five methods and changing the single line
in `index.php` that constructs the store.

## The screens

- **Home** — title, seat count, and the two ways to play: `PLAY SOLO` and
  `PLAY WITH FRIENDS`. Anything already in progress appears as a quiet resume
  line underneath
- **Setup** — pick AAP, INC, BJP or SAD, then candidate name, slogan and budget
  (formatted in Indian grouping as you type: `₹10,00,00,000`)
- **Election** — the campaign panel, under a sticky round clock showing the
  round, the seconds left and the moves remaining. Cash, spent, debt and seats
  led; projected seats with how many more are needed for a majority; Political
  Heat; a target constituency; and five tabs — Campaign, Money, Map,
  Constituency and Rivals
- **Money** — where the campaign's money came from and what is owed, the bank,
  and the two ways of raising more
- **Constituency** — the real sitting MLA above, and below it the candidates
  standing, their support, the projected winner and a chart of how the race has
  moved every round since the campaign opened
- **Autosave** — solo progress writes to `localStorage` after every round and
  every move, and needs no server; multiplayer state lives on the server, saved
  under lock on every change

Not built yet, on purpose: AI opponents for the parties no human is playing.

## Files

```
simple/
  index.html
  css/styles.css           base, campaign.css, systems.css, rounds.css, map.css
  js/
    data/parties.js          the four parties — the only place a party is defined
    data/constituencies.js   GENERATED: the 117 seats
    data/actions.js          GENERATED: costs, outcomes, heat, consequences
    data/incumbents.js       GENERATED: the 117 sitting MLAs
    data/geometry.js         GENERATED: map shapes and hex tiles
    engine/rng.js            seeded randomness
    engine/campaign.js       campaign rules for solo play: moves, money, rounds
    state.js                 the game object, validation, starting a campaign
    storage.js               localStorage save/load behind a tiny adapter
    ui/dom.js                element helper + Indian currency formatting
    net.js                   multiplayer API client + polling
    ui/home.js               home screen (solo / multiplayer)
    ui/setup.js              solo party + candidate form
    ui/multiplayer.js        create game / join game
    ui/lobby.js              the four-player lobby
    ui/round.js              round clock, projection, the bank and the dialogs
    ui/map.js                the 117-seat map and tile view
    ui/constituency.js       one seat: real MLA above, game race below
    ui/oversight.js          rivals, reporting and your own record
    ui/result.js             result, hung assembly and coalition talks
    ui/election.js           campaign panel
    app.js                   screen routing, autosave, boot
  api/
    index.php                front controller and routes
    lib/Store.php            storage interface + FileStore
    lib/Code.php             game code generation
    lib/Lobby.php            lobby rules, pure functions
    lib/Campaign.php         the same campaign rules, server-authoritative
    lib/Rounds.php           the round clock and the round-end pipeline
    lib/Election.php         election day and the verdict
    lib/Coalition.php        coalition proposals and terms
    lib/Investigation.php    reports, evidence, findings and penalties
    campaign-config.json     THE balance sheet — both sides read this
```

UI, game state, party data, constituency data and save/load are separate
files. Nothing outside `parties.js` names a party, so adding a fifth is one
entry in that array.

## Constituency data

Generated by `tools/build-simple-data.mjs` from a list verified against the
Wikipedia list of Punjab Legislative Assembly constituencies and the
district-wise listing on punjabdata.com, with the six that disagreed checked
individually (Sri Hargobindpur, Baba Bakala, Phagwara, Garhshankar, Balachaur,
Amargarh). 117 seats, 23 districts, 34 SC-reserved — matching the official
count.

Each record carries `number`, `name`, `district` and `reserved`. Everything that
changes during a campaign — support, leaders, results — lives on the shared
board rather than on the constituency record, keyed by constituency number.
