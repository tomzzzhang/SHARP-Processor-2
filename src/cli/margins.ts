/**
 * Content-derived plot margins.
 *
 * `computeMargins` in `plot-figure.ts` sizes margins from font sizes alone and
 * adds a generous fixed constant — `l: 40 + …`, `r: 20`, `t: 20`, `b: 30 + …`.
 * That suits the app, where a panel fills a resizable window and slack costs
 * nothing. In a figure sized to the millimetre it is the single largest source
 * of white space: measured on a 3×2 composite it was 16.9% of canvas height,
 * nearly four times the inter-panel gaps.
 *
 * This computes the same margins from what the panel actually draws — whether
 * there is an axis title, whether tick labels are shown, and how wide the
 * widest y tick label can actually be — and is applied by `decorateLayout`
 * BEFORE any explicit `panel.margin`, so a spec that states its margins is
 * completely unaffected.
 *
 * **`plot-figure.ts` is deliberately not touched.** Changing it would move
 * every figure the shipped Export Wizard has ever produced. This is the same
 * reasoning that keeps the outside-legend right-margin fix on the CLI side.
 *
 * The estimates below always round up. Clipping an axis label is a far worse
 * failure than leaving two spare pixels, so every constant here is chosen to
 * over-reserve slightly rather than to hit the minimum exactly.
 */
import type { Layout } from 'plotly.js';
import type { PlotFigureStyle } from '@/lib/plot-figure';
import type { PlotPanel } from './spec';

/** Plotly's own gap between the axis line and its tick labels. */
const TICK_PAD = 4;
/** Breathing room at the canvas edge so a glyph never touches the boundary. */
const EDGE_PAD = 6;
/**
 * Width of one digit relative to font size, for Arial/Helvetica/Liberation.
 * Digits are tabular in these faces, so this is stable rather than a guess.
 */
const DIGIT_W = 0.56;
/** A text line's full height relative to font size. */
const LINE_H = 1.2;

export interface DerivedMargins { l: number; r: number; t: number; b: number }

interface AxisLike {
  title?: { text?: string } | string;
  showticklabels?: boolean;
  tickvals?: unknown[];
  ticktext?: unknown[];
  range?: unknown[];
  type?: string;
}

function axisTitleText(axis: AxisLike | undefined): string {
  if (!axis?.title) return '';
  return typeof axis.title === 'string' ? axis.title : (axis.title.text ?? '');
}

function showsTickLabels(axis: AxisLike | undefined): boolean {
  return axis?.showticklabels !== false;
}

/**
 * Longest y tick label this panel can produce, in characters.
 *
 * Literal `ticktext` is authoritative when present. Otherwise the label width
 * is driven by the magnitude of the data, so the traces are scanned — this is
 * the part `computeMargins`' fixed 40px was standing in for, and the reason it
 * had to be generous enough for the worst case on every figure at once.
 */
function widestYLabel(axis: AxisLike | undefined, data: readonly unknown[]): number {
  const ticktext = axis?.ticktext;
  if (Array.isArray(ticktext) && ticktext.length > 0) {
    return Math.max(...ticktext.map((t) => String(t).length));
  }

  let maxAbs = 0;
  let fractional = false;
  for (const trace of data) {
    const ys = (trace as { y?: unknown }).y;
    if (!Array.isArray(ys)) continue;
    for (const v of ys) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const a = Math.abs(v);
      if (a > maxAbs) maxAbs = a;
      if (!fractional && a > 0 && a < 10 && !Number.isInteger(v)) fractional = true;
    }
  }
  if (maxAbs === 0) return 3;

  // Plotly labels the axis somewhat above the data maximum.
  const headroom = maxAbs * 1.1;
  let chars = Math.floor(Math.log10(headroom)) + 1;
  if (fractional) chars += 2;          // "0.5" style ticks
  if (headroom >= 10_000) chars += 1;  // thousands separator or an exponent
  return Math.max(2, chars);
}

/**
 * Margins sized to this panel's own content, in CSS pixels at 96/in.
 *
 * `layout` is the figure `plot-figure.ts` already built, so axis titles and
 * tick-label visibility are read post-resolution rather than re-derived from
 * the spec — which matters because a panel inherits most of them from the
 * source file rather than stating them.
 */
export function deriveMargins(
  layout: Partial<Layout>,
  style: PlotFigureStyle,
  data: readonly unknown[] = [],
): DerivedMargins {
  const l = layout as unknown as Record<string, AxisLike | undefined>;
  // A stacked melt panel labels its bottom axis.
  const xAxis = (l.xaxis2 ?? l.xaxis) as AxisLike | undefined;
  const yAxis = l.yaxis as AxisLike | undefined;

  const hasYTitle = axisTitleText(yAxis).length > 0;
  const hasXTitle = axisTitleText(xAxis).length > 0;
  const yTicks = showsTickLabels(yAxis);
  const xTicks = showsTickLabels(xAxis);

  const titleBand = style.labelSize * 1.45;

  // Left: y tick labels (width driven by their digits) then the rotated title.
  const yLabelW = yTicks ? widestYLabel(yAxis, data) * style.tickSize * DIGIT_W + TICK_PAD : 0;
  const left = EDGE_PAD + yLabelW + (hasYTitle ? titleBand : 0);

  // Bottom: one line of x tick labels, then the title.
  const xLabelH = xTicks ? style.tickSize * LINE_H + TICK_PAD : 0;
  const bottom = EDGE_PAD + xLabelH + (hasXTitle ? titleBand : 0);

  // Top: only a panel title needs room. `plot-figure.ts` always sets a title
  // object and empties its *text* when `showTitle` is false, so test the text
  // — testing the object reserves a title band on every untitled panel.
  const titleText = (() => {
    const t = layout.title as { text?: string } | string | undefined;
    if (!t) return '';
    return typeof t === 'string' ? t : (t.text ?? '');
  })();
  const top = titleText ? EDGE_PAD + style.titleSize * 1.6 : EDGE_PAD;

  // Right: half a y tick label can overhang the last x tick. An outside legend
  // is handled separately by `reserveOutsideLegend`, which only ever widens.
  const right = EDGE_PAD + (xTicks ? style.tickSize * DIGIT_W * 1.5 : 0);

  return {
    l: Math.ceil(left),
    r: Math.ceil(right),
    t: Math.ceil(top),
    b: Math.ceil(bottom),
  };
}

/**
 * Whether this panel should get content-derived margins.
 *
 * Off when the spec states its own margins on all four sides — there is
 * nothing to derive — and off when `autoMargins` is explicitly disabled.
 */
export function wantsAutoMargins(panel: PlotPanel): boolean {
  if (panel.autoMargins === false) return false;
  const m = panel.margin;
  if (m && m.l != null && m.r != null && m.t != null && m.b != null) return false;
  return true;
}
