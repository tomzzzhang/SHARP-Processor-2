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
  if (n < 2) return { tt: null, call: 'invalid', endRfu: rfu[n - 1] ?? 0 };

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
  const endRfu = rawRfu[rawRfu.length - 1] ?? 0;

  // Step 1: Baseline correction
  let rfu = rawRfu;
  let correctedRfu: number[] | null = null;
  if (options.baselineEnabled) {
    const bl = applyBaseline(rawRfu, xData, options.baselineMethod, options.baselineStart, options.baselineEnd);
    rfu = bl.corrected;
    correctedRfu = bl.corrected;
  }

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
