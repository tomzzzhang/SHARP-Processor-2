/**
 * Fit-based kinetics + a model-free derivative cross-check.
 *
 * Read off the fitted FreeShoulder curve `g(t) = A + (D−A)·w(t)`, with "max"
 * := `D` (closed-form warp inversion for time/Td):
 *   • `t_onset10` — time to reach a fixed fraction `f` of height:
 *     `S_f = [1 − (1−f)^(1/shoulder)]^(1/foot)`, `t(f) = C + ln(S_f/(1−S_f))/B`.
 *   • the LOCAL doubling-time profile `Td(f)` at 5 / 20 / 50% of height:
 *     `w'(t_f) = foot·shoulder·S_f^(foot−1)·(1−S_f^foot)^(shoulder−1)·B·S_f·(1−S_f)`,
 *     `Td(f) = ln2·f / w'(t_f)`. Height cancels, so Td depends only on
 *     B/C/foot/shoulder, not A/D.
 *   • `inflection_t` / `max_slope` — NUMERIC (no closed form for the warped
 *     inflection): argmax of `sigmoidSlope` via `findInflection` (`fivepl.ts`).
 *
 * SEs for these derived quantities are Monte-Carlo'd from the fit covariance
 * (`propagateUncertainty`): the bounded/nonlinear transforms make a closed-form
 * delta method fiddly, and drawing ~500 param vectors from MVN(params, cov)
 * handles them uniformly. The draw is seeded so the SEs are reproducible.
 *
 * `findLandmarks` keeps Processor 2's Savitzky-Golay steepest-rise point as a
 * model-free `t_mid`/`slope_mid` cross-check + fallback when the fit fails.
 */
import { savitzkyGolaySmooth } from './signal';
import { findInflection } from './fivepl';
import type { FivePLParams } from './fivepl';
import type { KineticKnobs } from './types';
import { cholesky, gaussian, mulberry32, sampleSd } from './util';

/** S at warp fraction f: S_f = [1 − (1−f)^(1/shoulder)]^(1/foot), or NaN when
 *  f/foot/shoulder put it outside (0,1) (out-of-domain → caller returns NaN). */
function sAtFraction(f: number, p: FivePLParams): number {
  if (!(f > 0 && f < 1) || !(p.foot > 0) || !(p.shoulder > 0)) return NaN;
  const inner = 1 - Math.pow(1 - f, 1 / p.shoulder);
  if (!(inner > 0)) return NaN;
  const S = Math.pow(inner, 1 / p.foot);
  return S > 0 && S < 1 ? S : NaN;
}

/** Time at which the DE-DRIFTED sigmoid reaches fraction `f` of its height. */
export function timeAtFraction(p: FivePLParams, f: number): number {
  if (!(p.B > 0) || !(p.D > p.A)) return NaN;
  const S = sAtFraction(f, p);
  if (!Number.isFinite(S)) return NaN;
  return p.C + Math.log(S / (1 - S)) / p.B;
}

/** Local doubling time of the DE-DRIFTED sigmoid at fraction `f` of height (s). */
export function doublingTimeAtFraction(p: FivePLParams, f: number): number {
  if (!(p.B > 0)) return NaN;
  const S = sAtFraction(f, p);
  if (!Number.isFinite(S)) return NaN;
  const Sp = Math.pow(S, p.foot);
  if (!(Sp > 0 && Sp < 1)) return NaN;
  const wp = p.foot * p.shoulder * Math.pow(S, p.foot - 1) * Math.pow(1 - Sp, p.shoulder - 1) * p.B * S * (1 - S);
  if (!(wp > 0)) return NaN;
  return (Math.LN2 * f) / wp;
}

/** Inflection time of the DE-DRIFTED sigmoid — numeric (no closed form). */
export function inflectionTimeOf(p: FivePLParams, t1: number, tEnd: number): number {
  return findInflection(p, t1, tEnd).t;
}

/** Max slope of the DE-DRIFTED sigmoid (at the inflection), RFU/s — numeric. */
export function maxSlopeOf(p: FivePLParams, t1: number, tEnd: number): number {
  return findInflection(p, t1, tEnd).slope;
}

export interface DerivedSE {
  tOnset10Se: number | null;
  td5Se: number | null;
  td20Se: number | null;
  td50Se: number | null;
  inflectionTSe: number | null;
  maxSlopeSe: number | null;
  yieldRawSe: number | null;
}

const MC_DRAWS = 500;
const MC_SEED = 0x5eed5eed;
/** Grid density for the inflection search INSIDE the MC loop (500 draws/well):
 *  SE-grade precision is enough here, unlike the reported point estimate
 *  (`fitFivePL`, which uses `findInflection`'s full 2000-point default). */
const MC_INFLECTION_GRID = 400;

/** Lower-triangular factor for MVN sampling: Cholesky, or a diagonal fallback
 *  (independent draws) when the covariance is not positive-definite. */
function mvnFactor(cov: number[][]): number[][] | null {
  const L = cholesky(cov);
  if (L) return L;
  const n = cov.length;
  const diag: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let any = false;
  for (let i = 0; i < n; i++) {
    if (cov[i][i] > 0) {
      diag[i][i] = Math.sqrt(cov[i][i]);
      any = true;
    }
  }
  return any ? diag : null;
}

/**
 * Monte-Carlo SEs for the derived landmarks from the fit covariance. Draws
 * MVN(params, cov) and takes the sample SD of each landmark; draws that fall
 * outside a landmark's domain are dropped for that landmark only.
 *
 * `t1`/`tEnd` (the well's actual read-time range) bound the inflection search
 * for every draw — the numeric warp inflection has no closed form and no
 * natural characteristic scale robust to extreme foot/shoulder draws, so it
 * is scanned over the same domain the data actually covers.
 */
export function propagateUncertainty(
  params: FivePLParams,
  cov: number[][] | null,
  knobs: KineticKnobs,
  t1: number,
  tEnd: number,
): DerivedSE | null {
  const empty: DerivedSE = {
    tOnset10Se: null, td5Se: null, td20Se: null, td50Se: null,
    inflectionTSe: null, maxSlopeSe: null, yieldRawSe: null,
  };
  if (!cov) return empty;
  const L = mvnFactor(cov);
  if (!L) return empty;

  const rand = mulberry32(MC_SEED);
  const mean = [params.A, params.B, params.C, params.D, params.foot, params.shoulder];
  const f10 = knobs.onsetFractionForTime;
  const [f5, f20, f50] = knobs.doublingFractions;

  const acc = {
    tOnset10: [] as number[], td5: [] as number[], td20: [] as number[], td50: [] as number[],
    inflectionT: [] as number[], maxSlope: [] as number[], yieldRaw: [] as number[],
  };
  const push = (arr: number[], v: number) => {
    if (Number.isFinite(v)) arr.push(v);
  };

  for (let d = 0; d < MC_DRAWS; d++) {
    const z = Array.from({ length: 6 }, () => gaussian(rand));
    const q = mean.map((m, i) => {
      let s = m;
      for (let j = 0; j <= i; j++) s += L[i][j] * z[j];
      return s;
    });
    const pp: FivePLParams = { A: q[0], B: q[1], C: q[2], D: q[3], foot: q[4], shoulder: q[5] };
    push(acc.tOnset10, timeAtFraction(pp, f10));
    push(acc.td5, doublingTimeAtFraction(pp, f5));
    push(acc.td20, doublingTimeAtFraction(pp, f20));
    push(acc.td50, doublingTimeAtFraction(pp, f50));
    if (pp.D > pp.A && pp.B > 0 && pp.foot > 0 && pp.shoulder > 0) {
      const infl = findInflection(pp, t1, tEnd, MC_INFLECTION_GRID);
      push(acc.inflectionT, infl.t);
      push(acc.maxSlope, infl.slope);
    }
    push(acc.yieldRaw, pp.D - pp.A);
  }

  const sd = (arr: number[]) => (arr.length >= 2 ? sampleSd(arr) : null);
  return {
    tOnset10Se: sd(acc.tOnset10),
    td5Se: sd(acc.td5),
    td20Se: sd(acc.td20),
    td50Se: sd(acc.td50),
    inflectionTSe: sd(acc.inflectionT),
    maxSlopeSe: sd(acc.maxSlope),
    yieldRawSe: sd(acc.yieldRaw),
  };
}

export interface Landmarks {
  tMid: number | null;
  slopeMid: number | null;
}

/**
 * Model-free steepest-rise point: smooth the baseline-corrected curve
 * (Savitzky-Golay), take the first derivative, report the time of its maximum
 * (`t_mid`) and the slope there (`slope_mid`, RFU/s). A cross-check against the
 * fit's inflection, and the fallback when the fit fails.
 *
 * @param searchFromS ignore the curve before this time (e.g. t_lod) so a noisy
 *                    baseline can't out-slope the real rise; null = whole curve
 */
export function findLandmarks(
  corrected: number[],
  timeS: number[],
  window: number,
  searchFromS: number | null,
): Landmarks {
  const n = Math.min(corrected.length, timeS.length);
  if (n < 5) return { tMid: null, slopeMid: null };

  const smooth = savitzkyGolaySmooth(corrected, window);

  let bestSlope = -Infinity;
  let bestIdx = -1;
  for (let i = 1; i < n - 1; i++) {
    if (searchFromS !== null && timeS[i] < searchFromS) continue;
    const dt = timeS[i + 1] - timeS[i - 1];
    if (dt <= 0) continue;
    const slope = (smooth[i + 1] - smooth[i - 1]) / dt;
    if (slope > bestSlope) {
      bestSlope = slope;
      bestIdx = i;
    }
  }

  if (bestIdx < 0 || !Number.isFinite(bestSlope)) return { tMid: null, slopeMid: null };
  return { tMid: timeS[bestIdx], slopeMid: bestSlope };
}
