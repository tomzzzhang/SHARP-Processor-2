# Algorithms — Active vs Archived

**Last Updated:** 2026-08-06 15:03 EDT

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
| **Fit-first FreeShoulder baseline** | **Active (Auto default)** | [`src/lib/curvefit/`](../src/lib/curvefit/) + [`src/lib/analysis.ts`](../src/lib/analysis.ts) `computeAutoFitBaseline` | Fits the 6-param FreeShoulder curve (shared `freeshoulder-fit` module — Kumaraswamy-warped logistic, multi-start Levenberg-Marquardt, dep `ml-levenberg-marquardt`) to the raw signal and subtracts the fitted lower asymptote `A` as the baseline level. Seeds `A` near the starting RFU; LM iterations capped at 120 (fitted `A` unchanged to <0.05 RFU vs 200). **Poor-fit rejection:** the fitted `A` is trusted only when the fit reports `baselineObserved` (r² ≥ 0.9 AND ≥8 reads below the pre-onset level = a real flat baseline anchoring `A`); a curve the single logistic can't represent (junk / non-amplifying NTC, or a two-shouldered NTC like private validation F6 whose `A` lands below the observed minimum) falls back to the robust trough. A 500-RFU cross-check vs the simple flat-window baseline is a further rejection guard. Runs on the ORIGINAL raw array, so smoothing / drift toggles reuse a cached fit. `computeCovariance` is off on this path (no SE/cov cost). Global `baselineAuto` default on; per-well `WellBaselineOverride` (`auto?: boolean`) opts wells in/out. |
| **Onset-based flat-window detection + horizontal subtraction** | **Active (fallback + cross-check)** | [`src/lib/analysis.ts`](../src/lib/analysis.ts) `findFlatBaselineWindow`, `analyzeWell` | Finds the amplification onset (first cycle risen 10% into the curve's span), trims leading warm-up drift, and takes the stretch up to a few cycles before onset. No longer the primary Auto baseline (superseded by the fit above) — retained as the fallback when the fit yields no usable level, the reference for the 500-RFU cross-check, and the noise / drift window for normalization + `computeDriftSlope`. |
| Horizontal / Linear (manual) | Active (manual) | `analyzeWell`, `applyBaseline` | User-selectable via the Baseline method dropdown; used when Auto is off globally or a well is opted out. |

## Threshold / Tt detection

| | Status | Location | Notes |
|---|---|---|---|
| **RFU threshold → linear interpolation for fractional cycle** | **Active** | [`src/lib/analysis.ts`](../src/lib/analysis.ts) `analyzeWell` | Baseline-corrected RFU crosses the user-set (or auto) threshold; Tt is the interpolated x where the crossing occurred. Works for cycle and time x-axes. |

## Doubling time

| | Status | Location | Notes |
|---|---|---|---|
| **Log-linear fit over `[fitStartFraction, fitEndFraction]` of the growth region** | **Active** | [`src/lib/analysis.ts`](../src/lib/analysis.ts) `analyzeWell` | Defaults 10%-90% of the exponential region, user-adjustable from Analysis tab. |

## Kinetic landmarks & readouts (Kinetics Report + main-plot landmarks)

| | Status | Location | Notes |
|---|---|---|---|
| **Fit-first kinetic landmarks / readouts** | **Active** | shared [`src/lib/curvefit/`](../src/lib/curvefit/) (`onset`, `landmarks`, `melt`) + [`src/lib/report/kinetics-report.ts`](../src/lib/report/kinetics-report.ts) | Read off the **reused** FreeShoulder fit + a pooled run σ (median of the amplifying wells' difference-σ): `t_lod` (LoD departure = baseline + x·σ crossing — **detection only**, computed for every fired curve), `t_onset10` (time to 10% of fitted height), the local doubling-time profile `Td₅/₂₀/₅₀`, `yield` (D−A), inflection, and melt Tm. Same `freeshoulder-fit` module as the Primer-Runs CLI extractor (**v1.2.0, matched across both repos**); the added `covarianceAtParams` yields the report's per-parameter SEs from the saved fit with **no LM re-solve** (numeric Jacobian + one inversion), and landmark SEs are Monte-Carlo-propagated. The fit-derived landmarks gate on `plateauObserved`, so a censored / junk fit (e.g. a flat NTC) emits no garbage value; `t_lod` does not (detection survives censoring). **No role / reference / NTC-reduced-set policy** — every curve gets the same attempt. Full readouts (with SEs) run **lazily** on Kinetics Report open, memoized on `(experiment, channel)`; a light variant `computeChannelLandmarks` (no covariance / MC) feeds the always-on main-plot landmark toggles + the results-table `t_LoD` / `10%` columns. |

---

## Archiving protocol

When retiring an algorithm:

1. Move the code verbatim into [`src/lib/_archive.ts`](../src/lib/_archive.ts) under a dated banner that names the replacement and the reason.
2. Add a row to the matching table above marking the old entry `Archived YYYY-MM-DD` and the new one `Active`.
3. Update `**Last Updated:**` at the top of this file and every other project MD per the global timestamp convention.
4. Do NOT delete — rollback should always be a copy-paste away.
