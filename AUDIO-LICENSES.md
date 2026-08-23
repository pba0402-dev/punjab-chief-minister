# Audio licences

Every sound file shipped with this game is listed here with where it came from
and what licence it is under. A file that is not in this list is not cleared,
and should not be deployed.

## Current state: no audio files are installed

`simple/assets/audio/music/` and `simple/assets/audio/sfx/` are empty. The
audio system is built and working — it simply has nothing to play, and says so
rather than pretending.

This is deliberate. Sourcing audio automatically would mean fetching files and
asserting a licence for them without having read that licence, which is a claim
I am not in a position to make. A wrong claim here is worse than silence: it is
the kind of thing that surfaces during an App Store review or, later, as a
takedown.

## What the game will play once files are added

Drop files into the folders below, named exactly as listed, and they start
working with no code change. `.mp3`, `.ogg`, `.m4a` and `.wav` are all
accepted — the browser picks the first format it understands.

### `simple/assets/audio/music/`

| File | Used for |
| --- | --- |
| `theme.*` | The one background loop, under the whole game |

Music should loop cleanly, sit well under speech-free gameplay, and be quiet
enough that the default volume (35%) is comfortable rather than a compromise.

### `simple/assets/audio/sfx/`

| File | Played when |
| --- | --- |
| `tap.*` | Moving between Home, Grant, Alliances and Loan |
| `select.*` | Choosing a seat on the map, a party, or a candidate |
| `invest.*` | Confirming money into a seat |
| `loan.*` | Taking a loan |
| `grant.*` | A district grant being paid |
| `alliance.*` | An alliance offered or accepted |
| `won.*` | A seat won outright |
| `results.*` | A region's results beginning |
| `victory.*` | The overall leader screen |

Effects should be short — a few hundred milliseconds — and quiet. Several can
fire close together, so anything with a long tail will stack.

## Recording a file you add

Add a row here for every file, and do not leave a blank cell:

| File | Title | Author | Source URL | Licence | Attribution required | Date added |
| --- | --- | --- | --- | --- | --- | --- |
| _(none yet)_ | | | | | | |

**Licences that are safe here:** CC0 / public domain, and commercial
royalty-free licences you hold a receipt for. Keep the receipt or licence text
with the project.

**Licences that need care:** CC-BY requires visible attribution — if you use
one, the credit has to appear in the game, not only in this file. CC-BY-NC
cannot be used if the game is ever paid for or carries advertising.

**Never:** commercial music, anything ripped from another game, or anything
whose licence you cannot produce on request.

## Checking what is installed

The game reports this itself. Open **More → Music**: when no files are present
it says so under the switches, and `CMP.audio.ready()` returns `false`.
