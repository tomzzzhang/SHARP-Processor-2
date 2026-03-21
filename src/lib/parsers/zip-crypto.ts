/**
 * ZIP archive reader with ZipCrypto decryption support.
 *
 * ZipCrypto is the legacy (pre-AES) ZIP encryption using a CRC32-based
 * stream cipher. BioRad .pcrd and TianLong .tlpd files use this.
 *
 * This module parses ZIP local/central directory structures, decrypts
 * encrypted entries using ZipCrypto, and decompresses via fflate's inflate.
 */

import { inflateSync } from 'fflate';

// ---------------------------------------------------------------------------
// CRC32 table (same as used internally by ZipCrypto)
// ---------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

function crc32update(crc: number, byte: number): number {
  return CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
}

// ---------------------------------------------------------------------------
// ZipCrypto stream cipher
// ---------------------------------------------------------------------------

class ZipCryptoStream {
  private key0 = 0x12345678;
  private key1 = 0x23456789;
  private key2 = 0x34567890;

  constructor(password: Uint8Array) {
    for (const b of password) {
      this.updateKeys(b);
    }
  }

  private updateKeys(byte: number) {
    this.key0 = crc32update(this.key0, byte);
    this.key1 = (Math.imul((this.key1 + (this.key0 & 0xFF)) >>> 0, 134775813) + 1) >>> 0;
    this.key2 = crc32update(this.key2, (this.key1 >>> 24) & 0xFF);
  }

  decrypt(data: Uint8Array): Uint8Array {
    const result = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const k = BigInt((this.key2 | 2) >>> 0);
      const keyByte = Number(((k * (k ^ 1n)) >> 8n) & 0xFFn);
      const decrypted = data[i] ^ keyByte;
      result[i] = decrypted;
      this.updateKeys(decrypted);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// ZIP structure parsing
// ---------------------------------------------------------------------------

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  encrypted: boolean;
  dataOffset: number; // offset to file data in the archive
  crc32: number;
}

function readUint16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

/**
 * Parse ZIP central directory to get entry metadata.
 * This is more reliable than local headers because it always has correct sizes
 * (local headers may have zeros when bit 3 of general purpose flag is set).
 */
function parseZipEntries(data: Uint8Array): ZipEntry[] {
  // Find End of Central Directory record (scan backward)
  let eocdOffset = data.length - 22;
  while (eocdOffset >= 0) {
    if (readUint32LE(data, eocdOffset) === 0x06054B50) break;
    eocdOffset--;
  }
  if (eocdOffset < 0) throw new Error('Not a valid ZIP file: EOCD not found');

  const cdOffset = readUint32LE(data, eocdOffset + 16);
  const entryCount = readUint16LE(data, eocdOffset + 10);

  const entries: ZipEntry[] = [];
  let offset = cdOffset;

  for (let i = 0; i < entryCount; i++) {
    if (readUint32LE(data, offset) !== 0x02014B50) break;

    const flags = readUint16LE(data, offset + 8);
    const method = readUint16LE(data, offset + 10);
    const crc32 = readUint32LE(data, offset + 16);
    const compSize = readUint32LE(data, offset + 20);
    const uncompSize = readUint32LE(data, offset + 24);
    const nameLen = readUint16LE(data, offset + 28);
    const extraLen = readUint16LE(data, offset + 30);
    const commentLen = readUint16LE(data, offset + 32);
    const localHeaderOffset = readUint32LE(data, offset + 42);

    const name = new TextDecoder().decode(data.slice(offset + 46, offset + 46 + nameLen));

    // Calculate data offset from local file header
    const localNameLen = readUint16LE(data, localHeaderOffset + 26);
    const localExtraLen = readUint16LE(data, localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    entries.push({
      name,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      compressionMethod: method,
      encrypted: (flags & 1) !== 0,
      dataOffset,
      crc32,
    });

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ZipFile {
  [name: string]: Uint8Array;
}

/**
 * Extract all files from a ZIP archive, optionally decrypting with a password.
 * Supports ZipCrypto (legacy ZIP encryption) and Deflate compression.
 */
export function unzipWithPassword(data: Uint8Array, password?: Uint8Array): ZipFile {
  const entries = parseZipEntries(data);
  const result: ZipFile = {};

  for (const entry of entries) {
    // Skip directories
    if (entry.name.endsWith('/')) continue;

    let fileData = data.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize);

    if (entry.encrypted) {
      if (!password) throw new Error(`Entry "${entry.name}" is encrypted but no password provided`);
      // Decrypt
      const stream = new ZipCryptoStream(password);
      fileData = stream.decrypt(fileData) as Uint8Array<ArrayBuffer>;
      // Skip 12-byte encryption header
      fileData = fileData.slice(12);
    }

    // Decompress
    if (entry.compressionMethod === 8) {
      // Deflate
      result[entry.name] = inflateSync(fileData);
    } else if (entry.compressionMethod === 0) {
      // Stored (no compression)
      result[entry.name] = fileData;
    } else {
      throw new Error(`Unsupported compression method ${entry.compressionMethod} for "${entry.name}"`);
    }
  }

  return result;
}

/**
 * Extract files from an unencrypted ZIP archive.
 * Convenience wrapper that calls unzipWithPassword without a password.
 */
export function unzipPlain(data: Uint8Array): ZipFile {
  return unzipWithPassword(data);
}
