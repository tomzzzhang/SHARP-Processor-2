/**
 * ThermoFisher / Applied Biosystems .eds parser — pure TypeScript port.
 *
 * Supports modern format (QS7Pro, QS7, QS6Pro, QS5, QS3 — summary.json present)
 * and legacy format (QS6 and older — experiment.xml based).
 *
 * Modern: run/run_summary.json, setup/plate_setup.json, primary/analysis_result.json
 * Legacy: apldbio/sds/experiment.xml + apldbio/sds/quant/*.quant
 */

import { unzipPlain } from './zip-crypto';
import { strFromU8 } from 'fflate';
import type { ExperimentData, WellInfo, AmplificationData, MeltData } from '@/types/experiment';
import {
  plateIndexToWell, sortWells, computeTimeStats,
  computeMeltDerivative, buildExperimentData, wellSortKey,
} from './utils';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseEds(buffer: ArrayBuffer, fileName: string): Promise<ExperimentData> {
  const experimentId = fileName.replace(/\.eds$/i, '');

  const contents = extractEds(buffer);
  const isModern = 'summary.json' in contents;

  if (isModern) {
    return parseModern(contents, fileName, experimentId);
  } else {
    return parseLegacy(contents, fileName, experimentId);
  }
}

// ---------------------------------------------------------------------------
// ZIP extraction
// ---------------------------------------------------------------------------

function extractEds(buffer: ArrayBuffer): Record<string, Uint8Array> {
  return unzipPlain(new Uint8Array(buffer));
}

function readJson(contents: Record<string, Uint8Array>, key: string): unknown | null {
  const raw = contents[key];
  if (!raw) return null;
  const text = strFromU8(raw);
  try { return JSON.parse(text); }
  catch {
    // QuantStudio writes bare `NaN` / `Infinity` for undetermined values (e.g.
    // `cq` on a NO_AMP well). That is invalid JSON: `JSON.parse` rejects it
    // (Python's json is lenient, so it only bites the app — the modern .eds
    // path was silently getting null for analysis_result.json). Replace those
    // tokens in value position only (never inside a quoted string) with null.
    try {
      const fixed = text.replace(/([:,[]\s*)(-?Infinity|NaN)(?=\s*[,\]}])/g, '$1null');
      return JSON.parse(fixed);
    } catch { return null; }
  }
}

function readText(contents: Record<string, Uint8Array>, key: string): string | null {
  const raw = contents[key];
  if (!raw) return null;
  return strFromU8(raw);
}

// ---------------------------------------------------------------------------
// Modern format
// ---------------------------------------------------------------------------

function parseModern(
  contents: Record<string, Uint8Array>,
  fileName: string,
  experimentId: string,
): ExperimentData {
  const runSummary = readJson(contents, 'run/run_summary.json') as Record<string, unknown> | null;
  const summary = readJson(contents, 'summary.json') as Record<string, unknown> | null;

  let instrumentSerial = '';
  let operator = '';
  let startTimeMs: number | null = null;
  let endTimeMs: number | null = null;
  if (runSummary) {
    instrumentSerial = (runSummary.instrumentSerialNumber as string) ?? '';
    operator = (runSummary.operator as string) ?? '';
    startTimeMs = (runSummary.startTime as number) ?? null;
    endTimeMs = (runSummary.endTime as number) ?? null;
  }

  let instrumentType = '';
  if (summary) {
    instrumentType = (summary.instrumentType as string) ?? '';
  }

  const instrument = {
    manufacturer: 'ThermoFisher',
    model: instrumentType || 'QuantStudio',
    serial_number: instrumentSerial,
  };
  const runInfo = {
    file_name: fileName,
    operator,
    run_started_utc: startTimeMs ? new Date(startTimeMs).toISOString() : '',
    run_ended_utc: endTimeMs ? new Date(endTimeMs).toISOString() : '',
  };

  // Protocol (parsed early — its amp/melt stage numbers slice the
  // multicomponent raw-fluorescence series by run stage).
  const runMethodJson = readJson(contents, 'setup/run_method.json') as Record<string, unknown> | null;
  const protocol = parseRunMethodJson(runMethodJson);

  // Plate setup
  const plateSetup = readJson(contents, 'setup/plate_setup.json') as Record<string, unknown> | null;
  let nCols = 12;
  const sampleMap: Record<string, { sample: string; content: string; cq?: number }> = {};
  // targetName → reporter dye (e.g. "16s" → "SYBR"), so channels read by dye.
  const targetToReporter: Record<string, string> = {};
  let passiveReference = '';
  // Wells the plate setup explicitly leaves unconfigured (no target assignment):
  // an explicit "not loaded" signal, honoured alongside signal-based detection.
  const setupEmptyWells = new Set<string>();

  if (plateSetup) {
    const blockType = (plateSetup.blockType as string) ?? '';
    if (blockType.includes('384') || blockType.toUpperCase().includes('16X24')) nCols = 24;
    passiveReference = ((plateSetup.passiveReference as string) ?? '').trim();

    for (const t of (plateSetup.targets as Array<Record<string, unknown>>) ?? []) {
      const name = ((t.name as string) ?? '').trim();
      const reporter = ((t.reporter as string) ?? '').trim();
      if (name && reporter) targetToReporter[name] = reporter;
    }

    for (const entry of (plateSetup.wells as Array<Record<string, unknown>>) ?? []) {
      const idx = (entry.index as number) ?? -1;
      if (idx < 0) continue;
      const wellName = plateIndexToWell(idx, nCols);
      const sampleName = (entry.sampleName as string) ?? '';
      const assignments = (entry.targetAssignments as Array<Record<string, unknown>>) ?? [];
      const task = assignments.length > 0 ? mapTask((assignments[0].task as string) ?? 'UNKNOWN') : 'Unkn';
      // Fall back to the well position when no sample name was entered, so no
      // occupied well is ever unlabeled (matches the .pcrd path).
      sampleMap[wellName] = { sample: sampleName || wellName, content: task };
      if (assignments.length === 0) setupEmptyWells.add(wellName);
    }
  }

  // Raw dye fluorescence (multicomponent) — the correct amplification signal for
  // dye-based chemistries. QuantStudio's `rn` is SYBR/ROX; when a run carries no
  // real passive reference (e.g. SHARP's no-ROX mix) that ratio is division-by-
  // noise, so we plot the raw reporter-dye signal instead — matching how .pcrd /
  // .tlpd and the legacy .eds path feed raw fluorescence. Also the basis for
  // empty-well detection (a loaded well fluoresces from its intercalating dye).
  const multi = parseMulticomponent(contents, nCols, protocol.ampStageNum);
  const primaryDye = pickPrimaryDye(multi, targetToReporter, passiveReference);

  // Analysis results → amplification (raw dye) + melt, one channel per reaction.
  // A multiplex well carries several `reactionResults`, each with its own dye.
  const analysis = readJson(contents, 'primary/analysis_result.json') as Record<string, unknown> | null;

  // Per-channel raw amp series + melt: channelId → { well → series }.
  const ampByChannelRaw: Record<string, Record<string, number[]>> = {};
  const meltRnByChannel: Record<string, Record<string, number[]>> = {};
  const meltTempByChannel: Record<string, number[]> = {};
  const channelOrder: string[] = [];
  let cycleCount = 0;

  if (analysis) {
    for (const wr of (analysis.wellResults as Array<Record<string, unknown>>) ?? []) {
      const idx = (wr.wellIndex as number) ?? -1;
      if (idx < 0) continue;
      const reactions = (wr.reactionResults as Array<Record<string, unknown>>) ?? [];
      if (reactions.length === 0) continue;

      const wellName = plateIndexToWell(idx, nCols);
      let firstCq: number | undefined;

      for (const rx of reactions) {
        const ampResult = (rx.amplificationResult as Record<string, unknown>) ?? {};
        const rn = (ampResult.rn as number[]) ?? [];

        // Channel = reporter dye (falls back to target/assay name).
        let channelId = modernReactionChannel(rx, targetToReporter);
        // The dye whose raw series drives this channel's amplification.
        const targetName = (rx.targetName as string) ?? '';
        const dyeName = targetToReporter[targetName]
          || (multi && channelId in multi.ampByDye ? channelId : primaryDye);
        // Prefer raw dye fluorescence; fall back to `rn` if multicomponent is
        // absent for this well/dye.
        const rawSeries = dyeName && multi ? multi.ampByDye[dyeName]?.[wellName] : undefined;
        const ampSeries = rawSeries ?? rn;

        const meltResult = rx.meltResult as Record<string, unknown> | undefined;
        const meltRn = meltResult && Array.isArray(meltResult.rn) ? (meltResult.rn as number[]) : [];
        const hasAmp = ampSeries.length > 0;
        const hasMeltData = meltRn.length > 0;
        if (!hasAmp && !hasMeltData) continue;

        // Two reactions in the same well that resolve to the same channel ID
        // (e.g. both fall back to 'Channel 1' when dye metadata is absent)
        // would otherwise overwrite each other — silent loss of one
        // fluorophore's curve. Give the collider a distinct ID so every
        // reaction keeps its own curve. Properly-tagged multiplex files have a
        // distinct dye per reaction and never hit this path.
        if (ampByChannelRaw[channelId]?.[wellName] !== undefined
          || meltRnByChannel[channelId]?.[wellName] !== undefined) {
          let n = 2;
          while (ampByChannelRaw[`${channelId} (${n})`]?.[wellName] !== undefined
            || meltRnByChannel[`${channelId} (${n})`]?.[wellName] !== undefined) n++;
          channelId = `${channelId} (${n})`;
        }
        if (!(channelId in ampByChannelRaw)) {
          ampByChannelRaw[channelId] = {};
          meltRnByChannel[channelId] = {};
          channelOrder.push(channelId);
        }
        if (hasAmp) {
          ampByChannelRaw[channelId][wellName] = ampSeries;
          cycleCount = Math.max(cycleCount, ampSeries.length);
        }
        if (hasMeltData) {
          meltRnByChannel[channelId][wellName] = meltRn;
          if (!(channelId in meltTempByChannel)) {
            const temps = (meltResult!.rnTemperatures as number[]) ?? [];
            if (temps.length > 0) meltTempByChannel[channelId] = temps;
          }
        }

        const cqRaw = (ampResult.cq as number) ?? -1;
        const cq = cqRaw !== -1 && cqRaw !== null ? cqRaw : undefined;
        if (firstCq === undefined && cq !== undefined) firstCq = cq;
      }

      if (sampleMap[wellName]) {
        if (firstCq !== undefined) sampleMap[wellName].cq = firstCq;
      } else {
        sampleMap[wellName] = {
          sample: (wr.sampleName as string) || wellName,
          content: 'Unkn',
          cq: firstCq,
        };
      }
    }
  }

  // Timing (shared across channels) — real per-cycle timestamps from run/quant.
  const timing = buildModernTiming(contents, protocol.ampStageNum, cycleCount,
    startTimeMs ? new Date(startTimeMs) : null,
    endTimeMs ? new Date(endTimeMs) : null);
  const cycles: number[] = Array.from({ length: cycleCount }, (_, c) => c + 1);

  // Build one AmplificationData + MeltData per channel.
  const channels: string[] = [];
  const channelFluorophore: Record<string, string> = {};
  const amplificationByChannel: Record<string, AmplificationData | null> = {};
  const meltByChannel: Record<string, MeltData | null> = {};
  for (const channelId of channelOrder) {
    const rawAmp = ampByChannelRaw[channelId] ?? {};
    channels.push(channelId);
    channelFluorophore[channelId] = channelId;

    if (Object.keys(rawAmp).length > 0) {
      const wells: Record<string, number[]> = {};
      for (const [wn, rn] of Object.entries(rawAmp)) {
        wells[wn] = Array.from({ length: cycleCount }, (_, c) => c < rn.length ? rn[c] : NaN);
      }
      amplificationByChannel[channelId] = {
        cycle: cycles,
        timeS: timing.cycleTimes,
        timeMin: timing.cycleTimes.map(t => t / 60),
        wells,
      };
    } else {
      amplificationByChannel[channelId] = null;
    }

    meltByChannel[channelId] = buildModernMelt(meltTempByChannel[channelId], meltRnByChannel[channelId]);
  }

  const multichannel = channels.length > 0;
  const activeAmp = multichannel ? amplificationByChannel[channels[0]] : null;
  const activeMelt = multichannel ? meltByChannel[channels[0]] : null;

  // Build well info
  const wells: Record<string, WellInfo> = {};
  for (const [name, info] of Object.entries(sampleMap)) {
    wells[name] = {
      well: name, sample: info.sample, content: info.content as WellInfo['content'],
      cq: info.cq ?? null, endRfu: null, meltTempC: null, meltPeakHeight: null, call: 'unset',
    };
  }

  const wellsUsed = sortWells(activeAmp ? Object.keys(activeAmp.wells) : Object.keys(wells));

  // Auto-detect empty (never-loaded) wells. QuantStudio assigns a target to the
  // whole plate, so the .eds marks every well "populated" even when only some
  // were loaded. A loaded well fluoresces from its intercalating dye; an empty
  // one sits at background — so a clearly-low raw-dye baseline (bimodal split,
  // biased toward keeping ambiguous wells), plus any plate-setup-unconfigured
  // wells, flags the empties. loadExperiment seeds these into `deactivatedWells`
  // so they don't clutter plots/analysis, reversibly (Configure Plate, later).
  const autoEmptyWells = detectEmptyWells(multi, primaryDye, wellsUsed, setupEmptyWells);

  const stats = activeAmp ? computeTimeStats(activeAmp.timeS) : { mean: null, median: null, stdev: null };

  const exp = buildExperimentData({
    fileName, experimentId, instrument, runInfo,
    protocol: {
      type: protocol.experimentType,
      reaction_temp_c: protocol.reactionTemp,
      amp_cycle_count: protocol.ampCycles,
      has_melt: activeMelt !== null,
      raw_definition: protocol.rawDefinition,
    },
    wells, wellsUsed,
    ...(multichannel
      ? { channels, channelFluorophore, amplificationByChannel, meltByChannel }
      : { amplification: null, melt: null }),
    plateRows: nCols === 24 ? 16 : 8,
    plateCols: nCols,
    timeReconstruction: {
      source: 'thermofisher_quant',
      cycle_times_s: activeAmp?.timeS ?? [],
      mean_cycle_duration_s: stats.mean,
    },
  });
  return autoEmptyWells.length > 0 ? { ...exp, autoEmptyWells } : exp;
}

/** Channel ID for a modern-format reaction. A dye field on the reaction wins
 *  (files that tag reactions explicitly); otherwise the target's reporter dye
 *  (so channels read as SYBR/FAM, not the assay name); then the target/assay
 *  name; else a generic label. */
function modernReactionChannel(rx: Record<string, unknown>, targetToReporter: Record<string, string>): string {
  const direct = [rx.dye, rx.reporter, rx.reporterDye, rx.dyeName];
  for (const c of direct) if (typeof c === 'string' && c.trim()) return c.trim();
  const target = ((rx.target as string) ?? (rx.targetName as string)
    ?? (rx.assayName as string) ?? (rx.detector as string) ?? '').trim();
  if (target && targetToReporter[target]) return targetToReporter[target];
  if (target) return target;
  return 'Channel 1';
}

// ---------------------------------------------------------------------------
// Modern raw fluorescence (multicomponent) + empty-well detection
// ---------------------------------------------------------------------------

interface ModernMulti {
  /** Raw dye fluorescence over the amplification stage: dyeName → well → series. */
  ampByDye: Record<string, Record<string, number[]>>;
  /** Number of amplification-stage collection points. */
  ampLen: number;
}

/** Read `primary/multicomponent_data.json` and extract each dye's raw
 *  fluorescence over the amplification stage's collection points. Stage is
 *  sliced by `ampStageNum` (from the run method); falls back to the lowest
 *  stage present (amp precedes melt). Returns null when absent. */
function parseMulticomponent(
  contents: Record<string, Uint8Array>,
  nCols: number,
  ampStageNum: number | null,
): ModernMulti | null {
  const mc = readJson(contents, 'primary/multicomponent_data.json') as Record<string, unknown> | null;
  if (!mc) return null;
  const cps = (mc.collectionPoints as Array<Record<string, unknown>>) ?? [];
  const wellData = (mc.wellData as Array<Record<string, unknown>>) ?? [];
  if (cps.length === 0 || wellData.length === 0) return null;

  const stages = [...new Set(cps.map(c => (c.stage as number) ?? 0))].sort((a, b) => a - b);
  const ampStage = ampStageNum ?? (stages.length > 0 ? stages[0] : null);
  const ampIdx: number[] = [];
  cps.forEach((c, i) => { if (((c.stage as number) ?? 0) === ampStage) ampIdx.push(i); });
  const useIdx = ampIdx.length > 0 ? ampIdx : cps.map((_, i) => i);

  const ampByDye: Record<string, Record<string, number[]>> = {};
  for (const wd of wellData) {
    const idx = (wd.wellIndex as number) ?? -1;
    if (idx < 0) continue;
    const wn = plateIndexToWell(idx, nCols);
    for (const d of (wd.dyeData as Array<Record<string, unknown>>) ?? []) {
      const dye = ((d.dyeName as string) ?? '').trim();
      if (!dye) continue;
      const f = (d.fluorescences as number[]) ?? [];
      (ampByDye[dye] ??= {})[wn] = useIdx.map(i => f[i] ?? NaN);
    }
  }
  return { ampByDye, ampLen: useIdx.length };
}

/** The plate's primary reporter dye — a declared target reporter (excluding the
 *  passive reference), else the sole non-reference dye. Used for empty-well
 *  detection and single-dye amplification. */
function pickPrimaryDye(
  multi: ModernMulti | null,
  targetToReporter: Record<string, string>,
  passiveReference: string,
): string {
  if (!multi) return '';
  const dyes = Object.keys(multi.ampByDye);
  const ref = passiveReference.trim().toUpperCase();
  const reporters = new Set(Object.values(targetToReporter));
  for (const d of dyes) if (reporters.has(d) && d.toUpperCase() !== ref) return d;
  const nonRef = dyes.filter(d => d.toUpperCase() !== ref);
  return nonRef[0] ?? dyes[0] ?? '';
}

/** Build a channel's MeltData from its per-well raw melt reads and shared
 *  temperature axis (first well's `rnTemperatures`). Wells whose read count
 *  differs from the axis are skipped with a warning. Derivative is recomputed
 *  (not resampled from the file) to match the .pcrd / legacy melt UI. */
function buildModernMelt(
  temps: number[] | undefined,
  rnByWell: Record<string, number[]> | undefined,
): MeltData | null {
  if (!temps || temps.length === 0 || !rnByWell || Object.keys(rnByWell).length === 0) return null;
  const n = temps.length;
  const rfu: Record<string, number[]> = {};
  for (const [w, rn] of Object.entries(rnByWell)) {
    if (rn.length !== n) {
      console.warn(`[eds] melt read count ${rn.length} != axis ${n} for well ${w}; skipping`);
      continue;
    }
    rfu[w] = rn;
  }
  if (Object.keys(rfu).length === 0) return null;
  return { temperatureC: temps, rfu, derivative: computeMeltDerivative(temps, rfu) };
}

/** Empty (never-loaded) wells = plate-setup-unconfigured wells plus wells whose
 *  raw-dye pre-amplification baseline is clearly low (a loaded well fluoresces
 *  from its intercalating dye; an empty one sits at background). */
function detectEmptyWells(
  multi: ModernMulti | null,
  primaryDye: string,
  wellsUsed: string[],
  setupEmpty: Set<string>,
): string[] {
  const empty = new Set<string>(setupEmpty);
  const series = multi && primaryDye ? multi.ampByDye[primaryDye] : undefined;
  if (series) {
    const baseline = new Map<string, number>();
    for (const w of wellsUsed) {
      const s = series[w];
      if (!s || s.length === 0) continue;
      const head = s.slice(0, Math.min(5, s.length)).filter(v => !isNaN(v));
      if (head.length > 0) baseline.set(w, medianOf(head));
    }
    for (const w of clearlyLowWells(baseline)) empty.add(w);
  }
  return wellsUsed.filter(w => empty.has(w));
}

/** Flag clearly-low (empty) wells by finding the tight loaded cluster at the top
 *  and cutting below it. Loaded wells (with intercalating dye) cluster densely
 *  at a high fluorescence; empty wells sit anywhere below. Walking down from the
 *  top, the first gap that is large relative to the loaded level (or the typical
 *  inter-well spacing) marks the bottom of the loaded cluster — everything below
 *  is empty. This is robust both to a lone low outlier (it stays in the low
 *  cluster) and to a lone well stranded in the gap (it falls below the loaded
 *  cluster, unlike an Otsu/k-means midpoint split). Conservative: with no clear
 *  gap (a unimodal/full plate) nothing is flagged, and a well within ~70% of the
 *  loaded level is kept. */
function clearlyLowWells(baseline: Map<string, number>): Set<string> {
  const entries = [...baseline.entries()];
  const n = entries.length;
  if (n < 6) return new Set();
  const sorted = entries.map(e => e[1]).slice().sort((a, b) => a - b);

  // Robust loaded level: 90th percentile (top of the high cluster, resistant to
  // a single spurious high reading).
  const hi = sorted[Math.floor(0.9 * (n - 1))];
  if (hi <= 0) return new Set();

  const gaps: number[] = [];
  for (let i = 0; i < n - 1; i++) gaps.push(sorted[i + 1] - sorted[i]);
  const gapThresh = Math.max(0.15 * hi, 4 * Math.max(medianOf(gaps), 1e-6));

  // Highest split whose gap exceeds the threshold = bottom of the loaded cluster.
  let cutIdx = -1;
  for (let i = n - 2; i >= 0; i--) if (gaps[i] > gapThresh) { cutIdx = i; break; }
  if (cutIdx < 0) return new Set();                 // no clear gap → all loaded

  const lowMax = sorted[cutIdx];
  const highCount = n - cutIdx - 1;
  if (highCount < 2 || !(lowMax < 0.7 * hi)) return new Set();   // keep ambiguous wells

  const cut = (lowMax + sorted[cutIdx + 1]) / 2;
  const out = new Set<string>();
  for (const [w, v] of entries) if (v <= cut) out.add(w);
  return out;
}

function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------------------
// Legacy format
// ---------------------------------------------------------------------------

function parseLegacy(
  contents: Record<string, Uint8Array>,
  fileName: string,
  experimentId: string,
): ExperimentData {
  const expXml = readText(contents, 'apldbio/sds/experiment.xml');
  if (!expXml) throw new Error('Legacy .eds: missing experiment.xml');

  const parser = new DOMParser();
  const doc = parser.parseFromString(expXml, 'text/xml');

  const findText = (tag: string) => {
    const el = doc.getElementsByTagName(tag)[0];
    return el?.textContent?.trim() ?? '';
  };

  const operator = findText('Operator');
  const instrumentName = findText('InstrumentType') || findText('InstrumentName') || 'QuantStudio';
  const startMsStr = findText('RunStartTime');
  const startTimeMs = startMsStr && /^\d+$/.test(startMsStr) ? parseInt(startMsStr) : null;

  const instrument = { manufacturer: 'ThermoFisher', model: instrumentName };
  const runInfo = {
    file_name: fileName,
    operator,
    run_started_utc: startTimeMs ? new Date(startTimeMs).toISOString() : '',
  };

  // Detect melt-only
  const typeId = findText('Id').toUpperCase();
  const isMeltOnly = typeId === 'MC';

  // Decide which optical filters (channels) to emit and how to name them. Each
  // matched filter pair _M{i}_X{i}_ in the .quant filenames is one dye's primary
  // read; the dye→filter assignment comes from the instrument's pure-dye
  // calibration (puredye.ini) and the plate's dye list (plate_setup.ini). The
  // passive-reference dye (e.g. ROX / MUSTANG PURPLE) is excluded.
  const filters = resolveLegacyFilters(contents);

  const amplificationByChannel: Record<string, AmplificationData | null> = {};
  const meltByChannel: Record<string, MeltData | null> = {};
  const channelFluorophore: Record<string, string> = {};
  const channels: string[] = [];
  const usedIds = new Set<string>();

  for (const { filter, dye } of filters) {
    let amp: AmplificationData | null = null;
    let melt: MeltData | null = null;

    if (!isMeltOnly) {
      const ampRaw = parseQuantFluorescence(contents, filter);
      if (ampRaw) {
        const timing = buildTiming(contents, startTimeMs, ampRaw.cycles.length,
          startTimeMs ? new Date(startTimeMs) : null, null, filter);
        amp = {
          cycle: ampRaw.cycles,
          timeS: timing.cycleTimes,
          timeMin: timing.cycleTimes.map(t => t / 60),
          wells: ampRaw.wells,
        };
      }
    }
    const meltRaw = parseQuantMelt(contents, filter);
    if (meltRaw) {
      const derivative = computeMeltDerivative(meltRaw.temperatures, meltRaw.wells);
      melt = { temperatureC: meltRaw.temperatures, rfu: meltRaw.wells, derivative };
    }

    // Drop filters that yielded no data at all (e.g. a melt-only file's amp).
    if (!amp && !melt) continue;

    let id = dye;
    if (usedIds.has(id)) id = `${dye} (M${filter})`;
    usedIds.add(id);
    channels.push(id);
    channelFluorophore[id] = dye;
    amplificationByChannel[id] = amp;
    meltByChannel[id] = melt;
  }

  // Fallback: never emit zero channels. If filter resolution found nothing,
  // parse the whole quant set as a single channel (legacy behaviour).
  if (channels.length === 0) {
    let amp: AmplificationData | null = null;
    let melt: MeltData | null = null;
    if (!isMeltOnly) {
      const ampRaw = parseQuantFluorescence(contents, null);
      if (ampRaw) {
        const timing = buildTiming(contents, startTimeMs, ampRaw.cycles.length,
          startTimeMs ? new Date(startTimeMs) : null, null, null);
        amp = {
          cycle: ampRaw.cycles, timeS: timing.cycleTimes,
          timeMin: timing.cycleTimes.map(t => t / 60), wells: ampRaw.wells,
        };
      }
    }
    const meltRaw = parseQuantMelt(contents, null);
    if (meltRaw) {
      const derivative = computeMeltDerivative(meltRaw.temperatures, meltRaw.wells);
      melt = { temperatureC: meltRaw.temperatures, rfu: meltRaw.wells, derivative };
    }
    const id = 'SYBR';
    channels.push(id);
    channelFluorophore[id] = id;
    amplificationByChannel[id] = amp;
    meltByChannel[id] = melt;
  }

  const activeMelt = meltByChannel[channels[0]] ?? null;

  // Sample map from XML — keyed on the union of wells across channels.
  const wellSet = new Set<string>();
  for (const id of channels) {
    const amp = amplificationByChannel[id];
    const m = meltByChannel[id];
    if (amp) for (const w of Object.keys(amp.wells)) wellSet.add(w);
    if (m) for (const w of Object.keys(m.rfu)) wellSet.add(w);
  }
  const dataWells = [...wellSet];
  const sampleMap = parseLegacySampleMap(doc, dataWells);

  const wells: Record<string, WellInfo> = {};
  for (const [name, info] of Object.entries(sampleMap)) {
    wells[name] = {
      well: name, sample: info.sample, content: info.content as WellInfo['content'],
      cq: null, endRfu: null, meltTempC: null, meltPeakHeight: null, call: 'unset',
    };
  }

  const wellsUsed = sortWells(dataWells.length > 0 ? dataWells : Object.keys(wells));

  return buildExperimentData({
    fileName, experimentId, instrument, runInfo,
    protocol: {
      type: 'standard_pcr',
      has_melt: activeMelt !== null,
    },
    wells, wellsUsed,
    channels, channelFluorophore, amplificationByChannel, meltByChannel,
    plateRows: 8, plateCols: 12,
  });
}

// ---------------------------------------------------------------------------
// Legacy optical-filter / dye resolution
// ---------------------------------------------------------------------------

interface LegacyFilter {
  /** Matched-filter index N (the i in _M{i}_X{i}_). */
  filter: number;
  /** Reporter dye name used as the channel ID. */
  dye: string;
}

/**
 * Resolve which matched optical filters to emit as channels, and the dye name
 * for each. The .quant files are keyed by an excitation/emission filter pair
 * `_M{e}_X{x}_`; each dye's *primary* read uses its matched pair (e === x).
 *
 * Mapping chain:
 *   1. plate_setup.ini [dye] → ordered dye list + passive-reference dye.
 *   2. calibrations/puredye.ini → per-dye strongest matched filter (x{i}-m{i}),
 *      giving dye → filter index N.
 *   3. Emit one channel per non-reference dye whose filter N actually has data
 *      in the .quant set. Channels are ordered by filter index.
 *
 * Falls back to generic `m{i}-x{i}` channel names (excluding the reference's
 * filter when known) when the calibration mapping is unavailable.
 */
function resolveLegacyFilters(contents: Record<string, Uint8Array>): LegacyFilter[] {
  // Matched filters that actually carry .quant data.
  const dataFilters = new Set<number>();
  for (const key of Object.keys(contents)) {
    if (!key.startsWith('apldbio/sds/quant/') || !key.endsWith('.quant')) continue;
    const m = key.match(/_M(\d+)_X(\d+)_/);
    if (m && m[1] === m[2]) dataFilters.add(parseInt(m[1]));
  }
  if (dataFilters.size === 0) return [];

  // Plate dye list + reference.
  const plateSetup = readText(contents, 'apldbio/sds/plate_setup.ini') ?? '';
  const dyesMatch = plateSetup.match(/\[dye\][\s\S]*?dyes\s*=\s*([^\n]+)/i);
  const refMatch = plateSetup.match(/\[dye\][\s\S]*?reference\s*=\s*([^\n]+)/i);
  const dyes = dyesMatch ? dyesMatch[1].trim().split(',').map(s => s.trim()).filter(Boolean) : [];
  const reference = refMatch ? refMatch[1].trim().toUpperCase() : '';

  // Per-dye matched filter from the pure-dye calibration.
  const calib = readText(contents, 'apldbio/sds/calibrations/puredye.ini') ?? '';
  const dyeToFilter = parseDyeMatchedFilters(calib);

  const out: LegacyFilter[] = [];
  const claimed = new Set<number>();
  if (dyes.length > 0 && dyeToFilter.size > 0) {
    for (const dye of dyes) {
      if (dye.toUpperCase() === reference) continue;
      const filter = dyeToFilter.get(dye.toUpperCase());
      if (filter === undefined || !dataFilters.has(filter) || claimed.has(filter)) continue;
      claimed.add(filter);
      out.push({ filter, dye });
    }
  }

  if (out.length > 0) {
    out.sort((a, b) => a.filter - b.filter);
    return out;
  }

  // Fallback: no usable dye→filter mapping. Emit generic channels for every
  // matched data filter, dropping the reference's filter when we can identify it.
  const refFilter = reference ? dyeToFilter.get(reference) : undefined;
  for (const filter of [...dataFilters].sort((a, b) => a - b)) {
    if (refFilter !== undefined && filter === refFilter && dataFilters.size > 1) continue;
    out.push({ filter, dye: `m${filter}-x${filter}` });
  }
  return out;
}

/**
 * From puredye.ini, return DYE(upper) → strongest matched filter index. The
 * file lists `filtersets` (e.g. `x1-m1,x1-m2,...`) and, per dye section, a
 * `QCSignal` row aligned to those filtersets; the dye's matched filter is the
 * `x{i}-m{i}` entry with the largest QCSignal.
 */
function parseDyeMatchedFilters(calib: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!calib) return map;

  const fsMatch = calib.match(/filtersets\s*=\s*([^\n]+)/i);
  if (!fsMatch) return map;
  const filtersets = fsMatch[1].trim().split(',').map(s => s.trim());
  // Index of each matched filterset within the QCSignal row.
  const matchedIdx: { idx: number; n: number }[] = [];
  filtersets.forEach((f, i) => {
    const mm = f.match(/x(\d+)-m(\d+)/i);
    if (mm && mm[1] === mm[2]) matchedIdx.push({ idx: i, n: parseInt(mm[1]) });
  });
  if (matchedIdx.length === 0) return map;

  const dyeListMatch = calib.match(/\[puredyes\][\s\S]*?dyes\s*=\s*([^\n]+)/i);
  const dyes = dyeListMatch ? dyeListMatch[1].trim().split(',').map(s => s.trim()).filter(Boolean) : [];
  for (const dye of dyes) {
    const escaped = dye.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sigMatch = calib.match(new RegExp(`\\[${escaped}\\][\\s\\S]*?QCSignal\\s*=\\s*([^\\n]+)`, 'i'));
    if (!sigMatch) continue;
    const sig = sigMatch[1].split(',').map(s => parseFloat(s.trim()));
    let bestN = -1;
    let bestVal = -Infinity;
    for (const { idx, n } of matchedIdx) {
      const v = sig[idx];
      if (!isNaN(v) && v > bestVal) { bestVal = v; bestN = n; }
    }
    if (bestN > 0) map.set(dye.toUpperCase(), bestN);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Protocol parsing
// ---------------------------------------------------------------------------

interface ModernProtocol {
  experimentType: string;
  reactionTemp: number | null;
  ampCycles: number | null;
  hasMelt: boolean;
  rawDefinition: string;
  /** 1-based stage index (matches `collectionPoints.stage`) of the
   *  amplification / melt stages, for slicing multicomponent by run stage. */
  ampStageNum: number | null;
  meltStageNum: number | null;
}

/**
 * Parse `setup/run_method.json`. Handles the qPCR File API 2.0 schema
 * (stages carry `repeat`; steps nest temp/duration under `ramp`/`hold`; a
 * collecting step has a `collectionProfile` — `MELT_RAC_SETTING` /
 * `collectionMode: "CONTINUOUS"` marks the melt ramp, `PCR_HAC_SETTING` the
 * amplification reads) while keeping the older string-named schema
 * (`name`/`cycleCount`/`collectionTemperature`/`collectData` + "PCR"/"AMP"/
 * "CYCLING"/"MELT" names) as a fallback so both instruments parse.
 */
function parseRunMethodJson(runMethod: Record<string, unknown> | null): ModernProtocol {
  const empty: ModernProtocol = {
    experimentType: 'standard_pcr', reactionTemp: null, ampCycles: null,
    hasMelt: false, rawDefinition: '', ampStageNum: null, meltStageNum: null,
  };
  if (!runMethod) return empty;

  const stages = (runMethod.stages as Array<Record<string, unknown>>) ?? [];
  let ampCycles: number | null = null;
  let reactionTemp: number | null = null;
  let hasMelt = false;
  let ampStageNum: number | null = null;
  let meltStageNum: number | null = null;
  const rawLines: string[] = [];

  stages.forEach((stage, si) => {
    const stageNum = si + 1;   // 1-based, matches collectionPoints.stage
    const stageName = ((stage.name as string) ?? (stage.type as string) ?? '').trim();
    // 2.0 uses `repeat`; older schema used `cycleCount`.
    const repeat = stage.repeat as number | undefined;
    const nCycles = typeof repeat === 'number' ? repeat : ((stage.cycleCount as number) ?? 1);
    rawLines.push(`Stage ${stageNum}: ${stageName || 'stage'} (repeat ${nCycles})`);

    let stageCollectsPcr = false;
    let stageContinuous = false;
    let stageCollectTemp: number | null = null;

    for (const step of (stage.steps as Array<Record<string, unknown>>) ?? []) {
      const ramp = (step.ramp as Record<string, unknown>) ?? {};
      const hold = (step.hold as Record<string, unknown>) ?? {};
      // 2.0 nests temp under ramp, duration under hold; older schema is flat.
      const tempRaw = (ramp.temperature ?? step.collectionTemperature ?? step.temperature) as number | string | undefined;
      const dur = (hold.duration ?? step.duration ?? '') as number | string;
      const profile = (hold.collectionProfile ?? ramp.collectionProfile) as Record<string, unknown> | undefined;
      const flatCollect = (step.collectData as boolean) ?? false;
      const collects = !!profile || flatCollect;
      const t = typeof tempRaw === 'number' ? tempRaw : (tempRaw != null ? parseFloat(String(tempRaw)) : NaN);
      rawLines.push(`  ${(step.name as string) ?? 'step'} ${isNaN(t) ? '' : `${t}C`} ${dur}s${collects ? ' [READ]' : ''}`);

      if (profile) {
        const mode = ((profile.collectionMode as string) ?? '').toUpperCase();
        const filterId = ((profile.filterSettingId as string) ?? '').toUpperCase();
        if (mode === 'CONTINUOUS' || filterId.includes('MELT')) stageContinuous = true;
        else stageCollectsPcr = true;   // any other quant read = amplification
      }
      if (flatCollect) stageCollectsPcr = true;
      if (collects && !isNaN(t) && stageCollectTemp === null) stageCollectTemp = t;
    }

    const upper = stageName.toUpperCase();
    const isMelt = stageContinuous || upper.includes('MELT');
    if (isMelt) {
      hasMelt = true;
      if (meltStageNum === null) meltStageNum = stageNum;
      return;   // a melt stage is never the amplification stage
    }

    const isAmp = stageCollectsPcr || upper.includes('PCR') || upper.includes('AMP') || upper.includes('CYCLING');
    if (isAmp) {
      if (nCycles > (ampCycles ?? 0)) ampCycles = nCycles;   // max repeat among amp stages
      if (reactionTemp === null && stageCollectTemp !== null) reactionTemp = stageCollectTemp;
      if (ampStageNum === null) ampStageNum = stageNum;
    }
  });

  return { experimentType: 'standard_pcr', reactionTemp, ampCycles, hasMelt, rawDefinition: rawLines.join('\n'), ampStageNum, meltStageNum };
}

// ---------------------------------------------------------------------------
// Timing from .quant files
// ---------------------------------------------------------------------------

function buildTiming(
  contents: Record<string, Uint8Array>,
  startTimeMs: number | null,
  cycleCount: number,
  startDt: Date | null,
  endDt: Date | null,
  filter: number | null = null,
): { cycleTimes: number[] } {
  const quantKeys = Object.keys(contents)
    .filter(k => k.startsWith('apldbio/sds/quant/') && k.endsWith('.quant'))
    .sort();

  if (quantKeys.length === 0) return estimateTiming(cycleCount, startDt, endDt);

  const filterKeys = filterQuantKeys(quantKeys, filter);
  const useKeys = filterKeys.length > 0 ? filterKeys : quantKeys;

  const cyclePattern = /_C(\d+)_/;
  const cycleTimes = new Map<number, number>();

  for (const key of useKeys) {
    const m = key.match(cyclePattern);
    if (!m) continue;
    const c = parseInt(m[1]);
    if (cycleTimes.has(c)) continue;
    const text = strFromU8(contents[key]);
    // Real timestamps win over any estimate — try both `[conditions]` encodings
    // (header/value table, then the `Time<TAB>value` row form).
    const t = parseQuantConditionTime(text) ?? parseQuantTime(text);
    if (t !== null) cycleTimes.set(c, t);
  }

  if (cycleTimes.size === 0) return estimateTiming(cycleCount, startDt, endDt);

  const t0 = startTimeMs !== null ? startTimeMs / 1000 : Math.min(...cycleTimes.values());
  const sorted = [...cycleTimes.keys()].sort((a, b) => a - b);
  return { cycleTimes: sorted.map(c => cycleTimes.get(c)! - t0) };
}

function parseQuantTime(text: string): number | null {
  let inConditions = false;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s === '[conditions]') { inConditions = true; continue; }
    if (s.startsWith('[') && inConditions) break;
    if (inConditions && s.startsWith('Time')) {
      const parts = s.split('\t');
      if (parts.length >= 2) {
        const t = parseFloat(parts[1].trim());
        if (!isNaN(t)) return t;
      }
    }
  }
  return null;
}

/**
 * Read `Time` (Unix epoch seconds) from a `.quant` `[conditions]` block. Modern
 * files write a tab-separated *header row* then a *value row*, so the legacy
 * `parseQuantTime` (which expects a `Time<TAB>value` line) never matches.
 */
function parseQuantConditionTime(text: string): number | null {
  let inConditions = false;
  let header: string[] | null = null;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s === '[conditions]') { inConditions = true; continue; }
    if (s.startsWith('[') && inConditions) break;
    if (!inConditions || !s) continue;
    const parts = s.split('\t');
    if (header === null) { header = parts.map((p) => p.trim()); continue; }
    const idx = header.indexOf('Time');
    if (idx >= 0 && idx < parts.length) {
      const t = parseFloat(parts[idx].trim());
      if (!isNaN(t)) return t;
    }
    break;
  }
  return null;
}

/**
 * Per-cycle acquisition times for the modern layout. Real timestamps live in
 * `run/quant/*.quant` (`[conditions]` → `Time`); the filename encodes
 * `S{stage}_C{cycle}_…`, so we take one read per *amplification*-stage cycle and
 * rebase on the first amp read (cycle 1 → t=0), matching `.pcrd`, which zeroes
 * on its first plate read.
 *
 * Modern files store quant under `run/quant/`, not the legacy
 * `apldbio/sds/quant/` that `buildTiming` scans — so the old call silently fell
 * back to `estimateTiming`, smearing the WHOLE run (initial hold + melt ramp
 * included) across the amplification cycles and inflating the time axis.
 */
function buildModernTiming(
  contents: Record<string, Uint8Array>,
  ampStageNum: number | null,
  cycleCount: number,
  startDt: Date | null,
  endDt: Date | null,
): { cycleTimes: number[] } {
  const keys = Object.keys(contents)
    .filter((k) => k.startsWith('run/quant/') && k.endsWith('.quant'))
    .sort();
  if (keys.length === 0) return estimateTiming(cycleCount, startDt, endDt);

  const pattern = /S(\d+)_C(\d+)_/;
  const cycleTimes = new Map<number, number>();
  for (const key of keys) {
    const m = key.match(pattern);
    if (!m) continue;
    // Amplification-stage reads only (the melt ramp is a separate stage).
    if (ampStageNum !== null && parseInt(m[1]) !== ampStageNum) continue;
    const cycle = parseInt(m[2]);
    if (cycleTimes.has(cycle)) continue;   // one read per cycle — decode once
    const text = strFromU8(contents[key]);
    const t = parseQuantConditionTime(text) ?? parseQuantTime(text);
    if (t !== null) cycleTimes.set(cycle, t);
  }
  if (cycleTimes.size === 0) return estimateTiming(cycleCount, startDt, endDt);

  const sorted = [...cycleTimes.keys()].sort((a, b) => a - b);
  const t0 = cycleTimes.get(sorted[0])!;
  return { cycleTimes: sorted.map((c) => cycleTimes.get(c)! - t0) };
}

function estimateTiming(cycleCount: number, startDt: Date | null, endDt: Date | null): { cycleTimes: number[] } {
  if (startDt && endDt && cycleCount > 0) {
    const totalS = (endDt.getTime() - startDt.getTime()) / 1000;
    const meanS = totalS / cycleCount;
    return { cycleTimes: Array.from({ length: cycleCount }, (_, i) => i * meanS) };
  }
  return { cycleTimes: Array.from({ length: cycleCount }, (_, i) => i * 30) };
}

// ---------------------------------------------------------------------------
// Legacy quant fluorescence
// ---------------------------------------------------------------------------

function parseQuantFluorescence(contents: Record<string, Uint8Array>, filter: number | null) {
  const quantKeys = Object.keys(contents)
    .filter(k => k.startsWith('apldbio/sds/quant/') && k.endsWith('.quant'))
    .sort();

  const filterKeys = filterQuantKeys(quantKeys, filter);
  const useKeys = filterKeys.length > 0 ? filterKeys : quantKeys;

  const cyclePattern = /_C(\d+)_/;
  const cycleData = new Map<number, Record<string, number>>();

  for (const key of useKeys) {
    const m = key.match(cyclePattern);
    if (!m) continue;
    const c = parseInt(m[1]);
    if (cycleData.has(c)) continue;
    const text = strFromU8(contents[key]);
    const wd = parseQuantWellRfu(text);
    if (Object.keys(wd).length > 0) cycleData.set(c, wd);
  }

  if (cycleData.size === 0) return null;

  const allWellsSet = new Set<string>();
  for (const wd of cycleData.values()) for (const w of Object.keys(wd)) allWellsSet.add(w);
  const allWells = [...allWellsSet].sort((a, b) => {
    const [ar, ac] = wellSortKey(a);
    const [br, bc] = wellSortKey(b);
    return ar < br ? -1 : ar > br ? 1 : ac - bc;
  });

  const sortedCycles = [...cycleData.keys()].sort((a, b) => a - b);
  const wells: Record<string, number[]> = {};
  for (const w of allWells) wells[w] = [];
  const cycles: number[] = [];

  for (const c of sortedCycles) {
    cycles.push(c);
    const wd = cycleData.get(c)!;
    for (const w of allWells) wells[w].push(wd[w] ?? NaN);
  }

  return { cycles, wells };
}

function parseQuantWellRfu(text: string): Record<string, number> {
  let inQuant = false;
  const result: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s === '[quant]') { inQuant = true; continue; }
    if (s.startsWith('[') && inQuant) break;
    if (!inQuant || !s) continue;
    const parts = s.split('\t');
    if (parts.length < 3) continue;
    const region = parts[0].trim();
    if (!region.startsWith('I')) continue;
    const label = region.slice(1);
    const wellName = parseLegacyWellLabel(label);
    if (!wellName) continue;
    try {
      const quant = parseFloat(parts[1]);
      const count = parseFloat(parts[2]);
      if (count > 0) result[wellName] = quant / count;
    } catch { /* skip */ }
  }
  return result;
}

function parseLegacyWellLabel(label: string): string | null {
  if (!label || label.length < 2) return null;
  if (/^[A-Ha-h]\d+$/.test(label)) return label.toUpperCase();
  return null;
}

// ---------------------------------------------------------------------------
// Legacy melt data
// ---------------------------------------------------------------------------

function parseQuantMelt(contents: Record<string, Uint8Array>, filter: number | null) {
  const allQuantKeys = Object.keys(contents)
    .filter(k => k.startsWith('apldbio/sds/quant/') && k.endsWith('.quant'))
    .sort();

  // Restrict to this channel's matched optical filter first.
  const filterKeys = filterQuantKeys(allQuantKeys, filter);
  const quantKeys = filterKeys.length > 0 ? filterKeys : allQuantKeys;

  const e1Keys = quantKeys.filter(k => k.endsWith('_E1.quant'));
  const useKeys = e1Keys.length > 0 ? e1Keys : quantKeys;

  const filePattern = /S(\d+)_C(\d+)_T(\d+)_P(\d+)/;
  const groups = new Map<string, [number, string][]>();

  for (const key of useKeys) {
    const m = key.match(filePattern);
    if (!m) continue;
    const [, s, c, t, p] = m;
    const groupKey = `${s}_${c}_${t}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push([parseInt(p), key]);
  }

  // Melt groups have >1 unique P values
  const posData = new Map<number, { temp: number; wells: Record<string, number> }>();
  for (const items of groups.values()) {
    const uniqueP = new Set(items.map(([p]) => p));
    if (uniqueP.size <= 1) continue;
    for (const [pos, key] of items.sort((a, b) => a[0] - b[0])) {
      if (posData.has(pos)) continue;
      const text = strFromU8(contents[key]);
      const temp = parseQuantTemp(text);
      const wd = parseQuantWellRfu(text);
      if (temp !== null && Object.keys(wd).length > 0) {
        posData.set(pos, { temp, wells: wd });
      }
    }
  }

  if (posData.size === 0) return null;

  const allWellsSet = new Set<string>();
  for (const { wells } of posData.values()) for (const w of Object.keys(wells)) allWellsSet.add(w);
  const allWells = [...allWellsSet].sort((a, b) => {
    const [ar, ac] = wellSortKey(a);
    const [br, bc] = wellSortKey(b);
    return ar < br ? -1 : ar > br ? 1 : ac - bc;
  });

  const temperatures: number[] = [];
  const wellsData: Record<string, number[]> = {};
  for (const w of allWells) wellsData[w] = [];

  for (const pos of [...posData.keys()].sort((a, b) => a - b)) {
    const { temp, wells } = posData.get(pos)!;
    temperatures.push(temp);
    for (const w of allWells) wellsData[w].push(wells[w] ?? NaN);
  }

  return { temperatures, wells: wellsData };
}

function parseQuantTemp(text: string): number | null {
  let inConditions = false;
  let header: string[] | null = null;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s === '[conditions]') { inConditions = true; continue; }
    if (s.startsWith('[') && inConditions) break;
    if (!inConditions || !s) continue;
    const parts = s.split('\t');
    if (header === null) { header = parts; continue; }
    for (const field of ['SampleTemperature', 'BlockTemperature']) {
      const idx = header.indexOf(field);
      if (idx >= 0 && idx < parts.length) {
        const temps = parts[idx].split(',').map(t => parseFloat(t.trim())).filter(t => !isNaN(t));
        if (temps.length > 0) return temps.reduce((a, b) => a + b, 0) / temps.length;
      }
    }
    break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Legacy sample map
// ---------------------------------------------------------------------------

function parseLegacySampleMap(doc: Document, dataWells: string[]): Record<string, { sample: string; content: string }> {
  const map: Record<string, { sample: string; content: string }> = {};

  for (const el of Array.from(doc.getElementsByTagName('Sample'))) {
    const well = (el.getAttribute('well') ?? '').toUpperCase();
    const name = el.getAttribute('name') ?? el.getAttribute('sampleName') ?? '';
    const task = mapTask(el.getAttribute('type') ?? 'UNKNOWN');
    if (well) map[well] = { sample: name, content: task };
  }

  if (Object.keys(map).length === 0) {
    for (const w of dataWells) {
      map[w] = { sample: w, content: 'Unkn' };
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Keep only the .quant files for one matched optical filter pair _M{n}_X{n}_.
 *  Returns all keys unchanged when `filter` is null. */
function filterQuantKeys(quantKeys: string[], filter: number | null): string[] {
  if (filter === null) return quantKeys;
  const token = `_M${filter}_X${filter}_`;
  return quantKeys.filter(k => k.includes(token));
}

function mapTask(task: string): string {
  const t = task.toUpperCase();
  if (t.includes('STANDARD')) return 'Std';
  if (t.includes('NTC')) return 'Neg Ctrl';
  if (t.includes('POSITIVE')) return 'Pos Ctrl';
  if (t.includes('NEGATIVE')) return 'Neg Ctrl';
  return 'Unkn';
}
