/**
 * Agilent AriaMx .amxd / .adxd parser — pure TypeScript port.
 *
 * Decryption: .amxd is a PGP-encrypted+signed TAR archive.
 * Inside is a .SPM file which is itself PGP-encrypted+signed TAR,
 * containing XML data files with fluorescence + metadata.
 *
 * Uses openpgp (dynamic import) with the embedded AriaMx private key.
 *
 * Binary data format (InstrumentData.xml → DataPacketCollection):
 *   Each Plateau element: hex-encoded 1160-byte binary packet.
 *   [0-1] uint16 LE 0x0101 packet type
 *   [2-3] uint16 LE (cycle-1)<<8 cycle index
 *   [6-7] uint16 LE hot_start_s
 *   [8..] 6 channels x 96 wells x 2 bytes (uint16 LE)
 *
 *   Channel order: CY5(0) ROX(1) HEX(2) FAM(3) SYBR(4) CY3(5)
 *   Offset: 8 + channel*192 + well*2
 */

import type { ExperimentData, WellInfo, AmplificationData } from '@/types/experiment';
import { plateIndexToWell, sortWells, buildExperimentData } from './utils';

const PACKET_SIZE = 1160;
const N_CHANNELS = 6;
const N_WELLS = 96;
const CHANNEL_DATA_BYTES = N_WELLS * 2; // 192

// Embedded AriaMx PGP private key (RSA-1024, empty passphrase)
// Key ID: 3F1AF07D202BF668, sk@agilent.com
const ARIAMX_PRIVATE_KEY = `-----BEGIN PGP PRIVATE KEY BLOCK-----

lQHYBE9z0NsBBADMIUw3VVglL0jYEjM/bnIBc1LRJxNDFeR2XOOEQPwixfSM5Qsi
Zn7DgQ15se+IIpZ0yFnF/JR3MIGGTqH7ao8fv1LruAxJYIlwPC3gm+LC70eV1gTg
mnG6wf5jPfyEsVUek/eY72DlOeKjXx440pLEpeCNH1UAJHp2YlMgBE+HtQARAQAB
AAP/VuRBpjgs+j8jed5ddD3WR6nIcgF5IJBcHMoziuOCsGalT6hb0fvhL+VqUAgf
F0rp0rJKDI4UwJukNwCX0Qat/ymWqB/JQnNuv661Htsl34gbwBJ8oRHdXmuneztQ
s9ZA2YCvlJGHFQMWED09qZUeldF5VA5FoGBJDorkakGJoUECAPORvla3AycNrVa+
ZVDWme/GFWfJRQPjqdeCvs3tVRqenVthIvxHcG4KysVcaUJztF+LQcAIJG0Y/m3t
Ldm+oCUCANaMRtdb8+UQ4VcNjYP0RGZMua5qtMqu6m3UKTdNdP3qfhY/go6qI5KP
4U5yDJ3y7w4K4Fu3D/y0wdFVs7XurFECAJRJWhGkbUSddfnTp8vnFC18G3XX0bCy
r+bRhv6GgzTN/AzZvfAEG/1HgUG9/GTmCJNFUZEtHADaN2Z+uVFZgzqgNrQTc2sg
PHNrQGFnaWxlbnQuY29tPoifBBABAgATApkBBQJPc9DbCRA/GvB9ICv2aAAAVukE
AKg39hO8JQuOqOfjFSfMx/s1FhbWWDU69C93mcaJ72b/6q+R7JAsDkg13+wbQMh7
REpL2RNFsY5ulcwJc355vEmFoNA/krbkheq450ImogSga/SAbM2l5yD+c8VJ79oX
KgZCw+EB2BsWLuxtcEPPmmwunPWAV5NI09bQUlPA6Yg0
=ldez
-----END PGP PRIVATE KEY BLOCK-----`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseAmxd(buffer: ArrayBuffer, fileName: string): Promise<ExperimentData> {
  const experimentId = fileName.replace(/\.(amxd|adxd)$/i, '');

  // Decrypt and extract XML files
  const xmlFiles = await extractAmxd(buffer);

  // ExperimentInfo.xml → RunInfo + InstrumentInfo
  const { runInfo, instrument } = parseExperimentInfo(xmlFiles);

  // PlateSetup.xml → sample map + channel list
  const { sampleMap, channelNames } = parsePlateSetup(xmlFiles);

  // ThermalProfile.xml → protocol
  const protocol = parseThermalProfile(xmlFiles);

  // InstrumentData.xml → fluorescence
  const { ampData, elapsedS, hotStartS } = parseInstrumentData(xmlFiles, channelNames, sampleMap);

  // Time reconstruction
  const timeRecon = buildTimeReconstruction(runInfo, ampData, elapsedS, hotStartS);

  // Build amplification
  let amplification: AmplificationData | null = null;
  if (ampData) {
    amplification = {
      cycle: ampData.cycles,
      timeS: timeRecon.cycleTimes,
      timeMin: timeRecon.cycleTimes.map(t => t / 60),
      wells: ampData.wells,
    };
  }

  // Build well info
  const wells: Record<string, WellInfo> = {};
  for (const [name, info] of Object.entries(sampleMap)) {
    wells[name] = {
      well: name, sample: info.sample, content: info.content as WellInfo['content'],
      cq: null, endRfu: null, meltTempC: null, meltPeakHeight: null, call: 'unset',
    };
  }

  const wellsUsed = sortWells(amplification ? Object.keys(amplification.wells) : Object.keys(wells));

  return buildExperimentData({
    fileName, experimentId, instrument,
    runInfo: { file_name: fileName, operator: runInfo.operator, run_started_utc: runInfo.startedUtc, run_ended_utc: runInfo.endedUtc },
    protocol: {
      type: protocol.experimentType,
      reaction_temp_c: protocol.reactionTemp,
      amp_cycle_count: protocol.ampCycles,
      has_melt: protocol.hasMelt,
      raw_definition: protocol.rawDefinition,
    },
    wells, wellsUsed, amplification, melt: null,
    plateRows: 8, plateCols: 12,
    timeReconstruction: {
      source: 'estimated',
      cycle_times_s: timeRecon.cycleTimes,
      mean_cycle_duration_s: timeRecon.meanS,
      warnings: timeRecon.warnings,
    },
  });
}

// ---------------------------------------------------------------------------
// PGP decryption + TAR extraction
// ---------------------------------------------------------------------------

async function decryptPgp(data: Uint8Array): Promise<Uint8Array> {
  // Dynamic import to avoid bundling openpgp unless needed
  const openpgp = await import('openpgp');

  const privateKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: ARIAMX_PRIVATE_KEY }),
    passphrase: '',
  });

  const message = await openpgp.readMessage({ binaryMessage: data });
  const { data: decrypted } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    format: 'binary',
  });

  return decrypted as Uint8Array;
}

/** Minimal TAR reader — extracts files from an uncompressed TAR archive */
function extractTar(data: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let offset = 0;

  while (offset + 512 <= data.length) {
    // Read header block (512 bytes)
    const header = data.slice(offset, offset + 512);

    // Check for end-of-archive (two zero blocks)
    if (header.every(b => b === 0)) break;

    // Filename: bytes 0-99, null-terminated
    let nameEnd = 0;
    while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd++;
    const name = new TextDecoder().decode(header.slice(0, nameEnd));

    // File size: bytes 124-135, octal ASCII
    const sizeStr = new TextDecoder().decode(header.slice(124, 136)).replace(/\0/g, '').trim();
    const fileSize = parseInt(sizeStr, 8) || 0;

    // Type flag: byte 156 ('0' or '\0' = regular file)
    const typeFlag = header[156];
    const isFile = typeFlag === 0 || typeFlag === 0x30; // '\0' or '0'

    offset += 512; // Skip header

    if (isFile && fileSize > 0 && name) {
      files.set(name, data.slice(offset, offset + fileSize));
    }

    // Data is padded to 512-byte boundary
    offset += Math.ceil(fileSize / 512) * 512;
  }

  return files;
}

async function extractAmxd(buffer: ArrayBuffer): Promise<Record<string, Uint8Array>> {
  const amxdData = new Uint8Array(buffer);

  // Outer decryption: .amxd → TAR
  const outerTarData = await decryptPgp(amxdData);

  // Extract outer TAR, find .SPM file
  const outerFiles = extractTar(outerTarData);
  let spmData: Uint8Array | null = null;
  for (const [name, data] of outerFiles) {
    if (name.toUpperCase().endsWith('.SPM')) {
      spmData = data;
      break;
    }
  }
  if (!spmData) throw new Error('No .SPM file found in outer TAR archive');

  // Inner decryption: .SPM → TAR
  const innerTarData = await decryptPgp(spmData);

  // Extract XML files from inner TAR
  const innerFiles = extractTar(innerTarData);
  const xmlFiles: Record<string, Uint8Array> = {};
  for (const [name, data] of innerFiles) {
    if (name.endsWith('.xml')) {
      // Use basename
      const basename = name.includes('/') ? name.split('/').pop()! : name;
      xmlFiles[basename] = data;
    }
  }

  return xmlFiles;
}

// ---------------------------------------------------------------------------
// ExperimentInfo.xml
// ---------------------------------------------------------------------------

function parseExperimentInfo(xmlFiles: Record<string, Uint8Array>) {
  const raw = xmlFiles['ExperimentInfo.xml'];
  if (!raw) return {
    runInfo: { operator: '', startedUtc: '', endedUtc: '' },
    instrument: { manufacturer: 'Agilent', model: 'AriaMx' },
  };

  const doc = new DOMParser().parseFromString(new TextDecoder().decode(raw), 'text/xml');
  const text = (tag: string) => doc.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';

  return {
    runInfo: {
      operator: text('PrimedBy') || text('SavedBy'),
      startedUtc: parseAriaDatetime(text('StartTime')),
      endedUtc: parseAriaDatetime(text('EndTime')),
    },
    instrument: {
      manufacturer: 'Agilent',
      model: text('Name') || 'AriaMx',
      serial_number: text('SerialNo'),
      software_version: text('SWVersion'),
    },
  };
}

// ---------------------------------------------------------------------------
// PlateSetup.xml
// ---------------------------------------------------------------------------

function parsePlateSetup(xmlFiles: Record<string, Uint8Array>) {
  const raw = xmlFiles['PlateSetup.xml'];
  if (!raw) return { sampleMap: {}, channelNames: [] as string[] };

  const doc = new DOMParser().parseFromString(new TextDecoder().decode(raw), 'text/xml');

  // Channel names
  const channelNames: string[] = [];
  for (const dye of Array.from(doc.getElementsByTagName('Dye'))) {
    channelNames.push(dye.getAttribute('name')?.trim() ?? '');
  }

  // Grid dimensions
  const grid = doc.getElementsByTagName('Grid')[0];
  const nCols = parseInt(grid?.getAttribute('Width') ?? '12') || 12;
  const nRows = parseInt(grid?.getAttribute('Height') ?? '8') || 8;

  // Well entries
  const sampleMap: Record<string, { sample: string; content: string }> = {};
  const wellEls = Array.from(doc.getElementsByTagName('PlateProtocolWell'));
  for (let i = 0; i < Math.min(wellEls.length, nRows * nCols); i++) {
    const el = wellEls[i];
    const row = Math.floor(i / nCols);
    const col = i % nCols + 1;
    const wellName = `${String.fromCharCode(65 + row)}${col}`;
    const wellType = el.getAttribute('WellType')?.trim() ?? '';
    if (!wellType) continue;
    const wellDisplay = el.getAttribute('WellName') ?? el.getAttribute('WellNamesToDisplay') ?? wellName;
    sampleMap[wellName] = { sample: wellDisplay, content: mapWellType(wellType) };
  }

  return { sampleMap, channelNames };
}

// ---------------------------------------------------------------------------
// ThermalProfile.xml
// ---------------------------------------------------------------------------

function parseThermalProfile(xmlFiles: Record<string, Uint8Array>) {
  const raw = xmlFiles['ThermalProfile.xml'];
  if (!raw) return { experimentType: 'standard_pcr', reactionTemp: null, ampCycles: null, hasMelt: false, rawDefinition: '' };

  const doc = new DOMParser().parseFromString(new TextDecoder().decode(raw), 'text/xml');

  let ampCycles: number | null = null;
  let reactionTemp: number | null = null;
  let hasMelt = false;
  const rawLines: string[] = [];

  for (const seg of Array.from(doc.getElementsByTagName('ThermalProfileSegment'))) {
    const segName = seg.getAttribute('Name') ?? '';
    const segType = seg.getAttribute('SegmentType') ?? '';
    const nCycles = parseInt(seg.getAttribute('RequestedCycleCount') ?? '1') || 1;
    rawLines.push(`Segment: ${segName} (${nCycles} cycles, type=${segType})`);

    for (const plateau of Array.from(seg.getElementsByTagName('ThermalProfilePlateau'))) {
      const temp = plateau.getAttribute('LeftTemperature') ?? '';
      const dur = plateau.getAttribute('Duration') ?? '';
      const collect = plateau.getAttribute('CollectionType') === '1';
      rawLines.push(`  Plateau ${temp}C ${dur}s ${collect ? '[READ]' : ''}`);
      if (collect && temp && reactionTemp === null) {
        const t = parseFloat(temp);
        if (!isNaN(t)) reactionTemp = t;
      }
    }

    if (segType === 'Amplification' || segName.includes('Amplif')) ampCycles = nCycles;
    if (segType === 'MeltCurve' || segType === 'Melt' || segName.includes('Melt')) hasMelt = true;
  }

  return { experimentType: 'standard_pcr', reactionTemp, ampCycles, hasMelt, rawDefinition: rawLines.join('\n') };
}

// ---------------------------------------------------------------------------
// InstrumentData.xml → fluorescence
// ---------------------------------------------------------------------------

function parseInstrumentData(
  xmlFiles: Record<string, Uint8Array>,
  channelNames: string[],
  sampleMap: Record<string, { sample: string; content: string }>,
) {
  const raw = xmlFiles['InstrumentData.xml'];
  if (!raw) return { ampData: null, elapsedS: null, hotStartS: 0 };

  let xmlText = new TextDecoder('utf-8').decode(raw);
  if (xmlText.charCodeAt(0) === 0xFEFF) xmlText = xmlText.slice(1);
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

  // ExperimentElapsedTime
  const elapsedEl = doc.getElementsByTagName('ExperimentElapsedTime')[0];
  const elapsedS = elapsedEl?.textContent ? parseFloat(elapsedEl.textContent.trim()) || null : null;

  const dpc = doc.getElementsByTagName('DataPacketCollection')[0];
  if (!dpc) return { ampData: null, elapsedS, hotStartS: 0 };

  // Collect all packets
  const allPackets = new Map<number, DataView>();
  let hotStartS = 0;

  for (const plateau of Array.from(dpc.children)) {
    const hexData = plateau.textContent?.trim();
    if (!hexData) continue;
    let packet: Uint8Array;
    try { packet = hexToBytes(hexData); } catch { continue; }
    if (packet.length < PACKET_SIZE) continue;

    const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
    const cycleWord = view.getUint16(2, true);
    const cycleNum = (cycleWord >> 8) + 1;

    if (hotStartS === 0) hotStartS = view.getUint16(6, true);

    allPackets.set(cycleNum, view);
  }

  if (allPackets.size === 0) return { ampData: null, elapsedS, hotStartS };

  // Auto-detect primary channel
  const firstPacket = allPackets.values().next().value!;
  const primaryCh = pickPrimaryChannel(firstPacket, channelNames);

  // Build per-cycle per-well fluorescence
  const occupiedSet = new Set(Object.keys(sampleMap));
  const cycles: number[] = [];
  const wells: Record<string, number[]> = {};

  // Find all wells with non-zero signal
  const allActive = new Set<string>();
  for (const view of allPackets.values()) {
    for (let wi = 0; wi < N_WELLS; wi++) {
      const offset = 8 + primaryCh * CHANNEL_DATA_BYTES + wi * 2;
      if (view.getUint16(offset, true) > 0) {
        allActive.add(plateIndexToWell(wi));
      }
    }
  }

  const occupied = sortWells(
    [...allActive].filter(w => occupiedSet.size === 0 || occupiedSet.has(w))
  );
  if (occupied.length === 0) return { ampData: null, elapsedS, hotStartS };

  for (const w of occupied) wells[w] = [];

  for (const c of [...allPackets.keys()].sort((a, b) => a - b)) {
    cycles.push(c);
    const view = allPackets.get(c)!;
    for (const w of occupied) {
      const wi = wellNameToIndex(w);
      const offset = 8 + primaryCh * CHANNEL_DATA_BYTES + wi * 2;
      wells[w].push(view.getUint16(offset, true));
    }
  }

  return { ampData: { cycles, wells }, elapsedS, hotStartS };
}

function pickPrimaryChannel(view: DataView, channelNames: string[]): number {
  const roxIndices = new Set(channelNames.map((n, i) => n.toUpperCase().includes('ROX') ? i : -1).filter(i => i >= 0));

  let bestCh = -1;
  let bestCount = -1;
  for (let ch = 0; ch < Math.min(N_CHANNELS, channelNames.length); ch++) {
    if (roxIndices.has(ch)) continue;
    let count = 0;
    for (let wi = 0; wi < N_WELLS; wi++) {
      const offset = 8 + ch * CHANNEL_DATA_BYTES + wi * 2;
      if (offset + 2 <= view.byteLength && view.getUint16(offset, true) > 0) count++;
    }
    if (count > bestCount) { bestCount = count; bestCh = ch; }
  }

  if (bestCh >= 0 && bestCount > 0) return bestCh;

  // Fallback: prefer FAM/SYBR by name
  for (let i = 0; i < channelNames.length; i++) {
    const name = channelNames[i].toUpperCase();
    if (name === 'FAM' || name === 'SYBR') return i;
  }
  return Math.min(3, Math.max(0, channelNames.length - 1));
}

// ---------------------------------------------------------------------------
// Time reconstruction
// ---------------------------------------------------------------------------

function buildTimeReconstruction(
  runInfo: { startedUtc: string; endedUtc: string },
  ampData: { cycles: number[]; wells: Record<string, number[]> } | null,
  elapsedS: number | null,
  hotStartS: number,
): { cycleTimes: number[]; meanS: number | null; warnings: string[] } {
  if (!ampData || ampData.cycles.length === 0) {
    return { cycleTimes: [], meanS: null, warnings: ['No amplification data'] };
  }

  const cycleCount = ampData.cycles.length;

  if (elapsedS !== null && elapsedS > 0) {
    const cyclingS = elapsedS - hotStartS;
    const meanS = Math.max(cyclingS / cycleCount, 1);
    return {
      cycleTimes: Array.from({ length: cycleCount }, (_, i) => hotStartS + i * meanS),
      meanS,
      warnings: [`Timing estimated from ElapsedTime (${elapsedS.toFixed(0)}s total, ${hotStartS.toFixed(0)}s hot start)`],
    };
  }

  if (runInfo.startedUtc && runInfo.endedUtc) {
    const start = new Date(runInfo.startedUtc).getTime();
    const end = new Date(runInfo.endedUtc).getTime();
    if (!isNaN(start) && !isNaN(end)) {
      const totalS = (end - start) / 1000;
      const cyclingS = totalS - hotStartS;
      const meanS = Math.max(cyclingS / cycleCount, 1);
      return {
        cycleTimes: Array.from({ length: cycleCount }, (_, i) => hotStartS + i * meanS),
        meanS,
        warnings: ['Timing estimated from start/end times'],
      };
    }
  }

  const meanS = 30;
  return {
    cycleTimes: Array.from({ length: cycleCount }, (_, i) => hotStartS + i * meanS),
    meanS,
    warnings: ['Timing estimated with default 30s/cycle'],
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function wellNameToIndex(well: string): number {
  const row = well.charCodeAt(0) - 65; // A=0, B=1, ...
  const col = parseInt(well.slice(1)) - 1;
  return row * 12 + col;
}

function mapWellType(wellType: string): string {
  const wt = wellType.toUpperCase();
  if (wt.includes('STANDARD')) return 'Std';
  if (wt.includes('NTC')) return 'Neg Ctrl';
  if (wt.includes('POSITIVE')) return 'Pos Ctrl';
  if (wt.includes('NEGATIVE')) return 'Neg Ctrl';
  return 'Unkn';
}

function parseAriaDatetime(s: string): string {
  if (!s) return '';
  // Try various formats
  for (const fmt of [
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i,
  ]) {
    const m = s.match(fmt);
    if (m) {
      let hour = parseInt(m[4]);
      const ampm = m[7].toUpperCase();
      if (ampm === 'PM' && hour < 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
      return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${String(hour).padStart(2, '0')}:${m[5]}:${m[6]}`;
    }
  }
  // Try ISO format directly
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
