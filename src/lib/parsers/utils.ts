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
// Melt derivative computation
// ---------------------------------------------------------------------------

export function computeMeltDerivative(
  temperatureC: number[],
  rfu: Record<string, number[]>,
): Record<string, number[]> {
  const derivative: Record<string, number[]> = {};
  if (temperatureC.length < 3) return derivative;
  for (const [well, data] of Object.entries(rfu)) {
    const d = new Array<number>(data.length);
    d[0] = -(data[1] - data[0]) / (temperatureC[1] - temperatureC[0]);
    for (let i = 1; i < data.length - 1; i++) {
      d[i] = -(data[i + 1] - data[i - 1]) / (temperatureC[i + 1] - temperatureC[i - 1]);
    }
    const n = data.length - 1;
    d[n] = -(data[n] - data[n - 1]) / (temperatureC[n] - temperatureC[n - 1]);
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
