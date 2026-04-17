/**
 * BioRad CFX96 folder parser — pure TypeScript port of v1's `_parse_biorad`.
 *
 * Accepts a directory containing BioRad CFX Manager export CSVs:
 *   - Quantification Amplification Results_SYBR.csv  (required, wide: cycle × wells)
 *   - Quantification Cq Results.csv                   (required, long: row per well)
 *   - Run Information.csv                             (required, key-value)
 *   - Melt Curve RFU Results_SYBR.csv                 (optional, wide: temp × wells)
 *   - Melt Curve Derivative Results_SYBR.csv          (optional, wide: temp × wells)
 *   - End Point Results_SYBR.csv                      (optional, End RFU per well)
 *   - Melt Curve Peak Results.csv                     (optional, Tm per well)
 *   - PCREventLogXMLFile.xml                          (optional, cycle timestamps)
 *
 * BioRad export filename convention: `{ExperimentName} - {Type}.csv`
 * Note: inconsistent spacing in the prefix (" -  " vs " - "), so we match on
 * the suffix only via case-insensitive regex.
 */

import { readDir, readTextFile } from '@tauri-apps/plugin-fs';
import type { ExperimentData, WellInfo, AmplificationData, MeltData } from '@/types/experiment';
import {
  sortWells, parseXml, computeTimeStats, computeMeltDerivative, buildExperimentData,
} from './utils';

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

interface FilePatterns {
  amplification: RegExp;
  melt_rfu: RegExp;
  melt_deriv: RegExp;
  run_info: RegExp;
  cq_results: RegExp;
  end_point: RegExp;
  melt_peaks: RegExp;
  xml_log: RegExp;
}

const FILE_PATTERNS: FilePatterns = {
  amplification: /Quantification Amplification Results.*SYBR\.csv$/i,
  melt_rfu: /Melt Curve RFU Results.*SYBR\.csv$/i,
  melt_deriv: /Melt Curve Derivative Results.*SYBR\.csv$/i,
  run_info: /Run Information\.csv$/i,
  cq_results: /Quantification Cq Results\.csv$/i,
  end_point: /End Point Results.*SYBR\.csv$/i,
  melt_peaks: /Melt Curve Peak Results\.csv$/i,
  xml_log: /PCREventLogXMLFile\.xml$/i,
};

type FileKey = keyof FilePatterns;

const REQUIRED_FILES: FileKey[] = ['amplification', 'run_info', 'cq_results'];

async function discoverFiles(dirPath: string): Promise<Record<string, string>> {
  const entries = await readDir(dirPath);
  const files = entries.filter((e) => e.isFile !== false && !e.isDirectory).map((e) => e.name);

  const sep = dirPath.includes('\\') && !dirPath.includes('/') ? '\\' : '/';
  const join = (name: string) =>
    dirPath.endsWith(sep) ? `${dirPath}${name}` : `${dirPath}${sep}${name}`;

  const found: Record<string, string> = {};
  for (const [key, pattern] of Object.entries(FILE_PATTERNS)) {
    const matches = files.filter((n) => pattern.test(n));
    if (matches.length >= 1) {
      // If multiple, take the first (v1 picks most recent by mtime; we don't
      // have mtime via readDir without extra calls — first match is fine for
      // typical single-export folders).
      found[key] = join(matches[0]);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// CSV parsing (quote-aware)
// ---------------------------------------------------------------------------

/** Split a CSV line respecting double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out;
}

/** Parse full CSV text into rows. Strips UTF-8 BOM. */
function parseCsv(text: string): string[][] {
  let clean = text;
  if (clean.charCodeAt(0) === 0xFEFF) clean = clean.slice(1);
  // Normalize line endings
  const lines = clean.split(/\r?\n/);
  const rows: string[][] = [];
  for (const line of lines) {
    if (line.length === 0) continue;
    rows.push(splitCsvLine(line));
  }
  return rows;
}

/**
 * Parse a BioRad-style CSV that has a leading unnamed blank column.
 * Returns (header, dict-rows) where the blank leading column is stripped.
 */
function parseBioradCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const raw = parseCsv(text);
  if (raw.length === 0) return { header: [], rows: [] };

  let header = raw[0].map((c) => c.trim());
  const hasLeadingBlank = header.length > 0 && header[0] === '';
  if (hasLeadingBlank) header = header.slice(1);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < raw.length; i++) {
    let row = raw[i];
    if (hasLeadingBlank && row.length > 0 && row[0].trim() === '') row = row.slice(1);
    if (row.length === 0) continue;
    const trimmed = row.map((v) => v.trim());
    const dict: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) dict[header[j]] = trimmed[j] ?? '';
    rows.push(dict);
  }
  return { header, rows };
}

// ---------------------------------------------------------------------------
// Well helpers
// ---------------------------------------------------------------------------

function normalizeWell(s: string): string | null {
  const m = s.trim().match(/^([A-Ha-h])0*(\d{1,2})$/);
  if (!m) return null;
  return `${m[1].toUpperCase()}${parseInt(m[2])}`;
}

function safeFloat(s: string | undefined | null): number | null {
  if (s === undefined || s === null) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper === 'NAN' || upper === 'N/A' || upper === 'NONE') return null;
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Amplification CSV → {cycle[], wells{}}
// ---------------------------------------------------------------------------

interface WideTable {
  xValues: number[];
  wells: Record<string, number[]>;
}

function parseWideCsv(text: string, xColName: string): WideTable {
  const raw = parseCsv(text);
  if (raw.length === 0) return { xValues: [], wells: {} };

  let header = raw[0];
  const hasLeadingBlank = header[0] === '';
  if (hasLeadingBlank) header = header.slice(1);
  header = header.map((h) => h.trim());

  // First column after blank is x (Cycle or Temperature); remaining are wells
  const wellColMap = new Map<number, string>();
  for (let i = 1; i < header.length; i++) {
    const normalized = normalizeWell(header[i]);
    if (normalized) wellColMap.set(i, normalized);
  }

  const xValues: number[] = [];
  const wells: Record<string, number[]> = {};
  for (const name of wellColMap.values()) wells[name] = [];

  let nanCount = 0;
  for (let r = 1; r < raw.length; r++) {
    let row = raw[r];
    if (hasLeadingBlank && row.length > 0) row = row.slice(1);
    if (row.length === 0) continue;

    const xRaw = row[0]?.trim();
    if (!xRaw) continue;
    const x = parseFloat(xRaw);
    if (isNaN(x)) continue;
    xValues.push(xColName === 'cycle' ? Math.round(x) : x);

    for (const [col, wellName] of wellColMap.entries()) {
      const cell = (row[col] ?? '').trim();
      const v = parseFloat(cell);
      if (isNaN(v)) {
        nanCount++;
        wells[wellName].push(0);
      } else {
        wells[wellName].push(v);
      }
    }
  }
  if (nanCount > 0) {
    console.warn(`[BioRad] ${nanCount} non-numeric cell(s) in ${xColName} CSV replaced with 0`);
  }
  return { xValues, wells };
}

// ---------------------------------------------------------------------------
// Run Information CSV → key/value map
// ---------------------------------------------------------------------------

const RUN_INFO_KEY_MAP: Record<string, string> = {
  'File Name': 'file_name',
  'Created By User': 'operator',
  'Notes': 'notes',
  'Run Started': 'run_started_utc',
  'Run Ended': 'run_ended_utc',
  'Sample Vol': 'sample_volume_ul',
  'Lid Temp': 'lid_temp_c',
  'Protocol File Name': 'protocol_file_name',
  'Base Serial Number': 'base_serial_number',
  'CFX Maestro Version': 'cfx_maestro_version',
};

interface BioradRunInfo {
  file_name: string;
  operator: string;
  notes: string;
  run_started_utc: string;
  run_ended_utc: string;
  protocol_file_name: string;
  base_serial_number: string;
  cfx_maestro_version: string;
}

function parseRunInformation(text: string): BioradRunInfo {
  const info: BioradRunInfo = {
    file_name: '',
    operator: '',
    notes: '',
    run_started_utc: '',
    run_ended_utc: '',
    protocol_file_name: '',
    base_serial_number: '',
    cfx_maestro_version: '',
  };
  const rows = parseCsv(text);
  for (const row of rows) {
    if (row.length < 2) continue;
    const key = row[0].trim();
    const field = RUN_INFO_KEY_MAP[key];
    if (!field) continue;
    // Notes can contain commas — re-join any trailing fields that got split.
    let value = row.slice(1).join(',').trim();
    if (field === 'cfx_maestro_version') value = value.replace(/\.$/, '');
    (info as unknown as Record<string, string>)[field] = value;
  }
  return info;
}

/** Parse BioRad timestamp "MM/DD/YYYY HH:MM:SS UTC" → epoch ms. */
function parseBioradTimestamp(s: string): number | null {
  if (!s) return null;
  const clean = s.replace(/\s*UTC\s*$/i, '').trim();
  // MM/DD/YYYY HH:MM:SS
  const m = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (!m) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  const [, mo, d, y, h, mi, se] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi.padStart(2, '0')}:${se.padStart(2, '0')}Z`;
  const t = Date.parse(iso);
  return isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// Cq Results CSV → sample map
// ---------------------------------------------------------------------------

interface CqRow {
  well: string;
  sample: string;
  content: string;
  setPointC: number | null;
  cq: number | null;
}

function parseCqResults(text: string): CqRow[] {
  const { rows } = parseBioradCsv(text);
  const out: CqRow[] = [];
  for (const r of rows) {
    const rawWell = r['Well'] ?? '';
    const well = normalizeWell(rawWell);
    if (!well) continue;
    out.push({
      well,
      sample: r['Sample'] ?? '',
      content: r['Content'] ?? '',
      setPointC: safeFloat(r['Set Point']),
      cq: safeFloat(r['Cq']),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Event log XML → cycle timestamps for time reconstruction
// ---------------------------------------------------------------------------

/**
 * Parse BioRad PCREventLogXMLFile.xml for plate-read timestamps.
 * Returns { cycleTimesS, runDefinition } — cycleTimesS[0] === 0.
 */
function parseEventLogXml(text: string): { cycleTimesS: number[]; runDefinition: string | null } {
  const doc = parseXml(text);
  const reads: Array<{ readNum: number; ts: number }> = [];
  let runDefinition: string | null = null;

  const plateReadRe = /Read(\d+)\.Plateread/;
  const runDefRe = /Run definition - '([^']+)'/;

  const colsdata = doc.getElementsByTagName('columnsdata');
  for (let i = 0; i < colsdata.length; i++) {
    const entry = colsdata[i];
    const cols = entry.getElementsByTagName('columndata');
    if (cols.length < 2) continue;
    const timestampStr = cols[0].getAttribute('data') ?? '';
    const msg = cols[1].getAttribute('data') ?? '';

    if (!runDefinition && msg.includes('Run definition')) {
      const mm = msg.match(runDefRe);
      if (mm) runDefinition = mm[1];
    }

    const rm = msg.match(plateReadRe);
    if (rm && msg.includes('Successfully copied')) {
      const readNum = parseInt(rm[1]);
      const ts = parseBioradTimestamp(timestampStr);
      if (ts !== null) reads.push({ readNum, ts });
    }
  }

  reads.sort((a, b) => a.readNum - b.readNum);
  if (reads.length < 2) return { cycleTimesS: [], runDefinition };

  const t0 = reads[0].ts;
  const cycleTimesS = reads.map((r) => (r.ts - t0) / 1000);
  return { cycleTimesS, runDefinition };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function parseBioradFolder(dirPath: string): Promise<ExperimentData> {
  const found = await discoverFiles(dirPath);

  // Check required files
  const missing = REQUIRED_FILES.filter((k) => !(k in found));
  if (missing.length > 0) {
    throw new Error(
      `BioRad folder is missing required files: ${missing.join(', ')}. ` +
      `Make sure the folder contains the BioRad CFX Manager CSV exports ` +
      `(Amplification Results, Cq Results, Run Information).`
    );
  }

  // --- Run Information ---
  const runInfoText = await readTextFile(found.run_info);
  const runInfo = parseRunInformation(runInfoText);

  // Experiment ID: prefer folder name over "File Name" field so tab label
  // matches what the user picked.
  const folderName = dirPath.split(/[\\/]/).filter(Boolean).pop() ?? 'experiment';
  const experimentId = folderName;

  // --- Amplification ---
  const ampText = await readTextFile(found.amplification);
  const ampTable = parseWideCsv(ampText, 'cycle');
  if (ampTable.xValues.length === 0) {
    throw new Error('Amplification CSV has no data rows.');
  }

  // --- Cq Results → sample map ---
  const cqText = await readTextFile(found.cq_results);
  const cqRows = parseCqResults(cqText);

  // --- Optional: End Point (End RFU) ---
  const endRfu: Record<string, number | null> = {};
  if (found.end_point) {
    try {
      const epText = await readTextFile(found.end_point);
      const { rows } = parseBioradCsv(epText);
      for (const r of rows) {
        const w = normalizeWell(r['Well'] ?? '');
        if (w) endRfu[w] = safeFloat(r['End RFU']);
      }
    } catch {
      // optional — ignore parse errors
    }
  }

  // --- Optional: Melt Peaks (Tm, peak height) ---
  const meltPeaks: Record<string, { tm: number | null; peakH: number | null }> = {};
  if (found.melt_peaks) {
    try {
      const mpText = await readTextFile(found.melt_peaks);
      const { rows } = parseBioradCsv(mpText);
      for (const r of rows) {
        const w = normalizeWell(r['Well'] ?? '');
        if (!w) continue;
        meltPeaks[w] = {
          tm: safeFloat(r['Melt Temperature']),
          peakH: safeFloat(r['Peak Height']),
        };
      }
    } catch {
      // optional
    }
  }

  // --- Optional: Melt RFU + Derivative ---
  let melt: MeltData | null = null;
  if (found.melt_rfu) {
    try {
      const mrfuText = await readTextFile(found.melt_rfu);
      const mrfuTable = parseWideCsv(mrfuText, 'temperature');
      if (mrfuTable.xValues.length > 0) {
        let derivative: Record<string, number[]> | null = null;
        if (found.melt_deriv) {
          try {
            const mdText = await readTextFile(found.melt_deriv);
            const mdTable = parseWideCsv(mdText, 'temperature');
            if (mdTable.xValues.length === mrfuTable.xValues.length) {
              derivative = mdTable.wells;
            }
          } catch {
            // optional
          }
        }
        if (!derivative) {
          derivative = computeMeltDerivative(mrfuTable.xValues, mrfuTable.wells);
        }
        melt = {
          temperatureC: mrfuTable.xValues,
          rfu: mrfuTable.wells,
          derivative,
        };
      }
    } catch {
      // optional
    }
  }

  // --- Optional: Event log XML → cycle timestamps ---
  let cycleTimesS: number[] = [];
  let runDefinition: string | null = null;
  if (found.xml_log) {
    try {
      const xmlText = await readTextFile(found.xml_log);
      const parsed = parseEventLogXml(xmlText);
      runDefinition = parsed.runDefinition;
      if (parsed.cycleTimesS.length === ampTable.xValues.length) {
        cycleTimesS = parsed.cycleTimesS;
      } else if (parsed.cycleTimesS.length > 0) {
        // Length mismatch — derive mean interval and synthesize
        const stats = computeTimeStats(parsed.cycleTimesS);
        const mean = stats.mean ?? 23.0;
        cycleTimesS = ampTable.xValues.map((_, i) => i * mean);
      }
    } catch {
      // optional
    }
  }
  if (cycleTimesS.length === 0) {
    // Fallback: estimate 23s per cycle (v1 empirical default)
    cycleTimesS = ampTable.xValues.map((_, i) => i * 23.0);
  }

  // --- Build WellInfo records (sample map drives which wells are "populated") ---
  const wells: Record<string, WellInfo> = {};
  const contentMap: Record<string, WellInfo['content']> = {
    '': '',
    'Unkn': 'Unkn',
    'Neg Ctrl': 'Neg Ctrl',
    'Pos Ctrl': 'Pos Ctrl',
    'Std': 'Std',
    'NPC': 'NPC',
    'Neg': 'Neg',
  };

  for (const r of cqRows) {
    wells[r.well] = {
      well: r.well,
      sample: r.sample || r.well,
      content: contentMap[r.content.trim()] ?? 'Unkn',
      cq: r.cq,
      endRfu: endRfu[r.well] ?? null,
      meltTempC: meltPeaks[r.well]?.tm ?? null,
      meltPeakHeight: meltPeaks[r.well]?.peakH ?? null,
      call: 'unset',
    };
  }

  // Wells present in amp data but not in Cq results → still include them
  for (const w of Object.keys(ampTable.wells)) {
    if (!wells[w]) {
      wells[w] = {
        well: w,
        sample: w,
        content: 'Unkn',
        cq: null,
        endRfu: endRfu[w] ?? null,
        meltTempC: meltPeaks[w]?.tm ?? null,
        meltPeakHeight: meltPeaks[w]?.peakH ?? null,
        call: 'unset',
      };
    }
  }

  // Filter amp data to wells we know about
  const filteredAmpWells: Record<string, number[]> = {};
  for (const [w, vals] of Object.entries(ampTable.wells)) {
    if (wells[w]) filteredAmpWells[w] = vals;
  }
  const amplification: AmplificationData = {
    cycle: ampTable.xValues,
    timeS: cycleTimesS,
    timeMin: cycleTimesS.map((t) => t / 60),
    wells: filteredAmpWells,
  };

  // Filter melt data the same way
  if (melt) {
    const filteredRfu: Record<string, number[]> = {};
    const filteredDeriv: Record<string, number[]> = {};
    for (const [w, v] of Object.entries(melt.rfu)) {
      if (wells[w]) filteredRfu[w] = v;
    }
    for (const [w, v] of Object.entries(melt.derivative)) {
      if (wells[w]) filteredDeriv[w] = v;
    }
    melt = { temperatureC: melt.temperatureC, rfu: filteredRfu, derivative: filteredDeriv };
  }

  const wellsUsed = sortWells(Object.keys(filteredAmpWells));

  // Infer reaction temp from Cq Set Point (most common value)
  let reactionTemp: number | null = null;
  const setPoints = cqRows.map((r) => r.setPointC).filter((v): v is number => v !== null);
  if (setPoints.length > 0) {
    // Mode
    const counts = new Map<number, number>();
    for (const sp of setPoints) counts.set(sp, (counts.get(sp) ?? 0) + 1);
    let best = setPoints[0];
    let bestCount = 0;
    for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
    reactionTemp = best;
  }

  // Infer experiment type (same rules as pcrd.ts)
  let experimentType = 'unknown';
  if (reactionTemp !== null) {
    if (reactionTemp >= 60) experimentType = 'sharp';
    else if (reactionTemp <= 42) experimentType = 'unwinding';
    else experimentType = 'isothermal';
  }

  // Build metadata
  const stats = computeTimeStats(cycleTimesS);
  const timeReconstruction = {
    source: found.xml_log ? 'biorad-folder-eventlog' : 'biorad-folder-estimated',
    cycle_times_s: cycleTimesS,
    mean_cycle_duration_s: stats.mean,
    median_cycle_duration_s: stats.median,
    stdev_cycle_duration_s: stats.stdev,
  };

  return buildExperimentData({
    fileName: dirPath,
    experimentId,
    instrument: {
      manufacturer: 'Bio-Rad',
      model: 'CFX96',
      serial_number: runInfo.base_serial_number,
      software_version: runInfo.cfx_maestro_version,
    },
    runInfo: {
      operator: runInfo.operator,
      notes: runInfo.notes,
      run_started_utc: runInfo.run_started_utc,
      run_ended_utc: runInfo.run_ended_utc,
      file_name: runInfo.file_name || folderName,
    },
    protocol: {
      type: experimentType,
      reaction_temp_c: reactionTemp,
      amp_cycle_count: ampTable.xValues.length,
      has_melt: melt !== null,
      raw_definition: runDefinition ?? '',
    },
    wells,
    wellsUsed,
    amplification,
    melt,
    plateRows: 8,
    plateCols: 12,
    timeReconstruction,
  });
}
