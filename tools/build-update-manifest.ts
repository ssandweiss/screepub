// latest.json, the static manifest the in-app updater reads.
//
//   bun tools/build-update-manifest.ts --dir arrivals --version v0.6.1 --out arrivals/latest.json
//
// The updater plugin fetches ONE file from the endpoint in tauri.conf.json
// and reads, under `platforms.<os>-<arch>`, a `url` to download and the
// CONTENT of that file's `.sig`. This writes that file in release.yml's
// app-upload job, over the directory every bundle leg's artifacts were
// downloaded into, so the manifest describes the files that are actually
// published beside it. Same rule as SHA256SUMS-app, same reason: no leg
// ever saw the others.
//
// Data-driven off UPDATER_KINDS in build-app-bundle.ts: the published
// name and the platform keys have one definition, and this tool reads
// them back off the filename. A `.sig` whose artifact no row recognises
// is an ERROR, not a skip. When Linux or Windows signing is switched on,
// the manifest refuses to go out until the row that maps them exists.
//
// Why this is a tool and not YAML: the same reason as every other file
// in this directory. A manifest that names the wrong platform, or pastes
// a signature with a byte missing, is a bug report from a stranger whose
// update failed. This can be run against a directory on a laptop.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { SIGNATURE_EXT, UPDATER_KINDS, type PlatformKey } from './build-app-bundle';
import { parseSignatureBox } from './update-signature';

export const RELEASE_REPO = 'ssandweiss/screepub';
export const MANIFEST_NAME = 'latest.json';

/** Where the app looks. `releases/latest/download/<asset>` is GitHub's
 *  redirect to the newest non-prerelease, non-draft release's asset, so
 *  the app never has to know a version to ask about one. tauri.conf.json
 *  carries this exact string, and a test holds the two together. */
export function manifestEndpoint(repo: string = RELEASE_REPO): string {
  return `https://github.com/${repo}/releases/latest/download/${MANIFEST_NAME}`;
}

/** A release asset's stable download address. */
export function assetUrl(repo: string, version: string, name: string): string {
  return `https://github.com/${repo}/releases/download/v${version}/${name}`;
}

export function releasePageUrl(repo: string, version: string): string {
  return `https://github.com/${repo}/releases/tag/v${version}`;
}

export interface SignedArtifact {
  /** The published filename, which is also the asset name on the release. */
  name: string;
  /** The `.sig` file's contents, verbatim: what the manifest carries. */
  signature: string;
  platforms: PlatformKey[];
}

export interface ManifestPlatform {
  signature: string;
  url: string;
}

/** The shape tauri-plugin-updater deserialises (updater.rs, RemoteRelease):
 *  `version`, optional `notes` and `pub_date`, and `platforms`. */
export interface Manifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, ManifestPlatform>;
}

/** Every `<artifact>.sig` in `dir`, with the artifact beside it, read into
 *  the entry the manifest needs. Sorted by name so the output is stable. */
export function collectSignedArtifacts(dir: string): SignedArtifact[] {
  if (!existsSync(dir)) {
    throw new Error(`build-update-manifest: no such directory: ${dir}`);
  }
  const names = readdirSync(dir).sort();
  const out: SignedArtifact[] = [];
  for (const sigName of names) {
    if (!sigName.endsWith(SIGNATURE_EXT)) continue;
    const name = sigName.slice(0, -SIGNATURE_EXT.length);
    if (!names.includes(name)) {
      throw new Error(
        `build-update-manifest: ${sigName} has no such artifact beside it (${name} is missing ` +
          `from ${dir}). A signature for a file that did not arrive must not be published.`,
      );
    }
    const kind = UPDATER_KINDS.find((k) => k.archOf(name) !== undefined);
    if (!kind) {
      throw new Error(
        `build-update-manifest: ${sigName} signs ${name}, and no row in UPDATER_KINDS ` +
          '(tools/build-app-bundle.ts) maps that artifact to a platform key. Add the row, or ' +
          'stop signing it; a signed artifact no platform can be offered is a manifest that lies ' +
          'by omission.',
      );
    }
    const signature = readFileSync(join(dir, sigName), 'utf8');
    try {
      parseSignatureBox(signature);
    } catch (err) {
      throw new Error(
        `build-update-manifest: ${sigName} is not a minisign signature: ${(err as Error).message}`,
      );
    }
    out.push({ name, signature, platforms: kind.platformKeys(kind.archOf(name)!) });
  }
  return out;
}

const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$/;

/** The manifest for `version` over what arrived.
 *
 *  Refuses a prerelease: GitHub's `releases/latest` never resolves to one,
 *  so a manifest for a prerelease would be published where the endpoint
 *  never reads, and would be wrong if it ever did. Refuses an empty set:
 *  an empty manifest is an endpoint that says "nothing" forever. Refuses
 *  a platform claimed twice: whichever entry won would win silently. */
export function renderManifest(
  version: string,
  artifacts: SignedArtifact[],
  opts: { repo?: string; now?: Date } = {},
): Manifest {
  const repo = opts.repo ?? RELEASE_REPO;
  const now = opts.now ?? new Date();
  const v = version.replace(/^v/, '');
  if (!VERSION_RE.test(v)) {
    throw new Error(
      `build-update-manifest: --version must be MAJOR.MINOR.PATCH (got ${JSON.stringify(version)}). ` +
        'The plugin parses it with semver, and a branch name here is a manifest no app can read.',
    );
  }
  if (v.includes('-')) {
    throw new Error(
      `build-update-manifest: ${v} is a prerelease. releases/latest/download never resolves to ` +
        'a prerelease, so no manifest is written for one.',
    );
  }
  if (artifacts.length === 0) {
    throw new Error(
      'build-update-manifest: no signed artifact to describe. Nothing arrived with a .sig ' +
        'beside it, so either the macOS leg did not run with --updater, or its upload failed.',
    );
  }
  const platforms: Record<string, ManifestPlatform> = {};
  for (const a of artifacts) {
    for (const key of a.platforms) {
      if (platforms[key]) {
        throw new Error(
          `build-update-manifest: ${key} is claimed by two artifacts (${a.name} and the one ` +
            `already at ${platforms[key].url}). One platform, one file.`,
        );
      }
      platforms[key] = { url: assetUrl(repo, v, a.name), signature: a.signature };
    }
  }
  return {
    version: v,
    notes: `Screepub ${v}. Release notes: ${releasePageUrl(repo, v)}`,
    pub_date: now.toISOString(),
    platforms,
  };
}

export interface ManifestArgs {
  dir: string;
  version: string;
  out: string;
  repo: string;
}

export function parseManifestArgs(argv: string[]): ManifestArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string' },
      version: { type: 'string' },
      out: { type: 'string' },
      repo: { type: 'string', default: RELEASE_REPO },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.dir) throw new Error('build-update-manifest: --dir <arrivals> is required');
  if (!values.version) throw new Error('build-update-manifest: --version <tag or version> is required');
  if (!values.out) throw new Error('build-update-manifest: --out <path to latest.json> is required');
  return {
    dir: resolve(values.dir),
    version: values.version,
    out: resolve(values.out),
    repo: values.repo ?? RELEASE_REPO,
  };
}

if (import.meta.main) {
  try {
    const args = parseManifestArgs(Bun.argv.slice(2));
    const artifacts = collectSignedArtifacts(args.dir);
    const manifest = renderManifest(args.version, artifacts, { repo: args.repo });
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${args.out} for ${manifest.version}:`);
    for (const [key, p] of Object.entries(manifest.platforms)) {
      console.log(`   ${key.padEnd(16)} ${p.url.slice(p.url.lastIndexOf('/') + 1)}`);
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
