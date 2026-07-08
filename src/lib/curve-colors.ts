/**
 * Shared per-curve colour resolution — the single source of truth for what
 * colour a `(well, channel)` curve is drawn in, used by both the main plot
 * (`PlotArea`) and the kinetics report so their colours always match.
 *
 * Precedence (highest first): per-curve override → per-well override →
 * grouped/Tt-ordered palette. `buildColorMap` produces the base (palette +
 * well overrides); `resolveCurveColorWidth` layers the curve/well override on
 * top. Keep this pure (no React, no store) so both callers can reuse it.
 */
import { curveKey } from './curves';

/** Per-curve style override resolution: curve override wins over well override.
 *  Returns the resolved colour/width (or undefined when neither is set, so the
 *  caller falls back to the base colour map). */
export function resolveCurveColorWidth(
  well: string,
  ch: string,
  curveStyleOverrides: Map<string, unknown>,
  wellStyleOverrides: Map<string, unknown>,
): { color?: string; width?: number } {
  const wellOv = wellStyleOverrides.get(well) as { color?: string; lineWidth?: number } | undefined;
  const curveOv = curveStyleOverrides.get(curveKey(well, ch)) as { color?: string; lineWidth?: number } | undefined;
  return { color: curveOv?.color ?? wellOv?.color, width: curveOv?.lineWidth ?? wellOv?.lineWidth };
}

/**
 * Pure colour-map builder: wells → grouped/Tt-sorted units → colours drawn from
 * `colorsFor(n)`, then per-well colour overrides applied last (highest
 * priority). Shared by the active-channel palette map and, in colour-separation
 * mode, each channel's monochrome ramp.
 * - `groupColors` on: each group is one unit (its wells share a colour),
 *   ungrouped wells are individual units; off: one colour per well.
 * - Units are sorted by (mean) Tt ascending; wells/groups with no Tt sink last.
 * - `paletteReversed` flips the colour assignment order.
 */
export function buildColorMap(
  visibleWells: string[],
  colorsFor: (n: number) => string[],
  wellGroups: Map<string, string>,
  wellStyleOverrides: Map<string, unknown>,
  analysisResults?: Map<string, { tt?: number | null }>,
  paletteReversed?: boolean,
  groupColors?: boolean,
): Map<string, string> {
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

  // Sort by Tt ascending. `|| 0` keeps the sort stable when Tt is equal or
  // absent (Infinity − Infinity = NaN, an inconsistent comparator that would
  // otherwise reorder units unpredictably — e.g. when threshold detection is off
  // so every Tt is null, making the plot and grid disagree on group→colour).
  if (analysisResults && analysisResults.size > 0) {
    units.sort((a, b) => (a[0] - b[0]) || 0);
  }

  let colors = colorsFor(units.length);
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
}
