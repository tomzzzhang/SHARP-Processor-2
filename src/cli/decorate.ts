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
import type { PlotFigureStyle } from '@/lib/plot-figure';
import type { AnnotationSpec, AxisSpec, PlotPanel, ReferenceLineSpec } from './spec';

type AxisLayout = Record<string, unknown>;

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

  if (spec.title !== undefined && spec.title !== null) {
    axis.title = { text: spec.title, font: { family: style.fontFamily, size: style.labelSize } };
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
 * Apply a panel's decorations to a built layout, in place.
 *
 * Axis specs address the axes `plot-figure.ts` actually produced: a full melt
 * panel stacks RFU over the derivative, so its temperature axis is `xaxis2`
 * and the derivative's is `yaxis2`.
 */
export function decorateLayout(layout: Partial<Layout>, panel: PlotPanel, style: PlotFigureStyle): void {
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

  if (panel.legend?.title) {
    layout.legend = {
      ...(layout.legend ?? {}),
      title: { text: panel.legend.title, font: { family: style.fontFamily, size: style.legendSize } },
    } as Layout['legend'];
  }
}
