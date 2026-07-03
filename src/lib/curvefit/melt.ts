/**
 * Melt-peak readouts from the −dF/dT derivative.
 *
 * The parser already computes a smooth −dF/dT per well (Processor 2's BioRad
 * CFX Maestro port), stored in `MeltData.derivative`, so the engine just finds
 * its peaks: interior local maxima whose height clears both an absolute floor
 * and a fraction of the well's tallest peak (the fraction rejects shoulders /
 * noise and keeps the peak COUNT meaningful — a single clean melt → count 1).
 *
 * The dominant peak's Tm and height carry SEs from a parabola fit to the three
 * points straddling the peak, floored at half the melt step (the −dF/dT grid
 * cannot localize a peak finer than the temperature sampling).
 *
 * Computed for ALL wells (including NTCs). Peak height is kept because a low,
 * broad peak is itself a junk signal. NTC-vs-sample peak agreement is a
 * downstream join, not here.
 */
import type { KineticKnobs, MeltPeak } from './types';
import { median } from './util';

export interface MeltReadout {
  hasPeak: boolean;
  count: number;
  peaks: MeltPeak[];
  /** Tallest peak's Tm / height, for quick SQL. Null when no peak. */
  tm: number | null;
  tmSe: number | null;
  height: number | null;
  heightSe: number | null;
}

const NONE: MeltReadout = {
  hasPeak: false, count: 0, peaks: [], tm: null, tmSe: null, height: null, heightSe: null,
};

export function findMeltPeaks(
  temperatureC: number[],
  derivative: number[],
  knobs: KineticKnobs,
): MeltReadout {
  const n = Math.min(temperatureC.length, derivative.length);
  if (n < 5) return NONE;

  let globalMax = -Infinity;
  for (let i = 0; i < n; i++) if (derivative[i] > globalMax) globalMax = derivative[i];
  if (!(globalMax > 0)) return NONE;

  const minHeight = Math.max(knobs.meltPeakMinHeight, knobs.meltPeakMinFractionOfMax * globalMax);

  const peaks: MeltPeak[] = [];
  let dominantIdx = -1;
  let dominantHeight = -Infinity;
  // Interior strict local maxima (skip the first/last point — edge artefacts).
  for (let i = 1; i < n - 1; i++) {
    const v = derivative[i];
    if (v < minHeight) continue;
    if (v > derivative[i - 1] && v >= derivative[i + 1]) {
      peaks.push({ tm: temperatureC[i], height: v });
      if (v > dominantHeight) {
        dominantHeight = v;
        dominantIdx = i;
      }
    }
  }

  if (peaks.length === 0 || dominantIdx < 0) return NONE;

  // Melt step (median |ΔT|) → the localization floor.
  const steps: number[] = [];
  for (let i = 1; i < n; i++) steps.push(Math.abs(temperatureC[i] - temperatureC[i - 1]));
  const meltStep = median(steps);
  const stepFloor = Number.isFinite(meltStep) && meltStep > 0 ? meltStep / 2 : 0.25;

  const { tmSe, heightSe } = peakSE(
    temperatureC[dominantIdx - 1], temperatureC[dominantIdx], temperatureC[dominantIdx + 1],
    derivative[dominantIdx - 1], derivative[dominantIdx], derivative[dominantIdx + 1],
    stepFloor,
  );

  return {
    hasPeak: true,
    count: peaks.length,
    peaks,
    tm: temperatureC[dominantIdx],
    tmSe,
    height: derivative[dominantIdx],
    heightSe,
  };
}

/**
 * Parabola through the three points straddling a peak → sub-grid vertex. The
 * SE of the Tm is how far that vertex sits from the grid point (floored at half
 * the melt step); the SE of the height is the parabola's height refinement.
 * Returns the floor when the points are collinear / not concave.
 */
function peakSE(
  x0: number, x1: number, x2: number,
  y0: number, y1: number, y2: number,
  stepFloor: number,
): { tmSe: number; heightSe: number } {
  const denom = (x0 - x1) * (x0 - x2) * (x1 - x2);
  if (Math.abs(denom) < 1e-12) return { tmSe: stepFloor, heightSe: 0 };
  const a = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / denom;
  const b = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / denom;
  const c =
    (x1 * x2 * (x1 - x2) * y0 + x2 * x0 * (x2 - x0) * y1 + x0 * x1 * (x0 - x1) * y2) / denom;
  if (!(a < 0)) return { tmSe: stepFloor, heightSe: 0 }; // not a concave max
  const xStar = -b / (2 * a);
  const hStar = a * xStar * xStar + b * xStar + c;
  return {
    tmSe: Math.max(stepFloor, Math.abs(xStar - x1)),
    heightSe: Math.abs(hStar - y1),
  };
}
