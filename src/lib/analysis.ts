import type { WellCall } from '@/types/experiment';

// ── Baseline Correction ──────────────────────────────────────────────

export interface BaselineResult {
  corrected: number[];
  offset: number;       // horizontal: mean; linear: intercept
  slope: number;        // 0 for horizontal
}

/**
 * Horizontal baseline: subtract the mean of rfu[start..end].
 */
function baselineHorizontal(rfu: number[], start: number, end: number): BaselineResult {
  const s = Math.max(0, start - 1); // convert 1-indexed to 0-indexed
  const e = Math.min(rfu.length, end);
  if (e <= s) return { corrected: [...rfu], offset: 0, slope: 0 };

  let sum = 0;
  for (let i = s; i < e; i++) sum += rfu[i];
  const mean = sum / (e - s);

  return {
    corrected: rfu.map((v) => v - mean),
    offset: mean,
    slope: 0,
  };
}

/**
 * Linear baseline: fit y = mx + b to the baseline zone, then subtract.
 */
function baselineLinear(rfu: number[], xData: number[], start: number, end: number): BaselineResult {
  const s = Math.max(0, start - 1);
  const e = Math.min(rfu.length, end);
  if (e - s < 2) return baselineHorizontal(rfu, start, end);

  // Simple linear regression on the baseline zone
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  const n = e - s;
  for (let i = s; i < e; i++) {
    const x = xData[i];
    const y = rfu[i];
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-15) return baselineHorizontal(rfu, start, end);

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return {
    corrected: rfu.map((v, i) => v - (slope * xData[i] + intercept)),
    offset: intercept,
    slope,
  };
}

export function applyBaseline(
  rfu: number[],
  xData: number[],
  method: 'horizontal' | 'linear',
  start: number,
  end: number,
): BaselineResult {
  return method === 'linear'
    ? baselineLinear(rfu, xData, start, end)
    : baselineHorizontal(rfu, start, end);
}

// ── Threshold Detection ──────────────────────────────────────────────

export interface DetectionResult {
  tt: number | null;      // threshold time (in whatever x-axis unit)
  call: WellCall;
  endRfu: number;
}

/**
 * Find where the curve first crosses the threshold (upward).
 * Uses linear interpolation between bracketing points.
 */
export function detectThreshold(
  xData: number[],
  rfu: number[],
  threshold: number,
): DetectionResult {
  const n = Math.min(xData.length, rfu.length);
  if (n === 0) return { tt: null, call: 'invalid', endRfu: 0 };
  if (n < 2) return { tt: null, call: 'invalid', endRfu: rfu[n - 1] };

  const endRfu = rfu[n - 1];

  for (let i = 0; i < n - 1; i++) {
    if (rfu[i] < threshold && rfu[i + 1] >= threshold) {
      const dy = rfu[i + 1] - rfu[i];
      if (Math.abs(dy) < 1e-15) continue;
      const dx = xData[i + 1] - xData[i];
      const tt = xData[i] + (threshold - rfu[i]) * dx / dy;
      return { tt, call: 'positive', endRfu };
    }
  }

  return { tt: null, call: 'negative', endRfu };
}

// ── Exponential Fit (Doubling Time) ──────────────────────────────────

export interface FitResult {
  doublingTime: number | null;
  k: number | null;       // growth rate constant
  rSquared: number | null;
}

/**
 * Fit exponential growth to estimate doubling time.
 * Uses log-linear regression on the growth region: ln(RFU) = ln(A) + k*t
 * Doubling time = ln(2) / k
 *
 * Growth region: data points between fit_start_fraction and fit_end_fraction of threshold.
 */
export function fitDoublingTime(
  xData: number[],
  rfu: number[],
  threshold: number,
  fitStartFraction: number,
  fitEndFraction: number,
): FitResult {
  const loBound = threshold * fitStartFraction;
  const hiBound = threshold * fitEndFraction;

  // Collect points in the growth region
  const xs: number[] = [];
  const logYs: number[] = [];
  for (let i = 0; i < rfu.length; i++) {
    if (rfu[i] >= loBound && rfu[i] <= hiBound && rfu[i] > 0) {
      xs.push(xData[i]);
      logYs.push(Math.log(rfu[i]));
    }
  }

  if (xs.length < 4) return { doublingTime: null, k: null, rSquared: null };

  // Linear regression: logY = k*x + b
  const n = xs.length;
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += logYs[i];
    sumXX += xs[i] * xs[i];
    sumXY += xs[i] * logYs[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-15) return { doublingTime: null, k: null, rSquared: null };

  const k = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - k * sumX) / n;

  if (k <= 0) return { doublingTime: null, k: null, rSquared: null };

  // R² calculation
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = k * xs[i] + b;
    ssTot += (logYs[i] - meanY) ** 2;
    ssRes += (logYs[i] - predicted) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : null;

  const doublingTime = Math.LN2 / k;

  return { doublingTime, k, rSquared };
}

// ── Full Analysis Pipeline ───────────────────────────────────────────

export interface WellAnalysisResult {
  correctedRfu: number[] | null;
  tt: number | null;
  dt: number | null;
  call: WellCall;
  endRfu: number;
}

export function analyzeWell(
  rawRfu: number[],
  xData: number[],
  options: {
    baselineEnabled: boolean;
    baselineMethod: 'horizontal' | 'linear';
    baselineStart: number;
    baselineEnd: number;
    thresholdEnabled: boolean;
    thresholdRfu: number;
    fittingEnabled: boolean;
    fitStartFraction: number;
    fitEndFraction: number;
  },
): WellAnalysisResult {
  // Step 1: Baseline correction
  let rfu = rawRfu;
  let correctedRfu: number[] | null = null;
  if (options.baselineEnabled) {
    const bl = applyBaseline(rawRfu, xData, options.baselineMethod, options.baselineStart, options.baselineEnd);
    rfu = bl.corrected;
    correctedRfu = bl.corrected;
  }

  const endRfu = rfu[rfu.length - 1] ?? 0;

  // Step 2: Threshold detection
  let tt: number | null = null;
  let call: WellCall = 'unset';
  if (options.thresholdEnabled) {
    const det = detectThreshold(xData, rfu, options.thresholdRfu);
    tt = det.tt;
    call = det.call;
  }

  // Step 3: Doubling time (only for positive wells)
  let dt: number | null = null;
  if (options.fittingEnabled && call === 'positive') {
    const fit = fitDoublingTime(xData, rfu, options.thresholdRfu, options.fitStartFraction, options.fitEndFraction);
    dt = fit.doublingTime;
  }

  return { correctedRfu, tt, dt, call, endRfu };
}

// ── Dilution Series (Standard Curve) ──────────────────────────────────

export interface DilutionStep {
  concentration: number;
  wells: string[];
  enabled: boolean;
}

export interface DilutionConfig {
  unit: string;
  highestConcentration: number;
  dilutionFactor: number;
  numSteps: number;
  copiesExponent?: number;
  steps: DilutionStep[];
}

export interface DilutionGroupStat {
  concentration: number;
  log2Conc: number;
  meanTt: number;
  stdTt: number;
  semTt: number;
  n: number;
}

export interface DilutionSeriesResult {
  doublingTime: number;
  doublingTimeSE: number;       // standard error of Dt (= SE of slope)
  doublingTime95CI: [number, number]; // 95% confidence interval
  slope: number;
  slopeSE: number;              // standard error of slope
  intercept: number;
  interceptSE: number;          // standard error of intercept
  rSquared: number;
  adjRSquared: number;          // adjusted R²
  fStatistic: number;           // F-test statistic
  pValue: number;               // p-value for slope ≠ 0
  nTotal: number;
  nSteps: number;
  groupStats: DilutionGroupStat[];
}

/**
 * Analyze a dilution series: Tt vs log₂(concentration) linear regression.
 * Doubling time = −slope.
 */
export function analyzeDilutionSeries(
  config: DilutionConfig,
  ttByWell: Map<string, number>,
): DilutionSeriesResult | null {
  // Collect (log2Conc, Tt) pairs from enabled steps
  const allLog2: number[] = [];
  const allTt: number[] = [];
  const groupStats: DilutionGroupStat[] = [];

  for (const step of config.steps) {
    if (!step.enabled || step.wells.length === 0) continue;

    const tts: number[] = [];
    for (const well of step.wells) {
      const tt = ttByWell.get(well);
      if (tt != null) tts.push(tt);
    }
    if (tts.length === 0) continue;

    const log2C = Math.log2(step.concentration);
    for (const tt of tts) {
      allLog2.push(log2C);
      allTt.push(tt);
    }

    const mean = tts.reduce((a, b) => a + b, 0) / tts.length;
    let variance = 0;
    for (const t of tts) variance += (t - mean) ** 2;
    const std = tts.length > 1 ? Math.sqrt(variance / (tts.length - 1)) : 0;
    const sem = std / Math.sqrt(tts.length);

    groupStats.push({
      concentration: step.concentration,
      log2Conc: log2C,
      meanTt: mean,
      stdTt: std,
      semTt: sem,
      n: tts.length,
    });
  }

  if (groupStats.length < 2 || allLog2.length < 3) return null;

  // Linear regression: Tt = slope * log₂(C) + intercept
  const n = allLog2.length;
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (let i = 0; i < n; i++) {
    sumX += allLog2[i];
    sumY += allTt[i];
    sumXX += allLog2[i] * allLog2[i];
    sumXY += allLog2[i] * allTt[i];
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-15) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // Sum of squares
  const meanY = sumY / n;
  const meanX = sumX / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * allLog2[i] + intercept;
    ssTot += (allTt[i] - meanY) ** 2;
    ssRes += (allTt[i] - predicted) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const adjRSquared = n > 2 ? 1 - (ssRes / (n - 2)) / (ssTot / (n - 1)) : rSquared;

  // Standard errors
  const dfResidual = n - 2;
  const mse = dfResidual > 0 ? ssRes / dfResidual : 0;
  const sxx = sumXX - sumX * sumX / n;
  const slopeSE = sxx > 0 ? Math.sqrt(mse / sxx) : 0;
  const interceptSE = sxx > 0 ? Math.sqrt(mse * (sumXX / n) / sxx) : 0;

  // F-statistic: F = MSreg / MSres = (SStot - SSres) / MSres
  const ssReg = ssTot - ssRes;
  const fStatistic = mse > 0 ? ssReg / mse : Infinity;

  // p-value from F-distribution via incomplete beta function approximation
  // F(1, df2) → use beta regularized incomplete: p = I_x(a,b) where x = df2/(df2+F), a=df2/2, b=0.5
  const pValue = dfResidual > 0 ? fDistPValue(fStatistic, 1, dfResidual) : 0;

  // t-critical for 95% CI (two-tailed) — approximate via normal for df>30, else use rough t-table
  const tCrit = tCriticalApprox(0.025, dfResidual);
  const dtSE = slopeSE; // SE(Dt) = SE(slope) since Dt = -slope
  const dt = -slope;
  const ci95: [number, number] = [dt - tCrit * dtSE, dt + tCrit * dtSE];

  return {
    doublingTime: dt,
    doublingTimeSE: dtSE,
    doublingTime95CI: ci95,
    slope,
    slopeSE,
    intercept,
    interceptSE,
    rSquared,
    adjRSquared,
    fStatistic,
    pValue,
    nTotal: n,
    nSteps: groupStats.length,
    groupStats,
  };
}

/** Approximate t-critical value for two-tailed test at significance level alpha per tail */
function tCriticalApprox(alpha: number, df: number): number {
  // For large df, t → z. For small df, use a lookup with interpolation.
  if (df >= 120) return 1.96;
  // Common t-critical values at alpha=0.025 (95% CI)
  const table: [number, number][] = [
    [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571],
    [6, 2.447], [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228],
    [15, 2.131], [20, 2.086], [25, 2.060], [30, 2.042], [40, 2.021],
    [60, 2.000], [80, 1.990], [100, 1.984],
  ];
  // Find bracketing entries
  for (let i = 0; i < table.length - 1; i++) {
    if (df <= table[i][0]) return table[i][1];
    if (df < table[i + 1][0]) {
      // Linear interpolation
      const [d0, t0] = table[i];
      const [d1, t1] = table[i + 1];
      return t0 + (t1 - t0) * (df - d0) / (d1 - d0);
    }
  }
  return 1.96;
}

/** p-value for F(1, df2) distribution — P(F > f) */
function fDistPValue(f: number, _df1: number, df2: number): number {
  // Use the relationship: for F(1, df2), p = P(t² > f) = 2 * P(t > sqrt(f)) for t(df2)
  // Use the regularized incomplete beta function:
  // p = I_x(df2/2, 1/2) where x = df2 / (df2 + f)
  if (f <= 0) return 1;
  const x = df2 / (df2 + f);
  return regularizedBeta(x, df2 / 2, 0.5);
}

/** Regularized incomplete beta function I_x(a,b) using continued fraction (Lentz's method) */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use the continued fraction expansion for better convergence
  // If x > (a+1)/(a+b+2), use symmetry: I_x(a,b) = 1 - I_{1-x}(b,a)
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedBeta(1 - x, b, a);
  }

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Lentz's continued fraction
  let f = 1, c = 1, d = 1 - (a + b) * x / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;

  for (let m = 1; m <= 200; m++) {
    // Even step
    let num = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= c * d;

    // Odd step
    num = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = c * d;
    f *= delta;

    if (Math.abs(delta - 1) < 1e-10) break;
  }

  return front * f;
}

/** Log-gamma function (Stirling approximation + Lanczos for small values) */
function lnGamma(z: number): number {
  // Lanczos approximation (g=7, n=9)
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
