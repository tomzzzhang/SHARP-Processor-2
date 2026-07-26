/**
 * The sharpplot composite figure spec.
 *
 * A spec is a JSON document describing one publication figure: its physical
 * size, a grid of panels, and per-panel settings. It is the contract between
 * whoever is authoring the figure (normally Claude, in conversation) and the
 * renderer.
 *
 * Two design rules govern every field here:
 *
 *  1. **No renaming.** Any field that also exists in `PlotFigureStyle` or
 *     `BuildFigureInput` keeps the same name and the same meaning. The spec is
 *     a serialization of the app's own state, not a parallel model.
 *  2. **`undefined` / `null` means inherit** — from the source file's saved
 *     session, then from the composite-level default, then from the app
 *     default. A value is never guessed into the spec.
 *
 * Consequence of (2): a spec can be almost empty. `{ panels: [{ kind: 'plot',
 * source: 'run.sharpx', plotType: 'amp' }] }` renders the amplification plot
 * exactly as the Processor GUI last showed it, because the `.sharpx` carries
 * the groups, colours, hidden wells, threshold and fonts.
 */
import type { PlotType, PlotFigureStyle } from '@/lib/plot-figure';
import type { XAxisMode } from '@/types/experiment';

// ── Output ──────────────────────────────────────────────────────────

export type OutputFormat = 'pdf' | 'png';

export interface OutputSpec {
  /** Figure width in inches. 6.5 = full Letter text width; 3.25 = half column. */
  width_in: number;
  height_in: number;
  /** Raster density for PNG output. PDF is vector regardless. */
  dpi: number;
  formats: OutputFormat[];
}

export const DEFAULT_OUTPUT: OutputSpec = {
  width_in: 6.5,
  height_in: 2.6,
  dpi: 600,
  formats: ['pdf', 'png'],
};

// ── Style ───────────────────────────────────────────────────────────

/**
 * Composite-level style. Every field is optional and every name matches
 * `PlotFigureStyle`, so a resolved style block can be handed to `buildFigure`
 * after filling the gaps from the file's session.
 */
export type SpecStyle = Partial<PlotFigureStyle>;

// ── Panel labels ────────────────────────────────────────────────────

export type PanelLabelMode = 'letter' | 'title' | 'none';

export interface PanelLabelSpec {
  /** `letter` = A/B/C from panel order (or the panel's own `label`);
   *  `title` = the panel's `label` text verbatim; `none` = no label drawn. */
  mode: PanelLabelMode;
  bold: boolean;
  size: number;
  /** Corner the label is anchored to within its panel cell. */
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Inset from that corner, in inches. */
  offset_in: number;
  fontFamily?: string;
  color?: string;
}

export const DEFAULT_PANEL_LABELS: PanelLabelSpec = {
  mode: 'letter',
  bold: true,
  size: 10,
  position: 'top-left',
  offset_in: 0.02,
};

// ── Layout ──────────────────────────────────────────────────────────

export interface LayoutSpec {
  rows: number;
  cols: number;
  /** Relative column widths; length must equal `cols`. Defaults to all equal. */
  widths?: number[];
  /** Relative row heights; length must equal `rows`. Defaults to all equal. */
  heights?: number[];
  /** Gap between cells, in inches. */
  gap_in: number;
  /** Outer margin around the whole composite, in inches. */
  margin_in?: number;
  /**
   * Optional explicit placement, one string per row, naming the panel `label`
   * occupying each cell — the CSS `grid-template-areas` model. Repeating a
   * label across cells spans it. When omitted, panels fill the grid in order.
   *
   *   areas: ["A A B", "C C B"]
   */
  areas?: string[];
}

export const DEFAULT_LAYOUT: LayoutSpec = {
  rows: 1,
  cols: 1,
  gap_in: 0.14,
  margin_in: 0.02,
};

// ── Panels ──────────────────────────────────────────────────────────

export interface WellSelection {
  /** Explicit well names. A name that does not exist is a hard error. */
  wells?: string[];
  /** Group names, resolved against the file's groups. */
  groups?: string[];
  /** Sample names, resolved against the file's well → sample map. */
  samples?: string[];
  /** Wells to drop after the above resolve. */
  exclude?: string[];
}

export interface AxisSpec {
  title?: string | null;
  range?: [number, number] | null;
  /** `linear` (default), `log` (base 10) or `log2`. */
  scale?: 'linear' | 'log' | 'log2' | null;
  /** Explicit tick step. */
  dtick?: number | null;
  tickFormat?: string | null;
  tickDirection?: 'outside' | 'inside' | '' | null;
  minorTicks?: boolean | null;
  /** Draw a full box/frame around the axes rather than open L-shaped axes. */
  frame?: boolean | null;
  /** Gridline style. Plotly draws solid by default; `dot` matches the
   *  convention used by most matplotlib-derived figures. */
  gridDash?: 'solid' | 'dot' | 'dash' | 'dashdot' | null;
  gridColor?: string | null;
  /** Colour of the axis line and frame. */
  lineColor?: string | null;
  /** Show a line at zero. Plotly defaults this on and it often reads as a
   *  stray heavy gridline. */
  zeroline?: boolean | null;
}

export interface LegendSpec {
  show?: boolean | null;
  /** Any key of the app's legend position map, `best`, or `outside right`. */
  position?: string | null;
  content?: 'well' | 'sample' | 'group' | null;
  title?: string | null;
  /** Explicit legend entry order, by entry name. */
  order?: string[] | null;
  /** Draw the box around the legend. Defaults to the app's framed look; set
   *  false for the unboxed legend common in published figures. */
  frame?: boolean | null;
  /** Legend fill. `"transparent"` lets the plot show through. */
  bgcolor?: string | null;
  /** Vertical gap between entries, in pixels. */
  itemGap?: number | null;
  fontSize?: number | null;
}

export interface AnnotationSpec {
  text: string;
  /** Paper coordinates (0–1) unless `xref`/`yref` say otherwise. */
  x: number;
  y: number;
  xref?: 'paper' | 'x';
  yref?: 'paper' | 'y';
  xanchor?: 'left' | 'center' | 'right';
  yanchor?: 'top' | 'middle' | 'bottom';
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  arrow?: boolean;
  /** Arrow tail offset in pixels, when `arrow` is set. */
  ax?: number;
  ay?: number;
}

export interface ReferenceLineSpec {
  /** Axis the line is constant on: a horizontal line fixes `y`. */
  axis: 'x' | 'y';
  value: number;
  color?: string;
  width?: number;
  dash?: 'solid' | 'dash' | 'dot' | 'dashdot';
  /** When set, the line also gets a legend entry with this label. */
  legend?: string | null;
}

export type ErrorBarSource = 'sd' | 'sem' | 'ci95' | 'none';

/** Per-well or per-group visual override. Same shape as the app's
 *  `WellStyleOverride`, plus marker controls for scatter-type panels. */
export interface StyleOverrideSpec {
  color?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dash' | 'dot' | 'dashdot';
  markerSize?: number;
  markerSymbol?: string;
}

export interface BasePanel {
  /** Identity of the panel: its A/B/C letter, its `grid-template-areas` name,
   *  and (in `title` label mode) the text drawn on it. */
  label?: string;
  /** Overrides the composite style for this panel only. */
  styleOverride?: SpecStyle;
  /** Per-panel override of the composite label settings. */
  panelLabel?: Partial<PanelLabelSpec>;
}

export interface PlotPanel extends BasePanel {
  kind: 'plot';
  /** Path to a `.sharpx` / `.sharp`, a raw instrument file, or a Bio-Rad
   *  folder. Relative paths resolve against the spec file's directory. */
  source: string;
  plotType: PlotType;
  /** Which fluorescence channel to plot. Defaults to the file's active channel. */
  channel?: string | null;
  select?: WellSelection | null;

  // ── Everything below mirrors BuildFigureInput / the app's view state.
  //    Omit a field to inherit the value saved in the source file. ──
  groups?: Record<string, string> | null;
  groupColors?: Record<string, string> | null;
  wellStyleOverrides?: Record<string, StyleOverrideSpec> | null;
  xAxisMode?: XAxisMode | null;
  logScale?: boolean | null;
  baselineEnabled?: boolean | null;
  /** Fit-first automatic baseline. Off means the method/start/end below apply. */
  baselineAuto?: boolean | null;
  baselineMethod?: 'horizontal' | 'linear' | null;
  /** Baseline zone, in 1-indexed cycles (not x-axis units). */
  baselineStart?: number | null;
  baselineEnd?: number | null;
  driftCorrectionEnabled?: boolean | null;
  normalizeEnabled?: boolean | null;
  thresholdEnabled?: boolean | null;
  thresholdRfu?: number | null;
  meltThresholdEnabled?: boolean | null;
  meltThresholdValue?: number | null;
  meltNormalizeEnabled?: boolean | null;
  smoothingEnabled?: boolean | null;
  smoothingWindow?: number | null;
  /** Log-linear doubling-time fit. Required for a `doubling` panel. */
  fittingEnabled?: boolean | null;
  fitStartFraction?: number | null;
  fitEndFraction?: number | null;

  legend?: LegendSpec | null;
  xaxis?: AxisSpec | null;
  yaxis?: AxisSpec | null;
  /** Extra y-axis spec for the derivative subplot of a full `melt` panel. */
  yaxis2?: AxisSpec | null;
  title?: string | null;
  annotations?: AnnotationSpec[] | null;
  referenceLines?: ReferenceLineSpec[] | null;
  /**
   * Override the computed plot margins, in pixels at 96/in. `plot-figure.ts`
   * sizes margins generously from the font sizes, which suits the app but is
   * looser than a typical published figure — set these to control exactly how
   * much of the panel the axes occupy. Omitted edges keep the computed value.
   */
  margin?: { l?: number; r?: number; t?: number; b?: number } | null;

  // ── Dilution / standard-curve panels ──
  /** Explicit dilution config. When absent the file's saved `dilutionConfig`
   *  is used; when that is absent too, a `dilution` panel is an error. */
  dilution?: DilutionSpec | null;
  errorBars?: ErrorBarSource | null;
  showFit?: boolean | null;
  /** Free text placed on the panel, with `{slope}`, `{r2}`, `{pValue}`,
   *  `{doublingTime}`, `{n}` substituted from the computed regression. */
  fitAnnotation?: string | null;
  /** Corner the fit annotation sits in. Defaults to top-right. */
  fitAnnotationPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | null;
  /** Marker and fit-line appearance for a dilution panel. */
  pointColor?: string | null;
  fitColor?: string | null;
  markerSize?: number | null;
  markerSymbol?: string | null;
}

/** Verbal-wizard equivalent of `DilutionWizard`: either derive the steps from
 *  the groups already saved in the file, or state them outright. */
export interface DilutionSpec {
  unit?: string;
  /** Derive steps from the file's groups, in `legendOrder`. */
  fromGroups?: boolean;
  /** Concentration of the most concentrated step. */
  top?: number;
  /** Fold dilution between consecutive steps. */
  fold?: number;
  /** Group names that are not dilution steps (controls). */
  exclude?: string[];
  copiesExponent?: number;
  /** Explicit steps, overriding the derived ones. */
  steps?: { concentration: number; wells: string[]; enabled?: boolean }[];
  /**
   * How the x-axis expresses input. `concentration` (default) puts
   * concentration on a log10 axis; `log2` plots log₂(concentration) on a
   * linear axis — the space the fit is solved in, so the slope reads directly
   * as minutes per doubling.
   */
  xScale?: 'concentration' | 'log2';
}

export interface ImagePanel extends BasePanel {
  kind: 'image';
  path: string;
  fit?: 'contain' | 'cover' | 'fill';
  /** Fractional crop of the source image, 0–1. */
  crop?: { x: number; y: number; w: number; h: number } | null;
  background?: string;
}

export interface TablePanel extends BasePanel {
  kind: 'table';
  columns: string[];
  rows: (string | number)[][];
  fontSize?: number;
  align?: ('left' | 'center' | 'right')[];
  /** Draw the header row in bold with a rule beneath it. */
  header?: boolean;
}

export type PanelSpec = PlotPanel | ImagePanel | TablePanel;

// ── The spec ────────────────────────────────────────────────────────

export interface FigureSpec {
  id?: string;
  output?: Partial<OutputSpec>;
  style?: SpecStyle;
  panelLabels?: Partial<PanelLabelSpec>;
  layout?: Partial<LayoutSpec>;
  panels: PanelSpec[];
}

/** A spec with every composite-level default filled in. Panels are left
 *  as-authored; their inheritance is resolved per panel against its source. */
export interface ResolvedSpec {
  id: string;
  output: OutputSpec;
  style: SpecStyle;
  panelLabels: PanelLabelSpec;
  layout: LayoutSpec;
  panels: PanelSpec[];
  /** Directory the spec was loaded from; relative panel paths resolve here. */
  baseDir: string;
}

export class SpecError extends Error {}

const LABEL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Fill composite-level defaults and validate the parts that must be
 *  self-consistent (grid size, relative widths, panel labels). */
export function resolveSpec(spec: FigureSpec, baseDir: string): ResolvedSpec {
  if (!spec || typeof spec !== 'object') throw new SpecError('Spec must be a JSON object.');
  if (!Array.isArray(spec.panels) || spec.panels.length === 0) {
    throw new SpecError('Spec must declare at least one panel.');
  }

  const output: OutputSpec = { ...DEFAULT_OUTPUT, ...(spec.output ?? {}) };
  if (!(output.width_in > 0) || !(output.height_in > 0)) {
    throw new SpecError('output.width_in and output.height_in must be positive numbers.');
  }
  if (!(output.dpi > 0)) throw new SpecError('output.dpi must be a positive number.');
  if (output.formats.length === 0) throw new SpecError('output.formats must not be empty.');
  for (const f of output.formats) {
    if (f !== 'pdf' && f !== 'png') throw new SpecError(`Unknown output format "${f}" (expected pdf or png).`);
  }

  const panelLabels: PanelLabelSpec = { ...DEFAULT_PANEL_LABELS, ...(spec.panelLabels ?? {}) };

  // Default the grid to a single row wide enough for every panel.
  const layout: LayoutSpec = {
    ...DEFAULT_LAYOUT,
    cols: spec.panels.length,
    ...(spec.layout ?? {}),
  };
  if (!Number.isInteger(layout.rows) || layout.rows < 1) throw new SpecError('layout.rows must be a positive integer.');
  if (!Number.isInteger(layout.cols) || layout.cols < 1) throw new SpecError('layout.cols must be a positive integer.');
  if (layout.widths && layout.widths.length !== layout.cols) {
    throw new SpecError(`layout.widths has ${layout.widths.length} entries but layout.cols is ${layout.cols}.`);
  }
  if (layout.heights && layout.heights.length !== layout.rows) {
    throw new SpecError(`layout.heights has ${layout.heights.length} entries but layout.rows is ${layout.rows}.`);
  }

  // Give every panel a stable label so grid areas and A/B/C labelling work.
  const panels = spec.panels.map((p, i) => ({
    ...p,
    label: p.label ?? LABEL_LETTERS[i] ?? `P${i + 1}`,
  }));

  const seen = new Set<string>();
  for (const p of panels) {
    const label = p.label;
    if (seen.has(label)) throw new SpecError(`Duplicate panel label "${label}".`);
    seen.add(label);
    // Read `kind` off a widened alias: the union is exhaustive, so narrowing
    // would leave `p` as `never` on the error path a hand-written JSON spec
    // can still reach.
    const kind = (p as { kind: string }).kind;
    if (kind !== 'plot' && kind !== 'image' && kind !== 'table') {
      throw new SpecError(`Panel "${label}" has unknown kind "${kind}" (expected plot, image or table).`);
    }
    if (p.kind === 'plot' && !p.source) {
      throw new SpecError(`Plot panel "${p.label}" is missing "source".`);
    }
    if (p.kind === 'image' && !p.path) {
      throw new SpecError(`Image panel "${p.label}" is missing "path".`);
    }
    if (p.kind === 'table' && (!Array.isArray(p.columns) || !Array.isArray(p.rows))) {
      throw new SpecError(`Table panel "${p.label}" needs "columns" and "rows".`);
    }
  }

  if (layout.areas) {
    if (layout.areas.length !== layout.rows) {
      throw new SpecError(`layout.areas has ${layout.areas.length} rows but layout.rows is ${layout.rows}.`);
    }
    for (const row of layout.areas) {
      const cells = row.trim().split(/\s+/);
      if (cells.length !== layout.cols) {
        throw new SpecError(`layout.areas row "${row}" has ${cells.length} cells but layout.cols is ${layout.cols}.`);
      }
      for (const c of cells) {
        if (c !== '.' && !seen.has(c)) {
          throw new SpecError(`layout.areas names "${c}", which is not a panel label. Known: ${[...seen].join(', ')}.`);
        }
      }
    }
  } else if (panels.length > layout.rows * layout.cols) {
    throw new SpecError(
      `${panels.length} panels do not fit a ${layout.rows}×${layout.cols} grid. ` +
      'Increase layout.rows/cols or supply layout.areas.',
    );
  }

  return {
    id: spec.id ?? 'figure',
    output,
    style: spec.style ?? {},
    panelLabels,
    layout,
    panels,
    baseDir,
  };
}
