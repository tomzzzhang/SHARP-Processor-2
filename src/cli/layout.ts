/**
 * Composite grid geometry.
 *
 * Computes each panel's rectangle in inches from the spec's grid. Both halves
 * of the pipeline read it: `figure` bakes the rectangle into each Plotly
 * layout's pixel width/height, and `render` emits the matching CSS grid. They
 * must agree exactly — a Plotly figure sized differently from its CSS box is
 * how axis labels get clipped.
 *
 * Sizes are carried in inches and converted to CSS pixels at 96 px/in, which is
 * what Chrome uses when it maps an `@page` sized in inches. Output `dpi` is a
 * rasterization parameter applied later by `pdftoppm`, never a render
 * parameter — so a 600 dpi PNG and the PDF are the same drawing.
 */
import { SpecError, type ResolvedSpec } from './spec';

/** CSS pixels per inch. Fixed by the CSS spec, not a preference. */
export const CSS_PPI = 96;

export interface CellRect {
  /** Offset from the figure's top-left corner, in inches. */
  x_in: number;
  y_in: number;
  w_in: number;
  h_in: number;
}

export interface PanelPlacement extends CellRect {
  label: string;
  /** Zero-based inclusive grid span. */
  row0: number;
  row1: number;
  col0: number;
  col1: number;
}

export function inchesToPx(inches: number): number {
  return Math.round(inches * CSS_PPI);
}

function distribute(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) throw new SpecError('Relative widths/heights must sum to a positive number.');
  return weights.map((w) => (total * w) / sum);
}

/**
 * Height a table actually draws, in inches, from its final row count.
 *
 * Mirrors the harness CSS: `.ptable th/td { padding: 2px 4px }`, a 1px header
 * rule, and Chrome's default `normal` line height. Deliberately rounds up — a
 * table clipped mid-row is far worse than a hair of slack.
 */
export function tableHeightIn(
  rowCount: number,
  fontSize: number | null | undefined,
  /**
   * Pixels the harness insets a table by to keep a top-anchored panel label off
   * its first row. Non-zero whenever the panel draws a `top-*` label — omitting
   * it costs exactly one row off the bottom, which is how this was first found.
   */
  labelInsetPx = 0,
): number {
  const CELL_PAD = 4;       // 2px top + 2px bottom
  const LINE_H = 1.2;       // Chrome's `normal` for these faces
  const HEADER_RULE = 1;
  const SAFETY = 2;
  const size = fontSize ?? 8;
  const lines = rowCount + 1; // + header
  const px = lines * (size * LINE_H + CELL_PAD) + HEADER_RULE + SAFETY + labelInsetPx;
  return px / CSS_PPI;
}

/**
 * Row heights, with rows that hold nothing but tables shrunk to their content.
 *
 * A table draws from its top edge and stops; the rest of its grid row is dead
 * space that no padding setting reclaims. On a measured 3×2 composite that was
 * 7.9% of the canvas. The reclaimed height goes back to the other rows in
 * their existing proportion, so relative sizing between plot rows is preserved.
 *
 * Only rows where every occupant is a single-row table are touched — a table
 * that spans rows, or shares a row with a plot, is left entirely alone.
 */
function distributeRows(
  availH: number,
  layout: ResolvedSpec['layout'],
  spec: ResolvedSpec,
  cells: Map<string, { rows: number[]; cols: number[] }>,
  measured: ReadonlyMap<string, number>,
): number[] {
  const weights = layout.heights ?? new Array(layout.rows).fill(1);
  const base = distribute(availH, weights);
  if (measured.size === 0) return base;

  const byLabel = new Map(spec.panels.map((p) => [p.label!, p]));
  const occupants: Map<number, { spans: boolean; label: string }[]> = new Map();
  for (const [label, { rows }] of cells) {
    if (!byLabel.has(label)) continue;
    const spans = Math.min(...rows) !== Math.max(...rows);
    for (const r of new Set(rows)) {
      const list = occupants.get(r) ?? [];
      list.push({ spans, label });
      occupants.set(r, list);
    }
  }

  const natural = new Map<number, number>();
  for (let r = 0; r < layout.rows; r++) {
    const list = occupants.get(r) ?? [];
    if (list.length === 0) continue;
    // Only a row whose every occupant is a measured, single-row table. A table
    // that spans rows, or shares a row with a plot, is left entirely alone.
    if (!list.every((o) => measured.has(o.label) && !o.spans)) continue;
    const tallest = Math.max(...list.map((o) => measured.get(o.label)!));
    // Never grow a row — only give space back.
    if (tallest < base[r]) natural.set(r, tallest);
  }
  if (natural.size === 0) return base;

  const reclaimed = [...natural].reduce((sum, [r, h]) => sum + (base[r] - h), 0);
  const growable = base
    .map((h, r) => ({ h, r }))
    .filter(({ r }) => !natural.has(r));
  const growableTotal = growable.reduce((sum, { h }) => sum + h, 0);

  return base.map((h, r) => {
    if (natural.has(r)) return natural.get(r)!;
    if (growableTotal <= 0) return h;
    return h + (reclaimed * h) / growableTotal;
  });
}

/**
 * Place every panel on the grid. With `layout.areas` a panel occupies the
 * bounding box of the cells naming it (so repeating a label spans it);
 * without, panels fill the grid in order, one cell each.
 */
export function computePlacements(
  spec: ResolvedSpec,
  /**
   * Natural drawn height, in inches, for table panels whose content is known.
   * A `kinetics_table`'s row count is not knowable until its report has been
   * computed, so `buildBundle` places once provisionally, measures, then places
   * again with this filled in. Empty on the first pass.
   */
  measuredTableHeights: ReadonlyMap<string, number> = new Map(),
): Map<string, PanelPlacement> {
  const { layout, output } = spec;
  const margin = layout.margin_in ?? 0;
  const gap = layout.gap_in;

  const contentW = output.width_in - 2 * margin;
  const contentH = output.height_in - 2 * margin;
  const availW = contentW - gap * (layout.cols - 1);
  const availH = contentH - gap * (layout.rows - 1);
  if (availW <= 0 || availH <= 0) {
    throw new SpecError(
      `A ${layout.rows}×${layout.cols} grid with ${gap}in gaps does not fit in ` +
      `${output.width_in}×${output.height_in}in. Reduce layout.gap_in or the grid size.`,
    );
  }

  const colWidths = distribute(availW, layout.widths ?? new Array(layout.cols).fill(1));

  // label → the cells it occupies. Built before the row heights because a row
  // holding nothing but tables is sized to its content, not to its share.
  const cells = new Map<string, { rows: number[]; cols: number[] }>();
  if (layout.areas) {
    layout.areas.forEach((rowSpec, r) => {
      rowSpec.trim().split(/\s+/).forEach((label, c) => {
        if (label === '.') return;
        const entry = cells.get(label) ?? { rows: [], cols: [] };
        entry.rows.push(r);
        entry.cols.push(c);
        cells.set(label, entry);
      });
    });
    for (const p of spec.panels) {
      if (!cells.has(p.label!)) {
        throw new SpecError(`Panel "${p.label}" never appears in layout.areas, so it has nowhere to draw.`);
      }
    }
  } else {
    spec.panels.forEach((p, i) => {
      cells.set(p.label!, { rows: [Math.floor(i / layout.cols)], cols: [i % layout.cols] });
    });
  }

  const rowHeights = distributeRows(availH, layout, spec, cells, measuredTableHeights);

  const colX: number[] = [];
  let x = margin;
  for (let c = 0; c < layout.cols; c++) { colX.push(x); x += colWidths[c] + gap; }
  const rowY: number[] = [];
  let y = margin;
  for (let r = 0; r < layout.rows; r++) { rowY.push(y); y += rowHeights[r] + gap; }

  const out = new Map<string, PanelPlacement>();
  for (const [label, { rows, cols }] of cells) {
    const row0 = Math.min(...rows), row1 = Math.max(...rows);
    const col0 = Math.min(...cols), col1 = Math.max(...cols);
    // A spanning panel absorbs the gaps it straddles.
    const w = colX[col1] + colWidths[col1] - colX[col0];
    const h = rowY[row1] + rowHeights[row1] - rowY[row0];
    out.set(label, {
      label,
      row0, row1, col0, col1,
      x_in: colX[col0],
      y_in: rowY[row0],
      w_in: w,
      h_in: h,
    });
  }
  return out;
}
