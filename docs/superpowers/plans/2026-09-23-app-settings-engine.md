# The Gear, Engine Half: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The engine honours a user-chosen library folder and a user's own app-wide format defaults, and a new `screepub app-settings` verb reads and changes both.

**Architecture:** Both live in the app settings file (`src/settings/app.ts`, already built, shared with piece B). `libraryRoot()` reads the folder; a new `appDefaultOptions()` becomes the base under every script where the shipped defaults are the base today.

**Tech Stack:** Bun + TypeScript, bun:test.

**Spec:** [2026-09-23-app-settings-gear-design.md](../specs/2026-09-23-app-settings-gear-design.md).

---

## Ground rules for every task

- Worktree: `/Users/CWP_MBP_SGS2/Documents/CODING_PROJECTS/Projects/02_Darkwell/Screepub/.claude/worktrees/parity-c-gear`, branch `parity-c-gear`. Absolute paths; never `cd` to the main checkout or to other worktrees. (Piece B is being built at the same time in `.claude/worktrees/epic-neumann-254843` on `parity-b-routes`; do not touch it.)
- TDD: failing test first, see it fail for the stated reason, implement, pass. `bunx tsc --noEmit` clean before each commit.
- **No em dash (`—`) in any string a person reads** that you add. Colons, periods, commas.
- **No test may read or write the real app settings file or the real library.** Set `SCREEPUB_CONFIG_DIR` and `SCREEPUB_LIBRARY` (or pass explicit paths) into the test file's SCRATCH folder. Beware: `libraryRoot()` checks `SCREEPUB_LIBRARY` FIRST, so a test of the chosen-folder branch must leave `SCREEPUB_LIBRARY` unset in the env object it passes and supply the settings path explicitly.
- Temp folders follow `tests/temp-hygiene.test.ts` (one top-level SCRATCH per file, removed in a top-level afterAll).
- Handlers return values; `src/cli.ts` owns stdout. Every verb refuses other verbs' flags and stray positionals BEFORE acting, with the existing wording. This plan adds NO new flag to the shared verb schema: `app-settings` reuses `--set`.
- Do not touch `desktop/`, `app/`, the parser, the renderers, `format-defaults.json`, `src/options.ts`'s defaults, or the preset definitions.
- Commit trailer: `Co-Authored-By: <your model name> <noreply@anthropic.com>`.
- Mutation scripts under the session scratchpad named `c<task>-mutants.ts`, restoring in `finally`.

---

### Task 1: The chosen library folder

Read `src/library.ts` (all of `libraryRoot`), `src/settings/app.ts`, and `tests/library.test.ts`.

**Behaviour:** `libraryRoot(platform, env, settingsPath?)`: after the `SCREEPUB_LIBRARY` check and before the platform default, read `readAppSettings(settingsPath ?? appSettingsPath(platform, env)).libraryPath`; use it when it is a string that is absolute FOR THAT PLATFORM (posix/win32 flavour, as the function already does), resolved. Anything else falls through. Callers that pass no settings path get the real file (production), tests always pass one.

Watch the default parameters: `libraryOutput(input, root = libraryRoot())` and `existingLibraryOutput` call it with no arguments; keep that working.

**Tests** (extend `tests/library.test.ts`): env override beats a stored folder; a stored absolute folder beats the platform default (darwin and win32 flavours); a stored relative path, a number, and an empty string all fall through to the default; a missing or corrupt settings file falls through; `libraryOutput` of a real SCRATCH PDF lands under the stored folder when a settings path is injected (add the parameter plumbing needed for that, minimal).

- [ ] Commit "The library goes where the user chose, after SCREEPUB_LIBRARY and before the default".

---

### Task 2: App defaults are the base under every script

**New** `src/settings/app-defaults.ts`:

```ts
export function appDefaultOptions(settingsPath?: string): FormatOptions; // resolveFormatOptions(stored ?? {}, DEFAULT_FORMAT_OPTIONS)
export function appDefaultsCustomized(settingsPath?: string): boolean;   // deep-unequal to DEFAULT_FORMAT_OPTIONS
```

A stored `formatDefaults` that is not a plain object reads as absent.

**Wire it in** wherever `DEFAULT_FORMAT_OPTIONS` is passed as a script's BASE (grep `DEFAULT_FORMAT_OPTIONS` across `src/`):
- `src/cli.ts` conversion: `readScriptSettings(candidate, <app defaults>)`, and when no sidecar applies, the options handed to the conversion must be `resolveFormatOptions(format ?? {}, <app defaults>)` so an unsaved script still starts from the user's defaults. Read how `convertPdf`/`convertFountain` resolve `opts.format` (`src/convert.ts`) and make sure the app defaults are not resolved away there.
- `src/cli-settings.ts`: the fallback under the sidecar; the answer gains `appDefaults: FormatOptions` (keep `defaults` as the shipped object).
- `src/cli-export.ts` `readFormat`: with no `--options-json`, the app defaults.
- Leave alone anything that means Screepub's own defaults (presets, `matchingPreset`, the `defaults` answer field, anything pinned to `format-defaults.json`).

Give each touched handler an injectable settings path (a deps field or option) so its tests use SCRATCH; the spawned CLI tests set `SCREEPUB_CONFIG_DIR`.

**Tests:** precedence, knob by knob, on a knob whose shipped default you can see (pick one from `format-defaults.json`): shipped only; app default over shipped; sidecar over app default; `--options-json` over sidecar. For the conversion path, a spawned `bun src/cli.ts <tests/fixtures/screenplay.pdf> --json -o <scratch>/x.epub` with an app default that changes a knob visible in the output (choose one whose effect you can assert from the EPUB or the `--preview-inline` document; read `src/options.ts` and `docs/formatting-options-log.md` to pick one) proves the conversion honours it. `settings` answer includes `appDefaults`. A corrupt settings file changes nothing (shipped defaults).

- [ ] Commit "App defaults: the user's own starting point, under every script's sidecar".

---

### Task 3: `screepub app-settings [--set <json>] [--json]`

**Handler** `src/cli-app-settings.ts`: `appSettingsCommand({ set?: string }, deps?: { settingsPath?, platform?, env? })`.

- `--set` must be a JSON object whose keys are only `libraryPath` and/or `formatDefaults`, else `CliError('usage', ...)` naming the allowed keys. Not JSON / not an object → `bad-settings`.
- `libraryPath`: `null` removes it. A string must be absolute (else `bad-settings`: `the library folder must be a full path`); the folder is created (`mkdirSync recursive`) and checked writable (`accessSync W_OK`); failure → `bad-settings`: `cannot use <path> as the library: <reason>`, and NOTHING is stored (validate everything before writing anything).
- `formatDefaults`: `null` removes it. An object goes through `resolveFormatOptions(obj, DEFAULT_FORMAT_OPTIONS)` and the FULL resolved object is stored.
- One `writeAppSettings` call with both changes; `lastRoute` untouched.
- Answer: `{ file, library: { path, chosen, platformDefault, fromEnv }, formatDefaults, shippedDefaults, customized }` (see the spec).

**CLI:** `VERBS` gains `app-settings` (update the pin in `tests/cli-devices.test.ts` with a dated comment; piece B adds `routes` and `route` on its own branch, so expect a merge there, not a conflict you should pre-empt); usage line `screepub app-settings [--set <json>] [--json]  where books land, and what new scripts start from`; its own `--help`; accepts `--set`, `--json`, `--help`; refuses every other flag and any positional. Human output: the folder (and whether chosen or default or from the environment), then `new scripts start from: Screepub's defaults` or `your own defaults`.

**Tests** (`tests/cli-app-settings.test.ts`): reading with no file; setting and resetting each key; unknown key refused with nothing written (file absent after); relative path refused, nothing written; an unwritable folder (create one in SCRATCH and chmod 0o500; skip on win32) refused, nothing written; both keys in one call write once; `lastRoute` survives a write; `fromEnv` true when SCREEPUB_LIBRARY is set in the injected env; spawned refusals and `--help`.

- [ ] Commit "screepub app-settings: choose where books land and what new scripts start from".

---

### Task 4: Docs and the whole suite

- `README.md` "The library" section: the chosen folder and its precedence (`SCREEPUB_LIBRARY` > chosen > default), app defaults and their place in the precedence, the `app-settings` verb, and where the settings file lives per platform.
- `docs/formatting-options-log.md`: one dated line that app defaults now sit between the shipped defaults and a script's sidecar (read its format first).
- `bun test` and `bunx tsc --noEmit` green; em-dash check over the branch diff clean.
- [ ] Commit "Docs: the library folder and app defaults".
