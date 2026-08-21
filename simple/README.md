# Chief Minister of Punjab

Choose a party, name your candidate, and fight a fifteen-round campaign across
all 117 Punjab assembly constituencies. Each round lasts sixty seconds and
gives you three moves; when the clock runs out the seats are recounted and an
election-night scoreboard shows where everyone stands. Spend your grant, borrow
against it if you dare, and try to be leading 59 seats when the polls close.

Solo or with up to three friends — any party nobody takes is played by an
opponent, so the scoreboard always has four candidates on it.

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
npm run test:all            # all seven suites below
npm run test:campaign       # engine parity, rounds, loans, funding, scoreboard
npm run test:v1             # solo flow, rounds, borrowing and the count
npm run test:api            # the multiplayer API
npm run test:systems        # incumbents, elections, coalitions, investigations
npm run test:mp             # four browsers in one lobby, start to result
npm run test:ai             # two humans, two opponents, portraits, reconnection
npm run test:rounds         # four browsers through all fifteen rounds
npm run measure:board       # opening-board balance across 60 games
npm run balance:ai          # are the opponents a real contest?
npm run shots:portraits     # render a grid of candidate portraits
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

## The game screen

Every screen answers one question, and campaigning is a drill-down rather than
a wall of controls:

| | |
| --- | --- |
| **Home** | Who is winning? |
| **Candidate** | Where am I winning, close, or losing? |
| **Constituency** | What is happening here? |
| **Campaign** | How much do I want to spend here? |

Designed for a phone — 320 to 430px — and allowed to breathe on a larger
screen rather than rebuilt for one.

### Home

A sticky round strip (round, a dot per move remaining, the clock), one compact
player row, and then the only thing home is for: **WHO'S LEADING?** — four
candidates ranked by projected seats, each with their face and their place.
One line for the majority. Then **LEADING FROM**, naming the tightest seats
under each party.

No campaign actions live here at all. Tapping a candidate is how you campaign.

### Candidate — the strategy centre

Tapping your own row opens your areas: every constituency from your party's
point of view, split by how the race stands — **Leading**, **Close**,
**Losing**, **Uncontested** — with a search box and a sort that defaults to
**closest race first**, because that is where a move changes a seat rather
than padding a lead.

Tapping a rival's row opens the same page for them, but only what an election
makes public: their seats and where they lead. Their cash reads *private*, and
there are no campaign controls. Anyone watching an election can count seats;
nobody can read a rival's bank statement.

### Constituency

Who is leading with their face and share, a bar for every party, whether it
changed hands, and — kept separate at the bottom — the real sitting MLA,
labelled as reference that takes no part in the game. One primary button:
**CAMPAIGN HERE**.

### Campaign

Two steps in a sheet over the top. Pick a move, then decide how much to put
behind it. High-risk options sit behind a deliberate second tap, so nobody
stumbles into one looking for a rally.

Afterwards, a short result — the support moving, what it cost — and then
**next closest seat** or **back to my areas**. The player is never sent out to
a dashboard and made to navigate back.

The map is the same journey by another route: tap a seat, and CAMPAIGN HERE
works identically.

Everything that is not campaigning is on a compact menu that scrolls sideways
on a phone: **Home · My Areas · Money · Grants · Loan · High Risk · Map**.
Closing the polls and the election history are in the header menu, since
neither belongs to a round.

## How much to spend

An action's cost is the **middle of a range**, not a price. What you put behind
a move scales what it achieves, and that is the most interesting decision in a
round.

The curve is a **square root**, and that choice carries the whole balance of
the feature: four times the money buys twice the effect. For a fixed budget the
efficient play is therefore to spread money evenly across every move you have,
never to dump it into a few — which is exactly what stops a rich campaign
buying the election in three expensive gestures. Heat scales with the money
too: putting four times as much behind a risky move is four times as visible.

Measured over 40 campaigns (`node tools/balance-money.mjs 40`):

| | mean seats |
| --- | --- |
| spreads its budget evenly | 53.7 |
| dumps the maximum into every move | 50.1 |

**Spreading beats dumping by 3.6 seats.** Money edge over the old fixed-price
play: **+0.1 seats**. Aim still matters most, at **+3.6 seats**.
`npm run test:campaign` fails the build if the curve stops behaving.

The server clamps the amount to what the action allows, so a client cannot
spend outside the range by asking nicely.

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

A round has two stages. While it is **playing**, the clock runs and moves are
accepted. When it expires the round settles into **results**: play is locked,
the scoreboard is built once on the server, and everyone reads the same figures
for a few seconds before the next round opens. The break is deliberate —
reading what just happened should not compete with the next round for the same
seconds.

### What happens when a round ends

In this order, because the steps feed each other:

1. The opponents campaign, so their spending lands in the same round as
   everybody else's.
2. Loans falling due are repaid — or defaulted on.
3. At most one random event per player, most rounds none.
4. Events move the shared board.
5. Political heat cools slightly.
6. Leaders and projected seats are recounted from the settled board.
7. The new leader map is compared against the old one to find the seats that
   changed hands.
8. A snapshot of all 117 seats is added to the history.
9. The scoreboard is built and the game saved.
10. Play stays locked for the results break, then the next round opens — or,
    after round 15, the polls close and the count begins.

Each player also sees a summary of what the round did to *them*: money spent,
money raised, cash in hand, debt outstanding, support change, seats gained or
lost, heat change, and any events. It sits in the page rather than over it, so
it can be read alongside the scoreboard rather than dismissed to reach it.

## The scoreboard

Every round ends on an election-night screen: four candidates ranked by
projected seats, each with their face, their party and what the round did to
them, over a bar with the majority marked on it.

Under the leaderboard, two blocks and no more:

- **Seats changed** — only the constituencies that changed hands, named, with
  who held them and who holds them now. Early rounds can settle forty seats at
  once and a list of all 117 every round is a wall nobody reads; the
  differences are the news. A long list is capped and the remainder counted,
  never silently dropped.
- **Current leader** — their seats against the majority and how many more they
  need.

Plus a **new leader** or **close race** banner when either is true. Movements
per party were dropped because every row already carries its own change, and
the whole round-by-round table lives in the header menu rather than on a screen
that is up for nine seconds.

Every figure on that screen is worked out **once, on the server**, and shipped
whole. Nothing on the client counts anything. Four people watching the same
round see the same numbers, because they are literally the same numbers — a
scoreboard where two players disagree about the score is worse than no
scoreboard at all. `npm run test:rounds` checks exactly this after every one of
the fifteen rounds, across four browser windows.

## Opponents

Any party nobody claims is played by an opponent, so the scoreboard always has
four competitors and a solo game is still an election rather than a walkover.

They play by exactly the same rules: the same actions, the same costs, the same
weighted outcome tables, the same heat, the same consequences, the same three
moves a round, the same starting grant. They get no extra information and no
extra money. What separates them is temperament — **steady**, **ambitious** or
**reckless** — which sets how much risk each takes, how tightly it targets and
how readily it borrows, so three rivals in a solo game do not all play alike.

Their names are drawn per game from a pool of ordinary Punjabi given names and
surnames combined freely — 600 combinations, so a new game feels different.
They are invented candidates like the players' own, and none of the pools is
built from real officeholders.

### Are they a real contest?

`npm run balance:ai` plays whole campaigns of one human against three
opponents, rotating which party the human takes and pairing every board so the
same map is played from all four seats. Over 48 campaigns:

| | mean seats | won | heat | defaults |
| --- | --- | --- | --- | --- |
| human (safe moves, never borrows) | 32.8 | 12/48 | 5 | 0 |
| opponents | 28.0 | 36/48 | 57 | 0 |

Same party, human against opponent: the human is ahead by about **4 seats**.
One of four players winning 12 games in 48 is exactly their share, so an
attentive player is slightly better than an opponent and beaten roughly three
games in four — which is what having three rivals should feel like. The three
temperaments finish differently (ambitious 40, steady 28, reckless 23), so the
risk system means something for them too.

## Candidate portraits

Every candidate has a face on the scoreboard, so four players are told apart at
a glance rather than by reading four party codes.

The portraits are **drawn, never photographed** — small vector illustrations
built from a seed: a face shape, a skin tone, a turban or hair, a beard,
sometimes glasses, sometimes the lines of an older face. That is a deliberate
choice rather than a shortcut. A photographic portrait of a fictional candidate
would sooner or later resemble somebody real, and this game already puts real
sitting MLAs on screen as reference; a drawn face can never be mistaken for one
of them, and nothing here is derived from any real person's likeness.

The seed is assigned once, when a player sits down, and stored with the game.
The same seed always draws the same face — in round one, in round fifteen, and
after a disconnection and a rejoin. `npm run shots:portraits` renders a grid of
them to look at.

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

The final screen ends the way every round ended: the winner with their portrait
and the office they have taken, then the same leaderboard with all four
candidates' faces, then the seat-by-seat table. A hung assembly says so and
moves to coalition talks.

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
| `state` | also carries the round's scoreboard, identical for everyone |
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
- **The game screen** — see below
- **Round results** — between rounds, an election-night scoreboard
- **Autosave** — solo progress writes to `localStorage` after every round and
  every move, and needs no server; multiplayer state lives on the server, saved
  under lock on every change

- **Round results** — between rounds, an election-night scoreboard: four
  candidates with portraits ranked by projected seats, the seats that changed
  hands, the biggest movements, and how far the leader is from a majority

Everything in the brief is built. The obvious next things would be more than
four players, and refreshing the MLA data before the next state election.

## Files

```
simple/
  index.html
  css/styles.css           base; then campaign, systems, rounds, scoreboard,
                           game (the screen redesign) and map, in that order
  js/
    data/parties.js          the four parties — the only place a party is defined
    data/constituencies.js   GENERATED: the 117 seats
    data/actions.js          GENERATED: costs, outcomes, heat, consequences
    data/incumbents.js       GENERATED: the 117 sitting MLAs
    data/geometry.js         GENERATED: map shapes and hex tiles
    engine/rng.js            seeded randomness
    engine/campaign.js       campaign rules for solo play: moves, money, rounds
    engine/ai.js             opponents for solo play
    state.js                 the game object, validation, starting a campaign
    storage.js               localStorage save/load behind a tiny adapter
    ui/dom.js                element helper + Indian currency formatting
    net.js                   multiplayer API client + polling
    ui/home.js               home screen (solo / multiplayer)
    ui/setup.js              solo party + candidate form
    ui/multiplayer.js        create game / join game
    ui/lobby.js              the four-player lobby
    ui/round.js              round clock, the bank and the dialogs
    ui/portrait.js           drawn candidate portraits, from a seed
    ui/scoreboard.js         the leaderboard, seat changes and round results
    ui/seats.js              leading-from, on the home screen
    ui/areas.js              a candidate's areas: leading, close, losing
    ui/campaign-sheet.js     pick a move, pick an amount, see the result
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
    lib/Rounds.php           the round clock, round-end pipeline and scoreboard
    lib/AI.php               opponents for the parties nobody is playing
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
