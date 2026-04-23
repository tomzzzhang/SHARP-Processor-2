/**
 * ============================================================================
 *  ARCHIVE — retired code kept for reference
 * ============================================================================
 *
 * Nothing in this file is imported by the running application. It is a
 * museum of previous algorithms / code paths we have replaced, preserved
 * verbatim in case a regression or a reviewer needs to see what the app
 * used to do.
 *
 * When retiring a function, move it here with a dated banner describing:
 *   - when it was retired
 *   - what replaced it
 *   - why it was retired
 *   - the commit the replacement landed in (optional)
 *
 * The master index of active vs archived functions lives in
 * `docs/ALGORITHMS.md`.
 * ============================================================================
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

// ============================================================================
// Retired 2026-04-22 — Simple central-difference melt derivative
// ----------------------------------------------------------------------------
// Replaced by the BioRad CFX Maestro port in `src/lib/parsers/utils.ts`
// (`computeMeltDerivative`). Reason: central difference on raw (noisy) RFU
// amplified high-frequency noise, producing spurious dip-then-rebound double
// peaks around the true melt temperature. BioRad's approach smooths RFU first
// and differentiates from a polynomial fit, which is inherently smooth.
// Kept here as a fallback reference or for diagnostic comparison.
//
// Exported so `tsc -b` (with noUnusedLocals) doesn't flag it. Nothing in the
// live app imports this module.
// ============================================================================

export function computeMeltDerivative_CentralDiff(
  temperatureC: number[],
  rfu: Record<string, number[]>,
): Record<string, number[]> {
  const derivative: Record<string, number[]> = {};
  if (temperatureC.length < 3) return derivative;
  for (const [well, data] of Object.entries(rfu)) {
    const d = new Array<number>(data.length);
    d[0] = -(data[1] - data[0]) / (temperatureC[1] - temperatureC[0]);
    for (let i = 1; i < data.length - 1; i++) {
      d[i] = -(data[i + 1] - data[i - 1]) / (temperatureC[i + 1] - temperatureC[i - 1]);
    }
    const n = data.length - 1;
    d[n] = -(data[n] - data[n - 1]) / (temperatureC[n] - temperatureC[n - 1]);
    derivative[well] = d;
  }
  return derivative;
}

// ============================================================================
// Retired 2026-04-22 — Post-smoothing pass on the melt derivative
// ----------------------------------------------------------------------------
// Before the BioRad algorithm port, we optionally re-smoothed the derivative
// with `savitzkyGolaySmooth` (order 2 SavGol). This was exposed as a "Smooth
// melt -dF/dT" checkbox in the Analysis tab, with a user-adjustable window
// (default 11). After the port, the derivative is already smooth by
// construction, so the extra pass is redundant and was removed from the UI +
// all render paths (PlotArea, ResultsTable, plot-figure, ExportWizard).
//
// State shape retired:
//   smoothingMeltDerivative: boolean  // default was true then false
//
// Usage pattern retired (example from the old MeltDerivMini):
//     const smoothMeltDeriv = smoothingMeltDerivative;  // previously gated by smoothingEnabled too
//     let derData = melt.derivative[well];
//     if (smoothMeltDeriv) derData = savitzkyGolaySmooth(derData, smoothingWindow);
// ============================================================================

// (Illustrative — the code above was inlined across 4 files; no single
// function to copy. The pattern is preserved in the comment block for future
// reference.)
