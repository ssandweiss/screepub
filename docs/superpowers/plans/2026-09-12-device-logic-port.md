# Device Logic Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ScreepubKit's core logic from Swift into the TypeScript engine so every platform shares one implementation and one test suite.

**Architecture:** New feature directories `src/device/`, `src/export/`, `src/settings/` mirroring the existing `parser/`, `fountain/`, `epub/`, `mobi/` layout. All device knowledge lives in pure, filesystem-only functions that are testable with temp directories; the single untestable part — enumerating mounted volumes, which depends on what is physically plugged in — is isolated into one small function with injectable roots. Every module's `kit-check` assertions are ported as failing tests *before* its implementation.

**Tech Stack:** TypeScript, Bun (`bun:test`), Node built-ins (`node:fs`, `node:path`, `node:os`, `node:child_process`). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-09-12-device-logic-port-design.md`](../specs/2026-09-12-device-logic-port-design.md)
**Program ADR:** [`docs/adr/2026-09-12-cross-platform-tauri.md`](../../adr/2026-09-12-cross-platform-tauri.md)

## Global Constraints

- **No file under `app/` may be modified.** Piece A is purely additive; the Swift app keeps working untouched. Verify with `git status` before every commit.
- **Port assertions before implementations.** For each module, write the `kit-check` assertions as failing `bun test` cases first. **Never adjust an assertion while porting the thing it exists to catch.** If an assertion looks wrong, stop and raise it.
- **The ported modules are consumed by nothing.** No CLI surface, no change to `convert.ts`, no behavior change for any existing user. Wiring is piece B.
- **Existing suite stays green:** all 606 existing tests pass and `bunx tsc --noEmit` is clean after every task.
- **Calibre-dependent tests self-skip** when `ebook-convert` is absent, matching `kit-check`'s behavior, so CI stays green on bare runners.
- **No test touches a real network or a real mounted volume.** reMarkable tests use a local `Bun.serve` stub; volume enumeration is tested through injected roots.
- Source of truth for the Calibre guard flags, verified on hardware 2026-07-29: `["--page-breaks-before=/", "--chapter-mark=none", "--disable-remove-fake-margins"]`. Change them in one place or not at all.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/replace-file.ts` | `replaceFile(source, destination)` — the remove-then-copy helper both `device/` and `export/` need. Root-level utility, matching `cli-errors.ts`. |
| `src/settings/sidecar.ts` | `<Stem>.screepub.json` per-script overrides beside the `.fountain`. |
| `src/settings/presets.ts` | Named `FormatOptions` bundles per device class, and `matchingPreset`. |
| `src/device/types.ts` | `DeviceKind`, `ConnectedDevice`, display names. |
| `src/device/kindle.ts` | Kindle volume detection, naming, and copy into `documents/`. |
| `src/device/classify.ts` | `classify(volume)` — the pure vendor predicate. |
| `src/device/transfer.ts` | Per-vendor copy destinations. |
| `src/device/volumes.ts` | Per-OS mount enumeration and `mountedDevices()`. |
| `src/device/remarkable.ts` | Fixed USB address, `probe()`, `upload()`. |
| `src/export/freshness.ts` | `needsRegeneration` staleness rule. |
| `src/export/formats.ts` | The Kindle sideload ladder and its labels. |
| `src/export/calibre.ts` | `ebook-convert` discovery, AZW3 and KEPUB recipes. |
| `src/export/kfx.ts` | KFX toolchain discovery and status. |
| `src/export/artifact.ts` | `mobiSibling`, `availableFormats`, `freshKindleArtifact`. |

**Modified:** `src/options.ts` — `resolveFormatOptions` gains an optional base parameter.

**Deliberately deferred to piece C:** `KFXToolchain.installPlugin()`. Installing the vendored 485 KB `KFX_Output_plugin.zip` requires deciding how a `bun build --compile` binary embeds a binary asset — a packaging decision that belongs with the app packaging piece. `export/kfx.ts` ports discovery and status (both read-only) so the ladder can degrade correctly; it does not port installation.

---

### Task 1: `resolveFormatOptions` accepts a base

The sidecar's Swift implementation overlays eighteen optional fields by hand, and its own comment says it is "mirroring the engine's `resolveFormatOptions` merge semantics." Giving `resolveFormatOptions` a base parameter lets the sidecar *be* that function instead of a second copy of it.

**Files:**
- Modify: `src/options.ts` (the `resolveFormatOptions` signature and its `const d`)
- Test: `tests/options.test.ts` (append)

**Interfaces:**
- Produces: `resolveFormatOptions(partial?: Record<string, unknown>, base?: FormatOptions): FormatOptions` — when `base` is omitted it is `DEFAULT_FORMAT_OPTIONS`, so every existing call site is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/options.test.ts`:

```ts
test('resolveFormatOptions merges over a supplied base, not just the defaults', () => {
  const base: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS, keepSpeechesWhole: true, justifyText: true };
  const merged = resolveFormatOptions({ dialogueSideMarginPct: 9 }, base);
  expect(merged.dialogueSideMarginPct).toBe(9);
  // fields absent from the partial come from the BASE, not from the defaults
  expect(merged.keepSpeechesWhole).toBe(true);
  expect(merged.justifyText).toBe(true);
});

test('resolveFormatOptions still defaults its base to DEFAULT_FORMAT_OPTIONS', () => {
  expect(resolveFormatOptions({})).toEqual(DEFAULT_FORMAT_OPTIONS);
});

test('an out-of-range value clamps against the base rather than being taken raw', () => {
  const base: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS, dialogueSideMarginPct: 12 };
  expect(resolveFormatOptions({ dialogueSideMarginPct: 999 }, base).dialogueSideMarginPct).toBe(30);
  expect(resolveFormatOptions({ dialogueSideMarginPct: 'nope' }, base).dialogueSideMarginPct).toBe(12);
});
```

Ensure the file's import line includes `DEFAULT_FORMAT_OPTIONS` and `type FormatOptions`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/options.test.ts`
Expected: FAIL — the base argument is ignored, so `keepSpeechesWhole` comes back `false`.

- [ ] **Step 3: Write minimal implementation**

In `src/options.ts`, change the signature and the one line that reads the defaults:

```ts
/** Merge a partial (e.g. parsed from --options JSON) over `base`, clamping
 * numeric knobs and ignoring unknown keys/invalid values. `base` defaults to
 * the shipped defaults; the per-script sidecar passes the user's global
 * settings instead, so a sidecar carrying one key overrides one knob and
 * leaves the rest of their tuning alone. */
export function resolveFormatOptions(
  partial?: Record<string, unknown>,
  base: FormatOptions = DEFAULT_FORMAT_OPTIONS,
): FormatOptions {
  const d = base;
  // ...the rest of the function body is unchanged
```

- [ ] **Step 4: Run the full suite**

Run: `bun test && bunx tsc --noEmit`
Expected: PASS — 609 tests, `tsc` clean. Every existing call site omits `base` and is unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/options.ts tests/options.test.ts
git commit -m "resolveFormatOptions can merge over a base other than the defaults"
```

---

### Task 2: `src/replace-file.ts`

Both the device copy paths and the export path need "replace whatever is at the destination." One implementation, so the two can't drift.

**Files:**
- Create: `src/replace-file.ts`
- Test: `tests/replace-file.test.ts`

**Interfaces:**
- Produces: `replaceFile(source: string, destination: string): void`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replaceFile } from '../src/replace-file';

function temp(name: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('replaceFile copies to a destination that does not exist', () => {
  const dir = temp('replace');
  const src = join(dir, 'a.txt');
  writeFileSync(src, 'v1');
  replaceFile(src, join(dir, 'b.txt'));
  expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('v1');
});

test('replaceFile overwrites an existing destination', () => {
  const dir = temp('replace');
  const src = join(dir, 'a.txt');
  const dest = join(dir, 'b.txt');
  writeFileSync(src, 'v1');
  writeFileSync(dest, 'old');
  replaceFile(src, dest);
  expect(readFileSync(dest, 'utf8')).toBe('v1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/replace-file.test.ts`
Expected: FAIL — cannot resolve `../src/replace-file`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/replace-file.ts
import { copyFileSync, rmSync } from 'node:fs';

/** Copy a file over whatever is at `destination`. Used by both the device
 * transfer paths and the export path, so the replace semantics can't drift
 * between them. */
export function replaceFile(source: string, destination: string): void {
  rmSync(destination, { force: true });
  copyFileSync(source, destination);
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/replace-file.test.ts && bunx tsc --noEmit`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/replace-file.ts tests/replace-file.test.ts
git commit -m "One replace-then-copy helper for device and export paths"
```

---

### Task 3: `src/settings/sidecar.ts`

Ports `ScriptSettings.swift`. This task carries the full eighteen-row override table and its completeness check — the most valuable test design in `kit-check`, because each row writes the *opposite* of the default, which is what makes it an assertion rather than a tautology.

**Files:**
- Create: `src/settings/sidecar.ts`
- Test: `tests/sidecar.test.ts`

**Interfaces:**
- Consumes: `resolveFormatOptions(partial, base)` from Task 1.
- Produces:
  - `sidecarPath(fountainPath: string): string`
  - `loadScriptSettings(fountainPath: string, fallback: FormatOptions): FormatOptions`
  - `saveScriptSettings(settings: FormatOptions, fountainPath: string): void`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DEFAULT_FORMAT_OPTIONS, type FormatOptions } from '../src/options';
import { sidecarPath, loadScriptSettings, saveScriptSettings } from '../src/settings/sidecar';

function library(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), 'library');
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('sidecar path derives from the fountain stem', () => {
  const fountain = join(library(), 'Test Script.fountain');
  expect(basename(sidecarPath(fountain))).toBe('Test Script.screepub.json');
});

test('sidecar round-trips settings', () => {
  const fountain = join(library(), 'Test Script.fountain');
  writeFileSync(fountain, 'Title: T');
  const settings: FormatOptions = {
    ...DEFAULT_FORMAT_OPTIONS,
    dialogueSideMarginPct: 27,
    keepSpeechesWhole: true,
  };
  saveScriptSettings(settings, fountain);
  expect(loadScriptSettings(fountain, DEFAULT_FORMAT_OPTIONS)).toEqual(settings);
});

test('absent sidecar falls back', () => {
  const fountain = join(library(), 'Other.fountain');
  expect(loadScriptSettings(fountain, DEFAULT_FORMAT_OPTIONS)).toEqual(DEFAULT_FORMAT_OPTIONS);
});

test('corrupt sidecar (invalid JSON) falls back', () => {
  const fountain = join(library(), 'Garbage.fountain');
  writeFileSync(sidecarPath(fountain), 'not json');
  expect(loadScriptSettings(fountain, DEFAULT_FORMAT_OPTIONS)).toEqual(DEFAULT_FORMAT_OPTIONS);
});

test('a JSON array is not an object and falls back', () => {
  const fountain = join(library(), 'Array.fountain');
  writeFileSync(sidecarPath(fountain), '[1,2,3]');
  expect(loadScriptSettings(fountain, DEFAULT_FORMAT_OPTIONS)).toEqual(DEFAULT_FORMAT_OPTIONS);
});

test('partial sidecar overlays the present field and leaves the rest at fallback', () => {
  const fountain = join(library(), 'Partial.fountain');
  writeFileSync(sidecarPath(fountain), '{"dialogueSideMarginPct": 9}');
  expect(loadScriptSettings(fountain, DEFAULT_FORMAT_OPTIONS))
    .toEqual({ ...DEFAULT_FORMAT_OPTIONS, dialogueSideMarginPct: 9 });
});

// Every row writes the OPPOSITE of the default and checks whole-struct
// equality. A sidecar value that merely equals the default would pass
// whether or not the merge handled that field at all, because the merge
// starts from a copy of the fallback. The override direction is what makes
// this a real assertion. Ported verbatim from kit-check.
const OVERRIDE_CASES: Array<{ field: keyof FormatOptions; json: string; expected: Partial<FormatOptions> }> = [
  { field: 'scenePageBreaks', json: '{"scenePageBreaks": true}', expected: { scenePageBreaks: true } },
  { field: 'dialogueSideMarginPct', json: '{"dialogueSideMarginPct": 9}', expected: { dialogueSideMarginPct: 9 } },
  { field: 'cueIndentPct', json: '{"cueIndentPct": 11}', expected: { cueIndentPct: 11 } },
  { field: 'parentheticalIndentPct', json: '{"parentheticalIndentPct": 5}', expected: { parentheticalIndentPct: 5 } },
  { field: 'elementSpacingEm', json: '{"elementSpacingEm": 1.6}', expected: { elementSpacingEm: 1.6 } },
  { field: 'keepSceneHeadingWithScene', json: '{"keepSceneHeadingWithScene": false}', expected: { keepSceneHeadingWithScene: false } },
  { field: 'keepSpeechesWhole', json: '{"keepSpeechesWhole": true}', expected: { keepSpeechesWhole: true } },
  { field: 'fontFamily', json: '{"fontFamily": "serif"}', expected: { fontFamily: 'serif' } },
  { field: 'rejoinSplitDialogue', json: '{"rejoinSplitDialogue": false}', expected: { rejoinSplitDialogue: false } },
  { field: 'contdMode', json: '{"contdMode": "strip"}', expected: { contdMode: 'strip' } },
  { field: 'cueAlignment', json: '{"cueAlignment": "indented"}', expected: { cueAlignment: 'indented' } },
  { field: 'includeTitlePage', json: '{"includeTitlePage": false}', expected: { includeTitlePage: false } },
  { field: 'showSceneNumbers', json: '{"showSceneNumbers": true}', expected: { showSceneNumbers: true } },
  { field: 'showPageMarkers', json: '{"showPageMarkers": true}', expected: { showPageMarkers: true } },
  { field: 'dualDialogue', json: '{"dualDialogue": "sequential"}', expected: { dualDialogue: 'sequential' } },
  { field: 'justifyText', json: '{"justifyText": true}', expected: { justifyText: true } },
  { field: 'printSplitMinimums', json: '{"printSplitMinimums": false}', expected: { printSplitMinimums: false } },
  { field: 'preserveFontShifts', json: '{"preserveFontShifts": false}', expected: { preserveFontShifts: false } },
];

for (const c of OVERRIDE_CASES) {
  test(`sidecar merge overrides ${c.field} against its default fallback`, () => {
    const fountain = join(library(), `Override-${c.field}.fountain`);
    writeFileSync(sidecarPath(fountain), c.json);
    expect(loadScriptSettings(fountain, DEFAULT_FORMAT_OPTIONS))
      .toEqual({ ...DEFAULT_FORMAT_OPTIONS, ...c.expected });
  });
}

test('every FormatOptions field has an override row', () => {
  const all = new Set(Object.keys(DEFAULT_FORMAT_OPTIONS));
  const covered = new Set(OVERRIDE_CASES.map((c) => c.field as string));
  expect([...all].filter((f) => !covered.has(f))).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/sidecar.test.ts`
Expected: FAIL — cannot resolve `../src/settings/sidecar`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/settings/sidecar.ts
// Per-script formatting overrides, stored beside the script's .fountain in
// the library: `<Stem>.screepub.json`. Absent sidecar = the caller's base.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveFormatOptions, type FormatOptions } from '../options';

export function sidecarPath(fountainPath: string): string {
  const stem = basename(fountainPath).replace(/\.[^.]*$/, '');
  return join(dirname(fountainPath), `${stem}.screepub.json`);
}

/** Read a sidecar and overlay it on `fallback`. Unknown keys and invalid
 * values are ignored and missing keys leave `fallback` standing, so neither
 * an older nor a newer schema can wipe a user's per-script tuning — that
 * merge is resolveFormatOptions', not a second copy of it. */
export function loadScriptSettings(fountainPath: string, fallback: FormatOptions): FormatOptions {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(sidecarPath(fountainPath), 'utf8'));
  } catch {
    return fallback;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
  return resolveFormatOptions(parsed as Record<string, unknown>, fallback);
}

/** Write the sidecar with sorted keys, via temp-then-rename so a reader
 * never observes a partial file — the same discipline cli.ts uses. */
export function saveScriptSettings(settings: FormatOptions, fountainPath: string): void {
  const path = sidecarPath(fountainPath);
  const sorted = Object.fromEntries(
    Object.entries(settings).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`);
  renameSync(tmp, path);
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/sidecar.test.ts && bunx tsc --noEmit`
Expected: PASS — 25 tests (6 behaviors + 18 override rows + the completeness check).

- [ ] **Step 5: Commit**

```bash
git add src/settings/sidecar.ts tests/sidecar.test.ts
git commit -m "Per-script settings sidecar, in TypeScript"
```

---

### Task 4: `src/settings/presets.ts`

**Files:**
- Create: `src/settings/presets.ts`
- Test: `tests/presets.test.ts`

**Interfaces:**
- Produces:
  - `type DevicePresetId = 'kindleEink' | 'phone'`
  - `DEVICE_PRESETS: Record<DevicePresetId, { displayName: string; settings: FormatOptions }>`
  - `matchingPreset(settings: FormatOptions): DevicePresetId | null`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { DEFAULT_FORMAT_OPTIONS } from '../src/options';
import { DEVICE_PRESETS, matchingPreset } from '../src/settings/presets';

test('the Kindle e-ink preset is exactly the defaults', () => {
  expect(DEVICE_PRESETS.kindleEink.settings).toEqual(DEFAULT_FORMAT_OPTIONS);
});

test('the phone preset widens the column and drops side-by-side dual dialogue', () => {
  expect(DEVICE_PRESETS.phone.settings).toEqual({
    ...DEFAULT_FORMAT_OPTIONS,
    dialogueSideMarginPct: 10,
    dualDialogue: 'sequential',
  });
});

test('matchingPreset names the preset whose settings match exactly', () => {
  expect(matchingPreset(DEFAULT_FORMAT_OPTIONS)).toBe('kindleEink');
  expect(matchingPreset(DEVICE_PRESETS.phone.settings)).toBe('phone');
});

test('matchingPreset returns null once a knob is tuned away from every preset', () => {
  expect(matchingPreset({ ...DEFAULT_FORMAT_OPTIONS, cueIndentPct: 41 })).toBeNull();
});

test('every preset has a display name', () => {
  for (const preset of Object.values(DEVICE_PRESETS)) {
    expect(preset.displayName.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/presets.test.ts`
Expected: FAIL — cannot resolve `../src/settings/presets`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/settings/presets.ts
// Named bundles of FormatOptions tuned for a class of reading device.
// Responsive reflow is impossible in a fixed e-book (no JS, media queries
// stripped), so a preset chosen at conversion time is the mechanism for
// device-appropriate geometry.
import { DEFAULT_FORMAT_OPTIONS, type FormatOptions } from '../options';

export type DevicePresetId = 'kindleEink' | 'phone';

export const DEVICE_PRESETS: Record<DevicePresetId, { displayName: string; settings: FormatOptions }> = {
  /** The recommended baseline: 6" e-ink Kindle. Identical to defaults. */
  kindleEink: {
    displayName: 'Kindle e-ink (6")',
    settings: DEFAULT_FORMAT_OPTIONS,
  },
  /** Narrow phone/tablet reading app: side-by-side dual dialogue is an
   * unreadable sliver, so speeches go sequential, and the dialogue column
   * widens (shallower side margins) to use the small screen. */
  phone: {
    displayName: 'Phone / narrow screen',
    settings: { ...DEFAULT_FORMAT_OPTIONS, dialogueSideMarginPct: 10, dualDialogue: 'sequential' },
  },
};

/** The preset whose settings exactly match `settings`, or null when they have
 * been tuned away from every preset. Applying a preset overwrites the
 * settings and stores no identity, so equality is the only honest answer to
 * "which preset am I on?" — a remembered name would keep claiming "Kindle
 * e-ink" after the first knob moved. */
export function matchingPreset(settings: FormatOptions): DevicePresetId | null {
  const ids = Object.keys(DEVICE_PRESETS) as DevicePresetId[];
  return ids.find((id) => sameSettings(DEVICE_PRESETS[id].settings, settings)) ?? null;
}

function sameSettings(a: FormatOptions, b: FormatOptions): boolean {
  const keys = Object.keys(a) as Array<keyof FormatOptions>;
  return keys.every((k) => a[k] === b[k]);
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/presets.test.ts && bunx tsc --noEmit`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/settings/presets.ts tests/presets.test.ts
git commit -m "Device presets, in TypeScript"
```

---

### Task 5: `src/device/types.ts` and `src/device/kindle.ts`

**Files:**
- Create: `src/device/types.ts`, `src/device/kindle.ts`
- Test: `tests/device-kindle.test.ts`

**Interfaces:**
- Consumes: `replaceFile` from Task 2.
- Produces:
  - `type DeviceKind = 'kindle' | 'kobo' | 'tolino' | 'remarkable'`
  - `interface ConnectedDevice { kind: DeviceKind; name: string; volume: string | null }`
  - `DEVICE_DISPLAY_NAMES: Record<DeviceKind, string>`
  - `deviceId(device: ConnectedDevice): string`
  - `isKindleVolume(volume: string): boolean`
  - `kindleVolumeName(volume: string): string`
  - `copyToKindleVolume(file: string, volume: string): string`

**Note on volume names.** Swift reads `volumeNameKey` and falls back to the last path component; a temp directory has no volume name, so `kit-check`'s assertions are really exercising the path component. TypeScript has no `volumeNameKey` for a plain directory, so `basename(volume)` is the single source — and the ported assertions land identically.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isKindleVolume, kindleVolumeName, copyToKindleVolume } from '../src/device/kindle';

/** Mirrors kit-check's tempDir(): a uniquely-rooted directory whose own name
 * is the "volume name" under test. */
function volume(name: string, subdirs: string[] = []): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), name);
  mkdirSync(dir, { recursive: true });
  for (const sub of subdirs) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}

test('volume named Kindle with documents/ is detected', () => {
  expect(isKindleVolume(volume('Kindle', ['documents']))).toBe(true);
});

test('unnamed volume with documents/ + system/ is detected', () => {
  expect(isKindleVolume(volume('NO NAME', ['documents', 'system']))).toBe(true);
});

test('volume without documents/ is rejected', () => {
  expect(isKindleVolume(volume('Kindle-empty'))).toBe(false);
});

test('generic thumb drive is rejected', () => {
  expect(isKindleVolume(volume('USB STICK', ['documents']))).toBe(false);
});

test('a documents/ FILE does not make it a Kindle', () => {
  const dir = volume('Kindle-file');
  writeFileSync(join(dir, 'documents'), 'not a directory');
  expect(isKindleVolume(dir)).toBe(false);
});

test('copy lands in documents/, preserves content, and overwrites on re-copy', () => {
  const vol = volume('Kindle', ['documents']);
  const src = join(vol, '..', 'Test.epub');
  writeFileSync(src, 'v1');

  const dest = copyToKindleVolume(src, vol);
  expect(dest.endsWith(join('Kindle', 'documents', 'Test.epub'))).toBe(true);
  expect(readFileSync(dest, 'utf8')).toBe('v1');

  writeFileSync(src, 'v2');
  copyToKindleVolume(src, vol);
  expect(readFileSync(dest, 'utf8')).toBe('v2');
});

test('the volume name is its own directory name', () => {
  expect(kindleVolumeName(volume('Kindle', ['documents']))).toBe('Kindle');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/device-kindle.test.ts`
Expected: FAIL — cannot resolve `../src/device/kindle`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/device/types.ts
/** A supported e-reader family. Volume-mounted vendors are detected by their
 * on-disk signatures; reMarkable never mounts and is reached over its USB web
 * interface instead (see remarkable.ts). */
export type DeviceKind = 'kindle' | 'kobo' | 'tolino' | 'remarkable';

export const DEVICE_DISPLAY_NAMES: Record<DeviceKind, string> = {
  kindle: 'Kindle',
  kobo: 'Kobo',
  tolino: 'tolino',
  remarkable: 'reMarkable',
};

export interface ConnectedDevice {
  kind: DeviceKind;
  name: string;
  /** Mounted volume root; null for reMarkable (network route). */
  volume: string | null;
}

export function deviceId(device: ConnectedDevice): string {
  return device.volume ?? device.kind;
}
```

```ts
// src/device/kindle.ts
// USB-mounted Kindle detection and transfer. Older Kindles mount as a mass-
// storage volume with a `documents/` folder (newer firmware is MTP and never
// appears as a volume at all — those use the email/web routes).
import { mkdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { replaceFile } from '../replace-file';

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** A mounted volume looks like a Kindle when it has a `documents/` folder and
 * either a Kindle-ish volume name or a `system/` folder. */
export function isKindleVolume(volume: string): boolean {
  if (!isDirectory(join(volume, 'documents'))) return false;
  if (basename(volume).toLowerCase().includes('kindle')) return true;
  return exists(join(volume, 'system'));
}

export function kindleVolumeName(volume: string): string {
  return basename(volume);
}

/** Copy a book into the device's documents folder, replacing any previous
 * copy. Returns the destination path. */
export function copyToKindleVolume(file: string, volume: string): string {
  const destDir = join(volume, 'documents');
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, basename(file));
  replaceFile(file, dest);
  return dest;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/device-kindle.test.ts && bunx tsc --noEmit`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/device/types.ts src/device/kindle.ts tests/device-kindle.test.ts
git commit -m "Kindle volume detection and transfer, in TypeScript"
```

---

### Task 6: `src/device/classify.ts`

**Files:**
- Create: `src/device/classify.ts`
- Test: `tests/device-classify.test.ts`

**Interfaces:**
- Consumes: `isKindleVolume` (Task 5), `DeviceKind` (Task 5).
- Produces:
  - `classify(volume: string): DeviceKind | null`
  - `volumeName(volume: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, volumeName } from '../src/device/classify';

function volume(name: string, subdirs: string[] = []): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), name);
  mkdirSync(dir, { recursive: true });
  for (const sub of subdirs) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}

test('volume with a .kobo dir is detected as Kobo', () => {
  expect(classify(volume('KOBOeReader', ['.kobo']))).toBe('kobo');
});

test('volume named tolino is detected as tolino', () => {
  expect(classify(volume('tolino'))).toBe('tolino');
});

test('tolino detection is case-insensitive', () => {
  expect(classify(volume('TOLINO vision'))).toBe('tolino');
});

test('a Kindle volume classifies as kindle', () => {
  expect(classify(volume('Kindle', ['documents']))).toBe('kindle');
});

test('a generic thumb drive classifies as no device', () => {
  expect(classify(volume('USB STICK', ['documents']))).toBeNull();
});

test('a .kobo FILE does not make it a Kobo', () => {
  // Only a directory counts; Swift checks isDirectory explicitly.
  const dir = volume('NotAKobo');
  Bun.write(join(dir, '.kobo'), 'x');
  expect(classify(dir)).toBeNull();
});

test('Kindle wins over a bare name collision', () => {
  // documents/ + system/ is a Kindle even if the name says nothing.
  expect(classify(volume('NO NAME', ['documents', 'system']))).toBe('kindle');
});

test('volumeName is the directory name', () => {
  expect(volumeName(volume('KOBOeReader'))).toBe('KOBOeReader');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/device-classify.test.ts`
Expected: FAIL — cannot resolve `../src/device/classify`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/device/classify.ts
// The pure vendor predicate: given a mounted volume's path, which e-reader
// family is it? All device knowledge lives here, so it is testable with temp
// directories on every platform. Enumerating what is actually mounted is
// volumes.ts's job and is the only part that cannot be unit-tested.
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { isKindleVolume } from './kindle';
import type { DeviceKind } from './types';

export function volumeName(volume: string): string {
  return basename(volume);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Vendor signature of a mounted volume, or null for a plain drive. Kobo
 * firmware maintains a `.kobo` folder at the root; tolino mounts under its
 * brand name; Kindle keeps the documents/ check. */
export function classify(volume: string): DeviceKind | null {
  if (isKindleVolume(volume)) return 'kindle';
  if (isDirectory(join(volume, '.kobo'))) return 'kobo';
  if (volumeName(volume).toLowerCase().includes('tolino')) return 'tolino';
  return null;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/device-classify.test.ts && bunx tsc --noEmit`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/device/classify.ts tests/device-classify.test.ts
git commit -m "Vendor classification for mounted volumes, in TypeScript"
```

---

### Task 7: `src/device/transfer.ts`

**Files:**
- Create: `src/device/transfer.ts`
- Test: `tests/device-transfer.test.ts`

**Interfaces:**
- Consumes: `ConnectedDevice` (Task 5), `copyToKindleVolume` (Task 5), `replaceFile` (Task 2).
- Produces:
  - `class NoVolumeError extends Error`
  - `copyToDevice(file: string, device: ConnectedDevice): string`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyToDevice, NoVolumeError } from '../src/device/transfer';
import type { ConnectedDevice } from '../src/device/types';

function volume(name: string, subdirs: string[] = []): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), name);
  mkdirSync(dir, { recursive: true });
  for (const sub of subdirs) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}

function book(at: string): string {
  const path = join(at, '..', 'Script.epub');
  writeFileSync(path, 'epub');
  return path;
}

test('Kobo copy lands at the volume root', () => {
  const vol = volume('KOBOeReader', ['.kobo']);
  const device: ConnectedDevice = { kind: 'kobo', name: 'Kobo', volume: vol };
  const dest = copyToDevice(book(vol), device);
  expect(dest.endsWith(join('KOBOeReader', 'Script.epub'))).toBe(true);
});

test('tolino copy lands in Books/, which is created if missing', () => {
  const vol = volume('tolino');
  const device: ConnectedDevice = { kind: 'tolino', name: 'tolino', volume: vol };
  const dest = copyToDevice(book(vol), device);
  expect(dest.endsWith(join('tolino', 'Books', 'Script.epub'))).toBe(true);
  expect(existsSync(join(vol, 'Books'))).toBe(true);
});

test('Kindle copy still lands in documents/', () => {
  const vol = volume('Kindle', ['documents']);
  const device: ConnectedDevice = { kind: 'kindle', name: 'Kindle', volume: vol };
  const dest = copyToDevice(book(vol), device);
  expect(dest.endsWith(join('Kindle', 'documents', 'Script.epub'))).toBe(true);
});

test('a device with no volume throws rather than guessing a path', () => {
  const vol = volume('scratch');
  const device: ConnectedDevice = { kind: 'kobo', name: 'Kobo', volume: null };
  expect(() => copyToDevice(book(vol), device)).toThrow(NoVolumeError);
});

test('reMarkable is never a copy target — it uploads instead', () => {
  const vol = volume('scratch');
  const device: ConnectedDevice = { kind: 'remarkable', name: 'reMarkable', volume: vol };
  expect(() => copyToDevice(book(vol), device)).toThrow(NoVolumeError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/device-transfer.test.ts`
Expected: FAIL — cannot resolve `../src/device/transfer`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/device/transfer.ts
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { replaceFile } from '../replace-file';
import { copyToKindleVolume } from './kindle';
import type { ConnectedDevice } from './types';

export class NoVolumeError extends Error {
  constructor() {
    super('Device has no mounted volume.');
    this.name = 'NoVolumeError';
  }
}

/** Copy a book to its vendor's expected location: Kindle → documents/,
 * Kobo → volume root, tolino → Books/ at the root (subfolders of it aren't
 * reliably indexed; the folder is created if missing). Replaces any previous
 * copy. Returns the destination path. */
export function copyToDevice(file: string, device: ConnectedDevice): string {
  const volume = device.volume;
  if (!volume) throw new NoVolumeError();

  let destDir: string;
  switch (device.kind) {
    case 'kindle':
      return copyToKindleVolume(file, volume);
    case 'kobo':
      destDir = volume;
      break;
    case 'tolino':
      destDir = join(volume, 'Books');
      break;
    case 'remarkable':
      // Never mounts; reached over its USB web interface instead.
      throw new NoVolumeError();
  }

  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, basename(file));
  replaceFile(file, dest);
  return dest;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/device-transfer.test.ts && bunx tsc --noEmit`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/device/transfer.ts tests/device-transfer.test.ts
git commit -m "Per-vendor copy destinations, in TypeScript"
```

---

### Task 8: `src/export/freshness.ts`

The asymmetric fallbacks are the single easiest thing in this port to get subtly wrong, and getting either backwards silently serves users a stale book. Both directions are asserted.

**Files:**
- Create: `src/export/freshness.ts`
- Test: `tests/export-freshness.test.ts`

**Interfaces:**
- Produces: `needsRegeneration(artifact: string, freshRelativeTo: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { needsRegeneration } from '../src/export/freshness';

function pair(artifactAge: number | null, epubAge: number | null) {
  const dir = mkdtempSync(join(tmpdir(), 'screepub-test-'));
  const epub = join(dir, 'book.epub');
  const artifact = join(dir, 'book.mobi');
  const now = Date.now() / 1000;
  writeFileSync(epub, 'epub');
  if (epubAge !== null) utimesSync(epub, now - epubAge, now - epubAge);
  if (artifactAge !== null) {
    writeFileSync(artifact, 'mobi');
    utimesSync(artifact, now - artifactAge, now - artifactAge);
  }
  return { epub, artifact };
}

test('a missing artifact needs regeneration', () => {
  const { epub, artifact } = pair(null, 10);
  expect(needsRegeneration(artifact, epub)).toBe(true);
});

test('an artifact older than its EPUB needs regeneration', () => {
  const { epub, artifact } = pair(100, 10);
  expect(needsRegeneration(artifact, epub)).toBe(true);
});

test('an artifact newer than its EPUB is fresh', () => {
  const { epub, artifact } = pair(10, 100);
  expect(needsRegeneration(artifact, epub)).toBe(false);
});

test('identical mtimes count as STALE, not fresh', () => {
  // copyItem, `rsync -t`, Time Machine restores and archive extraction can
  // all reproduce identical mtimes. Ties must fail toward regenerating.
  const { epub, artifact } = pair(50, 50);
  expect(needsRegeneration(artifact, epub)).toBe(true);
});

test('an unreadable EPUB makes a present artifact stale, not fresh', () => {
  // The EPUB side must fail closed toward the FUTURE. If it fell back to the
  // distant past instead, a deleted or unmounted EPUB would compare as older
  // than everything and a stale artifact would be reported fresh.
  const { artifact } = pair(10, 100);
  expect(needsRegeneration(artifact, join(tmpdir(), 'screepub-does-not-exist.epub'))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/export-freshness.test.ts`
Expected: FAIL — cannot resolve `../src/export/freshness`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/export/freshness.ts
import { statSync } from 'node:fs';

function modifiedAt(path: string, ifUnknown: number): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return ifUnknown;
  }
}

/** True when `artifact` is missing, or no newer than the EPUB it derives
 * from. What it catches is a run that rewrote the EPUB but produced no new
 * artifact beside it.
 *
 * Ties count as stale: copyItem, `rsync -t`, Time Machine restores and
 * archive extraction can all reproduce identical mtimes.
 *
 * The two fallbacks are deliberately asymmetric. The artifact side fails
 * closed toward "regenerate" via -Infinity; the EPUB side must fail closed
 * the OTHER way, via +Infinity, or an unreadable EPUB (deleted, unmounted,
 * no permission) would compare as older than everything and a stale artifact
 * would be reported fresh. */
export function needsRegeneration(artifact: string, freshRelativeTo: string): boolean {
  const artifactDate = modifiedAt(artifact, -Infinity);
  if (artifactDate === -Infinity) return true;
  const epubDate = modifiedAt(freshRelativeTo, Infinity);
  return artifactDate <= epubDate;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/export-freshness.test.ts && bunx tsc --noEmit`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/export/freshness.ts tests/export-freshness.test.ts
git commit -m "The artifact staleness rule, with both fallbacks asserted"
```

---

### Task 9: `src/export/formats.ts`

**Files:**
- Create: `src/export/formats.ts`
- Test: `tests/export-formats.test.ts`

**Interfaces:**
- Produces:
  - `type ExportFormat = 'epub' | 'kindle'`
  - `interface ToolchainState { calibreAvailable: boolean; kfxReady: boolean }`
  - `fileExtension(format: ExportFormat, state: ToolchainState): string`
  - `formatLabel(format: ExportFormat, state: ToolchainState): string`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { fileExtension, formatLabel } from '../src/export/formats';

test('EPUB is always epub regardless of toolchain', () => {
  expect(fileExtension('epub', { calibreAvailable: false, kfxReady: false })).toBe('epub');
  expect(fileExtension('epub', { calibreAvailable: true, kfxReady: true })).toBe('epub');
});

test('the Kindle ladder prefers KFX, then AZW3, then MOBI', () => {
  expect(fileExtension('kindle', { calibreAvailable: true, kfxReady: true })).toBe('kfx');
  expect(fileExtension('kindle', { calibreAvailable: true, kfxReady: false })).toBe('azw3');
  expect(fileExtension('kindle', { calibreAvailable: false, kfxReady: false })).toBe('mobi');
});

test('the Kindle label names the format it will actually produce', () => {
  expect(formatLabel('kindle', { calibreAvailable: true, kfxReady: false })).toContain('AZW3');
  expect(formatLabel('kindle', { calibreAvailable: false, kfxReady: false })).toContain('MOBI');
});

test('only the KFX rung claims best quality', () => {
  expect(formatLabel('kindle', { calibreAvailable: true, kfxReady: true })).toContain('best quality');
  expect(formatLabel('kindle', { calibreAvailable: true, kfxReady: false })).not.toContain('best quality');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/export-formats.test.ts`
Expected: FAIL — cannot resolve `../src/export/formats`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/export/formats.ts
// What a converted script can be saved as, labeled by PURPOSE: the file you
// email is not the file you sideload. Amazon stopped accepting MOBI for Send
// to Kindle in 2022, while Kindles never index a sideloaded EPUB.
export type ExportFormat = 'epub' | 'kindle';

export interface ToolchainState {
  calibreAvailable: boolean;
  kfxReady: boolean;
}

/** The Kindle sideload ladder, best rung first: KFX (Enhanced Typesetting —
 * keeps hold, device-verified 2026-07-29) when the full toolchain is present;
 * AZW3 with Calibre alone; the engine's own MOBI with nothing. Registry §8b
 * has the verdict behind the order. */
export function fileExtension(format: ExportFormat, state: ToolchainState): string {
  if (format === 'epub') return 'epub';
  if (state.kfxReady) return 'kfx';
  return state.calibreAvailable ? 'azw3' : 'mobi';
}

export function formatLabel(format: ExportFormat, state: ToolchainState): string {
  if (format === 'epub') return 'EPUB — for emailing to Kindle, and most e-readers';
  const ext = fileExtension(format, state).toUpperCase();
  const hint = state.kfxReady ? ' (best quality)' : '';
  return `${ext} — for USB sideload to Kindle${hint}`;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/export-formats.test.ts && bunx tsc --noEmit`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/export/formats.ts tests/export-formats.test.ts
git commit -m "The Kindle sideload ladder, in TypeScript"
```

---

### Task 10: `src/export/calibre.ts`

**Files:**
- Create: `src/export/calibre.ts`
- Test: `tests/export-calibre.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `CALIBRE_FORMAT_GUARDS: readonly string[]`
  - `calibreTool(name: string): string | null`
  - `isCalibreAvailable(): boolean`
  - `class CalibreMissingError extends Error`, `class CalibreFailedError extends Error`
  - `toAzw3(epub: string): Promise<string>`
  - `toKepub(epub: string): Promise<string>`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { accessSync, constants } from 'node:fs';
import { CALIBRE_FORMAT_GUARDS, calibreTool, isCalibreAvailable } from '../src/export/calibre';

test('the format guards are exactly the device-verified trio', () => {
  // Device-verified 2026-07-29. Calibre would otherwise insert a page break
  // before every h2 (scene-per-page again) and its remove-fake-margins
  // heuristic would delete the dialogue column's side margins, which is what
  // a screenplay looks like to it. Change them in one place or not at all.
  expect([...CALIBRE_FORMAT_GUARDS]).toEqual([
    '--page-breaks-before=/',
    '--chapter-mark=none',
    '--disable-remove-fake-margins',
  ]);
});

test('isAvailable agrees with toolURL in both directions', () => {
  const tool = calibreTool('ebook-convert');
  if (tool) {
    expect(isCalibreAvailable()).toBe(true);
    expect(() => accessSync(tool, constants.X_OK)).not.toThrow();
  } else {
    expect(isCalibreAvailable()).toBe(false);
  }
});

test('an unknown tool name is not discovered', () => {
  expect(calibreTool('definitely-not-a-calibre-tool')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/export-calibre.test.ts`
Expected: FAIL — cannot resolve `../src/export/calibre`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/export/calibre.ts
// EPUB → AZW3/KEPUB via Calibre's ebook-convert. Kindles do NOT index
// sideloaded EPUBs — a USB copy must be AZW3 (Calibre's "Send to Device"
// does exactly this conversion first; Send-to-Kindle email/web converts
// server-side).
import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { platform } from 'node:process';

/** Calibre would otherwise undo two Screepub decisions during the convert: it
 * inserts page-break-before on every h2 (scene-per-page again), and its
 * remove-fake-margins heuristic sees side margins on most blocks — which is
 * what a screenplay's dialogue column looks like — and deletes them as
 * "publisher page margins", regardless of unit. Device-verified 2026-07-29;
 * change them in one place or not at all. (--extra-css is no rescue: on
 * multi-file EPUBs Calibre attaches it only to its generated inline ToC.) */
export const CALIBRE_FORMAT_GUARDS = [
  '--page-breaks-before=/',
  '--chapter-mark=none',
  '--disable-remove-fake-margins',
] as const;

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** One scanner for every Calibre CLI tool, so callers can never disagree
 * about whether Calibre exists. Per-OS: macOS keeps the tools inside the app
 * bundle, Linux installs them on PATH, Windows uses Program Files. */
function candidatePaths(name: string): string[] {
  if (platform === 'darwin') {
    return [
      `/Applications/calibre.app/Contents/MacOS/${name}`,
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
    ];
  }
  if (platform === 'win32') {
    const exe = `${name}.exe`;
    return [
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Calibre2', exe),
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Calibre2', exe),
      ...pathEntries(exe),
    ];
  }
  return [`/usr/bin/${name}`, `/usr/local/bin/${name}`, ...pathEntries(name)];
}

function pathEntries(name: string): string[] {
  return (process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, name));
}

export function calibreTool(name: string): string | null {
  return candidatePaths(name).find((p) => existsSync(p) && isExecutable(p)) ?? null;
}

export function isCalibreAvailable(): boolean {
  return calibreTool('ebook-convert') !== null;
}

export class CalibreMissingError extends Error {
  constructor() {
    super("Calibre's ebook-convert was not found.");
    this.name = 'CalibreMissingError';
  }
}

export class CalibreFailedError extends Error {
  constructor(detail: string) {
    super(`ebook-convert failed: ${detail}`);
    this.name = 'CalibreFailedError';
  }
}

/** Exported because export/kfx.ts runs the same tool with the same guards. */
export async function runCalibre(tool: string, args: string[]): Promise<void> {
  const proc = Bun.spawn([tool, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new CalibreFailedError(stderr.trim() || `exit ${code}`);
}

/** Convert an EPUB to AZW3 next to it (~1s; no caching — a stale cache would
 * outlive conversion-recipe changes). */
export async function toAzw3(epub: string): Promise<string> {
  const tool = calibreTool('ebook-convert');
  if (!tool) throw new CalibreMissingError();
  const azw3 = `${epub.replace(/\.epub$/i, '')}.azw3`;
  await runCalibre(tool, [epub, azw3, ...CALIBRE_FORMAT_GUARDS]);
  if (!existsSync(azw3)) {
    throw new CalibreFailedError('ebook-convert exited cleanly but produced no .azw3');
  }
  return azw3;
}

/** Convert an EPUB to KEPUB for Kobo's own renderer. */
export async function toKepub(epub: string): Promise<string> {
  const tool = calibreTool('ebook-convert');
  if (!tool) throw new CalibreMissingError();
  const kepub = `${epub.replace(/\.epub$/i, '')}.kepub.epub`;
  await runCalibre(tool, [epub, kepub, ...CALIBRE_FORMAT_GUARDS]);
  if (!existsSync(kepub)) {
    throw new CalibreFailedError('ebook-convert exited cleanly but produced no .kepub.epub');
  }
  return kepub;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/export-calibre.test.ts && bunx tsc --noEmit`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the conversion tests, which self-skip without Calibre**

Append to `tests/export-calibre.test.ts`. Merge the imports below into the
file's existing import block rather than adding a second one — `expect` and
`calibreTool` are already imported at the top, and only `test as bunTest` is
genuinely new (the alias exists so the skip-wrapper reads clearly beside the
plain `test`).

```ts
import { test as bunTest } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertFountain } from '../src/convert';
import { toAzw3, toKepub } from '../src/export/calibre';

// Mirrors kit-check: environment-dependent checks self-skip rather than fail,
// so CI stays green on bare runners.
const withCalibre = calibreTool('ebook-convert') ? bunTest : bunTest.skip;

async function minimalEpub(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'screepub-test-'));
  const epub = join(dir, 'book.epub');
  const result = await convertFountain('Title: Test\n\nINT. ROOM - DAY\n\nA line of action.\n');
  writeFileSync(epub, result.epub);
  return epub;
}

withCalibre('toAzw3 produces an .azw3 beside the EPUB', async () => {
  const out = await toAzw3(await minimalEpub());
  expect(out.endsWith('.azw3')).toBe(true);
  expect(readFileSync(out).length).toBeGreaterThan(0);
}, 120_000);

withCalibre('toKepub names its output .kepub.epub for Kobo', async () => {
  const out = await toKepub(await minimalEpub());
  expect(out.endsWith('.kepub.epub')).toBe(true);
}, 120_000);
```

Run: `bun test tests/export-calibre.test.ts`
Expected: PASS. With Calibre installed, 5 tests; without it, 3 pass and 2 skip.

- [ ] **Step 6: Commit**

```bash
git add src/export/calibre.ts tests/export-calibre.test.ts
git commit -m "Calibre discovery and the AZW3/KEPUB recipes, in TypeScript"
```

---

### Task 11: `src/export/kfx.ts`

Discovery and status only. `installPlugin()` is deferred to piece C — see **File Structure** above for why.

**Files:**
- Create: `src/export/kfx.ts`
- Test: `tests/export-kfx.test.ts`

**Interfaces:**
- Consumes: `calibreTool` (Task 10).
- Produces:
  - `interface KfxStatus { calibre: boolean; previewer: boolean; pluginInstalled: boolean; ready: boolean }`
  - `previewerPath(): string | null`
  - `kfxStatus(): Promise<KfxStatus>`
  - `toKfx(epub: string, onStage?: (stage: string) => void): Promise<string>`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { platform } from 'node:process';
import { previewerPath, kfxStatus } from '../src/export/kfx';
import { calibreTool } from '../src/export/calibre';

test('Kindle Previewer is never found on Linux — Amazon ships no build', () => {
  if (platform === 'linux') expect(previewerPath()).toBeNull();
});

test('status.ready requires all three pieces', async () => {
  const status = await kfxStatus();
  expect(status.ready).toBe(status.calibre && status.previewer && status.pluginInstalled);
});

test('status.calibre agrees with Calibre discovery', async () => {
  const status = await kfxStatus();
  expect(status.calibre).toBe(calibreTool('calibre-customize') !== null);
});

test('pluginInstalled is false whenever Calibre is absent', async () => {
  // The plugin lives inside Calibre, so it cannot be installed without it.
  const status = await kfxStatus();
  if (!status.calibre) expect(status.pluginInstalled).toBe(false);
});

test('on Linux the KFX rung is never ready, so the ladder degrades', async () => {
  if (platform === 'linux') expect((await kfxStatus()).ready).toBe(false);
});

test('toKfx refuses outright when Calibre is absent', async () => {
  // The conversion itself cannot be exercised without Kindle Previewer, which
  // Amazon ships for macOS and Windows only — that path is covered by the
  // hardware pass in piece C. What IS testable everywhere is that it fails
  // honestly rather than reporting success with no file.
  if (calibreTool('ebook-convert')) return;
  await expect(toKfx(join(tmpdir(), 'screepub-nonexistent.epub'))).rejects.toThrow(
    'ebook-convert was not found',
  );
});
```

The imports for this file are `platform` from `node:process`, `tmpdir` from
`node:os`, `join` from `node:path`, `previewerPath`/`kfxStatus`/`toKfx` from
`../src/export/kfx`, and `calibreTool` from `../src/export/calibre`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/export-kfx.test.ts`
Expected: FAIL — cannot resolve `../src/export/kfx`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/export/kfx.ts
// The only KFX writer in existence is inside Amazon's Kindle Previewer, so
// the KFX rung needs Calibre + Kindle Previewer + jhowell's KFX Output
// plugin, which drives Previewer headlessly. Amazon ships Previewer for
// macOS and Windows only: on Linux this rung is simply never ready, and
// formats.ts's ladder degrades to AZW3 without any special-casing.
//
// Plugin INSTALLATION is deferred to piece C — it needs the vendored 485 KB
// zip, and how a `bun build --compile` binary embeds a binary asset is a
// packaging decision that belongs with app packaging. This module reads.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:process';
import { calibreTool } from './calibre';

export interface KfxStatus {
  calibre: boolean;
  previewer: boolean;
  /** Only meaningful when `calibre` is true — the plugin lives inside it. */
  pluginInstalled: boolean;
  ready: boolean;
}

export function previewerPath(): string | null {
  if (platform === 'darwin') {
    const app = '/Applications/Kindle Previewer 3.app';
    return existsSync(app) ? app : null;
  }
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    if (!local) return null;
    const exe = join(local, 'Amazon', 'Kindle Previewer 3', 'Kindle Previewer 3.exe');
    return existsSync(exe) ? exe : null;
  }
  return null;
}

async function pluginInstalled(customize: string): Promise<boolean> {
  const proc = Bun.spawn([customize, '--list-plugins'], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  return code === 0 && stdout.includes('KFX Output');
}

/** What's present on this machine. Spawns `calibre-customize` (~1s of Python
 * startup) only when Calibre is actually present. */
export async function kfxStatus(): Promise<KfxStatus> {
  const customize = calibreTool('calibre-customize');
  const calibre = customize !== null;
  const previewer = previewerPath() !== null;
  const installed = calibre ? await pluginInstalled(customize) : false;
  return { calibre, previewer, pluginInstalled: installed, ready: calibre && previewer && installed };
}

/** Convert an EPUB to KFX. Runs the same guard trio as the AZW3 recipe, from
 * the same constant, so a device-validated flag change lands on both rungs or
 * neither. Writes to a scratch path and renames into place, so a partial file
 * never appears where a freshness check would trust it. Most of the wall-clock
 * is Kindle Previewer cold-starting, hence onStage. */
export async function toKfx(epub: string, onStage?: (stage: string) => void): Promise<string> {
  const tool = calibreTool('ebook-convert');
  if (!tool) throw new CalibreMissingError();
  const kfx = `${epub.replace(/\.epub$/i, '')}.kfx`;
  const scratch = `${kfx}.${process.pid}.tmp`;
  onStage?.('converting to KFX (Kindle Previewer can take ~20s to start)…');
  try {
    await runCalibre(tool, [epub, scratch, ...CALIBRE_FORMAT_GUARDS]);
    if (!existsSync(scratch)) {
      throw new CalibreFailedError('ebook-convert exited cleanly but produced no .kfx');
    }
    rmSync(kfx, { force: true });
    renameSync(scratch, kfx);
  } catch (error) {
    rmSync(scratch, { force: true });
    throw error;
  }
  return kfx;
}
```

`toKfx` needs `runCalibre`, `CalibreMissingError`, `CalibreFailedError` and
`CALIBRE_FORMAT_GUARDS` from Task 10. Export the runner there — rename the
private `run` helper in `src/export/calibre.ts` to `runCalibre` and add
`export` to it — and import here alongside `existsSync`, `renameSync`,
`rmSync` from `node:fs`.

- [ ] **Step 4: Run tests**

Run: `bun test tests/export-kfx.test.ts && bunx tsc --noEmit`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/export/kfx.ts tests/export-kfx.test.ts
git commit -m "KFX toolchain discovery, degrading correctly off macOS"
```

---

### Task 12: `src/export/artifact.ts`

**Files:**
- Create: `src/export/artifact.ts`
- Test: `tests/export-artifact.test.ts`

**Interfaces:**
- Consumes: `needsRegeneration` (Task 8), `fileExtension`/`ToolchainState` (Task 9), `toAzw3` (Task 10), `convertFountain` from `src/convert.ts`.
- Produces:
  - `mobiSibling(epub: string): string`
  - `availableFormats(epub: string, calibreAvailable: boolean): ExportFormat[]`
  - `freshKindleArtifact(opts: { epub: string; fountainPath: string | null; format: FormatOptions; calibreAvailable: boolean; kfxReady: boolean; onStage?: (stage: string) => void }): Promise<string>`
  - `class CannotRegenerateError extends Error`

**Note.** `kfxReady` has no default on purpose: a call site that forgot it would compile and silently drop the best rung — exactly the drift the ladder exists to prevent.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_FORMAT_OPTIONS } from '../src/options';
import { mobiSibling, availableFormats, freshKindleArtifact, CannotRegenerateError } from '../src/export/artifact';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'screepub-test-'));
}

test('the MOBI sibling shares the EPUB directory and stem', () => {
  expect(mobiSibling(join('/tmp', 'lib', 'Script.epub'))).toBe(join('/tmp', 'lib', 'Script.mobi'));
});

test('EPUB is always available; Kindle needs Calibre or an existing .mobi', () => {
  const dir = scratch();
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'epub');

  expect(availableFormats(epub, false)).toEqual(['epub']);
  expect(availableFormats(epub, true)).toEqual(['epub', 'kindle']);

  writeFileSync(mobiSibling(epub), 'mobi');
  expect(availableFormats(epub, false)).toEqual(['epub', 'kindle']);
});

test('a fresh .mobi beside the EPUB is reused rather than rebuilt', async () => {
  const dir = scratch();
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'epub');
  const mobi = mobiSibling(epub);
  writeFileSync(mobi, 'existing-mobi');

  const out = await freshKindleArtifact({
    epub,
    fountainPath: null,
    format: DEFAULT_FORMAT_OPTIONS,
    calibreAvailable: false,
    kfxReady: false,
  });
  expect(out).toBe(mobi);
  expect(readFileSync(mobi, 'utf8')).toBe('existing-mobi');
});

test('a stale .mobi with no .fountain to rebuild from is an honest error', async () => {
  const dir = scratch();
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'epub'); // written AFTER nothing — no .mobi exists at all
  await expect(
    freshKindleArtifact({
      epub,
      fountainPath: null,
      format: DEFAULT_FORMAT_OPTIONS,
      calibreAvailable: false,
      kfxReady: false,
    }),
  ).rejects.toThrow(CannotRegenerateError);
});

test('the MOBI branch rebuilds from the .fountain and writes a .mobi', async () => {
  const dir = scratch();
  const fountain = join(dir, 'Script.fountain');
  writeFileSync(fountain, 'Title: Test\n\nINT. ROOM - DAY\n\nA line of action.\n');
  const epub = join(dir, 'Script.epub');
  writeFileSync(epub, 'stale');

  const out = await freshKindleArtifact({
    epub,
    fountainPath: fountain,
    format: DEFAULT_FORMAT_OPTIONS,
    calibreAvailable: false,
    kfxReady: false,
  });
  expect(out).toBe(mobiSibling(epub));
  expect(existsSync(out)).toBe(true);
  // Documented side effect: this branch rewrites the EPUB in place.
  expect(readFileSync(epub, 'utf8')).not.toBe('stale');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/export-artifact.test.ts`
Expected: FAIL — cannot resolve `../src/export/artifact`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/export/artifact.ts
import { existsSync, writeFileSync } from 'node:fs';
import { convertFountain } from '../convert';
import type { FormatOptions } from '../options';
import { toAzw3 } from './calibre';
import { needsRegeneration } from './freshness';
import type { ExportFormat } from './formats';
import { toKfx } from './kfx';

export class CannotRegenerateError extends Error {
  constructor() {
    super("Can't rebuild the Kindle file — the script's .fountain is missing.");
    this.name = 'CannotRegenerateError';
  }
}

/** The sibling `.mobi` for a given EPUB — same directory, same stem. Shared
 * by availableFormats and freshKindleArtifact so the derivation lives in
 * exactly one place; call sites go through those two. */
export function mobiSibling(epub: string): string {
  return `${epub.replace(/\.epub$/i, '')}.mobi`;
}

/** EPUB is always available (it is the conversion's primary output). The
 * Kindle format needs either Calibre (converts from the current EPUB) or an
 * already-built .mobi to refresh. */
export function availableFormats(epub: string, calibreAvailable: boolean): ExportFormat[] {
  const formats: ExportFormat[] = ['epub'];
  if (calibreAvailable || existsSync(mobiSibling(epub))) formats.push('kindle');
  return formats;
}

export interface FreshKindleArtifactOptions {
  epub: string;
  fountainPath: string | null;
  /** Must be the script's real settings, not the defaults, or the export
   * silently loses the user's tuned formatting. */
  format: FormatOptions;
  calibreAvailable: boolean;
  kfxReady: boolean;
  onStage?: (stage: string) => void;
}

/** A Kindle-format file guaranteed current with `epub`. Calibre converts
 * straight from the present EPUB, so that branch is fresh by construction;
 * the MOBI branch re-runs the engine only when the staleness rule says the
 * file is out of date.
 *
 * NOTE: the MOBI branch REWRITES `epub` in place before it writes the .mobi
 * beside it — this function can mutate the EPUB it was handed, not just
 * produce the Kindle file. */
export async function freshKindleArtifact(opts: FreshKindleArtifactOptions): Promise<string> {
  const { epub, fountainPath, format, calibreAvailable, kfxReady, onStage } = opts;

  if (kfxReady) {
    // Same staleness rule as the MOBI branch: the EPUB is the sole input and
    // the flags are constant, so a sibling .kfx no older than its EPUB is the
    // previous run's answer — reusing it turns a ~20s Kindle Previewer cold
    // start into a file stat. toKfx writes scratch-then-rename, so a partial
    // file never appears at this path to be trusted.
    const kfx = `${epub.replace(/\.epub$/i, '')}.kfx`;
    if (!needsRegeneration(kfx, epub)) return kfx;
    return toKfx(epub, onStage);
  }

  if (calibreAvailable) {
    onStage?.('converting to AZW3 for Kindle…');
    return toAzw3(epub);
  }

  const mobi = mobiSibling(epub);
  if (!needsRegeneration(mobi, epub)) return mobi;
  if (!fountainPath) throw new CannotRegenerateError();

  onStage?.('rebuilding the Kindle file…');
  const fountainText = await Bun.file(fountainPath).text();
  const result = await convertFountain(fountainText, { format, mobi: true });
  writeFileSync(epub, result.epub);
  if (!result.mobi) {
    throw new Error('the engine reported success but produced no .mobi');
  }
  writeFileSync(mobi, result.mobi);
  return mobi;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/export-artifact.test.ts && bunx tsc --noEmit`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/export/artifact.ts tests/export-artifact.test.ts
git commit -m "Kindle artifact freshness and rebuild, in TypeScript"
```

---

### Task 13: `src/device/remarkable.ts`

Three behaviors are load-bearing, each with its own assertion: the size cap is checked **before any network call**; the root listing must succeed before the upload, because `/upload` writes into whichever folder the interface listed last; and a failed listing aborts rather than firing blind.

**Files:**
- Create: `src/device/remarkable.ts`
- Test: `tests/device-remarkable.test.ts`

**Interfaces:**
- Produces:
  - `REMARKABLE_USB_ADDRESS: string`, `REMARKABLE_ENDPOINT: string`
  - `REMARKABLE_MAX_UPLOAD_BYTES: number`
  - `probeRemarkable(endpoint?: string, timeoutMs?: number): Promise<boolean>`
  - `uploadToRemarkable(file: string, endpoint?: string): Promise<void>`
  - `class RemarkableUploadError extends Error`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, truncateSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  REMARKABLE_ENDPOINT,
  REMARKABLE_MAX_UPLOAD_BYTES,
  probeRemarkable,
  uploadToRemarkable,
} from '../src/device/remarkable';

/** Records the request sequence, mirroring kit-check's StubRemarkable. The
 * real interface's /upload writes into the LAST-LISTED folder, so "upload to
 * root" is only true if root is listed immediately before the POST. */
function stub() {
  const requests: string[] = [];
  let documentsStatus = 200;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      requests.push(`${req.method} ${path}`);
      if (req.method === 'POST') await req.arrayBuffer();
      const status = path.startsWith('/documents') ? documentsStatus : 200;
      return new Response('[]', { status });
    },
  });
  return {
    requests,
    url: `http://127.0.0.1:${server.port}`,
    reset: () => requests.splice(0, requests.length),
    setDocumentsStatus: (s: number) => { documentsStatus = s; },
    stop: () => server.stop(true),
  };
}

const s = stub();
afterAll(() => s.stop());

function book(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), 'Script.epub');
  writeFileSync(path, 'epub');
  return path;
}

test('the fixed USB endpoint is the documented address', () => {
  expect(REMARKABLE_ENDPOINT).toBe('http://10.11.99.1');
});

test('upload lists the root folder immediately before posting', async () => {
  s.reset();
  await uploadToRemarkable(book(), s.url);
  expect(s.requests).toEqual(['GET /documents/', 'POST /upload']);
});

test('probe asks for the documents listing, not the bare root', async () => {
  s.reset();
  expect(await probeRemarkable(s.url)).toBe(true);
  expect(s.requests).toEqual(['GET /documents/']);
});

test('a failed root listing aborts the send with no blind POST', async () => {
  s.reset();
  s.setDocumentsStatus(500);
  await expect(uploadToRemarkable(book(), s.url)).rejects.toThrow();
  expect(s.requests).not.toContain('POST /upload');
  s.setDocumentsStatus(200);
});

test('a file over the 100 MB cap is rejected before any network request', async () => {
  s.reset();
  const big = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), 'big.epub');
  closeSync(openSync(big, 'w'));
  truncateSync(big, REMARKABLE_MAX_UPLOAD_BYTES + 1); // sparse: instant to make
  await expect(uploadToRemarkable(big, s.url)).rejects.toThrow('100 MB');
  expect(s.requests).toEqual([]);
});

test('only PDF and EPUB are accepted', async () => {
  s.reset();
  const azw3 = join(mkdtempSync(join(tmpdir(), 'screepub-test-')), 'Script.azw3');
  writeFileSync(azw3, 'x');
  await expect(uploadToRemarkable(azw3, s.url)).rejects.toThrow('azw3');
  expect(s.requests).toEqual([]);
});

test('probe reports false when nothing is serving', async () => {
  expect(await probeRemarkable('http://127.0.0.1:1', 500)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/device-remarkable.test.ts`
Expected: FAIL — cannot resolve `../src/device/remarkable`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/device/remarkable.ts
// reMarkable tablets never mount as a volume (no mass storage, no MTP). With
// "USB web interface" enabled in the tablet's storage settings, the device
// serves plain HTTP on its fixed USB-ethernet address; files are added with a
// multipart POST. EPUB and PDF only.
import { statSync } from 'node:fs';
import { basename, extname } from 'node:path';

/** The tablet's fixed address on the USB link, same on every unit. */
export const REMARKABLE_USB_ADDRESS = [10, 11, 99, 1].join('.');
export const REMARKABLE_ENDPOINT = `http://${REMARKABLE_USB_ADDRESS}`;

/** Paper Pro's web interface caps uploads here. */
export const REMARKABLE_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export class RemarkableUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemarkableUploadError';
  }
}

/** The root-folder listing URL. Listing is also STATE on the tablet: /upload
 * has no destination parameter and writes into whichever folder the interface
 * listed last, so this GET doubles as the aim taken immediately before every
 * shot. */
function documentsUrl(endpoint: string): string {
  return new URL('documents/', `${endpoint.replace(/\/$/, '')}/`).toString();
}

/** True when the USB web interface answers — i.e. the tablet is docked over
 * USB with the interface enabled. Cheap enough to poll. */
export async function probeRemarkable(
  endpoint: string = REMARKABLE_ENDPOINT,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const response = await fetch(documentsUrl(endpoint), {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/** Upload a PDF or EPUB to the tablet's root folder. "Root" is made true, not
 * assumed: /upload writes into the last-listed folder (server-side state), so
 * root is listed first and a failed listing aborts the send rather than fire
 * blind into the wrong folder. */
export async function uploadToRemarkable(
  file: string,
  endpoint: string = REMARKABLE_ENDPOINT,
): Promise<void> {
  const ext = extname(file).replace(/^\./, '').toLowerCase();
  if (ext !== 'pdf' && ext !== 'epub') {
    throw new RemarkableUploadError(`reMarkable accepts PDF and EPUB, not .${ext}.`);
  }

  // Fail the whole send before any bytes move or any state changes.
  const size = statSync(file).size;
  if (size > REMARKABLE_MAX_UPLOAD_BYTES) {
    throw new RemarkableUploadError(
      `this file is ${Math.floor(size / (1024 * 1024))} MB; the tablet's USB web interface accepts up to 100 MB.`,
    );
  }

  const listing = await fetch(documentsUrl(endpoint), {
    method: 'GET',
    signal: AbortSignal.timeout(10_000),
  });
  if (listing.status !== 200) {
    throw new RemarkableUploadError(
      `couldn't open the tablet's root folder (HTTP ${listing.status}); nothing was uploaded.`,
    );
  }

  const form = new FormData();
  const mime = ext === 'pdf' ? 'application/pdf' : 'application/epub+zip';
  form.append('file', new File([await Bun.file(file).arrayBuffer()], basename(file), { type: mime }));

  const response = await fetch(new URL('upload', `${endpoint.replace(/\/$/, '')}/`).toString(), {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new RemarkableUploadError(`reMarkable upload failed (HTTP ${response.status}).`);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/device-remarkable.test.ts && bunx tsc --noEmit`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/device/remarkable.ts tests/device-remarkable.test.ts
git commit -m "reMarkable probe and upload, with the listing-before-upload rule"
```

---

### Task 14: `src/device/volumes.ts`

The last and thinnest module: the only code in this port that cannot be unit-tested against reality, isolated so that everything around it can be.

**Files:**
- Create: `src/device/volumes.ts`
- Test: `tests/device-volumes.test.ts`

**Interfaces:**
- Consumes: `classify`, `volumeName` (Task 6), `ConnectedDevice` (Task 5).
- Produces:
  - `volumeRoots(): string[]`
  - `enumerateVolumes(roots?: string[]): string[]`
  - `mountedDevices(roots?: string[]): ConnectedDevice[]`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { platform } from 'node:process';
import { volumeRoots, enumerateVolumes, mountedDevices } from '../src/device/volumes';

/** A fake mount root holding several "volumes", so enumeration is tested by
 * injection and never against whatever is really plugged into this machine. */
function mountRoot(volumes: Record<string, string[]>): string {
  const root = mkdtempSync(join(tmpdir(), 'screepub-mounts-'));
  for (const [name, subdirs] of Object.entries(volumes)) {
    mkdirSync(join(root, name), { recursive: true });
    for (const sub of subdirs) mkdirSync(join(root, name, sub), { recursive: true });
  }
  return root;
}

test('enumerate lists the directories under an injected root', () => {
  const root = mountRoot({ Kindle: ['documents'], KOBOeReader: ['.kobo'], 'USB STICK': [] });
  expect(enumerateVolumes([root]).map(basename).sort())
    .toEqual(['KOBOeReader', 'Kindle', 'USB STICK'].sort());
});

test('enumerate ignores files and missing roots', () => {
  const root = mountRoot({ Kindle: ['documents'] });
  writeFileSync(join(root, 'loose-file.txt'), 'x');
  const found = enumerateVolumes([root, join(tmpdir(), 'screepub-no-such-root')]);
  expect(found.map(basename)).toEqual(['Kindle']);
});

test('mountedDevices classifies what it finds and drops plain drives', () => {
  const root = mountRoot({ Kindle: ['documents'], KOBOeReader: ['.kobo'], 'USB STICK': ['documents'] });
  const devices = mountedDevices([root]);
  expect(devices.map((d) => d.kind).sort()).toEqual(['kindle', 'kobo']);
  expect(devices.find((d) => d.kind === 'kobo')?.name).toBe('KOBOeReader');
  expect(devices.every((d) => d.volume !== null)).toBe(true);
});

test('mountedDevices on an empty root finds nothing', () => {
  expect(mountedDevices([mountRoot({})])).toEqual([]);
});

test('the default roots are the right ones for this platform', () => {
  const roots = volumeRoots();
  if (platform === 'darwin') expect(roots).toEqual(['/Volumes']);
  if (platform === 'linux') {
    expect(roots.some((r) => r.startsWith('/run/media'))).toBe(true);
    expect(roots).toContain('/media');
  }
  if (platform === 'win32') expect(roots.some((r) => /^[A-Z]:\\$/.test(r))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/device-volumes.test.ts`
Expected: FAIL — cannot resolve `../src/device/volumes`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/device/volumes.ts
// The ONLY part of the device layer that cannot be unit-tested against
// reality: what is actually mounted depends on what is physically plugged in.
// Kept deliberately dumb, with injectable roots, so that all the real device
// knowledge lives in classify.ts where it can be tested everywhere.
import { readdirSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { platform } from 'node:process';
import { classify, volumeName } from './classify';
import type { ConnectedDevice } from './types';

/** Where this OS mounts removable media. On Windows these are drive roots
 * rather than a parent directory, so enumerateVolumes treats a root that is
 * itself a volume correctly by listing its PARENT's children — see below. */
export function volumeRoots(): string[] {
  if (platform === 'darwin') return ['/Volumes'];
  if (platform === 'win32') {
    // Drive letters are themselves volumes, so each is returned as a root
    // whose single child is itself. C: is skipped: it is the system disk.
    return 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => `${letter}:\\`);
  }
  const user = userInfo().username;
  return [`/run/media/${user}`, `/media/${user}`, '/media'];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Every mounted volume path under the given roots (default: this platform's).
 * On Windows a root IS a volume; elsewhere a root CONTAINS volumes. */
export function enumerateVolumes(roots: string[] = volumeRoots()): string[] {
  const found: string[] = [];
  for (const root of roots) {
    if (!isDirectory(root)) continue;
    if (platform === 'win32' && /^[A-Z]:\\$/.test(root)) {
      found.push(root);
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(root, entry);
      if (isDirectory(path)) found.push(path);
    }
  }
  return found;
}

/** All recognized devices among currently mounted volumes. */
export function mountedDevices(roots?: string[]): ConnectedDevice[] {
  const devices: ConnectedDevice[] = [];
  for (const volume of enumerateVolumes(roots)) {
    const kind = classify(volume);
    if (!kind) continue;
    devices.push({ kind, name: volumeName(volume), volume });
  }
  return devices;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/device-volumes.test.ts && bunx tsc --noEmit`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the whole suite and the additive constraint**

Run:
```bash
bun test && bunx tsc --noEmit && git status --short app/
```
Expected: all tests pass (606 original + the new ones), `tsc` clean, and **`git status --short app/` prints nothing** — no file under `app/` was modified.

- [ ] **Step 6: Commit**

```bash
git add src/device/volumes.ts tests/device-volumes.test.ts
git commit -m "Per-OS volume enumeration, the one untestable seam"
```

---

## Final Verification

- [ ] **Run the whole suite on Linux with Calibre installed**

Run: `bun test && bunx tsc --noEmit`
Expected: all pass, `tsc` clean.

- [ ] **Run it again with Calibre hidden, to prove the self-skips work**

Run: `PATH=/usr/bin:/bin bun test tests/export-calibre.test.ts tests/export-kfx.test.ts`
Expected: pass, with the two conversion tests skipped rather than failed. (If Calibre is installed at `/usr/bin`, temporarily rename it or run in a container instead — the point is to prove a bare runner stays green.)

- [ ] **Confirm the additive constraint held**

Run: `git diff --stat main -- app/`
Expected: no output.

- [ ] **Confirm the assertion ledger**

Walk `app/Sources/KitCheck/main.swift` and confirm every in-scope assertion has a counterpart in the new tests. In-scope groups: Kindle volume detection (4), copy semantics (3), multi-vendor detection (4), per-vendor copy destinations (3), ebook-convert discovery (2), reMarkable protocol (8), sidecar (6 + 18 override rows + completeness). Out of scope and intentionally absent: the `EngineResult` contract decode (`Engine.swift` is not ported), `format-defaults.json` ↔ `FormatSettings` sync (the Swift file survives until piece F, and `tests/options.test.ts` already pins the JSON), and the feedback issue URL (piece C).
