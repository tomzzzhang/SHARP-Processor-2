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
 * Place every panel on the grid. With `layout.areas` a panel occupies the
 * bounding box of the cells naming it (so repeating a label spans it);
 * without, panels fill the grid in order, one cell each.
 */
export function computePlacements(spec: ResolvedSpec): Map<string, PanelPlacement> {
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
  const rowHeights = distribute(availH, layout.heights ?? new Array(layout.rows).fill(1));

  const colX: number[] = [];
  let x = margin;
  for (let c = 0; c < layout.cols; c++) { colX.push(x); x += colWidths[c] + gap; }
  const rowY: number[] = [];
  let y = margin;
  for (let r = 0; r < layout.rows; r++) { rowY.push(y); y += rowHeights[r] + gap; }

  // label → the cells it occupies
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
