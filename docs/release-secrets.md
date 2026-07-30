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

Green job → a GitHub Release with `Screepub-macOS.dmg` + `screepub-macOS`
attached. Delete the test tag/release afterward if you like:

```bash
gh release delete v0.0.2-rc --yes && git push --delete origin v0.0.2-rc
```

Then do the real acceptance test: download the DMG on a **different Mac**,
open it, drag to Applications, double-click, and convert a PDF — that's
what confirms notarization + the sidecar entitlements are correct.

## After the next tag: flip the Homebrew formula to per-arch

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
