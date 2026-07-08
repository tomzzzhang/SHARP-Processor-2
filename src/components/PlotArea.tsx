import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import _createPlotlyComponent from 'react-plotly.js/factory';
import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults, useAllChannelResults, useAllChannelLandmarks } from '@/hooks/useAnalysisResults';
import { analyzeDilutionSeries, normalizeMeltCurves } from '@/lib/analysis';
import { THRESHOLD_LINE_COLOR, MOD_KEY, getPaletteColors, monochromeRamp } from '@/lib/constants';
import { effectiveChannelLabel, effectiveChannelColor } from '@/lib/channels';
import { curveKey } from '@/lib/curves';
import { buildColorMap, resolveCurveColorWidth } from '@/lib/curve-colors';
import { Checkbox } from '@/components/ui/checkbox';
import { useBoxSelect, BOX_SELECT_OVERLAY_STYLE, RESIZE_OVERLAY_STYLE } from '@/hooks/useBoxSelect';
import { ContextMenu, useContextMenu } from './ContextMenu';
import type { Data, Layout, PlotMouseEvent, Shape } from 'plotly.js';

// CJS interop
const createPlotlyComponent =
  typeof _createPlotlyComponent === 'function'
    ? _createPlotlyComponent
    : (_createPlotlyComponent as unknown as { default: typeof _createPlotlyComponent }).default;

const Plot = createPlotlyComponent(Plotly);

/** Reactive theme info for Plotly charts — bg color + dark mode detection.
 *  Uses the store's plotBgColor when set, otherwise defaults to a clean off-white
 *  (light) or dark surface color (dark). */
function usePlotTheme() {
  const customBg = useAppState((s) => s.plotBgColor);
  const textColor = useAppState((s) => s.textColor);
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const plotBg = customBg || (isDark ? '#1e1e1e' : '#fafafa');
  return { plotBg, isDark, textColor };
}


class PlotErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) {
    return { error: err.message };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-red-500 text-sm">
          Plot failed to load: {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

const X_AXIS_LABELS = {
  cycle: 'Cycle',
  time_s: 'Time (s)',
  time_min: 'Time (min)',
} as const;

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

// "Best" legend position: pick the corner with least data density.
// Checks the four corners and picks the one where the fewest data points fall.
const CORNER_CANDIDATES = [
  { x: 1, y: 1, xanchor: 'right', yanchor: 'top' },     // upper right
  { x: 0, y: 1, xanchor: 'left', yanchor: 'top' },      // upper left
  { x: 1, y: 0, xanchor: 'right', yanchor: 'bottom' },   // lower right
  { x: 0, y: 0, xanchor: 'left', yanchor: 'bottom' },    // lower left
] as const;

function bestLegendPosition(traces: Data[]): { x: number; y: number; xanchor: string; yanchor: string } {
  // Count data points in each quadrant (normalized 0-1 x and y ranges)
  const counts = [0, 0, 0, 0]; // UR, UL, LR, LL
  let hasData = false;

  for (const trace of traces) {
    const xs = (trace as { x?: number[] }).x;
    const ys = (trace as { y?: number[] }).y;
    if (!xs || !ys || xs.length === 0) continue;
    hasData = true;

    // Find data range for normalization
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
      const nx = (xs[i] - xMin) / xRange;
      const ny = (ys[i] - yMin) / yRange;
      const rightHalf = nx > 0.5;
      const topHalf = ny > 0.5;
      if (rightHalf && topHalf) counts[0]++;
      else if (!rightHalf && topHalf) counts[1]++;
      else if (rightHalf && !topHalf) counts[2]++;
      else counts[3]++;
    }
  }

  if (!hasData) return CORNER_CANDIDATES[0];
  // Pick corner with fewest points
  let minIdx = 0;
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] < counts[minIdx]) minIdx = i;
  }
  return CORNER_CANDIDATES[minIdx];
}

function usePlotStyle() {
  const lineWidth = useAppState((s) => s.lineWidth);
  const palette = useAppState((s) => s.palette);
  const showGrid = useAppState((s) => s.showGrid);
  const gridAlpha = useAppState((s) => s.gridAlpha);
  const fontFamily = useAppState((s) => s.fontFamily);
  const titleSize = useAppState((s) => s.titleSize);
  const labelSize = useAppState((s) => s.labelSize);
  const tickSize = useAppState((s) => s.tickSize);
  const legendSize = useAppState((s) => s.legendSize);
  const showLegend = useAppState((s) => s.showLegend);
  const legendPosition = useAppState((s) => s.legendPosition);
  const legendVisibleOnly = useAppState((s) => s.legendVisibleOnly);
  const showTitle = useAppState((s) => s.showTitle);
  const showLabels = useAppState((s) => s.showLabels);
  const showTicks = useAppState((s) => s.showTicks);
  // Memoize so the returned object is referentially stable while the
  // individual style values are unchanged. Without this, every render of a
  // plot produced a fresh `style` object, busting the `layout`/`traces`
  // memos that depend on it and forcing a full Plotly redraw on every
  // re-render (hover, selection, unrelated store changes).
  return useMemo(
    () => ({
      lineWidth, palette, showGrid, gridAlpha, fontFamily, titleSize,
      labelSize, tickSize, legendSize, showLegend, legendPosition,
      legendVisibleOnly, showTitle, showLabels, showTicks,
    }),
    [lineWidth, palette, showGrid, gridAlpha, fontFamily, titleSize,
     labelSize, tickSize, legendSize, showLegend, legendPosition,
     legendVisibleOnly, showTitle, showLabels, showTicks],
  );
}

/** Observe a plot container and return a font-scale factor: 1 at a comfortable
 *  size, shrinking to a floor as the plot gets small so axis titles/ticks don't
 *  crowd or overrun a small chart. rAF-throttled and only updates state on a
 *  meaningful change, so it can't churn the memoized layout on its own. */
function usePlotFontScale(ref: React.RefObject<HTMLDivElement | null>) {
  // WIDTH-driven so every plot — and a plot plus its sibling sub-plot (the amp
  // chart and the −dF/dT mini below it share the same content width) — gets the
  // SAME scale, so their axis labels match in size. Caps at 0.8 so labels stay
  // comfortably small by default (the "labels are too big" report), easing to a
  // 0.6 floor as the plot narrows so labels never overrun a small chart.
  const [scale, setScale] = useState(0.8);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const measure = () => {
      const w = el.clientWidth;
      if (!w) return;
      const next = Math.max(0.6, 0.8 * Math.min(1, w / 640));
      setScale((prev) => (Math.abs(prev - next) > 0.02 ? next : prev));
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(el);
    measure();
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [ref]);
  return scale;
}

/** Return a copy of `style` with the plot font sizes scaled by `scale`
 *  (identity at scale === 1, so the memo identity is preserved at full size). */
function useScaledStyle(style: ReturnType<typeof usePlotStyle>, scale: number) {
  // Scales the axis title / label / tick fonts. Legend size is left alone — it's
  // a separate element, not a crowded axis label. Memoized so the layout's
  // identity stays stable while scale is unchanged (no redraw on hover/select).
  return useMemo(
    () => ({
      ...style,
      titleSize: style.titleSize * scale,
      labelSize: style.labelSize * scale,
      tickSize: style.tickSize * scale,
    }),
    [style, scale],
  );
}

/** Build an axis title object — returns empty text when labels are hidden. */
function axisLabel(text: string, style: ReturnType<typeof usePlotStyle>) {
  return {
    text: style.showLabels ? text : '',
    font: { family: style.fontFamily, size: style.labelSize },
  };
}

/** Extra axis props for tick visibility. */
function tickProps(style: ReturnType<typeof usePlotStyle>) {
  return {
    tickfont: { family: style.fontFamily, size: style.tickSize },
    showticklabels: style.showTicks,
  };
}

/** Build a Plotly `title` object honoring the user's Show title toggle.
 *  When hidden, we still pass a title object with empty text so downstream
 *  margin reservations stay consistent with the layout that builds it. */
function titleField(text: string, style: ReturnType<typeof usePlotStyle>) {
  return {
    text: style.showTitle ? text : '',
    font: { family: style.fontFamily, size: style.titleSize },
  };
}

/** Compute plot margins that scale with font sizes so text doesn't
 *  overlap the chart area. When labels or ticks are hidden, their
 *  contribution is excluded. */
function computeMargins(style: ReturnType<typeof usePlotStyle>, hintTop = 0) {
  const labelContrib = style.showLabels ? style.labelSize * 1.5 : 0;
  const tickContribL = style.showTicks ? style.tickSize * 2 : 0;
  const tickContribB = style.showTicks ? style.tickSize * 1.2 : 0;
  const titleTop = style.showTitle ? 20 + style.titleSize * 1.5 : 20;
  return {
    l: Math.round(40 + labelContrib + tickContribL),
    r: 20,
    // hintTop reserves a top band for the gesture hint + modebar so the plotted
    // curves don't rise into them; take whichever is taller (title vs hint band).
    t: Math.round(Math.max(titleTop, hintTop)),
    b: Math.round(30 + labelContrib + tickContribB),
  };
}

/** Compact margins for sub-plots (MeltDerivMini). */
function computeMiniMargins(style: ReturnType<typeof usePlotStyle>) {
  const labelContrib = style.showLabels ? style.labelSize * 1.2 : 0;
  const tickContribL = style.showTicks ? style.tickSize * 1.5 : 0;
  const tickContribB = style.showTicks ? style.tickSize : 0;
  return {
    l: Math.round(30 + labelContrib + tickContribL),
    r: 10,
    t: 10,
    b: Math.round(20 + labelContrib + tickContribB),
  };
}

/** Build a {groupKey → Plotly legendrank} lookup. Groups listed in
 *  `legendOrder` get sequential ranks starting at 10; groups not in the
 *  order array fall back to 1000 (Plotly's default) so they land after
 *  the explicitly-ranked entries in natural order. */
function buildLegendRanks(legendOrder: string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  legendOrder.forEach((key, i) => ranks.set(key, 10 + i));
  return ranks;
}

function legendLayout(style: ReturnType<typeof usePlotStyle>, showForPlot?: boolean, traces?: Data[], isDark = false) {
  const show = showForPlot ?? true;
  let pos: { x: number; y: number; xanchor: string; yanchor: string };
  if (style.legendPosition === 'best' && traces && traces.length > 0) {
    pos = bestLegendPosition(traces);
  } else {
    pos = LEGEND_POS_MAP[style.legendPosition] ?? CORNER_CANDIDATES[0];
  }
  return {
    showlegend: style.showLegend && show,
    legend: {
      font: { family: style.fontFamily, size: style.legendSize },
      x: pos.x, y: pos.y,
      xanchor: pos.xanchor as 'left' | 'right' | 'center',
      yanchor: pos.yanchor as 'top' | 'bottom' | 'middle',
      // Opaque background + faint border so the legend reads as a
      // distinct box over dense traces instead of blending into them.
      bgcolor: isDark ? '#1f1f1f' : '#ffffff',
      bordercolor: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
      borderwidth: 1,
      // Default is 10px between legendgroups. Since every trace carries
      // its own `legendgroup`, that gap gets inserted between every
      // entry — collapse it.
      tracegroupgap: 0,
    },
  };
}

function gridStyle(style: ReturnType<typeof usePlotStyle>, isDark = false) {
  const base = isDark ? '255,255,255' : '0,0,0';
  return { showgrid: style.showGrid, gridcolor: `rgba(${base},${style.gridAlpha})` };
}

/** Global Plotly font color — explicit user override wins over theme. */
function plotFontColor(isDark: boolean, textColor: 'auto' | 'black' | 'white' = 'auto') {
  if (textColor === 'black') return '#000000';
  if (textColor === 'white') return '#ffffff';
  return isDark ? 'rgba(255,255,255,0.87)' : '#212224';
}

/**
 * 2D segment–segment intersection.
 * Returns the parameter `t` along segment A (0=start, 1=end) at the
 * intersection with segment B, or null if no intersection.
 */
function segmentIntersectT(
  ax0: number, ay0: number, ax1: number, ay1: number,
  bx0: number, by0: number, bx1: number, by1: number,
): number | null {
  const dax = ax1 - ax0, day = ay1 - ay0;
  const dbx = bx1 - bx0, dby = by1 - by0;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((bx0 - ax0) * dby - (by0 - ay0) * dbx) / denom;
  const u = ((bx0 - ax0) * day - (by0 - ay0) * dax) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t;
  return null;
}

/** Resolved per-curve colour + line width: a per-curve override (right-click /
 *  quick-style menu on the selected curve) wins over the per-well override. */
/**
 * Compute per-well legend info for a given `legendContent` mode.
 *
 * Returns a map: well -> { name, group, isLegendRep }
 *   - `name` is what Plotly shows as the trace name in the legend
 *   - `group` is the Plotly `legendgroup` key (so all members share a row
 *     visually, even though we disable legend-click)
 *   - `isLegendRep` is true for exactly one well per legend-group — the
 *     one that carries `showlegend: true`. In visible-only mode, the
 *     representative is the first selected well in the group; otherwise
 *     the first visible well in the group. If no trace in a group is
 *     selected and visible-only is on, no rep is assigned (→ group has
 *     no legend entry).
 *
 * For `legendContent === 'group'`, wells that are NOT in any group each
 * get their own single-member legend-group keyed by the well name (so
 * they still show up as individual entries in the legend).
 */
/**
 * Curve-aware legend info, keyed by **curveKey** (`well channel`). Returns one
 * `{ name, group, isLegendRep }` per rendered `(well, channel)` curve.
 *
 * - **Multichannel** (`multiChannel`, i.e. >1 channel visible): one legend entry
 *   per **S-C pair**. In sample/well mode the label is `<sample|well> · <fluor>`
 *   and the legendgroup is `curve:<key>` (each curve is its own entry). In group
 *   mode, curves sharing an *effective* group (`curveGroups[key] ?? wellGroups[well]`)
 *   collapse to one `grp:<name>` entry; ungrouped curves still show per S-C pair.
 * - **Single channel** (one visible channel): the legacy one-entry-per-well
 *   behaviour, no fluorophore suffix — `legendContent` picks the name.
 * - Curve groups are honoured **only in group mode**, so a curve-group name never
 *   leaks into a sample/well legend.
 * - Exactly one curve per legendgroup is the `isLegendRep` (carries `showlegend`),
 *   chosen in render order — preferring a selected curve when visible-only is on.
 */
function computeCurveLegendInfo(
  renderedPairs: { well: string; channel: string }[],
  curveGroups: Map<string, string>,
  wellGroups: Map<string, string>,
  experimentWells: Record<string, { sample: string }> | undefined,
  selectedCurves: Set<string>,
  legendContent: 'well' | 'sample' | 'group',
  legendVisibleOnly: boolean,
  multiChannel: boolean,
  fluorOf: (channel: string) => string,
): Map<string, { name: string; group: string; isLegendRep: boolean }> {
  const info = new Map<string, { name: string; group: string; isLegendRep: boolean }>();

  for (const { well, channel } of renderedPairs) {
    const key = curveKey(well, channel);
    const sample = experimentWells?.[well]?.sample ?? well;
    let name: string;
    let group: string;
    if (legendContent === 'group') {
      const g = curveGroups.get(key) ?? wellGroups.get(well);
      if (g) { name = g; group = `grp:${g}`; }
      else if (multiChannel) { name = `${sample} · ${fluorOf(channel)}`; group = `curve:${key}`; }
      else { name = sample; group = `well:${well}`; }
    } else {
      const base = legendContent === 'well' ? well : sample;
      if (multiChannel) { name = `${base} · ${fluorOf(channel)}`; group = `curve:${key}`; }
      else { name = base; group = `well:${well}`; }
    }
    info.set(key, { name, group, isLegendRep: false });
  }

  // Pick one representative curve per group, in render order. Visible-only mode
  // restricts reps to selected curves (so an all-unselected group → no entry).
  const repPicked = new Set<string>();
  const hasSelection = selectedCurves.size > 0;
  const isSelected = (key: string) => !hasSelection || selectedCurves.has(key);
  for (const { well, channel } of renderedPairs) {
    const key = curveKey(well, channel);
    const entry = info.get(key)!;
    if (repPicked.has(entry.group)) continue;
    if (legendVisibleOnly && !isSelected(key)) continue;
    entry.isLegendRep = true;
    repPicked.add(entry.group);
  }

  return info;
}

/**
 * Compute a color map for wells that respects grouping and Tt ordering.
 * - When threshold is enabled, palette is assigned in ascending Tt order (v1 parity).
 * - Groups are sorted by mean Tt; ungrouped wells by individual Tt.
 * - Wells/groups with no Tt are placed at the end.
 * - Per-well style overrides take highest priority.
 * - paletteReversed flips the color assignment order.
 */
function useGroupedColors(
  _wellsUsed: string[],
  visibleWells: string[],
  paletteName: string,
  wellGroups: Map<string, string>,
  wellStyleOverrides: Map<string, unknown>,
  analysisResults?: Map<string, { tt?: number | null }>,
  paletteReversed?: boolean,
  groupColors?: boolean,
): Map<string, string> {
  return useMemo(
    () => buildColorMap(
      visibleWells,
      (n) => getPaletteColors(paletteName, n),
      wellGroups, wellStyleOverrides, analysisResults, paletteReversed, groupColors,
    ),
    [visibleWells, paletteName, wellGroups, wellStyleOverrides, analysisResults, paletteReversed, groupColors],
  );
}

/** Effective per-well group for `channel`: the curve's group (keyed by curveKey)
 *  wins over a legacy well group. Grouping writes `curveGroups` since the
 *  curve-centric migration (#45), so the live colour map must resolve through it
 *  or grouped wells never share a colour. */
function effectiveWellGroups(
  wells: string[],
  channel: string,
  curveGroups: Map<string, string>,
  wellGroups: Map<string, string>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const w of wells) {
    const g = curveGroups.get(curveKey(w, channel)) ?? wellGroups.get(w);
    if (g) m.set(w, g);
  }
  return m;
}

// ── Auto-scale freeze ────────────────────────────────────────────────
type AxisRange = [number, number];
interface FrozenRanges { x: AxisRange | null; y: AxisRange | null; y2?: AxisRange | null; }

/** Read the plot's current axis ranges off Plotly's `_fullLayout`. */
function readPlotRanges(container: HTMLElement | null): FrozenRanges | null {
  const div = container?.querySelector('.js-plotly-plot') as (HTMLElement & { _fullLayout?: Record<string, { range?: number[] }> }) | null;
  const fl = div?._fullLayout;
  if (!fl) return null;
  const r = (ax?: { range?: number[] }): AxisRange | null =>
    (ax?.range && ax.range.length === 2 ? [ax.range[0], ax.range[1]] : null);
  return { x: r(fl.xaxis), y: r(fl.yaxis), y2: r(fl.yaxis2) };
}

/** Layout axis props to pin an explicit range (autorange off) when frozen, so
 *  a data change (e.g. toggling a channel) can't re-autorange. Empty when not
 *  frozen → Plotly's default autorange (today's behaviour). */
function rangeProps(r: AxisRange | null | undefined, frozen: boolean): Record<string, unknown> {
  return frozen && r ? { range: [r[0], r[1]], autorange: false } : {};
}

/** Per-channel color maps: `Map<channel, Map<well, color>>`.
 *  - `useRamps` (multichannel view of a >1-channel experiment): each channel
 *    gets a monochrome ramp in its representative colour, with that channel's
 *    own Tt ordering. Keyed on the experiment being multichannel (not the
 *    visible count), so hiding a channel doesn't snap the rest back to palette.
 *  - Otherwise (single-channel view, or a single-channel experiment): every
 *    channel reuses the shared SHARP palette `colorMap` (v0.1.x look).
 *  Per-well colour overrides are applied last inside `buildColorMap`. */
function useChannelColorMaps(
  visibleChannelList: string[],
  visibleWells: string[],
  useRamps: boolean,
  paletteReversed: boolean,
  groupColors: boolean,
  wellGroups: Map<string, string>,
  wellStyleOverrides: Map<string, unknown>,
  allChannelResults: Map<string, Map<string, { tt?: number | null }>>,
  sharedColorMap: Map<string, string>,
  channelColors: Map<string, string>,
  channelLabels: Map<string, string>,
  channelFluorophore: Record<string, string> | undefined,
): Map<string, Map<string, string>> {
  return useMemo(() => {
    const out = new Map<string, Map<string, string>>();
    for (const ch of visibleChannelList) {
      if (useRamps) {
        const rep = effectiveChannelColor(ch, channelColors, channelLabels, channelFluorophore);
        const results = allChannelResults.get(ch);
        out.set(ch, buildColorMap(
          visibleWells, (n) => monochromeRamp(rep, n),
          wellGroups, wellStyleOverrides, results, paletteReversed, groupColors,
        ));
      } else {
        out.set(ch, sharedColorMap);
      }
    }
    return out;
  }, [visibleChannelList, visibleWells, useRamps, paletteReversed, groupColors,
      wellGroups, wellStyleOverrides, allChannelResults, sharedColorMap,
      channelColors, channelLabels, channelFluorophore]);
}

/** Dash for a (well, channel) curve. Precedence: per-curve lineStyle override →
 *  per-well lineStyle override (right-click / quick-style menu) → per-channel
 *  line-style (set by "Separate by line style" or the Style tab) → solid. */
function resolveDash(
  well: string,
  ch: string,
  curveStyleOverrides: Map<string, unknown>,
  wellStyleOverrides: Map<string, unknown>,
  channelLineStyles: Map<string, string>,
): string {
  const perCurve = (curveStyleOverrides.get(curveKey(well, ch)) as { lineStyle?: string } | undefined)?.lineStyle;
  if (perCurve) return perCurve;
  const perWell = (wellStyleOverrides.get(well) as { lineStyle?: string } | undefined)?.lineStyle;
  if (perWell) return perWell;
  return channelLineStyles.get(ch) ?? 'solid';
}

// ── Middle-mouse-button pan hook ─────────────────────────────────────
/** Attach Plotly legend hover/unhover events to set hoveredWell. The resolver
 *  maps a Plotly curveNumber to a well (or null for non-well legend entries
 *  like the per-channel markers); kept in a ref so the effect needn't re-bind. */
function useLegendHover(
  containerRef: React.RefObject<HTMLDivElement | null>,
  resolveWell: (curveNumber: number) => string | null,
  setHoveredWell: (well: string | null) => void,
) {
  const resolveRef = useRef(resolveWell);
  resolveRef.current = resolveWell;
  useEffect(() => {
    const el = containerRef.current?.querySelector('.js-plotly-plot') as any;
    if (!el?.on) return;
    const onHover = (e: any) => {
      const well = resolveRef.current(e.curveNumber ?? 0);
      if (well) setHoveredWell(well);
    };
    const onUnhover = () => setHoveredWell(null);
    el.on('plotly_legendhover', onHover);
    el.on('plotly_legendunhover', onUnhover);
    return () => {
      el.removeAllListeners?.('plotly_legendhover');
      el.removeAllListeners?.('plotly_legendunhover');
    };
  }, [containerRef, setHoveredWell]);
}

function useMiddleMousePan(containerRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let panning = false;
    let startX = 0, startY = 0;
    let startXRange: [number, number] | null = null;
    let startYRange: [number, number] | null = null;

    const getPlotDiv = () => el.querySelector('.js-plotly-plot') as (HTMLElement & { layout?: Record<string, unknown>; _fullLayout?: Record<string, unknown> }) | null;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 1) return; // MMB only
      const gd = getPlotDiv();
      if (!gd?._fullLayout) return;
      e.preventDefault();
      panning = true;
      startX = e.clientX;
      startY = e.clientY;
      const fl = gd._fullLayout as Record<string, { range?: [number, number] }>;
      startXRange = fl.xaxis?.range ? [...fl.xaxis.range] as [number, number] : null;
      startYRange = fl.yaxis?.range ? [...fl.yaxis.range] as [number, number] : null;
      document.body.style.cursor = 'grabbing';
    };

    const onMove = (e: MouseEvent) => {
      if (!panning || !startXRange || !startYRange) return;
      const gd = getPlotDiv();
      if (!gd?._fullLayout) return;
      const fl = gd._fullLayout as Record<string, { _length?: number }>;
      const plotWidth = fl.xaxis?._length || 1;
      const plotHeight = fl.yaxis?._length || 1;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const xSpan = startXRange[1] - startXRange[0];
      const ySpan = startYRange[1] - startYRange[0];
      const xShift = -(dx / plotWidth) * xSpan;
      const yShift = (dy / plotHeight) * ySpan;
      Plotly.relayout(gd as unknown as Plotly.Root, {
        'xaxis.range[0]': startXRange[0] + xShift,
        'xaxis.range[1]': startXRange[1] + xShift,
        'yaxis.range[0]': startYRange[0] + yShift,
        'yaxis.range[1]': startYRange[1] + yShift,
      });
    };

    const onUp = (e: MouseEvent) => {
      if (e.button !== 1) return;
      panning = false;
      document.body.style.cursor = '';
    };

    el.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    // Prevent default MMB scroll/auto-scroll
    const preventDefault = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
    el.addEventListener('auxclick', preventDefault);

    return () => {
      el.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      el.removeEventListener('auxclick', preventDefault);
    };
  }, [containerRef]);
}

// Plot config: scroll zoom + reset ("house") button only, logo hidden so the
// house is the sole, rightmost modebar control (the gesture hint sits to its left)
const PLOT_CONFIG: Partial<Plotly.Config> = {
  responsive: true,
  displayModeBar: true,
  displaylogo: false,
  scrollZoom: true,
  editable: false,
  modeBarButtonsToRemove: [
    'zoom2d', 'pan2d', 'select2d', 'lasso2d',
    'zoomIn2d', 'zoomOut2d', 'autoScale2d',
    'toImage',
  ] as Plotly.ModeBarDefaultButtons[],
};

// ── Plot hint overlay (subtle top-right text, beside the modebar) ────

/** Tiny top-down mouse glyph with one button (or wheel) highlighted. */
function MouseIcon({ side }: { side: 'L' | 'M' | 'R' }) {
  const HL = 'rgb(170,32,38)';  // brand red
  return (
    <svg width="11" height="13" viewBox="0 0 11 13"
         style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 2 }}>
      {/* body */}
      <rect x="0.6" y="0.6" width="9.8" height="11.8" rx="4.6" ry="4.6"
            fill="none" stroke="currentColor" strokeWidth="0.7" strokeOpacity="0.55"/>
      {/* L button */}
      <rect x="1.5" y="1.4" width="3.0" height="2.8" rx="0.8"
            fill={side === 'L' ? HL : 'none'}
            stroke={side === 'L' ? HL : 'currentColor'}
            strokeOpacity={side === 'L' ? 0.9 : 0.45}
            strokeWidth="0.6"/>
      {/* R button */}
      <rect x="6.5" y="1.4" width="3.0" height="2.8" rx="0.8"
            fill={side === 'R' ? HL : 'none'}
            stroke={side === 'R' ? HL : 'currentColor'}
            strokeOpacity={side === 'R' ? 0.9 : 0.45}
            strokeWidth="0.6"/>
      {/* Wheel (middle) */}
      <rect x="4.7" y="1.6" width="1.6" height="2.4" rx="0.6"
            fill={side === 'M' ? HL : 'none'}
            stroke={side === 'M' ? HL : 'currentColor'}
            strokeOpacity={side === 'M' ? 0.9 : 0.5}
            strokeWidth="0.5"/>
    </svg>
  );
}

// Top band (px) reserved by computeMargins so the gesture hint + modebar clear
// the plotted curves (the hint sits in this band, above the plotting area).
const HINT_TOP_RESERVE = 28;

const PLOT_HINT_STYLE: React.CSSProperties = {
  // Top-right, just left of the Plotly modebar's reset ("house") button.
  // Rendered at its natural size (~ the house icon), not plot-scaled.
  position: 'absolute', top: 4, right: 34,
  fontSize: 10, color: 'rgba(120,120,120,0.7)',
  pointerEvents: 'none', userSelect: 'none',
  zIndex: 5, whiteSpace: 'nowrap', lineHeight: 1,
  padding: '2px 5px', borderRadius: 5,
};

function PlotHint({ isDark = false, containerRef }: {
  isDark?: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Sit just left of the Plotly modebar by measuring the modebar's ACTUAL width
  // (Plotly builds it asynchronously, so retry until it appears), instead of
  // guessing a fixed offset — this keeps the reset ("house") button clear no
  // matter how wide the modebar renders.
  const [right, setRight] = useState(34);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0, tries = 0;
    const measure = () => {
      const mb = el.querySelector('.modebar') as HTMLElement | null;
      if (mb && mb.offsetWidth > 0) setRight(mb.offsetWidth + 14);
      else if (tries++ < 90) raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [containerRef]);

  // A translucent chip backdrop keeps the text legible as a backstop near the top.
  const style: React.CSSProperties = {
    ...PLOT_HINT_STYLE,
    right,
    backgroundColor: isDark ? 'rgba(28,28,30,0.72)' : 'rgba(250,250,250,0.8)',
    backdropFilter: 'blur(2px)',
    WebkitBackdropFilter: 'blur(2px)',
  };
  return (
    <div style={style}>
      <MouseIcon side="L" />drag: select  ·  <MouseIcon side="M" />drag: pan  ·  <MouseIcon side="M" />scroll: zoom  ·  <MouseIcon side="R" />drag: resize  ·  2× <MouseIcon side="R" />click: reset
    </div>
  );
}

// ── Amplification Plot ───────────────────────────────────────────────

function AmplificationPlot({ openContextMenu }: { openContextMenu: (x: number, y: number) => void }) {
  const { plotBg, isDark, textColor } = usePlotTheme();
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const logScale = useAppState((s) => s.logScale);
  const selectedCurves = useAppState((s) => s.selectedCurves);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const deactivatedWells = useAppState((s) => s.deactivatedWells);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const curveStyleOverrides = useAppState((s) => s.curveStyleOverrides);
  const curveGroups = useAppState((s) => s.curveGroups);
  const setSelectedCurves = useAppState((s) => s.setSelectedCurves);
  const selectCurvesOnly = useAppState((s) => s.selectCurvesOnly);
  const deselectAll = useAppState((s) => s.deselectAll);
  const toggleCurves = useAppState((s) => s.toggleCurves);
  const hoveredWell = useAppState((s) => s.hoveredWell);
  const setHoveredWell = useAppState((s) => s.setHoveredWell);
  const paletteArrowMode = useAppState((s) => s.paletteArrowMode);
  const paletteArrowChannel = useAppState((s) => s.paletteArrowChannel);
  const setPaletteArrowMode = useAppState((s) => s.setPaletteArrowMode);
  const setCurveStyleOverride = useAppState((s) => s.setCurveStyleOverride);
  const baselineEnabled = useAppState((s) => s.baselineEnabled);
  const baselineAuto = useAppState((s) => s.baselineAuto);
  const baselineStart = useAppState((s) => s.baselineStart);
  const baselineEnd = useAppState((s) => s.baselineEnd);
  const wellBaselineOverrides = useAppState((s) => s.wellBaselineOverrides);
  const normalizeEnabled = useAppState((s) => s.normalizeEnabled);
  const driftCorrectionEnabled = useAppState((s) => s.driftCorrectionEnabled);
  const showRawOverlay = useAppState((s) => s.showRawOverlay);
  const thresholdEnabled = useAppState((s) => s.thresholdEnabled);
  const thresholdRfu = useAppState((s) => s.thresholdRfu);
  const setThresholdRfu = useAppState((s) => s.setThresholdRfu);
  const [frozenRanges, setFrozenRanges] = useState<FrozenRanges | null>(null);
  const showLegendAmp = useAppState((s) => s.showLegendAmp);
  const legendContent = useAppState((s) => s.legendContent);
  const legendVisibleOnly = useAppState((s) => s.legendVisibleOnly);
  const legendOrder = useAppState((s) => s.legendOrder);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const paletteGroupColors = useAppState((s) => s.paletteGroupColors);
  const visibleChannels = useAppState((s) => s.visibleChannels);
  const channelLabels = useAppState((s) => s.channelLabels);
  const channelColors = useAppState((s) => s.channelColors);
  const viewMode = useAppState((s) => s.viewMode);
  const activeChannel = useAppState((s) => s.activeChannel);
  const channelLineStyles = useAppState((s) => s.channelLineStyles);
  const wellChannelHidden = useAppState((s) => s.wellChannelHidden);
  const autoScale = useAppState((s) => s.autoScale);
  const autoScalePulse = useAppState((s) => s._autoScalePulse);
  const style = usePlotStyle();
  const sizeRef = useRef<HTMLDivElement | null>(null);
  const fontScale = usePlotFontScale(sizeRef);
  const sstyle = useScaledStyle(style, fontScale);
  const analysisResults = useAnalysisResults();
  const allChannelResults = useAllChannelResults();
  const dragPreviewCurves = useAppState((s) => s.dragPreviewCurves);
  const setDragPreviewCurves = useAppState((s) => s.setDragPreviewCurves);

  const wellGroups = useAppState((s) => s.wellGroups);

  const exp = experiments[idx];
  const amp = exp?.amplification;

  // Single view → just the active channel (simple v0.1.x look); multi view →
  // every globally-enabled channel.
  const visibleChannelList = useMemo(
    () => (viewMode === 'single'
      ? (exp?.channels.includes(activeChannel) ? [activeChannel] : (exp?.channels.slice(0, 1) ?? []))
      : (exp?.channels ?? []).filter((c) => visibleChannels.has(c))),
    [exp, visibleChannels, viewMode, activeChannel],
  );
  const multiChannel = visibleChannelList.length > 1;
  // Per-channel colour ramps only in the multichannel view of a >1-channel
  // experiment; otherwise the shared SHARP palette (v0.1.x look).
  const useRamps = viewMode === 'multi' && (exp?.channels.length ?? 0) > 1;

  const visibleWells = useMemo(() => {
    if (!exp) return [];
    return exp.wellsUsed.filter((w) => !hiddenWells.has(w) && !deactivatedWells.has(w));
  }, [exp, hiddenWells, deactivatedWells]);

  // Colours are assigned over the experiment's ACTIVE wells (everything except
  // deactivated/empty ones) — NOT the currently-visible subset. `buildColorMap`
  // divides the palette among *units*, so keying it to visibility would resplit
  // the palette and recolour every curve whenever a well is hidden or shown.
  // Stable by construction; re-spreading is an explicit act (Style → Apply).
  const colorWells = useMemo(
    () => (exp ? exp.wellsUsed.filter((w) => !deactivatedWells.has(w)) : []),
    [exp, deactivatedWells],
  );
  // Effective groups (curve group wins over legacy well group). Grouped wells
  // share one colour: group whenever groups exist (or the "Group colors" toggle
  // is on) — resolved through `curveGroups` so grouping recolours live.
  const groupMap = useMemo(
    () => effectiveWellGroups(colorWells, activeChannel, curveGroups, wellGroups),
    [colorWells, activeChannel, curveGroups, wellGroups],
  );
  const groupColorsOn = paletteGroupColors || groupMap.size > 0;
  const colorMap = useGroupedColors(
    exp?.wellsUsed ?? [], colorWells, style.palette, groupMap, wellStyleOverrides,
    analysisResults as Map<string, { tt?: number | null }>, paletteReversed,
    groupColorsOn
  );

  const channelColorMaps = useChannelColorMaps(
    visibleChannelList, colorWells, useRamps, paletteReversed, groupColorsOn,
    groupMap, wellStyleOverrides,
    allChannelResults as Map<string, Map<string, { tt?: number | null }>>,
    colorMap, channelColors, channelLabels, exp?.channelFluorophore,
  );

  const legendRanks = useMemo(() => buildLegendRanks(legendOrder), [legendOrder]);

  // Ordered list of the (well, channel) pairs actually rendered as curves —
  // drives curveNumber → (well, channel) resolution for click / hover / legend.
  const renderedPairs = useMemo(() => {
    const pairs: { well: string; channel: string }[] = [];
    for (const ch of visibleChannelList) {
      if (!exp?.amplificationByChannel[ch]) continue;
      for (const well of visibleWells) {
        if (wellChannelHidden.get(well)?.has(ch)) continue;
        pairs.push({ well, channel: ch });
      }
    }
    return pairs;
  }, [exp, visibleChannelList, visibleWells, wellChannelHidden]);

  const legendInfo = useMemo(
    () => computeCurveLegendInfo(renderedPairs, curveGroups, wellGroups, exp?.wells, selectedCurves, legendContent, legendVisibleOnly, multiChannel, (ch) => effectiveChannelLabel(ch, channelLabels, exp?.channelFluorophore)),
    [renderedPairs, curveGroups, wellGroups, exp, selectedCurves, legendContent, legendVisibleOnly, multiChannel, channelLabels]
  );

  // Raw overlay is added (over all visible wells) only when exactly one channel
  // is visible, so its trace count stays regular for curveNumber math.
  const singleVisibleChannel = visibleChannelList.length === 1 ? visibleChannelList[0] : null;
  const rawOverlayCount =
    (singleVisibleChannel && baselineEnabled && showRawOverlay && !normalizeEnabled)
      ? visibleWells.length : 0;

  const dash6 = (d: string | undefined) => d as 'solid' | 'dash' | 'dot' | 'dashdot' | 'longdash' | 'longdashdot' | undefined;
  const landmarks = useAppState((s) => s.landmarks);
  const allChannelLandmarks = useAllChannelLandmarks();

  const traces = useMemo((): Data[] => {
    if (visibleChannelList.length === 0) return [];
    const result: Data[] = [];
    // Kinetic-landmark points, collected across curves then emitted as one
    // marker trace per landmark type (t_lod / t_onset10 / inflection), placed on
    // the displayed curve. Toggled in Analysis → Kinetics.
    const anyLandmark = landmarks.lod || landmarks.onset || landmarks.infl;
    const lodX: number[] = [], lodY: number[] = [], lodC: string[] = [];
    const onsX: number[] = [], onsY: number[] = [], onsC: string[] = [];
    const infX: number[] = [], infY: number[] = [], infC: string[] = [];
    const pointAtSec = (tSec: number | null, cAmp: { timeS: number[] }, cX: number[], yD: number[]): { x: number; y: number } | null => {
      if (tSec == null || !Number.isFinite(tSec)) return null;
      const ts = cAmp.timeS;
      const n = Math.min(ts?.length ?? 0, cX.length, yD.length);
      if (n < 2) return null;
      if (tSec <= ts[0]) return { x: cX[0], y: yD[0] };
      if (tSec >= ts[n - 1]) return { x: cX[n - 1], y: yD[n - 1] };
      for (let i = 1; i < n; i++) {
        if (ts[i] >= tSec) {
          const d = ts[i] - ts[i - 1];
          const f = d ? (tSec - ts[i - 1]) / d : 0;
          return { x: cX[i - 1] + f * (cX[i] - cX[i - 1]), y: yD[i - 1] + f * (yD[i] - yD[i - 1]) };
        }
      }
      return { x: cX[n - 1], y: yD[n - 1] };
    };
    const pushLm = (tSec: number | null, X: number[], Y: number[], C: string[], col: string, cAmp: { timeS: number[] }, cX: number[], yD: number[]) => {
      const p = pointAtSec(tSec, cAmp, cX, yD);
      if (p) { X.push(p.x); Y.push(p.y); C.push(col); }
    };
    // Show the "| fluorophore" hover suffix only when ≥2 channels overlay; a
    // single visible channel (including every single-dye file, whose channel
    // is named e.g. 'SYBR' rather than 'default') stays sample-only, matching
    // the pre-multichannel hover and the melt/derivative plots.
    const showFluor = multiChannel;
    // One legend entry per sample/group, emitted on the FIRST channel where its
    // representative well actually renders — so a rep hidden on the first
    // channel (but shown on a later one) doesn't drop the entry.
    const emittedLegend = new Set<string>();

    // Raw overlay (raw-RFU units) — single-visible-channel case only.
    if (singleVisibleChannel && baselineEnabled && showRawOverlay && !normalizeEnabled) {
      const chAmp = exp?.amplificationByChannel[singleVisibleChannel];
      if (chAmp) {
        const xRaw = xAxisMode === 'cycle' ? chAmp.cycle : xAxisMode === 'time_s' ? chAmp.timeS : chAmp.timeMin;
        for (const well of visibleWells) {
          const color = colorMap.get(well) ?? '#999';
          result.push({
            x: xRaw, y: chAmp.wells[well],
            type: 'scatter' as const, mode: 'lines' as const, name: `${well} (raw)`,
            line: { color, width: style.lineWidth * 0.5, dash: 'dot' },
            opacity: 0.3, hoverinfo: 'skip' as const, showlegend: false,
          });
        }
      }
    }

    for (let ci = 0; ci < visibleChannelList.length; ci++) {
      const ch = visibleChannelList[ci];
      const chAmp = exp?.amplificationByChannel[ch];
      if (!chAmp) continue;
      const chX = xAxisMode === 'cycle' ? chAmp.cycle : xAxisMode === 'time_s' ? chAmp.timeS : chAmp.timeMin;
      const chResults = allChannelResults.get(ch);
      const fluorLabel = effectiveChannelLabel(ch, channelLabels, exp?.channelFluorophore);
      for (const well of visibleWells) {
        if (wellChannelHidden.get(well)?.has(ch)) continue;
        const key = curveKey(well, ch);
        const cw = resolveCurveColorWidth(well, ch, curveStyleOverrides, wellStyleOverrides);
        const color = cw.color ?? channelColorMaps.get(ch)?.get(well) ?? colorMap.get(well) ?? '#999';
        const isSelected = selectedCurves.size === 0 || selectedCurves.has(key);
        const isHovered = hoveredWell === well;
        const isDragHighlighted = dragPreviewCurves ? dragPreviewCurves.has(key) : null;
        const r = chResults?.get(well);
        const yData = r?.displayRfu ?? chAmp.wells[well];
        const li = legendInfo.get(key)!;

        let lineWidth = cw.width ?? (isSelected ? style.lineWidth : style.lineWidth * 0.6);
        let opacity = isSelected ? 1.0 : 0.25;
        if (isDragHighlighted === true) { lineWidth = style.lineWidth * 1.4; opacity = 1.0; }
        else if (isDragHighlighted === false) { opacity = 0.15; }
        if (isHovered) { lineWidth = Math.max(lineWidth, style.lineWidth * 1.6); }

        const showLegAmp = li.isLegendRep && !emittedLegend.has(li.group);
        if (showLegAmp) emittedLegend.add(li.group);

        result.push({
          x: chX, y: yData,
          type: 'scatter' as const, mode: 'lines' as const, name: li.name,
          legendgroup: li.group,
          legendrank: legendRanks.get(li.group) ?? 1000,
          line: {
            color,
            width: lineWidth,
            dash: dash6(resolveDash(well, ch, curveStyleOverrides, wellStyleOverrides, channelLineStyles)),
          },
          opacity,
          hovertext: showFluor ? `${exp?.wells[well]?.sample ?? well} | ${fluorLabel}` : li.name,
          hoverinfo: 'text' as const,
          showlegend: showLegAmp,
        });

        // Kinetic landmark markers on the displayed curve (Analysis → Kinetics),
        // only for emphasized (selected) curves; collected here, emitted below.
        if (isSelected && anyLandmark) {
          const lm = allChannelLandmarks.get(ch)?.get(well);
          if (lm) {
            if (landmarks.lod) pushLm(lm.tLod, lodX, lodY, lodC, color, chAmp, chX, yData);
            if (landmarks.onset) pushLm(lm.tOnset10, onsX, onsY, onsC, color, chAmp, chX, yData);
            if (landmarks.infl) pushLm(lm.inflectionT, infX, infY, infC, color, chAmp, chX, yData);
          }
        }
      }
    }
    // (Channels are keyed by the FAM/HEX toggles in the plot-tabs bar, so no
    // separate per-channel legend block is added here.)
    // Landmark legend entries at the END of the legend (high legendrank).
    const lmTrace = (x: number[], y: number[], c: string[], sym: string, name: string, rank: number): Data => ({
      x, y, type: 'scatter' as const, mode: 'markers' as const, name,
      legendgroup: `lm:${name}`, legendrank: rank,
      marker: { symbol: sym, size: 9, color: c, line: { color: isDark ? '#000' : '#fff', width: 1 } },
      hoverinfo: 'skip' as const, showlegend: showLegendAmp,
    } as Data);
    if (landmarks.lod && lodX.length) result.push(lmTrace(lodX, lodY, lodC, 'triangle-up', 't_lod', 10001));
    if (landmarks.onset && onsX.length) result.push(lmTrace(onsX, onsY, onsC, 'diamond', 't_onset10', 10002));
    if (landmarks.infl && infX.length) result.push(lmTrace(infX, infY, infC, 'circle', 'inflection', 10003));
    return result;
  }, [exp, xAxisMode, selectedCurves, style.lineWidth, visibleWells, visibleChannelList, multiChannel,
      singleVisibleChannel, baselineEnabled, normalizeEnabled, showRawOverlay, allChannelResults,
      wellChannelHidden, channelLabels, channelColors, channelLineStyles,
      wellStyleOverrides, curveStyleOverrides, colorMap, channelColorMaps, hoveredWell, dragPreviewCurves,
      legendInfo, legendRanks, showLegendAmp, isDark, landmarks, allChannelLandmarks]);

  // Compute baseline zone x-axis boundaries. Only shown when at least one
  // visible well is in manual baseline mode (auto mode uses per-well windows,
  // so a single shaded zone wouldn't represent anything meaningful).
  const baselineZoneBounds = useMemo(() => {
    if (!baselineEnabled || !amp) return null;
    // Are there any visible wells using manual baseline?
    const anyManual = visibleWells.some((w) => {
      const ov = wellBaselineOverrides.get(w);
      const effectiveAuto = ov?.auto ?? baselineAuto;
      return !effectiveAuto;
    });
    if (!anyManual) return null;

    const cycle = amp.cycle;
    if (!cycle || cycle.length === 0) return null;
    const xData = xAxisMode === 'cycle' ? cycle : xAxisMode === 'time_s' ? amp.timeS : amp.timeMin;
    // baseline start/end are cycle numbers; find corresponding x values
    const startIdx = Math.max(0, baselineStart - 1); // cycles are 1-based
    const endIdx = Math.min(cycle.length - 1, baselineEnd - 1);
    if (startIdx >= xData.length || endIdx < 0) return null;
    return { x0: xData[startIdx], x1: xData[endIdx] };
  }, [baselineEnabled, amp, xAxisMode, baselineStart, baselineEnd, baselineAuto, wellBaselineOverrides, visibleWells]);

  const frozen = !autoScale && frozenRanges != null;

  // Plotly `datarevision`: bump ONLY when the plotted x/y data could change
  // (experiment, x-axis unit, or recomputed analysis results). Hover,
  // selection, palette, legend and other styling changes keep the same
  // revision so Plotly applies a cheap style diff instead of a full data
  // replot — the difference between janky and smooth on a dense plate.
  const dataRevRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dataRevision = useMemo(() => ++dataRevRef.current, [exp, xAxisMode, allChannelResults, landmarks]);

  const layout = useMemo((): Partial<Layout> => {
    const title = exp?.experimentId ?? 'Amplification Plot';
    const shapes: Partial<Shape>[] = [];

    // Baseline zone shading — hidden when normalized (zone is in cycle/RFU
    // space; the normalized view changes the y-scale meaning).
    if (baselineZoneBounds && !normalizeEnabled) {
      shapes.push({
        type: 'rect',
        x0: baselineZoneBounds.x0, x1: baselineZoneBounds.x1, xref: 'x',
        y0: 0, y1: 1, yref: 'paper',
        fillcolor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
        line: { width: 0 },
        layer: 'below',
      });
    }

    // Threshold line (not Plotly-editable; dragged via custom mouse handler).
    // In raw-RFU units — hidden on the normalized view.
    if (thresholdEnabled && !normalizeEnabled) {
      shapes.push({
        type: 'line', x0: 0, x1: 1, xref: 'paper',
        y0: thresholdRfu, y1: thresholdRfu, yref: 'y',
        line: { color: isDark ? '#ef9a9d' : THRESHOLD_LINE_COLOR, width: 2, dash: 'dash' },
      });
    }
    return {
      title: titleField(title, sstyle),
      xaxis: {
        title: axisLabel(X_AXIS_LABELS[xAxisMode], sstyle),
        ...tickProps(sstyle),
        ...gridStyle(sstyle, isDark),
        ...rangeProps(frozenRanges?.x, frozen),
      },
      yaxis: {
        title: axisLabel(
          normalizeEnabled ? 'Normalized fluorescence' : baselineEnabled ? 'RFU (corrected)' : 'RFU',
          sstyle,
        ),
        type: logScale ? 'log' : 'linear',
        ...tickProps(sstyle),
        ...gridStyle(sstyle, isDark),
        ...rangeProps(frozenRanges?.y, frozen),
      },
      shapes,
      dragmode: false as Layout['dragmode'],
      autosize: true,
      margin: computeMargins(sstyle, HINT_TOP_RESERVE),
      plot_bgcolor: plotBg, paper_bgcolor: plotBg, font: { color: plotFontColor(isDark, textColor) },
      ...legendLayout(sstyle, showLegendAmp, traces, isDark),
      datarevision: dataRevision,
      // Preserve zoom/pan across hover & selection re-renders. With auto-scale
      // on, fold the data-transform signature in so toggling normalization /
      // baseline / drift / log re-fits the axes to the new data; with it off,
      // the revision stays stable so the user's manual view persists.
      uirevision: autoScale
        ? `amp-${exp?.experimentId ?? 'none'}-${xAxisMode}-n${normalizeEnabled ? 1 : 0}b${baselineEnabled ? 1 : 0}l${logScale ? 1 : 0}d${driftCorrectionEnabled ? 1 : 0}`
        : `amp-${exp?.experimentId ?? 'none'}-${xAxisMode}`,
    };
  }, [exp, xAxisMode, logScale, thresholdEnabled, thresholdRfu, sstyle, baselineEnabled, normalizeEnabled, driftCorrectionEnabled, autoScale, frozen, frozenRanges, baselineZoneBounds, showLegendAmp, traces, dataRevision]);

  // Refs for box selection data matching (channel-aware)
  const visibleWellsRef = useRef(visibleWells);
  visibleWellsRef.current = visibleWells;
  const expRef = useRef(exp);
  expRef.current = exp;
  const xAxisModeRef = useRef(xAxisMode);
  xAxisModeRef.current = xAxisMode;
  const visibleChannelListRef = useRef(visibleChannelList);
  visibleChannelListRef.current = visibleChannelList;
  const wellChannelHiddenRef = useRef(wellChannelHidden);
  wellChannelHiddenRef.current = wellChannelHidden;
  const allChannelResultsRef = useRef(allChannelResults);
  allChannelResultsRef.current = allChannelResults;

  const matchWellsInBox = useCallback((x0: number, x1: number, y0: number, y1: number): Set<string> => {
    const currentExp = expRef.current;
    if (!currentExp) return new Set();
    const mode = xAxisModeRef.current;
    const matched = new Set<string>();
    for (const ch of visibleChannelListRef.current) {
      const chAmp = currentExp.amplificationByChannel[ch];
      if (!chAmp) continue;
      const xData = mode === 'cycle' ? chAmp.cycle : mode === 'time_s' ? chAmp.timeS : chAmp.timeMin;
      const chResults = allChannelResultsRef.current.get(ch);
      for (const well of visibleWellsRef.current) {
        if (wellChannelHiddenRef.current.get(well)?.has(ch)) continue;
        const yData = chResults?.get(well)?.displayRfu ?? chAmp.wells[well];
        if (!yData) continue;
        for (let i = 0; i < xData.length; i++) {
          if (xData[i] >= x0 && xData[i] <= x1 && yData[i] >= y0 && yData[i] <= y1) {
            matched.add(curveKey(well, ch));
            break;
          }
        }
      }
    }
    return matched;
  }, []);

  const handleBoxSelect = useCallback((x0: number, x1: number, y0: number, y1: number) => {
    const matched = matchWellsInBox(x0, x1, y0, y1);
    if (matched.size > 0) setSelectedCurves(matched);
  }, [setSelectedCurves, matchWellsInBox]);

  const handleDragMove = useCallback((x0: number, x1: number, y0: number, y1: number) => {
    setDragPreviewCurves(matchWellsInBox(x0, x1, y0, y1));
  }, [matchWellsInBox, setDragPreviewCurves]);

  const handleDragEnd = useCallback(() => setDragPreviewCurves(null), [setDragPreviewCurves]);

  // Palette arrow callback — find the first arrow intersection per visible
  // (well, channel) CURVE across every visible channel, then assign the palette
  // along the arrow. With "Group coloring" on, each effective group (curve group
  // → well group) is ONE colour unit (all its crossed members share a colour),
  // ordered by its earliest crossing; otherwise one colour per S-C pair.
  const handlePaletteArrow = useCallback((ax0: number, ay0: number, ax1: number, ay1: number) => {
    if (!exp) return;
    const hits: Array<{ key: string; well: string; t: number }> = [];
    for (const ch of visibleChannelList) {
      // When armed from a single-channel Style scope, only colour that channel.
      if (paletteArrowChannel && ch !== paletteArrowChannel) continue;
      const chAmp = exp.amplificationByChannel[ch];
      if (!chAmp) continue;
      const xData = xAxisMode === 'cycle' ? chAmp.cycle : xAxisMode === 'time_s' ? chAmp.timeS : chAmp.timeMin;
      const chResults = allChannelResults.get(ch);
      for (const well of visibleWells) {
        if (wellChannelHidden.get(well)?.has(ch)) continue;
        const yData = chResults?.get(well)?.displayRfu ?? chAmp.wells[well];
        if (!yData) continue;
        let firstT: number | null = null;
        for (let i = 0; i < xData.length - 1; i++) {
          const t = segmentIntersectT(ax0, ay0, ax1, ay1, xData[i], yData[i], xData[i + 1], yData[i + 1]);
          if (t !== null && (firstT === null || t < firstT)) firstT = t;
        }
        if (firstT !== null) hits.push({ key: curveKey(well, ch), well, t: firstT });
      }
    }

    if (hits.length === 0) { setPaletteArrowMode(false); return; }

    // Build colour units (group → one shared colour when group coloring is on),
    // ordered by position along the arrow.
    const units: Array<{ t: number; keys: string[] }> = [];
    if (paletteGroupColors) {
      const byGroup = new Map<string, { t: number; keys: string[] }>();
      for (const h of hits) {
        const g = curveGroups.get(h.key) ?? wellGroups.get(h.well);
        if (g) {
          const u = byGroup.get(g);
          if (u) { u.keys.push(h.key); u.t = Math.min(u.t, h.t); }
          else byGroup.set(g, { t: h.t, keys: [h.key] });
        } else {
          units.push({ t: h.t, keys: [h.key] });
        }
      }
      for (const u of byGroup.values()) units.push(u);
    } else {
      for (const h of hits) units.push({ t: h.t, keys: [h.key] });
    }
    units.sort((a, b) => a.t - b.t);

    const colors = getPaletteColors(style.palette, units.length);
    const pushUndo = useAppState.getState().pushUndo;
    pushUndo('Arrow palette');
    for (let i = 0; i < units.length; i++) {
      setCurveStyleOverride(units[i].keys, { color: colors[i % colors.length] });
    }
    setPaletteArrowMode(false);
  }, [exp, xAxisMode, visibleWells, visibleChannelList, wellChannelHidden, allChannelResults, paletteGroupColors, curveGroups, wellGroups, paletteArrowChannel, style.palette, setPaletteArrowMode, setCurveStyleOverride]);

  const { containerRef: plotContainerRef, overlayRef: selectionOverlayRef, resizeOverlayRef: ampResizeOverlayRef, arrowOverlayRef, traceClickedRef } = useBoxSelect({
    onSelect: handleBoxSelect,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onEmptyClick: deselectAll,
    threshold: { enabled: thresholdEnabled, rfu: thresholdRfu, setRfu: setThresholdRfu },
    paletteArrow: { active: paletteArrowMode, onApply: handlePaletteArrow },
    onResize: (x0, x1, y0, y1) => {
      const div = plotContainerRef.current?.querySelector('.js-plotly-plot') as HTMLElement | null;
      if (div) Plotly.relayout(div, { 'xaxis.range': [x0, x1], 'yaxis.range': [y0, y1] });
    },
    onResizeReset: () => {
      const div = plotContainerRef.current?.querySelector('.js-plotly-plot') as HTMLElement | null;
      if (div) Plotly.relayout(div, { 'xaxis.autorange': true, 'yaxis.autorange': true });
    },
    onShowContextMenu: openContextMenu,
  });

  // Resolve a Plotly curveNumber to the well it represents (hover = whole-well).
  const resolveWell = useCallback((curveNumber: number): string | null => {
    const i = curveNumber - rawOverlayCount;
    if (i < 0 || i >= renderedPairs.length) return null; // raw overlay or channel-legend marker
    return renderedPairs[i].well;
  }, [renderedPairs, rawOverlayCount]);

  // Resolve a Plotly curveNumber to the curveKey (S-C pair) it represents.
  const resolveCurve = useCallback((curveNumber: number): string | null => {
    const i = curveNumber - rawOverlayCount;
    if (i < 0 || i >= renderedPairs.length) return null;
    const p = renderedPairs[i];
    return curveKey(p.well, p.channel);
  }, [renderedPairs, rawOverlayCount]);

  const handleClick = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length) return;
    const browserEvent = event.event as MouseEvent | undefined;
    if (browserEvent && browserEvent.button !== 0) return;
    traceClickedRef.current = true; // suppress empty-click deselect
    const key = resolveCurve(event.points[0].curveNumber);
    if (!key) return;
    if (browserEvent && (browserEvent.ctrlKey || browserEvent.metaKey)) {
      toggleCurves([key]);
    } else {
      selectCurvesOnly([key]);
    }
  }, [resolveCurve, selectCurvesOnly, toggleCurves, traceClickedRef]);

  const handleHover = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length) return;
    const well = resolveWell(event.points[0].curveNumber);
    if (well) setHoveredWell(well);
  }, [resolveWell, setHoveredWell]);

  const handleUnhover = useCallback(() => setHoveredWell(null), [setHoveredWell]);

  useMiddleMousePan(plotContainerRef);
  useLegendHover(plotContainerRef, resolveWell, setHoveredWell);

  // Auto-scale OFF freezes the axes: snapshot the current view and pin it
  // (autorange:false) so data changes (e.g. toggling a channel) can't rescale.
  // ON releases the pin and re-fits. Re-runs on experiment / x-axis change so
  // the frozen view follows an intentional data-domain switch.
  useEffect(() => {
    const container = plotContainerRef.current;
    if (!autoScale) {
      const id = requestAnimationFrame(() => setFrozenRanges(readPlotRanges(container)));
      return () => cancelAnimationFrame(id);
    }
    setFrozenRanges(null);
    const div = container?.querySelector('.js-plotly-plot') as HTMLElement | null;
    if (div) Plotly.relayout(div, { 'xaxis.autorange': true, 'yaxis.autorange': true });
  }, [autoScale, exp?.experimentId, xAxisMode]);

  // "Fit" button bumps _autoScalePulse → re-fit to autorange. When frozen,
  // adopt the fitted view as the new pin so it doesn't snap back.
  useEffect(() => {
    if (autoScalePulse === 0) return;
    const container = plotContainerRef.current;
    const div = container?.querySelector('.js-plotly-plot') as HTMLElement | null;
    if (div) Plotly.relayout(div, { 'xaxis.autorange': true, 'yaxis.autorange': true });
    if (!autoScale) {
      const id = requestAnimationFrame(() => setFrozenRanges(readPlotRanges(container)));
      return () => cancelAnimationFrame(id);
    }
  }, [autoScalePulse]);

  return (
    <div
      ref={(el) => { plotContainerRef.current = el; sizeRef.current = el; }}
      id="sharp-plot-amp"
      data-sharp-plot="amp"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <Plot
        data={traces} layout={layout}
        useResizeHandler style={{ width: '100%', height: '100%' }}
        config={PLOT_CONFIG}
        onClick={handleClick}
        onHover={handleHover}
        onUnhover={handleUnhover}
        onLegendClick={() => false}
        onLegendDoubleClick={() => false}
      />
      <div ref={selectionOverlayRef} style={BOX_SELECT_OVERLAY_STYLE} />
      <div ref={ampResizeOverlayRef} style={RESIZE_OVERLAY_STYLE} />
      <svg ref={arrowOverlayRef} style={{ position: 'absolute', top: 0, left: 0, display: 'none', pointerEvents: 'none', zIndex: 11 }} />
      <PlotHint isDark={isDark} containerRef={sizeRef} />
    </div>
  );
}

// ── Melt Derivative Mini-Plot (shown below amp plot) ─────────────────

function MeltDerivMini({ openContextMenu }: { openContextMenu: (x: number, y: number) => void }) {
  const { plotBg, isDark, textColor } = usePlotTheme();
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const selectedCurves = useAppState((s) => s.selectedCurves);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const deactivatedWells = useAppState((s) => s.deactivatedWells);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const curveStyleOverrides = useAppState((s) => s.curveStyleOverrides);
  const wellGroups = useAppState((s) => s.wellGroups);
  const curveGroups = useAppState((s) => s.curveGroups);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const paletteGroupColors = useAppState((s) => s.paletteGroupColors);
  const hoveredWell = useAppState((s) => s.hoveredWell);
  const setHoveredWell = useAppState((s) => s.setHoveredWell);
  const deselectAll = useAppState((s) => s.deselectAll);
  const style = usePlotStyle();
  const sizeRef = useRef<HTMLDivElement | null>(null);
  const fontScale = usePlotFontScale(sizeRef);
  const sstyle = useScaledStyle(style, fontScale);
  const setSelectedCurves = useAppState((s) => s.setSelectedCurves);
  const selectCurvesOnly = useAppState((s) => s.selectCurvesOnly);
  const toggleCurves = useAppState((s) => s.toggleCurves);
  const analysisResults = useAnalysisResults();
  const dragPreviewCurves = useAppState((s) => s.dragPreviewCurves);
  const setDragPreviewCurves = useAppState((s) => s.setDragPreviewCurves);
  const meltThresholdEnabled = useAppState((s) => s.meltThresholdEnabled);
  const meltThresholdValue = useAppState((s) => s.meltThresholdValue);
  const setMeltThresholdValue = useAppState((s) => s.setMeltThresholdValue);
  const visibleChannels = useAppState((s) => s.visibleChannels);
  const wellChannelHidden = useAppState((s) => s.wellChannelHidden);
  const channelColors = useAppState((s) => s.channelColors);
  const channelLabels = useAppState((s) => s.channelLabels);
  const viewMode = useAppState((s) => s.viewMode);
  const activeChannel = useAppState((s) => s.activeChannel);
  const channelLineStyles = useAppState((s) => s.channelLineStyles);
  const autoScalePulse = useAppState((s) => s._autoScalePulse);
  const allChannelResults = useAllChannelResults();

  const exp = experiments[idx];
  const melt = exp?.melt;

  const visibleChannelList = useMemo(
    () => (viewMode === 'single'
      ? (exp?.meltByChannel[activeChannel] ? [activeChannel] : [])
      : (exp?.channels ?? []).filter((c) => visibleChannels.has(c) && exp?.meltByChannel[c])),
    [exp, visibleChannels, viewMode, activeChannel],
  );
  const multiChannel = visibleChannelList.length > 1;
  const useRamps = viewMode === 'multi' && (exp?.channels.length ?? 0) > 1;

  const visibleWells = useMemo(() => {
    if (!exp) return [];
    return exp.wellsUsed.filter((w) => !hiddenWells.has(w) && !deactivatedWells.has(w));
  }, [exp, hiddenWells, deactivatedWells]);

  // Colours are assigned over the experiment's ACTIVE wells (everything except
  // deactivated/empty ones) — NOT the currently-visible subset. `buildColorMap`
  // divides the palette among *units*, so keying it to visibility would resplit
  // the palette and recolour every curve whenever a well is hidden or shown.
  // Stable by construction; re-spreading is an explicit act (Style → Apply).
  const colorWells = useMemo(
    () => (exp ? exp.wellsUsed.filter((w) => !deactivatedWells.has(w)) : []),
    [exp, deactivatedWells],
  );
  // Effective groups (curve group wins over legacy well group). Grouped wells
  // share one colour: group whenever groups exist (or the "Group colors" toggle
  // is on) — resolved through `curveGroups` so grouping recolours live.
  const groupMap = useMemo(
    () => effectiveWellGroups(colorWells, activeChannel, curveGroups, wellGroups),
    [colorWells, activeChannel, curveGroups, wellGroups],
  );
  const groupColorsOn = paletteGroupColors || groupMap.size > 0;
  const colorMap = useGroupedColors(
    exp?.wellsUsed ?? [], colorWells, style.palette, groupMap, wellStyleOverrides,
    analysisResults as Map<string, { tt?: number | null }>, paletteReversed,
    groupColorsOn
  );

  const channelColorMaps = useChannelColorMaps(
    visibleChannelList, colorWells, useRamps, paletteReversed, groupColorsOn,
    groupMap, wellStyleOverrides,
    allChannelResults as Map<string, Map<string, { tt?: number | null }>>,
    colorMap, channelColors, channelLabels, exp?.channelFluorophore,
  );

  const hasDerivative = melt && Object.keys(melt.derivative).length > 0;

  // Rendered (well, channel) deriv-trace order for curveNumber resolution.
  const renderedPairs = useMemo(() => {
    const pairs: { well: string; channel: string }[] = [];
    for (const ch of visibleChannelList) {
      const m = exp?.meltByChannel[ch];
      if (!m) continue;
      for (const well of visibleWells) {
        if (wellChannelHidden.get(well)?.has(ch)) continue;
        if (!m.derivative[well]) continue;
        pairs.push({ well, channel: ch });
      }
    }
    return pairs;
  }, [exp, visibleChannelList, visibleWells, wellChannelHidden]);

  // Pre-compute peak -dF/dT per (channel, well) for threshold dimming.
  const wellPeakDeriv = useMemo(() => {
    const peaks = new Map<string, number>();
    if (!exp) return peaks;
    for (const ch of visibleChannelList) {
      const m = exp.meltByChannel[ch];
      if (!m) continue;
      for (const well of visibleWells) {
        const derData = m.derivative[well];
        if (!derData) continue;
        peaks.set(`${ch}${well}`, Math.max(...derData));
      }
    }
    return peaks;
  }, [exp, visibleChannelList, visibleWells]);

  const dash6 = (d: string | undefined) => d as 'solid' | 'dash' | 'dot' | 'dashdot' | 'longdash' | 'longdashdot' | undefined;

  const traces = useMemo((): Data[] => {
    if (!melt || !hasDerivative) return [];
    const result: Data[] = [];
    for (let ci = 0; ci < visibleChannelList.length; ci++) {
      const ch = visibleChannelList[ci];
      const m = exp?.meltByChannel[ch];
      if (!m) continue;
      for (const well of visibleWells) {
        if (wellChannelHidden.get(well)?.has(ch)) continue;
        const derData = m.derivative[well];
        if (!derData) continue;
        const key = curveKey(well, ch);
        const cw = resolveCurveColorWidth(well, ch, curveStyleOverrides, wellStyleOverrides);
        const color = cw.color ?? channelColorMaps.get(ch)?.get(well) ?? colorMap.get(well) ?? '#999';
        const isSelected = selectedCurves.size === 0 || selectedCurves.has(key);
        const isHovered = hoveredWell === well;
        const isDragHighlighted = dragPreviewCurves ? dragPreviewCurves.has(key) : null;
        let lineWidth = cw.width ?? (isSelected ? style.lineWidth : style.lineWidth * 0.6);
        let opacity = isSelected ? 1.0 : 0.25;
        if (isDragHighlighted === true) { lineWidth = style.lineWidth * 1.4; opacity = 1.0; }
        else if (isDragHighlighted === false) { opacity = 0.15; }
        if (isHovered) { lineWidth = Math.max(lineWidth, style.lineWidth * 1.6); }
        if (meltThresholdEnabled && (wellPeakDeriv.get(`${ch} ${well}`) ?? 0) < meltThresholdValue) {
          opacity = Math.min(opacity, 0.25);
          lineWidth = Math.min(lineWidth, style.lineWidth * 0.6);
        }
        result.push({
          x: m.temperatureC, y: derData,
          type: 'scatter' as const, mode: 'lines' as const, name: well,
          line: { color, width: lineWidth, dash: dash6(resolveDash(well, ch, curveStyleOverrides, wellStyleOverrides, channelLineStyles)) },
          opacity,
          hoverinfo: 'name' as const, showlegend: false,
        });
      }
    }
    return result;
  }, [exp, melt, visibleWells, visibleChannelList, multiChannel, wellChannelHidden, selectedCurves, style, hasDerivative, colorMap, channelColorMaps, channelLineStyles, wellStyleOverrides, curveStyleOverrides, hoveredWell, dragPreviewCurves, meltThresholdEnabled, meltThresholdValue, wellPeakDeriv]);

  // Bump only on data change (derivative depends solely on the experiment);
  // hover/selection/threshold-dimming stay a cheap restyle. See AmplificationPlot.
  const dataRevRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dataRevision = useMemo(() => ++dataRevRef.current, [exp]);

  const layout = useMemo((): Partial<Layout> => {
    const shapes: Partial<Shape>[] = [];
    if (meltThresholdEnabled) {
      shapes.push({
        type: 'line', x0: 0, x1: 1, xref: 'paper',
        y0: meltThresholdValue, y1: meltThresholdValue, yref: 'y',
        line: { color: isDark ? '#ef9a9d' : THRESHOLD_LINE_COLOR, width: 2.5, dash: 'dash' },
      });
    }
    // Mini plot scales its fonts with the user's Typography settings
    // (labelSize / tickSize). Previously hardcoded to 9/8, which meant
    // the Style tab's size sliders had no effect on the derivative
    // sub-plot below the amp chart.
    return {
      xaxis: {
        title: axisLabel('Temperature (°C)', sstyle),
        ...tickProps(sstyle),
        ...gridStyle(sstyle, isDark),
      },
      yaxis: {
        title: axisLabel('-dF/dT', sstyle),
        ...tickProps(sstyle),
        ...gridStyle(sstyle, isDark),
      },
      shapes: shapes as Layout['shapes'],
      dragmode: false as Layout['dragmode'],
      autosize: true,
      margin: computeMiniMargins(sstyle),
      plot_bgcolor: plotBg, paper_bgcolor: plotBg, font: { color: plotFontColor(isDark, textColor) },
      showlegend: false,
      datarevision: dataRevision,
      uirevision: `deriv-${experiments[idx]?.experimentId ?? 'none'}`,
    };
  }, [sstyle, fontScale, traces, meltThresholdEnabled, meltThresholdValue, experiments, idx, dataRevision]);

  // Box select on melt derivative (channel-aware)
  const visibleWellsRef = useRef(visibleWells);
  visibleWellsRef.current = visibleWells;
  const expRef = useRef(exp);
  expRef.current = exp;
  const visibleChannelListRef = useRef(visibleChannelList);
  visibleChannelListRef.current = visibleChannelList;
  const wellChannelHiddenRef = useRef(wellChannelHidden);
  wellChannelHiddenRef.current = wellChannelHidden;
  const renderedPairsRef = useRef(renderedPairs);
  renderedPairsRef.current = renderedPairs;

  const matchWellsInBox = useCallback((x0: number, x1: number, y0: number, y1: number): Set<string> => {
    const currentExp = expRef.current;
    if (!currentExp) return new Set();
    const matched = new Set<string>();
    for (const ch of visibleChannelListRef.current) {
      const m = currentExp.meltByChannel[ch];
      if (!m) continue;
      for (const well of visibleWellsRef.current) {
        if (wellChannelHiddenRef.current.get(well)?.has(ch)) continue;
        const yData = m.derivative[well];
        if (!yData) continue;
        for (let i = 0; i < m.temperatureC.length; i++) {
          if (m.temperatureC[i] >= x0 && m.temperatureC[i] <= x1 && yData[i] >= y0 && yData[i] <= y1) {
            matched.add(curveKey(well, ch));
            break;
          }
        }
      }
    }
    return matched;
  }, []);

  const resolveWell = useCallback((curveNumber: number): string | null => {
    const pairs = renderedPairsRef.current;
    return curveNumber >= 0 && curveNumber < pairs.length ? pairs[curveNumber].well : null;
  }, []);

  const resolveCurve = useCallback((curveNumber: number): string | null => {
    const pairs = renderedPairsRef.current;
    if (curveNumber < 0 || curveNumber >= pairs.length) return null;
    const p = pairs[curveNumber];
    return curveKey(p.well, p.channel);
  }, []);

  const handleBoxSelect = useCallback((x0: number, x1: number, y0: number, y1: number) => {
    const matched = matchWellsInBox(x0, x1, y0, y1);
    if (matched.size > 0) setSelectedCurves(matched);
  }, [setSelectedCurves, matchWellsInBox]);

  const handleDragMove = useCallback((x0: number, x1: number, y0: number, y1: number) => {
    setDragPreviewCurves(matchWellsInBox(x0, x1, y0, y1));
  }, [matchWellsInBox, setDragPreviewCurves]);

  const handleDragEnd = useCallback(() => setDragPreviewCurves(null), [setDragPreviewCurves]);

  const { containerRef, overlayRef, resizeOverlayRef: derivResizeOverlayRef } = useBoxSelect({
    onSelect: handleBoxSelect,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onEmptyClick: deselectAll,
    meltThreshold: meltThresholdEnabled ? {
      enabled: true,
      value: meltThresholdValue,
      setValue: setMeltThresholdValue,
    } : undefined,
    onResize: (x0, x1, y0, y1) => {
      const div = containerRef.current?.querySelector('.js-plotly-plot') as HTMLElement | null;
      if (div) Plotly.relayout(div, { 'xaxis.range': [x0, x1], 'yaxis.range': [y0, y1] });
    },
    onResizeReset: () => {
      const div = containerRef.current?.querySelector('.js-plotly-plot') as HTMLElement | null;
      if (div) Plotly.relayout(div, { 'xaxis.autorange': true, 'yaxis.autorange': true });
    },
    onShowContextMenu: openContextMenu,
  });

  const handleClick = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length) return;
    const browserEvent = event.event as MouseEvent | undefined;
    if (browserEvent && browserEvent.button !== 0) return;
    const key = resolveCurve(event.points[0].curveNumber);
    if (!key) return;
    if (browserEvent && (browserEvent.ctrlKey || browserEvent.metaKey)) {
      toggleCurves([key]);
    } else {
      selectCurvesOnly([key]);
    }
  }, [resolveCurve, selectCurvesOnly, toggleCurves]);

  const handleHover = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length) return;
    const well = resolveWell(event.points[0].curveNumber);
    if (well) setHoveredWell(well);
  }, [resolveWell, setHoveredWell]);

  const handleUnhover = useCallback(() => setHoveredWell(null), [setHoveredWell]);

  useMiddleMousePan(containerRef);

  // "Fit" button → re-fit axes to autorange.
  useEffect(() => {
    if (autoScalePulse === 0) return;
    const div = containerRef.current?.querySelector('.js-plotly-plot') as HTMLElement | null;
    if (div) Plotly.relayout(div, { 'xaxis.autorange': true, 'yaxis.autorange': true });
  }, [autoScalePulse]);

  if (!hasDerivative) return null;

  return (
    <div
      ref={(el) => { containerRef.current = el; sizeRef.current = el; }}
      id="sharp-plot-amp-deriv"
      data-sharp-plot="amp-deriv"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <Plot
        data={traces} layout={layout}
        useResizeHandler style={{ width: '100%', height: '100%' }}
        config={PLOT_CONFIG}
        onClick={handleClick}
        onHover={handleHover}
        onUnhover={handleUnhover}
      />
      <div ref={overlayRef} style={BOX_SELECT_OVERLAY_STYLE} />
      <div ref={derivResizeOverlayRef} style={RESIZE_OVERLAY_STYLE} />
    </div>
  );
}

// ── Melt Plot (stacked subplots — full tab) ──────────────────────────

function MeltPlot({ openContextMenu }: { openContextMenu: (x: number, y: number) => void }) {
  const { plotBg, isDark, textColor } = usePlotTheme();
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const selectedCurves = useAppState((s) => s.selectedCurves);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const deactivatedWells = useAppState((s) => s.deactivatedWells);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const curveStyleOverrides = useAppState((s) => s.curveStyleOverrides);
  const wellGroups = useAppState((s) => s.wellGroups);
  const curveGroups = useAppState((s) => s.curveGroups);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const paletteGroupColors = useAppState((s) => s.paletteGroupColors);
  const setSelectedCurves = useAppState((s) => s.setSelectedCurves);
  const selectCurvesOnly = useAppState((s) => s.selectCurvesOnly);
  const deselectAll = useAppState((s) => s.deselectAll);
  const toggleCurves = useAppState((s) => s.toggleCurves);
  const hoveredWell = useAppState((s) => s.hoveredWell);
  const setHoveredWell = useAppState((s) => s.setHoveredWell);
  const showLegendMelt = useAppState((s) => s.showLegendMelt);
  const legendContent = useAppState((s) => s.legendContent);
  const legendVisibleOnly = useAppState((s) => s.legendVisibleOnly);
  const legendOrder = useAppState((s) => s.legendOrder);
  const style = usePlotStyle();
  const sizeRef = useRef<HTMLDivElement | null>(null);
  const fontScale = usePlotFontScale(sizeRef);
  const sstyle = useScaledStyle(style, fontScale);
  const analysisResults = useAnalysisResults();
  const dragPreviewCurves = useAppState((s) => s.dragPreviewCurves);
  const setDragPreviewCurves = useAppState((s) => s.setDragPreviewCurves);
  const meltThresholdEnabled = useAppState((s) => s.meltThresholdEnabled);
  const meltThresholdValue = useAppState((s) => s.meltThresholdValue);
  const setMeltThresholdValue = useAppState((s) => s.setMeltThresholdValue);
  const meltNormalizeEnabled = useAppState((s) => s.meltNormalizeEnabled);
  const visibleChannels = useAppState((s) => s.visibleChannels);
  const channelLabels = useAppState((s) => s.channelLabels);
  const channelColors = useAppState((s) => s.channelColors);
  const viewMode = useAppState((s) => s.viewMode);
  const activeChannel = useAppState((s) => s.activeChannel);
  const channelLineStyles = useAppState((s) => s.channelLineStyles);
  const wellChannelHidden = useAppState((s) => s.wellChannelHidden);
  const autoScale = useAppState((s) => s.autoScale);
  const autoScalePulse = useAppState((s) => s._autoScalePulse);
  const allChannelResults = useAllChannelResults();

  const exp = experiments[idx];
  const melt = exp?.melt;

  const visibleChannelList = useMemo(
    () => (viewMode === 'single'
      ? (exp?.meltByChannel[activeChannel] ? [activeChannel] : [])
      : (exp?.channels ?? []).filter((c) => visibleChannels.has(c) && exp?.meltByChannel[c])),
    [exp, visibleChannels, viewMode, activeChannel],
  );
  const multiChannel = visibleChannelList.length > 1;
  const useRamps = viewMode === 'multi' && (exp?.channels.length ?? 0) > 1;

  const visibleWells = useMemo(() => {
    if (!exp) return [];
    return exp.wellsUsed.filter((w) => !hiddenWells.has(w) && !deactivatedWells.has(w));
  }, [exp, hiddenWells, deactivatedWells]);

  // Colours are assigned over the experiment's ACTIVE wells (everything except
  // deactivated/empty ones) — NOT the currently-visible subset. `buildColorMap`
  // divides the palette among *units*, so keying it to visibility would resplit
  // the palette and recolour every curve whenever a well is hidden or shown.
  // Stable by construction; re-spreading is an explicit act (Style → Apply).
  const colorWells = useMemo(
    () => (exp ? exp.wellsUsed.filter((w) => !deactivatedWells.has(w)) : []),
    [exp, deactivatedWells],
  );
  // Effective groups (curve group wins over legacy well group). Grouped wells
  // share one colour: group whenever groups exist (or the "Group colors" toggle
  // is on) — resolved through `curveGroups` so grouping recolours live.
  const groupMap = useMemo(
    () => effectiveWellGroups(colorWells, activeChannel, curveGroups, wellGroups),
    [colorWells, activeChannel, curveGroups, wellGroups],
  );
  const groupColorsOn = paletteGroupColors || groupMap.size > 0;
  const colorMap = useGroupedColors(
    exp?.wellsUsed ?? [], colorWells, style.palette, groupMap, wellStyleOverrides,
    analysisResults as Map<string, { tt?: number | null }>, paletteReversed,
    groupColorsOn
  );

  const channelColorMaps = useChannelColorMaps(
    visibleChannelList, colorWells, useRamps, paletteReversed, groupColorsOn,
    groupMap, wellStyleOverrides,
    allChannelResults as Map<string, Map<string, { tt?: number | null }>>,
    colorMap, channelColors, channelLabels, exp?.channelFluorophore,
  );

  const legendRanks = useMemo(() => buildLegendRanks(legendOrder), [legendOrder]);

  const hasDerivative = !!melt && visibleChannelList.some((ch) => {
    const m = exp?.meltByChannel[ch];
    return m && Object.keys(m.derivative).length > 0;
  });

  // Per-channel melt RFU, HRM-normalized 1→0 when enabled. Derivative left raw.
  const meltRfuByChannel = useMemo(() => {
    const out = new Map<string, Record<string, number[]>>();
    if (!exp) return out;
    for (const ch of visibleChannelList) {
      const m = exp.meltByChannel[ch];
      if (!m) continue;
      out.set(ch, meltNormalizeEnabled ? normalizeMeltCurves(m.rfu) : m.rfu);
    }
    return out;
  }, [exp, visibleChannelList, meltNormalizeEnabled]);

  // Rendered (well, channel) order for the RFU block (deriv block mirrors it).
  const renderedPairs = useMemo(() => {
    const pairs: { well: string; channel: string }[] = [];
    for (const ch of visibleChannelList) {
      const rfu = meltRfuByChannel.get(ch);
      if (!rfu) continue;
      for (const well of visibleWells) {
        if (wellChannelHidden.get(well)?.has(ch)) continue;
        if (!rfu[well]) continue;
        pairs.push({ well, channel: ch });
      }
    }
    return pairs;
  }, [visibleChannelList, meltRfuByChannel, visibleWells, wellChannelHidden]);

  const legendInfo = useMemo(
    () => computeCurveLegendInfo(renderedPairs, curveGroups, wellGroups, exp?.wells, selectedCurves, legendContent, legendVisibleOnly, multiChannel, (ch) => effectiveChannelLabel(ch, channelLabels, exp?.channelFluorophore)),
    [renderedPairs, curveGroups, wellGroups, exp, selectedCurves, legendContent, legendVisibleOnly, multiChannel, channelLabels]
  );

  // Peak -dF/dT per (channel, well) for threshold dimming.
  const wellPeakDeriv = useMemo(() => {
    const peaks = new Map<string, number>();
    if (!exp) return peaks;
    for (const ch of visibleChannelList) {
      const m = exp.meltByChannel[ch];
      if (!m) continue;
      for (const well of visibleWells) {
        const derData = m.derivative[well];
        if (!derData || derData.length === 0) continue;  // Math.max(...[]) === -Infinity
        peaks.set(`${ch} ${well}`, Math.max(...derData));
      }
    }
    return peaks;
  }, [exp, visibleChannelList, visibleWells]);

  const dash6 = (d: string | undefined) => d as 'solid' | 'dash' | 'dot' | 'dashdot' | 'longdash' | 'longdashdot' | undefined;

  const traces = useMemo((): Data[] => {
    if (!melt) return [];
    const result: Data[] = [];
    const emittedLegend = new Set<string>();

    // RFU block (yaxis 'y')
    for (let ci = 0; ci < visibleChannelList.length; ci++) {
      const ch = visibleChannelList[ci];
      const m = exp?.meltByChannel[ch];
      const rfu = meltRfuByChannel.get(ch);
      if (!m || !rfu) continue;
      for (const well of visibleWells) {
        if (wellChannelHidden.get(well)?.has(ch)) continue;
        const rfuData = rfu[well];
        if (!rfuData) continue;
        const key = curveKey(well, ch);
        const cw = resolveCurveColorWidth(well, ch, curveStyleOverrides, wellStyleOverrides);
        const color = cw.color ?? channelColorMaps.get(ch)?.get(well) ?? colorMap.get(well) ?? '#999';
        const isSelected = selectedCurves.size === 0 || selectedCurves.has(key);
        const isHovered = hoveredWell === well;
        const isDragHighlighted = dragPreviewCurves ? dragPreviewCurves.has(key) : null;
        const li = legendInfo.get(key)!;
        let lineWidth = cw.width ?? (isSelected ? style.lineWidth : style.lineWidth * 0.6);
        let opacity = isSelected ? 1.0 : 0.25;
        if (isDragHighlighted === true) { lineWidth = style.lineWidth * 1.4; opacity = 1.0; }
        else if (isDragHighlighted === false) { opacity = 0.15; }
        if (isHovered) { lineWidth = Math.max(lineWidth, style.lineWidth * 1.6); }
        if (meltThresholdEnabled && (wellPeakDeriv.get(`${ch} ${well}`) ?? 0) < meltThresholdValue) {
          opacity = Math.min(opacity, 0.25);
          lineWidth = Math.min(lineWidth, style.lineWidth * 0.6);
        }
        const showLegMelt = li.isLegendRep && !emittedLegend.has(li.group);
        if (showLegMelt) emittedLegend.add(li.group);
        result.push({
          x: m.temperatureC, y: rfuData,
          type: 'scatter' as const, mode: 'lines' as const, name: li.name,
          legendgroup: li.group,
          legendrank: legendRanks.get(li.group) ?? 1000,
          line: { color, width: lineWidth, dash: dash6(resolveDash(well, ch, curveStyleOverrides, wellStyleOverrides, channelLineStyles)) },
          opacity,
          hoverinfo: 'name' as const, yaxis: 'y',
          showlegend: showLegMelt,
        });
      }
    }

    // Derivative block (xaxis2/yaxis2) — same (well, channel) order.
    if (hasDerivative) {
      for (let ci = 0; ci < visibleChannelList.length; ci++) {
        const ch = visibleChannelList[ci];
        const m = exp?.meltByChannel[ch];
        const rfu = meltRfuByChannel.get(ch);
        if (!m || !rfu) continue;
        for (const well of visibleWells) {
          if (wellChannelHidden.get(well)?.has(ch)) continue;
          if (!rfu[well]) continue;        // keep parallel with the RFU block
          // Do NOT skip when the derivative is missing: the derivative block
          // must stay index-parallel with renderedPairs (and the RFU block) so
          // curveNumber → well resolution (resolveWell) stays correct. A well
          // lacking a derivative renders an empty (invisible) trace, keeping
          // its curveNumber slot rather than shifting every later curve.
          const derData = m.derivative[well];
          const key = curveKey(well, ch);
          const cw = resolveCurveColorWidth(well, ch, curveStyleOverrides, wellStyleOverrides);
          const color = cw.color ?? channelColorMaps.get(ch)?.get(well) ?? colorMap.get(well) ?? '#999';
          const isSelected = selectedCurves.size === 0 || selectedCurves.has(key);
          const isHovered = hoveredWell === well;
          const isDragHighlighted = dragPreviewCurves ? dragPreviewCurves.has(key) : null;
          let lineWidth = cw.width ?? (isSelected ? style.lineWidth : style.lineWidth * 0.6);
          let opacity = isSelected ? 1.0 : 0.25;
          if (isDragHighlighted === true) { lineWidth = style.lineWidth * 1.4; opacity = 1.0; }
          else if (isDragHighlighted === false) { opacity = 0.15; }
          if (isHovered) { lineWidth = Math.max(lineWidth, style.lineWidth * 1.6); }
          if (meltThresholdEnabled && (wellPeakDeriv.get(`${ch} ${well}`) ?? 0) < meltThresholdValue) {
            opacity = Math.min(opacity, 0.25);
            lineWidth = Math.min(lineWidth, style.lineWidth * 0.6);
          }
          const li = legendInfo.get(key)!;
          result.push({
            x: derData ? m.temperatureC : [], y: derData ?? [],
            type: 'scatter' as const, mode: 'lines' as const, name: li.name,
            legendgroup: li.group,
            legendrank: legendRanks.get(li.group) ?? 1000,
            line: { color, width: lineWidth, dash: dash6(resolveDash(well, ch, curveStyleOverrides, wellStyleOverrides, channelLineStyles)) },
            opacity,
            hoverinfo: 'name' as const, xaxis: 'x2', yaxis: 'y2', showlegend: false,
          });
        }
      }
    }

    // (Channels are keyed by the FAM/HEX toggles in the plot-tabs bar, so no
    // separate per-channel legend block is added here.)
    return result;
  }, [exp, melt, meltRfuByChannel, visibleWells, visibleChannelList, multiChannel, wellChannelHidden, channelLabels, channelColors, channelLineStyles, selectedCurves, style, hasDerivative, colorMap, channelColorMaps, wellStyleOverrides, curveStyleOverrides, hoveredWell, dragPreviewCurves, meltThresholdEnabled, meltThresholdValue, wellPeakDeriv, legendInfo, legendRanks, showLegendMelt, isDark]);

  const [frozenRanges, setFrozenRanges] = useState<FrozenRanges | null>(null);
  const frozen = !autoScale && frozenRanges != null;

  // Bump only when melt data changes (RFU normalization or the experiment;
  // derivative tracks the experiment). Styling/threshold stay a restyle.
  const dataRevRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dataRevision = useMemo(() => ++dataRevRef.current, [exp, meltRfuByChannel]);

  const layout = useMemo((): Partial<Layout> => {
    const title = exp?.experimentId ? `${exp.experimentId} — Melt` : 'Melt Curve';
    const grid = gridStyle(sstyle, isDark);
    const rfuLabel = meltNormalizeEnabled ? 'Normalized fluorescence' : 'RFU';
    const shapes: Partial<Shape>[] = [];
    if (meltThresholdEnabled && hasDerivative) {
      shapes.push({
        type: 'line', x0: 0, x1: 1, xref: 'paper',
        y0: meltThresholdValue, y1: meltThresholdValue, yref: 'y2',
        line: { color: isDark ? '#ef9a9d' : THRESHOLD_LINE_COLOR, width: 2.5, dash: 'dash' },
      });
    }
    if (hasDerivative) {
      return {
        title: titleField(title, sstyle),
        // Top subplot x-axis: anchored to yaxis (RFU), tick labels hidden
        // so they don't appear between the two subplots.
        xaxis: { ...tickProps(sstyle), showticklabels: false, ...grid, anchor: 'y', ...rangeProps(frozenRanges?.x, frozen) },
        // Bottom subplot x-axis: matches xaxis so zoom/pan stay in sync,
        // anchored to yaxis2 so the Temperature label + ticks sit at the bottom.
        // (No explicit range — `matches:'x'` inherits the pinned x range.)
        xaxis2: { title: axisLabel('Temperature (°C)', sstyle), ...tickProps(sstyle), ...grid, matches: 'x', anchor: 'y2' },
        yaxis: { title: axisLabel(rfuLabel, sstyle), ...tickProps(sstyle), domain: [0.55, 1], anchor: 'x', ...grid, ...rangeProps(frozenRanges?.y, frozen) },
        yaxis2: { title: axisLabel('-dF/dT', sstyle), ...tickProps(sstyle), domain: [0, 0.45], anchor: 'x2', ...grid, ...rangeProps(frozenRanges?.y2, frozen) },
        shapes: shapes as Layout['shapes'],
        dragmode: false as Layout['dragmode'], autosize: true, margin: computeMargins(sstyle, HINT_TOP_RESERVE),
        plot_bgcolor: plotBg, paper_bgcolor: plotBg, font: { color: plotFontColor(isDark, textColor) }, ...legendLayout(sstyle, showLegendMelt, traces, isDark),
        datarevision: dataRevision,
        uirevision: autoScale
          ? `melt-${exp?.experimentId ?? 'none'}-n${meltNormalizeEnabled ? 1 : 0}`
          : `melt-${exp?.experimentId ?? 'none'}`,
      };
    }
    return {
      title: titleField(title, sstyle),
      xaxis: { title: axisLabel('Temperature (°C)', sstyle), ...tickProps(sstyle), ...grid, ...rangeProps(frozenRanges?.x, frozen) },
      yaxis: { title: axisLabel(rfuLabel, sstyle), ...tickProps(sstyle), ...grid, ...rangeProps(frozenRanges?.y, frozen) },
      dragmode: false as Layout['dragmode'], autosize: true, margin: computeMargins(sstyle, HINT_TOP_RESERVE),
      plot_bgcolor: plotBg, paper_bgcolor: plotBg, font: { color: plotFontColor(isDark, textColor) }, ...legendLayout(sstyle, showLegendMelt, traces, isDark),
      datarevision: dataRevision,
      uirevision: autoScale
        ? `melt-${exp?.experimentId ?? 'none'}-n${meltNormalizeEnabled ? 1 : 0}`
        : `melt-${exp?.experimentId ?? 'none'}`,
    };
  }, [exp, sstyle, hasDerivative, traces, showLegendMelt, meltThresholdEnabled, meltThresholdValue, meltNormalizeEnabled, autoScale, frozen, frozenRanges, isDark, plotBg, textColor, dataRevision]);

  // Box select on melt plot (channel-aware; RFU on y, derivative on y2)
  const visibleWellsRef = useRef(visibleWells);
  visibleWellsRef.current = visibleWells;
  const expRef = useRef(exp);
  expRef.current = exp;
  const visibleChannelListRef = useRef(visibleChannelList);
  visibleChannelListRef.current = visibleChannelList;
  const wellChannelHiddenRef = useRef(wellChannelHidden);
  wellChannelHiddenRef.current = wellChannelHidden;
  const meltRfuByChannelRef = useRef(meltRfuByChannel);
  meltRfuByChannelRef.current = meltRfuByChannel;
  const renderedPairsRef = useRef(renderedPairs);
  renderedPairsRef.current = renderedPairs;

  const matchWellsInBox = useCallback((x0: number, x1: number, y0: number, y1: number, y2Bounds?: { y0: number; y1: number }): Set<string> => {
    const currentExp = expRef.current;
    if (!currentExp) return new Set();
    const matched = new Set<string>();
    for (const ch of visibleChannelListRef.current) {
      const m = currentExp.meltByChannel[ch];
      const rfu = meltRfuByChannelRef.current.get(ch);
      if (!m) continue;
      for (const well of visibleWellsRef.current) {
        if (wellChannelHiddenRef.current.get(well)?.has(ch)) continue;
        const key = curveKey(well, ch);
        if (matched.has(key)) continue;
        const rfuData = rfu?.[well];
        if (rfuData) {
          for (let i = 0; i < m.temperatureC.length; i++) {
            if (m.temperatureC[i] >= x0 && m.temperatureC[i] <= x1 && rfuData[i] >= y0 && rfuData[i] <= y1) {
              matched.add(key); break;
            }
          }
        }
        if (!matched.has(key) && y2Bounds) {
          const derData = m.derivative[well];
          if (derData) {
            for (let i = 0; i < m.temperatureC.length; i++) {
              if (m.temperatureC[i] >= x0 && m.temperatureC[i] <= x1 && derData[i] >= y2Bounds.y0 && derData[i] <= y2Bounds.y1) {
                matched.add(key); break;
              }
            }
          }
        }
      }
    }
    return matched;
  }, []);

  // curveNumber → well: RFU block then deriv block (parallel order), then
  // channel-legend markers (resolve to null).
  const resolveWell = useCallback((curveNumber: number): string | null => {
    const pairs = renderedPairsRef.current;
    const L = pairs.length;
    if (curveNumber >= 0 && curveNumber < L) return pairs[curveNumber].well;
    if (curveNumber >= L && curveNumber < 2 * L) return pairs[curveNumber - L].well;
    return null;
  }, []);

  const resolveCurve = useCallback((curveNumber: number): string | null => {
    const pairs = renderedPairsRef.current;
    const L = pairs.length;
    const p = (curveNumber >= 0 && curveNumber < L) ? pairs[curveNumber]
      : (curveNumber >= L && curveNumber < 2 * L) ? pairs[curveNumber - L]
      : null;
    return p ? curveKey(p.well, p.channel) : null;
  }, []);

  const handleBoxSelect = useCallback((x0: number, x1: number, y0: number, y1: number, y2Bounds?: { y0: number; y1: number }) => {
    const matched = matchWellsInBox(x0, x1, y0, y1, y2Bounds);
    if (matched.size > 0) setSelectedCurves(matched);
  }, [setSelectedCurves, matchWellsInBox]);

  const handleDragMove = useCallback((x0: number, x1: number, y0: number, y1: number, y2Bounds?: { y0: number; y1: number }) => {
    setDragPreviewCurves(matchWellsInBox(x0, x1, y0, y1, y2Bounds));
  }, [matchWellsInBox, setDragPreviewCurves]);

  const handleDragEnd = useCallback(() => setDragPreviewCurves(null), [setDragPreviewCurves]);

  const { containerRef, overlayRef, resizeOverlayRef: meltResizeOverlayRef, traceClickedRef } = useBoxSelect({
    onSelect: handleBoxSelect,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onEmptyClick: deselectAll,
    meltThreshold: meltThresholdEnabled && hasDerivative ? {
      enabled: true,
      value: meltThresholdValue,
      setValue: setMeltThresholdValue,
      axis: 'y2',  // derivative occupies the lower subplot in the melt view
    } : undefined,
    onResize: (x0, x1) => {
      // For the stacked melt plot, resize x-axis (temperature) only
      const div = containerRef.current?.querySelector('.js-plotly-plot') as HTMLElement | null;
      if (div) Plotly.relayout(div, { 'xaxis.range': [x0, x1] });
    },
    onResizeReset: () => {
      const div = containerRef.current?.querySelector('.js-plotly-plot') as HTMLElement | null;
      if (div) Plotly.relayout(div, { 'xaxis.autorange': true, 'yaxis.autorange': true, 'yaxis2.autorange': true } as unknown as Partial<Layout>);
    },
    onShowContextMenu: openContextMenu,
  });

  const handleClick = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length) return;
    const browserEvent = event.event as MouseEvent | undefined;
    if (browserEvent && browserEvent.button !== 0) return;
    traceClickedRef.current = true;
    const key = resolveCurve(event.points[0].curveNumber);
    if (!key) return;
    if (browserEvent && (browserEvent.ctrlKey || browserEvent.metaKey)) {
      toggleCurves([key]);
    } else {
      selectCurvesOnly([key]);
    }
  }, [resolveCurve, selectCurvesOnly, toggleCurves, traceClickedRef]);

  const handleHover = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length) return;
    const well = resolveWell(event.points[0].curveNumber);
    if (well) setHoveredWell(well);
  }, [resolveWell, setHoveredWell]);

  const handleUnhover = useCallback(() => setHoveredWell(null), [setHoveredWell]);

  useMiddleMousePan(containerRef);
  useLegendHover(containerRef, resolveWell, setHoveredWell);

  // Auto-scale OFF freezes the axes (RFU on y, derivative on y2); ON releases
  // and re-fits. Re-runs on experiment / x-axis change.
  useEffect(() => {
    const container = containerRef.current;
    if (!autoScale) {
      const id = requestAnimationFrame(() => setFrozenRanges(readPlotRanges(container)));
      return () => cancelAnimationFrame(id);
    }
    setFrozenRanges(null);
    const div = container?.querySelector('.js-plotly-plot') as HTMLElement | null;
    if (div) Plotly.relayout(div, { 'xaxis.autorange': true, 'yaxis.autorange': true, 'yaxis2.autorange': true } as unknown as Partial<Layout>);
  }, [autoScale, exp?.experimentId]);

  // "Fit" button → re-fit axes (RFU on y, derivative on y2) to autorange.
  // When frozen, adopt the fitted view as the new pin.
  useEffect(() => {
    if (autoScalePulse === 0) return;
    const container = containerRef.current;
    const div = container?.querySelector('.js-plotly-plot') as HTMLElement | null;
    if (div) Plotly.relayout(div, { 'xaxis.autorange': true, 'yaxis.autorange': true, 'yaxis2.autorange': true } as unknown as Partial<Layout>);
    if (!autoScale) {
      const id = requestAnimationFrame(() => setFrozenRanges(readPlotRanges(container)));
      return () => cancelAnimationFrame(id);
    }
  }, [autoScalePulse]);

  if (!melt) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No melt data available</div>;
  }

  return (
    <div
      ref={(el) => { containerRef.current = el; sizeRef.current = el; }}
      id="sharp-plot-melt"
      data-sharp-plot="melt"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <Plot
        data={traces} layout={layout}
        useResizeHandler style={{ width: '100%', height: '100%' }}
        config={PLOT_CONFIG}
        onClick={handleClick}
        onHover={handleHover}
        onUnhover={handleUnhover}
        onLegendClick={() => false}
        onLegendDoubleClick={() => false}
      />
      <div ref={overlayRef} style={BOX_SELECT_OVERLAY_STYLE} />
      <div ref={meltResizeOverlayRef} style={RESIZE_OVERLAY_STYLE} />
      <PlotHint isDark={isDark} containerRef={sizeRef} />
    </div>
  );
}

// ── Standard Curve Tab ────────────────────────────────────────────────

function formatConc(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}×10⁶`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}×10³`;
  if (value < 0.01) return value.toExponential(2);
  return value.toFixed(2);
}

/** Dilution standard curve plot (Tt vs log₂(C) with error bars + fit line) */
function DilutionPlot() {
  const dilutionRef = useRef<HTMLDivElement>(null);
  useMiddleMousePan(dilutionRef);
  const autoScalePulse = useAppState((s) => s._autoScalePulse);
  useEffect(() => {
    if (autoScalePulse === 0) return;
    const div = dilutionRef.current?.querySelector('.js-plotly-plot') as HTMLElement | null;
    if (div) Plotly.relayout(div, { 'xaxis.autorange': true, 'yaxis.autorange': true });
  }, [autoScalePulse]);
  const { plotBg, isDark, textColor } = usePlotTheme();
  const dilutionConfig = useAppState((s) => s.dilutionConfig);
  const setDilutionStepEnabled = useAppState((s) => s.setDilutionStepEnabled);
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const style = usePlotStyle();
  const sizeRef = useRef<HTMLDivElement | null>(null);
  const fontScale = usePlotFontScale(sizeRef);
  const sstyle = useScaledStyle(style, fontScale);
  const analysisResults = useAnalysisResults();
  const exp = experiments[idx];

  // Build Tt map from analysis results
  const ttByWell = useMemo(() => {
    const m = new Map<string, number>();
    for (const [well, r] of analysisResults) {
      if (r.tt != null) m.set(well, r.tt);
    }
    return m;
  }, [analysisResults]);

  const result = useMemo(() => {
    if (!dilutionConfig) return null;
    return analyzeDilutionSeries(dilutionConfig, ttByWell);
  }, [dilutionConfig, ttByWell]);

  const xLabel = xAxisMode === 'cycle' ? 'Ct' : 'Tt';
  const unit = dilutionConfig?.unit ?? '';

  const traces = useMemo((): Data[] => {
    if (!result) return [];
    const gs = result.groupStats;
    const out: Data[] = [];

    // Scatter with error bars
    out.push({
      x: gs.map((g) => g.log2Conc),
      y: gs.map((g) => g.meanTt),
      error_y: { type: 'data', array: gs.map((g) => g.semTt), visible: true, thickness: 1.5, width: 4 },
      text: gs.map((g) => `n=${g.n}`),
      textposition: 'top center' as const,
      textfont: { size: 8, family: style.fontFamily },
      type: 'scatter' as const,
      mode: 'text+markers' as const,
      marker: { color: '#4e79a7', size: 9 },
      hovertext: gs.map((g) => `${formatConc(g.concentration)}${unit ? ' ' + unit : ''}\nMean ${xLabel}: ${g.meanTt.toFixed(2)}\n±SEM: ${g.semTt.toFixed(3)}\nn=${g.n}`),
      hoverinfo: 'text' as const,
      showlegend: false,
    });

    // Fit line
    const xMin = Math.min(...gs.map((g) => g.log2Conc));
    const xMax = Math.max(...gs.map((g) => g.log2Conc));
    const pad = (xMax - xMin) * 0.05;
    const fitX = [xMin - pad, xMax + pad];
    const fitY = fitX.map((x) => result.slope * x + result.intercept);
    out.push({
      x: fitX, y: fitY, type: 'scatter' as const, mode: 'lines' as const,
      line: { color: '#333', width: 1.5, dash: 'dash' },
      showlegend: false, hoverinfo: 'skip' as const,
    });

    return out;
  }, [result, style.fontFamily, xLabel, unit]);

  const dataRevRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dataRevision = useMemo(() => ++dataRevRef.current, [result]);

  const layout = useMemo((): Partial<Layout> => {
    const title = exp?.experimentId ? `${exp.experimentId} — Standard Curve` : 'Standard Curve';
    return {
      title: titleField(title, sstyle),
      xaxis: {
        title: axisLabel(`log₂(Concentration${unit ? ', ' + unit : ''})`, sstyle),
        ...tickProps(sstyle), ...gridStyle(sstyle, isDark),
      },
      yaxis: {
        title: axisLabel(`${xLabel} (${X_AXIS_LABELS[xAxisMode]})`, sstyle),
        ...tickProps(sstyle), ...gridStyle(sstyle, isDark),
      },
      autosize: true, margin: computeMargins(sstyle),
      plot_bgcolor: plotBg, paper_bgcolor: plotBg, font: { color: plotFontColor(isDark, textColor) },
      datarevision: dataRevision,
    };
  }, [exp, xAxisMode, xLabel, sstyle, fontScale, unit, dataRevision]);

  if (!result) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full text-muted-foreground text-sm px-6 text-center">
        {!dilutionConfig ? (
          <>
            <p>Build a standard curve from a dilution series to estimate the doubling time.</p>
            <button
              onClick={() => useAppState.getState().setShowDilutionWizard(true)}
              className="px-3 py-1.5 text-sm border rounded-md bg-background hover:bg-accent text-foreground"
            >
              Open Standard Curve Wizard
            </button>
          </>
        ) : (
          <p>Not enough data — assign wells with valid {xLabel} values to at least 2 steps.</p>
        )}
      </div>
    );
  }

  const formatP = (p: number) => {
    if (p < 0.0001) return '< 0.0001';
    if (p < 0.001) return p.toExponential(2);
    return p.toFixed(4);
  };
  const xUnit = X_AXIS_LABELS[xAxisMode];

  return (
    <div ref={dilutionRef} className="flex flex-col h-full">
      <div
        ref={sizeRef}
        id="sharp-plot-doubling"
        data-sharp-plot="doubling"
        className="flex-1 min-h-0"
      >
        <Plot data={traces} layout={layout}
          useResizeHandler style={{ width: '100%', height: '100%' }}
          config={PLOT_CONFIG} />
      </div>

      {/* Stats summary panel */}
      <div className="shrink-0 border-t bg-muted/30 px-4 py-2 text-xs">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <span className="font-semibold text-[var(--brand-red-dark)]">
            Doubling Time: {result.doublingTime.toFixed(3)}
          </span>
          <button
            onClick={() => useAppState.getState().setShowDilutionWizard(true)}
            className="px-2 py-0.5 text-[10px] border rounded hover:bg-accent text-muted-foreground"
          >
            Edit Steps
          </button>
          <span className="text-muted-foreground">
            ± {result.doublingTimeSE.toFixed(3)} {xUnit}
          </span>
          <span className="text-muted-foreground">
            95% CI: [{result.doublingTime95CI[0].toFixed(3)}, {result.doublingTime95CI[1].toFixed(3)}]
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-0.5 mt-1 text-muted-foreground">
          <span>R² = <span className="text-foreground">{result.rSquared.toFixed(4)}</span></span>
          <span>Adj. R² = <span className="text-foreground">{result.adjRSquared.toFixed(4)}</span></span>
          <span>Slope = <span className="text-foreground">{result.slope.toFixed(4)} ± {result.slopeSE.toFixed(4)}</span></span>
          <span>F = <span className="text-foreground">{result.fStatistic.toFixed(2)}</span></span>
          <span>p = <span className="text-foreground">{formatP(result.pValue)}</span></span>
          <span>n = {result.nTotal} ({result.nSteps} steps)</span>
        </div>
      </div>

      {/* Per-step results table */}
      <div className="shrink-0 border-t overflow-y-auto" style={{ maxHeight: 160 }}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background">
            <tr className="text-muted-foreground border-b">
              <th className="w-10 px-1 py-1 text-center">On</th>
              <th className="px-2 py-1 text-left">Step</th>
              <th className="px-2 py-1 text-right">Concentration{unit ? ` (${unit})` : ''}</th>
              <th className="px-2 py-1 text-right">log₂(C)</th>
              <th className="px-2 py-1 text-right">Mean {xLabel}</th>
              <th className="px-2 py-1 text-right">±SEM</th>
              <th className="px-2 py-1 text-right">n</th>
            </tr>
          </thead>
          <tbody>
            {dilutionConfig!.steps.map((step, i) => {
              const gs = result.groupStats.find((g) => Math.abs(g.concentration - step.concentration) < 1e-10);
              return (
                <tr key={i} className={`border-b last:border-b-0 ${!step.enabled ? 'opacity-40' : ''}`}>
                  <td className="px-1 py-0.5 text-center">
                    <Checkbox
                      checked={step.enabled}
                      onCheckedChange={(v) => setDilutionStepEnabled(i, v === true)}
                      className="h-3.5 w-3.5"
                    />
                  </td>
                  <td className="px-2 py-0.5">{i + 1}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{formatConc(step.concentration)}{unit ? ` ${unit}` : ''}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{Math.log2(step.concentration).toFixed(2)}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{gs ? gs.meanTt.toFixed(2) : '—'}</td>
                  <td className="px-2 py-0.5 text-right font-mono">{gs ? gs.semTt.toFixed(3) : '—'}</td>
                  <td className="px-2 py-0.5 text-right">{gs ? gs.n : step.wells.length > 0 ? '0*' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Drag Resize Divider ──────────────────────────────────────────────

function DragDivider({ onDrag }: { onDrag: (deltaY: number) => void }) {
  const divRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastY = useRef(0);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      const delta = e.clientY - lastY.current;
      lastY.current = e.clientY;
      onDrag(delta);
    };
    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onDrag]);

  return (
    <div
      ref={divRef}
      className="flex-shrink-0 flex items-center justify-center cursor-row-resize hover:bg-accent active:bg-border transition-colors"
      style={{ height: 7, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
      onMouseDown={(e) => {
        e.preventDefault();
        dragging.current = true;
        lastY.current = e.clientY;
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
      }}
    >
      {/* Three dots handle */}
      <div className="flex gap-1">
        <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
        <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
        <div className="w-1 h-1 rounded-full bg-muted-foreground/40" />
      </div>
    </div>
  );
}

// ── Welcome Screen ──────────────────────────────────────────────────

function WelcomeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center p-8 text-sm text-muted-foreground select-none">
      <div className="max-w-md space-y-6">
        <div className="text-center space-y-4">
          <img src="/sharp-logo.png" alt="SHARP" className="w-16 h-16 mx-auto rounded-tl-lg rounded-br-lg" />
          <h2 className="text-lg font-semibold text-[var(--brand-red-dark)]">SHARP Processor 2</h2>
          <p>Open an experiment file to get started.</p>
          <p className="text-xs">Use <kbd className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-[10px]">{MOD_KEY}+O</kbd> or drag a file onto this window.</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[var(--brand-red-dark)] uppercase tracking-wide">Supported Formats</h3>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1 pr-3 font-medium text-foreground">Instrument</th>
                <th className="text-left py-1 font-medium text-foreground">Extension</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <tr className="border-b border-dashed"><td className="py-1 pr-3">SHARP universal</td><td className="py-1 font-mono">.sharp</td></tr>
              <tr className="border-b border-dashed"><td className="py-1 pr-3">BioRad CFX96</td><td className="py-1 font-mono">.pcrd</td></tr>
              <tr className="border-b border-dashed"><td className="py-1 pr-3">TianLong Gentier Mini</td><td className="py-1 font-mono">.tlpd</td></tr>
              <tr className="border-b border-dashed"><td className="py-1 pr-3">ThermoFisher QuantStudio</td><td className="py-1 font-mono">.eds</td></tr>
              <tr className="border-b border-dashed"><td className="py-1 pr-3">Agilent AriaMx</td><td className="py-1 font-mono">.amxd / .adxd</td></tr>
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2 p-2 rounded bg-muted/50 text-xs">
          <span className="text-foreground font-medium shrink-0">Tip:</span>
          <span>Click the <strong className="text-[var(--brand-red-dark)]">MENU</strong> button on the right edge for quick actions like grouping, coloring, and per-well style overrides.</span>
          <span className="text-lg ml-auto">&#8594;</span>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-[var(--brand-red-dark)] uppercase tracking-wide">Export Options</h3>
          <ul className="text-xs space-y-0.5 list-disc list-inside">
            <li>Plot images (PNG, SVG, JPEG)</li>
            <li>Amplification &amp; melt data as CSV</li>
            <li>Results table as CSV</li>
            <li>Save as <span className="font-mono">.sharp</span> (preserves edits to sample names, notes, and descriptions)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Plot Router ──────────────────────────────────────────────────────

export function PlotArea() {
  const plotTab = useAppState((s) => s.plotTab);
  const { menu, onContextMenu, openAt, close } = useContextMenu();
  const containerRef = useRef<HTMLDivElement>(null);
  // Store the mini-plot height as a fraction (0-1). Default 25%.
  const [miniRatio, setMiniRatio] = useState(0.25);

  const handleDividerDrag = useCallback((deltaY: number) => {
    if (!containerRef.current) return;
    const totalH = containerRef.current.getBoundingClientRect().height;
    if (totalH <= 0) return;
    setMiniRatio((prev) => {
      // Dragging down makes mini smaller, dragging up makes it bigger
      const next = prev - deltaY / totalH;
      return Math.max(0.1, Math.min(0.6, next)); // clamp 10%-60%
    });
  }, []);

  const experiments = useAppState((s) => s.experiments);
  const expIdx = useAppState((s) => s.activeExperimentIndex);
  const hasExperiment = !!experiments[expIdx];
  const hasMeltDerivative = useMemo(() => {
    const exp = experiments[expIdx];
    return exp?.melt && Object.keys(exp.melt.derivative).length > 0;
  }, [experiments, expIdx]);

  if (!hasExperiment) {
    return <WelcomeScreen />;
  }

  return (
    <div ref={containerRef} className="flex flex-col flex-1 min-w-0 min-h-0 h-full" onContextMenu={onContextMenu}>
      <PlotErrorBoundary>
        {plotTab === 'amplification' && (
          <>
            <div className="min-h-0" style={{ flex: hasMeltDerivative ? `${1 - miniRatio}` : '1' }}>
              <AmplificationPlot openContextMenu={openAt} />
            </div>
            {hasMeltDerivative && (
              <>
                <DragDivider onDrag={handleDividerDrag} />
                <div className="min-h-0" style={{ flex: `${miniRatio}`, minHeight: 100 }}>
                  <MeltDerivMini openContextMenu={openAt} />
                </div>
              </>
            )}
          </>
        )}
        {plotTab === 'melt' && (
          <div className="flex-1 min-h-0">
            <MeltPlot openContextMenu={openAt} />
          </div>
        )}
        {plotTab === 'doubling' && (
          <div className="flex-1 min-h-0">
            <DilutionPlot />
          </div>
        )}
      </PlotErrorBoundary>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={close} />}
    </div>
  );
}
