import { readFile } from '@tauri-apps/plugin-fs';
import type { ExperimentData } from '@/types/experiment';
import { parsePcrd } from './parsers/pcrd';
import { parseTlpd } from './parsers/tlpd';
import { parseEds } from './parsers/eds';
import { parseAmxd } from './parsers/amxd';
import { parseBioradFolder } from './parsers/biorad-folder';

// Supported instrument file extensions
export const INSTRUMENT_EXTENSIONS = ['pcrd', 'tlpd', 'eds', 'amxd', 'adxd'];
export const ALL_EXTENSIONS = ['sharp', ...INSTRUMENT_EXTENSIONS];

/**
 * Load a BioRad CFX96 export folder (directory containing CSV exports from
 * BioRad CFX Manager). See `parsers/biorad-folder.ts` for the expected layout.
 */
export async function loadBioradFolder(dirPath: string): Promise<ExperimentData> {
  return parseBioradFolder(dirPath);
}

/**
 * Parse an instrument file (.pcrd, .tlpd, .eds, .amxd) using pure TypeScript parsers.
 * No Python sidecar needed — decryption and parsing happen entirely in the browser.
 */
export async function loadInstrumentFile(filePath: string): Promise<ExperimentData> {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const fileName = filePath.split(/[/\\]/).pop() ?? 'experiment';

  // Read the raw file bytes via Tauri
  const bytes = await readFile(filePath);
  const buffer = bytes.buffer as ArrayBuffer;

  switch (ext) {
    case 'pcrd':
      return parsePcrd(buffer, fileName);
    case 'tlpd':
      return parseTlpd(buffer, fileName);
    case 'eds':
      return parseEds(buffer, fileName);
    case 'amxd':
    case 'adxd':
      return parseAmxd(buffer, fileName);
    default:
      throw new Error(`Unsupported instrument format: .${ext}`);
  }
}

/**
 * Check if a file path is a supported instrument format.
 */
export function isInstrumentFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return INSTRUMENT_EXTENSIONS.includes(ext);
}

/**
 * Check if a file path is any supported format.
 */
export function isSupportedFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return ALL_EXTENSIONS.includes(ext);
}

/**
 * Check if a path looks like a directory (no file extension we recognize).
 * This is a heuristic — the actual directory check happens when the folder
 * parser tries to read it. Used for routing recent-files entries back to
 * the BioRad folder loader.
 */
export function looksLikeDirectory(path: string): boolean {
  const last = path.split(/[\\/]/).filter(Boolean).pop() ?? '';
  // A path "component" without a dot, or with a dot but not a known ext
  const dot = last.lastIndexOf('.');
  if (dot === -1) return true;
  const ext = last.slice(dot + 1).toLowerCase();
  return !ALL_EXTENSIONS.includes(ext);
}
