# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/ssandweiss/screepub/security/advisories/new).
That opens a draft advisory only you and the maintainer can see.

Please include the macOS version, the Screepub version (Screepub → About,
or `screepub --version`), and — if a specific file triggers it — how to
build a PDF that reproduces the problem. **Don't attach a confidential
script.** If a real one is the only reproducer, say so and we'll work out
a way to narrow it down without you sending it.

Expect an acknowledgement within a week. Fixes ship in a normal tagged
release, and you'll be credited in the release notes unless you'd rather
not be.

## What's in scope

The interesting attack surface is **the PDF parser**, because that's the
one place Screepub handles a file it didn't create. A screenplay arrives
from a producer, an agency, or a stranger, and Screepub opens it.

- **Malicious PDF → code execution, or reading/writing files outside the
  output path.** This is the one that matters most.
- **Malicious PDF → the engine hanging or exhausting memory** on a file a
  reasonable person would call small.
- **Anything that causes a script to leave the machine.** The engine makes
  no network requests at all; a way to make it do so is a real finding.
- **Sandbox or entitlement weaknesses.** The engine sidecar is signed with
  JIT entitlements because Bun needs them
  (`app/screepub-engine.entitlements`). If those are exploitable beyond
  what Bun requires, we want to know.

## What's out of scope

- Bugs in [Calibre](https://calibre-ebook.com), which is optional, and
  which Screepub invokes only if you installed it yourself. Report those
  upstream.
- What Amazon does with a document after you email it to your `@kindle.com`
  address. That's between you and Amazon.
- Vulnerabilities in a dependency with no path to exploitation through
  Screepub — though if you're unsure whether a path exists, ask.
- A PDF that converts badly, produces garbled output, or crashes on
  malformed-but-harmless input. Those are ordinary bugs; please
  [open an issue](https://github.com/ssandweiss/screepub/issues/new/choose).

## Supported versions

The latest tagged release, only. Screepub is a small project maintained by
one person — there are no long-term support branches.
