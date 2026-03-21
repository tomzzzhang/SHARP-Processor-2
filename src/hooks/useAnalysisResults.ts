import { useMemo } from 'react';
import { useAppState } from './useAppState';
import { analyzeWell, savitzkyGolaySmooth, type WellAnalysisResult } from '@/lib/analysis';

/**
 * Reactively compute analysis results for all wells in the active experiment.
 * Results update automatically when analysis params or data change.
 */
export function useAnalysisResults(): Map<string, WellAnalysisResult> {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const baselineEnabled = useAppState((s) => s.baselineEnabled);
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

    for (const well of exp.wellsUsed) {
      let rawRfu = amp.wells[well];
      if (!rawRfu) continue;

      // Apply smoothing to raw data before analysis
      if (smoothingEnabled) {
        rawRfu = savitzkyGolaySmooth(rawRfu, smoothingWindow);
      }

      // Merge per-well baseline overrides if present
      const override = wellBaselineOverrides.get(well);
      const options = override
        ? {
            ...globalOptions,
            baselineMethod: override.method ?? globalOptions.baselineMethod,
            baselineStart: override.start ?? globalOptions.baselineStart,
            baselineEnd: override.end ?? globalOptions.baselineEnd,
          }
        : globalOptions;

      results.set(well, analyzeWell(rawRfu, xData, options));
    }

    return results;
  }, [exp, xAxisMode, baselineEnabled, baselineMethod, baselineStart, baselineEnd,
      thresholdEnabled, thresholdRfu, fittingEnabled, fitStartFraction, fitEndFraction,
      wellBaselineOverrides, smoothingEnabled, smoothingWindow]);
}
