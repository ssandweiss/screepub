# ADR: the window gets doors, not commands; and the updater comes first

Date: 2026-09-21 · Status: accepted (user-approved)
Refines: [ADR 2026-09-12](2026-09-12-cross-platform-tauri.md)'s governing rule
Amends: [the handover plan](../superpowers/plans/2026-09-20-swift-to-tauri-handover.md)'s v0.6.1
Follows from: [the parity audit](../parity-audit.md)

## Two decisions

**1. The OS-launch shims are built by GRANTING PERMISSIONS, not by adding
Rust commands.** `desktop/src-tauri/capabilities/default.json` gains the
narrow `opener` and `dialog` (save) permissions. The shell keeps exactly
two commands, `run_engine` and `pick_file`.

**2. The automatic handover does not happen until the new app can update
itself.** v0.6.1 takes the bundle identifier only after the updater
exists. The other missing features may follow afterwards.

## Why permissions rather than commands

The ADR's governing rule is that **Rust is a window, not a brain**, and it
was enforced as recently as 2026-09-21, when Cancel was refused because a
kill handle meant a third Rust command.

A permission is a different kind of thing from a command, and the
distinction is the whole basis of this decision. A command is code this
project writes and maintains, and code is where decisions hide: a
`send_to_route` command would have to know which route, in what order,
with what fallback, and that is a brain. A permission is a line in a
manifest saying the window may ask the OS to open a link or show a save
box. It adds a door. It adds no judgement, no branching and no lines of
Rust.

So the rule survives literally: the shell still registers two commands,
and "Rust is a window" stays true in the strongest available sense, which
is that there is almost no Rust.

What this buys, and it is six of the nine gaps the audit found: Apple
Books, Send-to-Kindle, email-to-Kindle, save-a-copy, Report a Bug, and
Show in Finder.

**What it does NOT license.** Any future permission is this same
decision again, made deliberately, with the same test: does the window
gain a door, or does it gain an opinion? `shell:execute` in particular is
not covered here. It is the ability to run arbitrary programs, which is
a brain wearing a permission's clothes, and the engine is already the
only thing allowed to be spawned.

## Why the updater comes first

The [migration ADR](2026-09-20-swift-app-migrates-itself.md) accepted the
automatic handover by knocking down four objections. The second was "the
payload would remove the updater", and its resolution reads:

> **RESOLVED by decision.** The owner chose a full ported self-update
> rather than notify-only or nothing … The new app will have an updater,
> so the upgrade no longer ends the user's ability to receive upgrades.

Resolved by a decision to port. **The port did not happen.** The parity
audit found the updater at zero lines in the Tauri app on 2026-09-21,
five weeks of documents later.

So v0.6.1, as planned, would do the exact thing objection 2 says must not
be done, and it would do it through a **one-way door**: once a user is
moved onto an app that cannot update itself, no future release can reach
them, because the app that would have carried the fix is the one being
replaced. The only remaining route is asking them to download something
by hand, which is what the automatic upgrade exists to avoid.

This is not a parity preference. It is the migration ADR's own stated
precondition, unmet, and the decision here is only to stop treating it as
met.

**The other eight gaps are different in kind and may follow.** Apple
Books, Send-to-Kindle, email, save-a-copy, Show in Finder, feedback, the
KFX install surface and the gear are all things a later update can
deliver, PROVIDED the user can receive a later update. That proviso is
the whole of decision 2.

## Consequences

- v0.6.1 is blocked on one piece, and that piece is the largest single
  item in the retirement: 85 of the 171 unreplaced checks.
- `app/` keeps being maintained for longer, which is a real cost and is
  accepted. F3 was already blocked by the audit.
- The updater needs a design decision before it can be planned, and this
  ADR does not make it: **Tauri's updater plugin, or a port of
  `UpdateInstall.swift`'s behaviour?** The plugin is cross-platform and
  wants a key pair and a published update manifest, which is a new
  secret and a new artifact. The port keeps the frozen app's
  codesign-pinning behaviour, which is the thing `docs/retired-coverage.md`
  says must survive "whatever shape" the updater takes, but an in-place
  bundle swap is native work on each platform. That question is the
  first thing the updater's own spec has to answer.
- Nothing here changes v0.6.0, which shipped and is verified.
