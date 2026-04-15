/**
 * Style preset persistence — named snapshots of all Style-tab fields
 * saved in localStorage so users can switch between a "publication
 * figure" set and a "screen preview" set with one click.
 *
 * Not synced across machines, not part of the .sharp file format — a
 * local convenience only. If the localStorage key grows too big, older
 * saves would simply be silently dropped by the browser, which is fine
 * for this use case.
 */

export interface StyleSnapshot {
  palette: string;
  paletteReversed: boolean;
  paletteGroupColors: boolean;
  lineWidth: number;
  fontFamily: string;
  titleSize: number;
  labelSize: number;
  tickSize: number;
  legendSize: number;
  showLegend: boolean;
  showLegendAmp: boolean;
  showLegendMelt: boolean;
  showLegendDoubling: boolean;
  legendPosition: string;
  legendContent: 'well' | 'sample' | 'group';
  legendVisibleOnly: boolean;
  showTitle: boolean;
  showGrid: boolean;
  gridAlpha: number;
  plotBgColor: string;
  figureDpi: number;
}

const STORAGE_KEY = 'sharp-processor-style-presets';

interface PresetStore {
  version: 1;
  presets: Record<string, StyleSnapshot>;
}

function readStore(): PresetStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, presets: {} };
    const parsed = JSON.parse(raw) as PresetStore;
    if (parsed.version !== 1 || typeof parsed.presets !== 'object') {
      return { version: 1, presets: {} };
    }
    return parsed;
  } catch {
    return { version: 1, presets: {} };
  }
}

function writeStore(store: PresetStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.error('Failed to save style presets:', err);
  }
}

export function listStylePresets(): string[] {
  return Object.keys(readStore().presets).sort((a, b) => a.localeCompare(b));
}

export function getStylePreset(name: string): StyleSnapshot | null {
  return readStore().presets[name] ?? null;
}

export function saveStylePreset(name: string, snapshot: StyleSnapshot): void {
  const store = readStore();
  store.presets[name] = snapshot;
  writeStore(store);
}

export function deleteStylePreset(name: string): void {
  const store = readStore();
  delete store.presets[name];
  writeStore(store);
}
