# QA on a Mac — the gate nothing else can pass

This is the checklist for **gate 1** of retiring the SwiftUI app: someone
mounts the new Mac build, opens it, and converts a script. Until that
happens, `app/` does not get deleted.

Everything in the Tauri app has been exercised on Linux, where it builds,
launches and converts. As of 2026-09-14 CI has also built it on macOS for the
first time: run 34876329117 compiled the shell on `macos-15`, produced
`Screepub_0.6.0_aarch64.dmg`, opened it without installing, and ran the engine
out of it.

**That is a build, not a person.** Nobody has mounted that DMG, cleared
Gatekeeper, seen the window, or converted a script on a Mac — which is the
whole reason this page exists.

You are not looking for polish. You are answering one question: **does it
work at all on a Mac, and does it lie about anything.**

---

## Before you start

```bash
cd ~/Projects/personal/screepub   # or wherever it lives on the Mac
git pull                          # main moved a long way; this is the whole program
bun install
bun test                          # expect 1445 pass / 3 skip / 0 fail
```

If `bun test` is not green on the Mac, stop and tell me — the suite has only
ever been run on Linux, and a macOS-only failure is itself a finding.

---

## Gate 1b is PASSED as of 2026-09-14

The universal DMG was mounted, dragged to `/Applications`, launched from
there, and used to convert two real feature scripts. §2 and §3 below are
answered. What is still open on this page is §4 (check nothing landed beside
the PDF), §5 (both apps installed, and the updater), and §6 (send to a
reader) — plus gate 1c, which needs a Windows machine.

## Already answered, 2026-09-14 — do not redo these

A session on a Mac got this far, so the checklist below is shorter than it
looks. What is confirmed:

- **A local build works.** `bun tools/build-sidecar.ts --host` then, from
  `desktop/src-tauri`, `cargo run` builds and launches in ~82s (the Tauri CLI
  is NOT needed for the dev loop). `cargo tauri build --bundles app,dmg
  --config tauri.transition.conf.json` produced `Screepub Desktop.app` and a
  28 MB `Screepub Desktop_0.6.0_aarch64.dmg`.
- **It is adhoc/linker-signed, i.e. unsigned** — exactly as §1 predicts for a
  non-tagged build. Not a defect.
- **The window opens and shows `ENGINE 0.5.4`.** The sidecar-resolution
  failure §2 calls the most likely macOS-specific problem did not occur.
- **The numbers agree with the CLI.** The engine *inside the bundle* returns
  byte-identical JSON to `bun src/cli.ts` on three real scripts (only
  `epubPath`/`fountainPath` differ, by construction). And
  `desktop/ui/convert.js` reads `answer.pages`/`scenes`/`characters` straight
  off the engine JSON behind `Number.isFinite` guards, so the surface omits a
  clause rather than inventing one. **§3 is now answered too**: two real scripts were converted through the app
  on 2026-09-14, and the app's `.fountain` for one of them is byte-for-byte
  identical to a fresh CLI run over the same PDF.
- **§5's updater question is settled from source.** `UpdateInstall.swift`
  pins `identifier "com.darkwell.screepub"` exactly and the Tauri app is
  `com.darkwell.screepub.desktop`, so the refusal is structural, not
  probable. But it is a *late, repeating* refusal, and the hazard is dormant
  only because `release.yml` uploads the Swift DMG first. See
  [ADR 2026-09-14](adr/2026-09-14-swift-app-update-path.md), which changes
  what F2 should ship. Observing the refusal on the running app is still
  worth doing; predicting it is no longer necessary.

Note for whoever drives this: an unbundled `cargo run` binary claims no
bundle identifier, so screenshot tooling cannot find its window. Build the
`.app` if you need to capture it.

## 1. Get a DMG, and know whether it is signed

Look at the newest `desktop` workflow run:

```bash
gh run list --workflow=desktop.yml --limit 5
gh run view <id> --log | grep -iE 'signing|notariz|codesign|bundling'
```

**What matters now is signing, not bundling** — bundling is settled, CI did it.
The signing and notarization path was written by reading `tauri-bundler`'s
source and has still never executed, because those secrets only reach a
tagged release. So expect the push-triggered runs to produce an **unsigned**
DMG: Gatekeeper will object, and that is the expected state today, not a
defect. The signed path is first exercised by cutting `v0.6.0`.

To get an actual DMG in your hands you need a tagged release (`v0.6.0`), or
you can build one locally:

```bash
cargo install tauri-cli --version 2.11.4    # if you do not have it
bun tools/build-sidecar.ts --host
cd desktop/src-tauri
cargo tauri build --bundles app,dmg --config tauri.transition.conf.json
```

The `--config` overlay is what renames it to **Screepub Desktop** so it
cannot collide with your installed `Screepub.app`. **Do not build without
it** during the transition.

---

## 2. Does it open

Mount the DMG, drag to Applications, open it.

- **Gatekeeper.** If it is signed and notarized, it should open with no
  warning. If it warns, note the exact wording — right-click → Open is the
  workaround, and whether that is needed tells us whether notarization
  actually worked.
- **Does a window appear at all.** On Linux the window maps with the Convert
  page rendered and `ENGINE 0.5.4` in the bottom corner. That version stamp is
  the shell proving it found and spawned its sidecar engine. **If you see the
  window but no engine version, the sidecar is not being found** — that is the
  single most likely macOS-specific failure, because the sidecar is resolved
  by a platform-specific path.

---

## 3. Convert a real script

Drop one of your own scripts on the drop well — a real one, not the test
fixture. Watch for:

- The progress bar moves and the read-out names a stage.
- The result names the title, page count, scene count and speaking characters.
- **Check those numbers.** Run the same file through the CLI and compare:
  ```bash
  bun src/cli.ts ~/path/to/script.pdf --json -o /tmp/qa.epub
  ```
  They must agree exactly. A window showing plausible invented numbers would
  pass a screenshot and fail this.

Then open **Read**. The script should keep its shape — sluglines in caps,
character cues centred over indented dialogue, transitions ranged right. The
window renders the engine's own preview, so if this looks wrong the engine and
the app disagree, which is worth knowing.

---

## 4. Where your files went, and this one matters

**Your books now live in `~/Documents/Screepub`, and the two apps use it
differently:**

- The SwiftUI app writes **flat**: `~/Documents/Screepub/Draft.epub`
- The new app writes **one folder per script**:
  `~/Documents/Screepub/Draft/Draft.epub`

They coexist without collision — the new app never writes into a folder it
did not create. But **the new app does not list, reuse, or inherit tuning
from books the old app left flat there.** If you have tuned settings on an
existing script, the new app will not see them; it starts from defaults.

Check: after converting, confirm nothing new appeared beside the PDF you
dropped. Everything should be in the library.

---

## 5. Both apps installed at once

This is the transition case and nobody has tried it.

- Confirm `Screepub.app` and `Screepub Desktop.app` are both in Applications
  and both launch.
- **Watch the old app's updater.** It checks the releases page, which will now
  have Tauri DMGs on it. Its code-signing identifier pin *should* refuse them.
  If the old app ever offers to update you to a Tauri build, **stop and tell
  me** — that is the one genuinely dangerous interaction in this transition,
  and the refusal has only been reasoned about, never observed.

---

## 6. Try to send to a reader

Plug in your Kindle. Open **Send**.

Every row currently says *never run on real hardware* — that is honest, not
broken. The only device transfer anyone has ever done was a Kindle over USB
from a Mac, and that was the **old** app.

So this step is the most valuable thing you can do: press Send and see what
happens. Whether it works or fails, it is the first real hardware evidence
this app has ever had. If the file lands, check it opens on the device and
that the format is what you expected (KFX if you have the Calibre toolchain,
AZW3 otherwise, MOBI as the floor).

---

## What to report back

Short is fine. The three things I most want to know:

1. **Did the window open, and did it show an engine version.**
2. **Did the numbers match the CLI.**
3. **Anything the app told you that was not true.** That is the failure mode
   this project cares most about, and it is the one I am least able to check
   from here.

Everything else — rough edges, wording, layout at odd window sizes — is worth
noting but is not what gate 1 is asking.

---

## Two decisions that do not need a Mac

Separately from the QA, `docs/retired-coverage.md` has ten recommendations
waiting on you. One question decides 59 of the 171 unported checks:

**Does the app ever tell a user a newer version exists?**

The new app has no updater. The old one does, and 59 assertions cover it. If
the answer is yes, it gets ported before `app/` is deleted. If no, that is a
capability the Mac app has and the new one will not — worth deciding
deliberately rather than by omission.

The second: which of **Apple Books, Send-to-Kindle, mail, save-a-copy, and
Cancel during conversion** come back. The new app has none of them.
