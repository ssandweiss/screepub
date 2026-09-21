# Plan: hand macOS over from the Swift app to the Tauri app

Decision: [ADR 2026-09-20](../../adr/2026-09-20-swift-app-migrates-itself.md).
Stage: piece F's **F2**, per
[the retirement spec](../specs/2026-09-14-retire-swiftui-design.md).

## The shape: two releases, not one

Four things must be simultaneously correct for an existing Swift install to
upgrade itself: the bundle identifier, a universal artifact, a valid
Developer ID signature, and that artifact being the first `.dmg` on the
release. Get any one wrong and a working app is replaced by one that will
not launch, or updates fail silently forever.

One of those four — **signing — has never executed**. Not once. Those secrets
only reach a tagged release, and no tag has ever built a Tauri app: `v0.5.4`
shipped two CLI tarballs and `Screepub-macOS.dmg`, nothing else.

So it splits. **v0.6.0 proves signing while the identifier still differs**, so
the old updater correctly refuses the download and nobody's app is touched.
**v0.6.1 takes the identifier**, once signing is a fact rather than a hope.

That turns one release where four things must be right at once into two where
each is checkable on its own.

## Preconditions already met

- Gate 1b passed 2026-09-20: a person mounted the DMG, installed to
  `/Applications`, launched it and converted real scripts.
- The universal build works locally: `bun tools/build-sidecar.ts --universal`
  then `--arch universal`. Shell and sidecar both report `x86_64 arm64`, the
  engine runs out of the bundle, 57 MB DMG.
- `detectBinaryFormat` refuses a fat file that is secretly one slice, so a
  thin binary cannot ship inside something labelled universal.
- The Kindle cue verdict is in, so the renderer is not an open question.

## v0.6.0 — prove the machinery, touch no user

**1. CI builds ONE universal Mac bundle, not two per-arch.**
`.github/workflows/release.yml`'s `app-bundles` matrix currently has two
macOS rows, `aarch64-apple-darwin` and `x86_64-apple-darwin`. Replace them
with a single `arch: universal`, `target: universal-apple-darwin` row. The
runner needs `rustup target add x86_64-apple-darwin` (aarch64 is the host)
and the sidecar step becomes `--universal`, which lipos both slices.
Everything downstream already understands it: `--arch universal` implies the
cargo target, and the released name is `Screepub-Desktop-macOS-universal.dmg`.

**2. Bump `package.json` to 0.6.0.** `tauri.conf.json` and `Cargo.toml`
already say it; the three-version check blocks the build until all three
agree. This is the check working, not an obstacle.

**3. Tag, then VERIFY SIGNING ON THE ARTIFACT, not in the log.** Download the
published DMG and run, against both the DMG and the `.app` inside it:

    codesign -dv --verbose=4 <path>
    codesign --verify --deep --strict --test-requirement \
      '=anchor apple generic and certificate leaf[subject.OU] = "XSRB3D643J"' <path>
    spctl -a -t open --context context:primary-signature -v <dmg>

A green workflow is not the same fact as a signature that satisfies the
requirement the frozen updater pins. If this fails, stop: v0.6.1 cannot
proceed and the failure is cheap here because nothing is being replaced.

**4. Observe the refusal.** With both apps installed, open the Swift app and
Check for Updates. Expected: it finds the newer release, downloads, and
fails the identifier pin. This is `docs/mac-qa.md` §5 and it has never been
watched. If it OFFERS the Tauri build, stop and find out why — the pin is
supposed to make that impossible.

**5. Do not touch the download references.** The Swift app is still the
supported Mac download at 0.6.0.

## v0.6.1 — the handover

**6. Identifier → `com.darkwell.screepub`** in
`desktop/src-tauri/tauri.conf.json`.

**7. Invert the tripwire.** `tests/desktop-shell.test.ts:372` asserts the
identifier is `.desktop` and explicitly *not* the Swift one. It encodes the
coexistence rule, so it must fail loudly and be changed deliberately, comment
rewritten to say the apps now share an identity on purpose.

**8. Stop publishing `Screepub-macOS.dmg`.** `app/release.sh` comes out of
`release.yml`. This also settles "the universal DMG must be the first `.dmg`
asset" by making it the only one, which is better than relying on upload
order. The LAST Swift release is 0.6.0 and its notes say so.

**9. Drop the transition overlay.** `tauri.transition.conf.json` renames the
app "Screepub Desktop"; at handover it becomes "Screepub". The spec warns
this is ten edits, not one file — a workflow and nine tests pin it.

**10. Gate 3: point the downloads at the new artifact.** `README.md` (two
places, including the badge link) and `site/index.html`. Gate 3 is satisfied
by the releases page and the site, not by a cask.

**11. Retire the cask, keep the formula.** Deprecate `Casks/screepub.rb` so
`brew` tells people rather than silently serving an app that no longer ships,
retire the cask half of `tap-freshness.yml` while the formula half stays, and
drop the cask digests from `tools/bump-tap.sh`. `homebrew-tap/` is a separate
repo hidden from `git status` by `.git/info/exclude`: commit there
deliberately and verify against the PUBLISHED file, because that invisibility
is how five releases came to serve 0.3.0.

**12. Release notes owe two disclosures.** Cancel during conversion is gone
(gate 2 named it rather than porting it). And the hard break: anyone who
tuned a script in the Swift app loses that tuning once, books untouched.

**13. Verify the upgrade on a real install.** Keep a 0.5.4 Swift app around,
Check for Updates, confirm it downloads, verifies, swaps and relaunches into
the Tauri app. This is the whole point of the plan and the only test that
matters.

## What is deliberately NOT here

No migration. The hard break is accepted; see the ADR.

Windows gate 1c is deferred indefinitely, so "cross-platform" either waits or
the release says macOS and Linux and means it.

`app/` is not deleted. That is F3, after F2 has been live through a release
cycle.

## The risk, named

Between step 6 and step 13 there is a window where a mistake replaces a
working app with a broken one on someone else's Mac. Everything in v0.6.0
exists to shrink that window to a single variable: the identifier. Do not
bundle other changes into v0.6.1.
