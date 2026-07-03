/**
 * `freeshoulder-fit` — the shared FreeShoulder curve-fit + fit-based-baseline
 * module, plus (as of v1.1.0) the pure per-curve kinetic math. Pure numeric
 * math: no host app types (nothing from `ExperimentData`, no React, no Node, no
 * DOM). Both the Primer Runs extractor and SHARP Data Processor 2 meet it at the
 * input/output contract only (see `shared_module_freeshoulder-fit.md`).
 *
 * This folder is kept identical across both repos — sync is a plain file copy.
 * Bump `FREESHOULDER_FIT_VERSION` whenever the module changes and copy the
 * folder across; if the two version constants differ, the modules have drifted.
 *
 * v1.1.0 (additive over the processor's current v1.0.0): folds in the CLI's pure
 * kinetic math — `onset.ts`, `landmarks.ts`, `melt.ts` — and the two pure signal
 * helpers they need (`signal.ts`: `savitzkyGolaySmooth`, `findFlatBaselineWindow`),
 * pulled in so the module stays free of any `@/` host import. The fit + baseline
 * files are unchanged from v1.0.0. The cross-well orchestrator stays app-specific.
 *
 * v1.2.0 (additive): `covarianceAtParams` — computes the per-parameter SEs / 6×6
 * covariance from a fit that was solved with `computeCovariance` OFF, without
 * re-running the LM search. Lets a host reuse a saved baseline fit (params only)
 * and obtain the report's SEs on demand. Purely additive: the fit/baseline/
 * kinetic contract is unchanged, so v1.1.x callers keep working.
 */

export const FREESHOULDER_FIT_VERSION = '1.2.0';

// ── Fit + baseline contract (unchanged from v1.0.0) ──
export type { FitKnobs, FitSeed, KineticKnobs, MeltPeak } from './types';
export { DEFAULT_FIT_KNOBS } from './types';

export type { FivePLParams, FivePLResult } from './fivepl';
export {
  fitFreeShoulder,
  fitFivePL,
  NO_FIT,
  curveAt,
  sigmoidAt,
  sigmoidSlope,
  findInflection,
  covarianceAtParams,
} from './fivepl';

export type { BaselineResult } from './baseline';
export { computeBaseline, curveRange, robustTrough } from './baseline';

// Numeric helpers a host orchestrator commonly needs alongside the fit.
export { median, mad, robustSigma, sampleSd } from './util';

// ── v1.1.0: pure per-curve kinetic math ──
export type { Window, OnsetResult } from './onset';
export { preOnsetWindow, differenceSigma, findOnset } from './onset';

export type { Landmarks, DerivedSE } from './landmarks';
export {
  findLandmarks,
  timeAtFraction,
  doublingTimeAtFraction,
  inflectionTimeOf,
  maxSlopeOf,
  propagateUncertainty,
} from './landmarks';

export type { MeltReadout } from './melt';
export { findMeltPeaks } from './melt';

export { savitzkyGolaySmooth, findFlatBaselineWindow } from './signal';
