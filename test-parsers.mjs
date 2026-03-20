/**
 * Quick integration test for instrument file parsers.
 * Tests ZIP extraction, decryption, and data parsing.
 *
 * Usage: node test-parsers.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { inflateSync } from 'fflate';
import { parseHTML } from 'linkedom';

// Polyfill DOMParser for Node.js
const { DOMParser } = parseHTML('<!DOCTYPE html><html></html>');
globalThis.DOMParser = DOMParser;

// -------------------------------------------------------------------------
// ZipCrypto implementation (matches src/lib/parsers/zip-crypto.ts)
// -------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[i] = c;
}
function crc32update(crc, byte) { return CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8); }

class ZipCryptoStream {
  constructor(password) {
    this.key0 = 0x12345678; this.key1 = 0x23456789; this.key2 = 0x34567890;
    for (const b of password) this._update(b);
  }
  _update(byte) {
    this.key0 = crc32update(this.key0, byte);
    this.key1 = (Math.imul((this.key1 + (this.key0 & 0xFF)) >>> 0, 134775813) + 1) >>> 0;
    this.key2 = crc32update(this.key2, (this.key1 >>> 24) & 0xFF);
  }
  decrypt(data) {
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const k = BigInt((this.key2 | 2) >>> 0);
      const keyByte = Number(((k * (k ^ 1n)) >> 8n) & 0xFFn);
      const dec = data[i] ^ keyByte;
      result[i] = dec;
      this._update(dec);
    }
    return result;
  }
}

function readU16(d, o) { return d[o] | (d[o+1] << 8); }
function readU32(d, o) { return (d[o] | (d[o+1] << 8) | (d[o+2] << 16) | (d[o+3] << 24)) >>> 0; }

function unzipWithPassword(data, password) {
  let eocd = data.length - 22;
  while (eocd >= 0 && readU32(data, eocd) !== 0x06054B50) eocd--;
  if (eocd < 0) throw new Error('Not a ZIP file');

  const cdOff = readU32(data, eocd + 16);
  const count = readU16(data, eocd + 10);
  const result = {};
  let off = cdOff;

  for (let i = 0; i < count; i++) {
    if (readU32(data, off) !== 0x02014B50) break;
    const flags = readU16(data, off + 8);
    const method = readU16(data, off + 10);
    const compSize = readU32(data, off + 20);
    const nameLen = readU16(data, off + 28);
    const extraLen = readU16(data, off + 30);
    const commentLen = readU16(data, off + 32);
    const localOff = readU32(data, off + 42);
    const name = new TextDecoder().decode(data.slice(off + 46, off + 46 + nameLen));

    const locNameLen = readU16(data, localOff + 26);
    const locExtraLen = readU16(data, localOff + 28);
    const dataOff = localOff + 30 + locNameLen + locExtraLen;
    const encrypted = (flags & 1) !== 0;

    if (!name.endsWith('/')) {
      let fileData = data.slice(dataOff, dataOff + compSize);
      if (encrypted) {
        if (!password) throw new Error(`Encrypted: ${name}`);
        fileData = new ZipCryptoStream(password).decrypt(fileData);
        fileData = fileData.slice(12);
      }
      result[name] = method === 8 ? inflateSync(fileData) : fileData;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return result;
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function readIniSection(text, section) {
  const r = {}; let in_ = false; const t = `[${section}]`;
  for (const l of text.split('\n')) {
    const s = l.trim();
    if (s === t) { in_ = true; continue; }
    if (s.startsWith('[') && in_) break;
    if (in_ && s.includes('=')) { const i = s.indexOf('='); r[s.slice(0,i)] = s.slice(i+1); }
  }
  return r;
}

function hexToBytes(hex) {
  const c = hex.replace(/\s/g, '');
  const b = new Uint8Array(c.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(c.slice(i*2, i*2+2), 16);
  return b;
}

// -------------------------------------------------------------------------
// Test PCRD
// -------------------------------------------------------------------------

const PCRD_PW = new TextEncoder().encode('SecureCompressDecompressKeyiQ5V4Files!!##$$');

function testPcrd(filePath) {
  console.log(`\n=== PCRD: ${filePath.split(/[/\\]/).pop()} ===`);
  const raw = readFileSync(filePath);
  const files = unzipWithPassword(new Uint8Array(raw), PCRD_PW);
  const keys = Object.keys(files);
  console.log(`  ZIP entries: ${keys.join(', ')}`);

  let xml = new TextDecoder('utf-8').decode(files[keys[0]]);
  if (xml.charCodeAt(0) === 0xFEFF) xml = xml.slice(1);
  console.log(`  XML: ${xml.length} chars`);

  const doc = new DOMParser().parseFromString(xml, 'text/xml');

  const wellSamples = doc.getElementsByTagName('wellSample');
  const occupied = Array.from(wellSamples).filter(ws => ws.getAttribute('wellSampleType') !== 'wcEmpty');
  console.log(`  Wells: ${occupied.length}`);

  const plateReads = doc.querySelectorAll('plateReadDataVector > plateRead > PlateRead');
  console.log(`  PlateReads: ${plateReads.length}`);

  const readsByStep = new Map();
  for (const pr of plateReads) {
    const h = pr.querySelector('Hdr > PlateReadDataHeader');
    const s = parseInt(h?.querySelector('Step')?.textContent ?? '0') || 0;
    readsByStep.set(s, (readsByStep.get(s) ?? 0) + 1);
  }
  for (const [step, count] of readsByStep) {
    const label = step === Math.min(...readsByStep.keys()) ? 'amp' : 'melt';
    console.log(`  Step ${step}: ${count} reads (${label})`);
  }

  // Verify PAr data
  if (plateReads.length > 0) {
    const par = plateReads[0].querySelector('Data > PAr');
    const vals = par?.textContent?.split(';') ?? [];
    console.log(`  PAr values: ${vals.length} (expect 2592)`);
    if (vals.length >= 5) console.log(`  First 5: ${vals.slice(0,5).map(v => (+v).toFixed(1)).join(', ')}`);
  }

  console.log('  PASS');
}

// -------------------------------------------------------------------------
// Test TLPD
// -------------------------------------------------------------------------

const TLPD_PW = new TextEncoder().encode('82218051');

function testTlpd(filePath) {
  console.log(`\n=== TLPD: ${filePath.split(/[/\\]/).pop()} ===`);
  const raw = readFileSync(filePath);
  const files = unzipWithPassword(new Uint8Array(raw), TLPD_PW);
  console.log(`  ZIP entries: ${Object.keys(files).join(', ')}`);

  const expData = new TextDecoder().decode(files.experiment_data ?? files[Object.keys(files)[0]]);
  const fi = readIniSection(expData, 'FileInfo');
  console.log(`  Instrument: ${fi.InstrumentTypeName ?? 'unknown'}`);

  const amp = readIniSection(expData, 'AmpData');
  const cycles = parseInt(amp['Cycle\\size'] ?? '0');
  console.log(`  Amp cycles: ${cycles}`);

  if (cycles > 0) {
    const hex = amp['Cycle\\1\\Value'] ?? '';
    const raw = hexToBytes(hex);
    const vals = [];
    for (let w = 0; w < 16 && w*2+2 <= raw.length; w++) {
      vals.push(new DataView(raw.buffer, raw.byteOffset + w*2, 2).getUint16(0, true));
    }
    console.log(`  Cycle 1 (16 wells): ${vals.join(', ')}`);
  }

  const melt = readIniSection(expData, 'MeltData');
  console.log(`  Melt points: ${parseInt(melt['Cycle\\size'] ?? '0')}`);
  console.log('  PASS');
}

// -------------------------------------------------------------------------
// Test EDS
// -------------------------------------------------------------------------

function testEds(filePath) {
  console.log(`\n=== EDS: ${filePath.split(/[/\\]/).pop()} ===`);
  const raw = readFileSync(filePath);
  const files = unzipWithPassword(new Uint8Array(raw)); // no password
  const keys = Object.keys(files);
  console.log(`  ZIP entries: ${keys.length}`);

  const isModern = keys.includes('summary.json');
  console.log(`  Format: ${isModern ? 'modern' : 'legacy'}`);

  if (isModern) {
    const summary = JSON.parse(new TextDecoder().decode(files['summary.json']));
    console.log(`  Name: ${summary.name ?? 'unknown'}`);
    console.log(`  Instrument: ${summary.instrumentType ?? 'unknown'}`);

    if (files['primary/analysis_result.json']) {
      const analysis = JSON.parse(new TextDecoder().decode(files['primary/analysis_result.json']));
      const wellResults = analysis.wellResults ?? [];
      console.log(`  Well results: ${wellResults.length}`);
      if (wellResults.length > 0) {
        const first = wellResults[0];
        const rn = first.reactionResults?.[0]?.amplificationResult?.rn ?? [];
        console.log(`  Cycles (first well): ${rn.length}`);
      }
    }
  } else {
    // Legacy — check for experiment.xml
    const xmlKey = keys.find(k => k.includes('experiment.xml'));
    console.log(`  experiment.xml: ${xmlKey ? 'found' : 'NOT FOUND'}`);
    if (xmlKey) {
      const xml = new TextDecoder().decode(files[xmlKey]);
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const instrument = doc.getElementsByTagName('InstrumentType')[0]?.textContent ??
                         doc.getElementsByTagName('InstrumentName')[0]?.textContent ?? 'unknown';
      console.log(`  Instrument: ${instrument}`);
    }

    // Check quant files
    const quantFiles = keys.filter(k => k.includes('/quant/') && k.endsWith('.quant'));
    console.log(`  Quant files: ${quantFiles.length}`);
  }

  console.log('  PASS');
}

// -------------------------------------------------------------------------
// Run tests
// -------------------------------------------------------------------------

const testFiles = {
  pcrd: [
    'C:/Users/Tom/OneDrive - SHARP Diagnostics/qPCR/2025-06-05 14-09-20_Unwinding_New_PcrA2.pcrd',
  ],
  tlpd: [
    'C:/Users/Tom/OneDrive - SHARP Diagnostics/SHARED Files/12_Software/SHARP/SHARP_Processor/Try this data set - l200 SHARP(1) 100ul.tlpd',
  ],
  eds: [
    'G:/Melt Curve Fast.eds',
    'C:/QuantStudio Design & Analysis Software/examples/4Plex_Multiplex_MMx_10uL.eds',
    'C:/QuantStudio Design & Analysis Software/examples/PCR_w_Melt_SYBR_Select_MMx_10uL.eds',
    'C:/QuantStudio Design & Analysis Software/examples/QS5_96_0.1mL_Melt_Only.eds',
  ],
};

console.log('SHARP Processor 2 — Parser Integration Tests');
console.log('=============================================');

let passed = 0, failed = 0;

for (const [fmt, paths] of Object.entries(testFiles)) {
  for (const p of paths) {
    if (!existsSync(p)) {
      console.log(`\n  SKIP: ${p} (not found)`);
      continue;
    }
    try {
      if (fmt === 'pcrd') testPcrd(p);
      else if (fmt === 'tlpd') testTlpd(p);
      else if (fmt === 'eds') testEds(p);
      passed++;
    } catch (e) {
      console.error(`\n  FAIL: ${e.message}`);
      console.error(`  ${e.stack?.split('\n')[1] ?? ''}`);
      failed++;
    }
  }
}

console.log(`\n=============================================`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
