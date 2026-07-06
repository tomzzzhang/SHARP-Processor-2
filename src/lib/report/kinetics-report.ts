/**
 * Kinetics report orchestrator — a thin, app-specific layer over the shared
 * `freeshoulder-fit` module. Turns each curve (S-C pair) of one channel into a
 * per-curve kinetic readout row.
 *
 * This is the GENERAL per-curve readout path, NOT the Primer-Runs data
 * generator: there is **no role / NTC policy, no reference, no `tt_over_ref`**.
 * Every curve gets the same readout attempt; a non-amplifier censors naturally
 * (its fit doesn't converge / has no plateau, so the fit-derived columns fall to
 * null). The only cross-curve step is the run-level noise σ (median of the
 * amplifying wells' per-well σ), an instrument property.
 *
 * Reuse-the-fit + lazy-compute (the two Tom constraints):
 *  - The FreeShoulder fit is REUSED from the baseline pass via
 *    `computeAutoFitBaseline` (WeakMap-cached on the raw-array identity), so this
 *    never re-solves the multi-start LM. When the live pipeline already fit the
 *    well (auto baseline on) it's a cache hit; otherwise the fit is solved once,
 *    here, on report open, and cached.
 *  - The per-parameter SEs use `covarianceAtParams` (numeric Jacobian + one
 *    inversion at the saved params — the module's opt-in covariance without the
 *    LM), and the landmark SEs are Monte-Carlo'd from that covariance. All of it
 *    is a pure function of `(experiment, channel)`, independent of the user's
 *    threshold / smoothing / manual-zone UI, so a threshold drag never recomputes
 *    the report (see `useKineticsReport`).
 *
 * Pipeline order mirrors the CLI engine (the fit comes FIRST — it produces the
 * baseline): trough → (reused) fit → baseline = A → pre-onset σ → t_lod
 * (detection) → fit-based kinetics → yield/call → melt.
 */
import { computeAutoFitBaseline, findFlatPlateauWindow } from '@/lib/analysis';
import {
  computeBaseline, robustTrough, median,
  preOnsetWindow, differenceSigma, findOnset,
  findLandmarks, timeAtFraction, doublingTimeAtFraction, propagateUncertainty,
  findMeltPeaks, covarianceAtParams, NO_FIT,
  type FivePLResult, type FivePLParams, type MeltPeak,
} from '@/lib/curvefit';
import { curveKey } from '@/lib/curves';
import type { AmplificationData, MeltData, ExperimentData } from '@/types/experiment';

/**
 * Report knobs = the CLI `DEFAULT_KNOBS` fields the report actually reads. The
 * fit knobs (foot/shoulder bounds, iterations) are NOT here: the fit is reused,
 * not re-run, so only the onset / kinetic / melt / run-σ tunables apply. The
 * object structurally satisfies the module's narrow `KineticKnobs` surface.
 */
export const REPORT_KNOBS = {
  /** σ multiplier `x` in the LoD firing threshold (baseline + x·runσ). */
  sigmaMultiplierX: 8,
  /** `call` is negative when a fired well's yield is below this (0 ⇒ onset-only). */
  yieldFloor: 0,
  /** Fraction of fitted height for `t_onset10`. */
  onsetFractionForTime: 0.1,
  /** Fractions of fitted height at which the local doubling time is reported. */
  doublingFractions: [0.05, 0.2, 0.5] as number[],
  /** Fraction of fitted height that bounds the σ pre-onset region. */
  sigmaPreOnsetFraction: 0.05,
  /** Savitzky-Golay window for the model-free steepest-rise cross-check. */
  savgolWindow: 9,
  /** A melt −dF/dT local max counts as a peak above this fraction of the tallest. */
  meltPeakMinFractionOfMax: 0.4,
  meltPeakMinHeight: 0,
  /** A per-well σ above this × the provisional run σ is a gross outlier (`poor`). */
  sigmaOutlierFactor: 3,
};

export type ReportQuality = 'ok' | 'poor' | 'none';

/** One curve's kinetic readout row (S-C pair). Every continuous value carries a
 *  `*_se`. Fit-derived columns are null under censoring (`plateau_observed`). */
export interface ReportRow {
  curveKey: string;
  well: string;
  channel: string;
  sample: string;

  // ── baseline / noise ──
  baseline_offset: number | null;
  baseline_from_fit: boolean;
  baseline_observed: boolean;
  plateau_observed: boolean;
  well_sigma: number | null;
  run_sigma: number | null;
  quality: ReportQuality;

  // ── detection ──
  t_lod: number | null;
  t_lod_se: number | null;
  fired: boolean;

  // ── model-free cross-check ──
  t_mid: number | null;
  slope_mid: number | null;

  // ── fit-based kinetics ──
  t_onset10: number | null;
  t_onset10_se: number | null;
  td_5: number | null;
  td_5_se: number | null;
  td_20: number | null;
  td_20_se: number | null;
  td_50: number | null;
  td_50_se: number | null;
  td_slowdown: number | null;

  // ── yield ──
  yield_raw: number | null;
  yield_raw_se: number | null;
  plateau_start_s: number | null;

  // ── FreeShoulder fit (curve reconstruction) ──
  fit_A: number | null;
  fit_A_se: number | null;
  fit_B: number | null;
  fit_B_se: number | null;
  fit_C: number | null;
  fit_C_se: number | null;
  fit_D: number | null;
  fit_D_se: number | null;
  fit_foot: number | null;
  fit_foot_se: number | null;
  fit_shoulder: number | null;
  fit_shoulder_se: number | null;
  fit_inflection_t: number | null;
  fit_inflection_t_se: number | null;
  fit_max_slope: number | null;
  fit_max_slope_se: number | null;
  fit_rmse: number | null;
  fit_r2: number | null;
  fit_converged: boolean;
  shape_at_bound: boolean;

  // ── call ──
  call: 'positive' | 'negative' | null;

  // ── melt (null when the run has no melt) ──
  melt_has_peak: boolean | null;
  melt_peak_count: number | null;
  melt_peaks: MeltPeak[] | null;
  melt_tm: number | null;
  melt_tm_se: number | null;
  melt_peak_height: number | null;
  melt_peak_height_se: number | null;
}

export interface KineticsReport {
  channel: string;
  /** Pooled run σ used for the LoD call (median of the amplifying wells' σ). */
  runSigma: number;
  rows: ReportRow[];
  /** The x values (seconds) the fit + kinetics were computed on. */
  timeS: number[];
  knobs: typeof REPORT_KNOBS;
}

interface Pass1 {
  well: string;
  rfu: number[];
  fit: FivePLResult;
  corrected: number[];
  offset: number | null;
  fromFit: boolean;
  sigma: number;
  quality: ReportQuality;
}

/** NaN → null (readout columns are `number | null`, never NaN). */
function nz(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/**
 * A fit-derived TIME landmark is only a MEASUREMENT when it lands inside the
 * observed read window `[t0, tEnd]`. `timeAtFraction` is a closed-form
 * extrapolation off the warped sigmoid, so a near-flat NTC that the flexible
 * 6-param model fits as the tail of a heavily-warped curve can place its
 * %-of-height time far outside the data — e.g. a strongly negative `t_onset10`
 * for a curve whose fitted sigmoid centre sits before the run started. Such a
 * value is a warp artifact, not a reading; the fit-derived kinetics are
 * censored when it falls outside the window (this is the gap `plateauObserved`
 * alone does not close — a flat NTC's plateau IS observed, its rise is not).
 */
function withinWindow(t: number, timeS: number[]): boolean {
  return Number.isFinite(t) && t >= timeS[0] && t <= timeS[timeS.length - 1];
}

/**
 * Human explanation of WHY a curve has no reported fit — so the report can flag
 * it (e.g. on the residual strip) instead of silently showing nothing. Mirrors
 * the gates in `buildRow`: `fit_A === null` ⇒ the multi-start LM found no
 * solution; `!plateau_observed` ⇒ right-censored (no confident plateau — the
 * common "looks perfect but still rising" case); otherwise the fitted transition
 * landed outside the measured window (a flat / non-amplifying warp artifact).
 */
export function fitCensorReason(row: ReportRow): string {
  if (row.fit_A === null)
    return 'The FreeShoulder fit did not converge for this curve, so no fit or residuals are shown.';
  if (!row.plateau_observed)
    return 'No plateau observed — the curve has not leveled off into a clear plateau by the end of the run, so its ceiling and the %-of-height kinetics cannot be pinned down. No fit or residuals are reported for it.';
  return 'The fitted transition falls outside the measured time window (typical of a flat / non-amplifying curve), so no fit or residuals are shown.';
}

/** Mean of a slice [s, e) of an array. */
function meanSlice(a: number[], s: number, e: number): number {
  let sum = 0;
  for (let i = s; i < e; i++) sum += a[i];
  return sum / (e - s);
}

/**
 * Per-well baseline quality for the run-σ pool (no role logic — the CLI's NTC
 * exclusion is dropped): `none` if the fit doesn't anchor `A` or σ is unusable,
 * `poor` if σ is a gross outlier vs the provisional run σ (kept out of the
 * pool), else `ok` (these define the run σ). A flat non-amplifier fails the fit
 * → `none` → excluded automatically, which is why dropping the role filter still
 * yields a clean instrument σ.
 */
function assessQuality(
  baselineObserved: boolean,
  sigma: number,
  noiseRef: number,
  outlierFactor: number,
): ReportQuality {
  if (!baselineObserved || !Number.isFinite(sigma)) return 'none';
  if (Number.isFinite(noiseRef) && noiseRef > 0 && sigma > outlierFactor * noiseRef) return 'poor';
  return 'ok';
}

function blankRow(well: string, channel: string, sample: string): ReportRow {
  return {
    curveKey: curveKey(well, channel),
    well, channel, sample,
    baseline_offset: null,
    baseline_from_fit: false,
    baseline_observed: false,
    plateau_observed: false,
    well_sigma: null,
    run_sigma: null,
    quality: 'none',
    t_lod: null,
    t_lod_se: null,
    fired: false,
    t_mid: null,
    slope_mid: null,
    t_onset10: null,
    t_onset10_se: null,
    td_5: null,
    td_5_se: null,
    td_20: null,
    td_20_se: null,
    td_50: null,
    td_50_se: null,
    td_slowdown: null,
    yield_raw: null,
    yield_raw_se: null,
    plateau_start_s: null,
    fit_A: null,
    fit_A_se: null,
    fit_B: null,
    fit_B_se: null,
    fit_C: null,
    fit_C_se: null,
    fit_D: null,
    fit_D_se: null,
    fit_foot: null,
    fit_foot_se: null,
    fit_shoulder: null,
    fit_shoulder_se: null,
    fit_inflection_t: null,
    fit_inflection_t_se: null,
    fit_max_slope: null,
    fit_max_slope_se: null,
    fit_rmse: null,
    fit_r2: null,
    fit_converged: false,
    shape_at_bound: false,
    call: null,
    melt_has_peak: null,
    melt_peak_count: null,
    melt_peaks: null,
    melt_tm: null,
    melt_tm_se: null,
    melt_peak_height: null,
    melt_peak_height_se: null,
  };
}

function buildRow(
  p: Pass1,
  channel: string,
  timeS: number[],
  melt: MeltData | null,
  runSigma: number,
  sample: string,
): ReportRow {
  const { well, rfu, fit, corrected } = p;
  const K = REPORT_KNOBS;
  const row = blankRow(well, channel, sample);

  // ── baseline / σ ──
  row.baseline_offset = p.offset;
  row.baseline_from_fit = p.fromFit;
  row.quality = p.quality;
  row.well_sigma = Number.isFinite(p.sigma) ? p.sigma : null;
  row.run_sigma = Number.isFinite(runSigma) ? runSigma : null;

  // ── onset / detection ──
  const onset = findOnset(corrected, timeS, runSigma, K.sigmaMultiplierX);
  row.t_lod = onset.tLod;
  row.t_lod_se = onset.tLodSe;
  row.fired = onset.fired;

  // ── melt (all curves) ──
  const meltD = melt?.derivative?.[well];
  const m = melt && meltD ? findMeltPeaks(melt.temperatureC, meltD, K) : null;
  if (m) {
    row.melt_has_peak = m.hasPeak;
    row.melt_peak_count = m.count;
    row.melt_peaks = m.peaks;
    row.melt_tm = m.tm;
    row.melt_tm_se = m.tmSe;
    row.melt_peak_height = m.height;
    row.melt_peak_height_se = m.heightSe;
  }

  // ── fit flags ──
  row.fit_rmse = fit.rmse;
  row.fit_r2 = fit.r2;
  row.fit_converged = fit.converged;
  row.baseline_observed = fit.baselineObserved;
  row.plateau_observed = fit.plateauObserved;
  row.shape_at_bound = fit.shapeAtBound;

  const fitUsable =
    fit.A !== null && fit.B !== null && fit.C !== null && fit.D !== null &&
    fit.foot !== null && fit.shoulder !== null;

  if (fitUsable) {
    const params: FivePLParams = {
      A: fit.A!, B: fit.B!, C: fit.C!, D: fit.D!, foot: fit.foot!, shoulder: fit.shoulder!,
    };
    // Covariance ON DEMAND from the saved params — the module's numeric Jacobian
    // + one inversion, WITHOUT re-running the LM (`covarianceAtParams`).
    const { se: cse, cov } = covarianceAtParams(rfu, timeS, params);
    const dse = propagateUncertainty(params, cov, K, timeS[0], timeS[timeS.length - 1]);

    // A, B, C survive censoring (the rising part is well-determined without the
    // plateau).
    row.fit_A = fit.A;
    row.fit_A_se = cse?.A ?? null;
    row.fit_B = fit.B;
    row.fit_B_se = cse?.B ?? null;
    row.fit_C = fit.C;
    row.fit_C_se = cse?.C ?? null;

    // The %-of-height kinetics are trustworthy only when the upper shoulder is
    // real (plateauObserved) AND the fitted transition actually lies within the
    // measured data — a flat NTC can pass plateauObserved yet place its rise
    // (10%-of-height time) outside the run, giving a nonsense t_onset10.
    const onset10 = timeAtFraction(params, K.onsetFractionForTime);
    if (fit.plateauObserved && withinWindow(onset10, timeS)) {
      // The upper shoulder is real → D / foot / shoulder / yield and the
      // %-of-height kinetics are trustworthy.
      row.fit_D = fit.D;
      row.fit_D_se = cse?.D ?? null;
      row.fit_foot = fit.foot;
      row.fit_foot_se = cse?.foot ?? null;
      row.fit_shoulder = fit.shoulder;
      row.fit_shoulder_se = cse?.shoulder ?? null;
      row.yield_raw = fit.D! - fit.A!;
      row.yield_raw_se = dse?.yieldRawSe ?? null;

      row.t_onset10 = nz(onset10);
      row.t_onset10_se = dse?.tOnset10Se ?? null;
      const [f5, f20, f50] = K.doublingFractions;
      row.td_5 = nz(doublingTimeAtFraction(params, f5));
      row.td_5_se = dse?.td5Se ?? null;
      row.td_20 = nz(doublingTimeAtFraction(params, f20));
      row.td_20_se = dse?.td20Se ?? null;
      row.td_50 = nz(doublingTimeAtFraction(params, f50));
      row.td_50_se = dse?.td50Se ?? null;
      row.td_slowdown =
        row.td_5 && row.td_50 && row.td_5 > 0 ? row.td_50 / row.td_5 : null;
      row.fit_inflection_t = fit.inflectionT;
      row.fit_inflection_t_se = dse?.inflectionTSe ?? null;
      row.fit_max_slope = fit.maxSlope;
      row.fit_max_slope_se = dse?.maxSlopeSe ?? null;
    }
  }

  // ── plateau start + yield fallback (all curves) ──
  const plateauWin = findFlatPlateauWindow(corrected);
  row.plateau_start_s = plateauWin ? timeS[plateauWin.start - 1] : null;
  if (row.yield_raw === null) {
    // A censored (or non-fitting) curve still reports a model-free yield: the
    // mean over the flat-plateau window, or the final corrected RFU.
    row.yield_raw = plateauWin
      ? meanSlice(corrected, plateauWin.start - 1, plateauWin.end)
      : (corrected[corrected.length - 1] ?? null);
  }

  // ── call: amplified / did-not-amplify (fired + yield over floor) ──
  const yieldForCall = row.yield_raw;
  const positive = onset.fired && yieldForCall !== null && yieldForCall > K.yieldFloor;
  row.call = positive ? 'positive' : 'negative';

  // ── model-free steepest-rise cross-check / fallback ──
  if (onset.fired) {
    const lm = findLandmarks(corrected, timeS, K.savgolWindow, onset.tLod);
    row.t_mid = lm.tMid;
    row.slope_mid = lm.slopeMid;
  }

  return row;
}

/**
 * Compute the kinetics report for one channel's amplification (+ optional melt).
 * `sampleOf` maps a well to its display sample name.
 */
export function computeChannelReport(
  amp: AmplificationData,
  melt: MeltData | null,
  wells: string[],
  channel: string,
  sampleOf: (well: string) => string,
): KineticsReport {
  // Fit + kinetics run in SECONDS (cross-run comparability; the fitted `A` and
  // the reported times are then x-unit independent). Fall back to cycle indices
  // when the run carries no time axis.
  const timeS = amp.timeS && amp.timeS.length >= 2 ? amp.timeS : amp.cycle;
  const K = REPORT_KNOBS;

  // ── Pass 1: (reused) fit → baseline → pre-onset σ ──
  const pass1: Pass1[] = [];
  for (const well of wells) {
    const rfu = amp.wells[well];
    if (!rfu) continue;
    const autoFit = computeAutoFitBaseline(rfu, timeS); // cached → no LM re-solve
    const fit = autoFit?.fit ?? NO_FIT;
    const trough = robustTrough(rfu);
    const base = computeBaseline(rfu, fit, trough);
    const win = preOnsetWindow(fit, rfu, timeS, K);
    const sigma = differenceSigma(rfu, win);
    pass1.push({
      well, rfu, fit,
      corrected: base.corrected, offset: base.offset, fromFit: base.fromFit,
      sigma, quality: 'none',
    });
  }

  // ── Run σ: median of the amplifying (`ok`) wells' σ. Bootstrap the pool with
  //    a provisional σ from the anchored-baseline wells (no role exclusion). ──
  const finiteSigmas = pass1.filter((p) => Number.isFinite(p.sigma)).map((p) => p.sigma);
  const provisional = pass1
    .filter((p) => p.fit.baselineObserved && Number.isFinite(p.sigma))
    .map((p) => p.sigma);
  const provisionalSigma = median(provisional.length ? provisional : finiteSigmas);
  for (const p of pass1) {
    p.quality = assessQuality(p.fit.baselineObserved, p.sigma, provisionalSigma, K.sigmaOutlierFactor);
  }
  const okSigmas = pass1
    .filter((p) => p.quality === 'ok' && Number.isFinite(p.sigma))
    .map((p) => p.sigma);
  const runSigma = median(okSigmas.length ? okSigmas : finiteSigmas);

  // ── Pass 2: per-curve readouts ──
  const rows = pass1.map((p) => buildRow(p, channel, timeS, melt, runSigma, sampleOf(p.well)));
  return { channel, runSigma, rows, timeS, knobs: K };
}

/** The subset of kinetic landmarks the MAIN plot + results table need — light
 *  enough to compute for every well without the report's covariance / MC SEs. */
export interface WellLandmark {
  /** Detection time (s), the LoD departure. Null if the curve never fires. */
  tLod: number | null;
  /** Time to 10% of fitted height (s). Null when the fit isn't usable. */
  tOnset10: number | null;
  /** Fitted inflection time (s), or null. */
  inflectionT: number | null;
  fired: boolean;
}

/**
 * Lightweight per-well kinetic landmarks for one channel — the same fit-first
 * pipeline as the report (reused fits, pooled run σ) but WITHOUT the covariance /
 * Monte-Carlo SE work, so it's cheap enough to run in the always-on analysis
 * path. Pure function of the channel's raw amplification data (the fit-derived
 * baseline is used, independent of the UI baseline settings), so a caller can
 * memoize it on the experiment.
 */
export function computeChannelLandmarks(amp: AmplificationData, wells: string[]): Map<string, WellLandmark> {
  const timeS = amp.timeS && amp.timeS.length >= 2 ? amp.timeS : amp.cycle;
  const K = REPORT_KNOBS;

  // Pass 1: (reused) fit → baseline → pre-onset σ.
  const pass1: { well: string; fit: FivePLResult; corrected: number[]; sigma: number; quality: ReportQuality }[] = [];
  for (const well of wells) {
    const rfu = amp.wells[well];
    if (!rfu) continue;
    const autoFit = computeAutoFitBaseline(rfu, timeS);
    const fit = autoFit?.fit ?? NO_FIT;
    const base = computeBaseline(rfu, fit, robustTrough(rfu));
    const sigma = differenceSigma(rfu, preOnsetWindow(fit, rfu, timeS, K));
    pass1.push({ well, fit, corrected: base.corrected, sigma, quality: 'none' });
  }

  // Run σ over the amplifying (`ok`) wells — same pooling as the report.
  const finiteSigmas = pass1.filter((p) => Number.isFinite(p.sigma)).map((p) => p.sigma);
  const provisional = pass1
    .filter((p) => p.fit.baselineObserved && Number.isFinite(p.sigma))
    .map((p) => p.sigma);
  const provisionalSigma = median(provisional.length ? provisional : finiteSigmas);
  for (const p of pass1) {
    p.quality = assessQuality(p.fit.baselineObserved, p.sigma, provisionalSigma, K.sigmaOutlierFactor);
  }
  const okSigmas = pass1.filter((p) => p.quality === 'ok' && Number.isFinite(p.sigma)).map((p) => p.sigma);
  const runSigma = median(okSigmas.length ? okSigmas : finiteSigmas);

  // Pass 2: t_lod (detection, for every fired curve) + t_onset10 / inflection
  // (only when the fit's plateau is observed — the same gating the report uses,
  // so a censored / junk fit like a flat NTC can't emit a garbage landmark).
  const out = new Map<string, WellLandmark>();
  for (const p of pass1) {
    const onset = findOnset(p.corrected, timeS, runSigma, K.sigmaMultiplierX);
    const f = p.fit;
    let tOnset10: number | null = null;
    let inflectionT: number | null = null;
    if (f.plateauObserved && f.A !== null && f.B !== null && f.C !== null && f.D !== null && f.foot !== null && f.shoulder !== null) {
      const params: FivePLParams = { A: f.A, B: f.B, C: f.C, D: f.D, foot: f.foot, shoulder: f.shoulder };
      // Same window gate as the report: a fitted 10%-height time outside the
      // measured data is a warp extrapolation (flat NTC), not a landmark.
      const t10 = timeAtFraction(params, K.onsetFractionForTime);
      if (withinWindow(t10, timeS)) {
        tOnset10 = nz(t10);
        inflectionT = f.inflectionT;
      }
    }
    out.set(p.well, { tLod: onset.tLod, tOnset10, inflectionT, fired: onset.fired });
  }
  return out;
}

/** Compute the report for one channel of an experiment (pulls amp/melt/samples
 *  off `ExperimentData`). Pure function of `(exp, channel)` — memoize on those. */
export function computeExperimentReport(exp: ExperimentData, channel: string): KineticsReport {
  const amp = exp.amplificationByChannel[channel] ?? null;
  const melt = exp.meltByChannel[channel] ?? null;
  if (!amp) return { channel, runSigma: NaN, rows: [], timeS: [], knobs: REPORT_KNOBS };
  const sampleOf = (well: string) => exp.wells[well]?.sample ?? '';
  return computeChannelReport(amp, melt, exp.wellsUsed, channel, sampleOf);
}
