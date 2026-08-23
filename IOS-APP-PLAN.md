# Packaging this for iOS

## What this project is

Vanilla JavaScript, HTML and CSS, with a PHP API on shared hosting. No
framework, no bundler, no build step, no runtime dependencies. `npm test`
exists; `npm run build` does not, because there is nothing to build — the files
that are edited are the files that are served.

That shape decides the packaging.

## Recommended approach: Capacitor

Wrap the existing `simple/` directory in a native shell and keep the PHP API on
the server, where it already is.

**Why not the alternatives:**

| Approach | Why not |
| --- | --- |
| Rewrite in React Native / Swift | Months of work to reach parity with a game that already works. Nothing about it is served by a rewrite. |
| Cordova | Works, but is effectively in maintenance; Capacitor is its successor and better supported. |
| PWA only | No App Store listing, which is what you asked for. Still worth doing alongside. |
| Load the live site in a WKWebView | **This is the one Apple rejects.** Guideline 4.2 treats a wrapper around a website as not an app. The bundle must contain the game. |

The distinction matters: Capacitor ships `simple/` **inside the app bundle**, so
the interface is local and only the API is remote. That is an app that talks to
a server, not a browser pointed at a website.

## Steps

```bash
npm install --save-dev @capacitor/cli @capacitor/core @capacitor/ios
npx cap init "Election Time" com.example.electiontime --web-dir=simple
npx cap add ios
npx cap sync ios
npx cap open ios      # opens Xcode
```

`--web-dir=simple` is the important flag: it is the existing directory, with no
build step in front of it.

## What has to change in the game

**The API base URL.** `simple/js/net.js` currently uses same-origin relative
paths. Inside the bundle there is no origin to be relative to, so it needs an
absolute base — `https://game.1-quote.com.au/api/index.php` — used when running
in the app and left relative on the web. One constant, resolved once at load.

**HTTPS only.** Already true. App Transport Security will refuse plain HTTP.

**Safe areas.** The CSS already uses `viewport-fit=cover`; check
`env(safe-area-inset-*)` padding on the round strip and the bottom sheets
against a device with a home indicator.

## Bundle identifier

`[YOUR REVERSE DOMAIN].electiontime` — for example `au.com.1quote.electiontime`.
It must match the App ID in your developer account and cannot be changed after
the first submission.

## App icon

One 1024×1024 PNG, no alpha channel, no transparency, no rounded corners —
Apple applies the mask. Xcode generates the rest.

The game has no icon yet. **[NEEDED]**

## Launch screen

A storyboard, not an image set. Keep it to the wordmark on the game's own
background — a launch screen that differs much from the first real screen reads
as a flash.

## Permissions

**None.** The game does not use the camera, microphone, location, contacts,
photo library, notifications, or Bluetooth. Add no `NS*UsageDescription` keys:
an unexplained permission string invites a question you have no answer to.

## Minimum iOS version

**iOS 14** covers effectively every device in use and is what recent Capacitor
targets. Nothing in the game needs anything newer.

## Build and submit

1. Xcode → Signing & Capabilities → your team, automatic signing.
2. Set version and build number.
3. Product → Archive.
4. Distribute App → App Store Connect → Upload.
5. TestFlight: install on a real device and play a full multiplayer election
   before submitting — the simulator will not surface the safe-area problems.
6. App Store Connect: metadata (`APP-STORE-METADATA.md`), screenshots, App
   Privacy answers (`APP-PRIVACY-DATA-MAP.md`), age rating
   (`APP-STORE-CONTENT-REVIEW.md`), export compliance
   (`EXPORT-COMPLIANCE.md`).
7. Submit.

## Before any of this

Read `CONTENT-RIGHTS-REVIEW.md`. The game currently ships portraits of real
politicians and real party symbols. That is a guideline 5.2 rejection waiting
to happen and it is not something the packaging can work around.

## Also worth doing

Add a web app manifest and an icon set so the existing site installs to a home
screen. It costs one file, works today, and gives people a way to play while
the App Store review runs.
