/**
 * Pure, hook-free Plotly figure builders for each plot type.
 *
 * Used by the Export Wizard to render a WYSIWYG preview and a final
 * image at exact target pixel dimensions, independent of the main
 * PlotArea rendering (which is entangled with interactive state:
 * hover, selection, drag preview, threshold drag handlers, box-select
 * overlays). These builders include only the static visuals that
 * belong in a published figure.
 *
 * The main PlotArea.tsx still has its own figure construction for
 * on-screen display — duplicating a small amount of trace-building
 * logic here is worth the gain of having a clean, standalone figure
 * module that can render independent of the DOM.
 */
import type { Data, Layout, Shape, PlotData } from 'plotly.js';
import type { ExperimentData, XAxisMode } from '@/types/experiment';
import {
  normalizeMeltCurves, tCriticalApprox,
  type DilutionSeriesResult, type WellAnalysisResult,
} from '@/lib/analysis';
import { curveAt, type FivePLParams } from '@/lib/curvefit';
import type { KineticsReport, ReportRow, WellLandmark } from '@/lib/report/kinetics-report';
import { getPaletteColors } from '@/lib/constants';

export type PlotType = 'amp' | 'melt' | 'melt_deriv' | 'doubling' | 'dilution' | 'kinetics_residuals';

/** Which spread the error bars on a dilution standard curve represent. */
export type ErrorBarSource = 'sd' | 'sem' | 'ci95' | 'none';

/**
 * Everything a dilution standard-curve panel needs beyond the experiment
 * itself. The regression is NOT computed here — `analyzeDilutionSeries` in
 * `analysis.ts` produces it, and this builder only draws the result, so the
 * numbers in a figure are the same ones the app's Standard Curve panel shows.
 */
export interface DilutionFigureInput {
  result: DilutionSeriesResult;
  /** Concentration unit, for the x-axis label. */
  unit: string;
  errorBars: ErrorBarSource;
  showFit: boolean;
  /**
   * How the x-axis expresses input amount.
   *
   * `concentration` (default) plots concentration on a log10 axis, so a
   * ten-fold series lands on even decades and the labels read in the units the
   * user pipetted. `log2` plots log₂(concentration) on a linear axis — the
   * space the regression is actually solved in, which makes the slope directly
   * readable as minutes per doubling.
   */
  xScale?: 'concentration' | 'log2';
  /** Plotly marker symbol, e.g. `circle` (default) or `square`. */
  markerSymbol?: string;
  /** Text drawn on the panel. Statistic substitution happens before this
   *  point, so the builder stays free of formatting policy. */
  annotation?: string | null;
  /** Corner for the annotation. */
  annotationPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  pointColor?: string;
  fitColor?: string;
  markerSize?: number;
  /** Label for the measured quantity; defaults to Tt/Ct by x-axis unit. */
  yTitle?: string | null;
  xTitle?: string | null;
}

export interface PlotFigureStyle {
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
  legendPosition: string;
  legendContent: 'well' | 'sample' | 'group';
  showTitle: boolean;
  showLabels: boolean;
  showTicks: boolean;
  showGrid: boolean;
  gridAlpha: number;
  plotBgColor: string;   // '' = white
  textColor: 'auto' | 'black' | 'white';
  isDark: boolean;
}

/** Opt-in report rendering. When omitted, every existing plot stays on the
 * ordinary Processor figure path and therefore remains byte-identical. */
export interface KineticsFigureOptions {
  /** Draw the measured amplification curves. Defaults to true. */
  showData?: boolean;
  /** Overlay the FreeShoulder fitted curves. Defaults to false. */
  showFit?: boolean;
  /** Report amplification is either raw or fit-baseline-corrected. */
  signal?: 'corrected' | 'raw';
  /** Any subset; an empty/omitted list draws no kinetic markers. */
  markers?: ('t_lod' | 't_onset10' | 'inflection')[];
  /** Mark fitted melt temperatures on a melt or melt-derivative panel. */
  showMeltTm?: boolean;
}

export interface BuildFigureInput {
  exp: ExperimentData;
  visibleWells: string[];
  wellGroups: Map<string, string>;
  wellStyleOverrides: Map<string, { color?: string; lineStyle?: string; lineWidth?: number }>;
  analysisResults: Map<string, WellAnalysisResult>;
  legendOrder: string[];
  style: PlotFigureStyle;
  xAxisMode: XAxisMode;
  logScale: boolean;
  baselineEnabled: boolean;
  normalizeEnabled: boolean;
  thresholdEnabled: boolean;
  thresholdRfu: number;
  meltThresholdEnabled: boolean;
  meltThresholdValue: number;
  meltNormalizeEnabled: boolean;
  smoothingEnabled: boolean;
  smoothingWindow: number;
  /**
   * Which kinetic landmarks to mark on the amplification panel — the saved
   * per-experiment view state, so an exported figure carries the same markers
   * the on-screen plot was showing. Omitted / all-false draws none.
   */
  landmarks?: LandmarkVisibility | null;
  /**
   * Per-well landmark times (seconds) for the channel being drawn. Computed by
   * `computeChannelLandmarks`; passed in rather than computed here so the
   * figure uses the same memoized values the app already has and this module
   * stays a pure drawing layer.
   */
  landmarkPoints?: Map<string, WellLandmark> | null;
  /** Full source-backed report used only by opt-in kinetics rendering. */
  kineticsReport?: KineticsReport | null;
  /** Explicit report rendering options. Omitted preserves ordinary plots. */
  kinetics?: KineticsFigureOptions | null;
  /** Required only by the `dilution` plot type; ignored by every other. */
  dilution?: DilutionFigureInput | null;
}

/** Landmark toggle triple, mirroring the store's `ExperimentViewState.landmarks`. */
export interface LandmarkVisibility {
  lod: boolean;
  onset: boolean;
  infl: boolean;
}

/**
 * How each landmark is drawn and labelled. Symbols, legend names, and legend
 * ordering match `PlotArea`'s on-screen markers so the exported figure and the
 * live plot are the same picture.
 */
const LANDMARK_SPECS = [
  { key: 'lod', field: 'tLod', symbol: 'triangle-up', name: 't_lod', rank: 10001 },
  { key: 'onset', field: 'tOnset10', symbol: 'diamond', name: 't_onset10', rank: 10002 },
  { key: 'infl', field: 'inflectionT', symbol: 'circle', name: 'inflection', rank: 10003 },
] as const;

/**
 * Interpolate the (x, y) point on a drawn curve at a landmark time.
 *
 * Landmarks are computed in seconds while the panel's x-axis may be cycles or
 * minutes, so the time is located in `timeS` and the fraction between samples
 * is applied to both the x series and the plotted y series. That keeps the
 * marker on the curve rather than at a nominal axis coordinate. A hook-free
 * port of `PlotArea`'s `pointAtSec`.
 */
function pointAtSec(
  tSec: number | null,
  timeS: number[],
  xs: number[],
  ys: number[],
): { x: number; y: number } | null {
  if (tSec == null || !Number.isFinite(tSec)) return null;
  const n = Math.min(timeS?.length ?? 0, xs.length, ys.length);
  if (n < 2) return null;
  if (tSec <= timeS[0]) return { x: xs[0], y: ys[0] };
  if (tSec >= timeS[n - 1]) return { x: xs[n - 1], y: ys[n - 1] };
  for (let i = 1; i < n; i++) {
    if (timeS[i] >= tSec) {
      const d = timeS[i] - timeS[i - 1];
      const f = d ? (tSec - timeS[i - 1]) / d : 0;
      return {
        x: xs[i - 1] + f * (xs[i] - xs[i - 1]),
        y: ys[i - 1] + f * (ys[i] - ys[i - 1]),
      };
    }
  }
  return { x: xs[n - 1], y: ys[n - 1] };
}

const X_AXIS_LABELS: Record<XAxisMode, string> = {
  cycle: 'Cycle',
  time_s: 'Time (s)',
  time_min: 'Time (min)',
};

/** Exported so CLI-only figure decorations (a second legend, for instance)
 *  can resolve the same named corners without duplicating the table. */
export const LEGEND_POS_MAP: Record<string, { x: number; y: number; xanchor: string; yanchor: string }> = {
  'upper right': { x: 1, y: 1, xanchor: 'right', yanchor: 'top' },
  'upper left': { x: 0, y: 1, xanchor: 'left', yanchor: 'top' },
  'lower left': { x: 0, y: 0, xanchor: 'left', yanchor: 'bottom' },
  'lower right': { x: 1, y: 0, xanchor: 'right', yanchor: 'bottom' },
  'right': { x: 1.02, y: 0.5, xanchor: 'left', yanchor: 'middle' },
  'center left': { x: 0, y: 0.5, xanchor: 'left', yanchor: 'middle' },
  'center right': { x: 1, y: 0.5, xanchor: 'right', yanchor: 'middle' },
  'lower center': { x: 0.5, y: 0, xanchor: 'center', yanchor: 'bottom' },
  'upper center': { x: 0.5, y: 1, xanchor: 'center', yanchor: 'top' },
  'center': { x: 0.5, y: 0.5, xanchor: 'center', yanchor: 'middle' },
};

// Corners for the "best" auto-placement, in the same order as PlotArea's
// on-screen logic so the wizard preview/export agree with the live view.
const CORNER_CANDIDATES = [
  { x: 1, y: 1, xanchor: 'right', yanchor: 'top' },     // upper right
  { x: 0, y: 1, xanchor: 'left', yanchor: 'top' },      // upper left
  { x: 1, y: 0, xanchor: 'right', yanchor: 'bottom' },  // lower right
  { x: 0, y: 0, xanchor: 'left', yanchor: 'bottom' },   // lower left
] as const;

/** Pick the corner where the fewest data points fall — a hook-free port
 *  of PlotArea's `bestLegendPosition` so "best" matches the live view. */
function bestLegendPosition(traces: Data[]): { x: number; y: number; xanchor: string; yanchor: string } {
  const counts = [0, 0, 0, 0]; // UR, UL, LR, LL
  let hasData = false;
  for (const trace of traces) {
    const xs = (trace as { x?: number[] }).x;
    const ys = (trace as { y?: number[] }).y;
    if (!xs || !ys || xs.length === 0) continue;
    hasData = true;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      if (xs[i] < xMin) xMin = xs[i];
      if (xs[i] > xMax) xMax = xs[i];
      if (ys[i] < yMin) yMin = ys[i];
      if (ys[i] > yMax) yMax = ys[i];
    }
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;
    for (let i = 0; i < xs.length; i++) {
      const rightHalf = (xs[i] - xMin) / xRange > 0.5;
      const topHalf = (ys[i] - yMin) / yRange > 0.5;
      if (rightHalf && topHalf) counts[0]++;
      else if (!rightHalf && topHalf) counts[1]++;
      else if (rightHalf && !topHalf) counts[2]++;
      else counts[3]++;
    }
  }
  if (!hasData) return CORNER_CANDIDATES[0];
  let minIdx = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] < counts[minIdx]) minIdx = i;
  return CORNER_CANDIDATES[minIdx];
}

function resolveLegendPosition(position: string, data: Data[]): { x: number; y: number; xanchor: string; yanchor: string } {
  if (position === 'best') return bestLegendPosition(data);
  return LEGEND_POS_MAP[position] ?? LEGEND_POS_MAP['upper right'];
}

function pfAxisLabel(text: string, style: PlotFigureStyle) {
  return { text: style.showLabels ? text : '', font: { family: style.fontFamily, size: style.labelSize } };
}

function pfTickProps(style: PlotFigureStyle) {
  return { tickfont: { family: style.fontFamily, size: style.tickSize }, showticklabels: style.showTicks };
}

function gridStyle(style: PlotFigureStyle) {
  const base = style.isDark ? '255,255,255' : '0,0,0';
  return { showgrid: style.showGrid, gridcolor: `rgba(${base},${style.gridAlpha})` };
}

function plotFontColor(isDark: boolean, textColor: 'auto' | 'black' | 'white' = 'auto') {
  if (textColor === 'black') return '#000000';
  if (textColor === 'white') return '#ffffff';
  return isDark ? 'rgba(255,255,255,0.87)' : '#212224';
}

function resolvePlotBg(style: PlotFigureStyle): string {
  if (style.plotBgColor) return style.plotBgColor;
  return style.isDark ? '#1a1a1a' : '#fafafa';
}

/**
 * Compute a palette color for every visible well, respecting grouping
 * and Tt-ordering — a hook-free port of `useGroupedColors` in PlotArea.
 */
function computeColorMap(input: BuildFigureInput): Map<string, string> {
  const { visibleWells, wellGroups, wellStyleOverrides, analysisResults, style } = input;
  const colorMap = new Map<string, string>();
  if (visibleWells.length === 0) return colorMap;

  const units: [number, string[]][] = [];

  if (style.paletteGroupColors) {
    const groupMembers = new Map<string, string[]>();
    const ungrouped: string[] = [];
    const seenGroups = new Set<string>();
    for (const well of visibleWells) {
      const group = wellGroups.get(well);
      if (group) {
        if (!seenGroups.has(group)) { seenGroups.add(group); groupMembers.set(group, []); }
        groupMembers.get(group)!.push(well);
      } else {
        ungrouped.push(well);
      }
    }
    for (const [, members] of groupMembers) {
      let sum = 0, count = 0;
      for (const w of members) {
        const tt = analysisResults.get(w)?.tt;
        if (tt != null) { sum += tt; count++; }
      }
      units.push([count > 0 ? sum / count : Infinity, members]);
    }
    for (const well of ungrouped) {
      const tt = analysisResults.get(well)?.tt ?? Infinity;
      units.push([tt, [well]]);
    }
  } else {
    for (const well of visibleWells) {
      const tt = analysisResults.get(well)?.tt ?? Infinity;
      units.push([tt, [well]]);
    }
  }

  if (analysisResults.size > 0) {
    units.sort((a, b) => a[0] - b[0]);
  }

  let colors = getPaletteColors(style.palette, units.length);
  if (style.paletteReversed) colors = [...colors].reverse();

  for (let i = 0; i < units.length; i++) {
    const color = colors[i % colors.length];
    for (const well of units[i][1]) colorMap.set(well, color);
  }

  for (const [well, ov] of wellStyleOverrides.entries()) {
    if (ov.color) colorMap.set(well, ov.color);
  }

  return colorMap;
}

function traceName(well: string, input: BuildFigureInput): string {
  if (input.style.legendContent === 'group') {
    const g = input.wellGroups.get(well);
    if (g) return g;
    return input.exp.wells[well]?.sample ?? well;
  }
  if (input.style.legendContent === 'sample') {
    return input.exp.wells[well]?.sample ?? well;
  }
  return well;
}

/** Legend-group key + "is representative for this group" per well. In
 *  group mode, wells in the same group share a legendgroup and only the
 *  first one keeps `showlegend: true`. */
function computeLegendGroups(input: BuildFigureInput): Map<string, { group: string; isRep: boolean }> {
  const out = new Map<string, { group: string; isRep: boolean }>();
  const picked = new Set<string>();
  for (const well of input.visibleWells) {
    let group: string;
    if (input.style.legendContent === 'group') {
      const g = input.wellGroups.get(well);
      group = g ? `grp:${g}` : `well:${well}`;
    } else {
      group = `well:${well}`;
    }
    const isRep = !picked.has(group);
    if (isRep) picked.add(group);
    out.set(well, { group, isRep });
  }
  return out;
}

function titleText(base: string, style: PlotFigureStyle): string {
  return style.showTitle ? base : '';
}

function computeMargins(style: PlotFigureStyle) {
  const labelContrib = style.showLabels ? style.labelSize * 1.5 : 0;
  const tickContribL = style.showTicks ? style.tickSize * 2 : 0;
  const tickContribB = style.showTicks ? style.tickSize * 1.2 : 0;
  return {
    l: Math.round(40 + labelContrib + tickContribL),
    r: 20,
    t: Math.round(style.showTitle ? 20 + style.titleSize * 1.5 : 20),
    b: Math.round(30 + labelContrib + tickContribB),
  };
}

function buildLegendRanks(legendOrder: string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  legendOrder.forEach((key, i) => ranks.set(key, 10 + i));
  return ranks;
}

function lineStyleFor(well: string, input: BuildFigureInput): { dash?: string; width?: number } {
  const ov = input.wellStyleOverrides.get(well);
  return { dash: ov?.lineStyle, width: ov?.lineWidth };
}

function rowFitParams(row: ReportRow | undefined): FivePLParams | null {
  if (!row || row.fit_A === null || row.fit_B === null || row.fit_C === null
    || row.fit_D === null || row.fit_foot === null || row.fit_shoulder === null) return null;
  return {
    A: row.fit_A, B: row.fit_B, C: row.fit_C, D: row.fit_D,
    foot: row.fit_foot, shoulder: row.fit_shoulder,
  };
}

function reportRowsByWell(report: KineticsReport | null | undefined): Map<string, ReportRow> {
  return new Map((report?.rows ?? []).map((row) => [row.well, row]));
}

// ── Amplification ───────────────────────────────────────────────────

function buildAmp(input: BuildFigureInput): { data: Data[]; layout: Partial<Layout> } {
  const { exp, visibleWells, style, xAxisMode, logScale, baselineEnabled, normalizeEnabled, analysisResults } = input;
  const amp = exp.amplification;
  const data: Data[] = [];

  if (!amp) return { data, layout: {} };

  const xData =
    xAxisMode === 'cycle' ? amp.cycle :
    xAxisMode === 'time_s' ? amp.timeS :
    amp.timeMin;
  const colorMap = computeColorMap(input);
  const legendGroups = computeLegendGroups(input);
  const legendRanks = buildLegendRanks(input.legendOrder);
  const kinetics = input.kinetics ?? null;
  const reportByWell = reportRowsByWell(input.kineticsReport);
  const kineticsTime = input.kineticsReport?.timeS?.length
    ? input.kineticsReport.timeS
    : (amp.timeS?.length ? amp.timeS : amp.cycle);
  const showData = kinetics?.showData ?? true;
  const showFit = kinetics?.showFit ?? false;
  const signal = kinetics?.signal ?? 'corrected';

  // Landmark points, accumulated across wells and emitted below as one marker
  // trace per landmark type — same shape as the on-screen plot, so a figure
  // exported from a saved view shows exactly the markers that view had.
  const requested = new Set(kinetics?.markers ?? []);
  const lm: LandmarkVisibility | null = kinetics
    ? {
        lod: requested.has('t_lod'),
        onset: requested.has('t_onset10'),
        infl: requested.has('inflection'),
      }
    : (input.landmarks ?? null);
  const hasLmData = kinetics ? reportByWell.size > 0 : Boolean(input.landmarkPoints?.size);
  const anyLandmark = Boolean(lm && (lm.lod || lm.onset || lm.infl) && hasLmData);
  const lmPoints: Record<string, { x: number[]; y: number[]; c: string[] }> = {
    lod: { x: [], y: [], c: [] },
    onset: { x: [], y: [], c: [] },
    infl: { x: [], y: [], c: [] },
  };

  for (const well of visibleWells) {
    const raw = amp.wells[well];
    if (!raw) continue;
    const analysis = analysisResults.get(well);
    const reportRow = reportByWell.get(well);
    const reportOffset = signal === 'corrected' ? (reportRow?.baseline_offset ?? 0) : 0;
    const y = kinetics
      ? (reportOffset ? raw.map((v) => v - reportOffset) : raw)
      : ((normalizeEnabled && analysis?.normalizedRfu)
        || (baselineEnabled && analysis?.correctedRfu)
        || raw);
    const color = colorMap.get(well) ?? '#999';
    const lsOv = lineStyleFor(well, input);
    const lg = legendGroups.get(well)!;
    if (showData) {
      data.push({
        x: xData, y,
        type: 'scatter', mode: 'lines',
        name: traceName(well, input),
        legendgroup: lg.group,
        legendrank: legendRanks.get(lg.group) ?? 1000,
        line: {
          color,
          width: lsOv.width ?? style.lineWidth,
          dash: (lsOv.dash as PlotData['line']['dash']) ?? 'solid',
        },
        hoverinfo: 'name',
        showlegend: lg.isRep,
      });
    }

    const params = rowFitParams(reportRow);
    const fitY = params ? kineticsTime.map((t) => curveAt(t, params) - reportOffset) : null;
    if (showFit && fitY) {
      data.push({
        x: xData, y: fitY,
        type: 'scatter', mode: 'lines',
        name: traceName(well, input),
        legendgroup: lg.group,
        legendrank: legendRanks.get(lg.group) ?? 1000,
        line: {
          color,
          width: Math.max(0.8, (lsOv.width ?? style.lineWidth) * 0.65),
          dash: (lsOv.dash as PlotData['line']['dash']) ?? 'solid',
        },
        opacity: 0.5,
        meta: { sharpplotRole: 'kinetics-fit' },
        hoverinfo: 'name',
        showlegend: !showData && lg.isRep,
      } as Data);
    }

    if (anyLandmark) {
      const wl: WellLandmark | null = kinetics
        ? (reportRow
          ? {
              tLod: reportRow.t_lod,
              tOnset10: reportRow.t_onset10,
              inflectionT: reportRow.fit_inflection_t,
              fired: reportRow.fired,
            }
          : null)
        : (input.landmarkPoints?.get(well) ?? null);
      if (wl) {
        for (const spec of LANDMARK_SPECS) {
          if (!lm![spec.key]) continue;
          // Detection lives on the measured curve; fit-derived landmarks live
          // on the fitted model whenever one is available (report parity).
          const markerY = spec.key === 'lod' ? y : (fitY ?? y);
          const p = pointAtSec(wl[spec.field], kineticsTime, xData, markerY);
          if (!p) continue;
          const bucket = lmPoints[spec.key];
          bucket.x.push(p.x);
          bucket.y.push(p.y);
          bucket.c.push(color);
        }
      }
    }
  }

  // Landmark legend entries sort after every curve (high legendrank).
  if (anyLandmark) {
    for (const spec of LANDMARK_SPECS) {
      const bucket = lmPoints[spec.key];
      if (!lm![spec.key] || bucket.x.length === 0) continue;
      data.push({
        x: bucket.x, y: bucket.y,
        type: 'scatter', mode: 'markers',
        name: spec.name,
        legendgroup: `lm:${spec.name}`,
        legendrank: spec.rank,
        marker: {
          symbol: spec.symbol,
          size: 9,
          color: bucket.c,
          line: { color: style.isDark ? '#000' : '#fff', width: 1 },
        },
        hoverinfo: 'skip',
        showlegend: style.showLegend,
      } as Data);
    }
  }

  const shapes: Partial<Shape>[] = [];
  // Threshold line is in raw-RFU units — hide it when the plot is normalized.
  if (input.thresholdEnabled && !normalizeEnabled && (!kinetics || signal === 'raw')) {
    shapes.push({
      type: 'line', x0: 0, x1: 1, xref: 'paper',
      y0: input.thresholdRfu, y1: input.thresholdRfu, yref: 'y',
      line: { color: '#c42a30', width: 2, dash: 'dash' },
    });
  }

  const plotBg = resolvePlotBg(style);
  const legendPos = resolveLegendPosition(style.legendPosition, data);

  const layout: Partial<Layout> = {
    title: { text: titleText(exp.experimentId ?? 'Amplification', style), font: { family: style.fontFamily, size: style.titleSize } },
    xaxis: {
      title: pfAxisLabel(X_AXIS_LABELS[xAxisMode], style),
      ...pfTickProps(style),
      ...gridStyle(style),
    },
    yaxis: {
      title: pfAxisLabel(
        kinetics
          ? (signal === 'corrected' ? 'Baseline-corrected RFU' : 'RFU')
          : normalizeEnabled ? 'Normalized fluorescence' : baselineEnabled ? 'RFU (corrected)' : 'RFU',
        style,
      ),
      type: logScale ? 'log' : 'linear',
      ...pfTickProps(style),
      ...gridStyle(style),
    },
    shapes: shapes as Layout['shapes'],
    showlegend: style.showLegend,
    legend: {
      font: { family: style.fontFamily, size: style.legendSize },
      x: legendPos.x, y: legendPos.y,
      xanchor: legendPos.xanchor as 'left' | 'right' | 'center',
      yanchor: legendPos.yanchor as 'top' | 'bottom' | 'middle',
      bgcolor: style.isDark ? '#1f1f1f' : '#ffffff',
      bordercolor: style.isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
      borderwidth: 1,
      tracegroupgap: 0,
    },
    margin: computeMargins(style),
    plot_bgcolor: plotBg, paper_bgcolor: plotBg,
    font: { color: plotFontColor(style.isDark, style.textColor) },
  };

  return { data, layout };
}

// ── Melt (RFU + derivative stacked) ────────────────────────────────

function buildMelt(input: BuildFigureInput, derivativeOnly = false): { data: Data[]; layout: Partial<Layout> } {
  const { exp, visibleWells, style, meltThresholdEnabled, meltThresholdValue } = input;
  const melt = exp.melt;
  const data: Data[] = [];
  if (!melt) return { data, layout: {} };

  const hasDerivative = Object.keys(melt.derivative).length > 0;
  const colorMap = computeColorMap(input);
  const legendGroups = computeLegendGroups(input);
  const legendRanks = buildLegendRanks(input.legendOrder);

  // RFU traces (skip if derivative-only)
  if (!derivativeOnly) {
    const meltRfu = input.meltNormalizeEnabled ? normalizeMeltCurves(melt.rfu) : melt.rfu;
    for (const well of visibleWells) {
      const rfu = meltRfu[well];
      if (!rfu) continue;
      const color = colorMap.get(well) ?? '#999';
      const lsOv = lineStyleFor(well, input);
      const lg = legendGroups.get(well)!;
      data.push({
        x: melt.temperatureC, y: rfu,
        type: 'scatter', mode: 'lines',
        name: traceName(well, input),
        legendgroup: lg.group,
        legendrank: legendRanks.get(lg.group) ?? 1000,
        line: {
          color,
          width: lsOv.width ?? style.lineWidth,
          dash: (lsOv.dash as PlotData['line']['dash']) ?? 'solid',
        },
        hoverinfo: 'name',
        showlegend: lg.isRep,
        yaxis: 'y',
      });
    }
  }

  // Derivative traces — melt.derivative is already smooth from the parser
  // (BioRad port in parsers/utils.ts), used as-is.
  if (hasDerivative) {
    for (const well of visibleWells) {
      const der = melt.derivative[well];
      if (!der) continue;
      const color = colorMap.get(well) ?? '#999';
      const lsOv = lineStyleFor(well, input);
      const lg = legendGroups.get(well)!;
      data.push({
        x: melt.temperatureC, y: der,
        type: 'scatter', mode: 'lines',
        name: traceName(well, input),
        legendgroup: lg.group,
        legendrank: legendRanks.get(lg.group) ?? 1000,
        line: {
          color,
          width: lsOv.width ?? style.lineWidth,
          dash: (lsOv.dash as PlotData['line']['dash']) ?? 'solid',
        },
        hoverinfo: 'name',
        // legend on derivative only when standalone; otherwise the RFU
        // trace above carries the entry for the group.
        showlegend: derivativeOnly && lg.isRep,
        xaxis: derivativeOnly ? 'x' : 'x2',
        yaxis: derivativeOnly ? 'y' : 'y2',
      });
    }
  }

  // Static report equivalent of the interactive report's Tm callout: one
  // marker trace carries every requested curve's fitted melt temperature.
  if (hasDerivative && input.kinetics?.showMeltTm && input.kineticsReport) {
    const rows = reportRowsByWell(input.kineticsReport);
    const tmX: number[] = [], tmY: number[] = [], tmC: string[] = [];
    for (const well of visibleWells) {
      const tm = rows.get(well)?.melt_tm;
      const der = melt.derivative[well];
      if (tm === null || tm === undefined || !Number.isFinite(tm) || !der) continue;
      const p = pointAtSec(tm, melt.temperatureC, melt.temperatureC, der);
      if (!p) continue;
      tmX.push(p.x); tmY.push(p.y); tmC.push(colorMap.get(well) ?? '#999');
    }
    if (tmX.length) {
      data.push({
        x: tmX, y: tmY,
        type: 'scatter', mode: 'markers', name: 'Tm', legendgroup: 'kinetics:tm',
        legendrank: 10004,
        marker: {
          symbol: 'triangle-down', size: 9, color: tmC,
          line: { color: style.isDark ? '#000' : '#fff', width: 1 },
        },
        hoverinfo: 'skip', showlegend: style.showLegend,
        xaxis: derivativeOnly ? 'x' : 'x2',
        yaxis: derivativeOnly ? 'y' : 'y2',
      } as Data);
    }
  }

  const plotBg = resolvePlotBg(style);
  const legendPos = resolveLegendPosition(style.legendPosition, data);
  const shapes: Partial<Shape>[] = [];

  if (meltThresholdEnabled && hasDerivative) {
    shapes.push({
      type: 'line', x0: 0, x1: 1, xref: 'paper',
      y0: meltThresholdValue, y1: meltThresholdValue,
      yref: derivativeOnly ? 'y' : 'y2',
      line: { color: '#c42a30', width: 2, dash: 'dash' },
    });
  }

  const rawTitle = derivativeOnly
    ? `${exp.experimentId ?? ''} — Melt Derivative`.trim().replace(/^—\s*/, '')
    : `${exp.experimentId ?? ''} — Melt`.trim().replace(/^—\s*/, '');

  const baseLayout: Partial<Layout> = {
    title: { text: titleText(rawTitle || 'Melt', style), font: { family: style.fontFamily, size: style.titleSize } },
    shapes: shapes as Layout['shapes'],
    showlegend: style.showLegend,
    legend: {
      font: { family: style.fontFamily, size: style.legendSize },
      x: legendPos.x, y: legendPos.y,
      xanchor: legendPos.xanchor as 'left' | 'right' | 'center',
      yanchor: legendPos.yanchor as 'top' | 'bottom' | 'middle',
      bgcolor: style.isDark ? '#1f1f1f' : '#ffffff',
      bordercolor: style.isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
      borderwidth: 1,
      tracegroupgap: 0,
    },
    margin: computeMargins(style),
    plot_bgcolor: plotBg, paper_bgcolor: plotBg,
    font: { color: plotFontColor(style.isDark, style.textColor) },
  };

  const xaxis = {
    title: pfAxisLabel('Temperature (°C)', style),
    ...pfTickProps(style),
    ...gridStyle(style),
  };

  if (derivativeOnly || !hasDerivative) {
    return {
      data,
      layout: {
        ...baseLayout,
        xaxis,
        yaxis: {
          title: pfAxisLabel(
            derivativeOnly ? '-dF/dT' : input.meltNormalizeEnabled ? 'Normalized fluorescence' : 'RFU',
            style,
          ),
          ...pfTickProps(style),
          ...gridStyle(style),
        },
      },
    };
  }

  // Full melt: stacked RFU (top) + derivative (bottom).
  // Split into two x-axes so the Temperature label + ticks sit under the
  // bottom subplot (derivative), not between the two subplots.
  const xaxisTop: Partial<Layout['xaxis']> = {
    ...pfTickProps(style),
    showticklabels: false,
    ...gridStyle(style),
    anchor: 'y',
  };
  const xaxisBottom: Partial<Layout['xaxis']> = {
    ...xaxis,
    matches: 'x',
    anchor: 'y2',
  };
  return {
    data,
    layout: {
      ...baseLayout,
      xaxis: xaxisTop,
      xaxis2: xaxisBottom,
      yaxis: {
        title: pfAxisLabel(input.meltNormalizeEnabled ? 'Normalized fluorescence' : 'RFU', style),
        ...pfTickProps(style),
        domain: [0.55, 1], anchor: 'x',
        ...gridStyle(style),
      },
      yaxis2: {
        title: pfAxisLabel('-dF/dT', style),
        ...pfTickProps(style),
        domain: [0, 0.45], anchor: 'x2',
        ...gridStyle(style),
      },
    },
  };
}

// ── Kinetics residuals (observed − FreeShoulder fit) ────────────────

function buildKineticsResiduals(input: BuildFigureInput): { data: Data[]; layout: Partial<Layout> } {
  const { exp, visibleWells, style, xAxisMode } = input;
  const amp = exp.amplification;
  const report = input.kineticsReport;
  if (!amp || !report) return { data: [], layout: {} };

  const xData = xAxisMode === 'cycle' ? amp.cycle : xAxisMode === 'time_s' ? amp.timeS : amp.timeMin;
  const fitTime = report.timeS.length ? report.timeS : (amp.timeS.length ? amp.timeS : amp.cycle);
  const rows = reportRowsByWell(report);
  const colorMap = computeColorMap(input);
  const legendGroups = computeLegendGroups(input);
  const legendRanks = buildLegendRanks(input.legendOrder);
  const data: Data[] = [];
  let maxAbs = 0;

  for (const well of visibleWells) {
    const raw = amp.wells[well];
    const params = rowFitParams(rows.get(well));
    if (!raw || !params) continue;
    const residual = fitTime.map((t, i) => raw[i] - curveAt(t, params));
    for (const v of residual) if (Number.isFinite(v)) maxAbs = Math.max(maxAbs, Math.abs(v));
    const color = colorMap.get(well) ?? '#999';
    const lsOv = lineStyleFor(well, input);
    const lg = legendGroups.get(well)!;
    data.push({
      x: xData, y: residual,
      type: 'scatter', mode: 'lines',
      name: traceName(well, input),
      legendgroup: lg.group,
      legendrank: legendRanks.get(lg.group) ?? 1000,
      line: {
        color,
        width: lsOv.width ?? style.lineWidth,
        dash: (lsOv.dash as PlotData['line']['dash']) ?? 'solid',
      },
      hoverinfo: 'name', showlegend: lg.isRep,
    });
  }

  const band = Number.isFinite(report.runSigma) ? report.runSigma : 0;
  const range = Math.max(4 * band, 1.1 * maxAbs, 1);
  const shapes: Partial<Shape>[] = [
    {
      type: 'rect', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: -band, y1: band,
      fillcolor: style.isDark ? '#ffffff' : '#000000', opacity: 0.07,
      line: { width: 0 }, layer: 'below',
    },
    {
      type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 0, y1: 0,
      line: { color: style.isDark ? '#777' : '#aeb2bb', width: 1 },
    },
  ];
  const plotBg = resolvePlotBg(style);
  const legendPos = resolveLegendPosition(style.legendPosition, data);
  const rawTitle = `${exp.experimentId ?? ''} — Fit residuals`.trim().replace(/^—\s*/, '');
  return {
    data,
    layout: {
      title: { text: titleText(rawTitle || 'Fit residuals', style), font: { family: style.fontFamily, size: style.titleSize } },
      xaxis: {
        title: pfAxisLabel(X_AXIS_LABELS[xAxisMode], style),
        ...pfTickProps(style), ...gridStyle(style),
      },
      yaxis: {
        title: pfAxisLabel('Residual (RFU)', style), range: [-range, range],
        ...pfTickProps(style), ...gridStyle(style),
      },
      shapes: shapes as Layout['shapes'],
      showlegend: style.showLegend,
      legend: {
        font: { family: style.fontFamily, size: style.legendSize },
        x: legendPos.x, y: legendPos.y,
        xanchor: legendPos.xanchor as 'left' | 'right' | 'center',
        yanchor: legendPos.yanchor as 'top' | 'bottom' | 'middle',
        bgcolor: style.isDark ? '#1f1f1f' : '#ffffff',
        bordercolor: style.isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
        borderwidth: 1,
      },
      margin: computeMargins(style),
      plot_bgcolor: plotBg, paper_bgcolor: plotBg,
      font: { color: plotFontColor(style.isDark, style.textColor) },
    },
  };
}

// ── Doubling time (per-well scatter) ───────────────────────────────

function buildDoubling(input: BuildFigureInput): { data: Data[]; layout: Partial<Layout> } {
  const { exp, visibleWells, style, xAxisMode, analysisResults } = input;
  const colorMap = computeColorMap(input);

  const wells: string[] = [], tts: number[] = [], dts: number[] = [], colors: string[] = [];
  for (const well of visibleWells) {
    const r = analysisResults.get(well);
    if (!r || r.tt == null || r.dt == null) continue;
    wells.push(well); tts.push(r.tt); dts.push(r.dt);
    colors.push(colorMap.get(well) ?? '#999');
  }

  const data: Data[] = wells.length === 0 ? [] : [{
    x: tts, y: dts,
    type: 'scatter', mode: 'text+markers',
    text: wells, textposition: 'top center',
    textfont: { size: 9, family: style.fontFamily },
    marker: { color: colors, size: 8 },
    hoverinfo: 'text',
    showlegend: false,
  }];

  const xLabel = xAxisMode === 'cycle' ? 'Ct' : 'Tt';
  const plotBg = resolvePlotBg(style);

  const layout: Partial<Layout> = {
    title: {
      text: titleText(
        `${exp.experimentId ?? ''} — Doubling Time`.trim().replace(/^—\s*/, '') || 'Doubling Time',
        style,
      ),
      font: { family: style.fontFamily, size: style.titleSize },
    },
    xaxis: {
      title: pfAxisLabel(`${xLabel} (${X_AXIS_LABELS[xAxisMode]})`, style),
      ...pfTickProps(style),
      ...gridStyle(style),
    },
    yaxis: {
      title: pfAxisLabel('Doubling Time', style),
      ...pfTickProps(style),
      ...gridStyle(style),
    },
    showlegend: false,
    margin: computeMargins(style),
    plot_bgcolor: plotBg, paper_bgcolor: plotBg,
    font: { color: plotFontColor(style.isDark, style.textColor) },
  };

  return { data, layout };
}

// ── Dilution standard curve ────────────────────────────────────────

/** Error-bar half-length per dilution step, for the requested spread. */
function errorBarValues(result: DilutionSeriesResult, source: ErrorBarSource): number[] | null {
  if (source === 'none') return null;
  return result.groupStats.map((g) => {
    if (source === 'sd') return g.stdTt;
    if (source === 'sem') return g.semTt;
    // 95% CI of the step mean, using the t-value for that step's own replicate
    // count. With n = 3 the normal approximation would understate it by ~2x.
    return g.n > 1 ? tCriticalApprox(0.025, g.n - 1) * g.semTt : 0;
  });
}

const ANNOTATION_CORNERS = {
  'top-left': { x: 0.02, y: 0.98, xanchor: 'left', yanchor: 'top' },
  'top-right': { x: 0.98, y: 0.98, xanchor: 'right', yanchor: 'top' },
  'bottom-left': { x: 0.02, y: 0.02, xanchor: 'left', yanchor: 'bottom' },
  'bottom-right': { x: 0.98, y: 0.02, xanchor: 'right', yanchor: 'bottom' },
} as const;

/**
 * Standard curve: mean time-to-threshold against input concentration, with
 * the fitted regression from `analyzeDilutionSeries`.
 *
 * Concentration is drawn on a log10 axis so a ten-fold series lands on even
 * decades, while the fit is evaluated in log2 — the space the regression was
 * solved in — so the drawn line is the actual fitted model rather than a
 * redrawing of it.
 */
function buildDilution(input: BuildFigureInput): { data: Data[]; layout: Partial<Layout> } {
  const { style, xAxisMode } = input;
  const dil = input.dilution;
  if (!dil) return { data: [], layout: {} };

  const { result } = dil;
  const stats = result.groupStats;
  const pointColor = dil.pointColor ?? '#c42a30';
  const fitColor = dil.fitColor ?? '#555555';

  const errors = errorBarValues(result, dil.errorBars);
  const data: Data[] = [];
  const useLog2 = dil.xScale === 'log2';

  // x in the chosen space. The regression is solved in log2, so `log2` mode
  // plots its native coordinates and `concentration` mode plots the same
  // points on a log10 axis — the two differ only in labelling.
  const xs = stats.map((g) => (useLog2 ? g.log2Conc : g.concentration));

  if (dil.showFit && stats.length >= 2) {
    // Two points suffice: the fit is a straight line in log2, and a log10 axis
    // is a linear remapping of log2, so it stays straight either way.
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const yAt = (x: number) => result.slope * (useLog2 ? x : Math.log2(x)) + result.intercept;
    data.push({
      x: [lo, hi],
      y: [yAt(lo), yAt(hi)],
      type: 'scatter',
      mode: 'lines',
      name: 'Fit',
      line: { color: fitColor, width: style.lineWidth, dash: 'dash' },
      hoverinfo: 'skip',
      showlegend: false,
    });
  }

  data.push({
    x: xs,
    y: stats.map((g) => g.meanTt),
    type: 'scatter',
    mode: 'markers',
    name: 'Mean',
    marker: {
      color: pointColor,
      size: dil.markerSize ?? 7,
      symbol: dil.markerSymbol ?? 'circle',
    },
    ...(errors
      ? { error_y: { type: 'data', array: errors, visible: true, color: pointColor, thickness: 1, width: 3 } }
      : {}),
    hoverinfo: 'x+y',
    showlegend: false,
  });

  const plotBg = resolvePlotBg(style);
  const yTitle = dil.yTitle
    ?? (xAxisMode === 'cycle' ? 'Ct (cycles)' : `Tt (${xAxisMode === 'time_s' ? 's' : 'min'})`);
  const xTitle = dil.xTitle
    ?? (useLog2
      ? 'log₂([template])'
      : (dil.unit ? `Input (${dil.unit})` : 'Input'));

  const annotations = dil.annotation
    ? [{
        ...ANNOTATION_CORNERS[dil.annotationPosition ?? 'top-right'],
        text: dil.annotation,
        xref: 'paper' as const,
        yref: 'paper' as const,
        showarrow: false,
        align: 'left' as const,
        font: {
          family: style.fontFamily,
          size: style.legendSize,
          color: plotFontColor(style.isDark, style.textColor),
        },
      }]
    : undefined;

  const layout: Partial<Layout> = {
    title: {
      text: titleText(input.exp.experimentId ?? 'Standard Curve', style),
      font: { family: style.fontFamily, size: style.titleSize },
    },
    xaxis: {
      title: pfAxisLabel(xTitle, style),
      type: useLog2 ? 'linear' : 'log',
      ...pfTickProps(style),
      ...gridStyle(style),
    },
    yaxis: {
      title: pfAxisLabel(yTitle, style),
      ...pfTickProps(style),
      ...gridStyle(style),
    },
    annotations: annotations as Layout['annotations'],
    showlegend: false,
    margin: computeMargins(style),
    plot_bgcolor: plotBg,
    paper_bgcolor: plotBg,
    font: { color: plotFontColor(style.isDark, style.textColor) },
  };

  return { data, layout };
}

// ── Public entry point ─────────────────────────────────────────────

export function buildFigure(plotType: PlotType, input: BuildFigureInput): { data: Data[]; layout: Partial<Layout> } {
  switch (plotType) {
    case 'amp': return buildAmp(input);
    case 'melt': return buildMelt(input, false);
    case 'melt_deriv': return buildMelt(input, true);
    case 'doubling': return buildDoubling(input);
    case 'dilution': return buildDilution(input);
    case 'kinetics_residuals': return buildKineticsResiduals(input);
  }
}
