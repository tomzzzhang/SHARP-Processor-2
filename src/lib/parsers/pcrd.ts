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
  xmlAllByTag, computeTimeStats,
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
  const protocol = parseProtocol(doc);

  // Parse plate setup (sample map)
  const sampleMap = parsePlateSetup(doc);

  // Channel → fluorophore assignment (authoritative: BioRad's own dye layers).
  const dyeChannels = parseDyeLayers(doc);

  // Parse fluorescence data + timestamps (all 6 optical channels).
  const { cycles, ampChannels, ampPresent, temperatures, meltChannels, meltPresent, cycleTimes } =
    parseRunData(doc);

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

  const timeS = cycleTimes;
  const timeMin = cycleTimes.map(t => t / 60);

  // Decide which optical channels to emit. A channel counts only if it carries
  // real signal (unused channels are all-zero in the PAr blob). When BioRad
  // assigned dye layers, those are authoritative — emit exactly the assigned
  // channels that also have data, named from the dye layer. Otherwise fall back
  // to any channel with data, named "Channel N".
  const hasSignal = (ch: number) =>
    (ampPresent && channelHasSignal(ampChannels[ch])) ||
    (meltPresent && channelHasSignal(meltChannels[ch]));

  const emitted: { idx: number; name: string }[] = [];
  for (let ch = 0; ch < CHANNELS; ch++) {
    const assignedName = dyeChannels.get(ch);
    if (dyeChannels.size > 0) {
      if (assignedName !== undefined && hasSignal(ch)) emitted.push({ idx: ch, name: assignedName });
    } else if (hasSignal(ch)) {
      emitted.push({ idx: ch, name: `Channel ${ch + 1}` });
    }
  }
  // Fallbacks: never emit zero channels.
  if (emitted.length === 0) {
    for (let ch = 0; ch < CHANNELS; ch++) {
      if (hasSignal(ch)) emitted.push({ idx: ch, name: dyeChannels.get(ch) ?? `Channel ${ch + 1}` });
    }
  }
  if (emitted.length === 0) emitted.push({ idx: 0, name: dyeChannels.get(0) ?? 'Channel 1' });

  // Build per-channel amplification + melt.
  const channels: string[] = [];
  const channelFluorophore: Record<string, string> = {};
  const amplificationByChannel: Record<string, AmplificationData | null> = {};
  const meltByChannel: Record<string, MeltData | null> = {};
  const usedIds = new Set<string>();
  for (const { idx, name } of emitted) {
    let id = name;
    if (usedIds.has(id)) id = `${name} (ch${idx + 1})`;  // disambiguate duplicate dye names
    usedIds.add(id);
    channels.push(id);
    channelFluorophore[id] = name;

    amplificationByChannel[id] = ampPresent
      ? { cycle: cycles, timeS, timeMin, wells: filterWells(ampChannels[idx]) }
      : null;

    if (meltPresent) {
      const rfu = filterWells(meltChannels[idx]);
      meltByChannel[id] = { temperatureC: temperatures, rfu, derivative: computeMeltDerivative(temperatures, rfu) };
    } else {
      meltByChannel[id] = null;
    }
  }

  // Build well info (channel-independent identity).
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

  // Wells used: union across channels (all channels share the plate layout).
  const wellSet = new Set<string>();
  for (const id of channels) {
    const amp = amplificationByChannel[id];
    const m = meltByChannel[id];
    if (amp) for (const w of Object.keys(amp.wells)) wellSet.add(w);
    else if (m) for (const w of Object.keys(m.rfu)) wellSet.add(w);
  }
  if (wellSet.size === 0) for (const w of Object.keys(wells)) wellSet.add(w);
  const wellsUsed = sortWells([...wellSet]);

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
    channels,
    channelFluorophore,
    amplificationByChannel,
    meltByChannel,
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

  let swVersion = '';
  if (header) {
    const appVer = header.getAttribute('createdByClientAppVersion') ?? '';
    if (appVer) swVersion = appVer.split('.').slice(0, 3).join('.');
  }

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

function parseProtocol(doc: Document): ProtocolData {
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

/** Per-channel well series: channel index → { well → series }. Channels with
 *  no signal stay as empty/all-zero maps and are dropped by the caller. */
type ChannelWells = Record<number, Record<string, number[]>>;

interface RawRunData {
  cycles: number[];
  ampChannels: ChannelWells;
  ampPresent: boolean;
  temperatures: number[];
  meltChannels: ChannelWells;
  meltPresent: boolean;
  cycleTimes: number[];
}

// Plate well names, indexed by plateIndex (computed once).
const WELL_NAMES = Array.from({ length: DATA_WELLS }, (_, i) => plateIndexToWell(i));

function emptyChannelWells(): ChannelWells {
  const cw: ChannelWells = {};
  for (let c = 0; c < CHANNELS; c++) cw[c] = {};
  return cw;
}

function parseRunData(doc: Document): RawRunData {
  const empty: RawRunData = {
    cycles: [], ampChannels: emptyChannelWells(), ampPresent: false,
    temperatures: [], meltChannels: emptyChannelWells(), meltPresent: false,
    cycleTimes: [],
  };
  const plateReads = Array.from(doc.querySelectorAll('plateReadDataVector > plateRead > PlateRead'));
  if (plateReads.length === 0) return empty;

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

  // Amplification data — all 6 channels.
  const cycles: number[] = [];
  const ampChannels = emptyChannelWells();
  let ampPresent = false;
  const cycleTimestamps: number[] = [];

  if (ampStep !== null) {
    for (const pr of readsByStep.get(ampStep)!) {
      const header = pr.querySelector('Hdr > PlateReadDataHeader');
      const cycleEl = header?.querySelector('Cycle');
      const timeEl = header?.querySelector('Time');
      const cycle = parseInt(cycleEl?.textContent ?? '0') || 0;

      const all = extractAllChannels(pr);
      if (!all) continue;

      if (timeEl?.textContent) {
        const ts = parseRfc2822(timeEl.textContent);
        if (ts !== null) cycleTimestamps.push(ts);
      }
      cycles.push(cycle);
      appendRead(ampChannels, all);
    }
    ampPresent = cycles.length > 0;
  }

  // Melt data — all 6 channels.
  const temperatures: number[] = [];
  const meltChannels = emptyChannelWells();
  let meltPresent = false;

  if (meltStep !== null) {
    for (const pr of readsByStep.get(meltStep)!) {
      const header = pr.querySelector('Hdr > PlateReadDataHeader');
      const blockTmpEl = header?.querySelector('BlockTmp');
      const tempC = parseFloat(blockTmpEl?.textContent ?? '');
      if (isNaN(tempC)) continue;

      const all = extractAllChannels(pr);
      if (!all) continue;

      temperatures.push(Math.round(tempC * 100) / 100);
      appendRead(meltChannels, all);
    }
    meltPresent = temperatures.length > 0;
  }

  // Build cycle times from timestamps
  let cycleTimes: number[] = [];
  if (cycleTimestamps.length >= 2) {
    const t0 = cycleTimestamps[0];
    cycleTimes = cycleTimestamps.map(t => (t - t0) / 1000); // ms to s
  } else if (ampPresent) {
    // Fallback: estimate 23s per cycle
    cycleTimes = cycles.map((_, i) => i * 23.0);
  }

  return { cycles, ampChannels, ampPresent, temperatures, meltChannels, meltPresent, cycleTimes };
}

/** Append one plate read's per-channel means (channel-major [ch][wellIdx]) to
 *  the running per-channel well series. */
function appendRead(channelWells: ChannelWells, read: number[][]): void {
  for (let c = 0; c < CHANNELS; c++) {
    const chWells = channelWells[c];
    const vals = read[c];
    for (let pi = 0; pi < DATA_WELLS; pi++) {
      const wn = WELL_NAMES[pi];
      (chWells[wn] ??= []).push(vals[pi]);
    }
  }
}

/** Extract the mean (stat 0) for every data well across all 6 channels from a
 *  single plate read's PAr blob. Returns [channel][wellIndex] or null. */
function extractAllChannels(plateRead: Element): number[][] | null {
  const parEl = plateRead.querySelector('Data > PAr');
  if (!parEl?.textContent) return null;

  const values = parEl.textContent.split(';');
  if (values.length < VALUES_PER_READ) return null;

  const out: number[][] = [];
  for (let c = 0; c < CHANNELS; c++) {
    const channelOffset = c * (WELLS_PER_PLATE * STATS_PER_WELL);
    const arr = new Array<number>(DATA_WELLS);
    for (let pi = 0; pi < DATA_WELLS; pi++) {
      arr[pi] = parseFloat(values[channelOffset + pi * STATS_PER_WELL]) || 0; // stat 0 = mean
    }
    out.push(arr);
  }
  return out;
}

/** A channel carries real signal if any well has a non-zero reading (unused
 *  optical channels are exactly zero throughout the PAr blob). */
function channelHasSignal(wells: Record<string, number[]>): boolean {
  for (const series of Object.values(wells)) {
    for (const v of series) if (v !== 0) return true;
  }
  return false;
}

/** Map each assigned fluorophore's optical channel index → dye name, from
 *  BioRad's `<dyeLayersList>`. Empty when the file declares no dye layers. */
function parseDyeLayers(doc: Document): Map<number, string> {
  const map = new Map<number, string>();
  for (const fl of Array.from(doc.querySelectorAll('dyeLayersList fluor'))) {
    if ((fl.getAttribute('isDeleted') ?? '').toLowerCase() === 'true') continue;
    const posStr = fl.getAttribute('channelPosition');
    if (posStr === null) continue;
    const pos = parseInt(posStr);
    if (isNaN(pos) || pos < 0 || pos >= CHANNELS) continue;
    if (map.has(pos)) continue;
    const name = (fl.getAttribute('fluorName') ?? '').trim();
    map.set(pos, name || `Channel ${pos + 1}`);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRfc2822(s: string): number | null {
  if (!s) return null;
  const d = new Date(s.trim());
  return isNaN(d.getTime()) ? null : d.getTime();
}
