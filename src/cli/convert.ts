/**
 * `sharpplot convert` — raw instrument file to `.sharpx`.
 *
 * The default handover is a `.sharpx` the user prepared in the GUI, but they
 * may also hand over a `.pcrd`, `.tlpd`, `.eds`, `.amxd` or a Bio-Rad folder
 * straight off the instrument. Those convert through the Processor's own
 * parsers and `sharp-writer.ts` — the same path the app's Save uses — rather
 * than through a second ingest route that could read a file differently.
 *
 * A file written here opens cleanly in the shipped app: no schema change, no
 * new keys, no `format_version` bump.
 */
import path from 'node:path';
import { buildSharpZip } from '@/lib/sharp-writer';
import { loadSource, analyzeChannel } from './load';
import { CliError, writeOut } from './util';

export interface ConvertResult {
  source: string;
  output: string;
  wells: number;
  channels: string[];
  cycles: number;
  meltPoints: number;
  /** True when a working session was written alongside the data. */
  withSession: boolean;
}

/**
 * Convert any supported source to `.sharpx` (or `.sharp` with
 * `withSession: false`).
 *
 * The analysis snapshot saved into the archive comes from the same
 * `computeChannelResults` the app runs, so `cq` / `end_rfu` in the written
 * file match what the GUI would have saved.
 */
export async function convertCommand(
  source: string,
  outPath: string,
  opts: { withSession?: boolean } = {},
): Promise<ConvertResult> {
  const loaded = await loadSource(source);
  const { exp, view } = loaded;

  const withSession = opts.withSession ?? path.extname(outPath).toLowerCase() === '.sharpx';

  // `cq` is by spec a cycle-quantification value, so a Tt may only be saved as
  // cq when the analysis actually ran in cycle units.
  const results = analyzeChannel(loaded, view.activeChannel);
  const liveAnalysis = { results, ttIsCycle: view.xAxisMode === 'cycle' };

  // Only carry a session through when the source had one; inventing one would
  // put this tool's defaults into the user's file.
  const session = withSession && loaded.hasSession
    ? (exp.session as Record<string, unknown> | null | undefined) ?? null
    : null;

  let bytes: Uint8Array;
  try {
    bytes = await buildSharpZip(exp, liveAnalysis, session);
  } catch (e) {
    throw new CliError(`Could not build the .sharp archive: ${(e as Error).message}`);
  }
  await writeOut(outPath, bytes);

  return {
    source: loaded.sourcePath,
    output: path.resolve(outPath),
    wells: exp.wellsUsed.length,
    channels: exp.channels,
    cycles: exp.amplification?.cycle.length ?? 0,
    meltPoints: exp.melt?.temperatureC.length ?? 0,
    withSession: Boolean(session),
  };
}
