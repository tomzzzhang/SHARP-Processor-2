import { useMemo } from 'react';
import { useAppState } from './useAppState';
import {
  analyzeWell, applyBaseline, computeDriftSlope, findFlatBaselineWindow,
  findFlatPlateauWindow, savitzkyGolaySmooth, type WellAnalysisResult,
} from '@/lib/analysis';

/**
 * Estimate the active experiment's global instrument drift slope
 * (RFU/min). Computed from the raw data regardless of whether drift
 * correction is enabled, so the UI can show the detected drift before
 * the user opts to apply it.
 */
export function useGlobalDrift(): { slope: number; nWells: number } {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const exp = experiments[idx];
  return useMemo(() => {
    if (!exp?.amplification) return { slope: 0, nWells: 0 };
    return computeDriftSlope(exp.amplification, exp.wellsUsed);
  }, [exp]);
}

/** Mean of arr over the 1-indexed inclusive window [start, end]. */
function windowMean(arr: number[], start: number, end: number): number {
  const s = Math.max(0, start - 1);
  const e = Math.min(arr.length, end);
  if (e <= s) return NaN;
  let sum = 0;
  for (let i = s; i < e; i++) sum += arr[i];
  return sum / (e - s);
}

/** Std-dev of arr over the 1-indexed inclusive window [start, end]. */
function windowStd(arr: number[], start: number, end: number): number {
  const s = Math.max(0, start - 1);
  const e = Math.min(arr.length, end);
  if (e - s < 2) return NaN;
  let sum = 0;
  for (let i = s; i < e; i++) sum += arr[i];
  const mean = sum / (e - s);
  let v = 0;
  for (let i = s; i < e; i++) { const d = arr[i] - mean; v += d * d; }
  return Math.sqrt(v / (e - s));
}

interface NormScratch {
  corrected: number[];
  plateauWindow: { start: number; end: number } | null;
  plateauLevel: number;
  amplifies: boolean;
}

/** A real amplification signal must rise well clear of baseline noise for
 *  0→1 normalization to be meaningful. Genuine amplification clears noise
 *  by hundreds of ×; instrument drift on a non-amplifying well only by
 *  ~10-20×, so 50 cleanly separates them. */
const MIN_AMP_SNR = 50;

/**
 * Reactively compute analysis results for all wells in the active experiment.
 * Results update automatically when analysis params or data change.
 */
export function useAnalysisResults(): Map<string, WellAnalysisResult> {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const baselineEnabled = useAppState((s) => s.baselineEnabled);
  const baselineAuto = useAppState((s) => s.baselineAuto);
  const baselineMethod = useAppState((s) => s.baselineMethod);
  const baselineStart = useAppState((s) => s.baselineStart);
  const baselineEnd = useAppState((s) => s.baselineEnd);
  const thresholdEnabled = useAppState((s) => s.thresholdEnabled);
  const thresholdRfu = useAppState((s) => s.thresholdRfu);
  const fittingEnabled = useAppState((s) => s.fittingEnabled);
  const fitStartFraction = useAppState((s) => s.fitStartFraction);
  const fitEndFraction = useAppState((s) => s.fitEndFraction);
  const wellBaselineOverrides = useAppState((s) => s.wellBaselineOverrides);
  const smoothingEnabled = useAppState((s) => s.smoothingEnabled);
  const smoothingWindow = useAppState((s) => s.smoothingWindow);
  const normalizeEnabled = useAppState((s) => s.normalizeEnabled);
  const wellNormalizeOverrides = useAppState((s) => s.wellNormalizeOverrides);
  const driftCorrectionEnabled = useAppState((s) => s.driftCorrectionEnabled);
  const { slope: driftSlope } = useGlobalDrift();

  const exp = experiments[idx];

  return useMemo(() => {
    const results = new Map<string, WellAnalysisResult>();
    if (!exp?.amplification) return results;

    const amp = exp.amplification;
    const xData =
      xAxisMode === 'cycle' ? amp.cycle :
      xAxisMode === 'time_s' ? amp.timeS :
      amp.timeMin;

    const globalOptions = {
      baselineEnabled,
      baselineMethod,
      baselineStart,
      baselineEnd,
      thresholdEnabled,
      thresholdRfu,
      fittingEnabled,
      fitStartFraction,
      fitEndFraction,
    };

    // First pass: baseline correction + threshold/fit analysis, plus the
    // raw ingredients for normalization (resolved per-well below).
    const normScratch = new Map<string, NormScratch>();

    for (const well of exp.wellsUsed) {
      let rawRfu = amp.wells[well];
      if (!rawRfu) continue;

      // Apply smoothing to raw data before analysis
      if (smoothingEnabled) {
        rawRfu = savitzkyGolaySmooth(rawRfu, smoothingWindow);
      }

      // Global drift correction — remove the run-level slope before
      // baseline correction. Per-well baseline offset is handled below.
      if (driftCorrectionEnabled && driftSlope !== 0) {
        const t0 = amp.timeMin[0] ?? 0;
        rawRfu = rawRfu.map((v, i) => v - driftSlope * ((amp.timeMin[i] ?? t0) - t0));
      }

      // Merge per-well baseline overrides if present
      const override = wellBaselineOverrides.get(well);
      const effectiveAuto = override?.auto ?? baselineAuto;

      let options = override
        ? {
            ...globalOptions,
            baselineMethod: override.method ?? globalOptions.baselineMethod,
            baselineStart: override.start ?? globalOptions.baselineStart,
            baselineEnd: override.end ?? globalOptions.baselineEnd,
          }
        : globalOptions;

      if (effectiveAuto && options.baselineEnabled) {
        const flat = findFlatBaselineWindow(rawRfu);
        if (flat) {
          // Auto is horizontal-only: force method and override the window.
          options = {
            ...options,
            baselineMethod: 'horizontal',
            baselineStart: flat.start,
            baselineEnd: flat.end,
          };
        }
        // Null → quietly fall through to manual range (no warning for v1).
      }

      const base = analyzeWell(rawRfu, xData, options);
      results.set(well, { ...base, normalizedRfu: null, plateauWindow: null });

      // Stage normalization inputs for wells that are normalized.
      if (normalizeEnabled) {
        const normOv = wellNormalizeOverrides.get(well);
        const wellNorm = normOv?.enabled ?? true;
        if (wellNorm) {
          // The corrected curve (≈0 in the baseline zone). Computed even
          // when baseline correction is disabled so normalization keeps a
          // zero anchor.
          const corrected = base.correctedRfu
            ?? applyBaseline(rawRfu, xData, options.baselineMethod, options.baselineStart, options.baselineEnd).corrected;

          // Resolve the plateau window: explicit override, else auto-detect.
          const plateauAuto = normOv?.plateauAuto ?? true;
          let plateauWindow: { start: number; end: number } | null;
          if (!plateauAuto && normOv?.plateauStart != null && normOv?.plateauEnd != null) {
            plateauWindow = { start: normOv.plateauStart, end: normOv.plateauEnd };
          } else {
            plateauWindow = findFlatPlateauWindow(corrected);
          }

          // Upper anchor: mean over the plateau window, or the final value
          // when no plateau exists.
          let plateauLevel = plateauWindow
            ? windowMean(corrected, plateauWindow.start, plateauWindow.end)
            : NaN;
          if (!Number.isFinite(plateauLevel)) {
            plateauLevel = corrected[corrected.length - 1] ?? 0;
          }

          // A well genuinely amplified only if its plateau clears baseline
          // noise by a wide margin. A flat / non-amplifying well (NTC) has
          // no 0→1 span — dividing its noise by a near-zero plateau would
          // produce garbage spikes.
          //
          // The noise estimate must be measured over a genuinely
          // pre-amplification window — NOT the user's baseline zone. If
          // that zone is set to overlap the amplification rise, its std
          // measures the climb, not noise, and the well gets misclassified
          // as non-amplifying. Use the auto-detected (onset-based) window,
          // or a fixed early window as a fallback.
          const autoFlat = findFlatBaselineWindow(rawRfu);
          const noiseWin = autoFlat ?? { start: 1, end: Math.min(corrected.length, 10) };
          const blNoise = windowStd(corrected, noiseWin.start, noiseWin.end);
          const noise = Number.isFinite(blNoise) ? Math.max(blNoise, 1e-6) : 1e-6;
          const amplifies = plateauLevel > MIN_AMP_SNR * noise;

          normScratch.set(well, { corrected, plateauWindow, plateauLevel, amplifies });
        }
      }
    }

    // Second pass: resolve normalized curves. Amplifying wells divide by
    // their own plateau level (→ 0→1). Non-amplifying wells divide by the
    // median amplifying level so they render as a small, flat curve near 0
    // instead of blowing up the shared y-axis.
    if (normalizeEnabled && normScratch.size > 0) {
      const ampLevels: number[] = [];
      for (const s of normScratch.values()) if (s.amplifies) ampLevels.push(s.plateauLevel);
      ampLevels.sort((a, b) => a - b);
      const globalScale = ampLevels.length ? ampLevels[Math.floor(ampLevels.length / 2)] : NaN;

      for (const [well, s] of normScratch) {
        const divisor = s.amplifies ? s.plateauLevel : globalScale;
        let normalizedRfu: number[] | null = null;
        if (Number.isFinite(divisor) && Math.abs(divisor) > 1e-6) {
          normalizedRfu = s.corrected.map((v) => v / divisor);
        }
        const prev = results.get(well);
        if (prev) results.set(well, { ...prev, normalizedRfu, plateauWindow: s.plateauWindow });
      }
    }

    return results;
  }, [exp, xAxisMode, baselineEnabled, baselineAuto, baselineMethod, baselineStart, baselineEnd,
      thresholdEnabled, thresholdRfu, fittingEnabled, fitStartFraction, fitEndFraction,
      wellBaselineOverrides, smoothingEnabled, smoothingWindow, normalizeEnabled, wellNormalizeOverrides,
      driftCorrectionEnabled, driftSlope]);
}
