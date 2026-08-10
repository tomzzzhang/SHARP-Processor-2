/**
 * Panel decorations applied on top of a built figure: explicit axis titles and
 * ranges, tick control, frames, annotations, and reference lines.
 *
 * These compose over `buildFigure`'s output rather than replacing any of it —
 * the traces, colours, threshold and legend all still come from
 * `plot-figure.ts`. What is added here is figure-authoring capability that the
 * GUI has no control for yet, so there is nothing upstream to consume.
 *
 * When the app gains these controls (they are the Tier 2 list: annotations,
 * reference lines with legend entries, tick format/direction, minor ticks,
 * frames, log2 axes), the natural home for them is optional fields on
 * `BuildFigureInput`, and this module becomes the code that moves there. It is
 * written as pure layout transforms to keep that lift mechanical.
 */
import type { Layout, Shape } from 'plotly.js';
import { LEGEND_POS_MAP, type PlotFigureStyle } from '@/lib/plot-figure';
import { SpecError, type AnnotationSpec, type AxisSpec, type LegendSpec, type PlotPanel, type ReferenceLineSpec } from './spec';
import { deriveMargins, wantsAutoMargins } from './margins';

type AxisLayout = Record<string, unknown>;

/** Drop keys whose value is undefined, so a partial override leaves the rest. */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return out as Partial<T>;
}

/** log2 has no native Plotly axis type. Plot on a log10 axis and relabel the
 *  ticks in powers of two, which is what a log2 axis actually is. */
function applyLog2Ticks(axis: AxisLayout, range: [number, number] | null): void {
  axis.type = 'log';
  // 1 decade = log10(2) ≈ 0.301 per doubling; tick every doubling.
  axis.dtick = Math.log10(2);
  axis.tickformat = undefined;
  if (range) axis.range = [Math.log10(range[0]), Math.log10(range[1])];
}

function applyAxisSpec(axis: AxisLayout | undefined, spec: AxisSpec | null | undefined, style: PlotFigureStyle): void {
  if (!axis || !spec) return;

  // Title text and standoff are merged into one object rather than assigned
  // independently — setting one must not clobber the other, and standoff
  // alone (no text override) still needs somewhere to land.
  if ((spec.title !== undefined && spec.title !== null) || spec.titleStandoff != null) {
    const existing = (axis.title ?? {}) as { text?: string; font?: unknown };
    axis.title = {
      text: spec.title ?? existing.text,
      font: existing.font ?? { family: style.fontFamily, size: style.labelSize },
      ...(spec.titleStandoff != null ? { standoff: spec.titleStandoff } : {}),
    };
  }

  if (spec.scale === 'log2') {
    applyLog2Ticks(axis, spec.range ?? null);
  } else {
    if (spec.scale === 'log') axis.type = 'log';
    else if (spec.scale === 'linear') axis.type = 'linear';
    if (spec.range) {
      // A log axis takes its range in decades, which is a reliable way to get
      // an empty plot if the caller passes data units.
      axis.range = axis.type === 'log'
        ? [Math.log10(spec.range[0]), Math.log10(spec.range[1])]
        : spec.range;
      axis.autorange = false;
    }
    if (spec.dtick !== undefined && spec.dtick !== null) axis.dtick = spec.dtick;
  }

  if (spec.tickFormat !== undefined && spec.tickFormat !== null) axis.tickformat = spec.tickFormat;
  if (spec.tickDirection !== undefined && spec.tickDirection !== null) axis.ticks = spec.tickDirection;
  if (spec.minorTicks) axis.minor = { ticks: spec.tickDirection || 'outside', showgrid: false };
  if (spec.frame !== undefined && spec.frame !== null) {
    axis.mirror = spec.frame ? 'all' : false;
    axis.showline = spec.frame;
    if (spec.frame) axis.linecolor = style.isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
  }
  if (spec.lineColor) axis.linecolor = spec.lineColor;
  if (spec.lineWidth != null) axis.linewidth = spec.lineWidth;
  if (spec.gridDash) axis.griddash = spec.gridDash;
  if (spec.gridColor) axis.gridcolor = spec.gridColor;
  if (spec.zeroline !== undefined && spec.zeroline !== null) axis.zeroline = spec.zeroline;

  if (spec.tickVals?.length && spec.tickText?.length) {
    if (spec.tickVals.length !== spec.tickText.length) {
      throw new SpecError('xaxis/yaxis tickVals and tickText must be the same length.');
    }
    axis.tickmode = 'array';
    axis.tickvals = spec.tickVals;
    axis.ticktext = spec.tickText;
  }
}

function toPlotlyAnnotation(a: AnnotationSpec, style: PlotFigureStyle) {
  return {
    text: a.bold ? `<b>${a.text}</b>` : a.italic ? `<i>${a.text}</i>` : a.text,
    x: a.x,
    y: a.y,
    xref: a.xref ?? 'paper',
    yref: a.yref ?? 'paper',
    xanchor: a.xanchor ?? 'left',
    yanchor: a.yanchor ?? 'top',
    showarrow: Boolean(a.arrow),
    ax: a.ax ?? 0,
    ay: a.ay ?? -20,
    font: {
      family: style.fontFamily,
      size: a.size ?? style.legendSize,
      color: a.color ?? (style.textColor === 'white' ? '#ffffff' : '#000000'),
    },
  };
}

function toPlotlyShape(line: ReferenceLineSpec): Partial<Shape> {
  const common = {
    type: 'line' as const,
    line: {
      color: line.color ?? '#666666',
      width: line.width ?? 1.5,
      dash: line.dash ?? 'dash',
    },
  };
  // A horizontal line is constant in y and spans the plot in x, and vice versa.
  return line.axis === 'y'
    ? { ...common, x0: 0, x1: 1, xref: 'paper', y0: line.value, y1: line.value, yref: 'y' }
    : { ...common, y0: 0, y1: 1, yref: 'paper', x0: line.value, x1: line.value, xref: 'x' };
}

/** A legend entry for a reference line: an invisible trace carrying the label,
 *  drawn with the line's own styling so the swatch matches. */
function referenceLineLegendTrace(line: ReferenceLineSpec) {
  return {
    x: [null],
    y: [null],
    type: 'scatter' as const,
    mode: 'lines' as const,
    name: line.legend!,
    line: {
      color: line.color ?? '#666666',
      width: line.width ?? 1.5,
      dash: line.dash ?? 'dash',
    },
    showlegend: true,
    hoverinfo: 'skip' as const,
    legendrank: 20000,
  };
}

/** Reference lines that carry a legend entry, as Plotly traces. */
export function referenceLineTraces(panel: PlotPanel): ReturnType<typeof referenceLineLegendTrace>[] {
  return (panel.referenceLines ?? []).filter((l) => l.legend).map(referenceLineLegendTrace);
}

/**
 * Move the named entries into the panel's second legend.
 *
 * Matches a data trace by its bare group name (traces carry `grp:<name>` as
 * `legendgroup` in group-content mode) and a reference-line legend trace by
 * its literal `name` (reference lines have no legendgroup). Plotly reads a
 * trace's target legend from its own `legend` field — `"legend2"` for the
 * second, undefined/`"legend"` for the first — a feature `@types/plotly.js`
 * does not model, hence the loose cast.
 */
export function assignLegend2(data: readonly unknown[], groups: readonly string[]): void {
  if (groups.length === 0) return;
  const set = new Set(groups);
  for (const trace of data) {
    const t = trace as { legendgroup?: string; name?: string; showlegend?: boolean; legend?: string };
    if (!t.showlegend) continue;
    const bareGroup = t.legendgroup?.startsWith('grp:') ? t.legendgroup.slice(4) : undefined;
    if ((bareGroup && set.has(bareGroup)) || (t.name && set.has(t.name))) {
      t.legend = 'legend2';
    }
  }
}

/** Shared styling for a legend layout patch — used for both `legend` and
 *  `legend2`, which follow identical appearance rules. */
function buildLegendLayout(
  lg: LegendSpec,
  style: PlotFigureStyle,
  base: Partial<Layout['legend']> = {},
): Record<string, unknown> {
  const pos = lg.position === 'best' ? LEGEND_POS_MAP['upper right'] : (LEGEND_POS_MAP[lg.position ?? 'upper right'] ?? LEGEND_POS_MAP['upper right']);
  const legend: Record<string, unknown> = {
    font: { family: style.fontFamily, size: lg.fontSize ?? style.legendSize },
    x: lg.x ?? pos.x,
    y: lg.y ?? pos.y,
    xanchor: pos.xanchor,
    yanchor: pos.yanchor,
    bgcolor: style.isDark ? '#1f1f1f' : '#ffffff',
    bordercolor: style.isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)',
    borderwidth: 1,
    tracegroupgap: 0,
    ...base,
  };
  if (lg.title) legend.title = { text: lg.title, font: { family: style.fontFamily, size: lg.fontSize ?? style.legendSize } };
  if (lg.frame === false) {
    legend.borderwidth = 0;
    legend.bgcolor = 'rgba(0,0,0,0)';
  } else if (lg.frame === true) {
    legend.borderwidth = 1;
  }
  if (lg.bgcolor) legend.bgcolor = lg.bgcolor === 'transparent' ? 'rgba(0,0,0,0)' : lg.bgcolor;
  if (lg.itemGap != null) legend.tracegroupgap = lg.itemGap;
  if (lg.orientation) legend.orientation = lg.orientation;
  if (lg.entryWidthPx != null) {
    legend.entrywidth = lg.entryWidthPx;
    legend.entrywidthmode = 'pixels';
  }
  return legend;
}

/**
 * A legend placed outside the axes needs room that `computeMargins` does not
 * allocate — it returns a fixed 20px right margin, so an outside legend is
 * drawn past the figure edge and clipped.
 *
 * Widen the margin here rather than in `plot-figure.ts`: changing that
 * function would change what the shipped app's Export Wizard produces for
 * every existing figure, which this work is not allowed to do. (The same
 * clipping affects the Export Wizard, and is worth fixing upstream as its own
 * reviewed change.)
 */
function reserveOutsideLegend(layout: Partial<Layout>, data: readonly unknown[], style: PlotFigureStyle): void {
  if (!style.showLegend) return;
  const pos = style.legendPosition;
  // The positions that sit outside the plotting area.
  if (pos !== 'right' && pos !== 'outside right') return;

  let longest = 0;
  for (const trace of data) {
    const t = trace as { name?: string; showlegend?: boolean };
    if (t.showlegend === false || !t.name) continue;
    longest = Math.max(longest, t.name.length);
  }
  if (longest === 0) return;

  // Legend width ≈ swatch + gap + text. 0.6em per character is a reasonable
  // average for proportional faces and errs slightly wide, which is the safe
  // direction — extra whitespace beats a clipped label.
  const width = 34 + longest * style.legendSize * 0.6;
  const margin = (layout.margin ?? {}) as { l?: number; r?: number; t?: number; b?: number };
  layout.margin = { ...margin, r: Math.max(margin.r ?? 20, Math.round(width)) };
}

/**
 * Apply a panel's decorations to a built layout, in place.
 *
 * Axis specs address the axes `plot-figure.ts` actually produced: a full melt
 * panel stacks RFU over the derivative, so its temperature axis is `xaxis2`
 * and the derivative's is `yaxis2`.
 */
export function decorateLayout(
  layout: Partial<Layout>,
  panel: PlotPanel,
  style: PlotFigureStyle,
  data: readonly unknown[] = [],
): void {
  // Note whether the outside-legend reservation actually widened the right
  // margin. Without this the auto-margin pass below cannot tell a real legend
  // reservation from `computeMargins`' unconditional `r: 20`, and would keep
  // the 20 on every panel — which is most of what it is meant to reclaim.
  const rBefore = ((layout.margin ?? {}) as { r?: number }).r ?? 20;
  reserveOutsideLegend(layout, data, style);
  const rAfter = ((layout.margin ?? {}) as { r?: number }).r ?? 20;
  const legendReservedR = rAfter > rBefore ? rAfter : null;

  const l = layout as unknown as Record<string, AxisLayout | unknown>;

  // On a stacked melt panel the labelled x-axis is the bottom one.
  const stacked = Boolean(l.xaxis2);
  applyAxisSpec((stacked ? l.xaxis2 : l.xaxis) as AxisLayout, panel.xaxis, style);
  applyAxisSpec(l.yaxis as AxisLayout, panel.yaxis, style);
  if (l.yaxis2) applyAxisSpec(l.yaxis2 as AxisLayout, panel.yaxis2, style);

  if (panel.title !== undefined && panel.title !== null) {
    layout.title = {
      text: panel.title,
      font: { family: style.fontFamily, size: style.titleSize },
    };
  }

  // Content-derived margins first, then any explicit override on top, so a
  // spec that states its own margins renders exactly as it always has.
  // `reserveOutsideLegend` ran above and only ever widens `r`, so take the
  // larger of the two rather than letting a tighter estimate undo it.
  // Runs after `applyAxisSpec` so a title the panel itself adds is accounted
  // for — deriving before that would under-reserve for a spec that names an
  // axis the source file left unlabelled.
  if (wantsAutoMargins(panel)) {
    const current = (layout.margin ?? {}) as { l?: number; r?: number; t?: number; b?: number };
    const auto = deriveMargins(layout, style, data);
    layout.margin = {
      ...current,
      l: auto.l,
      t: auto.t,
      b: auto.b,
      r: legendReservedR ?? auto.r,
    };
  }

  if (panel.margin) {
    const current = (layout.margin ?? {}) as { l?: number; r?: number; t?: number; b?: number };
    layout.margin = { ...current, ...stripUndefined(panel.margin) };
  }

  if (panel.referenceLines?.length) {
    const shapes = [...((layout.shapes ?? []) as Partial<Shape>[]), ...panel.referenceLines.map(toPlotlyShape)];
    layout.shapes = shapes as Layout['shapes'];
  }

  if (panel.annotations?.length) {
    const existing = (layout.annotations ?? []) as unknown[];
    layout.annotations = [
      ...existing,
      ...panel.annotations.map((a) => toPlotlyAnnotation(a, style)),
    ] as Layout['annotations'];
  }

  // `above` is not one of the app's legend positions: it places a horizontal
  // legend in reserved space over the axes, which is how a many-series figure
  // keeps a readable legend without covering the data. Handled here because it
  // needs both the legend anchor and the top margin.
  if (panel.legend?.position === 'above') {
    const size = panel.legend.fontSize ?? style.legendSize;
    layout.legend = {
      ...((layout.legend ?? {}) as object),
      orientation: 'h',
      x: 0,
      y: 1,
      xanchor: 'left',
      yanchor: 'bottom',
    } as Layout['legend'];
    const margin = (layout.margin ?? {}) as { l?: number; r?: number; t?: number; b?: number };
    // Room for the title plus up to two wrapped legend rows.
    layout.margin = { ...margin, t: Math.max(margin.t ?? 20, Math.round(size * 2.8 + 34)) };
    // Pin the title to the top of the panel. Left to Plotly it centres itself
    // in the enlarged top margin and lands on top of the legend.
    layout.title = {
      ...((layout.title ?? {}) as object),
      y: 1,
      yanchor: 'top',
      yref: 'container',
      pad: { t: 4 },
    } as Layout['title'];
  }

  // Legend appearance beyond position/content. `plot-figure.ts` hardcodes a
  // white fill with a 1px border — right for the app's on-screen legend, but
  // published figures usually want it unboxed and sitting on the plot.
  const lg = panel.legend;
  if (lg && (lg.title || lg.frame !== undefined || lg.bgcolor || lg.itemGap != null
    || lg.fontSize != null || lg.orientation)) {
    const legend = { ...((layout.legend ?? {}) as Record<string, unknown>) };
    if (lg.title) {
      legend.title = { text: lg.title, font: { family: style.fontFamily, size: lg.fontSize ?? style.legendSize } };
    }
    if (lg.frame === false) {
      legend.borderwidth = 0;
      legend.bgcolor = 'rgba(0,0,0,0)';
    } else if (lg.frame === true) {
      legend.borderwidth = 1;
    }
    if (lg.bgcolor) {
      legend.bgcolor = lg.bgcolor === 'transparent' ? 'rgba(0,0,0,0)' : lg.bgcolor;
    }
    // Every trace carries its own legendgroup, so the group gap is what
    // actually controls the spacing between entries.
    if (lg.itemGap != null) legend.tracegroupgap = lg.itemGap;
    if (lg.fontSize != null) {
      legend.font = { family: style.fontFamily, size: lg.fontSize };
    }
    if (lg.orientation) legend.orientation = lg.orientation;
    if (lg.entryWidthPx != null) {
      legend.entrywidth = lg.entryWidthPx;
      legend.entrywidthmode = 'pixels';
    }
    layout.legend = legend as Layout['legend'];
  }

  // A second legend for entries pulled out of the first (see Legend2Spec).
  // `assignLegend2` does the actual trace reassignment once the panel's full
  // data array — including reference-line legend traces, added after this
  // function runs — is known; see `buildPlotPanel` in figure.ts.
  if (panel.legend2) {
    (layout as Record<string, unknown>).legend2 = buildLegendLayout(panel.legend2, style, { orientation: 'v' });
  }
}
