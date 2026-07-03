/**
 * Baseline from the fit, trough fallback.
 *
 * The baseline is the FreeShoulder fit's lower asymptote `A` (value at t→−∞),
 * read straight off a fit to the RAW curve — there is no flat region to detect
 * in SHARP data, and a per-well linear fit over the short pre-takeoff window
 * caught the warm-up decline and pre-onset creep and reported a bogus drift
 * that tilted the whole corrected curve. So: no window, no per-well slope. The
 * robust trough is the fallback when the fit fails (non-amplifiers / junk).
 *
 * This is the module's pure fit-vs-trough decision (keyed on `baselineObserved`).
 * The host app may layer an extra cross-check on top — e.g. Processor 2 accepts
 * the fitted `A` when it agrees with the app's simple baseline within a
 * tolerance even if `baselineObserved` is false (shared_module §1.1).
 */
import type { FivePLResult } from './fivepl';

export interface BaselineResult {
  /** Baseline-corrected curve (raw − baseline level). */
  corrected: number[];
  /** The subtracted baseline level (fitted `A`, or the robust trough). */
  offset: number | null;
  /** True when `offset` came from the fit (`A` is anchored), false ⇒ trough. */
  fromFit: boolean;
}

/**
 * Subtract the baseline. `baseline = fit.A` when the fit anchors it
 * (`baselineObserved`), else the robust trough. `corrected = raw − baseline`.
 */
export function computeBaseline(
  rfu: number[],
  fit: FivePLResult,
  trough: number,
): BaselineResult {
  const fromFit = fit.baselineObserved && fit.A !== null;
  const baseline = fromFit ? (fit.A as number) : trough;
  if (!Number.isFinite(baseline)) {
    return { corrected: [...rfu], offset: null, fromFit: false };
  }
  return { corrected: rfu.map((v) => v - baseline), offset: baseline, fromFit };
}

/** Convenience re-exports so callers don't also import util just for these. */
export { curveRange, robustTrough } from './util';
