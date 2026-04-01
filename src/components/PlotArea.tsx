import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import _createPlotlyComponent from 'react-plotly.js/factory';
import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import { analyzeDilutionSeries, savitzkyGolaySmooth } from '@/lib/analysis';
import { THRESHOLD_LINE_COLOR, MOD_KEY, getPaletteColors } from '@/lib/constants';
import { Checkbox } from '@/components/ui/checkbox';
import { useBoxSelect, BOX_SELECT_OVERLAY_STYLE } from '@/hooks/useBoxSelect';
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
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains('dark'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  const plotBg = customBg || (isDark ? '#1e1e1e' : '#fafafa');
  return { plotBg, isDark };
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
  return {
    lineWidth: useAppState((s) => s.lineWidth),
    palette: useAppState((s) => s.palette),
    showGrid: useAppState((s) => s.showGrid),
    gridAlpha: useAppState((s) => s.gridAlpha),
    fontFamily: useAppState((s) => s.fontFamily),
    titleSize: useAppState((s) => s.titleSize),
    labelSize: useAppState((s) => s.labelSize),
    tickSize: useAppState((s) => s.tickSize),
    legendSize: useAppState((s) => s.legendSize),
    showLegend: useAppState((s) => s.showLegend),
    legendPosition: useAppState((s) => s.legendPosition),
    legendVisibleOnly: useAppState((s) => s.legendVisibleOnly),
  };
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
      bgcolor: isDark ? 'rgba(30,30,30,0.85)' : 'rgba(255,255,255,0.8)',
    },
  };
}

function gridStyle(style: ReturnType<typeof usePlotStyle>, isDark = false) {
  const base = isDark ? '255,255,255' : '0,0,0';
  return { showgrid: style.showGrid, gridcolor: `rgba(${base},${style.gridAlpha})` };
}

/** Global Plotly font color for dark/light mode */
function plotFontColor(isDark: boolean) {
  return isDark ? 'rgba(255,255,255,0.87)' : '#212224';
}

function getWellLineStyle(well: string, overrides: Map<string, unknown>) {
  const ov = overrides.get(well) as { lineStyle?: string; lineWidth?: number } | undefined;
  return { dash: ov?.lineStyle, width: ov?.lineWidth };
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
  return useMemo(() => {
    const colorMap = new Map<string, string>();
    if (visibleWells.length === 0) return colorMap;

    // Build palette units
    const units: [number, string[]][] = [];

    if (groupColors) {
      // Grouped mode: each group = 1 unit, ungrouped wells = individual units
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
          const tt = analysisResults?.get(w)?.tt;
          if (tt != null) { sum += tt; count++; }
        }
        units.push([count > 0 ? sum / count : Infinity, members]);
      }
      for (const well of ungrouped) {
        const tt = analysisResults?.get(well)?.tt;
        units.push([tt ?? Infinity, [well]]);
      }
    } else {
      // Individual mode: one color per well
      for (const well of visibleWells) {
        const tt = analysisResults?.get(well)?.tt ?? Infinity;
        units.push([tt, [well]]);
      }
    }

    // Sort by Tt ascending
    if (analysisResults && analysisResults.size > 0) {
      units.sort((a, b) => a[0] - b[0]);
    }

    let colors = getPaletteColors(paletteName, units.length);
    if (paletteReversed) colors = [...colors].reverse();

    for (let i = 0; i < units.length; i++) {
      const color = colors[i % colors.length];
      for (const well of units[i][1]) {
        colorMap.set(well, color);
      }
    }

    // Apply per-well style overrides (highest priority)
    for (const [well, ov] of wellStyleOverrides.entries()) {
      const override = ov as { color?: string } | undefined;
      if (override?.color) colorMap.set(well, override.color);
    }

    return colorMap;
  }, [visibleWells, paletteName, wellGroups, wellStyleOverrides, analysisResults, paletteReversed, groupColors]);
}

// ── Middle-mouse-button pan hook ─────────────────────────────────────
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

// Plot config: scroll zoom + reset button only, hide other controls
const PLOT_CONFIG: Partial<Plotly.Config> = {
  responsive: true,
  displayModeBar: true,
  scrollZoom: true,
  editable: false,
  modeBarButtonsToRemove: [
    'zoom2d', 'pan2d', 'select2d', 'lasso2d',
    'zoomIn2d', 'zoomOut2d', 'autoScale2d',
    'toImage',
  ] as Plotly.ModeBarDefaultButtons[],
};

// ── Amplification Plot ───────────────────────────────────────────────

function AmplificationPlot() {
  const { plotBg, isDark } = usePlotTheme();
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const logScale = useAppState((s) => s.logScale);
  const selectedWells = useAppState((s) => s.selectedWells);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const setSelectedWells = useAppState((s) => s.setSelectedWells);
  const selectOnly = useAppState((s) => s.selectOnly);
  const deselectAll = useAppState((s) => s.deselectAll);
  const toggleWellSelection = useAppState((s) => s.toggleWellSelection);
  const hoveredWell = useAppState((s) => s.hoveredWell);
  const setHoveredWell = useAppState((s) => s.setHoveredWell);
  const baselineEnabled = useAppState((s) => s.baselineEnabled);
  const baselineStart = useAppState((s) => s.baselineStart);
  const baselineEnd = useAppState((s) => s.baselineEnd);
  const showRawOverlay = useAppState((s) => s.showRawOverlay);
  const thresholdEnabled = useAppState((s) => s.thresholdEnabled);
  const thresholdRfu = useAppState((s) => s.thresholdRfu);
  const setThresholdRfu = useAppState((s) => s.setThresholdRfu);
  const showLegendAmp = useAppState((s) => s.showLegendAmp);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const paletteGroupColors = useAppState((s) => s.paletteGroupColors);
  const style = usePlotStyle();
  const analysisResults = useAnalysisResults();
  const dragPreviewWells = useAppState((s) => s.dragPreviewWells);
  const setDragPreviewWells = useAppState((s) => s.setDragPreviewWells);

  const wellGroups = useAppState((s) => s.wellGroups);

  const exp = experiments[idx];
  const amp = exp?.amplification;

  const visibleWells = useMemo(() => {
    if (!exp) return [];
    return exp.wellsUsed.filter((w) => !hiddenWells.has(w));
  }, [exp, hiddenWells]);

  const colorMap = useGroupedColors(
    exp?.wellsUsed ?? [], visibleWells, style.palette, wellGroups, wellStyleOverrides,
    analysisResults as Map<string, { tt?: number | null }>, paletteReversed,
    paletteGroupColors
  );

  const traces = useMemo((): Data[] => {
    if (!amp) {
      return [];
    }

    const xData = xAxisMode === 'cycle' ? amp.cycle : xAxisMode === 'time_s' ? amp.timeS : amp.timeMin;
    const result: Data[] = [];

    if (baselineEnabled && showRawOverlay) {
      for (const well of visibleWells) {
        const color = colorMap.get(well) ?? '#999';
        result.push({
          x: xData, y: amp.wells[well],
          type: 'scatter' as const, mode: 'lines' as const,
          name: `${well} (raw)`,
          line: { color, width: style.lineWidth * 0.5, dash: 'dot' },
          opacity: 0.3, hoverinfo: 'skip' as const, showlegend: false,
        });
      }
    }

    for (const well of visibleWells) {
      const color = colorMap.get(well) ?? '#999';
      const lsOverride = getWellLineStyle(well, wellStyleOverrides);
      const isSelected = selectedWells.size === 0 || selectedWells.has(well);
      const isHovered = hoveredWell === well;
      const isDragHighlighted = dragPreviewWells ? dragPreviewWells.has(well) : null;
      const analysis = analysisResults.get(well);
      const yData = (baselineEnabled && analysis?.correctedRfu) || amp.wells[well];
      const showInLegend = !style.legendVisibleOnly || isSelected;

      // During drag select: highlight wells inside box, grey out everything else
      let lineWidth = lsOverride.width ?? (isSelected ? style.lineWidth : style.lineWidth * 0.6);
      let opacity = isSelected ? 1.0 : 0.25;
      if (isDragHighlighted === true) { lineWidth = style.lineWidth * 1.4; opacity = 1.0; }
      else if (isDragHighlighted === false) { opacity = 0.15; }
      if (isHovered) { lineWidth = Math.max(lineWidth, style.lineWidth * 1.6); }

      result.push({
        x: xData, y: yData,
        type: 'scatter' as const, mode: 'lines' as const, name: well,
        line: {
          color,
          width: lineWidth,
          dash: lsOverride.dash as 'solid' | 'dash' | 'dot' | 'dashdot' | undefined,
        },
        opacity,
        hoverinfo: 'name' as const, showlegend: showInLegend,
      });
    }
    return result;
  }, [amp, exp, xAxisMode, selectedWells, hiddenWells, style.lineWidth,
      style.legendVisibleOnly, visibleWells, baselineEnabled, showRawOverlay,
      analysisResults, wellStyleOverrides, colorMap, hoveredWell, dragPreviewWells]);

  // Compute baseline zone x-axis boundaries
  const baselineZoneBounds = useMemo(() => {
    if (!baselineEnabled || !amp) return null;
    const cycle = amp.cycle;
    if (!cycle || cycle.length === 0) return null;
    const xData = xAxisMode === 'cycle' ? cycle : xAxisMode === 'time_s' ? amp.timeS : amp.timeMin;
    // baseline start/end are cycle numbers; find corresponding x values
    const startIdx = Math.max(0, baselineStart - 1); // cycles are 1-based
    const endIdx = Math.min(cycle.length - 1, baselineEnd - 1);
    if (startIdx >= xData.length || endIdx < 0) return null;
    return { x0: xData[startIdx], x1: xData[endIdx] };
  }, [baselineEnabled, amp, xAxisMode, baselineStart, baselineEnd]);

  const layout = useMemo((): Partial<Layout> => {
    const title = exp?.experimentId ?? 'Amplification Plot';
    const shapes: Partial<Shape>[] = [];

    // Baseline zone shading
    if (baselineZoneBounds) {
      shapes.push({
        type: 'rect',
        x0: baselineZoneBounds.x0, x1: baselineZoneBounds.x1, xref: 'x',
        y0: 0, y1: 1, yref: 'paper',
        fillcolor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
        line: { width: 0 },
        layer: 'below',
      });
    }

    // Threshold line (not Plotly-editable; dragged via custom mouse handler)
    if (thresholdEnabled) {
      shapes.push({
        type: 'line', x0: 0, x1: 1, xref: 'paper',
        y0: thresholdRfu, y1: thresholdRfu, yref: 'y',
        line: { color: isDark ? '#ef9a9d' : THRESHOLD_LINE_COLOR, width: 2, dash: 'dash' },
      });
    }
    return {
      title: { text: title, font: { family: style.fontFamily, size: style.titleSize } },
      xaxis: {
        title: { text: X_AXIS_LABELS[xAxisMode], font: { family: style.fontFamily, size: style.labelSize } },
        tickfont: { family: style.fontFamily, size: style.tickSize },
        ...gridStyle(style, isDark),
      },
      yaxis: {
        title: { text: baselineEnabled ? 'RFU (corrected)' : 'RFU', font: { family: style.fontFamily, size: style.labelSize } },
        type: logScale ? 'log' : 'linear',
        tickfont: { family: style.fontFamily, size: style.tickSize },
        ...gridStyle(style, isDark),
      },
      shapes,
      dragmode: false as Layout['dragmode'],
      autosize: true,
      margin: { l: 70, r: 20, t: 50, b: 50 },
      plot_bgcolor: plotBg, paper_bgcolor: plotBg, font: { color: plotFontColor(isDark) },
      ...legendLayout(style, showLegendAmp, traces, isDark),
      datarevision: Date.now(),
    };
  }, [exp, xAxisMode, logScale, thresholdEnabled, thresholdRfu, style, baselineEnabled, baselineZoneBounds, showLegendAmp, traces]);
  const rawOverlayCount = (baselineEnabled && showRawOverlay) ? visibleWells.length : 0;

  // Refs for box selection data matching
  const visibleWellsRef = useRef(visibleWells);
  visibleWellsRef.current = visibleWells;
  const ampRef = useRef(amp);
  ampRef.current = amp;
  const xAxisModeRef = useRef(xAxisMode);
  xAxisModeRef.current = xAxisMode;
  const baselineEnabledRef = useRef(baselineEnabled);
  baselineEnabledRef.current = baselineEnabled;
  const analysisResultsRef = useRef(analysisResults);
  analysisResultsRef.current = analysisResults;

  const matchWellsInBox = useCallback((x0: number, x1: number, y0: number, y1: number): Set<string> => {
    const currentAmp = ampRef.current;
    if (!currentAmp) return new Set();
    const mode = xAxisModeRef.current;
    const xData = mode === 'cycle' ? currentAmp.cycle : mode === 'time_s' ? currentAmp.timeS : currentAmp.timeMin;
    const matched = new Set<string>();
    for (const well of visibleWellsRef.current) {
      const analysis = analysisResultsRef.current.get(well);
      const yData = (baselineEnabledRef.current && analysis?.correctedRfu) || currentAmp.wells[well];
      for (let i = 0; i < xData.length; i++) {
        if (xData[i] >= x0 && xData[i] <= x1 && yData[i] >= y0 && yData[i] <= y1) {
          matched.add(well);
          break;
        }
      }
    }
    return matched;
  }, []);

  const handleBoxSelect = useCallback((x0: number, x1: number, y0: number, y1: number) => {
    const matched = matchWellsInBox(x0, x1, y0, y1);
    if (matched.size > 0) setSelectedWells(matched);
  }, [setSelectedWells, matchWellsInBox]);

  const handleDragMove = useCallback((x0: number, x1: number, y0: number, y1: number) => {
    setDragPreviewWells(matchWellsInBox(x0, x1, y0, y1));
  }, [matchWellsInBox]);

  const handleDragEnd = useCallback(() => setDragPreviewWells(null), []);

  const { containerRef: plotContainerRef, overlayRef: selectionOverlayRef, traceClickedRef } = useBoxSelect({
    onSelect: handleBoxSelect,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onEmptyClick: deselectAll,
    threshold: { enabled: thresholdEnabled, rfu: thresholdRfu, setRfu: setThresholdRfu },
  });

  const handleClick = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length || !visibleWells.length) return;
    const browserEvent = event.event as MouseEvent | undefined;
    if (browserEvent && browserEvent.button !== 0) return;
    traceClickedRef.current = true; // suppress empty-click deselect
    const traceIdx = event.points[0].curveNumber - rawOverlayCount;
    if (traceIdx < 0 || traceIdx >= visibleWells.length) return;
    const well = visibleWells[traceIdx];
    if (browserEvent && (browserEvent.ctrlKey || browserEvent.metaKey)) {
      toggleWellSelection(well);
    } else {
      selectOnly(well);
    }
  }, [visibleWells, rawOverlayCount, selectOnly, toggleWellSelection, traceClickedRef]);

  const handleHover = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length) return;
    const traceIdx = event.points[0].curveNumber - rawOverlayCount;
    if (traceIdx >= 0 && traceIdx < visibleWells.length) {
      setHoveredWell(visibleWells[traceIdx]);
    }
  }, [visibleWells, rawOverlayCount, setHoveredWell]);

  const handleUnhover = useCallback(() => setHoveredWell(null), [setHoveredWell]);

  useMiddleMousePan(plotContainerRef);

  return (
    <div ref={plotContainerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Plot
        data={traces} layout={layout}
        useResizeHandler style={{ width: '100%', height: '100%' }}
        config={PLOT_CONFIG}
        onClick={handleClick}
        onHover={handleHover}
        onUnhover={handleUnhover}
      />
      <div ref={selectionOverlayRef} style={BOX_SELECT_OVERLAY_STYLE} />
    </div>
  );
}

// ── Melt Derivative Mini-Plot (shown below amp plot) ─────────────────

function MeltDerivMini() {
  const { plotBg, isDark } = usePlotTheme();
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const selectedWells = useAppState((s) => s.selectedWells);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const wellGroups = useAppState((s) => s.wellGroups);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const paletteGroupColors = useAppState((s) => s.paletteGroupColors);
  const hoveredWell = useAppState((s) => s.hoveredWell);
  const setHoveredWell = useAppState((s) => s.setHoveredWell);
  const deselectAll = useAppState((s) => s.deselectAll);
  const style = usePlotStyle();
  const setSelectedWells = useAppState((s) => s.setSelectedWells);
  const selectOnly = useAppState((s) => s.selectOnly);
  const toggleWellSelection = useAppState((s) => s.toggleWellSelection);
  const analysisResults = useAnalysisResults();
  const dragPreviewWells = useAppState((s) => s.dragPreviewWells);
  const setDragPreviewWells = useAppState((s) => s.setDragPreviewWells);
  const smoothingEnabled = useAppState((s) => s.smoothingEnabled);
  const smoothingWindow = useAppState((s) => s.smoothingWindow);
  const smoothingMeltDerivative = useAppState((s) => s.smoothingMeltDerivative);
  const meltThresholdEnabled = useAppState((s) => s.meltThresholdEnabled);
  const meltThresholdValue = useAppState((s) => s.meltThresholdValue);
  const setMeltThresholdValue = useAppState((s) => s.setMeltThresholdValue);

  const exp = experiments[idx];
  const melt = exp?.melt;

  const visibleWells = useMemo(() => {
    if (!exp) return [];
    return exp.wellsUsed.filter((w) => !hiddenWells.has(w));
  }, [exp, hiddenWells]);

  const colorMap = useGroupedColors(
    exp?.wellsUsed ?? [], visibleWells, style.palette, wellGroups, wellStyleOverrides,
    analysisResults as Map<string, { tt?: number | null }>, paletteReversed,
    paletteGroupColors
  );

  const hasDerivative = melt && Object.keys(melt.derivative).length > 0;

  const smoothMeltDeriv = smoothingEnabled && smoothingMeltDerivative;

  // Pre-compute peak -dF/dT per well for threshold dimming
  const wellPeakDeriv = useMemo(() => {
    if (!melt || !hasDerivative) return new Map<string, number>();
    const peaks = new Map<string, number>();
    for (const well of visibleWells) {
      let derData = melt.derivative[well];
      if (!derData) continue;
      if (smoothMeltDeriv) derData = savitzkyGolaySmooth(derData, smoothingWindow);
      peaks.set(well, Math.max(...derData));
    }
    return peaks;
  }, [melt, visibleWells, hasDerivative, smoothMeltDeriv, smoothingWindow]);

  const traces = useMemo((): Data[] => {
    if (!melt || !hasDerivative) return [];
    const result: Data[] = [];
    for (const well of visibleWells) {
      const color = colorMap.get(well) ?? '#999';
      const isSelected = selectedWells.size === 0 || selectedWells.has(well);
      const isHovered = hoveredWell === well;
      const isDragHighlighted = dragPreviewWells ? dragPreviewWells.has(well) : null;
      let derData = melt.derivative[well];
      if (!derData) continue;
      if (smoothMeltDeriv) derData = savitzkyGolaySmooth(derData, smoothingWindow);
      let lineWidth = isSelected ? style.lineWidth : style.lineWidth * 0.6;
      let opacity = isSelected ? 1.0 : 0.25;
      if (isDragHighlighted === true) { lineWidth = style.lineWidth * 1.4; opacity = 1.0; }
      else if (isDragHighlighted === false) { opacity = 0.15; }
      if (isHovered) { lineWidth = Math.max(lineWidth, style.lineWidth * 1.6); }
      // Dim wells below melt threshold
      if (meltThresholdEnabled && (wellPeakDeriv.get(well) ?? 0) < meltThresholdValue) {
        opacity = Math.min(opacity, 0.25);
        lineWidth = Math.min(lineWidth, style.lineWidth * 0.6);
      }
      result.push({
        x: melt.temperatureC, y: derData,
        type: 'scatter' as const, mode: 'lines' as const, name: well,
        line: { color, width: lineWidth },
        opacity,
        hoverinfo: 'name' as const, showlegend: false,
      });
    }
    return result;
  }, [melt, visibleWells, selectedWells, style, hasDerivative, colorMap, hoveredWell, dragPreviewWells, smoothMeltDeriv, smoothingWindow, meltThresholdEnabled, meltThresholdValue, wellPeakDeriv]);

  const layout = useMemo((): Partial<Layout> => {
    const shapes: Partial<Shape>[] = [];
    if (meltThresholdEnabled) {
      shapes.push({
        type: 'line', x0: 0, x1: 1, xref: 'paper',
        y0: meltThresholdValue, y1: meltThresholdValue, yref: 'y',
        line: { color: isDark ? '#ef9a9d' : THRESHOLD_LINE_COLOR, width: 2.5, dash: 'dash' },
      });
    }
    return {
      xaxis: {
        title: { text: 'Temperature (°C)', font: { family: style.fontFamily, size: 9 } },
        tickfont: { family: style.fontFamily, size: 8 },
        ...gridStyle(style, isDark),
      },
      yaxis: {
        title: { text: '-dF/dT', font: { family: style.fontFamily, size: 9 } },
        tickfont: { family: style.fontFamily, size: 8 },
        ...gridStyle(style, isDark),
      },
      shapes: shapes as Layout['shapes'],
      dragmode: false as Layout['dragmode'],
      autosize: true,
      margin: { l: 60, r: 10, t: 10, b: 35 },
      plot_bgcolor: plotBg, paper_bgcolor: plotBg, font: { color: plotFontColor(isDark) },
      showlegend: false,
      datarevision: Date.now(),
    };
  }, [style, traces, meltThresholdEnabled, meltThresholdValue]);

  // Box select on melt derivative
  const visibleWellsRef = useRef(visibleWells);
  visibleWellsRef.current = visibleWells;
  const meltRef = useRef(melt);
  meltRef.current = melt;

  const matchWellsInBox = useCallback((x0: number, x1: number, y0: number, y1: number): Set<string> => {
    const m = meltRef.current;
    if (!m) return new Set();
    const matched = new Set<string>();
    for (const well of visibleWellsRef.current) {
      const yData = m.derivative[well];
      if (!yData) continue;
      for (let i = 0; i < m.temperatureC.length; i++) {
        if (m.temperatureC[i] >= x0 && m.temperatureC[i] <= x1 && yData[i] >= y0 && yData[i] <= y1) {
          matched.add(well);
          break;
        }
      }
    }
    return matched;
  }, []);

  const handleBoxSelect = useCallback((x0: number, x1: number, y0: number, y1: number) => {
    const matched = matchWellsInBox(x0, x1, y0, y1);
    if (matched.size > 0) setSelectedWells(matched);
  }, [setSelectedWells, matchWellsInBox]);

  const handleDragMove = useCallback((x0: number, x1: number, y0: number, y1: number) => {
    setDragPreviewWells(matchWellsInBox(x0, x1, y0, y1));
  }, [matchWellsInBox]);

  const handleDragEnd = useCallback(() => setDragPreviewWells(null), []);

  const { containerRef, overlayRef } = useBoxSelect({
    onSelect: handleBoxSelect,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onEmptyClick: deselectAll,
    meltThreshold: meltThresholdEnabled ? {
      enabled: true,
      value: meltThresholdValue,
      setValue: setMeltThresholdValue,
    } : undefined,
  });

  const handleClick = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length || !visibleWells.length) return;
    const browserEvent = event.event as MouseEvent | undefined;
    if (browserEvent && browserEvent.button !== 0) return;
    const ci = event.points[0].curveNumber;
    if (ci < 0 || ci >= visibleWells.length) return;
    const well = visibleWells[ci];
    if (browserEvent && (browserEvent.ctrlKey || browserEvent.metaKey)) {
      toggleWellSelection(well);
    } else {
      selectOnly(well);
    }
  }, [visibleWells, selectOnly, toggleWellSelection]);

  const handleHover = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length) return;
    const ci = event.points[0].curveNumber;
    if (ci >= 0 && ci < visibleWells.length) setHoveredWell(visibleWells[ci]);
  }, [visibleWells, setHoveredWell]);

  const handleUnhover = useCallback(() => setHoveredWell(null), [setHoveredWell]);

  useMiddleMousePan(containerRef);

  if (!hasDerivative) return null;

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Plot
        data={traces} layout={layout}
        useResizeHandler style={{ width: '100%', height: '100%' }}
        config={PLOT_CONFIG}
        onClick={handleClick}
        onHover={handleHover}
        onUnhover={handleUnhover}
      />
      <div ref={overlayRef} style={BOX_SELECT_OVERLAY_STYLE} />
    </div>
  );
}

// ── Melt Plot (stacked subplots — full tab) ──────────────────────────

function MeltPlot() {
  const { plotBg, isDark } = usePlotTheme();
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const selectedWells = useAppState((s) => s.selectedWells);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const wellGroups = useAppState((s) => s.wellGroups);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const paletteGroupColors = useAppState((s) => s.paletteGroupColors);
  const setSelectedWells = useAppState((s) => s.setSelectedWells);
  const selectOnly = useAppState((s) => s.selectOnly);
  const deselectAll = useAppState((s) => s.deselectAll);
  const toggleWellSelection = useAppState((s) => s.toggleWellSelection);
  const hoveredWell = useAppState((s) => s.hoveredWell);
  const setHoveredWell = useAppState((s) => s.setHoveredWell);
  const showLegendMelt = useAppState((s) => s.showLegendMelt);
  const style = usePlotStyle();
  const analysisResults = useAnalysisResults();
  const dragPreviewWells = useAppState((s) => s.dragPreviewWells);
  const setDragPreviewWells = useAppState((s) => s.setDragPreviewWells);
  const smoothingEnabled = useAppState((s) => s.smoothingEnabled);
  const smoothingWindow = useAppState((s) => s.smoothingWindow);
  const smoothingMeltDerivative = useAppState((s) => s.smoothingMeltDerivative);
  const meltThresholdEnabled = useAppState((s) => s.meltThresholdEnabled);
  const meltThresholdValue = useAppState((s) => s.meltThresholdValue);

  const exp = experiments[idx];
  const melt = exp?.melt;

  const visibleWells = useMemo(() => {
    if (!exp) return [];
    return exp.wellsUsed.filter((w) => !hiddenWells.has(w));
  }, [exp, hiddenWells]);

  const colorMap = useGroupedColors(
    exp?.wellsUsed ?? [], visibleWells, style.palette, wellGroups, wellStyleOverrides,
    analysisResults as Map<string, { tt?: number | null }>, paletteReversed,
    paletteGroupColors
  );

  const hasDerivative = melt && Object.keys(melt.derivative).length > 0;
  const smoothMeltDeriv = smoothingEnabled && smoothingMeltDerivative;

  // Pre-compute peak -dF/dT per well for threshold dimming
  const wellPeakDeriv = useMemo(() => {
    if (!melt || !hasDerivative) return new Map<string, number>();
    const peaks = new Map<string, number>();
    for (const well of visibleWells) {
      let derData = melt.derivative[well];
      if (!derData) continue;
      if (smoothMeltDeriv) derData = savitzkyGolaySmooth(derData, smoothingWindow);
      peaks.set(well, Math.max(...derData));
    }
    return peaks;
  }, [melt, visibleWells, hasDerivative, smoothMeltDeriv, smoothingWindow]);

  const traces = useMemo((): Data[] => {
    if (!melt) return [];
    const result: Data[] = [];

    for (const well of visibleWells) {
      const color = colorMap.get(well) ?? '#999';
      const isSelected = selectedWells.size === 0 || selectedWells.has(well);
      const isHovered = hoveredWell === well;
      const isDragHighlighted = dragPreviewWells ? dragPreviewWells.has(well) : null;
      const rfuData = melt.rfu[well];
      if (!rfuData) continue;
      const showInLegend = !style.legendVisibleOnly || isSelected;
      let lineWidth = isSelected ? style.lineWidth : style.lineWidth * 0.6;
      let opacity = isSelected ? 1.0 : 0.25;
      if (isDragHighlighted === true) { lineWidth = style.lineWidth * 1.4; opacity = 1.0; }
      else if (isDragHighlighted === false) { opacity = 0.15; }
      if (isHovered) { lineWidth = Math.max(lineWidth, style.lineWidth * 1.6); }
      // Dim wells below melt threshold (also dims RFU trace)
      if (meltThresholdEnabled && (wellPeakDeriv.get(well) ?? 0) < meltThresholdValue) {
        opacity = Math.min(opacity, 0.25);
        lineWidth = Math.min(lineWidth, style.lineWidth * 0.6);
      }
      result.push({
        x: melt.temperatureC, y: rfuData,
        type: 'scatter' as const, mode: 'lines' as const, name: well,
        line: { color, width: lineWidth },
        opacity,
        hoverinfo: 'name' as const, yaxis: 'y', showlegend: showInLegend,
      });
    }

    if (hasDerivative) {
      for (const well of visibleWells) {
        const color = colorMap.get(well) ?? '#999';
        const isSelected = selectedWells.size === 0 || selectedWells.has(well);
        const isHovered = hoveredWell === well;
        const isDragHighlighted = dragPreviewWells ? dragPreviewWells.has(well) : null;
        let derData = melt.derivative[well];
        if (!derData) continue;
        if (smoothMeltDeriv) derData = savitzkyGolaySmooth(derData, smoothingWindow);
        let lineWidth = isSelected ? style.lineWidth : style.lineWidth * 0.6;
        let opacity = isSelected ? 1.0 : 0.25;
        if (isDragHighlighted === true) { lineWidth = style.lineWidth * 1.4; opacity = 1.0; }
        else if (isDragHighlighted === false) { opacity = 0.15; }
        if (isHovered) { lineWidth = Math.max(lineWidth, style.lineWidth * 1.6); }
        // Dim derivative traces below melt threshold
        if (meltThresholdEnabled && (wellPeakDeriv.get(well) ?? 0) < meltThresholdValue) {
          opacity = Math.min(opacity, 0.25);
          lineWidth = Math.min(lineWidth, style.lineWidth * 0.6);
        }
        result.push({
          x: melt.temperatureC, y: derData,
          type: 'scatter' as const, mode: 'lines' as const, name: well,
          line: { color, width: lineWidth },
          opacity,
          hoverinfo: 'name' as const, yaxis: 'y2', showlegend: false,
        });
      }
    }
    return result;
  }, [melt, visibleWells, selectedWells, style, hasDerivative, colorMap, hoveredWell, dragPreviewWells, smoothMeltDeriv, smoothingWindow, meltThresholdEnabled, meltThresholdValue, wellPeakDeriv]);

  const layout = useMemo((): Partial<Layout> => {
    const title = exp?.experimentId ? `${exp.experimentId} — Melt` : 'Melt Curve';
    const grid = gridStyle(style, isDark);
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
        title: { text: title, font: { family: style.fontFamily, size: style.titleSize } },
        xaxis: { title: { text: 'Temperature (°C)', font: { family: style.fontFamily, size: style.labelSize } }, tickfont: { family: style.fontFamily, size: style.tickSize }, ...grid },
        yaxis: { title: { text: 'RFU', font: { family: style.fontFamily, size: style.labelSize } }, tickfont: { family: style.fontFamily, size: style.tickSize }, domain: [0.55, 1], ...grid },
        yaxis2: { title: { text: '-dF/dT', font: { family: style.fontFamily, size: style.labelSize } }, tickfont: { family: style.fontFamily, size: style.tickSize }, domain: [0, 0.45], anchor: 'x', ...grid },
        shapes: shapes as Layout['shapes'],
        dragmode: false as Layout['dragmode'], autosize: true, margin: { l: 70, r: 20, t: 50, b: 50 },
        plot_bgcolor: plotBg, paper_bgcolor: plotBg, font: { color: plotFontColor(isDark) }, ...legendLayout(style, showLegendMelt, traces, isDark),
        datarevision: Date.now(),
      };
    }
    return {
      title: { text: title, font: { family: style.fontFamily, size: style.titleSize } },
      xaxis: { title: { text: 'Temperature (°C)', font: { family: style.fontFamily, size: style.labelSize } }, tickfont: { family: style.fontFamily, size: style.tickSize }, ...grid },
      yaxis: { title: { text: 'RFU', font: { family: style.fontFamily, size: style.labelSize } }, tickfont: { family: style.fontFamily, size: style.tickSize }, ...grid },
      dragmode: false as Layout['dragmode'], autosize: true, margin: { l: 70, r: 20, t: 50, b: 50 },
      plot_bgcolor: plotBg, paper_bgcolor: plotBg, font: { color: plotFontColor(isDark) }, ...legendLayout(style, showLegendMelt, traces, isDark),
      datarevision: Date.now(),
    };
  }, [exp, style, hasDerivative, traces, showLegendMelt, meltThresholdEnabled, meltThresholdValue]);

  // Box select on melt plot (uses RFU y-axis for matching)
  const visibleWellsRef = useRef(visibleWells);
  visibleWellsRef.current = visibleWells;
  const meltRef = useRef(melt);
  meltRef.current = melt;

  const smoothMeltDerivRef = useRef(smoothMeltDeriv);
  smoothMeltDerivRef.current = smoothMeltDeriv;
  const smoothingWindowRef = useRef(smoothingWindow);
  smoothingWindowRef.current = smoothingWindow;

  const matchWellsInBox = useCallback((x0: number, x1: number, y0: number, y1: number, y2Bounds?: { y0: number; y1: number }): Set<string> => {
    const m = meltRef.current;
    if (!m) return new Set();
    const matched = new Set<string>();
    for (const well of visibleWellsRef.current) {
      // Check RFU traces (yaxis)
      const rfuData = m.rfu[well];
      if (rfuData) {
        for (let i = 0; i < m.temperatureC.length; i++) {
          if (m.temperatureC[i] >= x0 && m.temperatureC[i] <= x1 && rfuData[i] >= y0 && rfuData[i] <= y1) {
            matched.add(well);
            break;
          }
        }
      }
      // Check derivative traces (yaxis2)
      if (!matched.has(well) && y2Bounds) {
        let derData = m.derivative[well];
        if (derData) {
          if (smoothMeltDerivRef.current) derData = savitzkyGolaySmooth(derData, smoothingWindowRef.current);
          for (let i = 0; i < m.temperatureC.length; i++) {
            if (m.temperatureC[i] >= x0 && m.temperatureC[i] <= x1 && derData[i] >= y2Bounds.y0 && derData[i] <= y2Bounds.y1) {
              matched.add(well);
              break;
            }
          }
        }
      }
    }
    return matched;
  }, []);

  const handleBoxSelect = useCallback((x0: number, x1: number, y0: number, y1: number, y2Bounds?: { y0: number; y1: number }) => {
    const matched = matchWellsInBox(x0, x1, y0, y1, y2Bounds);
    if (matched.size > 0) setSelectedWells(matched);
  }, [setSelectedWells, matchWellsInBox]);

  const handleDragMove = useCallback((x0: number, x1: number, y0: number, y1: number, y2Bounds?: { y0: number; y1: number }) => {
    setDragPreviewWells(matchWellsInBox(x0, x1, y0, y1, y2Bounds));
  }, [matchWellsInBox]);

  const handleDragEnd = useCallback(() => setDragPreviewWells(null), []);

  const { containerRef, overlayRef, traceClickedRef } = useBoxSelect({
    onSelect: handleBoxSelect,
    onDragMove: handleDragMove,
    onDragEnd: handleDragEnd,
    onEmptyClick: deselectAll,
  });

  const handleClick = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length || !visibleWells.length) return;
    const browserEvent = event.event as MouseEvent | undefined;
    if (browserEvent && browserEvent.button !== 0) return;
    traceClickedRef.current = true;
    const ci = event.points[0].curveNumber;
    const wellIdx = ci < visibleWells.length ? ci : ci - visibleWells.length;
    if (wellIdx < 0 || wellIdx >= visibleWells.length) return;
    const well = visibleWells[wellIdx];
    if (browserEvent && (browserEvent.ctrlKey || browserEvent.metaKey)) {
      toggleWellSelection(well);
    } else {
      selectOnly(well);
    }
  }, [visibleWells, selectOnly, toggleWellSelection, traceClickedRef]);

  const handleHover = useCallback((event: Readonly<PlotMouseEvent>) => {
    if (!event.points.length) return;
    const ci = event.points[0].curveNumber;
    const wellIdx = ci < visibleWells.length ? ci : ci - visibleWells.length;
    if (wellIdx >= 0 && wellIdx < visibleWells.length) setHoveredWell(visibleWells[wellIdx]);
  }, [visibleWells, setHoveredWell]);

  const handleUnhover = useCallback(() => setHoveredWell(null), [setHoveredWell]);

  useMiddleMousePan(containerRef);

  if (!melt) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No melt data available</div>;
  }

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Plot
        data={traces} layout={layout}
        useResizeHandler style={{ width: '100%', height: '100%' }}
        config={PLOT_CONFIG}
        onClick={handleClick}
        onHover={handleHover}
        onUnhover={handleUnhover}
      />
      <div ref={overlayRef} style={BOX_SELECT_OVERLAY_STYLE} />
    </div>
  );
}

// ── Doubling Time / Standard Curve Tab ────────────────────────────────

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
  const { plotBg, isDark } = usePlotTheme();
  const dilutionConfig = useAppState((s) => s.dilutionConfig);
  const setDilutionStepEnabled = useAppState((s) => s.setDilutionStepEnabled);
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const style = usePlotStyle();
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

  const layout = useMemo((): Partial<Layout> => {
    const title = exp?.experimentId ? `${exp.experimentId} — Standard Curve` : 'Standard Curve';
    return {
      title: { text: title, font: { family: style.fontFamily, size: style.titleSize } },
      xaxis: {
        title: { text: `log₂(Concentration${unit ? ', ' + unit : ''})`, font: { family: style.fontFamily, size: style.labelSize } },
        tickfont: { family: style.fontFamily, size: style.tickSize }, ...gridStyle(style, isDark),
      },
      yaxis: {
        title: { text: `${xLabel} (${X_AXIS_LABELS[xAxisMode]})`, font: { family: style.fontFamily, size: style.labelSize } },
        tickfont: { family: style.fontFamily, size: style.tickSize }, ...gridStyle(style, isDark),
      },
      autosize: true, margin: { l: 70, r: 20, t: 50, b: 50 },
      plot_bgcolor: plotBg, paper_bgcolor: plotBg, font: { color: plotFontColor(isDark) },
      datarevision: Date.now(),
    };
  }, [exp, xAxisMode, xLabel, style, unit]);

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {!dilutionConfig
          ? 'Use Tools → Doubling Time Wizard to configure a dilution series'
          : 'Not enough data — assign wells with valid Tt values to at least 2 steps'}
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
      <div className="flex-1 min-h-0">
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

/** Per-well Tt vs Dt scatter (fallback when no dilution config) */
function PerWellDoublingPlot() {
  const doublingRef = useRef<HTMLDivElement>(null);
  useMiddleMousePan(doublingRef);
  const { plotBg, isDark } = usePlotTheme();
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const showLegendDoubling = useAppState((s) => s.showLegendDoubling);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const paletteGroupColors = useAppState((s) => s.paletteGroupColors);
  const style = usePlotStyle();
  const analysisResults = useAnalysisResults();
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const wellGroups = useAppState((s) => s.wellGroups);

  const exp = experiments[idx];

  const dtVisibleWells = useMemo(() => {
    if (!exp) return [];
    return exp.wellsUsed.filter((w) => !hiddenWells.has(w));
  }, [exp, hiddenWells]);

  const colorMap = useGroupedColors(
    exp?.wellsUsed ?? [], dtVisibleWells, style.palette, wellGroups, wellStyleOverrides,
    analysisResults as Map<string, { tt?: number | null }>, paletteReversed,
    paletteGroupColors
  );

  const data = useMemo(() => {
    if (!exp) return { wells: [] as string[], tts: [] as number[], dts: [] as number[], colors: [] as string[] };
    const wells: string[] = [], tts: number[] = [], dts: number[] = [], cs: string[] = [];
    for (const well of dtVisibleWells) {
      const r = analysisResults.get(well);
      if (!r || r.tt == null || r.dt == null) continue;
      wells.push(well); tts.push(r.tt); dts.push(r.dt);
      cs.push(colorMap.get(well) ?? '#999');
    }
    return { wells, tts, dts, colors: cs };
  }, [exp, dtVisibleWells, analysisResults, colorMap]);

  const xLabel = xAxisMode === 'cycle' ? 'Ct' : 'Tt';

  const traces = useMemo((): Data[] => {
    if (data.wells.length === 0) return [];
    return [{ x: data.tts, y: data.dts, type: 'scatter' as const, mode: 'text+markers' as const,
      text: data.wells, textposition: 'top center' as const,
      textfont: { size: 9, family: style.fontFamily },
      marker: { color: data.colors, size: 8 }, hoverinfo: 'text' as const, showlegend: false }];
  }, [data, style.fontFamily]);

  const layout = useMemo((): Partial<Layout> => {
    const title = exp?.experimentId ? `${exp.experimentId} — Doubling Time` : 'Doubling Time';
    return {
      title: { text: title, font: { family: style.fontFamily, size: style.titleSize } },
      xaxis: { title: { text: `${xLabel} (${X_AXIS_LABELS[xAxisMode]})`, font: { family: style.fontFamily, size: style.labelSize } }, tickfont: { family: style.fontFamily, size: style.tickSize }, ...gridStyle(style, isDark) },
      yaxis: { title: { text: 'Doubling Time', font: { family: style.fontFamily, size: style.labelSize } }, tickfont: { family: style.fontFamily, size: style.tickSize }, ...gridStyle(style, isDark) },
      autosize: true, margin: { l: 70, r: 20, t: 50, b: 50 },
      plot_bgcolor: plotBg, paper_bgcolor: plotBg, font: { color: plotFontColor(isDark) }, ...legendLayout(style, showLegendDoubling, traces, isDark),
      datarevision: Date.now(),
    };
  }, [exp, xAxisMode, xLabel, style, traces, showLegendDoubling]);

  if (data.wells.length === 0) {
    return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
      {!exp ? 'No data loaded' : 'Enable threshold detection to calculate doubling times'}
    </div>;
  }

  return (
    <div ref={doublingRef} style={{ width: '100%', height: '100%' }}>
      <Plot data={traces} layout={layout}
        useResizeHandler style={{ width: '100%', height: '100%' }}
        config={PLOT_CONFIG} />
    </div>
  );
}

/** Routes between dilution standard curve and per-well scatter */
function DoublingTimePlot() {
  const dilutionConfig = useAppState((s) => s.dilutionConfig);
  return dilutionConfig ? <DilutionPlot /> : <PerWellDoublingPlot />;
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
  const { menu, onContextMenu, close } = useContextMenu();
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
              <AmplificationPlot />
            </div>
            {hasMeltDerivative && (
              <>
                <DragDivider onDrag={handleDividerDrag} />
                <div className="min-h-0" style={{ flex: `${miniRatio}`, minHeight: 100 }}>
                  <MeltDerivMini />
                </div>
              </>
            )}
          </>
        )}
        {plotTab === 'melt' && (
          <div className="flex-1 min-h-0">
            <MeltPlot />
          </div>
        )}
        {plotTab === 'doubling' && (
          <div className="flex-1 min-h-0">
            <DoublingTimePlot />
          </div>
        )}
      </PlotErrorBoundary>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={close} />}
    </div>
  );
}
