# ADR: how an installed Swift app gets off the Swift app

Date: 2026-09-14 · Status: **SUPERSEDED 2026-09-20** by
[2026-09-20-swift-app-migrates-itself.md](2026-09-20-swift-app-migrates-itself.md)

> Kept because the reasoning is still the record of what was true on the day,
> and because three of its four objections were removed by later work rather
> than by being wrong. The one that survived — the library appearing to empty
> itself — is the thing the new ADR had to solve before it could reverse this
> one. Read this first if you want to know why the automatic path was refused;
> read the successor for why it is now the plan.
Refines: [2026-09-12-cross-platform-tauri.md](2026-09-12-cross-platform-tauri.md),
piece F stage F2 in
[specs/2026-09-14-retire-swiftui-design.md](../superpowers/specs/2026-09-14-retire-swiftui-design.md)

## Decision

**The Tauri app does not take the `com.darkwell.screepub` bundle identifier,
and existing Swift users install the new app by hand.**

**The last Swift release ships one change: its update check is switched off.**
Not as a fallback if a refusal cannot be verified, which is how F2 currently
frames it, but as the primary plan. The reasoning is below: the refusal is
real, and a real refusal is still a bad experience.

That release's notes name the new download and say it is the last Swift
release.

## Why this needed its own record

F2 already identifies the updater as "a live hazard, not a cosmetic one" and
already reasons that the identifier pin *should* refuse a Tauri DMG. That
reasoning is correct. What was missing is what the refusal actually looks
like, when it starts, and what the alternative would cost — and the
alternative turns out to be expensive for a reason nobody had connected.

## What the shipped updater actually does

This is fixed behaviour. Every 0.5.4 install in the world has this code and
nothing in this repository can reach it, so the migration has to be designed
around it exactly as written.

1. Newest non-draft release; picks `assets.first(where: name.hasSuffix(".dmg"))`
   ([UpdateCheck.swift:226](../../app/Sources/ScreepubKit/UpdateCheck.swift))
2. Downloads it, takes consent, preflights (not translocated, `/Applications`
   writable)
3. Verifies the **DMG**: Apple anchor, Developer ID chain, team `XSRB3D643J`.
   No identifier pin, deliberately: a signed DMG's identifier is its filename
   stem
4. Mounts it, takes the first root item with a `.app` extension
5. Verifies **that app** against `appRequirement`, which includes
   `identifier "com.darkwell.screepub"`
   ([UpdateInstall.swift:38](../../app/Sources/ScreepubKit/UpdateInstall.swift))
6. Requires `CFBundleShortVersionString` to equal the release version
7. Stages beside the destination, re-verifies the staged copy, swaps,
   verifies again, relaunches

## Three facts F2 did not have

**The refusal is structural, not probable.** `identifier` in a codesign
designated requirement is an exact match, not a prefix. The Tauri app is
`com.darkwell.screepub.desktop`. Step 5 cannot pass. F2 asks for this to be
verified on a real Mac before shipping; that observation is still worth
making, but the outcome is not in doubt from the source.

**The refusal is late and repeating.** Because the DMG requirement does not
pin an identifier, steps 2 through 4 all succeed. The user downloads the
whole disk image, it mounts, and only then does the app inside fail the
signature check. That happens on every check, forever, and surfaces as a
codesign error rather than as "there is a new app, go and get it." F2's
phrase "a failed update rather than a wrong one" is accurate and still
undersells the cost. **This is why the final Swift release's only job is to
turn the check off, rather than to rely on the refusal holding.**

**The hazard is dormant, and F2 is what wakes it.** While both DMGs are
published, `release.yml` uploads `Screepub-macOS.dmg` before the Tauri
bundles, and the updater takes the *first* `.dmg` asset. So today an old
install still finds the Swift build and updates normally. The day F2 stops
publishing the Swift DMG, every existing install starts failing instead. The
current safety is upload ordering, which is incidental rather than designed,
and it should not be mistaken for the plan working.

## The alternative, and the reason it is not the decision

The only path that migrates people without asking anything of them is to give
the Tauri app `com.darkwell.screepub` at F2. The old updater would then verify
it, swap the bundle in place and relaunch, and the user would simply have the
new app. That is genuinely attractive and it is why this ADR exists rather
than a one-line note.

It is rejected on four grounds, the first of which is disqualifying on its
own.

**1. The old updater is architecture-blind, and the Tauri Mac build is not
universal.** `first(where: .dmg)` was written when there was exactly one
universal `Screepub-macOS.dmg` to choose from, so it never needed to think
about architecture. `tools/sidecar-targets.ts` has only `x86_64-apple-darwin`
and `aarch64-apple-darwin`; E2 measurement 6 records that a universal sidecar
could not be built on the Linux development machine. Handing that updater two
per-arch DMGs means every user is handed whichever one uploaded first, so
roughly half receive an app that cannot run. F2 already knows about the
per-arch problem and scopes it to the Homebrew cask, where it is a packaging
inconvenience. On the updater path it is a correctness failure, and that
connection had not been made.

**2. The payload would remove the updater.** The Tauri app has none. So the
last automatic update a user ever receives would be the one that ends their
ability to receive updates, delivered without them knowing that is what they
consented to. That is the same question `docs/retired-coverage.md` is holding
open with 59 assertions behind it, and it should be answered deliberately
rather than settled as a side effect of a migration.

**3. Their library would appear to empty itself.** The Swift app writes flat
(`~/Documents/Screepub/Draft.epub`); the new app writes per script
(`~/Documents/Screepub/Draft/Draft.epub`) and does not list or adopt what the
old app left flat. Per-script tuning goes the same way: the engine looks for
`<library>/<stem>/<stem>.screepub.json`, and the old app's copies are flat.
An automatic update would land that on people who did not choose it. A manual
install lands it on people who did, on a day they are paying attention.

**4. Six features would disappear under them**: the updater, Apple Books,
Send-to-Kindle, email-to-Kindle, save-a-copy, and Cancel during conversion.
Gate 2 requires each to be ported or named in the release notes. Naming them
works much better when the user chose to install.

## What would flip this

Not hypothetical, and worth stating so a later session does not relitigate it
from scratch. Taking the identifier becomes the better option when **all** of:

- The macOS Tauri bundle is universal. `lipo` on the two sidecars and
  `--target universal-apple-darwin`; buildable on the macOS runner even
  though it was not buildable where E2 measured
- The new app adopts a flat library on first run, so nothing appears lost
- The updater question in `docs/retired-coverage.md` is answered, and if the
  answer is "no updater", the final Swift release says so in words before the
  swap rather than after

The first is the expensive one and it is real work, not a flag.

## Consequences

- F2 gains a required artifact: a final Swift release whose only change
  disables the update check. This is a promotion of F2's existing fallback to
  its primary path, on the evidence above.
- `UpdateCheck.swift`'s `first(where: .dmg)` should be pinned to the exact
  name `Screepub-macOS.dmg` in that same release, so the frozen app's
  behaviour is intentional rather than dependent on upload order for as long
  as it keeps running.
- The library-adoption migration that D21 noted as "a migration nobody had
  scoped" is **not** required by this decision, because a hand-installing user
  can be told. It remains worth doing and is now the main thing standing
  between this decision and the alternative.
- Gate 3 is unchanged: the cask still has to point at something real before
  any of this ships.
- Nothing here affects an installed Swift app's ability to keep converting.
  It is signed, notarized and on the user's disk, and it keeps working.
