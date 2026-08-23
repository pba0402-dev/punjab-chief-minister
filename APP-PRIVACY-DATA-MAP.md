# What this game collects

Written from the code, not from a template. Everything below was checked
against `simple/js/`, `simple/api/`, and `package.json`.

The short version: there are no accounts, no email addresses, no passwords, no
third-party SDKs, and no advertising or tracking identifiers. The game keeps a
display name, a chosen face, and what happened in the elections you played.

## There is no login

There is no sign-up, sign-in, password, email address, phone number, or social
login anywhere in this project. A player is identified by a random 16-character
hex id generated in the browser the first time they play
(`simple/js/profile.js`). Nothing links that id to a person.

## Stored in the browser (localStorage)

| Key | Holds | Why |
| --- | --- | --- |
| `cmp.punjab.profile.v1` | Display name, chosen face id, id | So a returning player keeps their name and record |
| `cmp.punjab.save.v1` | The solo election in progress | So closing a tab does not lose a game |
| `cmp.punjab.session.v1` | Game code and player token | So a multiplayer game can be rejoined |
| `cmp.punjab.settings.v1` | Music/sound on-off and volumes | So a preference set once is not set again |

Clearing site data removes all of it. Nothing here is a cookie, and the game
sets no cookies.

## Stored on the server

**Profiles** — `api/data/profiles/<id>.json`

Display name, chosen face id, and totals from finished elections: games played,
games won, seats, districts, grant income, achievements, and a short history of
past results. The id is the random one from the browser.

**Games** — `api/data/game-<id>.json`

The election itself: the invented party each player founded, the board, the
rounds, alliances, loans, and the result. Also a per-player token used to prove
the caller is that player. Tokens are never sent to other clients.

**Counters** — `api/data/counters.json`

Whole-installation totals only: how many players, elections, governments,
coalitions. No identifiers.

**Activity log** — `api/data/analytics/<date>.json` and `totals.json`

Counts of events per day — visits, games created, rounds started, games
finished — and a set of visitor hashes used only to tell one person refreshing
five times from five people arriving.

The visitor hash is `sha256(day + per-installation secret + IP + user agent)`,
truncated to 16 characters. The salt includes the day and is never stored
alongside the hash, so yesterday's hashes cannot be matched to today's. It can
answer "how many people came" and cannot answer "did this person come back".
Daily files are deleted after 90 days; only the aggregate totals survive.

The IP address and user agent are used to compute that hash and are not stored.

## What is not collected

No location. No contacts. No camera or microphone. No photo library — the
"profile photo" is a choice from a fixed set of illustrations shipped with the
game, not an upload. No device identifiers, advertising identifiers, or push
tokens. No crash reporting. No payments. No advertising. No chat.

## Tracking

None, in Apple's sense. Nothing here is linked to data from other apps or
websites, and nothing is shared with a data broker or advertising network.
There is no third-party SDK in the project to do so — `package.json` has no
runtime dependencies at all, and one development dependency (`jsdom`) used
by the test suite and never shipped.

## Where data goes

To the game's own server (`game.1-quote.com.au`) and nowhere else. There is
exactly one outbound call site in the client, `simple/js/net.js`, and it only
ever talks to this game's own API.

## Retention and deletion

- Daily activity files: deleted automatically after 90 days.
- Aggregate counters: kept indefinitely; they contain no identifiers.
- Games: kept on the server; a finished election is the record of that game.
- Profiles: kept until deleted.

A player can delete their profile from **My Profile → Delete my profile**. It
removes the profile file from the server and clears everything this browser
stored. See `simple/api/index.php`, action `deleteProfile`.

## For Apple's App Privacy questionnaire

Based on the above, the honest answers are:

| Category | Collected | Linked to identity | Used for tracking |
| --- | --- | --- | --- |
| Contact info | No | — | — |
| Health, financial, location, contacts, browsing | No | — | — |
| User content | No | — | — |
| Identifiers | No advertising or device identifiers. A random in-app id. | Not linked to a person | No |
| Usage data | Yes — coarse, aggregated event counts | No | No |
| Diagnostics | No | — | — |

**The display name is chosen by the player and is not required to be real.**
If you would rather declare it conservatively, "Name" under Contact Info,
not linked to identity, not used for tracking, would also be defensible.

## Needs your decision

- The contact address for privacy requests. Placeholders are marked
  `[SUPPORT EMAIL]` in the privacy, terms and support pages.
- Whether you treat the player-chosen display name as "Name" for the
  questionnaire. Either answer is arguable; pick one and be consistent.
