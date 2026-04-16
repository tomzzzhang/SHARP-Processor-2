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
import type { WellAnalysisResult } from '@/lib/analysis';
import { savitzkyGolaySmooth } from '@/lib/analysis';
import { getPaletteColors } from '@/lib/constants';

export type PlotType = 'amp' | 'melt' | 'melt_deriv' | 'doubling';

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
  isDark: boolean;
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
  thresholdEnabled: boolean;
  thresholdRfu: number;
  meltThresholdEnabled: boolean;
  meltThresholdValue: number;
  smoothingEnabled: boolean;
  smoothingWindow: number;
  smoothingMeltDerivative: boolean;
}

const X_AXIS_LABELS: Record<XAxisMode, string> = {
  cycle: 'Cycle',
  time_s: 'Time (s)',
  time_min: 'Time (min)',
};

const LEGEND_POS_MAP: Record<string, { x: number; y: number; xanchor: string; yanchor: string }> = {
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

function resolveLegendPosition(position: string): { x: number; y: number; xanchor: string; yanchor: string } {
  if (position === 'best') return LEGEND_POS_MAP['upper right'];
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

function plotFontColor(isDark: boolean) {
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
  const tickContrib = style.showTicks ? style.tickSize * 2 : 0;
  return {
    l: Math.round(40 + labelContrib + tickContrib),
    r: 20,
    t: Math.round(style.showTitle ? 20 + style.titleSize * 1.5 : 20),
    b: Math.round(30 + labelContrib + style.tickSize * 1.2),
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

// ── Amplification ───────────────────────────────────────────────────

function buildAmp(input: BuildFigureInput): { data: Data[]; layout: Partial<Layout> } {
  const { exp, visibleWells, style, xAxisMode, logScale, baselineEnabled, analysisResults } = input;
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

  for (const well of visibleWells) {
    const raw = amp.wells[well];
    if (!raw) continue;
    const analysis = analysisResults.get(well);
    const y = (baselineEnabled && analysis?.correctedRfu) || raw;
    const color = colorMap.get(well) ?? '#999';
    const lsOv = lineStyleFor(well, input);
    const lg = legendGroups.get(well)!;
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

  const shapes: Partial<Shape>[] = [];
  if (input.thresholdEnabled) {
    shapes.push({
      type: 'line', x0: 0, x1: 1, xref: 'paper',
      y0: input.thresholdRfu, y1: input.thresholdRfu, yref: 'y',
      line: { color: '#c42a30', width: 2, dash: 'dash' },
    });
  }

  const plotBg = resolvePlotBg(style);
  const legendPos = resolveLegendPosition(style.legendPosition);

  const layout: Partial<Layout> = {
    title: { text: titleText(exp.experimentId ?? 'Amplification', style), font: { family: style.fontFamily, size: style.titleSize } },
    xaxis: {
      title: pfAxisLabel(X_AXIS_LABELS[xAxisMode], style),
      ...pfTickProps(style),
      ...gridStyle(style),
    },
    yaxis: {
      title: pfAxisLabel(baselineEnabled ? 'RFU (corrected)' : 'RFU', style),
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
    font: { color: plotFontColor(style.isDark) },
  };

  return { data, layout };
}

// ── Melt (RFU + derivative stacked) ────────────────────────────────

function buildMelt(input: BuildFigureInput, derivativeOnly = false): { data: Data[]; layout: Partial<Layout> } {
  const { exp, visibleWells, style, smoothingEnabled, smoothingMeltDerivative, smoothingWindow, meltThresholdEnabled, meltThresholdValue } = input;
  const melt = exp.melt;
  const data: Data[] = [];
  if (!melt) return { data, layout: {} };

  const hasDerivative = Object.keys(melt.derivative).length > 0;
  const smoothDeriv = smoothingEnabled && smoothingMeltDerivative;
  const colorMap = computeColorMap(input);
  const legendGroups = computeLegendGroups(input);
  const legendRanks = buildLegendRanks(input.legendOrder);

  // RFU traces (skip if derivative-only)
  if (!derivativeOnly) {
    for (const well of visibleWells) {
      const rfu = melt.rfu[well];
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

  // Derivative traces
  if (hasDerivative) {
    for (const well of visibleWells) {
      let der = melt.derivative[well];
      if (!der) continue;
      if (smoothDeriv) der = savitzkyGolaySmooth(der, smoothingWindow);
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
        yaxis: derivativeOnly ? 'y' : 'y2',
      });
    }
  }

  const plotBg = resolvePlotBg(style);
  const legendPos = resolveLegendPosition(style.legendPosition);
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
    font: { color: plotFontColor(style.isDark) },
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
          title: pfAxisLabel(derivativeOnly ? '-dF/dT' : 'RFU', style),
          ...pfTickProps(style),
          ...gridStyle(style),
        },
      },
    };
  }

  // Full melt: stacked RFU (top) + derivative (bottom)
  return {
    data,
    layout: {
      ...baseLayout,
      xaxis,
      yaxis: {
        title: pfAxisLabel('RFU', style),
        ...pfTickProps(style),
        domain: [0.55, 1],
        ...gridStyle(style),
      },
      yaxis2: {
        title: pfAxisLabel('-dF/dT', style),
        ...pfTickProps(style),
        domain: [0, 0.45], anchor: 'x',
        ...gridStyle(style),
      },
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
    font: { color: plotFontColor(style.isDark) },
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
  }
}
