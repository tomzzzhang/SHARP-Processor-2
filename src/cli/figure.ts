/**
 * `sharpplot figure` — the pure half of the pipeline.
 *
 * Turns a spec into one Plotly `{data, layout}` per plot panel, with the
 * layout's width/height already set to that panel's exact pixel box. No DOM,
 * no browser: this runs anywhere Node runs, which is what lets the data step
 * happen where the data lives and the browser step happen where a browser is.
 *
 * Panel resolution is layered, and the layering is the whole trick behind
 * "the .sharpx is already the spec":
 *
 *     app default  →  what the source file saved  →  composite style  →  panel
 *
 * A field the spec does not mention keeps the value the user last set in the
 * GUI, so a one-line panel reproduces their figure and edits stay small.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { Data, Layout } from 'plotly.js';
import { buildFigure, type BuildFigureInput, type PlotFigureStyle, type PlotType } from '@/lib/plot-figure';
import { computeChannelResults } from '@/hooks/useAnalysisResults';
import { computeDriftSlope, type WellAnalysisResult } from '@/lib/analysis';
import type { ChannelAnalysisState } from '@/hooks/useAppState';
import { parseCurveKey } from '@/lib/curves';
import { loadSource, visibleWellsOf, type LoadedExperiment } from './load';
import { computePlacements, inchesToPx, type PanelPlacement } from './layout';
import { readImageSize } from './image-size';
import { decorateLayout, referenceLineTraces } from './decorate';
import { describeDilution, resolveDilution, statisticValues, substituteStatistics } from './dilution';
import {
  SpecError, type ImagePanel, type PanelLabelSpec, type PlotPanel, type ResolvedSpec,
  type SpecStyle, type TablePanel, type WellSelection,
} from './spec';

export interface PlotRenderPanel {
  kind: 'plot';
  label: string;
  placement: PanelPlacement;
  /** Per-panel override of the composite label settings. */
  labelOverride: Partial<PanelLabelSpec> | null;
  figure: { data: Data[]; layout: Partial<Layout> };
  /** What actually got drawn, for the confirmation echo. */
  summary: {
    source: string;
    plotType: PlotType;
    channel: string;
    wells: string[];
    groups: string[];
    /** For a dilution panel: the resolved step table, printed for confirmation
     *  before the figure is trusted. A silently mis-assigned concentration
     *  produces a figure that looks perfect and is wrong. */
    dilution?: string;
  };
}

export interface ImageRenderPanel {
  kind: 'image';
  label: string;
  placement: PanelPlacement;
  labelOverride: Partial<PanelLabelSpec> | null;
  /** Absolute path to the image on disk. */
  path: string;
  fit: 'contain' | 'cover' | 'fill';
  crop: { x: number; y: number; w: number; h: number } | null;
  background: string | null;
  /** Intrinsic pixel size, when it could be read. Lets a cropped panel keep
   *  the source's aspect ratio instead of stretching it. */
  intrinsic: { width: number; height: number } | null;
}

export interface TableRenderPanel {
  kind: 'table';
  label: string;
  placement: PanelPlacement;
  labelOverride: Partial<PanelLabelSpec> | null;
  columns: string[];
  rows: (string | number)[][];
  fontSize: number;
  align: ('left' | 'center' | 'right')[];
  header: boolean;
  fontFamily: string;
  color: string;
}

export type RenderPanel = PlotRenderPanel | ImageRenderPanel | TableRenderPanel;

export interface FigureBundle {
  id: string;
  output: ResolvedSpec['output'];
  layout: ResolvedSpec['layout'];
  panelLabels: ResolvedSpec['panelLabels'];
  panels: RenderPanel[];
}

/** Cache so a composite with three panels over one file loads it once. */
type SourceCache = Map<string, Promise<LoadedExperiment>>;

function loadCached(cache: SourceCache, absPath: string): Promise<LoadedExperiment> {
  const hit = cache.get(absPath);
  if (hit) return hit;
  const p = loadSource(absPath);
  cache.set(absPath, p);
  return p;
}

/** Take `override` when it is neither undefined nor null, else `base`. */
function pick<T>(override: T | null | undefined, base: T): T {
  return override === undefined || override === null ? base : override;
}

/**
 * The analysis settings for this panel: the channel's saved state with any
 * panel-level overrides applied. Only the fields a spec can set are
 * overridable; per-well baseline/normalize overrides always come from the file.
 */
function resolveChannelState(saved: ChannelAnalysisState, panel: PlotPanel): ChannelAnalysisState {
  return {
    ...saved,
    baselineEnabled: pick(panel.baselineEnabled, saved.baselineEnabled),
    baselineAuto: pick(panel.baselineAuto, saved.baselineAuto),
    baselineMethod: pick(panel.baselineMethod, saved.baselineMethod),
    baselineStart: pick(panel.baselineStart, saved.baselineStart),
    baselineEnd: pick(panel.baselineEnd, saved.baselineEnd),
    driftCorrectionEnabled: pick(panel.driftCorrectionEnabled, saved.driftCorrectionEnabled),
    normalizeEnabled: pick(panel.normalizeEnabled, saved.normalizeEnabled),
    meltNormalizeEnabled: pick(panel.meltNormalizeEnabled, saved.meltNormalizeEnabled),
    thresholdEnabled: pick(panel.thresholdEnabled, saved.thresholdEnabled),
    thresholdRfu: pick(panel.thresholdRfu, saved.thresholdRfu),
    meltThresholdEnabled: pick(panel.meltThresholdEnabled, saved.meltThresholdEnabled),
    meltThresholdValue: pick(panel.meltThresholdValue, saved.meltThresholdValue),
    smoothingEnabled: pick(panel.smoothingEnabled, saved.smoothingEnabled),
    smoothingWindow: pick(panel.smoothingWindow, saved.smoothingWindow),
    fittingEnabled: pick(panel.fittingEnabled, saved.fittingEnabled),
    fitStartFraction: pick(panel.fitStartFraction, saved.fitStartFraction),
    fitEndFraction: pick(panel.fitEndFraction, saved.fitEndFraction),
  };
}

/** Style: app/file value, then composite-level, then panel-level. */
function resolveStyle(loaded: LoadedExperiment, composite: SpecStyle, panel: SpecStyle | undefined): PlotFigureStyle {
  const v = loaded.view;
  const fromFile: PlotFigureStyle = {
    palette: v.palette,
    paletteReversed: v.paletteReversed,
    paletteGroupColors: v.paletteGroupColors,
    lineWidth: v.lineWidth,
    fontFamily: v.fontFamily,
    titleSize: v.titleSize,
    labelSize: v.labelSize,
    tickSize: v.tickSize,
    legendSize: v.legendSize,
    showLegend: v.showLegend,
    legendPosition: v.legendPosition,
    legendContent: v.legendContent,
    showTitle: v.showTitle,
    showLabels: v.showLabels,
    showTicks: v.showTicks,
    showGrid: v.showGrid,
    gridAlpha: v.gridAlpha,
    plotBgColor: v.plotBgColor,
    textColor: v.textColor,
    // Figures are for print. A dark-mode GUI must not produce a dark figure.
    isDark: false,
  };
  return { ...fromFile, ...stripNullish(composite), ...stripNullish(panel ?? {}) };
}

function stripNullish<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) if (val !== undefined && val !== null) out[k] = val;
  return out as Partial<T>;
}

/**
 * Effective group per well on this channel: the curve-level group first, then
 * the well-level one. Grouping has written `curveGroups` since the
 * curve-centric migration, so reading only `wellGroups` silently loses every
 * group on a recently-saved file.
 */
function effectiveGroups(loaded: LoadedExperiment, channel: string, panel: PlotPanel): Map<string, string> {
  const out = new Map<string, string>();
  for (const [well, g] of loaded.view.wellGroups) out.set(well, g);
  for (const [key, g] of loaded.view.curveGroups) {
    const { well, channel: ch } = parseCurveKey(key);
    if (ch === channel) out.set(well, g);
  }
  if (panel.groups) for (const [well, g] of Object.entries(panel.groups)) out.set(well, g);
  return out;
}

/** Per-well visual overrides: well-level, then this channel's curve-level,
 *  then the panel's own, then any per-group colours the panel names. */
function effectiveStyleOverrides(
  loaded: LoadedExperiment,
  channel: string,
  panel: PlotPanel,
  groups: Map<string, string>,
): Map<string, { color?: string; lineStyle?: string; lineWidth?: number }> {
  const out = new Map<string, { color?: string; lineStyle?: string; lineWidth?: number }>();
  for (const [well, ov] of loaded.view.wellStyleOverrides) out.set(well, { ...ov });
  for (const [key, ov] of loaded.view.curveStyleOverrides) {
    const { well, channel: ch } = parseCurveKey(key);
    if (ch === channel) out.set(well, { ...(out.get(well) ?? {}), ...ov });
  }
  if (panel.groupColors) {
    for (const [well, group] of groups) {
      const color = panel.groupColors[group];
      if (color) out.set(well, { ...(out.get(well) ?? {}), color });
    }
  }
  if (panel.wellStyleOverrides) {
    for (const [well, ov] of Object.entries(panel.wellStyleOverrides)) {
      out.set(well, { ...(out.get(well) ?? {}), ...stripNullish(ov) });
    }
  }
  return out;
}

/**
 * Which wells this panel draws. With no `select`, the file's own visible set
 * (populated, not hidden, not deactivated). With one, the named wells —
 * explicitly naming a well overrides the file's hidden flag, since asking for
 * it is asking to see it.
 *
 * Any name that does not exist is a hard error. A spec that silently skipped
 * an unknown well would produce a figure that looks right and is missing data.
 */
function resolveSelection(loaded: LoadedExperiment, select: WellSelection | null | undefined, groups: Map<string, string>, label: string): string[] {
  const { exp, view } = loaded;
  const known = new Set(exp.wellsUsed);
  if (!select || (!select.wells && !select.groups && !select.samples)) {
    const base = visibleWellsOf(loaded);
    return select?.exclude ? applyExclude(base, select.exclude, known, label) : base;
  }

  const chosen = new Set<string>();
  if (select.wells) {
    const unknown = select.wells.filter((w) => !known.has(w));
    if (unknown.length > 0) {
      throw new SpecError(
        `Panel "${label}" selects wells that are not in the file: ${unknown.join(', ')}. ` +
        `Known wells: ${exp.wellsUsed.join(', ')}`,
      );
    }
    for (const w of select.wells) chosen.add(w);
  }
  if (select.groups) {
    const present = new Set(groups.values());
    const unknown = select.groups.filter((g) => !present.has(g));
    if (unknown.length > 0) {
      throw new SpecError(
        `Panel "${label}" selects groups that do not exist: ${unknown.join(', ')}. ` +
        `Known groups: ${[...present].join(', ') || '(none)'}`,
      );
    }
    for (const [well, g] of groups) if (select.groups.includes(g) && known.has(well)) chosen.add(well);
  }
  if (select.samples) {
    const samples = new Map<string, string[]>();
    for (const w of exp.wellsUsed) {
      const s = exp.wells[w]?.sample ?? '';
      samples.set(s, [...(samples.get(s) ?? []), w]);
    }
    const unknown = select.samples.filter((s) => !samples.has(s));
    if (unknown.length > 0) {
      throw new SpecError(
        `Panel "${label}" selects samples that do not exist: ${unknown.join(', ')}. ` +
        `Known samples: ${[...samples.keys()].filter(Boolean).join(', ') || '(none)'}`,
      );
    }
    for (const s of select.samples) for (const w of samples.get(s)!) chosen.add(w);
  }

  // Deactivated wells are "not part of this plate" rather than "hidden right
  // now", so they stay out unless named outright.
  const named = new Set(select.wells ?? []);
  const kept = exp.wellsUsed.filter((w) => chosen.has(w) && (named.has(w) || !view.deactivatedWells.has(w)));
  return select.exclude ? applyExclude(kept, select.exclude, known, label) : kept;
}

function applyExclude(wells: string[], exclude: string[], known: Set<string>, label: string): string[] {
  const unknown = exclude.filter((w) => !known.has(w));
  if (unknown.length > 0) {
    throw new SpecError(`Panel "${label}" excludes wells that are not in the file: ${unknown.join(', ')}.`);
  }
  const drop = new Set(exclude);
  return wells.filter((w) => !drop.has(w));
}

/** Legend entry order. The app stores group entries as `grp:<name>`. */
function resolveLegendOrder(loaded: LoadedExperiment, panel: PlotPanel): string[] {
  const explicit = panel.legend?.order;
  if (explicit) {
    return explicit.map((e) => (e.startsWith('grp:') || e.startsWith('well:') ? e : `grp:${e}`));
  }
  return loaded.view.legendOrder;
}

async function buildPlotPanel(
  panel: PlotPanel,
  spec: ResolvedSpec,
  placement: PanelPlacement,
  cache: SourceCache,
): Promise<PlotRenderPanel> {
  const source = path.isAbsolute(panel.source) ? panel.source : path.resolve(spec.baseDir, panel.source);
  const loaded = await loadCached(cache, source);
  const { exp, view } = loaded;

  const channel = panel.channel ?? view.activeChannel;
  if (!exp.channels.includes(channel)) {
    throw new SpecError(
      `Panel "${panel.label}" asks for channel "${channel}", which the file does not have. ` +
      `Available: ${exp.channels.join(', ')}`,
    );
  }

  const savedCs = loaded.channelStates.get(channel);
  if (!savedCs) throw new SpecError(`Panel "${panel.label}": no analysis state for channel "${channel}".`);
  const cs = resolveChannelState(savedCs, panel);

  const xAxisMode = pick(panel.xAxisMode, view.xAxisMode);
  const amp = exp.amplificationByChannel[channel] ?? null;
  const active = exp.wellsUsed.filter((w) => !view.deactivatedWells.has(w));
  const drift = amp && cs.driftCorrectionEnabled ? computeDriftSlope(amp, active).slope : 0;
  const analysisResults: Map<string, WellAnalysisResult> =
    computeChannelResults(amp, active, xAxisMode, cs, drift);

  const groups = effectiveGroups(loaded, channel, panel);
  const wellStyleOverrides = effectiveStyleOverrides(loaded, channel, panel, groups);
  const visibleWells = resolveSelection(loaded, panel.select, groups, panel.label!);

  if (visibleWells.length === 0) {
    throw new SpecError(`Panel "${panel.label}" selects no wells — nothing would be drawn.`);
  }

  // The experiment handed to buildFigure must point at THIS panel's channel;
  // `exp.amplification`/`exp.melt` are the active-channel pointers the app
  // re-points on channel switch.
  const expForChannel = {
    ...exp,
    amplification: exp.amplificationByChannel[channel] ?? null,
    melt: exp.meltByChannel[channel] ?? null,
  };

  const input: BuildFigureInput = {
    exp: expForChannel,
    visibleWells,
    wellGroups: groups,
    wellStyleOverrides,
    analysisResults,
    legendOrder: resolveLegendOrder(loaded, panel),
    style: resolveStyle(loaded, spec.style, panel.styleOverride),
    xAxisMode,
    logScale: pick(panel.logScale, view.logScale),
    baselineEnabled: cs.baselineEnabled,
    normalizeEnabled: cs.normalizeEnabled,
    thresholdEnabled: cs.thresholdEnabled,
    thresholdRfu: cs.thresholdRfu,
    meltThresholdEnabled: cs.meltThresholdEnabled,
    meltThresholdValue: cs.meltThresholdValue,
    meltNormalizeEnabled: cs.meltNormalizeEnabled,
    smoothingEnabled: cs.smoothingEnabled,
    smoothingWindow: cs.smoothingWindow,
  };

  // Legend visibility/position/content are style fields, applied above; the
  // panel's `legend.show` is a convenience alias for the same thing.
  if (panel.legend) {
    if (panel.legend.show !== undefined && panel.legend.show !== null) input.style.showLegend = panel.legend.show;
    // `above` is a CLI-only placement resolved in decorateLayout; the app's
    // position map has no equivalent, so seed it with the nearest corner.
    if (panel.legend.position) {
      input.style.legendPosition = panel.legend.position === 'above' ? 'upper left' : panel.legend.position;
    }
    if (panel.legend.content) input.style.legendContent = panel.legend.content;
  }

  // A dilution panel needs the regression, not the curves. It is computed by
  // `analyzeDilutionSeries` from the SAME analysis results this panel would
  // plot, so a standard curve can never disagree with the amplification panel
  // beside it.
  let dilutionEcho: string | null = null;
  if (panel.plotType === 'dilution') {
    const ttByWell = new Map<string, number>();
    for (const [well, r] of analysisResults) {
      if (r.tt != null && !view.hiddenWells.has(well) && !view.deactivatedWells.has(well)) {
        ttByWell.set(well, r.tt);
      }
    }
    const resolved = resolveDilution(loaded, panel.dilution, ttByWell);
    dilutionEcho = describeDilution(resolved, ttByWell);
    const values = statisticValues(resolved.result);
    input.dilution = {
      result: resolved.result,
      unit: panel.dilution?.unit ?? resolved.config.unit ?? '',
      errorBars: panel.errorBars ?? 'sd',
      showFit: pick(panel.showFit, true),
      annotation: panel.fitAnnotation ? substituteStatistics(panel.fitAnnotation, values) : null,
      annotationPosition: panel.fitAnnotationPosition ?? undefined,
      pointColor: panel.pointColor ?? undefined,
      fitColor: panel.fitColor ?? undefined,
      markerSize: panel.markerSize ?? undefined,
      markerSymbol: panel.markerSymbol ?? undefined,
      xScale: panel.dilution?.xScale ?? undefined,
      yTitle: panel.yaxis?.title ?? null,
      xTitle: panel.xaxis?.title ?? null,
    };
  } else {
    assertPlotTypeAvailable(panel.plotType, expForChannel, panel.label!, analysisResults);
  }

  const figure = buildFigure(panel.plotType, input);

  // Exact pixel box. Plotly is told its size rather than inferring it from the
  // CSS box — an autosized layout clips axis labels in headless Chrome.
  const layout: Partial<Layout> = {
    ...figure.layout,
    width: inchesToPx(placement.w_in),
    height: inchesToPx(placement.h_in),
  };

  decorateLayout(layout, panel, input.style, figure.data);
  // Reference lines that asked for a legend entry ride along as invisible
  // traces, since a Plotly shape cannot appear in the legend on its own.
  const data: Data[] = [...figure.data, ...(referenceLineTraces(panel) as Data[])];

  return {
    kind: 'plot',
    label: panel.label!,
    placement,
    labelOverride: panel.panelLabel ?? null,
    figure: { data, layout },
    summary: {
      source,
      plotType: panel.plotType,
      channel,
      wells: visibleWells,
      groups: [...new Set(visibleWells.map((w) => groups.get(w)).filter((g): g is string => Boolean(g)))],
      ...(dilutionEcho ? { dilution: dilutionEcho } : {}),
    },
  };
}

/** Fail early and specifically rather than emitting an empty panel. */
function assertPlotTypeAvailable(
  plotType: PlotType,
  exp: { amplification: unknown; melt: { rfu: Record<string, number[]>; derivative: Record<string, number[]> } | null },
  label: string,
  results: Map<string, WellAnalysisResult>,
): void {
  if (plotType === 'amp' && !exp.amplification) {
    throw new SpecError(`Panel "${label}" is an amp plot but the source has no amplification data.`);
  }
  if ((plotType === 'melt' || plotType === 'melt_deriv') && !exp.melt) {
    throw new SpecError(`Panel "${label}" is a ${plotType} plot but the source has no melt data.`);
  }
  if (plotType === 'melt' && exp.melt && Object.keys(exp.melt.rfu).length === 0) {
    throw new SpecError(`Panel "${label}" is a melt plot but the source has no melt RFU curves.`);
  }
  if (plotType === 'melt_deriv' && exp.melt && Object.keys(exp.melt.derivative).length === 0) {
    throw new SpecError(`Panel "${label}" is a melt_deriv plot but the source has no melt derivative curves.`);
  }
  if (plotType === 'doubling') {
    const n = [...results.values()].filter((r) => r.tt != null && r.dt != null).length;
    if (n === 0) {
      throw new SpecError(
        `Panel "${label}" is a doubling plot but no well produced both a Tt and a doubling time. ` +
        'It needs thresholdEnabled (for Tt) and the source\'s fitting settings (for doubling time).',
      );
    }
  }
}

async function buildImagePanel(panel: ImagePanel, spec: ResolvedSpec, placement: PanelPlacement): Promise<ImageRenderPanel> {
  const abs = path.isAbsolute(panel.path) ? panel.path : path.resolve(spec.baseDir, panel.path);
  if (!existsSync(abs)) {
    throw new SpecError(`Image panel "${panel.label}" points at ${abs}, which does not exist.`);
  }
  const crop = panel.crop ?? null;
  if (crop) {
    const inRange = (v: number) => v >= 0 && v <= 1;
    if (!inRange(crop.x) || !inRange(crop.y) || !(crop.w > 0) || !(crop.h > 0)
      || crop.x + crop.w > 1.0001 || crop.y + crop.h > 1.0001) {
      throw new SpecError(
        `Image panel "${panel.label}" has an out-of-range crop. ` +
        'x/y/w/h are fractions of the source image and the window must lie inside it.',
      );
    }
  }
  return {
    kind: 'image',
    label: panel.label!,
    placement,
    labelOverride: panel.panelLabel ?? null,
    path: abs,
    fit: panel.fit ?? 'contain',
    crop,
    background: panel.background ?? null,
    intrinsic: await readImageSize(abs),
  };
}

function buildTablePanel(panel: TablePanel, spec: ResolvedSpec, placement: PanelPlacement): TableRenderPanel {
  const style = spec.style;
  return {
    kind: 'table',
    label: panel.label!,
    placement,
    labelOverride: panel.panelLabel ?? null,
    columns: panel.columns,
    rows: panel.rows,
    fontSize: panel.fontSize ?? style.tickSize ?? 7,
    align: panel.align ?? panel.columns.map((_, i) => (i === 0 ? 'left' : 'right')),
    header: panel.header ?? true,
    fontFamily: panel.styleOverride?.fontFamily ?? style.fontFamily ?? 'Arial, Helvetica, sans-serif',
    color: style.textColor === 'white' ? '#ffffff' : '#000000',
  };
}

/**
 * Warn when a legend has more entries than its panel can show.
 *
 * Plotly clips a legend taller than the plotting area without complaint, so
 * the figure looks finished while silently omitting series — the same class of
 * failure as dropping a well. Warn rather than fail: the caller may genuinely
 * not care, and the fix (smaller legend font, a taller panel, `position`
 * outside, or `legend.show: false`) is theirs to choose.
 */
function warnIfLegendClipped(panel: PlotRenderPanel): void {
  const layout = panel.figure.layout;
  if (!layout.showlegend) return;
  // A horizontal legend flows across and wraps, so its height is not driven by
  // the entry count and this check does not apply.
  if ((layout.legend as { orientation?: string } | undefined)?.orientation === 'h') return;
  const entries = panel.figure.data.filter((t) => (t as { showlegend?: boolean }).showlegend).length;
  if (entries === 0) return;

  const margin = (layout.margin ?? {}) as { t?: number; b?: number };
  const plotHeight = (layout.height ?? 0) - (margin.t ?? 0) - (margin.b ?? 0);
  const legendSize = (layout.legend as { font?: { size?: number } } | undefined)?.font?.size ?? 12;
  // Plotly's per-entry height is roughly the font size plus fixed padding.
  const entryHeight = legendSize * 1.3 + 12;
  const needed = entries * entryHeight;
  if (needed <= plotHeight) return;

  const fits = Math.max(0, Math.floor(plotHeight / entryHeight));
  process.stderr.write(
    `sharpplot: panel "${panel.label}" legend has ${entries} entries but only about ${fits} fit ` +
    `in ${Math.round(plotHeight)}px of plot height — Plotly will clip the rest.\n` +
    '  Options: a taller panel, a smaller style.legendSize, legend.position "right", ' +
    'legend.content "group", or legend.show false.\n',
  );
}

/** With no font stated anywhere, take the one the first plot panel resolved
 *  (which came from its source file), so labels match the axes. */
function defaultLabelFont(panels: RenderPanel[]): string | undefined {
  for (const p of panels) {
    if (p.kind === 'plot') {
      const font = (p.figure.layout.xaxis as { title?: { font?: { family?: string } } } | undefined)?.title?.font?.family;
      if (font) return font;
    }
  }
  return undefined;
}

/** Build every panel of a resolved spec. Pure: no browser involved. */
export async function buildBundle(spec: ResolvedSpec): Promise<FigureBundle> {
  const placements = computePlacements(spec);
  const cache: SourceCache = new Map();

  const panels: RenderPanel[] = [];
  for (const panel of spec.panels) {
    const placement = placements.get(panel.label!);
    if (!placement) throw new SpecError(`Panel "${panel.label}" has no place in the grid.`);
    if (panel.kind === 'plot') {
      const built = await buildPlotPanel(panel, spec, placement, cache);
      warnIfLegendClipped(built);
      panels.push(built);
    }
    else if (panel.kind === 'image') panels.push(await buildImagePanel(panel, spec, placement));
    else panels.push(buildTablePanel(panel, spec, placement));
  }

  return {
    id: spec.id,
    output: spec.output,
    layout: spec.layout,
    // Panel labels default to the composite font. Without this they fall back
    // to the browser's serif default and a figure set in Arial gets Times
    // letters, which is immediately visible in print.
    panelLabels: {
      ...spec.panelLabels,
      fontFamily: spec.panelLabels.fontFamily ?? spec.style.fontFamily ?? defaultLabelFont(panels),
    },
    panels,
  };
}
