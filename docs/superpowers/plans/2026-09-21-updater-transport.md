# Plan: the updater's transport half

Piece A of [the parity plan](2026-09-21-parity.md), second half. The
first half, the judgement, landed on 2026-09-21: `src/update/compare.ts`,
its generated twin in `desktop/ui/update-compare.js`, and the two CLI
verbs. This plan is the part that moves bytes: the plugin, the release
artifact, the manifest, and the alarm that stops the manifest going stale.

Design: [the updater spec](../specs/2026-09-21-updater-design.md).
Why it blocks v0.6.1: [ADR 2026-09-21](../../adr/2026-09-21-doors-not-commands.md).

## Measured before writing, and what each measurement decided

Everything below was read off `tauri-cli` 2.11.4 and
`tauri-plugin-updater` 2.12.0 source on 2026-09-21, not off a docs page.

1. **The CLI signs updater artifacts itself, and fails without the key.**
   `tauri-cli/src/bundle.rs::sign_updaters` runs whenever
   `bundle.createUpdaterArtifacts` is on, and errors with "A public key
   has been found, but no private key" if `TAURI_SIGNING_PRIVATE_KEY` is
   unset. So the flag CANNOT live in `tauri.conf.json`: every push build in
   `desktop.yml` and every local `cargo tauri build` would fail. It lives
   in an overlay, `desktop/src-tauri/tauri.updater.conf.json`, that only
   the release's macOS leg passes, the same mechanism as the transition
   overlay.
2. **A missing key at a tag is a failure, not a degrade.** The tap job
   degrades when its token is absent because a crib sheet exists. There
   is no crib sheet for an update: the ADR says v0.6.1 waits for the
   updater, so a release that cannot sign one is the thing the ADR
   forbids. The macOS leg errors out by name.
3. **The public key is gated at tag time, not by `bun test`.** The key
   pair does not exist yet (checked 2026-09-21: the repo has six secrets
   and none of them is the signing key). A test that fails until the
   owner acts is a red main for nobody's fault; a `checks`-job gate that
   fails a TAG without a real public key is the ADR in code. `bun test`
   pins the SHAPE: empty is allowed on a working branch, garbage is not.
4. **`--config` is repeatable and merges recursively.** `Vec<ConfigValue>`
   in `build.rs`; `merge_patches` in `helpers/config.rs` descends into
   objects, so `{"bundle": {"createUpdaterArtifacts": true}}` leaves
   `externalBin`, icons and resources alone.
5. **The plugin's platform key is `darwin-<arch>` and a missing key is an
   error, not "no update".** `RemoteRelease::download_url` returns
   `TargetNotFound` when `platforms` lacks the running platform. So a
   universal build needs BOTH `darwin-x86_64` and `darwin-aarch64` in the
   manifest, pointing at the same tarball, and the window must show a
   check() error as a message and never as "up to date".
6. **The macOS install does not relaunch.** `install_inner` swaps the
   bundle and `touch`es it; the plugin's own doc says "you need to
   relaunch the app". A one-click relaunch is `tauri-plugin-process`,
   a second new crate. Not added here: the window tells the user to quit
   and reopen, and the crate is a door the owner can approve separately.
7. **`updater:default` has no scope to write.** The plugin's permission
   set is check, download, install, download-and-install; there is no
   allow-list. Its scope is the `endpoints` array in `tauri.conf.json`,
   which the plugin cannot exceed, so the test that refuses bare plugin
   grants names this one and pins the endpoint list to exactly one URL
   on this repository.
8. **`currentVersion` is the config version.** The plugin reads it from
   the app's package version, so a Tauri build never carries a
   git-describe suffix the way the Swift app did. The second opinion
   through `pickUpdate` still stands (it refuses unreadable versions and
   an equal version), but the describe defence is now insurance rather
   than the daily case. Said here so nobody goes looking for a bug.
9. **The endpoint is `releases/latest/download/latest.json`.** GitHub
   resolves that to the newest non-prerelease, non-draft release. The
   release job un-drafts BEFORE `app-upload` attaches the manifest, so
   for a few minutes after a tag the endpoint 404s. The window shows the
   error and the daily throttle stamps regardless (same as the Swift
   app), so the next day's check succeeds. Recorded, not fixed: moving
   the un-draft would undo a decision `app-upload`'s own comment records.

## Tasks

Each one lands its failing test first. All of them stay on this branch
until the owner merges; the identifier is NOT touched.

- **T1. The plugin.** `tauri-plugin-updater = "2.12.0"` in `Cargo.toml`
  and its lockfile entry; `.plugin(tauri_plugin_updater::Builder::new().build())`
  in `main.rs`; `updater:default` in `capabilities/default.json`;
  `plugins.updater` in `tauri.conf.json` with the one endpoint and an
  EMPTY `pubkey` for the owner to fill. Tests in `tests/desktop-shell.test.ts`.
- **T2. The overlay and the artifact.** `tauri.updater.conf.json`;
  `tools/build-app-bundle.ts --updater` passes it, then finds
  `<name>.app.tar.gz` and its `.sig`, checks both, and copies them out
  as `Screepub-Desktop-macOS-<arch>.app.tar.gz` (+ `.sig`). Tests in
  `tests/build-app-bundle.test.ts` and `tests/desktop-shell.test.ts`.
- **T3. The manifest.** `tools/build-update-manifest.ts`: from a directory
  of arrivals, every `*.sig` beside its artifact becomes a platform
  entry; the macOS tarball becomes two. Writes `latest.json`. Refuses an
  unreadable signature, a missing artifact, or a manifest with no
  platforms. Tests in `tests/build-update-manifest.test.ts`.
- **T4. The alarm.** `tools/check-latest.ts`: fetch the manifest from the
  exact URL the app uses, compare its version to the newest release, and
  every platform's url and signature to that release's assets. Tests
  with a stubbed fetcher in `tests/check-latest.test.ts`.
- **T5. The workflow.** `release.yml`: the pubkey gate in `checks`; the
  two secrets and `--updater` on the universal leg; `app-upload` builds
  the manifest from what arrived and uploads tarball, signature and
  manifest; a `latest-check` job after it. `tap-freshness.yml` gains the
  weekly run. Tests in `tests/release-artifacts.test.ts` (structure) and
  `tests/release-app-step.test.ts` (the bash, executed).
- **T6. The words.** `docs/release-secrets.md` §4 for the two secrets;
  `desktop/README.md`'s capability note; the coverage ledger's `Built?`
  column for the four update rows; this file's status. The two README
  sentences that go false do so when the WINDOW checks, so they change
  in the window-side commit, and the contract sent to that session
  carries the wording.
- **T7. Proof.** `bun test`, `bunx tsc --noEmit`, and a real
  `cargo tauri build` through `build-app-bundle.ts --updater` with a
  THROWAWAY key generated in the scratchpad, to see the tarball and
  signature land where T2 looks and the manifest tool read them. The
  throwaway key is deleted afterwards and is never the owner's.

## Done when

A tag with the secrets and the public key in place publishes
`Screepub-Desktop-macOS-universal.app.tar.gz`, its `.sig`, and a
`latest.json` naming both darwin platforms, and `latest-check` goes
green against the published files. The window side, which the
interface-pass session builds against the contract, is what makes the
whole of piece A "done".
