/**
 * TianLong Gentier .tlpd parser — pure TypeScript port.
 *
 * A .tlpd file is a ZipCrypto-encrypted ZIP containing INI-style text files:
 * experiment_data (AmpData, MeltData, TempData, FileInfo)
 * run_method (RunMethod, SampleSetup)
 * coefficient
 *
 * Fluorescence: hex-encoded uint16 LE values, 16 wells per cycle.
 * Step definitions: 26-byte hex blobs — temp at +2, hold time at +10, read flag at +14.
 */

import { unzipWithPassword } from './zip-crypto';
import type { ExperimentData, WellInfo, AmplificationData, MeltData } from '@/types/experiment';
import {
  sortWells, readIniSection, computeTimeStats,
  computeMeltDerivative, buildExperimentData,
} from './utils';
import { getInstrumentPlateLayout } from '@/lib/constants';

const TLPD_PASSWORD = new TextEncoder().encode('82218051');

/** Map 0-based well index to well name (e.g., A1, B3) given plate column count */
function wellNameFromIndex(index: number, cols: number): string {
  const row = Math.floor(index / cols);
  const col = (index % cols) + 1;
  return `${String.fromCharCode(65 + row)}${col}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseTlpd(buffer: ArrayBuffer, fileName: string): Promise<ExperimentData> {
  const experimentId = fileName.replace(/\.tlpd$/i, '');

  // Extract archive
  const contents = extractTlpd(buffer);
  const expData = contents.experiment_data ?? '';
  const runMethod = contents.run_method ?? '';

  // FileInfo → RunInfo + InstrumentInfo
  const { runInfo, instrument } = parseFileInfo(expData);
  runInfo.file_name = fileName;

  // RunMethod → Protocol + stages
  const { protocol, stages } = parseRunMethod(runMethod);

  // Determine plate layout from instrument model
  const layout = getInstrumentPlateLayout(instrument.model) ?? { rows: 2, cols: 8 };
  const plateCols = layout.cols;
  const wellCount = layout.rows * layout.cols;

  // SampleSetup → sample map
  const sampleMap = parseSampleSetup(runMethod, plateCols);

  // AmpData → fluorescence
  const ampRaw = parseAmpData(expData, wellCount, plateCols);

  // MeltData → melt RFU
  const meltRaw = parseMeltData(expData, stages, wellCount, plateCols);

  // TempData → time reconstruction
  const timeRecon = parseTempData(expData, stages);

  // Filter amp/melt data to only populated wells
  const populatedWellNames = new Set(Object.keys(sampleMap));

  // Build amplification
  let amplification: AmplificationData | null = null;
  if (ampRaw) {
    const filteredAmpWells: Record<string, number[]> = {};
    for (const [w, values] of Object.entries(ampRaw.wells)) {
      if (populatedWellNames.has(w)) filteredAmpWells[w] = values;
    }
    amplification = {
      cycle: ampRaw.cycles,
      timeS: timeRecon.cycleTimes.length === ampRaw.cycles.length
        ? timeRecon.cycleTimes : ampRaw.cycles.map((_, i) => i * 23.0),
      timeMin: (timeRecon.cycleTimes.length === ampRaw.cycles.length
        ? timeRecon.cycleTimes : ampRaw.cycles.map((_, i) => i * 23.0)).map(t => t / 60),
      wells: filteredAmpWells,
    };
  }

  // Build melt
  let melt: MeltData | null = null;
  if (meltRaw) {
    const filteredMeltWells: Record<string, number[]> = {};
    for (const [w, values] of Object.entries(meltRaw.wells)) {
      if (populatedWellNames.has(w)) filteredMeltWells[w] = values;
    }
    const derivative = computeMeltDerivative(meltRaw.temperatures, filteredMeltWells);
    melt = { temperatureC: meltRaw.temperatures, rfu: filteredMeltWells, derivative };
  }

  // Build well info
  const wells: Record<string, WellInfo> = {};
  for (const [name, info] of Object.entries(sampleMap)) {
    wells[name] = {
      well: name, sample: info.sample, content: info.content as WellInfo['content'],
      cq: null, endRfu: null, meltTempC: null, meltPeakHeight: null, call: 'unset',
    };
  }

  const wellsUsed = sortWells(
    amplification ? Object.keys(amplification.wells) : Object.keys(wells)
  );

  const stats = computeTimeStats(timeRecon.cycleTimes);
  const timeReconstruction = {
    source: 'tianlong_tempdata',
    cycle_times_s: timeRecon.cycleTimes,
    mean_cycle_duration_s: stats.mean,
    median_cycle_duration_s: stats.median,
    stdev_cycle_duration_s: stats.stdev,
    warnings: timeRecon.warnings,
  };

  return buildExperimentData({
    fileName, experimentId, instrument, runInfo,
    protocol: {
      type: protocol.experimentType,
      amp_cycle_count: protocol.ampCycles,
      has_melt: protocol.hasMelt,
      raw_definition: protocol.rawDefinition,
    },
    wells, wellsUsed, amplification, melt,
    plateRows: layout.rows, plateCols: layout.cols,
    timeReconstruction,
  });
}

// ---------------------------------------------------------------------------
// ZIP extraction
// ---------------------------------------------------------------------------

function extractTlpd(buffer: ArrayBuffer): Record<string, string> {
  const files = unzipWithPassword(new Uint8Array(buffer), TLPD_PASSWORD);
  const contents: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) {
    contents[name] = new TextDecoder('utf-8').decode(data);
  }
  return contents;
}

// ---------------------------------------------------------------------------
// FileInfo
// ---------------------------------------------------------------------------

function parseFileInfo(expData: string) {
  const info = readIniSection(expData, 'FileInfo');
  return {
    runInfo: {
      file_name: info.FileName ?? '',
      operator: info.Username ?? '',
      run_started_utc: parseTlDatetime(info.StartDateTime),
      run_ended_utc: parseTlDatetime(info.EndDateTime),
    },
    instrument: {
      manufacturer: 'Tianlong',
      model: info.InstrumentTypeName ?? 'Gentier Mini',
      serial_number: info.CreatedBySN ?? '',
      software_version: info.MCVersion ?? '',
    },
  };
}

function parseTlDatetime(s?: string): string {
  if (!s) return '';
  // Format: YYYY_MM_DD-HH_MM_SS
  const m = s.trim().match(/^(\d{4})_(\d{2})_(\d{2})-(\d{2})_(\d{2})_(\d{2})$/);
  if (!m) return '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

// ---------------------------------------------------------------------------
// RunMethod → Protocol
// ---------------------------------------------------------------------------

interface StageInfo {
  name: string;
  cycles: number;
  stepCount: number;
  steps: Record<number, string>;
}

interface ParsedStep {
  targetT: number;
  tempC: number;
  keepTime: number;
  readF: boolean;
  rate: number;
}

function parseRunMethod(runMethod: string): { protocol: { experimentType: string; ampCycles: number; hasMelt: boolean; rawDefinition: string }; stages: Map<number, StageInfo> } {
  const rm = readIniSection(runMethod, 'RunMethod');
  const stages = new Map<number, StageInfo>();

  for (const [key, val] of Object.entries(rm)) {
    let m = key.match(/^Stage\\(\d+)\\Cycles$/);
    if (m) { getStage(stages, +m[1]).cycles = parseInt(val); continue; }
    m = key.match(/^Stage\\(\d+)\\Name$/);
    if (m) { getStage(stages, +m[1]).name = val; continue; }
    m = key.match(/^Stage\\(\d+)\\Step\\size$/);
    if (m) { getStage(stages, +m[1]).stepCount = parseInt(val); continue; }
    m = key.match(/^Stage\\(\d+)\\Step\\(\d+)\\Value$/);
    if (m) { getStage(stages, +m[1]).steps[+m[2]] = val; continue; }
  }

  // Find amplification stage
  let ampCycles = 0;
  for (const [, s] of [...stages].sort((a, b) => a[0] - b[0])) {
    if (s.name.toLowerCase().includes('amplif')) { ampCycles = s.cycles; break; }
  }

  // Find melt stage
  let hasMelt = false;
  for (const [, s] of stages) {
    if (s.name.toLowerCase().includes('melt')) { hasMelt = true; break; }
  }

  // Infer experiment type
  const experimentType = inferExperimentType(stages);

  // Build raw definition
  const rawLines: string[] = [];
  for (const [sn, s] of [...stages].sort((a, b) => a[0] - b[0])) {
    rawLines.push(`Stage ${sn}: ${s.name} (${s.cycles} cycles x ${s.stepCount} steps)`);
    for (const si of Object.keys(s.steps).map(Number).sort((a, b) => a - b)) {
      const parsed = parseStepHex(s.steps[si]);
      if (parsed) {
        rawLines.push(`  Step ${si}: ${parsed.tempC.toFixed(1)}C, hold ${parsed.keepTime}s, read=${parsed.readF ? 'yes' : 'no'}`);
      }
    }
  }

  return {
    protocol: { experimentType, ampCycles, hasMelt, rawDefinition: rawLines.join('\n') },
    stages,
  };
}

function getStage(stages: Map<number, StageInfo>, num: number): StageInfo {
  if (!stages.has(num)) stages.set(num, { name: '', cycles: 1, stepCount: 0, steps: {} });
  return stages.get(num)!;
}

function parseStepHex(hexStr: string): ParsedStep | null {
  let raw: Uint8Array;
  try {
    raw = hexToBytes(hexStr);
  } catch { return null; }
  if (raw.length < 18) return null;

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const targetT = view.getUint16(2, true);
  const keepTime = view.getUint16(10, true);
  const readF = raw[14] === 1;
  const rate = view.getUint16(16, true);

  return { targetT, tempC: targetT / 100, keepTime, readF, rate };
}

function inferExperimentType(stages: Map<number, StageInfo>): string {
  for (const [, s] of [...stages].sort((a, b) => a[0] - b[0])) {
    if (!s.name.toLowerCase().includes('amplif')) continue;
    const temps = new Set<number>();
    for (const si of Object.keys(s.steps).map(Number).sort((a, b) => a - b)) {
      const parsed = parseStepHex(s.steps[si]);
      if (parsed) temps.add(parsed.tempC);
    }
    if (temps.size === 0) return 'unknown';
    const maxT = Math.max(...temps);
    const minT = Math.min(...temps);
    if (maxT >= 90 && minT <= 65) return 'standard_pcr';
    if (maxT >= 90 && minT > 65) return 'fast_pcr';
    if (maxT < 70) return 'isothermal';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// SampleSetup
// ---------------------------------------------------------------------------

function parseSampleSetup(runMethod: string, plateCols: number): Record<string, { sample: string; content: string }> {
  const ss = readIniSection(runMethod, 'SampleSetup');
  const wellSize = parseInt(ss['Well\\size'] ?? '0');
  const map: Record<string, { sample: string; content: string }> = {};
  for (let i = 0; i < wellSize; i++) {
    const hexVal = ss[`Well\\${i + 1}\\Value`] ?? '';
    if (!hexVal) continue;
    let raw: Uint8Array;
    try { raw = hexToBytes(hexVal); } catch { continue; }
    // Byte 0: active flag (01 = populated, 00 = empty)
    if (raw.length < 13 || raw[0] === 0) continue;
    // Prefer Test Name (Well\N\Value\Test) over Sample (Well\N\Value)
    const sample = extractNameFromBlob(ss[`Well\\${i + 1}\\Value\\Test`])
      ?? extractNameFromBlob(hexVal)
      ?? wellNameFromIndex(i, plateCols);
    const name = wellNameFromIndex(i, plateCols);
    map[name] = { sample, content: 'Unkn' };
  }
  return map;
}

/** Extract null-terminated ASCII name starting at byte 12 of a hex blob. Returns null if empty. */
function extractNameFromBlob(hexVal?: string): string | null {
  if (!hexVal) return null;
  let raw: Uint8Array;
  try { raw = hexToBytes(hexVal); } catch { return null; }
  if (raw.length <= 12) return null;
  let nameEnd = 12;
  while (nameEnd < raw.length && raw[nameEnd] !== 0) nameEnd++;
  if (nameEnd === 12) return null;
  return new TextDecoder('ascii').decode(raw.slice(12, nameEnd));
}

// ---------------------------------------------------------------------------
// AmpData
// ---------------------------------------------------------------------------

function parseAmpData(expData: string, wellCount: number, plateCols: number): { cycles: number[]; wells: Record<string, number[]> } | null {
  const amp = readIniSection(expData, 'AmpData');
  const cycleCount = parseInt(amp['Cycle\\size'] ?? '0');
  if (cycleCount === 0) return null;

  const cycles: number[] = [];
  const wells: Record<string, number[]> = {};
  for (let w = 0; w < wellCount; w++) wells[wellNameFromIndex(w, plateCols)] = [];

  for (let c = 1; c <= cycleCount; c++) {
    const hexVal = amp[`Cycle\\${c}\\Value`] ?? '';
    if (!hexVal) continue;
    const raw = hexToBytes(hexVal);
    cycles.push(c);
    for (let w = 0; w < wellCount; w++) {
      const offset = w * 2;
      const val = offset + 2 <= raw.length
        ? new DataView(raw.buffer, raw.byteOffset + offset, 2).getUint16(0, true) : 0;
      wells[wellNameFromIndex(w, plateCols)].push(val);
    }
  }

  return cycles.length > 0 ? { cycles, wells } : null;
}

// ---------------------------------------------------------------------------
// MeltData
// ---------------------------------------------------------------------------

function parseMeltData(expData: string, stages: Map<number, StageInfo>, wellCount: number, plateCols: number): { temperatures: number[]; wells: Record<string, number[]> } | null {
  const md = readIniSection(expData, 'MeltData');
  const cycleCount = parseInt(md['Cycle\\size'] ?? '0');
  if (cycleCount === 0) return null;

  const meltTemps = getMeltTemperatures(stages);
  const temperatures: number[] = [];
  const wells: Record<string, number[]> = {};
  for (let w = 0; w < wellCount; w++) wells[wellNameFromIndex(w, plateCols)] = [];

  for (let c = 1; c <= cycleCount; c++) {
    const hexVal = md[`Cycle\\${c}\\Value`] ?? '';
    if (!hexVal) continue;
    const raw = hexToBytes(hexVal);
    const tempC = (c - 1) < meltTemps.length
      ? meltTemps[c - 1]
      : 65.0 + (c - 1) * (30.0 / Math.max(cycleCount - 1, 1));
    temperatures.push(tempC);
    for (let w = 0; w < wellCount; w++) {
      const offset = w * 2;
      const val = offset + 2 <= raw.length
        ? new DataView(raw.buffer, raw.byteOffset + offset, 2).getUint16(0, true) : 0;
      wells[wellNameFromIndex(w, plateCols)].push(val);
    }
  }

  return temperatures.length > 0 ? { temperatures, wells } : null;
}

function getMeltTemperatures(stages: Map<number, StageInfo>): number[] {
  let meltStage: StageInfo | null = null;
  for (const [, s] of [...stages].sort((a, b) => a[0] - b[0])) {
    if (s.name.toLowerCase().includes('melt')) { meltStage = s; break; }
  }
  if (!meltStage) return [];

  const stepTemps: number[] = [];
  for (const si of Object.keys(meltStage.steps).map(Number).sort((a, b) => a - b)) {
    const parsed = parseStepHex(meltStage.steps[si]);
    if (parsed) stepTemps.push(parsed.tempC);
  }
  if (stepTemps.length < 2) return [];

  const startTemp = Math.min(...stepTemps);
  const endTemp = Math.max(...stepTemps);
  const nCycles = meltStage.cycles;
  if (nCycles <= 1) return [startTemp];

  const increment = (endTemp - startTemp) / (nCycles - 1);
  return Array.from({ length: nCycles }, (_, i) => Math.round((startTemp + i * increment) * 100) / 100);
}

// ---------------------------------------------------------------------------
// TempData → time reconstruction
// ---------------------------------------------------------------------------

function parseTempData(expData: string, stages: Map<number, StageInfo>): { cycleTimes: number[]; warnings: string[] } {
  const td = readIniSection(expData, 'TempData');
  const stepTimes = new Map<number, { begin: number; end: number }>();

  for (const [key, val] of Object.entries(td)) {
    let m = key.match(/^Step\\(\d+)\\BeginTime$/);
    if (m) { const n = +m[1]; if (!stepTimes.has(n)) stepTimes.set(n, { begin: 0, end: 0 }); stepTimes.get(n)!.begin = parseInt(val); continue; }
    m = key.match(/^Step\\(\d+)\\EndTime$/);
    if (m) { const n = +m[1]; if (!stepTimes.has(n)) stepTimes.set(n, { begin: 0, end: 0 }); stepTimes.get(n)!.end = parseInt(val); }
  }

  if (stepTimes.size === 0) return { cycleTimes: [], warnings: ['No TempData steps found'] };

  const readStepIndices = mapReadSteps(stages);
  const cycleTimes: number[] = [];
  const warnings: string[] = [];

  for (const [, , tempStep] of readStepIndices) {
    if (stepTimes.has(tempStep)) {
      const endTime = stepTimes.get(tempStep)!.end;
      if (endTime >= 0) cycleTimes.push(endTime);
      else {
        warnings.push(`TempData step ${tempStep} missing EndTime`);
        cycleTimes.push(cycleTimes.length > 0 ? cycleTimes[cycleTimes.length - 1] + 23 : 0);
      }
    } else {
      warnings.push(`TempData step ${tempStep} not found`);
      cycleTimes.push(cycleTimes.length > 0 ? cycleTimes[cycleTimes.length - 1] + 23 : 0);
    }
  }

  return { cycleTimes, warnings };
}

function mapReadSteps(stages: Map<number, StageInfo>): [number, number, number][] {
  const readSteps: [number, number, number][] = [];
  let totalSteps = 0;

  for (const [sn, s] of [...stages].sort((a, b) => a[0] - b[0])) {
    let readStepInStage: number | null = null;
    for (const si of Object.keys(s.steps).map(Number).sort((a, b) => a - b)) {
      const parsed = parseStepHex(s.steps[si]);
      if (parsed?.readF) readStepInStage = si;
    }

    if (readStepInStage !== null && s.name.toLowerCase().includes('amplif')) {
      for (let cycle = 0; cycle < s.cycles; cycle++) {
        const tempStep = totalSteps + cycle * s.stepCount + readStepInStage;
        readSteps.push([sn, cycle + 1, tempStep]);
      }
    }
    totalSteps += s.cycles * s.stepCount;
  }

  return readSteps;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
