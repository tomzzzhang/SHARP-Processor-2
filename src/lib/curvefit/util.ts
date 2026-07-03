/** Small numeric helpers shared across the readout engine. */

/** Median of a numeric array (returns NaN for empty). Does not mutate. */
export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation about the median (raw MAD, not scaled). */
export function mad(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Robust σ estimate = 1.4826·MAD (consistent with a Gaussian σ). */
export function robustSigma(xs: number[]): number {
  return 1.4826 * mad(xs);
}

/** Min/max/range of a curve. */
export function curveRange(rfu: number[]): { lo: number; hi: number; range: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of rfu) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi, range: hi - lo };
}

/** Sample standard deviation of a numeric array (NaN for <2 points). */
export function sampleSd(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  let mean = 0;
  for (const v of xs) mean += v;
  mean /= n;
  let ss = 0;
  for (const v of xs) ss += (v - mean) ** 2;
  return Math.sqrt(ss / (n - 1));
}

/**
 * Robust trough: the quiescent level. SHARP curves DECLINE for the first few
 * reads (lamp/optics warm-up) down to a trough around cycle ~6, so read 1 is
 * not the baseline. Take the min of a light (k=5) moving average over the first
 * ~`window` reads — robust to the per-point jitter, anchored at the true low.
 * Used as the fit's `A` seed and as the baseline fallback when the fit fails.
 */
export function robustTrough(rfu: number[], window = 40, k = 5): number {
  const n = rfu.length;
  if (n === 0) return NaN;
  const end = Math.min(n, Math.max(k, window));
  const half = k >> 1;
  let lo = Infinity;
  for (let i = 0; i < end; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < n) {
        sum += rfu[j];
        cnt++;
      }
    }
    const ma = sum / cnt;
    if (ma < lo) lo = ma;
  }
  return lo;
}

// ── Linear algebra for the fit covariance + Monte-Carlo SE propagation ──

/**
 * Invert a square matrix by Gauss-Jordan elimination with partial pivoting.
 * Returns null when the matrix is singular / ill-conditioned (a railed fit).
 */
export function matInvert(a: number[][]): number[][] | null {
  const n = a.length;
  // Augment [a | I].
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    // Partial pivot: largest |value| in this column at/below the diagonal.
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    if (piv !== col) [m[col], m[piv]] = [m[piv], m[col]];
    const pv = m[col][col];
    for (let j = 0; j < 2 * n; j++) m[col][j] /= pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row.slice(n));
}

/**
 * Cholesky factor `L` (lower-triangular, `L·Lᵀ = a`) of a symmetric
 * positive-definite matrix, or null if `a` is not PD (a degenerate covariance).
 */
export function cholesky(a: number[][]): number[][] | null {
  const n = a.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) return null;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/** Deterministic PRNG (mulberry32). Seeded so MC-propagated SEs are stable
 *  across re-runs (keeps `verify`/`extract` reproducible). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draw from a uniform PRNG (Box-Muller). */
export function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
