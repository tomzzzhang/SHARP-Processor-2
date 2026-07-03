import type { WellCall, XAxisMode, AmplificationData } from '@/types/experiment';
import { fitFreeShoulder, robustTrough, DEFAULT_FIT_KNOBS } from './curvefit';

// ── X-axis unit conversion ───────────────────────────────────────────

/** Pick the x-data array for a given x-axis mode. */
function xArrayFor(xAxisMode: XAxisMode, amp: AmplificationData): number[] {
  return xAxisMode === 'cycle' ? amp.cycle : xAxisMode === 'time_s' ? amp.timeS : amp.timeMin;
}

/**
 * Convert a 1-indexed cycle number to its x-axis value in the current
 * display unit (cycle / seconds / minutes). Used to show baseline-zone
 * boundaries — stored internally as cycle indices — in the unit the
 * x-axis is currently displaying.
 */
export function cycleToXValue(cycle: number, xAxisMode: XAxisMode, amp: AmplificationData): number {
  const arr = xArrayFor(xAxisMode, amp);
  if (arr.length === 0) return cycle;
  const idx = Math.max(0, Math.min(arr.length - 1, Math.round(cycle) - 1));
  return arr[idx];
}

/**
 * Convert an x-axis value (in the current display unit) back to the
 * nearest 1-indexed cycle number. Inverse of `cycleToXValue`.
 */
export function xValueToCycle(value: number, xAxisMode: XAxisMode, amp: AmplificationData): number {
  const arr = xArrayFor(xAxisMode, amp);
  if (arr.length === 0) return Math.round(value);
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - value);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx + 1;
}

/** Short unit label for an x-axis mode (used next to zone inputs). */
export const X_AXIS_UNIT_LABEL: Record<XAxisMode, string> = {
  cycle: 'cycle',
  time_s: 's',
  time_min: 'min',
};

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

/** Minimum point count for a flat region to count as usable. */
const MIN_FLAT_RUN = 5;

/**
 * Estimate the noise floor σ of a curve from the quietest 5-point
 * rolling window. Returns NaN if the curve is too short. Clamped to a
 * tiny positive minimum so a perfectly flat integer run still admits a
 * little per-point jitter as "flat."
 */
function noiseFloor(rfu: number[]): number {
  const NOISE_WIN = 5;
  const n = rfu.length;
  let sigma = Infinity;
  for (let i = 0; i + NOISE_WIN <= n; i++) {
    let sum = 0;
    for (let j = i; j < i + NOISE_WIN; j++) sum += rfu[j];
    const mean = sum / NOISE_WIN;
    let varSum = 0;
    for (let j = i; j < i + NOISE_WIN; j++) {
      const d = rfu[j] - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / NOISE_WIN);
    if (std < sigma) sigma = std;
  }
  if (!Number.isFinite(sigma)) return NaN;
  return sigma < 1e-9 ? 1e-9 : sigma;
}

/** Min/max of a curve. */
function curveRange(rfu: number[]): { lo: number; hi: number; range: number } {
  let lo = Infinity, hi = -Infinity;
  for (const v of rfu) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return { lo, hi, range: hi - lo };
}

/**
 * Auto-detect the pre-amplification flat baseline region of a curve.
 *
 * The baseline is everything before amplification takes off. We locate
 * the amplification onset — the first cycle that has risen a small
 * fraction into the curve's total span — and return the stretch from
 * the start of the curve to a few cycles before it, trimming any
 * leading instrument warm-up drift. A nearly-flat (non-amplifying)
 * curve returns a generous early window. Returns 1-indexed inclusive
 * cycle bounds, or null when no usable baseline exists (e.g. the curve
 * amplifies from its very first cycles).
 *
 * Onset-based rather than a flat-window sweep: a real baseline drifts
 * slowly, so a fixed std threshold derived from local point-to-point
 * noise fragments it into tiny pieces and the detector locks onto an
 * arbitrary 5-point chunk. Anchoring on amplification onset captures
 * the whole baseline regardless of drift, and never selects a
 * post-plateau flat region since that lies after onset.
 */
export function findFlatBaselineWindow(rfu: number[]): { start: number; end: number } | null {
  const n = rfu.length;
  if (n < 10) return null;

  const { lo, range } = curveRange(rfu);
  const sigma = noiseFloor(rfu);
  if (!Number.isFinite(sigma)) return null;

  const jMax = Math.max(9, Math.floor(n * 0.7));

  // Nearly-flat curve (no amplification): the whole early span is baseline.
  if (range < Math.max(10 * sigma, 1e-6)) {
    return { start: 1, end: jMax };
  }

  // Amplification onset: first cycle risen 10% into the curve's span.
  const onsetThreshold = lo + 0.10 * range;
  let onset = n;
  for (let i = 0; i < n; i++) {
    if (rfu[i] >= onsetThreshold) { onset = i; break; }
  }

  // Trim leading warm-up drift — points sitting notably above the floor.
  const driftTol = Math.max(5 * sigma, 0.03 * range);
  let start = 0;
  while (start < onset - MIN_FLAT_RUN && rfu[start] > lo + driftTol) start++;

  // End a few cycles before onset so the takeoff isn't averaged in.
  const end = Math.min(jMax, onset - 3);
  if (end - start < MIN_FLAT_RUN) return null;

  return { start: start + 1, end };
}

// ── Fit-first auto baseline (FreeShoulder) ───────────────────────────

/** Fitted-A vs simple-baseline cross-check tolerance (RFU). Accept the fitted
 *  `A` over the simple baseline when they agree within this; on curves with
 *  early drift the fit is the slightly better estimate, so this only catches a
 *  gross fit blow-up (shared_module_freeshoulder-fit.md §1.1 — validated ≤225
 *  RFU worst case on the private validation run, so 500 is safe and generous). */
const FIT_BASELINE_TOLERANCE_RFU = 500;

/** Fit knobs for the interactive auto-baseline path: the shared-module defaults
 *  with a lower LM iteration cap (120 vs the module default 200). Verified on
 *  the private validation plate: the fitted `A` is unchanged to <0.05 RFU across all 42
 *  wells while total fit time drops ~40%. Every SHARP well converges well before
 *  120 iterations; the extra headroom to 200 only matters for pathological
 *  non-converging fits, which fail the accept test and fall back to the trough
 *  anyway. Covariance stays off — the baseline needs only `A`. */
const AUTO_BASELINE_KNOBS = { ...DEFAULT_FIT_KNOBS, fivePLMaxIterations: 120 };

/** Fit-first auto baseline result for one well. `offset` is the subtracted
 *  level; `corrected = raw − offset`. `fromFit` true ⇒ the level is the fitted
 *  `A`, false ⇒ the robust-trough / simple fallback. */
export interface AutoFitBaseline {
  corrected: number[];
  offset: number | null;
  fromFit: boolean;
  /** Fitted lower asymptote `A` (RFU), or null when the fit failed. */
  fittedA: number | null;
  /** Simple-method baseline (flat-window mean), or null (fast firers). */
  simple: number | null;
  converged: boolean;
  baselineObserved: boolean;
}

/** Simple (non-fitting) baseline level = mean over the auto-detected flat
 *  pre-amplification window, or null when no such window exists. This is the
 *  §1.1 cross-check estimate, NOT the ground-truth value — the fit corrects its
 *  known early-drift bias; the check only guards against gross fit failure. */
function simpleBaselineLevel(rfu: number[]): number | null {
  const w = findFlatBaselineWindow(rfu);
  if (!w) return null;
  const s = Math.max(0, w.start - 1);
  const e = Math.min(rfu.length, w.end);
  if (e <= s) return null;
  let sum = 0;
  for (let i = s; i < e; i++) sum += rfu[i];
  return sum / (e - s);
}

/** Mean of the first `k` reads — the "starting RFU" anchor for the fit's `A`
 *  seed (§1.1: seed `A` near the start, not just the trough, so the fit begins
 *  in the true baseline region and is less likely to diverge). */
function startRfuEstimate(rfu: number[], k = 3): number {
  const m = Math.min(k, rfu.length);
  if (m === 0) return NaN;
  let sum = 0;
  for (let i = 0; i < m; i++) sum += rfu[i];
  return sum / m;
}

/** Cache keyed on the exact input array reference. `computeAutoFitBaseline` is
 *  a pure function of (rawRfu, timeS); timeS is stable per experiment/channel,
 *  so keying on the rawRfu identity is sufficient and always correct. When
 *  smoothing/drift are off the caller passes the stable `amp.wells[well]`
 *  reference, so a threshold-line drag (which re-runs the whole per-well
 *  pipeline) reuses the fit instead of re-solving 8 LM starts per well. */
const autoFitCache = new WeakMap<number[], AutoFitBaseline | null>();

/**
 * Fit-first auto baseline: fit the FreeShoulder curve to the raw signal and use
 * the fitted lower asymptote `A` as the baseline level, with a robust-trough
 * fallback and a cross-check against the simple baseline (shared_module §1.1).
 *
 * Fit on `timeS` (seconds) for cross-run comparability; `A` is x-unit
 * independent, so the corrected curve is the same in any display unit.
 *
 * POOR-FIT REJECTION. The fitted `A` is trusted only when the fit REPORTS it as
 * anchored (`baselineObserved` — r² ≥ 0.9 AND ≥8 reads sitting below the
 * pre-onset level, i.e. a real flat baseline the curve rose out of). A curve the
 * single FreeShoulder logistic can't represent — a non-amplifying / junk NTC, or
 * one with two shoulders (a shelf then a second rise) — reports
 * `baselineObserved = false`: there the fit extrapolates `A` off the true
 * baseline (e.g. private validation F6, whose `A` lands ~80 RFU BELOW the observed
 * minimum), so we fall back to the robust trough instead of subtracting a bad
 * level. The 500-RFU cross-check against the simple baseline is a further
 * guard: even an anchored fit is rejected if it disagrees with the simple
 * estimate by more than the tolerance (a blow-up that still flagged anchored).
 * Returns null only when no usable level can be produced, so the caller can fall
 * back to the legacy flat-window method.
 */
export function computeAutoFitBaseline(rawRfu: number[], timeS: number[]): AutoFitBaseline | null {
  const cached = autoFitCache.get(rawRfu);
  if (cached !== undefined) return cached;

  const trough = robustTrough(rawRfu);
  const startRfu = startRfuEstimate(rawRfu);
  const fit = fitFreeShoulder(rawRfu, timeS, { trough, startRfu }, AUTO_BASELINE_KNOBS);
  const simple = simpleBaselineLevel(rawRfu);
  const fittedA = fit.A;

  const accept =
    fittedA !== null && Number.isFinite(fittedA) &&
    fit.baselineObserved &&
    (simple === null || Math.abs(fittedA - simple) <= FIT_BASELINE_TOLERANCE_RFU);

  let offset: number | null;
  let fromFit: boolean;
  if (accept) {
    offset = fittedA as number;
    fromFit = true;
  } else if (Number.isFinite(trough)) {
    offset = trough;
    fromFit = false;
  } else if (simple !== null) {
    offset = simple;
    fromFit = false;
  } else {
    autoFitCache.set(rawRfu, null);
    return null; // nothing usable — caller falls back to the flat-window method
  }

  const off = offset as number;
  const result: AutoFitBaseline = {
    corrected: rawRfu.map((v) => v - off),
    offset,
    fromFit,
    fittedA,
    simple,
    converged: fit.converged,
    baselineObserved: fit.baselineObserved,
  };
  autoFitCache.set(rawRfu, result);
  return result;
}

/**
 * Auto-detect the final flat plateau region of an amplification curve.
 *
 * Anchors on the last data point and walks backward while the curve
 * stays flat — each step small relative to the curve's steepest rise.
 * A genuine plateau yields a long trailing flat run; a still-rising,
 * decaying, or noisy curve yields only a couple of trailing points and
 * returns null, so the caller falls back to the final RFU value as the
 * upper normalization anchor. Returns 1-indexed inclusive cycle bounds.
 */
export function findFlatPlateauWindow(rfu: number[]): { start: number; end: number } | null {
  const n = rfu.length;
  if (n < 10) return null;

  const { range } = curveRange(rfu);
  const sigma = noiseFloor(rfu);
  if (!Number.isFinite(sigma)) return null;

  // No amplification → no meaningful plateau.
  if (range < Math.max(10 * sigma, 1e-6)) return null;

  // Steepest single-cycle step: the plateau is where the curve has
  // essentially stopped climbing relative to that.
  let maxStep = 0;
  for (let i = 0; i < n - 1; i++) {
    const d = Math.abs(rfu[i + 1] - rfu[i]);
    if (d > maxStep) maxStep = d;
  }
  const flatTol = Math.max(3 * sigma, 0.10 * maxStep);

  // Walk back from the last point while consecutive steps stay flat.
  let start = n - 1;
  while (start > 0 && Math.abs(rfu[start] - rfu[start - 1]) <= flatTol) start--;

  if (n - start < MIN_FLAT_RUN) return null;
  return { start: start + 1, end: n };
}

/**
 * Estimate a single global drift rate (RFU per minute) for the whole
 * experiment via a pooled, within-well linear fit over every well's
 * pre-amplification baseline region.
 *
 * Each well contributes its own intercept (within-well centering) so
 * genuine well-to-well baseline-level differences don't bias the shared
 * slope — the slope is purely the run-level instrument drift. Amplifying
 * wells contribute their early cycles; non-amplifying wells contribute
 * their full flat span, anchoring the fit. Returns slope 0 when no well
 * has a usable baseline region.
 *
 * This is deliberately separate from per-well baseline correction: drift
 * is a property of the run, estimated once and applied globally; baseline
 * offset is per-well and handled downstream.
 */
export function computeDriftSlope(
  amp: AmplificationData,
  wellsUsed: string[],
): { slope: number; nWells: number } {
  const t = amp.timeMin;
  if (!t || t.length < 2) return { slope: 0, nWells: 0 };

  let sxy = 0, sxx = 0, nWells = 0;
  for (const well of wellsUsed) {
    const rfu = amp.wells[well];
    if (!rfu) continue;
    const bw = findFlatBaselineWindow(rfu);
    if (!bw) continue; // amplifies from the first cycles — no usable baseline
    const end = Math.min(rfu.length, t.length, bw.end); // 0-indexed exclusive
    if (end < 2) continue;

    let tSum = 0, ySum = 0;
    for (let i = 0; i < end; i++) { tSum += t[i]; ySum += rfu[i]; }
    const tMean = tSum / end, yMean = ySum / end;
    for (let i = 0; i < end; i++) {
      const dt = t[i] - tMean;
      sxy += dt * (rfu[i] - yMean);
      sxx += dt * dt;
    }
    nWells++;
  }
  return { slope: sxx > 1e-12 ? sxy / sxx : 0, nWells };
}

/** A curve counts as a real melt only if its pre→post drop is at least
 *  this fraction of the largest melt transition on the plate. Flat
 *  curves (dye temperature-response only, no DNA transition) fall well
 *  short — they have a tiny drop regardless of how smooth they are, so
 *  an absolute-range test separates them; an SNR test does not, since a
 *  clean flat curve can have a very high range-to-noise ratio. */
const MELT_RANGE_FRAC = 0.15;

/**
 * HRM-normalize a set of melt RFU curves. Each curve is rescaled
 * between its pre-melt plateau (first points — dsDNA intact, high
 * signal) and post-melt plateau (last points — denatured, low signal)
 * so a real melt runs 1→0.
 *
 * A curve with no genuine melt transition (flat — e.g. an NTC with no
 * product, showing only the dye's temperature response) is not
 * stretched to its own tiny range, which would dress noise up as a
 * melt. Instead it is divided by the median range of the real melters,
 * so it renders as a small flat curve near 0.
 *
 * Display transform only — the −dF/dT derivative must still be computed
 * from the raw melt signal, since peak height reflects the raw rate of
 * fluorescence change.
 */
export function normalizeMeltCurves(rfuByWell: Record<string, number[]>): Record<string, number[]> {
  const wells = Object.keys(rfuByWell);
  const info: Record<string, { post: number; range: number }> = {};
  let maxRange = 0;

  for (const w of wells) {
    const rfu = rfuByWell[w];
    const n = rfu.length;
    if (n < 6) { info[w] = { post: 0, range: 0 }; continue; }
    const k = Math.max(2, Math.round(n * 0.08));
    let pre = 0, post = 0;
    for (let i = 0; i < k; i++) pre += rfu[i];
    for (let i = n - k; i < n; i++) post += rfu[i];
    pre /= k;
    post /= k;
    const range = pre - post;
    info[w] = { post, range };
    if (range > maxRange) maxRange = range;
  }

  // A curve melts if its drop is a meaningful fraction of the biggest
  // transition on the plate.
  const meltThreshold = MELT_RANGE_FRAC * maxRange;
  const melterRanges: number[] = [];
  for (const w of wells) {
    if (info[w].range > 0 && info[w].range >= meltThreshold) melterRanges.push(info[w].range);
  }
  melterRanges.sort((a, b) => a - b);
  const medianRange = melterRanges.length
    ? melterRanges[Math.floor(melterRanges.length / 2)]
    : NaN;

  const out: Record<string, number[]> = {};
  for (const w of wells) {
    const { post, range } = info[w];
    const melts = range > 0 && range >= meltThreshold;
    const divisor = melts ? range : medianRange;
    out[w] = (Number.isFinite(divisor) && Math.abs(divisor) > 1e-9)
      ? rfuByWell[w].map((x) => (x - post) / divisor)
      : [...rfuByWell[w]]; // nothing melts at all — leave raw
  }
  return out;
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

// ── Savitzky-Golay Smoothing ─────────────────────────────────────────

/**
 * Savitzky-Golay smoothing filter (polynomial order 2).
 * Preserves peak shape and height better than moving average.
 * @param data - input signal
 * @param windowSize - must be odd, >= 5
 * @returns smoothed signal (same length)
 */
export function savitzkyGolaySmooth(data: number[], windowSize: number): number[] {
  const n = data.length;
  if (n < 5 || windowSize < 5) return [...data];

  // Ensure odd window
  let w = windowSize;
  if (w % 2 === 0) w++;
  if (w > n) w = n % 2 === 0 ? n - 1 : n;
  if (w < 5) return [...data];

  const half = (w - 1) / 2;

  // Precompute SG coefficients for quadratic (order 2) fit
  // For each position in the window [-half..half], the weight is:
  //   c_i = A + B*i + C*i^2
  // where A, B, C come from the normal equations of least-squares polynomial fit.
  // For smoothing (0th derivative), we only need the weights that estimate y(0).
  const coeffs = sgCoeffs(half);

  const result = new Array<number>(n);

  // Interior points: full convolution
  for (let i = half; i < n - half; i++) {
    let sum = 0;
    for (let j = -half; j <= half; j++) {
      sum += coeffs[j + half] * data[i + j];
    }
    result[i] = sum;
  }

  // Edge points: copy original (no distortion at boundaries)
  for (let i = 0; i < half; i++) result[i] = data[i];
  for (let i = n - half; i < n; i++) result[i] = data[i];

  return result;
}

/** Compute Savitzky-Golay coefficients for quadratic smoothing */
function sgCoeffs(half: number): number[] {
  const m = half;
  const w = 2 * m + 1;

  // For polynomial order 2 smoothing, the closed-form weights are:
  // c_i = (3*m*(m+1) - 1 - 5*i^2) / ((2*m+3)*(2*m+1)*(2*m-1)/3)
  // This is the standard SG formula for quadratic/cubic smoothing, 0th derivative.
  const denom = ((2 * m + 3) * (2 * m + 1) * (2 * m - 1)) / 3;
  const a = 3 * m * (m + 1) - 1;

  const coeffs = new Array<number>(w);
  for (let i = -m; i <= m; i++) {
    coeffs[i + m] = (a - 5 * i * i) / denom;
  }
  return coeffs;
}

// ── Full Analysis Pipeline ───────────────────────────────────────────

export interface WellAnalysisResult {
  correctedRfu: number[] | null;
  tt: number | null;
  dt: number | null;
  call: WellCall;
  endRfu: number;
  /** Effective baseline window (1-indexed cycles) used for correction. */
  baselineWindow: { start: number; end: number } | null;
  /** Curve rescaled 0→1 between baseline and plateau. null when not normalized. */
  normalizedRfu: number[] | null;
  /** Effective plateau window (1-indexed cycles), or null when no plateau detected. */
  plateauWindow: { start: number; end: number } | null;
  /** The y-series to plot for this well, with the channel's display settings
   *  already resolved: normalized if normalization is on, else baseline-corrected
   *  if baseline is on, else raw. Lets multi-channel rendering pick the right
   *  curve per channel without re-deriving the per-channel settings. */
  displayRfu: number[];
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
    /** Precomputed fit-first auto baseline. When set (and baselineEnabled), the
     *  fitted-A correction is used instead of the window method; the fit has no
     *  zone, so `baselineWindow` comes back null (zone shading is already hidden
     *  for auto). See `computeAutoFitBaseline`. */
    autoFit?: { corrected: number[]; offset: number | null } | null;
  },
): WellAnalysisResult {
  // Step 1: Baseline correction
  let rfu = rawRfu;
  let correctedRfu: number[] | null = null;
  let baselineWindow: { start: number; end: number } | null = null;
  if (options.baselineEnabled) {
    if (options.autoFit) {
      rfu = options.autoFit.corrected;
      correctedRfu = options.autoFit.corrected;
      baselineWindow = null; // fit-based baseline is a level, not a zone
    } else {
      const bl = applyBaseline(rawRfu, xData, options.baselineMethod, options.baselineStart, options.baselineEnd);
      rfu = bl.corrected;
      correctedRfu = bl.corrected;
      baselineWindow = { start: options.baselineStart, end: options.baselineEnd };
    }
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

  return {
    correctedRfu, tt, dt, call, endRfu, baselineWindow, normalizedRfu: null, plateauWindow: null,
    // Default display series; callers (computeChannelResults) refine this once
    // the channel's normalize/baseline settings are known.
    displayRfu: correctedRfu ?? rawRfu,
  };
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
  // const meanX = sumX / n;  // available if needed
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
function tCriticalApprox(_alpha: number, df: number): number {
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
