# Chief Minister of Punjab

Found a party — name it, badge it, pick its symbol and its colour — and fight a
twenty-round campaign across all 117 Punjab assembly constituencies. Every seat
starts empty: no leader, no percentage, nobody's. What a seat is worth is what
has been spent in it, and the seats are awarded when a round is settled. Spend
your allowance, borrow against it if you dare, and try to hold 59 when the polls
close.

Solo or with up to three friends — every empty chair is filled by an opponent
that founds a party of its own, so the scoreboard always has four campaigns on
it.

> A fictional strategy game.
>
> Constituency names, numbers and districts are real public information, and
> that is the whole of what is real. Every party in it is one a player or the
> game invented. Every candidate is a drawn character, never a photograph and
> never a real person. Every percentage and every seat comes from what players
> actually did in that game.
>
> There is no sitting-member data in it, no polling, and no real election result
> anywhere. It is not a prediction of anything.

## Running it

No build step, no dependencies:

```
open simple/index.html      # or double-click it
```

From the repository root:

```
npm run serve               # php -S on http://127.0.0.1:8080 (multiplayer needs PHP)
npm run test:all            # all nine suites below
npm run test:campaign       # engine parity, rounds, loans, funding, scoreboard
npm run test:v1             # solo flow, rounds, borrowing and the count
npm run test:api            # the multiplayer API
npm run test:systems        # the empty board, elections, coalitions, reports
npm run test:mp             # four browsers in one lobby, start to result
npm run test:ai             # two humans, two opponents, portraits, reconnection
npm run test:rounds         # four browsers through all twenty rounds
npm run balance:ai          # are the opponents a real contest?
npm run shots:portraits     # render a grid of candidate portraits
node tools/balance-money.mjs 40   # does money decide the game?
npm run shots:v1            # render at 1400 / 768 / 390 / 360 px
npm run shots:lobby         # render the multiplayer screens
npm run data:v1             # regenerate the constituency data file
npm run data:campaign       # regenerate actions.js from campaign-config.json
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

Nothing is a long scrolling page. Every destination is **click → open → decide
→ back**, and every screen but the one you start on carries its own way back.

Designed for a phone — 320 to 430px — and allowed to breathe on a larger
screen rather than rebuilt for one.

### Home

A sticky round strip (round, a dot per move remaining, the clock), one compact
player row, then the menu, then the only thing home is for: **WHO'S LEADING?**
— four candidates ranked by projected seats, each with their face and their
place. One line for the majority. Then **LEADING FROM**, naming the tightest
seats under each party.

A compact circular timer sits in the corner and drains as the round runs —
full circle at the start, empty at zero — with `ROUND 4 OF 20` beside it and,
in a game with other people in it, how many of them have finished.

Under that, the four figures that make the economy readable at a glance:
available, new this round, spent, and how far through the ₹100 crore the
campaign is. Region grant purses get their own line, because money that can
only be spent in Majha is not the same money as cash.

Then the menu — a two-column grid of ten, not a strip that scrolls sideways:

| | |
| --- | --- |
| **Campaign** | **Money** |
| **Grants** | **Loan** |
| **Corruption** | **Bribe** |
| **Map** | **Constituencies** |
| **My Areas** | **Alliances** |

And at the foot of the screen, under everything a player might still want to
do, **END ROUND** — reached by finishing rather than by accident.

It lives here rather than above every screen, which is what makes each
destination a place you go and come back from instead of a tab you switch to.

No campaign actions live on home at all. Tapping a candidate is how you
campaign, and so is the Campaign item — they open the same page.

### Candidate — the strategy centre

Tapping your own row opens a summary of where the campaign stands, not 117
rows:

- a ring showing **leading / close / behind** across all 117
- **statewide support** — each party's average share across every seat, which
  is a figure the game computes from its own board and not an opinion poll
- the **five strongest seats** and the **five closest races**, each row
  tappable straight through to the constituency

**View all 117** opens the full list underneath: every constituency from your
party's point of view, split by how the race stands — **Leading**, **Close**,
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

### Money

One screen for everything financial: cash in hand as the single large figure,
then spent, debt outstanding, grants received and fines paid, the heat meter,
and every movement of money this campaign as a transaction list — read back off
the action log and the loan book rather than stored a second time, so the
summary and the list can never disagree.

### Corruption and Bribe

Two separate menus, because they are two different gambles. Corruption holds
Secret Funding, Undisclosed Deal and Political Influence; Bribe holds Risky
Vote Influence, Hidden Offer and Last-Minute Gamble. Each states its cost, its
risk, what it might win and what it might cost in investigations and fines.

Every one of them is a fictional mechanic and nothing else: a cost, a weighted
table, a lot of heat, and a real chance of an investigation. None describes a
method or explains how anything would be done. They are deliberately worse
than campaigning on expectation — the upside is real, the downside is worse,
and the heat lands whichever way the roll goes.

Inside a constituency's campaign sheet the two are offered together behind one
deliberate second tap, because there what matters is simply that the move can
go wrong.

---

Closing the polls and the election history are in the header's **More** menu,
since neither belongs to a round. The history is a chart of all four parties
across every round played, plus the same figures as a table — deliberately not
on the game screen, because it is the shape of a whole campaign and a
distraction during one.

## The look, and why it is quiet

The ground is a near-black charcoal with a trace of blue. Text is off-white,
never pure white, on soft rather than hard contrast — the difference is
invisible in a screenshot and considerable at midnight.

Gold is an accent and nothing else: the action worth taking, the thing you
have selected, the majority line. It is not a card colour. Party colours
appear on borders, badges, bars and indicators, so the interface stays neutral
and the parties stay legible.

Hierarchy is carried by weight and colour rather than size, which is why the
title is 32-36px rather than 70 and a seat count reads as a number rather than
a headline.

## The active screen is a heads-up display

It does not repeat the game's own name at somebody nineteen rounds into
playing it, and it does not show a portrait of the player to the player.

In the corner, a ring that drains as the round runs with **R3** in the middle
— no numerals counting down, because a ticking 1:47 pulls the eye every second
and says nothing anybody can act on. Beside it, `Round 3 / 20`.

Then one strip: available, new this round, spent. Then the menu. Then who is
leading, as four bars. Then END ROUND.

## Analytics, and what is not collected

`simple/admin.html` answers one question: are people actually playing this.
Visits, unique visitors, games started, games completed, average length, and
the funnel from arriving to finishing — which is the only figure worth acting
on, because visits alone say almost nothing.

A visitor is a salted daily hash of address and agent, kept so that one person
refreshing five times counts once. The salt rotates daily and is never stored
alongside the data, so yesterday's hashes cannot be matched to today's: the
store can answer *how many people came* and cannot answer *did this person
come back*. No addresses, no agent strings, no profile ids, no third party.

The dashboard is closed unless somebody deliberately opens it — it needs an
owner key in `api/data/admin.key`, and with no key file present the route
returns the same answer it gives a wrong key, so a guess never confirms that a
right answer exists.

## Built for a phone held upright

The layout is designed for portrait, not shrunk into it. Type is fluid through
`clamp()` so a 320px phone and a 430px one each get a layout that fits; the
home screen starts at the top rather than being vertically centred; sheets come
up from the bottom edge; and padding respects the safe area so nothing is
clipped behind a home indicator.

`node tools/shots-simple.mjs` renders every screen at 320, 375, 390, 414, 430,
768 and 1400 and fails the run if anything overflows horizontally.

## Twenty rounds, and where the money comes from

An election runs twenty rounds. One to fifteen are the campaign, fifteen is a
checkpoint, and sixteen to twenty are the run to government. Alliances close at
the end of round ten.

The host picks the round length before the election starts: two, three or five
minutes, two being the default and the floor. A round also ends the moment
every player still in it has pressed END ROUND — waiting out a clock nobody is
using is the fastest way to make twenty rounds feel like a chore.

### Everybody starts on nothing, and so does the board

No seats, no money, and — this is the part that changed most recently — **no
board**. All 117 constituencies open holding nothing at all: no influence, no
percentage, no leader, no status. A seat reads *uncontested*, and it stays that
way until somebody spends money in it.

That used to be otherwise. The board was dealt from the real sitting members,
which had two problems. It handed one side a lead it had not earned, on some
seeds a very large one. And it made a game nobody had played look like a live
election tracker: the opening screen showed real parties on real percentages,
which is exactly what this is not.

So the game now generates all of it. **Seats are awarded when a round is
settled**, the scoreboard opens 0 – 0 – 0 – 0, and round one decides the seats
somebody actually contested. A short **Election started** note says so once and
takes itself away after a few seconds.

### What a percentage actually is

A seat stores **campaign influence**: what has been spent and won there,
accumulating, never a percentage. The percentages you see are what that
influence is worth against the rest of the field in that seat, worked out when
they are needed and never stored.

That matters. If the board stored percentages, a seat somebody had spent a
crore in and a seat somebody had spent a lakh in would read identically, and
whoever campaigned first would keep a lead nobody could explain. Storing the
work instead means a seat is worth exactly what has gone into it.

A seat nobody has touched has no percentages at all — not four zeroes, no
percentages — which is what *uncontested* means and what all 117 of them are
before round one.

### Turning up is not winning

Part of every seat stays undecided on polling day, and that part is larger the
less work has been done there: `undecided = k / (k + influence)`, with k set so
that a seat with one rally in it is about three-quarters a coin toss.

Without it the whole board could be won by turning up once everywhere — one
cheap move in an untouched seat reads as a hundred per cent of a seat nobody
has actually been reached in, and choosing where to campaign would stop
mattering. The undecided part splits at random on the day, which is what makes
breadth a gamble and depth a decision, and why a seat left uncontested is a
lottery rather than a free saving.

### The allowance is income, not a limit

Nobody starts with money. **₹5 crore arrives at the start of every round**, and
whatever is not spent stays. Over twenty rounds that is ₹100 crore a campaign
and ₹400 crore across four players — but only ever ₹5 crore at a time, so
saving for a big move is a real decision.

| | |
| --- | --- |
| Round 1 | +₹5 Cr, spend ₹1 Cr, ₹4 Cr left |
| Round 2 | +₹5 Cr on top of the ₹4 Cr → ₹9 Cr |
| Round 3 | spend ₹6 Cr of it, ₹3 Cr carries on |

A rally costs ₹1 crore, so "spend ₹1 crore" is exactly one move.

Nothing is ever wiped at a round boundary. The allowance is keyed by round
number, so a refresh, a reconnection, or the same round being settled twice by
two requests arriving together cannot pay anybody twice — which is the one
accounting failure this economy would never recover from.

### Spending a saved balance

A single move is capped at a multiple of its own cost: a rally is still a rally
however rich the campaign. So a large balance is spent **broadly**, through a
bulk allocation across a district or across the closest races — one decision,
many seats, every one of them resolved individually with its own roll, its own
heat and its own chance of a consequence.

What will not fit is reported rather than quietly kept or quietly spent.

## Territory: districts, regions and grants

Punjab has three regions and the game uses the real ones, split by the rivers:

| | | |
| --- | --- | --- |
| **Majha** | between the Ravi and the Beas | 4 districts, 25 seats |
| **Doaba** | the Bist Doab | 4 districts, 23 seats |
| **Malwa** | south of the Sutlej | 15 districts, 69 seats |

Hold **every** seat in a district and it pays its grant every round for as long
as the hold lasts. Leading eight of nine pays nothing, which is what makes the
last seat in a district worth more than the first seat in the next one. Grants
scale with district size, from ₹2 crore for a two-seat district to ₹30 crore
for Ludhiana's fourteen.

**The money is locked to its own region.** A Malwa grant fights Malwa seats and
nothing else, so the map is worth reading rather than merely winning.

### A grant is for a district taken, not one inherited

The opening board is dealt from the sitting MLAs, and it hands one party six
districts on average — eighteen on some seeds, worth ₹136 crore a round.
Paying for those would settle the election before anybody campaigned. So the
districts a party opens holding are its starting position and pay nothing,
until it loses one and takes it back, which is a thing it did.

## Alliances, and the checkpoint

Two players may agree to fight the election together. Offers close at the end
of round ten and an accepted alliance is locked until the result — you cannot
shop for a better partner at round nineteen, which is what makes agreeing early
a commitment rather than a free option. Allies see each other's priority
districts and nothing else: not each other's cash, not their heat, not what
either of them did quietly.

At the end of round fifteen the weakest campaign may be put out — but only one
that is genuinely beyond saving. A player still within reach of the majority,
or still close to the leader, survives, because a comeback is the best thing
that can happen in a game like this. It never applies to a field of two.

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

## The campaign: twenty rounds

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
2. Loans falling due are repaid, before a rupee of that round's money can be
   spent. What cannot be met carries forward with its penalty.
3. At most one random event per player, most rounds none.
4. Events move the shared board.
5. Political heat cools slightly.
6. Leaders and projected seats are recounted from the settled board.
7. The new leader map is compared against the old one to find the seats that
   changed hands.
8. A snapshot of all 117 seats is added to the history.
9. The scoreboard is built and the game saved.
10. Play stays locked for the results break, then the next round opens — or,
    after round 20, the polls close and the count begins.

Each player also sees a summary of what the round did to *them*: money spent,
money raised, cash in hand, debt outstanding, support change, seats gained or
lost, heat change, and any events. It sits in the page rather than over it, so
it can be read alongside the scoreboard rather than dismissed to reach it.

## The scoreboard, in two screens

A round does not end on a table. It ends on what changed, and only then on
where that leaves everybody — because the standings move slowly and the seats
move every round, so leading with the table buries the news under a scoreboard
that has barely shifted.

**First: what changed.** Only the constituencies that changed hands, named,
with who held them and who holds them now. Yours come first — the ones you
took and the ones you lost — because which five appear decides whether the
screen is news or a list. Five are shown, and a longer list is capped with the
remainder counted, never silently dropped. Early rounds can settle forty seats
at once and all 117 every round is a wall nobody reads.

A round where nothing moved says so in a line rather than showing an empty
table.

**Then: who is leading.** Four candidates ranked by seats, each with their
face, their party and what the round did to them, over a bar with the majority
marked on it; then the current leader against the majority, and where you sit.
A **new leader** or **close race** banner when either is true.

Movements per party were dropped because every row already carries its own
change, and the whole round-by-round table lives in the header menu rather than
on a screen that is up for nine seconds.

### Two rounds are not like the others

Round ten and round fifteen get a third screen, because in both of them
something about the rules changes and another seat count would not say so.

**Round ten — halfway.** Alliances close at the end of it: whatever is agreed
by then is what goes into the second half. The screen states that, ranks the
field with how far each campaign is from a majority, and says how many rounds
are left.

**Round fifteen — the review.** The weakest campaign can be put out here, and
only if it is genuinely beyond saving: a field still within reach of a majority
stays whole, and so does one that is simply close. The screen gives the verdict
and the reason either way, shows the whole field with anybody eliminated marked
rather than removed — **their seats stay exactly where they are** — and names
the final phase that follows.

Neither screen interrupts. Both sit one tap past the standings, so a player who
only wants the numbers is not made to read a ceremony.

Every figure on that screen is worked out **once, on the server**, and shipped
whole. Nothing on the client counts anything. Four people watching the same
round see the same numbers, because they are literally the same numbers — a
scoreboard where two players disagree about the score is worse than no
scoreboard at all. `npm run test:rounds` checks exactly this after every one of
the twenty rounds, across four browser windows.

## What the result says beyond the seats

Under the final table, one block per party: **districts controlled** when the
polls closed, and the **grant income** those districts paid across the whole
campaign.

Seats are the result; districts and the money they paid are the reason for it.
A campaign that took six districts and ran on their grants fought a different
election from one that spent its allowance and never held ground, and the seat
count on its own hides that completely. Both figures also go onto the permanent
profile, alongside seats won and coalitions.

## Opponents

Any party nobody claims is played by an opponent, so the scoreboard always has
four competitors and a solo game is still an election rather than a walkover.

They play by exactly the same rules: the same actions, the same costs, the same
weighted outcome tables, the same heat, the same consequences, the same round
allowance. Their round is bounded by what they can afford, exactly as a human
round is. They get no extra information and no extra money. What separates them
is temperament — **steady**, **ambitious** or **reckless** — which sets how much
risk each takes, how tightly it targets, how readily it borrows and how much it
plays for districts rather than for the next seat, so three rivals in a solo
game do not all play alike.

### They play for ground, not only for seats

Three things an opponent that only chased the closest race got wrong, each
worth seats:

- **A district pays every round it is held.** The two seats that complete one
  are worth far more than two seats anywhere else, so an opponent looks for
  the district it is closest to finishing — grant over the square of what is
  missing, so one seat short beats a richer district four short. Districts the
  deal handed it pay nothing, and it knows not to chase those.
- **Grant money is money.** It is locked to the region that earned it, so it
  never joins the cash pile — but any one move lands in one region and can
  draw that region's purse in full. An opponent that counted only cash sat on
  tens of crores of grant income while declaring itself broke. It now spends
  a region's purse in that region.
- **Heat is a tax on every move, not a one-off.** Consequences fire on every
  action once heat is past the floor, and a round is now as many moves as the
  money buys. So an opponent takes a risky strategy only if it lands *under*
  that floor, and lets the per-round cooling keep it there.

Together those are worth about eighteen seats a campaign.

Their names are drawn per game from a pool of ordinary Punjabi given names and
surnames combined freely — 600 combinations, so a new game feels different.
They are invented candidates like the players' own, and none of the pools is
built from real officeholders.

### Are they a real contest?

`npm run balance:ai` plays whole campaigns of one human against three
opponents, rotating which chair the human sits in and pairing every game so the
same seed is played from all four. Over 48 campaigns:

| | mean seats | won | heat | defaults |
| --- | --- | --- | --- | --- |
| human (safe moves, never borrows) | 33.3 | 20/48 | 13 | 0 |
| opponents | 27.9 | 28/48 | 94 | 0 |

Same party, human against opponent: the human is ahead by about **5 seats**. An
attentive player is a little better than an opponent and still loses more often
than they win, because there are three of them — which is what having three
rivals should feel like. The three temperaments finish differently (steady 31,
ambitious 28, reckless 25), so the risk system means something for them too.

**Nobody wins a majority in this test, and that is expected.** Four campaigns
playing the same way with the same money split an empty board roughly evenly,
around thirty seats each — a majority needs half of Punjab, which takes a real
difference in play rather than a good roll. A player who plays *differently*
does reach one: in `balance-money`, which pits distinct approaches against each
other, majorities are common. Four evenly-matched campaigns hanging the assembly
is the honest outcome of an evenly-matched election.

Their heat runs high and the human's does not, because the human baseline never
takes a risky move at all and so never crosses the floor where consequences
begin. An opponent that takes one crosses it, and from then on every move it
makes rolls against itself for the rest of the campaign. That is a real cost of
the risk system rather than a fault in the opponents — but it is why nobody
should read the risk actions as free.

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
twenty rounds against a real server, and after every single round the test
checks that all four agree on the round number, the board and the seat counts.
They finish on identical results.

## Money: cash and debt are different numbers

Nobody is granted anything at the start. The purse fills from the round
allowance, and in multiplayer the server credits it, so a client cannot set its
own.

Cash is what can be spent and **never goes below zero**. Debt is tracked
separately and stays separate all the way to the screen: a player carrying ten
crore of borrowing is not ten crore richer, they have moved a problem four
rounds down the road.

### The bank

| | |
| --- | --- |
| Interest | 20% |
| Repayment falls | 4 rounds later |
| One loan | ₹6.5 lakh to ₹6.65 crore |
| Total debt limit | ₹13.35 crore |
| No borrowing after | round 16 |
| Missed payment | +30%, carried forward |

Borrowing late is refused because the bill would land after election day, which
would quietly make late borrowing free money. Loans can be stacked up to the
debt limit, and the terms are quoted and confirmed before anything is signed.

### Lent against capacity, not appetite

The maximum is worked out before anything is offered, from money that is
actually coming:

- cash in hand,
- the round allowances certain to arrive before the bill falls due,
- the grants already being paid by districts already held,
- less everything already owed.

Nothing speculative counts. **Seats are not cash.** Campaign winnings may never
arrive. A grant from a district nobody has taken is not income. So a campaign
holding ₹4 crore with three rounds to run can borrow against ₹19 crore of
certain money, not against the ₹100 crore a whole game would eventually pay.

The screen leads with the figure that can actually be borrowed, and no amount
above it is offered — dangling a number and then refusing it is worse than not
showing it.

### A missed payment does not go away

If the payment cannot be met, the campaign is not declared bankrupt and the
debt does not disappear. What it has goes toward the bill, the balance carries
into the next round, and **30% is added to whatever is left**. It keeps
carrying, and keeps taking the penalty, until it is cleared — and nobody lends
again while a payment is outstanding.

Repayment happens **before** anything can be spent that round. The other order
let a player borrow, spend the lot, and arrive at the due round with nothing,
which is not a strategy so much as a bug with a plan.

All of it is worked out on the server. The browser asks; the server decides.

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

The dearer actions **reach further** rather than hitting harder. A doorstep
campaign moves one constituency; media coverage is seen in several. The extra
seats take a fraction of the effect, and bad outcomes spread the same way — a
media campaign that goes wrong goes wrong in public.

`node tools/calibrate-actions.mjs` measures what a crore of each action is
actually worth, in seats expected on polling day, and reports the scaling that
would flatten them. They currently sit between 0.49 and 0.70 seats a crore — a
1.4× spread across eleven actions, with the cheap wide ones at the top.

### Does money decide the game?

The brief says it must not. `node tools/balance-money.mjs` plays whole campaigns
for six approaches that vary one thing at a time and reports how they finish.
Over 40 games:

| strategy | | mean seats | majorities | games won |
| --- | --- | --- | --- | --- |
| scattergun | cheap moves, seats picked at random | 69.0 | 31/40 | 21/40 |
| spreader | cheap moves, whole balance spread thin | 67.7 | 37/40 | 15/40 |
| careful | cheap moves, aimed where they are worth most | 63.6 | 28/40 | 4/40 |
| heavyhitter | the maximum behind every move, few seats | 33.6 | 0/40 | 0/40 |
| bigspender | borrows and buys the dearest safe move | 29.9 | 0/40 | 0/40 |
| gambler | borrows and lives on risky strategies | 28.2 | 0/40 | 0/40 |

No approach takes more than 53% of games, and the money axis behaves: spending
more per move is worth **−21 seats**, not more. Spreading a balance rather than
dumping it is worth **34 seats**, which is the spending curve doing its job.
Living on risky strategies is the worst plan on the board.

### What the empty board changed

When every seat opened at roughly a quarter each, the argument about a seat was
how to move a percentage: aiming at the closest race was worth about five seats
a campaign, and spending more was worth almost nothing.

On an empty board the first question about a seat is whether anybody has been
there at all. So breadth is now the dominant idea, and the gap between a
well-aimed plan and a scattered one is small — about six seats, and in the
scattered plan's favour. That is a real change in what good play looks like, and
an honest consequence of the board no longer being dealt.

What has not changed, and what `npm run test:campaign` fails the build over, is
that money must not buy the election.

## Parties, and where they come from

There is no list of parties in this game. There is a screen that asks you to
found one.

| | |
| --- | --- |
| Name | up to 40 characters, anything you like |
| Short name | up to four letters, suggested from the name and editable |
| Symbol | one of sixteen — a tree, a lamp, a river, a shield |
| Colour | one of twelve, chosen to be told apart at the size of a dot |
| Slogan | optional, and it appears on your card |

The abbreviation writes itself from the name — *Punjab Development Party*
becomes PDP — and stops following the moment you edit it, because then it is
yours. It is what appears on the scoreboard, the map and every compact card,
which is why four letters is the limit.

A party's **id is the slot its founder sat in**, not anything they typed. So two
players can found parties with the same name and nothing collides, and a save
can be read without knowing who typed what.

Every empty chair is filled by an opponent that founds its own party from three
pools — a place, a cause, and a kind of body — which is roughly the shape a real
new party's name takes: *Doaba Farmers Morcha*, *Sutlej Progress Sabha*. Two
thousand-odd combinations, and no combination of the pools lands on a real
party's name. An opponent never takes a name, colour, symbol, abbreviation or
face a player has already used: four campaigns on one scoreboard have to be four
campaigns at a glance.

> **No real party is in this game** unless a player typed its name in
> themselves. There is no AAP, INC, BJP or SAD anywhere in the code, the data or
> the save format.

### Candidates

Twenty-four of them, drawn one at a time rather than generated from a seed — a
generator gives you unlimited faces and no good ones, because nobody ever looks
at any single result and decides it is right.

They are invented people: a range of ages, of dress and of bearing, turbaned and
bare-headed, in a dupatta and in a jacket, thirty and seventy. Every one is
drawn on the same construction, so a grid of them reads as one cast rather than
as twenty-four separate drawings.

> Not one is drawn from a photograph, a real candidate or a real officeholder,
> and the set exists precisely so the game never needs a photograph of anybody.

You pick yours from a grid; opponents are dealt faces nobody else is using. The
roster exists in three places — the drawings, the data file the engine reads,
and the server's copy for dealing to opponents — so `npm run test:ai` fails the
build if they ever stop matching.

## The map

All 117 seats, coloured by whoever leads them in the game, fading as the lead
narrows so a toss-up does not read as decided. Click a seat to target it; the
map repaints after every campaign action. Hovering names the seat and either
its leader and rating or, where nobody has campaigned, that it is uncontested —
which early on is most of Punjab. Seats nobody has been to are drawn as
unclaimed ground rather than as somebody's, and the legend counts only what has
actually been decided.

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
is two minutes long by default, and a mis-click should not be the reason a
campaign runs out of cash.

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

## Profiles, statistics and the leaderboard

A profile is a chosen name, a drawn face and a record of elections. There is no
email, no phone number and no password, because none is collected — the browser
generates an id on first play and keeps it in `localStorage`. That is a
deliberately low bar: this is a game, and asking somebody to make an account
before they can find out whether they enjoy it would cost more players than it
protects.

A profile starts itself the first time somebody names a candidate, in solo
setup or in the lobby. Nothing is ever asked for.

### Verified and self-reported

A solo game runs entirely in the browser. The server never sees a roll and
cannot tell a real result from a crafted request, so a solo result is recorded
as **self-reported**: it counts on the player's own profile, where it is their
business, and it is excluded from the global counters and the leaderboard,
where it would be an invitation.

A multiplayer game is **verified** — the server rolled every die and owns the
board — so it counts everywhere.

| | verified | self-reported |
| --- | --- | --- |
| Your own profile | yes | yes |
| Global counters | yes | no |
| Leaderboard | yes | no |

### What is public

Only game statistics: chosen name, drawn portrait, elections, wins, seats,
level, achievements. The profile id is never published — the portrait seed is
generated separately from it, precisely so that putting a face on a leaderboard
row does not put the player's id there too.

### Live figures

The home screen's players / elections / governments come from a counter on the
server, incremented once per finished election — not once per player, because
four people contesting one election is still one election. Nothing is seeded.
A fresh install shows zeros and says so: *"No elections have finished here yet.
Yours would be the first."* A number nobody can trust is worse than a small one.

### The score

Configurable, in `api/campaign-config.json` under `profiles.score`: wins,
seats, coalition wins and achievements, with a small amount for turning up.
Winning is worth far more than playing, so grinding games is not a strategy —
the build script refuses a config where a game played is worth more than a game
won.

Level follows the score on a widening curve, so the early levels come quickly.

### Achievements

FIRST WIN, MAJORITY (59+), LANDSLIDE (75+), KINGMAKER (a coalition after a hung
assembly), COMEBACK (won after being behind at round ten), FINANCIAL MASTER
(won on under ₹3 crore) and RISK TAKER (won after using the high-risk
mechanics). Awarded by the server from the result, never claimed by the client.

## What the home screen does not download

The 117 constituency records, the sitting MLAs and the map geometry are
together the largest thing this game fetches, and the opening screen uses none
of them — it shows a title, two buttons and some counters.

So they are not in the page. `js/data/loader.js` pulls them in the moment
somebody starts, resumes or joins an election, once per session, and
`app.js` waits for them on the way into any screen that needs a board. Parties
and campaign actions stay in the page, because the home screen shows party
performance and they are small.

## Multiplayer

Two to four players, one party each, over a shared server — not localStorage,
because four people are on four devices.

- **Create Game** issues a five-character code (`P7K4Q`) drawn from `random_int`
  over an alphabet with no look-alike characters. It is never derived from a
  database id, and a mistyped code is rejected rather than quietly corrected
  onto someone else's game.
- **Join Game** takes that code, case-insensitively, into the same lobby.
- **A party each, founded not claimed.** Nothing can be taken and nothing has to
  be shared out: the id is the slot you are sitting in, so two players may found
  parties with the same name and nothing collides. Every empty chair is filled by
  an opponent that founds its own.
- **Ready system.** You cannot ready up until you have named yourself and named
  your party; the host cannot start until every *connected* player is ready.
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

- **Home** — the title, `117 Assembly Seats`, and the two ways to play as the
  loudest things on the screen: `PLAY SOLO` and `PLAY WITH FRIENDS`. A
  returning player is welcomed back by name and offered the election they are
  in the middle of. Underneath, quietly: the live figures, the top players,
  your own record and your recent elections
- **Setup** — your name and face, then found a party: name, short name, symbol,
  colour, slogan, with a preview card of what it all adds up to. The ₹5 crore a
  round is granted, not typed
- **The game screen** — see above
- **Round results** — between rounds, an election-night scoreboard: four
  candidates with portraits ranked by projected seats, the seats that changed
  hands, and who leads now
- **Profile** — portrait, name, level, the record, the party record, every
  achievement earned or not, and the full election history
- **Leaderboard** — ranked on the configured score, verified games only
- **Autosave** — solo progress writes to `localStorage` after every round and
  every move, and needs no server; multiplayer state lives on the server, saved
  under lock on every change

Everything in the brief is built. The obvious next things would be more than
four players, and refreshing the MLA data before the next state election.

## Files

```
simple/
  index.html
  css/styles.css           base; then campaign, systems, rounds, scoreboard,
                           game, home, menu, play (timer, money panel,
                           districts, END ROUND), territory (priorities,
                           alliances, bulk), map, and finally mobile —
                           portrait phones, loaded last so it wins
  js/
    data/parties.js          the four parties — the only place a party is defined
    data/actions.js          GENERATED: costs, outcomes, heat, consequences
    data/loader.js           fetches the board when a game starts, not before
    data/constituencies.js   GENERATED: the 117 seats           ] fetched on
    data/incumbents.js       GENERATED: the 117 sitting MLAs    ] demand,
    data/regions.js          GENERATED: regions, districts, grants ] not in
    data/geometry.js         GENERATED: map shapes and hex tiles   ] the page
    engine/rng.js            seeded randomness
    engine/campaign.js       campaign rules for solo play: moves, money, rounds
    engine/ai.js             opponents for solo play
    state.js                 the game object, validation, starting a campaign
    storage.js               localStorage save/load behind a tiny adapter
    ui/dom.js                element helper + Indian currency formatting
    net.js                   multiplayer API client + polling
    profile.js               who the player is between games
    ui/home.js               the opening screen and the live figures
    ui/profile.js            the profile and leaderboard screens
    ui/setup.js              solo party + candidate form
    ui/multiplayer.js        create game / join game
    ui/lobby.js              the four-player lobby
    ui/round.js              round clock, the bank and the dialogs
    ui/portrait.js           drawn candidate portraits, from a seed
    ui/scoreboard.js         the leaderboard, seat changes and round results
    ui/seats.js              leading-from, on the home screen
    ui/areas.js              a candidate's areas: leading, close, losing
    ui/campaign-sheet.js     pick a move, pick an amount, see the result
    ui/allocate.js           one sum across many seats, in one decision
    ui/territory.js          priority districts, and alliances
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
    lib/Profiles.php         profiles, levels, achievements and the counters
    lib/Territory.php        regions, districts, and who holds them
    lib/Alliances.php        pacts, and the round fifteen checkpoint
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
