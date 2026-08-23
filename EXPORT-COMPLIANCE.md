# Export compliance

For Apple's export-compliance questions. This describes what the app actually
does; it is not a legal classification, and the final answers are yours to give.

## What encryption the app uses

**None of its own.** The project contains no cryptographic library, no
encryption implementation, and no key management.

Two places use hashing, neither for confidentiality:

| Where | What | Purpose |
| --- | --- | --- |
| `simple/api/lib/Analytics.php` | SHA-256, truncated | Turning an address and user agent into a daily visitor hash, so one person refreshing is not five visitors |
| `simple/api/index.php` | `hash_equals` | Comparing a player's session token in constant time |

Player tokens are generated with `random_bytes` and compared, not encrypted.

## What network security it relies on

HTTPS, provided by the host. The app makes standard `https://` requests and
does not implement, configure, or bundle TLS itself.

## The questions Apple asks, and the facts

**"Does your app use encryption?"** — The app uses HTTPS and standard platform
hashing. It contains no proprietary or non-standard cryptography.

**"Does it qualify for any exemptions?"** — Apps whose only use of encryption
is (a) HTTPS provided by the operating system and (b) standard hashing not used
for confidentiality are the ordinary case for the exemption at 5D002 / the
"limited to authentication" carve-out. **[NEEDS LEGAL CONFIRMATION]** — I am
describing the facts, not certifying the classification.

**"Is it available in France?"** — a separate question Apple asks; answer per
your distribution plan.

## What to put in the build

If you conclude the exemption applies, the usual declaration is
`ITSAppUsesNonExemptEncryption = false` in `Info.plist`, which stops Apple
asking on every upload. Do not set it until you are satisfied the answer is
right.

## Summary

| | |
| --- | --- |
| Custom cryptography | None |
| Encryption libraries bundled | None |
| HTTPS | Yes, platform-provided |
| Hashing | SHA-256 for visitor de-duplication; `hash_equals` for token comparison |
| Data encrypted at rest by the app | No — JSON files, protected by host file permissions and `.htaccess` |
