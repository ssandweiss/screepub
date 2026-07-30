# KFXKit without Calibre — design

**Status:** proposed, milestone-1 spike PASSED · 2026-07-29
**Goal:** a user installs exactly one thing — Kindle Previewer — and gets
best-quality (KFX / Enhanced Typesetting) sideloading. Calibre and the
plugin-install step disappear from the KFX path.

## Why this is worth doing

The current chain works, but its weakest link is the heaviest: Calibre is
a ~350 MB install whose only role in the KFX path is *hosting a plugin*.
The conversion itself is done by Kindle Previewer (Amazon's binary, the
only KFX writer in existence — irreducible), and the packaging around it
is ~8k lines of the plugin's `kfxlib`. Remove the host and the user story
collapses to: install Previewer, done.

## What is actually happening in the chain

Established empirically 2026-07-29, on-device:

```
EPUB ── Kindle Previewer CLI ──▶ KPF ── kfxlib repack ──▶ .kfx ──▶ Kindle
        ("-convert -locale en          (the ONLY part               renders with
         -output DIR", headless,        Calibre hosts)              Enhanced
         no Amazon sign-in)                                         Typesetting;
                                                                    keeps hold
```

- A **KPF** is a zip: `resources/book.kdf` (SQLite holding Ion-serialized
  fragments), `book.kcb` (JSON), a conversion log. It is an intermediate
  for Amazon's tooling — a Kindle never indexes one (verified: it sat
  invisible in `documents/`).
- The **repack** reads the KDF, normalizes fragments (metadata, cover,
  position/location maps), and serializes KFX containers using Amazon's
  binary Ion with a large known symbol catalog.
- Driving Previewer directly is already understood: KFXKit's short-term
  path proves the CLI contract, and the plugin's
  `generate_kpf_using_cli.py` (241 lines) is the reference.

So "dropping Calibre" means exactly one thing: **running the repack
without Calibre around it.**

## The three architectures

### A — native Swift port of the repack

Translate the repack subset of `kfxlib` to Swift inside KFXKit:
`ion.py`/`ion_binary.py` (1,007), `ion_symbol_table.py` (355),
`yj_symbol_catalog.py` (862, mostly data), `kpf_container.py` (439),
`kfx_container.py` (451), `kpf_book.py` (552), `yj_book.py` (326),
`yj_container.py` (387), `yj_structure.py` (1,318),
`yj_position_location.py` (1,326), `yj_metadata.py` (871), plus a
`utilities.py` subset — **≈ 7,900 lines of Python, realistically 10k+ of
Swift with tests.**

- **Pros:** zero runtime baggage; pure-Swift package; the aesthetic ideal.
- **Cons:**
  - **Format drift is the killer.** Amazon moves: Previewer 3.106 emits
    Ion symbols a 2021 kfxlib rejects outright ("Unexpected Ion symbols
    used: $798, $799, $800" — observed, not hypothetical). jhowell tracks
    this; a port forks away from his maintenance and inherits the
    tracking burden forever.
  - **Licensing:** a port is a derivative work of GPL-3 code. The ported
    module must be GPL-3, and any app linking it is encumbered — KFXKit's
    MIT pitch survives only if the repack lives in a clearly separated,
    optional target. (Fine for Screepub, which is AGPL; costly for the
    "useful to other apps" ambition.)
  - **Known landmine:** the KDF SQLite file is rejected by macOS's
    `sqlite3` CLI ("malformed database schema") while Python's stdlib
    binding reads it. Whatever the cause, a Swift port's SQLite layer
    must reproduce Python-binding behavior, not CLI behavior.

### B — embedded Python runtime, unmodified kfxlib  ← recommended

Ship a minimal CPython (python-build-standalone, ~55 MB unpacked) inside
KFXKit's resource bundle, plus an **unmodified snapshot of kfxlib** and a
~100-line driver script. KFXKit spawns it as a subprocess:

```
KFXKit (Swift) ──▶ Previewer CLI ──▶ KPF
       └──▶ embedded python3 repack.py book.kpf book.kfx ──▶ .kfx
```

Made possible by a fact verified in this repo's vendored copy: **kfxlib
is deliberately calibre-optional.** Its calibre imports are guarded
fallbacks, and the KDF reader uses stdlib `sqlite3`.

**Proven, not assumed — the milestone-1 spike already ran** (2026-07-29):
a plain venv (Python 3.14, no calibre importable) with three PyPI wheels
— `Pillow`, `lxml`, `beautifulsoup4` — plus the plugin-vendored `pypdf`
on `sys.path`, repacked a Previewer-produced KPF via
`YJ_Book(kpf).convert_to_single_kfx()` into a valid KFX container
(`CONT` magic; parses back through kfxlib's own reader with correct
title; `calibre modules loaded: NONE`). Those three wheels are the real
runtime footprint beyond CPython itself — they exist because
`resources.py` and `original_source_epub.py` import at module scope, so
they load even on the repack path.

- **Pros:**
  - Days of work, not weeks: driver script + runtime packaging + signing.
  - **License-clean:** GPL-3 code executed as a separate program is
    aggregation, exactly like the current Calibre arrangement. KFXKit
    stays MIT.
  - **Tracks upstream:** a kfxlib update is a file swap, keeping pace
    with Amazon's format changes at zero porting cost.
  - User-visible result identical to A: install Previewer, nothing else.
- **Cons:**
  - ~55 MB added to the app (against the ~350 MB Calibre it deletes).
  - Embedded CPython in a notarized app means signing every `.so`/dylib
    in the runtime — a known, mechanical pattern (no JIT entitlements
    needed; CPython is an interpreter).
  - A second language runtime in the repo, however contained.

### C — status quo (Calibre hosts the plugin)

Zero effort; already shipped. Remains the fallback tier regardless —
pre-2015 Kindles need AZW3, and AZW3 needs Calibre.

## Recommendation

**B now, A never — unless B's weight is ever unacceptable.** The
dependency the user feels (Calibre + plugin dance) disappears either way;
A additionally buys purity at the price of permanent format-tracking
duty against an adversary who ships quarterly. The Ion-symbol incident is
the whole argument in one line: jhowell fixed it for everyone in 2024;
a Swift port would have been broken alone.

Design the seam so the choice stays open: KFXKit exposes one internal
protocol —

```swift
protocol KPFRepacker {
    func repack(kpf: URL, to kfx: URL) throws
}
```

— with `CalibrePluginRepacker` (today), `EmbeddedPythonRepacker` (B), and
room for `NativeRepacker` (A) if the calculus ever flips. The public
`KFXToolchain.convert()` API does not change.

## Verification strategy

The trap in any repack change is a *subtly* wrong KFX — a file that
opens and renders scrambled, poisoning device tests. Defense in depth:

1. **Golden parity:** same EPUB through the Calibre-plugin path and the
   new path; parse both outputs with jhowell's KFX **Input** code (an
   independent code path) and diff the fragment sets semantically.
   Byte-identity is not expected (timestamps, asset ids); fragment
   equivalence is.
2. **Round-trip:** new-path output must parse cleanly under KFX Input.
3. **Device checklist** (the §8b/§2 list): keeps hold, dialogue margins,
   centered cues, dual-dialogue tables, indexing — on hardware, same-day
   A/B against the plugin-path output.
4. kit-check grows a repacker-parity assertion, environment-gated like
   the existing toolchain checks.

## Risks

| Risk | Mitigation |
| --- | --- |
| Amazon changes KPF/KFX again | B tracks via kfxlib swap; pin the vendored snapshot + record its version |
| Notarization of embedded runtime | Known pattern; sign all Mach-O in the runtime; verify with the existing release pipeline's strict checks |
| python-build-standalone arch coverage | Ships universal-capable builds; both slices verified in CI like the engine's |
| kfxlib silently assumes calibre somewhere in the repack path | Retired — the spike proved the path calibre-free end to end |
| KDF SQLite oddity | B inherits Python-binding behavior for free; documented for A |

## Milestones (B)

1. ~~Spike~~ **done** — see above. The driver script is ~15 lines; wheel
   set is Pillow + lxml + beautifulsoup4 + vendored pypdf.
2. Runtime packaging: python-build-standalone in the resource bundle,
   driver script, `EmbeddedPythonRepacker`.
3. Signing/notarization pass through `release.sh`; verify on a second
   machine.
4. Golden-parity + device checklist; flip the default repacker to B.
5. Settings copy update: "Best Kindle quality" shrinks to one row
   (Kindle Previewer) when B is active; Calibre row remains only for the
   AZW3 fallback tier.

## Out of scope

- Replacing Kindle Previewer. Every KFX on earth is born from Amazon's
  converter; there is nothing to port. If Previewer ever becomes
  unacceptable, the answer is the email/web route, not engineering.
- KFX *reading* (DRM, store books) — nothing here touches it.
- Windows/Linux: Previewer exists on Windows (the plugin drives it via
  Wine on Linux); out of scope until the CLI ships there.
