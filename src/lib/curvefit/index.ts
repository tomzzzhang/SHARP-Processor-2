/**
 * `freeshoulder-fit` — the shared FreeShoulder curve-fit + fit-based-baseline
 * module. Pure numeric math: no host app types (nothing from `ExperimentData`,
 * no React, no Node, no DOM). Both the Primer Runs extractor and SHARP Data
 * Processor 2 meet it at the input/output contract only (see
 * `shared_module_freeshoulder-fit.md`).
 *
 * This folder is kept identical across both repos — sync is a plain file copy.
 * Bump `FREESHOULDER_FIT_VERSION` whenever the module changes and copy the
 * folder across; if the two version constants differ, the modules have drifted.
 */

export const FREESHOULDER_FIT_VERSION = '1.0.0';

export type { FitKnobs, FitSeed } from './types';
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
} from './fivepl';

export type { BaselineResult } from './baseline';
export { computeBaseline, curveRange, robustTrough } from './baseline';
