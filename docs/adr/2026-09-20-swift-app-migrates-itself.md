# ADR: the Swift app migrates itself, after all

Date: 2026-09-20 · Status: accepted (user-approved)
Supersedes: [2026-09-14-swift-app-update-path.md](2026-09-14-swift-app-update-path.md)
Refines: piece F stage F2 in
[specs/2026-09-14-retire-swiftui-design.md](../superpowers/specs/2026-09-14-retire-swiftui-design.md)

## Decision

**At F2 the Tauri app takes the `com.darkwell.screepub` bundle identifier, and
existing Swift installs upgrade themselves through the updater they already
have.** Nobody reinstalls by hand.

Six days ago this ADR's predecessor decided the opposite. It was right on the
evidence it had. Three of its four objections have since been removed, two of
them deliberately and one by work done for another reason entirely.

## Why the previous decision no longer holds

It rejected the automatic path on four grounds. Taking them in order:

**1. "The old updater is architecture-blind, and the Tauri Mac build is not
universal." RESOLVED.** This was the disqualifying one, and it was real: the
frozen updater takes the first `.dmg` asset on a release and has no
architecture logic, so per-arch bundles would have handed roughly half of all
users an app that cannot open. There is now a universal build. `bun
tools/build-sidecar.ts --universal` lipos the two darwin sidecars, `--arch
universal` in `tools/build-app-bundle.ts` implies the universal cargo target,
and `detectBinaryFormat` refuses a fat file that is secretly one slice. The
release is one artifact, so "the first `.dmg`" is unambiguous.

**2. "The payload would remove the updater." RESOLVED by decision.** The owner
chose a full ported self-update rather than notify-only or nothing, which
moved `self-update-installer`'s 26 checks from `accept-loss` to `port` in
`docs/retired-coverage.md`. The new app will have an updater, so the upgrade
no longer ends the user's ability to receive upgrades.

**3. "Their library would appear to empty itself." WRONG AS STATED, and the
real thing is smaller.** See below.

So the only surviving objection is per-script tuning, and the owner's
instruction was explicit: people should not have to install by hand.

## Correction, 2026-09-20: there is no library view

This ADR's first draft, and its predecessor, both said an automatic upgrade
would show the user an empty library. **The owner asked whether there is a
book library at all. There is not.** The app's surfaces are Convert, Read,
Tune, Send and Notes; nothing in `desktop/ui` lists books. `--library` only
tells the engine where to WRITE, so that converting stops littering the folder
the PDF was dragged from. There is no view to be empty, and the claim was
written from an assumption rather than from the code.

**What actually happens is one thing, and it is verified rather than
reasoned.** A script the user had tuned loses its tuning. Measured: a flat
`screenplay.screepub.json` asking for `fontFamily: serif` and
`showSceneNumbers: true`, placed in a library root the way the Swift app
writes them, then converted — the book came out Courier with no scene
numbers, and no settings file was reported. The engine looks beside the input
PDF (`adoptSidecar` in `src/library.ts`) and inside the script's library
folder. A sidecar sitting FLAT in the library root is checked by neither.

Old books sitting flat beside new per-script folders is cosmetic. Nothing
reads them, nothing breaks, nothing is lost.

## No migration at all: a hard break, chosen deliberately

The correction above shrank the migration to one thing, adopting a flat
sidecar. **The owner then dropped even that: a hard break is accepted, and
F2 ships no migration.**

The cost, stated plainly so nobody has to rediscover it: **anyone who tuned a
script in the Swift app loses that tuning, once.** Their books are untouched
and still on disk; the next conversion of a tuned script comes out at the
defaults and they re-tune it if they care. Nothing else changes, because
nothing else read the flat layout.

That is a real cost and it is small, and the thing it buys is real too. The
alternative was a compatibility path in `src/library.ts` that would exist
solely to serve installs of an app being deleted, would need its own tests,
and would have to be carried until someone was brave enough to delete it. A
one-time loss of a handful of knob settings is cheaper than a permanent
branch in the library logic.

This decision is only available because the blast radius is this small. It is
NOT a precedent for breaking the library layout again later: a hard break is
affordable when what breaks is tuning, and would not be if it were books.

## What the migration is NOT allowed to do

Not delete anything, ever, including the Swift app itself. An installed
`Screepub.app` that has been replaced in place is gone by the updater's own
swap, and that is the updater's business, not ours.

Nothing at all, now that the hard break is accepted. This section is kept
because it is the boundary any FUTURE migration inherits: never outside
`~/Documents/Screepub` (or `$SCREEPUB_LIBRARY`), never move or delete a book,
and copy rather than move so an older build still finds what it expects.

Not run on Linux or Windows. There is no flat library there to adopt, because
there was never a Swift app.

## Concrete changes F2 now owns

1. `desktop/src-tauri/tauri.conf.json`: identifier becomes
   `com.darkwell.screepub`.
2. `tests/desktop-shell.test.ts:372` currently asserts the identifier is
   `com.darkwell.screepub.desktop` and explicitly `not` the Swift one. That
   test encodes the coexistence rule and has to be inverted, with its comment
   rewritten to say why — it is the tripwire that stops this happening by
   accident, so it must fail loudly and be changed deliberately.
3. The universal DMG must be the first `.dmg` asset on the release. Upload
   order decides this today; make it explicit.
4. Signing: the app must be Developer ID signed with team `XSRB3D643J`, since
   the frozen updater pins Apple's anchor, the Developer ID chain, that team,
   and now a matching identifier. All four already hold for the release path;
   only the identifier changes.
5. Nothing. There is no migration — see the hard-break section above.
6. `docs/mac-qa.md` §4 and §5 describe two apps coexisting. After F2 they
   describe one app replacing another, which is a different test.

## Consequences

- The previous ADR's "final Swift release disables the update check" is
  **withdrawn**. The update check is now the delivery mechanism, not a hazard.
  Its other recommendation stands and grows in importance: pin
  `UpdateCheck.swift`'s asset picker to an exact filename so the frozen app's
  choice is intentional rather than dependent on upload ordering.
- TCC grants and the preferences domain are keyed to the bundle identifier,
  which now matches, but the code-signing designated requirement changes.
  Removable-volume access for USB transfer is the one to test before shipping
  rather than discover afterwards.
- The window of risk is a single release. Get the identifier, the universal
  artifact, the signature and the asset order right together, or an existing
  user's working app is replaced by one that fails to launch. That is the
  strongest argument for gate 1b having already passed on a real Mac, which it
  has.
- This decision is worth revisiting only if the universal build stops being
  produced. Everything else it rests on is a decision rather than a
  measurement.
