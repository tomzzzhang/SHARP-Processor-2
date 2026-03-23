// ── Color palettes ──────────────────────────────────────────────────

export const TABLEAU_10 = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
];

export const COLORBLIND_SAFE = [
  '#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9',
  '#D55E00', '#F0E442', '#000000',
];

export const PAIRED = [
  '#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99', '#e31a1c',
  '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a', '#ffff99', '#b15928',
];

export const PASTEL = [
  '#aec6cf', '#f4c2c2', '#b5ead7', '#c3b1e1', '#ffdab9',
  '#fffacd', '#b4d7a8', '#f5c6cb', '#d4e5f7', '#e2c6a4',
];


// Continuous palette generator — sample N evenly-spaced colors from a gradient
function interpolateGradient(stops: [number, number, number][], n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) {
    const [r, g, b] = stops[Math.floor(stops.length / 2)];
    return [`rgb(${r},${g},${b})`];
  }
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const idx = t * (stops.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, stops.length - 1);
    const frac = idx - lo;
    const r = Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * frac);
    const g = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * frac);
    const b = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * frac);
    out.push(`rgb(${r},${g},${b})`);
  }
  return out;
}

// Gradient stop definitions (dynamic palettes — auto-sized to N curves)
const GRADIENT_STOPS: Record<string, [number, number, number][]> = {
  'SHARP':      [[216,31,39],[170,32,38],[125,33,38],[79,33,37],[42,45,48]],
  'Viridis':    [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
  'Magma':      [[0,0,4],[81,18,124],[183,55,121],[254,159,109],[252,253,191]],
  'Inferno':    [[0,0,4],[87,16,110],[188,55,84],[249,142,9],[252,255,164]],
  'Plasma':     [[13,8,135],[126,3,168],[204,71,120],[248,149,64],[240,249,33]],
  'Turbo':      [[48,18,59],[70,130,180],[122,209,81],[243,210,47],[190,46,22]],
  'Grayscale':  [[40,40,40],[128,128,128],[220,220,220]],
  'Blue':       [[8,48,107],[33,113,181],[107,174,214],[198,219,239]],
  'Red':        [[103,0,13],[203,24,29],[251,106,74],[252,187,161]],
  'Green':      [[0,68,27],[35,139,69],[116,196,118],[199,233,192]],
  'Purple':     [[63,0,125],[117,107,177],[188,189,220],[218,218,235]],
  'Orange':     [[127,39,4],[217,72,1],[253,141,60],[253,204,138]],
  'Teal':       [[0,68,89],[0,128,128],[64,192,192],[178,223,223]],
};

// Discrete palettes (fixed color lists)
export const PALETTES: Record<string, string[]> = {
  'Tableau 10': TABLEAU_10,
  'Colorblind Safe': COLORBLIND_SAFE,
  'Paired': PAIRED,
  'Pastel': PASTEL,
};

/** Top-level palette names (discrete + scientific gradients) */
export const MAIN_PALETTE_NAMES = [
  'SHARP',
  ...Object.keys(PALETTES),
  'Viridis', 'Magma', 'Inferno', 'Plasma', 'Turbo',
];

/** Single-hue gradient names (shown in submenu) */
export const GRADIENT_PALETTE_NAMES = [
  'Grayscale', 'Blue', 'Red', 'Green', 'Purple', 'Orange', 'Teal',
];

/** All palette names (flat list for serialization) */
export const ALL_PALETTE_NAMES = [...MAIN_PALETTE_NAMES, ...GRADIENT_PALETTE_NAMES];

/** Get palette colors — discrete returns fixed list, gradients sample N colors */
export function getPaletteColors(name: string, n: number): string[] {
  if (PALETTES[name]) return PALETTES[name];
  const stops = GRADIENT_STOPS[name];
  if (stops) return interpolateGradient(stops, n);
  return TABLEAU_10;
}

// Well grid colors — using CSS vars for theme awareness where possible
export const WELL_EMPTY_COLOR = 'var(--border)';
export const WELL_HIDDEN_COLOR = '#c0c8d0';
export const WELL_ACTIVE_COLOR = '#d0e8ff';
export const WELL_SELECTED_BORDER = 'var(--brand-red-mid)';
export const WELL_HOVER_COLOR = '#b3d4fc';
export const WELL_NTC_COLOR = '#ffe0e0';
export const WELL_NPC_COLOR = '#fff3e0';

// Highlighting
export const DIM_ALPHA = 0.15;
export const SELECTION_DIM_ALPHA = 0.25;
export const INACTIVE_ALPHA = 0.35;
export const SELECTED_LINE_WIDTH_BOOST = 1.5;

// Baseline defaults
export const DEFAULT_BASELINE_METHOD = 'horizontal' as const;
export const DEFAULT_BASELINE_START = 2;
export const DEFAULT_BASELINE_END = 8;

// Threshold defaults
export const DEFAULT_THRESHOLD_RFU = 1000.0;
export const THRESHOLD_LINE_COLOR = '#d32f2f';

// Call dot colors
export const CALL_POSITIVE_COLOR = '#4caf50';
export const CALL_NEGATIVE_COLOR = '#9e9e9e';
export const CALL_INVALID_COLOR = '#ff9800';

// Active indicator
export const ACTIVE_INDICATOR_COLOR = '#4caf50';
export const INACTIVE_INDICATOR_COLOR = '#333333';

// Typography defaults
export const DEFAULT_LINE_WIDTH = 1.8;
export const DEFAULT_FONT_FAMILY = 'Geist Variable, Arial, sans-serif';
export const DEFAULT_TITLE_SIZE = 12;
export const DEFAULT_LABEL_SIZE = 10;
export const DEFAULT_TICK_SIZE = 9;
export const DEFAULT_LEGEND_SIZE = 8;
export const DEFAULT_FIGURE_DPI = 100;
export const DEFAULT_GRID_ALPHA = 0.3;

// Content type display names
export const CONTENT_DISPLAY: Record<string, string> = {
  'Unkn': 'Samp',
  'Neg Ctrl': 'NTC',
  'Pos Ctrl': '+ Ctrl',
  'Std': 'Std',
  'NPC': 'NPC',
  'Neg': '- Ctrl',
  '': '',
};

// Font options
export const FONT_FAMILIES = [
  'Arial', 'Helvetica', 'DejaVu Sans', 'Times New Roman',
  'Courier New', 'Segoe UI', 'Calibri',
];

// Legend positions
export const LEGEND_POSITIONS = [
  'best', 'upper right', 'upper left', 'lower left', 'lower right',
  'right', 'center left', 'center right', 'lower center', 'upper center', 'center',
];

// Plate layout
export const PLATE_ROWS = 'ABCDEFGH';
export const PLATE_COLS = Array.from({ length: 12 }, (_, i) => i + 1);

// Max supported plate dimensions (384-well)
export const MAX_PLATE_ROW_LETTERS = 'ABCDEFGHIJKLMNOP';
export const DEFAULT_PLATE_ROW_COUNT = 8;
export const DEFAULT_PLATE_COL_COUNT = 12;

export function getPlateRowLetters(count: number): string {
  return MAX_PLATE_ROW_LETTERS.slice(0, count);
}

export function getPlateColNumbers(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

/** Known instrument plate layouts (physical row×col) */
export const INSTRUMENT_PLATE_LAYOUTS: Record<string, { rows: number; cols: number }> = {
  'gentier mini': { rows: 2, cols: 8 },
  'gentier 48': { rows: 6, cols: 8 },
  'gentier 96': { rows: 8, cols: 12 },
};

/** Look up plate layout by instrument model name (case-insensitive) */
export function getInstrumentPlateLayout(model: string): { rows: number; cols: number } | null {
  return INSTRUMENT_PLATE_LAYOUTS[model.toLowerCase().trim()] ?? null;
}

/** Infer plate dimensions from well name list */
export function inferPlateDimensions(wellNames: string[]): { rows: number; cols: number } {
  let maxRow = 0;
  let maxCol = 0;
  for (const well of wellNames) {
    const match = well.match(/^([A-P])(\d+)$/);
    if (match) {
      const rowIdx = match[1].charCodeAt(0) - 65;
      const colNum = parseInt(match[2], 10);
      if (rowIdx > maxRow) maxRow = rowIdx;
      if (colNum > maxCol) maxCol = colNum;
    }
  }
  return { rows: maxRow + 1, cols: maxCol };
}

// ── Platform detection ─────────────────────────────────────────────────
export const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

/** Modifier key label: "⌘" on macOS, "Ctrl" on Windows/Linux */
export const MOD_KEY = IS_MAC ? '\u2318' : 'Ctrl';
