# App Review checklist

Sorted by who can act on it. Nothing here says the app will pass review — that
is Apple's call, and two items below make it genuinely uncertain.

---

## ✅ Ready

| Item | Where |
| --- | --- |
| Privacy policy, written from the code | `simple/privacy.html`, linked from the opening screen |
| Terms of use | `simple/terms.html` |
| Support page | `simple/support.html` |
| Profile deletion that actually deletes | My Profile → Delete my profile; `action=deleteProfile`; tested |
| App Privacy data map | `APP-PRIVACY-DATA-MAP.md` |
| Third-party services audit | `THIRD-PARTY-SERVICES.md` — there are none at runtime |
| Export compliance facts | `EXPORT-COMPLIANCE.md` |
| Audio licensing register | `AUDIO-LICENSES.md` — no files installed |
| Content rights review | `CONTENT-RIGHTS-REVIEW.md` |
| Age-rating evidence | `APP-STORE-CONTENT-REVIEW.md` |
| Text contrast | Every text colour clears WCAG AA against its ground |
| In-app help | More → Help / Tutorial: the Election Briefing, ten chapters |
| Metadata drafts | `APP-STORE-METADATA.md` |
| iOS packaging plan | `IOS-APP-PLAN.md` |
| No login required to play | Solo play starts from the opening screen |
| No permissions requested | Camera, location, contacts, photos, notifications: none |
| Works in mobile portrait | 287 screenshots, 320–1400px, no horizontal overflow |
| No crashes in the suites | 1,274 checks across nine suites |

---

## ⚠️ Needs rights or legal review — do this first

**Portraits of real politicians.** Ten illustrations of identifiable living
figures, named in `portraits.json`. Guideline 5.2, plus personality rights in
India. See `CONTENT-RIGHTS-REVIEW.md`.

**Real party symbols.** Six registered party symbols, several captioned with
the party's name. Same guideline.

Both are a mapping change, not a code change — `simple/js/data/asset-map.js`
points each id at a filename. Replacing the artwork with invented characters
and symbols removes the problem outright.

**Export classification.** `EXPORT-COMPLIANCE.md` records the facts; the
classification itself is a legal judgement.

---

## ⚠️ Needs a product decision

**User-generated content moderation.** Players type a party name, short name
and slogan that other players see. There is no filter, no report control, and
no block. Guideline 1.2 expects all three for an app with user-generated
content. Options are in `APP-STORE-CONTENT-REVIEW.md`.

This is the item most likely to cause a rejection after the rights ones.

---

## 📝 Needs your information

| Placeholder | Appears in |
| --- | --- |
| `[SUPPORT EMAIL]` | privacy, terms, support |
| `[BUSINESS NAME AND ADDRESS]` | privacy, terms |
| `[JURISDICTION]` | terms |
| `[DATE]` | privacy, terms |
| Hosting region | `THIRD-PARTY-SERVICES.md` |
| App name availability | `APP-STORE-METADATA.md` |

Search for `[` across the four files and you will find every one.

---

## 🍎 Needs an Apple Developer account

- Apple Developer Program membership
- Bundle identifier registered
- App record created in App Store Connect
- **App icon**, 1024×1024, no transparency — not yet made
- Screenshots at 6.7" and 6.5"
- App Privacy answers entered
- Age-rating questionnaire answered
- Export-compliance question answered
- TestFlight run on a real device
- Capacitor wrapper built — `IOS-APP-PLAN.md`

---

## Order I would go in

1. Replace the portraits and party symbols. Everything else is wasted effort
   if this is not settled.
2. Decide the user-generated content answer and build it.
3. Fill in the placeholders.
4. Make the icon.
5. Wrap with Capacitor, run it on a real phone, play a full election.
6. Screenshots from the real build.
7. App Store Connect, then submit.
