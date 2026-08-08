# Release secrets

The `release` workflow (`.github/workflows/release.yml`) needs these repo
**Actions secrets** — GitHub → repo **Settings → Secrets and variables →
Actions → New repository secret**. Instructions only; never commit the values.

The signing identity is **Clockwork Post Production LLC** (the Apple
Developer account). Until every secret below exists, the release job fails
loudly and normal CI is unaffected.

## 1. Developer ID Application certificate

You need a **Developer ID Application** certificate (not "Apple
Development"). If you don't have one yet: Xcode → Settings → Accounts →
your team → Manage Certificates → **+** → Developer ID Application. Then in
**Keychain Access**, find "Developer ID Application: Clockwork Post
Production LLC …", right-click → **Export** → save a `.p12` and set an
export password.

```bash
base64 -i Certificates.p12 | pbcopy    # paste as DEVELOPER_ID_CERT_P12_BASE64
```

- **`DEVELOPER_ID_CERT_P12_BASE64`** — the base64 blob copied above
- **`CERT_PASSWORD`** — the password you set when exporting the `.p12`
- **`KEYCHAIN_PASSWORD`** — any strong random string (CI's throwaway keychain);
  generate one with `openssl rand -base64 24`

## 2. App Store Connect API key (for notarization)

[App Store Connect](https://appstoreconnect.apple.com) → **Users and
Access → Integrations → App Store Connect API** → generate a key with the
**Developer** role. Download the `.p8` (offered **once** — keep it safe).

```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy    # paste as AC_API_KEY_P8_BASE64
```

- **`AC_API_KEY_P8_BASE64`** — the base64 blob copied above
- **`AC_API_KEY_ID`** — the key ID (the `XXXXXXXXXX` in the filename)
- **`AC_API_ISSUER_ID`** — the Issuer ID shown at the top of that page

## 3. `TAP_TOKEN` — OPTIONAL, and the only one whose absence is not fatal

Without it the release still succeeds; the `tap` job just says so and
exits clean, leaving the crib sheet in the run summary and the tap to be
bumped by hand. With it, the tap bumps itself on every non-prerelease tag.

GitHub → **Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token**:

- **Resource owner:** `ssandweiss`
- **Repository access:** *Only select repositories* → **`ssandweiss/homebrew-tap`**
- **Permissions:** Repository permissions → **Contents: Read and write**.
  Nothing else. That is the entire blast radius: it cannot touch this repo.
- **Expiration:** a fine-grained token cannot be non-expiring beyond a year.
  When it lapses, the `tap` job starts reporting "TAP_TOKEN is not set" and
  `tap-freshness` goes red at the next release. That is a visible,
  self-correcting failure, not a silent one.

Paste as **`TAP_TOKEN`**.

## Sanity check

**Updated 2026-07-31: a throwaway tag no longer works here.** Both the
`require-release-notes` hook and the `checks` job now require a
committed `docs/releases/<version>.md` for whatever version the tag
names, and nothing is committed for a one-off smoke-test tag like
`v0.0.2-rc`. Rather than writing throwaway notes for a throwaway
version, use `release.yml`'s `workflow_dispatch` trigger (see its
"Re-run entry point" comment) to run the SAME workflow again against a
tag that already has real notes — the most recent real release tag,
e.g. `v0.4.2`:

```bash
gh workflow run release.yml --ref v0.4.2
gh run watch --exit-status
```

Green job → the existing GitHub Release for that tag gets its three
assets re-uploaded (`Screepub-macOS.dmg`, universal, plus
`screepub-cli-macos-arm64.tar.gz` and `screepub-cli-macos-x64.tar.gz`):
the publish step is idempotent (`gh release upload --clobber`), so this
rebuilds and re-notarizes the real release rather than minting a fake
one. Nothing to delete afterward.

Then do the real acceptance test: download the DMG on a **different Mac**,
open it, drag to Applications, double-click, and convert a PDF — that's
what confirms notarization + the sidecar entitlements are correct.

## The Homebrew tap: flipped to per-arch, DONE 2026-08-07 at v0.5.2

**Status: done and pushed** (`ssandweiss/homebrew-tap@a2034f3`). The
section below is kept for the reasoning; the paste-ready block in it was
WRONG and the correction is recorded at the end. The tap installs
`v0.5.2` on both architectures, verified with `brew style` and
`brew audit --strict` on the formula and the cask, and with all three
SHA-256s checked against the digests GitHub reports for the release
assets rather than against the release prose that quotes them.

**Why it went stale for FIVE releases, and the real lesson:** the
per-arch flip was written and locally verified at v0.4.2, and this file
recorded it as done. It was never committed. `homebrew-tap/` is a
separate repo checked out inside this one and hidden from `git status`
by `.git/info/exclude`, which is local-only, so an uncommitted change in
it looks exactly like no change at all. Every `brew install` from v0.3.0
through v0.5.2 therefore served **0.3.0**, from a single
`screepub-macOS` asset the release workflow had long since stopped
producing.

So the failure was not "the files never got edited." They were edited,
and the edit was verified by a real `brew install`. The failure was that
nothing outside one laptop could see whether that edit had ever shipped,
and this file was written from the working tree instead of from the
remote. Check the PUBLISHED state, never the local one.

### The original note (reasoning still correct)


The release now ships the CLI as `screepub-cli-macos-{arm64,x64}.tar.gz`
(~25MB each) instead of one raw 133MB universal binary — bun embeds its
runtime per slice, so universal doubled every download for no benefit. The
DMG stays universal on purpose: a browser can't detect the visitor's CPU,
and Homebrew can.

Once a tag has produced those assets, replace the formula's single
`url`/`sha256` with:

```ruby
  on_arm do
    url "https://github.com/ssandweiss/screepub/releases/download/v#{version}/screepub-cli-macos-arm64.tar.gz"
    sha256 "ARM64_TARBALL_SHA"
  end
  on_intel do
    url "https://github.com/ssandweiss/screepub/releases/download/v#{version}/screepub-cli-macos-x64.tar.gz"
    sha256 "X64_TARBALL_SHA"
  end
```

and change `bin.install "screepub-macOS" => "screepub"` to
`bin.install "screepub"` — the binary inside the tarballs is already
named plain `screepub`. Do NOT push this before the assets exist; the
0.3.0 formula keeps working until then.

### Correction: the block above does not pass `brew style`

Two things the block got wrong, both caught by Homebrew itself:

1. **`on_arm do url ... end` is CASK syntax.** In a formula, `brew style`
   rejects `url` and `sha256` inside `on_arm`/`on_intel`
   (`FormulaAudit/ComponentsOrder`). Formulae use a plain conditional:

   ```ruby
   if Hardware::CPU.arm?
     url ".../v0.4.2/screepub-cli-macos-arm64.tar.gz"
     sha256 "..."
   else
     url ".../v0.4.2/screepub-cli-macos-x64.tar.gz"
     sha256 "..."
   end
   ```

2. **No `version` stanza, and no `#{version}` in the urls.** Homebrew
   scans the version out of the `v0.4.2` in the url path, so an explicit
   `version` audits as "redundant with version scanned from URL". But
   dropping it while keeping `#{version}` in the url is circular. So the
   tag is written LITERALLY in both urls, and a bump edits both.

See `homebrew-tap/Formula/screepub.rb` for the working form.

### Bumping the tap by hand

Three SHAs are needed. `app/release.sh` already computes all three at
release time (it prints them to stdout, where nothing catches them — see
the automation note below). To get them after the fact:

```bash
gh release download vX.Y.Z --dir /tmp/tap && shasum -a 256 /tmp/tap/*
```

Then edit `homebrew-tap/Formula/screepub.rb` (two urls, two SHAs) and
`homebrew-tap/Casks/screepub.rb` (version, DMG SHA), and verify before
pushing:

```bash
brew style Formula/screepub.rb Casks/screepub.rb
brew audit --strict --formula ssandweiss/tap/screepub
brew audit --strict --cask ssandweiss/tap/screepub
```

Note `brew audit` reads the TAPPED clone at
`$(brew --repository ssandweiss/tap)`, not this checkout, so copy the
files there to test and `git checkout --` them afterward to leave that
clone pristine for `brew update`.

### Keeping it from going stale again

All three pieces LANDED 2026-08-07. Two do the work, one keeps them
honest:

- **The bumper: `release.yml`'s `tap` job, running `tools/bump-tap.sh`.**
  `needs: release`, so it cannot start before the assets exist. It clones
  the tap, rewrites the cask's version and DMG SHA and the formula's two
  urls and two SHAs, runs `brew style`, and commits. Checksums come from
  the digests GitHub reports per asset, so nothing is downloaded and
  nothing is re-hashed. Prereleases are skipped: a hyphen in the tag must
  never become what `brew install` hands out.

  Needs `TAP_TOKEN` (§3 above). **Without it the job does not fail the
  release** — it says so and exits clean, leaving the crib sheet and the
  manual path intact.

- **The floor: `release.yml`'s "Tap bump crib sheet" step**, writing the
  version and all three SHAs into `$GITHUB_STEP_SUMMARY`. This is the
  fallback for a missing token or a failed bump, so the hand edit is
  paste-and-commit rather than a download-and-hash chore.

- **The alarm: `.github/workflows/tap-freshness.yml`, running
  `tools/check-tap.sh`.** Weekly, on `workflow_dispatch`, and on every
  published release. It reads the tap's cask and formula STRAIGHT FROM
  GITHUB and fails when either pins something other than the newest
  release, or carries a SHA that does not match that release's assets. No
  secret needed, both repos being public.

  Keep it even though the bumper exists. The bumper can be skipped, and a
  bumper that silently no-ops is precisely the failure that hid five
  releases. On a release trigger it retries for ten minutes, because it
  races the bumper; on the weekly run it checks once, because a stale tap
  will not fix itself while it waits.

**Why the logic lives in `tools/*.sh` and not inline in the YAML:** these
are the steps that have already failed silently once. Inline, they can
only be tested by cutting a release. As scripts they can be run against
the real repos, which is how `bump-tap.sh` was checked for the properties
that matter: bumping to the version the tap already serves produces an
EMPTY diff, bumping a tap that is a version behind restores it
byte-for-byte, a restructured tap fails loudly instead of no-opping, and
a tag with no release fails before touching anything. That last one found
a real bug: `gh api` prints its 404 body on **stdout**, so an emptiness
check accepted `{"message":"Not Found"...}` as a checksum. Both scripts
now check the SHAPE of a digest, not merely that something came back.
