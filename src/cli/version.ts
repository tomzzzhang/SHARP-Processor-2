/**
 * Build identity, and the one version check that can actually save a figure.
 *
 * `sharpplot.mjs` is copied, not linked — staged to `~/.claude/tools/`, zipped
 * into a `.skill` and uploaded to claude.ai, bundled to a colleague's machine.
 * Every copy is a snapshot that can silently fall behind the repo, and until
 * now nothing in the output said which build drew a figure.
 *
 * Two separate concerns, deliberately not conflated:
 *
 * 1. **Build identity** — version, commit, build date. Reported by
 *    `--version`, echoed by `figure`/`plot`, and recorded in the emitted
 *    bundle so an archived `fig.json` names the build that made it. This is
 *    informational: an old build is not automatically wrong.
 *
 * 2. **The `.sharpx` format gate** — this one is a correctness check, and it
 *    is a hard error. `format_version` in a `.sharpx` changes when the format
 *    changes. A build that predates a bump will parse a newer file with the
 *    rules it knows, ignore whatever is new, and render something that looks
 *    perfect and is missing data. That is the worst output this tool can
 *    produce, so it refuses rather than guesses — the same reason an unknown
 *    well name is an error instead of a silent omission.
 *
 * There is deliberately no "phone home and compare to the repo" check. The CLI
 * works offline by design; adding a network dependency to answer a question
 * `--version` already answers would be a bad trade.
 */
import { APP_VERSION } from '@/lib/constants';

/**
 * Highest `.sharpx` format version this build understands.
 *
 * Keep in step with `format_version` in `src/lib/sharp-writer.ts`. If you bump
 * it there, bump it here in the same commit — that pairing is the whole
 * mechanism. `1.1` single-channel, `1.2` multichannel.
 */
export const MAX_SHARPX_FORMAT = '1.2';

export interface BuildInfo {
  /** Processor version this CLI was built from. */
  version: string;
  /** Short git SHA, `-dirty` suffixed if the tree was modified. */
  commit: string;
  /** ISO-8601 UTC, second precision. */
  builtAt: string;
  /** Whole days between the build and now. */
  ageDays: number;
  maxSharpxFormat: string;
}

export function buildInfo(): BuildInfo {
  const builtAt = __SHARPPLOT_BUILT_AT__;
  const built = Date.parse(builtAt);
  const ageDays = Number.isFinite(built)
    ? Math.max(0, Math.floor((Date.now() - built) / 86_400_000))
    : 0;
  return {
    version: APP_VERSION,
    commit: __SHARPPLOT_COMMIT__,
    builtAt,
    ageDays,
    maxSharpxFormat: MAX_SHARPX_FORMAT,
  };
}

/** One line, for a stderr echo or a report field. */
export function buildStamp(): string {
  const b = buildInfo();
  return `sharpplot ${b.version} (${b.commit}, built ${b.builtAt.slice(0, 10)}, ${b.ageDays}d ago)`;
}

/** Full block for `--version`. */
export function versionText(): string {
  const b = buildInfo();
  const lines = [
    `sharpplot — figure CLI for SHARP Data Processor 2`,
    ``,
    `  Processor version   ${b.version}`,
    `  built from commit   ${b.commit}`,
    `  built at            ${b.builtAt}  (${b.ageDays} day${b.ageDays === 1 ? '' : 's'} ago)`,
    `  .sharpx format      understands up to ${b.maxSharpxFormat}`,
  ];
  if (b.commit === 'unknown') {
    lines.push(
      ``,
      `  This build could not read its own git commit, so it cannot be traced`,
      `  back to a source revision. Rebuild from a checkout to fix that.`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Compare dotted numeric versions. Returns <0, 0, >0. Non-numeric segments
 * sort as 0, so a hypothetical "1.2-beta" is treated as 1.2 rather than
 * throwing — the gate should fail closed on newer, not on unparseable.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? '0', 10) || 0;
    const nb = Number.parseInt(pb[i] ?? '0', 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** True when a file declares a format newer than this build understands. */
export function isNewerFormat(fileFormat: string): boolean {
  return compareVersions(fileFormat, MAX_SHARPX_FORMAT) > 0;
}

/**
 * The message shown when the gate trips. Written for someone who has never
 * seen this repo — it has to say what to do, not just what happened.
 */
export function newerFormatMessage(fileFormat: string, sourcePath: string): string {
  const b = buildInfo();
  return (
    `This file is newer than this copy of sharpplot.\n\n` +
    `  file           ${sourcePath}\n` +
    `  written as     .sharpx format ${fileFormat}\n` +
    `  this build     understands up to ${b.maxSharpxFormat}\n` +
    `  this build is  sharpplot ${b.version} (${b.commit}, built ${b.builtAt.slice(0, 10)})\n\n` +
    `It was saved by a newer SHARP Processor than the one this engine was built\n` +
    `from. Reading it with the old rules would quietly ignore whatever the new\n` +
    `format added, and the figure would look correct while being wrong — so it\n` +
    `stops here instead.\n\n` +
    `Fix: get a current build. If you are using the uploaded Claude skill, ask\n` +
    `Tom for a fresh sharpplot.skill (\`npm run skill:pack:cowork\`) and re-upload\n` +
    `it. In a checkout, \`npm run cli:build && npm run cli:install\`.\n\n` +
    `If you are certain the new format changed nothing that matters here, pass\n` +
    `--allow-newer-format to proceed anyway — and check the figure against the\n` +
    `desktop app before trusting it.`
  );
}
