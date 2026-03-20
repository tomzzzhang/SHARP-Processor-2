import { Command } from '@tauri-apps/plugin-shell';
import { readFile } from '@tauri-apps/plugin-fs';
import { loadSharpFile } from './sharp-loader';
import type { ExperimentData } from '@/types/experiment';

// Supported instrument file extensions
export const INSTRUMENT_EXTENSIONS = ['pcrd', 'tlpd', 'eds', 'amxd', 'adxd'];
export const ALL_EXTENSIONS = ['sharp', ...INSTRUMENT_EXTENSIONS];

/**
 * Parse an instrument file (.pcrd, .tlpd, .eds, .amxd) by calling the Python sidecar.
 * The command 'python-parser' is scoped in src-tauri/capabilities/default.json
 * to the sharp conda environment's Python executable.
 * Returns the parsed ExperimentData.
 */
export async function loadInstrumentFile(filePath: string): Promise<ExperimentData> {
  // Tauri shell CWD is src-tauri/ in dev, so go up one level
  // In prod: would need to be bundled as a resource
  const scriptPath = '../scripts/parse_instrument.py';

  // 'python-parser' is the scoped command name defined in capabilities
  const cmd = Command.create('python-parser', [scriptPath, filePath]);
  const output = await cmd.execute();

  if (output.code !== 0) {
    const errorMsg = output.stderr.trim() || 'Unknown parse error';
    throw new Error(`Failed to parse instrument file: ${errorMsg}`);
  }

  const sharpPath = output.stdout.trim();
  if (!sharpPath) {
    throw new Error('Parser produced no output');
  }

  // Read the generated .sharp file
  const bytes = await readFile(sharpPath);
  const fileName = filePath.split(/[/\\]/).pop() ?? 'experiment';
  return loadSharpFile(bytes.buffer as ArrayBuffer, fileName);
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
