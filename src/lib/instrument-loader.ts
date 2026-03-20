import { readFile } from '@tauri-apps/plugin-fs';
import type { ExperimentData } from '@/types/experiment';
import { parsePcrd } from './parsers/pcrd';
import { parseTlpd } from './parsers/tlpd';
import { parseEds } from './parsers/eds';
import { parseAmxd } from './parsers/amxd';

// Supported instrument file extensions
export const INSTRUMENT_EXTENSIONS = ['pcrd', 'tlpd', 'eds', 'amxd', 'adxd'];
export const ALL_EXTENSIONS = ['sharp', ...INSTRUMENT_EXTENSIONS];

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
