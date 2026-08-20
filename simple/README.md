# Chief Minister of Punjab — Version 1

A deliberately small first version. Choose a party, enter your candidate
details and budget, start the election, and see all 117 Punjab assembly
constituencies. It saves automatically and picks up where you left off.

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
npm run test:all            # all three suites below
npm run test:v1             # 62 checks: solo flow through the real UI
npm run test:api            # 76 checks: the multiplayer API
npm run test:mp             # 59 checks: four browsers in one lobby
npm run shots:v1            # render at 1400 / 768 / 390 / 360 px
npm run shots:lobby         # render the multiplayer screens
npm run data:v1             # regenerate the constituency data file
```

Solo mode works by opening `simple/index.html` directly. Multiplayer needs the
page served by PHP, since the lobby talks to `api/index.php`.

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
| `start` | host only |
| `leave` | free your slot |
| `health` | php version, game count, writability |

Auth is a `playerId` + `token` pair issued once at create/join, compared with
`hash_equals` and never included in any response.

Storage sits behind the `Store` interface in `api/lib/Store.php`. Version 1
ships `FileStore`: one JSON file per game under `api/data/` (web-denied,
created at runtime), with writes serialised by `flock`. Moving to MySQL means
writing one more class with the same five methods and changing the single line
in `index.php` that constructs the store.

## What Version 1 does

- **Home** — title, seat count, and the two ways to play: `PLAY SOLO` and
  `PLAY WITH FRIENDS`. Anything already in progress appears as a quiet resume
  line underneath
- **Setup** — pick AAP, INC, BJP or SAD, then candidate name, slogan and budget
  (formatted in Indian grouping as you type: `₹10,00,00,000`)
- **Election** — party, candidate, slogan, budget, Seats Won, Majority Required
  (59), and all 117 constituencies grouped by their 23 districts
- **Autosave** — solo progress writes to `localStorage` on every change and
  needs no server; multiplayer state lives on the server and is polled

Not built yet, on purpose: the map, campaigning, polling, events, results.

## Files

```
simple/
  index.html
  css/styles.css
  js/
    data/parties.js          the four parties — the only place a party is defined
    data/constituencies.js   GENERATED: the 117 seats
    state.js                 the game object, validation, starting a campaign
    storage.js               localStorage save/load behind a tiny adapter
    ui/dom.js                element helper + Indian currency formatting
    net.js                   multiplayer API client + polling
    ui/home.js               home screen (solo / multiplayer)
    ui/setup.js              solo party + candidate form
    ui/multiplayer.js        create game / join game
    ui/lobby.js              the four-player lobby
    ui/election.js           election screen
    app.js                   screen routing, autosave, boot
  api/
    index.php                front controller and routes
    lib/Store.php            storage interface + FileStore
    lib/Code.php             game code generation
    lib/Lobby.php            lobby rules, pure functions
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

Each record carries `number`, `name`, `district` and `reserved`. The fields
Version 2 needs — status, player support, opponent support, result — are
documented in `CONSTITUENCY_TEMPLATE` and written into the save under
`constituencies`, keyed by constituency number.
