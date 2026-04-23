# Algorithms — Active vs Archived

**Last Updated:** 2026-04-23 PST

A single source of truth for which algorithm the app is currently using for
each analysis step, and which earlier implementations have been retired.
Retired implementations are kept verbatim in [`src/lib/_archive.ts`](../src/lib/_archive.ts)
for reference; nothing in the running app imports from there.

## Melt derivative ( -dF/dT )

| | Status | Location | Notes |
|---|---|---|---|
| **BioRad CFX Maestro port** | **Active** | [`src/lib/parsers/utils.ts`](../src/lib/parsers/utils.ts) `computeMeltDerivative` | Direct port of BioRad's pipeline from the decompiled `BioRad.PCR.Analysis.dll` + `BioRad.Math.dll`. Two passes of 5-pt centered mean on raw RFU → linear extrapolation of first 5 points → SavGol derivative (polyOrder=4, width=5, derivOrder=1, pad-by-replicate at edges) → divide by fixed ΔT → linear extrapolation of first 2 derivative points → negate. The SavGol fit is exact for width=5/poly=4, so the interior coefficients collapse to the classical 4th-order central difference `[1, -8, 0, 8, -1] / 12h`. Produces curves visually indistinguishable from CFX Maestro's. |
| Simple central difference | Archived 2026-04-22 | [`src/lib/_archive.ts`](../src/lib/_archive.ts) `computeMeltDerivative_CentralDiff` | Was `-(RFU[i+1] - RFU[i-1]) / (T[i+1] - T[i-1])`. Amplified raw-sample noise; produced spurious double-peak-with-dip artifacts around the true Tm on typical data. Replaced by the BioRad port. |
| Post-smoothing pass (SavGol on the derivative) | Archived 2026-04-22 | [`src/lib/_archive.ts`](../src/lib/_archive.ts) (pattern only; code was inlined across 4 files) | Optional extra `savitzkyGolaySmooth` call on `melt.derivative[well]`, gated by `smoothingMeltDerivative` state + "Smooth melt -dF/dT" checkbox in Analysis tab. Redundant now that the derivative is inherently smooth by construction. Removed from UI, state, and all render paths (PlotArea, ResultsTable, plot-figure, ExportWizard). |

## Amplification smoothing

| | Status | Location | Notes |
|---|---|---|---|
| **Savitzky-Golay (poly order 2)** | **Active, opt-in** | [`src/lib/analysis.ts`](../src/lib/analysis.ts) `savitzkyGolaySmooth` | Applied in `useAnalysisResults` when `smoothingEnabled` is true. Default window 11 (was 7 pre-2026-04-22). Poly-2 fit, closed-form weights. Edge points passed through unchanged. |

## Baseline correction

| | Status | Location | Notes |
|---|---|---|---|
| **Auto-window flat-region detection + horizontal subtraction** | **Active** | [`src/lib/analysis.ts`](../src/lib/analysis.ts) `findFlatBaselineWindow`, `analyzeWell` | Noise floor from min 5-point rolling std, two-pointer Welford sweep for the longest window with std ≤ 2.5σ, capped to the first 70% of the curve. Global `baselineAuto` default on; per-well `WellBaselineOverride` can opt in/out (`auto?: boolean`) or force horizontal/linear. |
| Linear (least-squares drift correction) | Active (manual) | same | User-selectable via Baseline method dropdown. |

## Threshold / Tt detection

| | Status | Location | Notes |
|---|---|---|---|
| **RFU threshold → linear interpolation for fractional cycle** | **Active** | [`src/lib/analysis.ts`](../src/lib/analysis.ts) `analyzeWell` | Baseline-corrected RFU crosses the user-set (or auto) threshold; Tt is the interpolated x where the crossing occurred. Works for cycle and time x-axes. |

## Doubling time

| | Status | Location | Notes |
|---|---|---|---|
| **Log-linear fit over `[fitStartFraction, fitEndFraction]` of the growth region** | **Active** | [`src/lib/analysis.ts`](../src/lib/analysis.ts) `analyzeWell` | Defaults 10%-90% of the exponential region, user-adjustable from Analysis tab. |

---

## Archiving protocol

When retiring an algorithm:

1. Move the code verbatim into [`src/lib/_archive.ts`](../src/lib/_archive.ts) under a dated banner that names the replacement and the reason.
2. Add a row to the matching table above marking the old entry `Archived YYYY-MM-DD` and the new one `Active`.
3. Update `**Last Updated:**` at the top of this file and every other project MD per the global timestamp convention.
4. Do NOT delete — rollback should always be a copy-paste away.
