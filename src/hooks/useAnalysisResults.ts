import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { useAppState, type ChannelAnalysisState } from './useAppState';
import {
  analyzeWell, applyBaseline, computeAutoFitBaseline, computeDriftSlope,
  findFlatBaselineWindow, findFlatPlateauWindow, savitzkyGolaySmooth,
  type WellAnalysisResult,
} from '@/lib/analysis';
import type { AmplificationData, XAxisMode } from '@/types/experiment';
import { computeChannelLandmarks, type WellLandmark } from '@/lib/report/kinetics-report';

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
 * Pure two-pass analysis of one channel's amplification data. Mirrors the
 * previous single-channel hook body, parameterised by an explicit
 * `ChannelAnalysisState` + precomputed drift slope so it can be reused for
 * every channel.
 */
export function computeChannelResults(
  amp: AmplificationData | null,
  wellsUsed: string[],
  xAxisMode: XAxisMode,
  cs: ChannelAnalysisState,
  driftSlope: number,
): Map<string, WellAnalysisResult> {
  const results = new Map<string, WellAnalysisResult>();
  if (!amp) return results;

  const xData =
    xAxisMode === 'cycle' ? amp.cycle :
    xAxisMode === 'time_s' ? amp.timeS :
    amp.timeMin;

  // The FreeShoulder fit runs in seconds (cross-run comparability); the fitted
  // baseline `A` is x-unit independent, so this is unaffected by xAxisMode. Fall
  // back to cycle indices if the run carries no time axis.
  const fitTimeS = amp.timeS && amp.timeS.length >= 2 ? amp.timeS : amp.cycle;

  const globalOptions = {
    baselineEnabled: cs.baselineEnabled,
    baselineMethod: cs.baselineMethod,
    baselineStart: cs.baselineStart,
    baselineEnd: cs.baselineEnd,
    thresholdEnabled: cs.thresholdEnabled,
    thresholdRfu: cs.thresholdRfu,
    fittingEnabled: cs.fittingEnabled,
    fitStartFraction: cs.fitStartFraction,
    fitEndFraction: cs.fitEndFraction,
  };

  // First pass: baseline correction + threshold/fit analysis, plus the
  // raw ingredients for normalization (resolved per-well below).
  const normScratch = new Map<string, NormScratch>();

  for (const well of wellsUsed) {
    const originalRaw = amp.wells[well];
    if (!originalRaw) continue;
    let rawRfu = originalRaw;

    if (cs.smoothingEnabled) {
      rawRfu = savitzkyGolaySmooth(rawRfu, cs.smoothingWindow);
    }

    if (cs.driftCorrectionEnabled && driftSlope !== 0) {
      const t0 = amp.timeMin[0] ?? 0;
      rawRfu = rawRfu.map((v, i) => v - driftSlope * ((amp.timeMin[i] ?? t0) - t0));
    }

    const override = cs.wellBaselineOverrides.get(well);
    const effectiveAuto = override?.auto ?? cs.baselineAuto;

    let options = override
      ? {
          ...globalOptions,
          baselineMethod: override.method ?? globalOptions.baselineMethod,
          baselineStart: override.start ?? globalOptions.baselineStart,
          baselineEnd: override.end ?? globalOptions.baselineEnd,
        }
      : globalOptions;

    // Fit-first auto baseline: fit FreeShoulder to the ORIGINAL raw signal and
    // subtract the fitted `A` (robust-trough fallback, 500-RFU cross-check).
    // Fitting the original (not the smoothed / drift-processed) curve keys the
    // fit on a stable array reference, so toggling smoothing or drift reuses the
    // cached fit instead of re-solving every well — the baseline level `A` is a
    // property of the raw curve and is unchanged (<1 RFU) by smoothing. The
    // fitted offset is subtracted from the PROCESSED curve so the corrected
    // series still reflects smoothing/drift. Falls back to the legacy flat-window
    // method only when the fit yields no usable level.
    let autoFit: { corrected: number[]; offset: number | null } | null = null;
    if (effectiveAuto && options.baselineEnabled) {
      const fitBase = computeAutoFitBaseline(originalRaw, fitTimeS);
      if (fitBase && fitBase.offset != null) {
        const off = fitBase.offset;
        autoFit = { corrected: rawRfu.map((v) => v - off), offset: off };
      } else {
        const flat = findFlatBaselineWindow(rawRfu);
        if (flat) {
          options = {
            ...options,
            baselineMethod: 'horizontal',
            baselineStart: flat.start,
            baselineEnd: flat.end,
          };
        }
      }
    }

    const base = analyzeWell(rawRfu, xData, { ...options, autoFit });
    // displayRfu defaults to corrected (if baseline on) else raw; normalized
    // resolved in the second pass.
    const displayRfu = (cs.baselineEnabled && base.correctedRfu) || rawRfu;
    results.set(well, { ...base, normalizedRfu: null, plateauWindow: null, displayRfu });

    if (cs.normalizeEnabled) {
      const normOv = cs.wellNormalizeOverrides.get(well);
      const wellNorm = normOv?.enabled ?? true;
      if (wellNorm) {
        const corrected = base.correctedRfu
          ?? applyBaseline(rawRfu, xData, options.baselineMethod, options.baselineStart, options.baselineEnd).corrected;

        const plateauAuto = normOv?.plateauAuto ?? true;
        let plateauWindow: { start: number; end: number } | null;
        if (!plateauAuto && normOv?.plateauStart != null && normOv?.plateauEnd != null) {
          plateauWindow = { start: normOv.plateauStart, end: normOv.plateauEnd };
        } else {
          plateauWindow = findFlatPlateauWindow(corrected);
        }

        let plateauLevel = plateauWindow
          ? windowMean(corrected, plateauWindow.start, plateauWindow.end)
          : NaN;
        if (!Number.isFinite(plateauLevel)) {
          plateauLevel = corrected[corrected.length - 1] ?? 0;
        }

        const autoFlat = findFlatBaselineWindow(rawRfu);
        const noiseWin = autoFlat ?? { start: 1, end: Math.min(corrected.length, 10) };
        const blNoise = windowStd(corrected, noiseWin.start, noiseWin.end);
        const noise = Number.isFinite(blNoise) ? Math.max(blNoise, 1e-6) : 1e-6;
        const amplifies = plateauLevel > MIN_AMP_SNR * noise;

        normScratch.set(well, { corrected, plateauWindow, plateauLevel, amplifies });
      }
    }
  }

  // Second pass: resolve normalized curves.
  if (cs.normalizeEnabled && normScratch.size > 0) {
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
      if (prev) {
        results.set(well, {
          ...prev,
          normalizedRfu,
          plateauWindow: s.plateauWindow,
          displayRfu: normalizedRfu ?? prev.displayRfu,
        });
      }
    }
  }

  return results;
}

/** Assemble the active experiment's per-channel state: the active channel comes
 *  from the live top-level (mirror) fields; the rest from `_channelSnapshots`. */
function useChannelStates(): Map<string, ChannelAnalysisState> {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const activeChannel = useAppState((s) => s.activeChannel);
  const channelSnapshots = useAppState((s) => s._channelSnapshots);
  // Pull every per-channel field so the active channel's live state is captured.
  const live: ChannelAnalysisState = {
    wellBaselineOverrides: useAppState((s) => s.wellBaselineOverrides),
    wellNormalizeOverrides: useAppState((s) => s.wellNormalizeOverrides),
    baselineEnabled: useAppState((s) => s.baselineEnabled),
    baselineAuto: useAppState((s) => s.baselineAuto),
    baselineMethod: useAppState((s) => s.baselineMethod),
    baselineStart: useAppState((s) => s.baselineStart),
    baselineEnd: useAppState((s) => s.baselineEnd),
    driftCorrectionEnabled: useAppState((s) => s.driftCorrectionEnabled),
    normalizeEnabled: useAppState((s) => s.normalizeEnabled),
    meltNormalizeEnabled: useAppState((s) => s.meltNormalizeEnabled),
    thresholdEnabled: useAppState((s) => s.thresholdEnabled),
    thresholdRfu: useAppState((s) => s.thresholdRfu),
    meltThresholdEnabled: useAppState((s) => s.meltThresholdEnabled),
    meltThresholdValue: useAppState((s) => s.meltThresholdValue),
    smoothingEnabled: useAppState((s) => s.smoothingEnabled),
    smoothingWindow: useAppState((s) => s.smoothingWindow),
    fittingEnabled: useAppState((s) => s.fittingEnabled),
    fitStartFraction: useAppState((s) => s.fitStartFraction),
    fitEndFraction: useAppState((s) => s.fitEndFraction),
  };
  const exp = experiments[idx];
  return useMemo(() => {
    const map = new Map<string, ChannelAnalysisState>();
    const channels = exp?.channels ?? [];
    const snap = channelSnapshots.get(idx);
    for (const ch of channels) {
      map.set(ch, ch === activeChannel ? live : (snap?.get(ch) ?? live));
    }
    if (channels.length === 0) map.set(activeChannel, live);
    return map;
    // `live` is rebuilt every render but its fields are the deps that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exp, idx, activeChannel, channelSnapshots,
      live.wellBaselineOverrides, live.wellNormalizeOverrides, live.baselineEnabled,
      live.baselineAuto, live.baselineMethod, live.baselineStart, live.baselineEnd,
      live.driftCorrectionEnabled, live.normalizeEnabled, live.thresholdEnabled,
      live.thresholdRfu, live.smoothingEnabled, live.smoothingWindow, live.fittingEnabled,
      live.fitStartFraction, live.fitEndFraction]);
}

/** Stable empties so context reads return a referentially-constant value when
 *  there is no experiment (or the hook is used outside the provider). */
const EMPTY_ALL_RESULTS: Map<string, Map<string, WellAnalysisResult>> = new Map();
const EMPTY_RESULTS: Map<string, WellAnalysisResult> = new Map();

/**
 * The single per-channel analysis computation: for every channel of the active
 * experiment, run the per-well pipeline with that channel's own
 * `ChannelAnalysisState` and drift slope. This is INTERNAL — call it exactly
 * once, in `AnalysisResultsProvider`, and read the result everywhere else via
 * `useAllChannelResults` / `useAnalysisResults`. Running it per-consumer (it was
 * called in ~8 always-mounted components) recomputed the whole plate N times on
 * every analysis-setting change and every threshold-line drag.
 */
function useComputeAllChannelResults(): Map<string, Map<string, WellAnalysisResult>> {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const channelStates = useChannelStates();
  const exp = experiments[idx];

  return useMemo(() => {
    const out = new Map<string, Map<string, WellAnalysisResult>>();
    if (!exp) return out;
    for (const ch of exp.channels) {
      const amp = exp.amplificationByChannel[ch] ?? null;
      const cs = channelStates.get(ch);
      if (!cs) { out.set(ch, new Map()); continue; }
      const drift = (amp && cs.driftCorrectionEnabled) ? computeDriftSlope(amp, exp.wellsUsed).slope : 0;
      out.set(ch, computeChannelResults(amp, exp.wellsUsed, xAxisMode, cs, drift));
    }
    return out;
  }, [exp, xAxisMode, channelStates]);
}

const AllChannelResultsContext =
  createContext<Map<string, Map<string, WellAnalysisResult>> | null>(null);
const AllChannelLandmarksContext =
  createContext<Map<string, Map<string, WellLandmark>> | null>(null);

const EMPTY_ALL_LANDMARKS: Map<string, Map<string, WellLandmark>> = new Map();
const EMPTY_LANDMARKS: Map<string, WellLandmark> = new Map();

/**
 * Per-channel kinetic landmarks (t_lod / t_onset10 / inflection) for the active
 * experiment, memoized on the experiment. Fit-first + pooled run σ (reusing the
 * baseline pass's cached fits), WITHOUT the report's covariance / MC SEs, so it's
 * cheap enough for the always-on analysis path. Pure on the raw data (the
 * fit-derived baseline is used, independent of the UI baseline settings).
 */
function useComputeAllChannelLandmarks(): Map<string, Map<string, WellLandmark>> {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const exp = experiments[idx];
  return useMemo(() => {
    const out = new Map<string, Map<string, WellLandmark>>();
    if (!exp) return out;
    for (const ch of exp.channels) {
      const amp = exp.amplificationByChannel[ch] ?? null;
      out.set(ch, amp ? computeChannelLandmarks(amp, exp.wellsUsed) : new Map());
    }
    return out;
  }, [exp]);
}

/**
 * Computes every channel's analysis + landmarks ONCE and shares them through
 * context. Wrap the app in this so the many components that read analysis
 * results become cheap context reads instead of N independent recomputations.
 * `children` is passed through untouched, so a recompute here only re-renders
 * the components that actually consume the context.
 */
export function AnalysisResultsProvider({ children }: { children: ReactNode }) {
  const results = useComputeAllChannelResults();
  const landmarks = useComputeAllChannelLandmarks();
  return createElement(
    AllChannelResultsContext.Provider, { value: results },
    createElement(AllChannelLandmarksContext.Provider, { value: landmarks }, children),
  );
}

/**
 * Per-channel analysis results for the active experiment, keyed by channel ID.
 * Reads the shared context value (see `AnalysisResultsProvider`).
 */
export function useAllChannelResults(): Map<string, Map<string, WellAnalysisResult>> {
  return useContext(AllChannelResultsContext) ?? EMPTY_ALL_RESULTS;
}

/** Per-channel kinetic landmarks for the active experiment (shared via context). */
export function useAllChannelLandmarks(): Map<string, Map<string, WellLandmark>> {
  return useContext(AllChannelLandmarksContext) ?? EMPTY_ALL_LANDMARKS;
}

/** Kinetic landmarks for the ACTIVE channel's wells. */
export function useChannelLandmarks(): Map<string, WellLandmark> {
  const all = useAllChannelLandmarks();
  const activeChannel = useAppState((s) => s.activeChannel);
  return useMemo(() => all.get(activeChannel) ?? EMPTY_LANDMARKS, [all, activeChannel]);
}

/**
 * Analysis results for the wells of the ACTIVE channel. Derived from the shared
 * per-channel map (the active channel's entry is identical to what the old
 * standalone computation produced). Drives the Analysis-tab readouts, threshold
 * line, and the doubling/results views.
 */
export function useAnalysisResults(): Map<string, WellAnalysisResult> {
  const all = useAllChannelResults();
  const activeChannel = useAppState((s) => s.activeChannel);
  return useMemo(() => all.get(activeChannel) ?? EMPTY_RESULTS, [all, activeChannel]);
}
