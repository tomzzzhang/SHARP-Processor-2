/**
 * Headless file loading for sharpplot.
 *
 * One ingest path, shared with the app: `.sharp`/`.sharpx` through
 * `sharp-loader.ts`, raw instrument files through `instrument-loader.ts`, and
 * the resulting `ExperimentData` through the store's own
 * `resolveExperimentState`. That last step is what makes "the `.sharpx` is
 * already the spec" true — it restores groups, colours, hidden wells, the
 * threshold, baseline settings and fonts exactly as the GUI would on open.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSharpFile } from '@/lib/sharp-loader';
import { loadInstrumentFile, loadBioradFolder, isInstrumentFile } from '@/lib/instrument-loader';
import { resolveExperimentState, type ExperimentViewState, type ChannelAnalysisState } from '@/hooks/useAppState';
import { computeChannelResults } from '@/hooks/useAnalysisResults';
import { computeDriftSlope, type WellAnalysisResult } from '@/lib/analysis';
import type { ExperimentData } from '@/types/experiment';
import { isNewerFormat, newerFormatMessage } from './version';

export class LoadError extends Error {}

/**
 * Whether to proceed when a source declares a `.sharpx` format newer than this
 * build understands. Off by default — see `version.ts` for why that is a hard
 * error rather than a warning. Set from `--allow-newer-format` in `index.ts`;
 * a module-level switch rather than a parameter because the gate belongs at
 * the single ingest point, and every caller of `loadSource` would otherwise
 * have to thread a flag it does not care about.
 */
let allowNewerFormat = false;

export function setAllowNewerFormat(allow: boolean): void {
  allowNewerFormat = allow;
}

export interface LoadedExperiment {
  /** Normalized experiment, `amplification`/`melt` pointing at the active channel. */
  exp: ExperimentData;
  /** The view state the GUI would show for this file. */
  view: ExperimentViewState;
  /** Per-channel analysis settings, keyed by channel ID. */
  channelStates: Map<string, ChannelAnalysisState>;
  /** Absolute path the experiment was read from. */
  sourcePath: string;
  /** True when the source carried a working session (`.sharpx`). */
  hasSession: boolean;
}

const SHARP_EXTENSIONS = new Set(['sharp', 'sharpx']);

function extensionOf(filePath: string): string {
  return path.extname(filePath).replace(/^\./, '').toLowerCase();
}

/**
 * Load any supported source into an experiment plus the view/analysis state
 * saved with it. Directories are treated as Bio-Rad CFX export folders, which
 * matches how the app routes an unknown-extension path.
 */
export async function loadSource(sourcePath: string): Promise<LoadedExperiment> {
  const abs = path.resolve(sourcePath);
  const ext = extensionOf(abs);

  let raw: ExperimentData;
  if (SHARP_EXTENSIONS.has(ext)) {
    const bytes = await readFile(abs).catch((e: Error) => {
      throw new LoadError(`Cannot read ${abs}: ${e.message}`);
    });
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    raw = await loadSharpFile(buffer, path.basename(abs));
  } else if (isInstrumentFile(abs)) {
    raw = await loadInstrumentFile(abs);
  } else {
    // No known extension → Bio-Rad export folder, same fallthrough as the app.
    raw = await loadBioradFolder(abs).catch((e: Error) => {
      throw new LoadError(
        `Cannot load ${abs}. Expected .sharpx, .sharp, .pcrd, .tlpd, .eds, .amxd, ` +
        `or a Bio-Rad CFX export folder. (${e.message})`,
      );
    });
  }

  // The gate. Runs on every source the CLI ingests, before any analysis, so
  // no verb can act on a file this build cannot fully read.
  if (isNewerFormat(raw.formatVersion)) {
    if (!allowNewerFormat) throw new LoadError(newerFormatMessage(raw.formatVersion, abs));
    process.stderr.write(
      `sharpplot: proceeding under --allow-newer-format — ${path.basename(abs)} is ` +
      `.sharpx format ${raw.formatVersion}, newer than this build understands. ` +
      `Check the figure against the desktop app before trusting it.\n`,
    );
  }

  const hasSession = Boolean(raw.session);
  const resolved = resolveExperimentState(raw);
  return {
    exp: resolved.data,
    view: resolved.view,
    channelStates: resolved.channelStates,
    sourcePath: abs,
    hasSession,
  };
}

/** The analysis settings for one channel, falling back to the active channel's. */
export function channelStateFor(loaded: LoadedExperiment, channel: string): ChannelAnalysisState {
  const cs = loaded.channelStates.get(channel) ?? loaded.channelStates.get(loaded.view.activeChannel);
  if (!cs) throw new LoadError(`No analysis state for channel "${channel}".`);
  return cs;
}

/**
 * Per-well analysis for one channel, computed through the app's own
 * `computeChannelResults` with that channel's settings — the same call the
 * Export Wizard's results come from, including the deactivated-well exclusion
 * that keeps empty wells out of pooled statistics.
 */
export function analyzeChannel(loaded: LoadedExperiment, channel: string): Map<string, WellAnalysisResult> {
  const { exp, view } = loaded;
  const amp = exp.amplificationByChannel[channel] ?? null;
  const cs = channelStateFor(loaded, channel);
  const active = exp.wellsUsed.filter((w) => !view.deactivatedWells.has(w));
  const drift = amp && cs.driftCorrectionEnabled ? computeDriftSlope(amp, active).slope : 0;
  return computeChannelResults(amp, active, view.xAxisMode, cs, drift);
}

/** Wells the GUI would draw: populated, not hidden, not deactivated. */
export function visibleWellsOf(loaded: LoadedExperiment): string[] {
  const { exp, view } = loaded;
  return exp.wellsUsed.filter((w) => !view.hiddenWells.has(w) && !view.deactivatedWells.has(w));
}
