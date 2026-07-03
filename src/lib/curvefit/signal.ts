/**
 * Pure signal helpers pulled INTO the `freeshoulder-fit` module so it carries no
 * `@/` host import (see `shared_module_freeshoulder-fit.md` §2, v1.1.0). Both are
 * exact copies of SHARP Processor 2's `src/lib/analysis.ts` helpers of the same
 * name — keep them byte-for-byte in step with that source:
 *   - `findFlatBaselineWindow` — the onset-anchored pre-amplification window,
 *     the fallback when the fit can't bound the pre-onset region (`onset.ts`).
 *   - `savitzkyGolaySmooth` — quadratic SG smoothing for the model-free
 *     steepest-rise cross-check (`landmarks.ts`).
 * `curveRange` comes from this module's `util.ts` (identical to the private
 * `curveRange` in the processor's analysis.ts).
 */
import { curveRange } from './util';

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
