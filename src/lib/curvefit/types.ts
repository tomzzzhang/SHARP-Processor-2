/**
 * `freeshoulder-fit` module knob surface — the frozen v1.x input contract
 * (see `shared_module_freeshoulder-fit.md` §3). Deliberately NARROWER than the
 * host readout engine's `EngineKnobs`: the shared module only needs the fit
 * tunables, so it carries no dependency on any host type. Both apps meet the
 * module at these knobs and the result/baseline shapes only.
 */
export interface FitKnobs {
  /** Foot (lower-knee) bend bound, NORMALISED units — numerical stability only.
   *  `foot=1` is a plain logistic foot; small/large values round/sharpen it. */
  footBounds: [number, number];
  /** Shoulder (upper-knee) bend bound, NORMALISED units — what lets the model
   *  round the sharp corner a Richards `G→∞` (unidentifiable) had to chase. */
  shoulderBounds: [number, number];
  /** The fit is considered usable (the basis of `baselineObserved`) when its r²
   *  reaches this. */
  fivePLMinR2: number;
  /** `baselineObserved` requires at least this many reads below the pre-onset
   *  fraction of height (a real pre-rise stretch to anchor `A`). */
  minBaselinePoints: number;
  /** Fraction of fitted height that bounds the pre-onset region (reads before
   *  the fit reaches this fraction) counted for `baselineObserved`. */
  sigmaPreOnsetFraction: number;
  /** Max LM iterations for the FreeShoulder fit (per multi-start seed). */
  fivePLMaxIterations: number;
  /** When false (the baseline path) the fit skips the numeric Jacobian + matrix
   *  inversion, so `se`/`cov` come back null. The report slice sets this true. */
  computeCovariance: boolean;
}

/** Defaults for every knob (the values validated on the private validation fixture). */
export const DEFAULT_FIT_KNOBS: FitKnobs = {
  footBounds: [0.05, 50],
  shoulderBounds: [0.05, 50],
  fivePLMinR2: 0.9,
  minBaselinePoints: 8,
  sigmaPreOnsetFraction: 0.05,
  fivePLMaxIterations: 200,
  computeCovariance: false,
};

/** Low estimates that anchor `A`. For baseline use, seed `A` around the starting
 *  RFU (`startRfu`, the early reads) with the robust trough as the secondary
 *  anchor and the fallback level when the fit fails (see §1.1). */
export interface FitSeed {
  trough: number;
  startRfu?: number;
}

// ── v1.1.0 additions: the pure per-curve kinetic surface (onset/landmarks/melt).
//    Additive — the frozen fit contract (FitKnobs/FitSeed above) is unchanged.

/** A melt −dF/dT peak (temperature + height). Produced by `melt.ts`; each host
 *  orchestrator mirrors it onto its readout row. */
export interface MeltPeak {
  /** Melt temperature at the −dF/dT peak (°C). */
  tm: number;
  /** −dF/dT height at the peak. */
  height: number;
}

/**
 * Knob surface for the v1.1.0 kinetic math (onset / landmarks / melt).
 * Deliberately NARROW — the module only reads these fields — so each host
 * orchestrator's wider knob object (e.g. the CLI's `EngineKnobs`) satisfies it
 * structurally without the module depending on any host type.
 */
export interface KineticKnobs {
  /** Fraction of fitted height for the time-to-onset readout `t_onset10`. */
  onsetFractionForTime: number;
  /** Fractions of fitted height at which the LOCAL doubling time is reported. */
  doublingFractions: number[];
  /** Fraction of fitted height that bounds the σ pre-onset region (reads before
   *  the fit reaches this fraction). */
  sigmaPreOnsetFraction: number;
  /** A melt −dF/dT local max counts as a peak when its height is at least this
   *  fraction of the well's tallest peak AND at least `meltPeakMinHeight`. */
  meltPeakMinFractionOfMax: number;
  meltPeakMinHeight: number;
}
