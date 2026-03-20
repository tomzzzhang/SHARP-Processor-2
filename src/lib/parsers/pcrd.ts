/**
 * BioRad CFX96 .pcrd parser — pure TypeScript port.
 *
 * A .pcrd file is a ZIP archive containing a ZipCrypto-encrypted entry
 * (typically "datafile.pcrd") whose content is UTF-8 XML with all
 * experiment data: fluorescence reads, timestamps, protocol, plate setup.
 *
 * PAr data layout: 108 wells x 4 stats x 6 channels = 2592 floats per read.
 * Index: channel * 432 + well * 4 + stat. Wells 0-95 = data (A1-H12).
 */

import { unzipWithPassword } from './zip-crypto';
import type { ExperimentData, WellInfo, AmplificationData, MeltData } from '@/types/experiment';
import {
  plateIndexToWell, sortWells, safeFloat, parseXml,
  xmlText, xmlAttr, xmlAllByTag, computeTimeStats,
  computeMeltDerivative, buildExperimentData,
} from './utils';

const PCRD_PASSWORD = new TextEncoder().encode('SecureCompressDecompressKeyiQ5V4Files!!##$$');
const DATA_WELLS = 96;
const STATS_PER_WELL = 4;
const WELLS_PER_PLATE = 108;
const CHANNELS = 6;
const VALUES_PER_READ = WELLS_PER_PLATE * STATS_PER_WELL * CHANNELS; // 2592

const CONTENT_TYPE_MAP: Record<string, string> = {
  wcSample: 'Unkn',
  wcFirst: 'Unkn',
  wcNTC: 'Neg Ctrl',
  wcPositiveControl: 'Pos Ctrl',
  wcStandard: 'Std',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parsePcrd(buffer: ArrayBuffer, fileName: string): Promise<ExperimentData> {
  const experimentId = fileName.replace(/\.pcrd$/i, '');

  // Extract XML from encrypted ZIP
  const xmlText_ = extractPcrdXml(buffer);
  const doc = parseXml(xmlText_);

  // Parse run info + instrument
  const { runInfo, instrument } = parseRunInfo(doc);
  runInfo.file_name = fileName;

  // Parse protocol
  const protocol = parseProtocol(doc, runInfo);

  // Parse plate setup (sample map)
  const sampleMap = parsePlateSetup(doc);

  // Parse fluorescence data + timestamps
  const { ampData, meltData, cycleTimes } = parseRunData(doc, protocol);

  // Filter to occupied wells
  const occupied = new Set(Object.keys(sampleMap));
  const filterWells = (data: Record<string, number[]>) => {
    if (occupied.size === 0) return data;
    const filtered: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(data)) {
      if (occupied.has(k)) filtered[k] = v;
    }
    return filtered;
  };

  // Build amplification
  let amplification: AmplificationData | null = null;
  if (ampData) {
    const filteredWells = filterWells(ampData.wells);
    const timeS = cycleTimes;
    const timeMin = cycleTimes.map(t => t / 60);
    amplification = {
      cycle: ampData.cycles,
      timeS,
      timeMin,
      wells: filteredWells,
    };
  }

  // Build melt data
  let melt: MeltData | null = null;
  if (meltData) {
    const filteredRfu = filterWells(meltData.wells);
    const derivative = computeMeltDerivative(meltData.temperatures, filteredRfu);
    melt = {
      temperatureC: meltData.temperatures,
      rfu: filteredRfu,
      derivative,
    };
  }

  // Build well info
  const wells: Record<string, WellInfo> = {};
  for (const [name, info] of Object.entries(sampleMap)) {
    wells[name] = {
      well: name,
      sample: info.sample,
      content: info.content as WellInfo['content'],
      cq: info.cq ?? null,
      endRfu: null,
      meltTempC: null,
      meltPeakHeight: null,
      call: 'unset',
    };
  }

  const wellsUsed = sortWells(
    amplification ? Object.keys(amplification.wells) : Object.keys(wells)
  );

  // Time reconstruction metadata
  const stats = computeTimeStats(cycleTimes);
  const timeReconstruction = {
    source: 'pcrd',
    cycle_times_s: cycleTimes,
    mean_cycle_duration_s: stats.mean,
    median_cycle_duration_s: stats.median,
    stdev_cycle_duration_s: stats.stdev,
  };

  return buildExperimentData({
    fileName,
    experimentId,
    instrument,
    runInfo,
    protocol: {
      type: protocol.experimentType,
      reaction_temp_c: protocol.reactionTemp,
      amp_cycle_count: protocol.ampCycles,
      has_melt: protocol.hasMelt,
      raw_definition: protocol.rawDefinition,
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

// ---------------------------------------------------------------------------
// ZIP extraction
// ---------------------------------------------------------------------------

function extractPcrdXml(buffer: ArrayBuffer): string {
  const files = unzipWithPassword(new Uint8Array(buffer), PCRD_PASSWORD);
  const firstKey = Object.keys(files)[0];
  if (!firstKey) throw new Error('Empty .pcrd archive');
  let text = new TextDecoder('utf-8').decode(files[firstKey]);
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return text;
}

// ---------------------------------------------------------------------------
// RunInfo + InstrumentInfo
// ---------------------------------------------------------------------------

function parseRunInfo(doc: Document) {
  const kv: Record<string, string> = {};
  const riEl = doc.getElementsByTagName('RunInfo')[0];
  if (riEl) {
    for (const kvp of Array.from(riEl.getElementsByTagName('KeyValuePairs'))) {
      const keyEl = kvp.getElementsByTagName('Key')[0];
      const valEl = kvp.getElementsByTagName('Value')[0];
      if (keyEl?.textContent) {
        kv[keyEl.textContent.trim()] = valEl?.textContent?.trim() ?? '';
      }
    }
  }

  const header = doc.getElementsByTagName('header')[0];
  const description = header?.getAttribute('description') ?? '';

  const protoPath = kv.ProtocolFile ?? '';
  const platePath = kv.PlateFile ?? '';
  const protoName = protoPath.includes('\\') ? protoPath.split('\\').pop()! : protoPath;
  const plateName = platePath.includes('\\') ? platePath.split('\\').pop()! : platePath;

  let swVersion = '';
  if (header) {
    const appVer = header.getAttribute('createdByClientAppVersion') ?? '';
    if (appVer) swVersion = appVer.split('.').slice(0, 3).join('.');
  }

  const protoEl = doc.getElementsByTagName('protocol2')[0];
  const lidTemp = protoEl ? safeFloat(protoEl.getAttribute('lidTemperature')) : null;
  const volume = protoEl ? safeFloat(protoEl.getAttribute('volume')) : null;

  return {
    runInfo: {
      operator: kv.Username ?? '',
      notes: kv.Notes ?? description,
      run_started_utc: kv.RunStartTime ?? '',
      run_ended_utc: '',
      file_name: '',
    },
    instrument: {
      manufacturer: 'Bio-Rad',
      model: kv.BlockDescription ?? 'CFX96',
      serial_number: kv.BaseSerialNumber ?? '',
      software_version: swVersion,
    },
  };
}

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

interface ProtocolData {
  experimentType: string;
  reactionTemp: number | null;
  ampCycles: number | null;
  hasMelt: boolean;
  rawDefinition: string;
}

function parseProtocol(doc: Document, runInfo: { file_name: string }): ProtocolData {
  const protoEl = doc.getElementsByTagName('protocol2')[0];
  if (!protoEl) return { experimentType: 'unknown', reactionTemp: null, ampCycles: null, hasMelt: false, rawDefinition: '' };

  const baseList = protoEl.getElementsByTagName('protocol2BaseList')[0];
  if (!baseList) return { experimentType: 'unknown', reactionTemp: null, ampCycles: null, hasMelt: false, rawDefinition: '' };

  const ampTemps: number[] = [];
  let ampCycles: number | null = null;
  let hasMelt = false;
  let reactionTemp: number | null = null;
  let firstGotoSeen = false;

  for (const step of Array.from(baseList.children)) {
    if (step.tagName === 'TemperatureStep') {
      const temp = safeFloat(step.getAttribute('temperatureStepTemp'));
      const hasRead = step.getElementsByTagName('PlateReadOption').length > 0;
      if (temp !== null) ampTemps.push(temp);
      if (hasRead && reactionTemp === null) {
        reactionTemp = temp;
      }
    } else if (step.tagName === 'GotoStep') {
      const count = parseInt(step.getAttribute('optionGotoCycle') ?? '0') || 0;
      if (!firstGotoSeen) {
        ampCycles = count;
        firstGotoSeen = true;
      } else {
        hasMelt = true;
      }
    }
  }

  // Infer experiment type
  let experimentType = 'unknown';
  if (reactionTemp !== null) {
    const unique = [...new Set(ampTemps)];
    if (unique.length > 1) {
      const maxT = Math.max(...unique);
      const minT = Math.min(...unique);
      if (maxT >= 90 && minT <= 65) experimentType = 'standard_pcr';
      else if (maxT >= 90 && minT > 65) experimentType = 'fast_pcr';
      else if (maxT < 70) experimentType = 'isothermal';
    } else {
      if (reactionTemp >= 60) experimentType = 'sharp';
      else if (reactionTemp <= 42) experimentType = 'unwinding';
    }
  }

  // Raw definition from protocol2 attribute
  const rawDef = protoEl.getAttribute('runDefinition') ?? '';

  return { experimentType, reactionTemp, ampCycles, hasMelt, rawDefinition: rawDef };
}

// ---------------------------------------------------------------------------
// Plate setup
// ---------------------------------------------------------------------------

function parsePlateSetup(doc: Document): Record<string, { sample: string; content: string; cq?: number }> {
  const map: Record<string, { sample: string; content: string }> = {};

  for (const ws of xmlAllByTag(doc, 'wellSample')) {
    const plateIndex = parseInt(ws.getAttribute('plateIndex') ?? '-1');
    if (plateIndex < 0 || plateIndex >= DATA_WELLS) continue;

    const sampleType = ws.getAttribute('wellSampleType') ?? 'wcSample';
    if (sampleType === 'wcEmpty') continue;

    const wellName = plateIndexToWell(plateIndex);
    const geneName = ws.getAttribute('geneName') ?? '';
    const conditionName = ws.getAttribute('conditionName') ?? '';
    const sample = conditionName || geneName || wellName;
    const content = CONTENT_TYPE_MAP[sampleType] ?? 'Unkn';

    map[wellName] = { sample, content };
  }
  return map;
}

// ---------------------------------------------------------------------------
// Fluorescence data
// ---------------------------------------------------------------------------

interface RawRunData {
  ampData: { cycles: number[]; wells: Record<string, number[]> } | null;
  meltData: { temperatures: number[]; wells: Record<string, number[]> } | null;
  cycleTimes: number[];
}

function parseRunData(doc: Document, protocol: ProtocolData): RawRunData {
  const plateReads = Array.from(doc.querySelectorAll('plateReadDataVector > plateRead > PlateRead'));
  if (plateReads.length === 0) return { ampData: null, meltData: null, cycleTimes: [] };

  // Group by step number
  const readsByStep = new Map<number, Element[]>();
  for (const pr of plateReads) {
    const header = pr.querySelector('Hdr > PlateReadDataHeader');
    if (!header) continue;
    const stepEl = header.querySelector('Step');
    const stepNum = parseInt(stepEl?.textContent ?? '0') || 0;
    if (!readsByStep.has(stepNum)) readsByStep.set(stepNum, []);
    readsByStep.get(stepNum)!.push(pr);
  }

  const stepNumbers = [...readsByStep.keys()].sort((a, b) => a - b);
  const ampStep = stepNumbers[0] ?? null;
  const meltStep = stepNumbers.length > 1 ? stepNumbers[1] : null;

  // Amplification data
  let ampData: RawRunData['ampData'] = null;
  const cycleTimestamps: number[] = [];

  if (ampStep !== null) {
    const reads = readsByStep.get(ampStep)!;
    const cycles: number[] = [];
    const wells: Record<string, number[]> = {};

    for (const pr of reads) {
      const header = pr.querySelector('Hdr > PlateReadDataHeader');
      const cycleEl = header?.querySelector('Cycle');
      const timeEl = header?.querySelector('Time');
      const cycle = parseInt(cycleEl?.textContent ?? '0') || 0;

      if (timeEl?.textContent) {
        const ts = parseRfc2822(timeEl.textContent);
        if (ts !== null) cycleTimestamps.push(ts);
      }

      const wellValues = extractChannelMeans(pr);
      if (!wellValues) continue;

      cycles.push(cycle);
      for (const [wn, val] of Object.entries(wellValues)) {
        if (!wells[wn]) wells[wn] = [];
        wells[wn].push(val);
      }
    }

    if (cycles.length > 0) ampData = { cycles, wells };
  }

  // Melt data
  let meltData: RawRunData['meltData'] = null;

  if (meltStep !== null) {
    const reads = readsByStep.get(meltStep)!;
    const temperatures: number[] = [];
    const wells: Record<string, number[]> = {};

    for (const pr of reads) {
      const header = pr.querySelector('Hdr > PlateReadDataHeader');
      const blockTmpEl = header?.querySelector('BlockTmp');
      const tempC = parseFloat(blockTmpEl?.textContent ?? '');
      if (isNaN(tempC)) continue;

      const wellValues = extractChannelMeans(pr);
      if (!wellValues) continue;

      temperatures.push(Math.round(tempC * 100) / 100);
      for (const [wn, val] of Object.entries(wellValues)) {
        if (!wells[wn]) wells[wn] = [];
        wells[wn].push(val);
      }
    }

    if (temperatures.length > 0) meltData = { temperatures, wells };
  }

  // Build cycle times from timestamps
  let cycleTimes: number[] = [];
  if (cycleTimestamps.length >= 2) {
    const t0 = cycleTimestamps[0];
    cycleTimes = cycleTimestamps.map(t => (t - t0) / 1000); // ms to s
  } else if (ampData) {
    // Fallback: estimate 23s per cycle
    cycleTimes = ampData.cycles.map((_, i) => i * 23.0);
  }

  return { ampData, meltData, cycleTimes };
}

function extractChannelMeans(plateRead: Element, channel = 0): Record<string, number> | null {
  const parEl = plateRead.querySelector('Data > PAr');
  if (!parEl?.textContent) return null;

  const values = parEl.textContent.split(';');
  if (values.length < VALUES_PER_READ) return null;

  const channelOffset = channel * (WELLS_PER_PLATE * STATS_PER_WELL);
  const result: Record<string, number> = {};

  for (let pi = 0; pi < DATA_WELLS; pi++) {
    const idx = channelOffset + pi * STATS_PER_WELL; // stat 0 = mean
    const rfu = parseFloat(values[idx]) || 0;
    result[plateIndexToWell(pi)] = rfu;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRfc2822(s: string): number | null {
  if (!s) return null;
  const d = new Date(s.trim());
  return isNaN(d.getTime()) ? null : d.getTime();
}
