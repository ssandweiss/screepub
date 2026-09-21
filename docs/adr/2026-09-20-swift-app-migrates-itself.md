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

**3. "Their library would appear to empty itself." NOT resolved, and this ADR
owns it.** See the next section.

**4. "Six features would disappear under them." RESOLVED by decision.** Gate 2
is now a parity gate: the updater, Apple Books, Send-to-Kindle,
email-to-Kindle and save-a-copy are all ported, and Cancel during conversion
is named in the release notes as a thing that went away because it would need
a third Rust command and the ADR's rule is that Rust is a window, not a brain.

So the only surviving objection is the library, and the owner's instruction
was explicit: people should not have to install by hand, so build the
migration.

## The one real blocker, and what closes it

The Swift app writes **flat**: `~/Documents/Screepub/Draft.epub`. The new app
writes **per script**: `~/Documents/Screepub/Draft/Draft.epub`. The new app
does not list, adopt or inherit tuning from flat files. So a user who upgrades
automatically opens the app and sees an empty library, with every book still
on disk and every per-script setting silently back at defaults. That is a
worse first impression than being asked to reinstall, which is exactly why the
previous ADR refused.

**F2 therefore ships a first-run adoption pass.** For each flat artifact in
the library root, move it into the per-script folder the new layout expects:

- Recognised artifacts only: `.epub`, `.mobi`, `.kfx`, `.azw3`, `.fountain`,
  and `<stem>.screepub.json`. Anything else in that folder is the user's and
  is left alone.
- Group by stem. `Draft.epub`, `Draft.mobi` and `Draft.screepub.json` all move
  into `Draft/`, which is what `libraryOutput()` in `src/library.ts` already
  computes from `scriptFolder(source, root)` plus `stemOf(source)`.
- **Never write into a folder that already exists.** If `Draft/` is there, the
  new app made it and its copy wins; the flat files stay where they are rather
  than being merged or overwritten.
- No `source.json` is invented. The new app writes one when it converts; an
  adopted book simply lacks it until then, which is the honest state and not
  an error.
- Report what moved, the same way `spacingRepairs` reports: a count the app
  can show, because moving a user's files silently is the sibling of rewriting
  their text silently.

Reversibility matters more than tidiness here. A move within one folder is
recoverable by hand; a merge or an overwrite is not.

## What the migration is NOT allowed to do

Not delete anything, ever, including the Swift app itself. An installed
`Screepub.app` that has been replaced in place is gone by the updater's own
swap, and that is the updater's business, not ours.

Not touch files outside `~/Documents/Screepub` (or `$SCREEPUB_LIBRARY`).

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
5. The first-run adoption pass above.
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
