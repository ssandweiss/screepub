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

## Sanity check

Push a throwaway tag and watch the run:

```bash
git tag v0.0.2-rc && git push origin v0.0.2-rc
```

Green job → a GitHub Release with three assets attached:
`Screepub-macOS.dmg` (universal), plus `screepub-cli-macos-arm64.tar.gz`
and `screepub-cli-macos-x64.tar.gz`. Delete the test tag/release
afterward if you like:

```bash
gh release delete v0.0.2-rc --yes && git push --delete origin v0.0.2-rc
```

Then do the real acceptance test: download the DMG on a **different Mac**,
open it, drag to Applications, double-click, and convert a PDF — that's
what confirms notarization + the sidecar entitlements are correct.

## The Homebrew tap: flipped to per-arch, DONE 2026-07-31 at v0.4.2

**Status: done.** The section below is kept for the reasoning; the
paste-ready block in it was WRONG and the correction is recorded at the
end. The tap now installs `v0.4.2` on both architectures, verified with
`brew style`, `brew audit --strict` on the formula and the cask, and a
real `brew install` that upgraded 0.3.0 to 0.4.2 and ran the binary.

**Why it went stale for three releases:** `homebrew-tap/` is a separate
repo checked out inside this one and hidden from `git status` by
`.git/info/exclude`, which is local-only. Nothing in CI touches it, so a
release could never fail for forgetting it. Flipping the formula was
skipped at v0.4.0, v0.4.1 and v0.4.2 for exactly that reason. The
systemic fix is below under "Keeping it from going stale again".

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

The tap is invisible to every existing gate: it is a different repo, it
is excluded locally, and no release job touches it. Two options, in
ascending order of effort:

- **Floor:** `app/release.sh` already computes all three SHAs and throws
  them at stdout. Capture them into `$GITHUB_STEP_SUMMARY` so the manual
  edit is copy-paste instead of a download-and-hash chore.
- **Real fix:** a `tap` job in `release.yml` that commits the formula and
  cask update to `ssandweiss/homebrew-tap` directly. Needs a seventh
  secret: a fine-grained PAT scoped to `contents:write` on that repo
  only, which would get its own entry in the secrets table above.

Until one of those lands, the tap will keep going stale, because nothing
makes forgetting it visible.
