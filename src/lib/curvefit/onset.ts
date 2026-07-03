/**
 * Onset (firing / "tick-off"), the difference-based per-well noise σ, and the
 * σ pre-onset window.
 *
 * σ is the robust spread (1.4826·MAD) of the CONSECUTIVE DIFFERENCES of the
 * raw curve over the PRE-ONSET region = the reads before the fit reaches
 * `sigmaPreOnsetFraction` of its height (falling back to Processor 2's
 * `findFlatBaselineWindow` when the fit is absent). Differencing cancels a
 * linear drift and a constant shift, and MAD resists the odd outlier point.
 *
 * t_lod is a limit-of-detection departure from baseline: the first point on
 * the baseline-corrected curve to exceed +x·(run σ) whose next point continues
 * at least as far (consecutive confirmation rejects single-point spikes), the
 * crossing time linearly interpolated. This is DETECTION only — speed/kinetics
 * live in the fit-derived landmarks (`t_onset10`, the Td profile). Its SE is
 * `runσ / |local slope|`, floored by the read interval (can't localize finer
 * than the sampling).
 */
import { findFlatBaselineWindow } from './signal';
import { sigmoidAt } from './fivepl';
import type { FivePLResult } from './fivepl';
import type { KineticKnobs } from './types';
import { robustSigma } from './util';

export type Window = { start: number; end: number };

/**
 * The σ pre-onset window (1-indexed inclusive): reads before the fitted curve
 * reaches `sigmaPreOnsetFraction` of its height. Falls back to the P2
 * flat-baseline finder when the fit can't bound it.
 */
export function preOnsetWindow(
  fit: FivePLResult,
  rfu: number[],
  timeS: number[],
  knobs: KineticKnobs,
): Window | null {
  const n = Math.min(rfu.length, timeS.length);
  if (
    fit.A !== null && fit.B !== null && fit.C !== null && fit.D !== null &&
    fit.foot !== null && fit.shoulder !== null && fit.D > fit.A
  ) {
    const p = { A: fit.A, B: fit.B, C: fit.C, D: fit.D, foot: fit.foot, shoulder: fit.shoulder };
    const level = fit.A + knobs.sigmaPreOnsetFraction * (fit.D - fit.A);
    let end = 0;
    for (let i = 0; i < n; i++) {
      // "% of height" boundary, the same referent as every kinetic landmark.
      if (sigmoidAt(timeS[i], p) < level) end = i + 1; // 1-indexed inclusive
      else break;
    }
    if (end >= 3) return { start: 1, end };
  }
  return findFlatBaselineWindow(rfu);
}

/**
 * Difference-based robust σ over a window (1-indexed inclusive).
 * Returns NaN when the window is too short to form differences.
 */
export function differenceSigma(rfu: number[], window: Window | null): number {
  if (!window) return NaN;
  const s = window.start - 1; // 0-indexed inclusive
  const e = window.end - 1;
  if (e - s < 2) return NaN;
  const diffs: number[] = [];
  for (let i = s; i < e; i++) diffs.push(rfu[i + 1] - rfu[i]);
  return robustSigma(diffs);
}

export interface OnsetResult {
  /** Interpolated firing time in seconds, or null if the curve never fires. */
  tLod: number | null;
  /** SE of the firing time (runσ / |local slope|, floored by the read interval). */
  tLodSe: number | null;
  fired: boolean;
}

/**
 * LoD firing point on the baseline-corrected curve (baseline ≈ 0), using the
 * run-level σ. `threshold = x · runSigma`.
 */
export function findOnset(
  corrected: number[],
  timeS: number[],
  runSigma: number,
  sigmaMultiplierX: number,
): OnsetResult {
  const n = Math.min(corrected.length, timeS.length);
  if (n < 3 || !Number.isFinite(runSigma) || runSigma <= 0) {
    return { tLod: null, tLodSe: null, fired: false };
  }
  const threshold = sigmaMultiplierX * runSigma;

  for (let i = 1; i < n; i++) {
    if (corrected[i] <= threshold) continue;
    // Consecutive confirmation: the next point must continue at least as far
    // (still climbing), rejecting a lone spike. The last point can't confirm.
    if (i + 1 >= n || corrected[i + 1] < corrected[i]) continue;

    const dt = timeS[i] - timeS[i - 1];
    const localSlope = dt > 0 ? (corrected[i] - corrected[i - 1]) / dt : 0;
    // SE of the crossing time: noise / slope, but never finer than the read
    // interval (can't localize below the sampling); fall back to dt on a flat
    // or non-positive local slope (a bumpy crossing).
    const tLodSe = dt > 0 ? (localSlope > 0 ? Math.max(dt, runSigma / localSlope) : dt) : null;

    // Interpolate the threshold crossing between the previous point (below)
    // and this one (above). If the previous point is already above (rare —
    // a curve rising from cycle 0), snap to this point's time.
    const prev = corrected[i - 1];
    if (prev >= threshold) return { tLod: timeS[i], tLodSe, fired: true };
    const dy = corrected[i] - prev;
    const frac = dy > 1e-15 ? (threshold - prev) / dy : 0;
    const tLod = timeS[i - 1] + frac * (timeS[i] - timeS[i - 1]);
    return { tLod, tLodSe, fired: true };
  }
  return { tLod: null, tLodSe: null, fired: false };
}
