/**
 * Curve identity helpers — a "curve" (sample-channel / **S-C pair**) is a
 * `(well, channel)` pair, the unit of selection / styling / grouping in the
 * multichannel model. A curve is identified by a composite string key so it can
 * be a `Map`/`Set` key and round-trip through `.sharpx` JSON (which serialises
 * Sets→arrays and Maps→entry-arrays) with no special handling.
 *
 * Separator = a single space. Well names are `{rowLetter}{colNumber}` (e.g.
 * `A1`, `H12`) and never contain spaces, so splitting on the FIRST space cleanly
 * recovers the well even when the channel name does contain spaces (e.g.
 * `Cal Orange 560`, `Channel 1`). This mirrors the existing `` `${ch} ${well}` ``
 * convention already used for melt peak-height keys in `PlotArea`.
 *
 * Single-channel parity: with one channel each well has exactly one curve, so a
 * curveKey is 1:1 with its well and every curve-keyed structure mirrors the
 * legacy well-keyed one.
 */

export const CURVE_SEP = ' ';

/** Composite key for the `(well, channel)` curve. */
export function curveKey(well: string, channel: string): string {
  return `${well}${CURVE_SEP}${channel}`;
}

/** Split a curveKey back into its well + channel (splits on the first space;
 *  wells never contain spaces, channels may). */
export function parseCurveKey(key: string): { well: string; channel: string } {
  const i = key.indexOf(CURVE_SEP);
  if (i < 0) return { well: key, channel: '' };
  return { well: key.slice(0, i), channel: key.slice(i + CURVE_SEP.length) };
}

/** All curveKeys for a well across the given channels. */
export function wellCurves(well: string, channels: string[]): string[] {
  return channels.map((c) => curveKey(well, c));
}

/** Every curveKey for every well × channel (the "all curves" set). */
export function allCurves(wells: string[], channels: string[]): string[] {
  const out: string[] = [];
  for (const w of wells) for (const c of channels) out.push(curveKey(w, c));
  return out;
}

/** The set of wells that own at least one curve in `curves` (derives the
 *  well-level selection mirror from the curve-level selection). */
export function curvesToWells(curves: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const k of curves) out.add(parseCurveKey(k).well);
  return out;
}
