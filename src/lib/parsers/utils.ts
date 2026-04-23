/**
 * Shared parser utilities — well names, XML helpers, time reconstruction,
 * metadata builder, melt derivative computation.
 */

import type { ExperimentData, WellInfo, MeltData } from '@/types/experiment';
import { inferPlateDimensions, getInstrumentPlateLayout, DEFAULT_PLATE_ROW_COUNT, DEFAULT_PLATE_COL_COUNT } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Well utilities
// ---------------------------------------------------------------------------

export function wellSortKey(well: string): [string, number] {
  const m = well.match(/^([A-P])(\d+)$/);
  return m ? [m[1], parseInt(m[2])] : [well, 0];
}

export function sortWells(wells: string[]): string[] {
  return [...wells].sort((a, b) => {
    const [ar, ac] = wellSortKey(a);
    const [br, bc] = wellSortKey(b);
    return ar < br ? -1 : ar > br ? 1 : ac - bc;
  });
}

export function plateIndexToWell(index: number, nCols = 12): string {
  const row = Math.floor(index / nCols);
  const col = index % nCols + 1;
  return `${String.fromCharCode(65 + row)}${col}`;
}

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

export function parseXml(text: string): Document {
  let clean = text;
  if (clean.charCodeAt(0) === 0xFEFF) clean = clean.slice(1);
  return new DOMParser().parseFromString(clean, 'text/xml');
}

export function xmlText(root: Element | Document, tag: string): string {
  const el = root.getElementsByTagName(tag)[0];
  return el?.textContent?.trim() ?? '';
}

export function xmlAttr(el: Element, attr: string): string {
  return el.getAttribute(attr) ?? '';
}

export function xmlAllByTag(root: Element | Document, tag: string): Element[] {
  return Array.from(root.getElementsByTagName(tag));
}

export function safeFloat(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// INI-style section parser (TianLong, ThermoFisher legacy .quant)
// ---------------------------------------------------------------------------

export function readIniSection(text: string, sectionName: string): Record<string, string> {
  const result: Record<string, string> = {};
  let inSection = false;
  const target = `[${sectionName}]`;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s === target) { inSection = true; continue; }
    if (s.startsWith('[') && inSection) break;
    if (inSection && s.includes('=')) {
      const idx = s.indexOf('=');
      result[s.slice(0, idx)] = s.slice(idx + 1);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Time reconstruction
// ---------------------------------------------------------------------------

export function computeTimeStats(cycleTimes: number[]) {
  if (cycleTimes.length < 2) return { mean: null, median: null, stdev: null };
  const durations: number[] = [];
  for (let i = 1; i < cycleTimes.length; i++) durations.push(cycleTimes[i] - cycleTimes[i - 1]);
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  const sorted = [...durations].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const stdev = Math.sqrt(durations.reduce((s, d) => s + (d - mean) ** 2, 0) / durations.length);
  return { mean, median, stdev };
}

// ---------------------------------------------------------------------------
// Melt derivative computation — BioRad CFX Maestro algorithm
// ---------------------------------------------------------------------------
//
// Reverse-engineered from BioRad.PCR.Analysis.dll (CFX Maestro) v1.x:
//   BioRad.PCR.Analysis.MeltCurvePeakFluorDataSet.MeltCurvePeakDetection()
//   BioRad.Mathematics.PeakDetection.InitalizeData()
//
// Pipeline:
//   1. Raw RFU → 5-point centered mean (twice)
//   2. Linear-extrapolate first 5 points from the line through [5,6]
//   3. SavGol 1st derivative, polynomial order 4, width 5
//      (equivalent to 4th-order central difference: [1,-8,0,8,-1] / 12h)
//   4. Divide by fixed ΔT = (Tmax - Tmin) / (N-1)
//   5. Linear-extrapolate first 2 points of the derivative
//   6. Negate so RFU going down = positive peak (-dF/dT convention)
//
// Why this beats naive central difference: differentiation amplifies
// high-frequency noise. BioRad removes noise BEFORE differentiating (two
// triangular smoothing passes) and then fits a polynomial to compute the
// derivative analytically, which is implicitly smooth.

/** 5-point centered moving average; window shrinks at the edges so both
 *  endpoints stay on a finite window (matches BioRad's ArithmeticMeans.Center). */
function centeredMean5(data: number[]): number[] {
  const n = data.length;
  if (n < 3) return [...data];
  const out = new Array<number>(n);
  out[0] = data[0];
  out[n - 1] = data[n - 1];
  const half = 2; // for width 5
  for (let i = 1; i < n - 1; i++) {
    const left = Math.min(half, i);
    const right = Math.min(half, n - 1 - i);
    const w = Math.min(left, right);
    let sum = 0;
    const count = 2 * w + 1;
    for (let j = i - w; j <= i + w; j++) sum += data[j];
    out[i] = sum / count;
  }
  return out;
}

/** Linear extrapolation of the first `count` points using the line through
 *  points [count, count+1]. Matches BioRad's FixStartingPoints. */
function linearExtrapStart(data: number[], count: number): void {
  if (data.length < count + 2) return;
  const x0 = count, y0 = data[count];
  const x1 = count + 1, y1 = data[count + 1];
  const slope = y1 - y0; // Δx = 1 (index units)
  const intercept = y0 - slope * x0;
  for (let i = 0; i < count; i++) data[i] = slope * i + intercept;
}

/** 5-point Savitzky-Golay 1st derivative at index i, polynomial order 4.
 *  With width 5 and poly 4 the fit is exact, giving the classical 4th-order
 *  central-difference coefficients [1, -8, 0, 8, -1] / 12. Returns df/di;
 *  caller divides by ΔT to get df/dT. */
function savGolDeriv1_w5p4(data: number[], i: number): number {
  return (data[i - 2] - 8 * data[i - 1] + 8 * data[i + 1] - data[i + 2]) / 12;
}

/** Compute smooth -dF/dT for every well using the BioRad CFX Maestro algorithm. */
export function computeMeltDerivative(
  temperatureC: number[],
  rfu: Record<string, number[]>,
): Record<string, number[]> {
  const derivative: Record<string, number[]> = {};
  const n = temperatureC.length;
  if (n < 5) {
    // Not enough points for the 5-point SavGol; fall back to simple diff.
    for (const [well, data] of Object.entries(rfu)) {
      const d = new Array<number>(data.length).fill(0);
      for (let i = 1; i < data.length - 1; i++) {
        const dt = temperatureC[i + 1] - temperatureC[i - 1];
        if (dt !== 0) d[i] = -(data[i + 1] - data[i - 1]) / dt;
      }
      if (data.length >= 2) {
        const dt0 = temperatureC[1] - temperatureC[0];
        d[0] = dt0 ? -(data[1] - data[0]) / dt0 : 0;
        const last = data.length - 1;
        const dtL = temperatureC[last] - temperatureC[last - 1];
        d[last] = dtL ? -(data[last] - data[last - 1]) / dtL : 0;
      }
      derivative[well] = d;
    }
    return derivative;
  }

  // Fixed ΔT matching BioRad's CalculateTemperatureIncrement.
  const dT = Math.abs((temperatureC[n - 1] - temperatureC[0]) / (n - 1)) || 1;

  for (const [well, raw] of Object.entries(rfu)) {
    if (raw.length !== n) { derivative[well] = new Array<number>(raw.length).fill(0); continue; }

    // 1. Smooth RFU with two passes of centered 5-point mean.
    let y = centeredMean5(raw);
    y = centeredMean5(y);

    // 2. Linear-extrapolate the first 5 points.
    linearExtrapStart(y, 5);

    // 3. Pad RFU by replicating first/last value (matches BioRad's
    //    FilterSavitskyGolay.CreatePaddedVector), then run SavGol across
    //    the full padded signal so edges get real SavGol outputs.
    const padded = new Array<number>(n + 4);
    padded[0] = padded[1] = y[0];
    for (let i = 0; i < n; i++) padded[i + 2] = y[i];
    padded[n + 2] = padded[n + 3] = y[n - 1];

    const d = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      d[i] = savGolDeriv1_w5p4(padded, i + 2) / dT;
    }

    // 4. Fix the first 2 derivative points via linear extrapolation
    //    (BioRad's FixStartingPoints(_, 2) after SavGol).
    linearExtrapStart(d, 2);

    // 5. Negate → -dF/dT (positive peak where RFU drops).
    for (let i = 0; i < n; i++) d[i] = -d[i];

    derivative[well] = d;
  }
  return derivative;
}

// ---------------------------------------------------------------------------
// Build ExperimentData from parsed components
// ---------------------------------------------------------------------------

export function buildExperimentData(opts: {
  fileName: string;
  experimentId: string;
  instrument: { manufacturer: string; model: string; serial_number?: string; software_version?: string };
  runInfo: { operator?: string; notes?: string; run_started_utc?: string; run_ended_utc?: string; file_name?: string };
  protocol: { type?: string; reaction_temp_c?: number | null; amp_cycle_count?: number | null; has_melt?: boolean; raw_definition?: string };
  wells: Record<string, WellInfo>;
  wellsUsed: string[];
  amplification: ExperimentData['amplification'];
  melt: MeltData | null;
  plateRows?: number;
  plateCols?: number;
  timeReconstruction?: Record<string, unknown>;
}): ExperimentData {
  // Build metadata matching .sharp format
  const metaWells: Record<string, unknown> = {};
  for (const [name, info] of Object.entries(opts.wells)) {
    metaWells[name] = {
      sample: info.sample,
      content: info.content,
      cq: info.cq ?? null,
      end_rfu: info.endRfu ?? null,
      melt_temp_c: info.meltTempC ?? null,
      melt_peak_height: info.meltPeakHeight ?? null,
    };
  }

  const metadata: Record<string, unknown> = {
    format_version: '1.0',
    experiment_id: opts.experimentId,
    instrument: opts.instrument,
    run_info: opts.runInfo,
    protocol: opts.protocol,
    wells: metaWells,
    data_summary: {
      wells_used: opts.wellsUsed,
      cycle_count: opts.amplification?.cycle.length ?? 0,
    },
  };
  if (opts.timeReconstruction) metadata.time_reconstruction = opts.timeReconstruction;

  // Determine plate dimensions
  let plateRows: number;
  let plateCols: number;
  if (opts.plateRows && opts.plateCols) {
    plateRows = opts.plateRows;
    plateCols = opts.plateCols;
  } else {
    const knownLayout = getInstrumentPlateLayout(opts.instrument.model);
    if (knownLayout) {
      plateRows = knownLayout.rows;
      plateCols = knownLayout.cols;
    } else {
      const inferred = inferPlateDimensions(opts.wellsUsed);
      plateRows = inferred.rows > 0 ? inferred.rows : DEFAULT_PLATE_ROW_COUNT;
      plateCols = inferred.cols > 0 ? inferred.cols : DEFAULT_PLATE_COL_COUNT;
    }
  }
  if (opts.plateRows && opts.plateCols) {
    metadata.plate_layout = { rows: opts.plateRows, cols: opts.plateCols };
  }

  return {
    experimentId: opts.experimentId,
    sourcePath: opts.fileName,
    metadata,
    amplification: opts.amplification,
    melt: opts.melt,
    wells: opts.wells,
    wellsUsed: opts.wellsUsed,
    plateRows,
    plateCols,
    formatVersion: '1.0',
    protocolType: opts.protocol.type ?? 'unknown',
    operator: opts.runInfo.operator ?? '',
    notes: opts.runInfo.notes ?? '',
    runStarted: opts.runInfo.run_started_utc ?? '',
  };
}
