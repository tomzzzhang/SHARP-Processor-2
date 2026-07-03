/**
 * FreeShoulder fit of the RAW amplification curve — a Kumaraswamy-warped
 * logistic (6 parameters, no plateau-slope term):
 *   S(t)   = 1 / (1 + e^(−B·(t − C)))
 *   w(t)   = 1 − (1 − S^foot)^shoulder
 *   f(t)   = A + (D − A)·w(t)
 *
 * A = baseline (the lower asymptote), D = the ceiling ("max"), B = the
 * underlying logistic rate, C = the logistic center (the warp shifts the
 * VISIBLE inflection off C). `foot`/`shoulder` independently bend the
 * lower/upper knee of the warp (foot=shoulder=1 ⇒ plain 4PL logistic). The
 * free shoulder rounds the upper knee that Richards could not (G→∞,
 * unidentifiable, on sharp-knee curves like May5). It won the model bake-off
 * as a generalizable shape improvement (`model_exploration.md`).
 *
 * The linear plateau-slope (`+mx`) term was TRIED and DROPPED (Tom, 2026-06-30
 * evening): on this fixture the drooping plateaus that made `+mx` look best are
 * a run-length photobleaching artifact, and the drift term `m·(t−C)` tilted the
 * fitted `A` off the true foot baseline on slow curves (large C) and admitted a
 * degenerate "drift-does-the-work" local optimum. Plain FreeShoulder keeps `A`
 * honestly the baseline and the primary landmarks (`t_onset10`, the Td profile)
 * essentially unchanged (`landmark-test`: adding mx moved `t_onset10` <2%).
 *
 * Kinetics read off the fitted curve with "max" := `D` (the ceiling, a fit
 * parameter, not the time-varying data peak). Because there is no drift term,
 * `sigmoidAt`/`sigmoidSlope` (used by the landmarks) and `curveAt` (used by the
 * covariance Jacobian and plotting) are the SAME curve — the split is retained
 * only so a future model with a nuisance term can re-diverge them without
 * touching callers.
 *
 * Fit FIRST, fit to RAW RFU, MULTI-START in NORMALISED coordinates
 * (t/tScale, y/yScale) per the validated FreeShoulder spec in `model-explore.ts`
 * (8 seeds spanning B and the two bend parameters; pick the min-SSE seed).
 *
 * The covariance (per-parameter standard errors) is an OPT-IN step
 * (`knobs.computeCovariance`, default off). On the baseline path it is off, so
 * the expensive numeric Jacobian + matrix inversion is skipped and `se`/`cov`
 * come back null — the baseline needs only the fitted `A`. When on (the report
 * slice), a numeric Jacobian of `curveAt` at the fitted params gives
 * cov = σ̂²·(JᵀJ)⁻¹ with σ̂² = RSS/(n−6); that single covariance powers BOTH the
 * per-parameter SEs and the censoring flags (`seD/D` is the `plateau_observed`
 * test). Derived-landmark SEs are Monte-Carlo'd from the covariance downstream.
 */
import { levenbergMarquardt } from 'ml-levenberg-marquardt';
import type { FitKnobs, FitSeed } from './types';
import { curveRange, matInvert } from './util';

export interface FivePLParams {
  A: number;
  B: number;
  C: number;
  D: number;
  foot: number;
  shoulder: number;
}

export interface FivePLResult {
  A: number | null;
  B: number | null;
  C: number | null;
  D: number | null;
  foot: number | null;
  shoulder: number | null;
  inflectionT: number | null;
  maxSlope: number | null;
  rmse: number | null;
  r2: number | null;
  converged: boolean;
  /** `foot`/`shoulder` landed within 1% of a bound (weakly identified shape)
   *  → informational, like `g_at_bound` was. The honest confidence signal is
   *  each readout's `*_se`, not this flag. */
  shapeAtBound: boolean;
  /** A real pre-rise stretch anchors `A` (≥ minBaselinePoints below the
   *  pre-onset fraction). False ⇒ use the robust trough for the baseline. */
  baselineObserved: boolean;
  /** The upper shoulder is real, not extrapolated (end reaches ~90% of D and
   *  seD/D is small). False ⇒ right-censored: D/foot/shoulder/yield are not
   *  trustworthy. */
  plateauObserved: boolean;
  /** Per-parameter standard errors (sqrt of the covariance diagonal), or null
   *  when the covariance is not computed (`computeCovariance` off) or JᵀJ is
   *  singular / too few points. */
  se: { A: number; B: number; C: number; D: number; foot: number; shoulder: number } | null;
  /** 6×6 parameter covariance in real units, for MC SE propagation. Null on the
   *  baseline path (`computeCovariance` off). */
  cov: number[][] | null;
}

const NULL_FIT: FivePLResult = {
  A: null, B: null, C: null, D: null, foot: null, shoulder: null,
  inflectionT: null, maxSlope: null, rmse: null, r2: null, converged: false,
  shapeAtBound: false, baselineObserved: false, plateauObserved: false, se: null, cov: null,
};

/** "No fit was run" — used for NTC rows (the reduced readout set). */
export const NO_FIT: FivePLResult = NULL_FIT;

/** Underlying logistic S(t) = 1/(1+e^(−B(t−C))), overflow-safe for t≪C
 *  (mirrors the Richards-era `e>700` guard pattern). */
function sigmoidS(t: number, p: FivePLParams): number {
  const e = -p.B * (t - p.C);
  if (e > 700) return 0;
  return 1 / (1 + Math.exp(e));
}

/** Kumaraswamy warp w(S) = 1 − (1 − S^foot)^shoulder. Both bases stay in
 *  [0,1] for S∈[0,1], so this can only underflow cleanly to 0/1 — no
 *  overflow guard needed (unlike the Richards `(1+u)^(−G)` foot). */
function warpAt(S: number, p: FivePLParams): number {
  if (S <= 0) return 0;
  if (S >= 1) return 1;
  const Sp = Math.pow(S, p.foot);
  return 1 - Math.pow(1 - Sp, p.shoulder);
}

/** Derivative dw/dt at the given S (chain rule through S(t)); the analytic
 *  curve slope is `(D−A)·warpSlope(...)` (`sigmoidSlope`). */
function warpSlopeAt(S: number, p: FivePLParams): number {
  if (!(S > 0 && S < 1)) return 0; // flat at the S=0/1 asymptotes
  const Sp = Math.pow(S, p.foot);
  if (!(Sp > 0 && Sp < 1)) return 0;
  return p.foot * p.shoulder * Math.pow(S, p.foot - 1) * Math.pow(1 - Sp, p.shoulder - 1) * p.B * S * (1 - S);
}

/** The fitted curve `A + (D−A)·w(t)`. Used by the covariance Jacobian and by
 *  report/poc plotting. (No drift term, so this equals `sigmoidAt`.) */
export function curveAt(t: number, p: FivePLParams): number {
  const S = sigmoidS(t, p);
  return p.A + (p.D - p.A) * warpAt(S, p);
}

/** The curve the kinetic landmarks read off ("max" := D, the ceiling). Equal
 *  to `curveAt` while the model has no nuisance term; kept separate so a future
 *  drift-carrying model can re-diverge them without touching callers. */
export function sigmoidAt(t: number, p: FivePLParams): number {
  return curveAt(t, p);
}

/** Analytic first derivative of the fitted curve (RFU/s). Replaces
 *  `richardsSlope`; drives the numeric inflection search. */
export function sigmoidSlope(t: number, p: FivePLParams): number {
  const S = sigmoidS(t, p);
  return (p.D - p.A) * warpSlopeAt(S, p);
}

/**
 * Numeric argmax of `sigmoidSlope` over `[t1, tEnd]`: a fine grid scan then
 * golden-section refinement. There is no closed form for the warped
 * inflection (the warp shifts it off `C` by an amount that depends on
 * foot/shoulder), so this stays numeric — a future model swap only needs a
 * new `sigmoidSlope`. `gridPoints` is lowered for the Monte-Carlo SE loop
 * (`landmarks.ts`), which calls this 500× per well and only needs SE-grade
 * precision, not the reported point estimate's precision.
 */
export function findInflection(
  p: FivePLParams,
  t1: number,
  tEnd: number,
  gridPoints = 2000,
): { t: number; slope: number } {
  const span = tEnd - t1;
  if (!(span > 0)) {
    const slope = sigmoidSlope(t1, p);
    return { t: t1, slope: Number.isFinite(slope) ? slope : NaN };
  }

  let bestT = t1;
  let bestSlope = -Infinity;
  for (let i = 0; i <= gridPoints; i++) {
    const t = t1 + (span * i) / gridPoints;
    const s = sigmoidSlope(t, p);
    if (Number.isFinite(s) && s > bestSlope) {
      bestSlope = s;
      bestT = t;
    }
  }
  if (!Number.isFinite(bestSlope)) return { t: NaN, slope: NaN };

  // Golden-section refinement, bracketed by one grid step either side of the
  // grid max (clamped to the domain).
  const step = span / gridPoints;
  let lo = Math.max(t1, bestT - step);
  let hi = Math.min(tEnd, bestT + step);
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let iter = 0; iter < 5 && hi > lo; iter++) {
    const c = hi - gr * (hi - lo);
    const d = lo + gr * (hi - lo);
    if (sigmoidSlope(c, p) > sigmoidSlope(d, p)) hi = d; else lo = c;
  }
  const tStar = (lo + hi) / 2;
  const slopeStar = sigmoidSlope(tStar, p);
  return Number.isFinite(slopeStar) && slopeStar >= bestSlope
    ? { t: tStar, slope: slopeStar }
    : { t: bestT, slope: bestSlope };
}

/**
 * FreeShoulder fit. `rfu`/`timeS` are index-parallel raw fluorescence and x
 * values (seconds for SHARP; any monotone x normalises internally). `seed`
 * anchors `A` — near the starting RFU (`seed.startRfu`) when given, else the
 * robust trough. `knobs.computeCovariance` toggles the SE/cov step (off ⇒ null).
 * Never throws: a junk / non-amplifying curve returns a null-parameter result
 * with `converged = false`.
 */
export function fitFreeShoulder(
  rfu: number[],
  timeS: number[],
  seed: FitSeed,
  knobs: FitKnobs,
): FivePLResult {
  const n = Math.min(rfu.length, timeS.length);
  if (n < 7) return NULL_FIT; // need n>P (6 params) for a covariance

  // ── Seeds (real units) ──
  const { hi: maxY } = curveRange(rfu.slice(0, n));
  // Anchor `A` near the starting RFU so the fit begins in the true baseline
  // region and is less likely to diverge; fall back to the robust trough, then
  // to the raw minimum (see shared_module_freeshoulder-fit.md §1.1).
  const A0 = Number.isFinite(seed.startRfu)
    ? (seed.startRfu as number)
    : Number.isFinite(seed.trough)
      ? seed.trough
      : Math.min(...rfu.slice(0, n));
  const D0 = maxY;
  if (!(D0 > A0)) return NULL_FIT;
  const t1 = timeS[0];
  const tEnd = timeS[n - 1];

  // ── Normalise so every parameter is O(1) (tScale/yScale match model-explore.ts) ──
  const tScale = tEnd > 0 ? tEnd : 1;
  const yScale = D0 > 0 ? D0 : 1;
  const x = timeS.slice(0, n).map((t) => t / tScale);
  const y = rfu.slice(0, n).map((v) => v / yScale);
  const a0 = A0 / yScale;
  const d0 = D0 / yScale;

  // c0 = normalised time of the first half-max crossing (index-snapped, not
  // interpolated — matches the validated model-explore.ts seeding).
  let c0 = 0.5;
  const halfLevel = (A0 + D0) / 2;
  for (let i = 0; i < n; i++) {
    if (rfu[i] >= halfLevel) { c0 = x[i]; break; }
  }

  const [footLo, footHi] = knobs.footBounds;
  const [shoulderLo, shoulderHi] = knobs.shoulderBounds;
  const minN = [a0 - 0.05, 0.1, 0, a0, footLo, shoulderLo];
  const maxN = [a0 + 0.05, 500, 2, d0 * 1.5, footHi, shoulderHi];

  const seeds: number[][] = [];
  for (const b0 of [10, 40]) {
    for (const foot0 of [0.6, 1.6]) {
      for (const shoulder0 of [0.6, 1.6]) {
        seeds.push([a0, b0, c0, d0, foot0, shoulder0]);
      }
    }
  }

  // Normalised model: [a,b,c,d,p,q](xn) = a + (d−a)·(1−(1−S^p)^q).
  const model = ([a, bb, c, d, pf, qs]: number[]) => (xn: number) => {
    const e = -bb * (xn - c);
    const S = e > 700 ? 0 : 1 / (1 + Math.exp(e));
    let w: number;
    if (S <= 0) w = 0;
    else if (S >= 1) w = 1;
    else w = 1 - Math.pow(1 - Math.pow(S, pf), qs);
    return a + (d - a) * w;
  };

  let best: number[] | null = null;
  let bestSS = Infinity;
  for (const s of seeds) {
    try {
      const fit = levenbergMarquardt(
        { x, y },
        model,
        {
          initialValues: s,
          damping: 1,
          gradientDifference: 1e-5,
          centralDifference: true,
          maxIterations: knobs.fivePLMaxIterations,
          errorTolerance: 1e-8,
          minValues: minN,
          maxValues: maxN,
        },
      );
      const fn = model(fit.parameterValues);
      let ss = 0;
      for (let i = 0; i < y.length; i++) {
        const e = fn(x[i]) - y[i];
        ss += e * e;
      }
      if (ss < bestSS) {
        bestSS = ss;
        best = fit.parameterValues;
      }
    } catch {
      // seed failed to converge — try the next one
    }
  }
  if (!best) return NULL_FIT;

  // ── De-normalise to real units ──
  const A = best[0] * yScale;
  const B = best[1] / tScale;
  const C = best[2] * tScale;
  const D = best[3] * yScale;
  const foot = best[4];
  const shoulder = best[5];
  if (![A, B, C, D, foot, shoulder].every((v) => Number.isFinite(v)) || !(B > 0) || !(D > A)) {
    return NULL_FIT;
  }
  const p: FivePLParams = { A, B, C, D, foot, shoulder };

  // ── Fit quality on the real data ──
  let ssRes = 0;
  let ssTot = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) meanY += rfu[i];
  meanY /= n;
  for (let i = 0; i < n; i++) {
    const pred = curveAt(timeS[i], p);
    if (!Number.isFinite(pred)) return NULL_FIT;
    ssRes += (rfu[i] - pred) ** 2;
    ssTot += (rfu[i] - meanY) ** 2;
  }
  const rmse = Math.sqrt(ssRes / n);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
  const fitOk = r2 !== null && r2 >= knobs.fivePLMinR2;

  // ── Covariance (real units): cov = σ̂²·(JᵀJ)⁻¹, σ̂² = RSS/(n−6). OPT-IN —
  //    skipped on the baseline path (`computeCovariance` off) so `se`/`cov`
  //    stay null and the numeric Jacobian + inversion cost is avoided. ──
  const { se, cov } = knobs.computeCovariance
    ? covariance(timeS, p, ssRes, n)
    : { se: null, cov: null };

  // ── Censoring flags ──
  const height = D - A;
  const preOnsetLevel = A + knobs.sigmaPreOnsetFraction * height;
  let preCount = 0;
  for (let i = 0; i < n; i++) if (rfu[i] < preOnsetLevel) preCount++;
  const baselineObserved = fitOk && preCount >= knobs.minBaselinePoints;

  // End-of-run reaches ~90% of D (geometric), AND D is tightly determined.
  const endMean = (rfu[n - 1] + rfu[n - 2] + rfu[n - 3]) / 3;
  const geometricOk = height > 0 && (endMean - A) / height >= 0.9;
  const seDFracOk = se ? se.D / Math.abs(D) <= 0.05 : true; // geometric alone if no cov
  const plateauObserved = fitOk && geometricOk && seDFracOk;

  // shapeAtBound: foot/shoulder within 1% of their bound RANGE, checked in
  // NORMALISED space (same units the fit sees).
  const nearBound = (v: number, lo: number, hi: number, frac = 0.01) => {
    const range = hi - lo;
    return range > 0 && (v <= lo + frac * range || v >= hi - frac * range);
  };
  const shapeAtBound =
    nearBound(foot, footLo, footHi) || nearBound(shoulder, shoulderLo, shoulderHi);

  // converged ≡ "r² ok AND A is meaningful" (= baseline_observed).
  const converged = baselineObserved;

  // Inflection / max slope: numeric off the fitted curve's slope — no closed
  // form for the warped inflection.
  const { t: inflectionT, slope: maxSlope } = findInflection(p, t1, tEnd);

  return {
    A, B, C, D, foot, shoulder,
    inflectionT: Number.isFinite(inflectionT) ? inflectionT : null,
    maxSlope: Number.isFinite(maxSlope) ? maxSlope : null,
    rmse, r2,
    converged, shapeAtBound, baselineObserved, plateauObserved, se, cov,
  };
}

/** Back-compat alias for the fit's prior name (`fitFivePL`). */
export const fitFivePL = fitFreeShoulder;

/**
 * Numeric covariance of the fitted parameters. Builds the Jacobian of the
 * fitted curve (`curveAt`) by central finite differences w.r.t. each of the 6
 * real-unit parameters, forms JᵀJ, inverts it, and scales by the residual
 * variance. Returns nulls when JᵀJ is singular (e.g. a railed foot/shoulder
 * makes a block near-degenerate). Only reached when `computeCovariance` is on.
 */
function covariance(
  timeS: number[],
  p: FivePLParams,
  ssRes: number,
  n: number,
): { se: FivePLResult['se']; cov: number[][] | null } {
  const P = 6;
  if (n <= P) return { se: null, cov: null };

  const base: number[] = [p.A, p.B, p.C, p.D, p.foot, p.shoulder];
  const at = (q: number[], t: number) =>
    curveAt(t, { A: q[0], B: q[1], C: q[2], D: q[3], foot: q[4], shoulder: q[5] });

  // Jacobian J (n×6).
  const J: number[][] = Array.from({ length: n }, () => new Array(P).fill(0));
  for (let k = 0; k < P; k++) {
    const d = Math.max(1e-6, 1e-4 * Math.abs(base[k]));
    const up = [...base];
    const dn = [...base];
    up[k] += d;
    dn[k] -= d;
    for (let i = 0; i < n; i++) {
      J[i][k] = (at(up, timeS[i]) - at(dn, timeS[i])) / (2 * d);
    }
  }

  // The parameters span several orders of magnitude (A~2000, B~0.007), so JᵀJ
  // is badly conditioned. Scale each column by |param| before inverting, then
  // un-scale the covariance: cov = σ̂²·S·(SⱼᵀSⱼ)⁻¹·S with S = diag(scale).
  const scale = base.map((v) => Math.max(Math.abs(v), 1e-8));

  const JtJ: number[][] = Array.from({ length: P }, () => new Array(P).fill(0));
  for (let k = 0; k < P; k++) {
    for (let l = k; l < P; l++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += J[i][k] * J[i][l];
      const scaled = s * scale[k] * scale[l];
      JtJ[k][l] = scaled;
      JtJ[l][k] = scaled;
    }
  }

  const invS = matInvert(JtJ);
  if (!invS) return { se: null, cov: null };

  const sigma2 = ssRes / (n - P);
  const cov: number[][] = invS.map((row, k) =>
    row.map((v, l) => v * sigma2 * scale[k] * scale[l]),
  );
  const diag = (k: number) => (cov[k][k] > 0 ? Math.sqrt(cov[k][k]) : 0);
  const se = {
    A: diag(0), B: diag(1), C: diag(2), D: diag(3),
    foot: diag(4), shoulder: diag(5),
  };
  return { se, cov };
}
