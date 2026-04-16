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
  showLabels: boolean;
  showTicks: boolean;
  showGrid: boolean;
  gridAlpha: number;
  plotBgColor: string;
  figureDpi: number;
}

// ── Built-in presets (not saved to localStorage) ────────────────────

const BUILTIN_BASE: Omit<StyleSnapshot, 'palette' | 'paletteReversed' | 'paletteGroupColors' | 'lineWidth' | 'titleSize' | 'labelSize' | 'tickSize' | 'legendSize' | 'showGrid' | 'gridAlpha' | 'plotBgColor' | 'figureDpi'> = {
  fontFamily: 'Geist Variable, Arial, sans-serif',
  showLegend: true,
  showLegendAmp: true,
  showLegendMelt: true,
  showLegendDoubling: true,
  legendPosition: 'best',
  legendContent: 'sample',
  legendVisibleOnly: true,
  showTitle: true,
  showLabels: true,
  showTicks: true,
};

export const BUILTIN_PRESETS: Record<string, StyleSnapshot> = {
  'Default': {
    ...BUILTIN_BASE,
    palette: 'SHARP', paletteReversed: false, paletteGroupColors: false,
    lineWidth: 1.8,
    titleSize: 12, labelSize: 10, tickSize: 9, legendSize: 8,
    showGrid: true, gridAlpha: 0.3,
    plotBgColor: '', figureDpi: 100,
  },
  'Publication': {
    ...BUILTIN_BASE,
    palette: 'SHARP', paletteReversed: false, paletteGroupColors: false,
    lineWidth: 2.0,
    titleSize: 16, labelSize: 14, tickSize: 12, legendSize: 10,
    showGrid: false, gridAlpha: 0.3,
    plotBgColor: '#ffffff', figureDpi: 300,
    legendVisibleOnly: true,
  },
  'Presentation': {
    ...BUILTIN_BASE,
    palette: 'SHARP', paletteReversed: false, paletteGroupColors: false,
    lineWidth: 2.5,
    titleSize: 20, labelSize: 16, tickSize: 14, legendSize: 12,
    showGrid: true, gridAlpha: 0.15,
    plotBgColor: '#ffffff', figureDpi: 150,
    legendVisibleOnly: false,
  },
};

export const BUILTIN_PRESET_NAMES = Object.keys(BUILTIN_PRESETS);

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

/** List all preset names: built-in first, then user-saved sorted alpha. */
export function listStylePresets(): string[] {
  const userNames = Object.keys(readStore().presets).sort((a, b) => a.localeCompare(b));
  return [...BUILTIN_PRESET_NAMES, ...userNames];
}

/** Is this a built-in (non-deletable) preset? */
export function isBuiltinPreset(name: string): boolean {
  return name in BUILTIN_PRESETS;
}

export function getStylePreset(name: string): StyleSnapshot | null {
  if (name in BUILTIN_PRESETS) return BUILTIN_PRESETS[name];
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
