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
  plateIndexToWell, sortWells, readIniSection, computeTimeStats,
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
  try { return JSON.parse(strFromU8(raw)); }
  catch { return null; }
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

  let runName = '';
  let instrumentType = '';
  if (summary) {
    runName = (summary.name as string) ?? '';
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

  // Plate setup
  const plateSetup = readJson(contents, 'setup/plate_setup.json') as Record<string, unknown> | null;
  let nCols = 12;
  const sampleMap: Record<string, { sample: string; content: string; cq?: number }> = {};

  if (plateSetup) {
    const blockType = (plateSetup.blockType as string) ?? '';
    if (blockType.includes('384') || blockType.toUpperCase().includes('16X24')) nCols = 24;

    for (const entry of (plateSetup.wells as Array<Record<string, unknown>>) ?? []) {
      const idx = (entry.index as number) ?? -1;
      if (idx < 0) continue;
      const wellName = plateIndexToWell(idx, nCols);
      const sampleName = (entry.sampleName as string) ?? '';
      const assignments = (entry.targetAssignments as Array<Record<string, unknown>>) ?? [];
      const task = assignments.length > 0 ? mapTask((assignments[0].task as string) ?? 'UNKNOWN') : 'Unkn';
      sampleMap[wellName] = { sample: sampleName, content: task };
    }
  }

  // Analysis results → amplification
  const analysis = readJson(contents, 'primary/analysis_result.json') as Record<string, unknown> | null;
  let amplification: AmplificationData | null = null;
  let cycleCount = 0;

  if (analysis) {
    const ampData: Record<string, number[]> = {};
    for (const wr of (analysis.wellResults as Array<Record<string, unknown>>) ?? []) {
      const idx = (wr.wellIndex as number) ?? -1;
      if (idx < 0) continue;
      const reactions = (wr.reactionResults as Array<Record<string, unknown>>) ?? [];
      if (reactions.length === 0) continue;

      const rx = reactions[0];
      const ampResult = (rx.amplificationResult as Record<string, unknown>) ?? {};
      const rn = (ampResult.rn as number[]) ?? [];
      if (rn.length === 0) continue;

      const wellName = plateIndexToWell(idx, nCols);
      ampData[wellName] = rn;
      cycleCount = Math.max(cycleCount, rn.length);

      const cqRaw = (ampResult.cq as number) ?? -1;
      const cq = cqRaw !== -1 && cqRaw !== null ? cqRaw : undefined;

      if (sampleMap[wellName]) {
        sampleMap[wellName].cq = cq;
      } else {
        sampleMap[wellName] = {
          sample: (wr.sampleName as string) ?? '',
          content: 'Unkn',
          cq,
        };
      }
    }

    if (Object.keys(ampData).length > 0) {
      const cycles: number[] = [];
      const wells: Record<string, number[]> = {};
      for (let c = 0; c < cycleCount; c++) {
        cycles.push(c + 1);
      }
      for (const [wn, rn] of Object.entries(ampData)) {
        wells[wn] = Array.from({ length: cycleCount }, (_, c) => c < rn.length ? rn[c] : NaN);
      }

      // Timing
      const timing = buildTiming(contents, startTimeMs, cycleCount,
        startTimeMs ? new Date(startTimeMs) : null,
        endTimeMs ? new Date(endTimeMs) : null);

      amplification = {
        cycle: cycles,
        timeS: timing.cycleTimes,
        timeMin: timing.cycleTimes.map(t => t / 60),
        wells,
      };
    }
  }

  // Protocol
  const runMethodJson = readJson(contents, 'setup/run_method.json') as Record<string, unknown> | null;
  const protocol = parseRunMethodJson(runMethodJson, runName);

  // Build well info
  const wells: Record<string, WellInfo> = {};
  for (const [name, info] of Object.entries(sampleMap)) {
    wells[name] = {
      well: name, sample: info.sample, content: info.content as WellInfo['content'],
      cq: info.cq ?? null, endRfu: null, meltTempC: null, meltPeakHeight: null, call: 'unset',
    };
  }

  const wellsUsed = sortWells(amplification ? Object.keys(amplification.wells) : Object.keys(wells));

  const stats = amplification ? computeTimeStats(amplification.timeS) : { mean: null, median: null, stdev: null };

  return buildExperimentData({
    fileName, experimentId, instrument, runInfo,
    protocol: {
      type: protocol.experimentType,
      reaction_temp_c: protocol.reactionTemp,
      amp_cycle_count: protocol.ampCycles,
      has_melt: protocol.hasMelt,
      raw_definition: protocol.rawDefinition,
    },
    wells, wellsUsed, amplification, melt: null,
    plateRows: nCols === 24 ? 16 : 8,
    plateCols: nCols,
    timeReconstruction: {
      source: 'thermofisher_quant',
      cycle_times_s: amplification?.timeS ?? [],
      mean_cycle_duration_s: stats.mean,
    },
  });
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

  let amplification: AmplificationData | null = null;
  let melt: MeltData | null = null;

  if (isMeltOnly) {
    const meltRaw = parseQuantMelt(contents);
    if (meltRaw) {
      const derivative = computeMeltDerivative(meltRaw.temperatures, meltRaw.wells);
      melt = { temperatureC: meltRaw.temperatures, rfu: meltRaw.wells, derivative };
    }
  } else {
    const ampRaw = parseQuantFluorescence(contents);
    if (ampRaw) {
      const timing = buildTiming(contents, startTimeMs, ampRaw.cycles.length,
        startTimeMs ? new Date(startTimeMs) : null, null);
      amplification = {
        cycle: ampRaw.cycles,
        timeS: timing.cycleTimes,
        timeMin: timing.cycleTimes.map(t => t / 60),
        wells: ampRaw.wells,
      };
    }
    const meltRaw = parseQuantMelt(contents);
    if (meltRaw) {
      const derivative = computeMeltDerivative(meltRaw.temperatures, meltRaw.wells);
      melt = { temperatureC: meltRaw.temperatures, rfu: meltRaw.wells, derivative };
    }
  }

  // Sample map from XML
  const dataWells = amplification ? Object.keys(amplification.wells) : (melt ? Object.keys(melt.rfu) : []);
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
      has_melt: melt !== null,
    },
    wells, wellsUsed, amplification, melt,
    plateRows: 8, plateCols: 12,
  });
}

// ---------------------------------------------------------------------------
// Protocol parsing
// ---------------------------------------------------------------------------

function parseRunMethodJson(runMethod: Record<string, unknown> | null, name: string) {
  if (!runMethod) return { experimentType: 'standard_pcr', reactionTemp: null, ampCycles: null, hasMelt: false, rawDefinition: '' };

  const stages = (runMethod.stages as Array<Record<string, unknown>>) ?? [];
  let ampCycles: number | null = null;
  let reactionTemp: number | null = null;
  let hasMelt = false;
  const rawLines: string[] = [];

  for (const stage of stages) {
    const stageName = (stage.name as string) ?? (stage.type as string) ?? '';
    const nCycles = (stage.cycleCount as number) ?? 1;
    rawLines.push(`Stage: ${stageName} (${nCycles} cycles)`);

    for (const step of (stage.steps as Array<Record<string, unknown>>) ?? []) {
      const temp = (step.collectionTemperature ?? step.temperature ?? '') as string | number;
      const dur = (step.duration ?? '') as string | number;
      const collect = (step.collectData as boolean) ?? false;
      rawLines.push(`  ${(step.name as string) ?? 'step'} ${temp}C ${dur}s ${collect ? '[READ]' : ''}`);
      if (collect && temp && reactionTemp === null) {
        const t = typeof temp === 'number' ? temp : parseFloat(temp);
        if (!isNaN(t)) reactionTemp = t;
      }
    }

    const upper = stageName.toUpperCase();
    if (upper.includes('PCR') || upper.includes('AMP') || upper.includes('CYCLING')) ampCycles = nCycles;
    if (upper.includes('MELT')) hasMelt = true;
  }

  return { experimentType: 'standard_pcr', reactionTemp, ampCycles, hasMelt, rawDefinition: rawLines.join('\n') };
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
): { cycleTimes: number[] } {
  const quantKeys = Object.keys(contents)
    .filter(k => k.startsWith('apldbio/sds/quant/') && k.endsWith('.quant'))
    .sort();

  if (quantKeys.length === 0) return estimateTiming(cycleCount, startDt, endDt);

  const m1Keys = quantKeys.filter(k => k.includes('_M1_'));
  const useKeys = m1Keys.length > 0 ? m1Keys : quantKeys;

  const cyclePattern = /_C(\d+)_/;
  const cycleTimes = new Map<number, number>();

  for (const key of useKeys) {
    const m = key.match(cyclePattern);
    if (!m) continue;
    const c = parseInt(m[1]);
    if (cycleTimes.has(c)) continue;
    const text = strFromU8(contents[key]);
    const t = parseQuantTime(text);
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

function parseQuantFluorescence(contents: Record<string, Uint8Array>) {
  const quantKeys = Object.keys(contents)
    .filter(k => k.startsWith('apldbio/sds/quant/') && k.endsWith('.quant'))
    .sort();

  const m1Keys = quantKeys.filter(k => k.includes('_M1_'));
  const useKeys = m1Keys.length > 0 ? m1Keys : quantKeys;

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

function parseQuantMelt(contents: Record<string, Uint8Array>) {
  const quantKeys = Object.keys(contents)
    .filter(k => k.startsWith('apldbio/sds/quant/') && k.endsWith('.quant'))
    .sort();

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

function mapTask(task: string): string {
  const t = task.toUpperCase();
  if (t.includes('STANDARD')) return 'Std';
  if (t.includes('NTC')) return 'Neg Ctrl';
  if (t.includes('POSITIVE')) return 'Pos Ctrl';
  if (t.includes('NEGATIVE')) return 'Neg Ctrl';
  return 'Unkn';
}
