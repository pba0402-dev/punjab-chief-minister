# Third-party services

Checked against `package.json`, `simple/index.html`, and every network call in
`simple/js/`.

## Runtime dependencies: none

`package.json` declares no `dependencies`. The game is vanilla JavaScript with
no framework, no bundler, and no runtime library. Nothing is fetched from a CDN
— `simple/index.html` loads only files served from the game's own origin.

## Development dependencies: one

| Package | Version | Used for | Ships to users |
| --- | --- | --- | --- |
| `jsdom` | ^30 | Running the UI test suites headlessly | No |

## Services the running game touches

| Service | What for | Data sent |
| --- | --- | --- |
| The game's own API (`game.1-quote.com.au/api`) | Multiplayer, profiles, statistics | Game state, display name, chosen face id, random player id |

That is the complete list. There is exactly one outbound call site in the
client, `simple/js/net.js`.

## Not used

- **Authentication provider** — there is no login of any kind
- **Third-party database** — game state is JSON files on the host, written under `flock`
- **Analytics SDK** — the game counts its own events server-side; no Google Analytics, no Firebase, no Segment, no Amplitude
- **Crash reporting** — no Sentry, Bugsnag, or Crashlytics
- **Advertising** — none, and no advertising identifier is read
- **Payments** — no in-app purchases, no payment processor
- **Push notifications** — none
- **Maps SDK** — the Punjab map is drawn from geometry shipped with the game, not from a map provider
- **Fonts CDN** — fonts are served from the game's own origin
- **Audio provider** — see `AUDIO-LICENSES.md`; no files are installed

## Hosting

| | |
| --- | --- |
| Provider | Hostinger shared hosting |
| Runtime | PHP 8.3, static files over HTTPS |
| Data at rest | JSON files under `api/data/`, blocked from the web by `.htaccess` |
| Region | **[NEEDS YOUR INFORMATION]** — confirm which region your Hostinger plan is in, since it affects what you tell users about where data is held |
