// Preloaded before every test file by bunfig.toml's [test] section. From
// piece C onward the engine reads the app settings file on ordinary code
// paths (src/library.ts's libraryRoot, and soon every conversion), so a
// test that calls a CLI handler in-process, or spawns `bun src/cli.ts`
// without setting SCREEPUB_CONFIG_DIR itself, would otherwise read Sam's
// REAL settings file, and the suite's answers would then depend on
// whatever he last chose in the app.
//
// The guard: point SCREEPUB_CONFIG_DIR somewhere a read finds nothing and a
// write fails LOUDLY, so a test that forgets to inject its own path cannot
// silently create a file there and have it leak into a later test's answer.
// A path under /dev/null does both on POSIX, because /dev/null is a
// character device, not a directory: readFileSync underneath it fails with
// ENOTDIR (there is nothing to read) and mkdirSync(..., { recursive: true })
// fails with ENOTDIR too (there is nothing a folder can be made inside of).
// Verified by hand on this Mac before relying on it here, not assumed.
//
// `bun test` runs only on macOS and Ubuntu in CI (see
// .github/workflows/ci.yml and release.yml's `checks` job). Neither runs
// this suite on Windows, so a POSIX-only answer is acceptable.
//
// THIS FILE IS ONLY HALF THE GUARD. Mutating process.env here covers code
// in this same process that reads it directly, and covers a Bun.spawn call
// that explicitly forwards {...process.env}. It does NOT cover a
// Bun.spawn call with no `env` option at all, and the suite has many of
// those (tests/cli.test.ts, tests/cli-settings.test.ts,
// tests/field-station.test.ts, and others spawn `bun src/cli.ts` bare).
// Verified on bun 1.3.14: a runtime `process.env.X = value` assignment is
// invisible to that default, because Bun.spawn without `env` draws from
// the environment bun itself started with, not the live process.env
// object. Confirmed with a non-Bun child (`printenv`) too, so it is not a
// quirk of spawning `bun` specifically. The OTHER half is root
// `.env.test`, which bun loads natively before any JS runs and which is
// therefore baked into that starting environment; see the comment there.
// Keep the two values identical. Nothing enforces that they agree.
//
// Only set when unset. A developer who deliberately points
// SCREEPUB_CONFIG_DIR somewhere of their own choosing, to inspect a real
// run against a real-looking settings file, is not overridden by their own
// test suite. In an ordinary `bun test` run this branch never actually
// fires, because .env.test has already set the variable by the time this
// preload runs. It is here for the code path that reads process.env
// directly in this process, and as a fallback if dotenv loading is ever
// disabled.
if (!process.env.SCREEPUB_CONFIG_DIR) {
  process.env.SCREEPUB_CONFIG_DIR = '/dev/null/screepub-test-guard';
}
