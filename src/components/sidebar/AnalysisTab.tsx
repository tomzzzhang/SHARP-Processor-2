import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import type { WellBaselineOverride } from '@/hooks/useAppState';
import { useAnalysisResults, useGlobalDrift } from '@/hooks/useAnalysisResults';
import { cycleToXValue, xValueToCycle, X_AXIS_UNIT_LABEL } from '@/lib/analysis';
import type { AmplificationData, XAxisMode } from '@/types/experiment';
import { Checkbox } from '@/components/ui/checkbox';
import { CollapsibleSection } from './CollapsibleSection';
import { effectiveChannelLabel } from '@/lib/channels';
import { FOCUS_RING } from '@/lib/ui-classes';

/**
 * Number input for a baseline / plateau zone boundary. Stored internally
 * as a 1-indexed cycle number, but displayed and edited in whatever unit
 * the x-axis currently shows (cycle / s / min). Commits on blur/Enter so
 * the nearest-cycle snapping doesn't fight the user mid-keystroke.
 */
function ZoneInput({
  valueCycle, placeholderCycle, amp, xAxisMode, onCommit, allowEmpty = false, className,
}: {
  valueCycle: number | undefined;
  placeholderCycle?: number;
  amp: AmplificationData | null;
  xAxisMode: XAxisMode;
  onCommit: (cycle: number | undefined) => void;
  allowEmpty?: boolean;
  className?: string;
}) {
  const toDisp = (c: number): string => {
    const v = amp ? cycleToXValue(c, xAxisMode, amp) : c;
    return xAxisMode === 'cycle' ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  };
  const display = valueCycle != null ? toDisp(valueCycle) : '';
  const [text, setText] = useState(display);
  useEffect(() => {
    setText(valueCycle != null ? toDisp(valueCycle) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueCycle, xAxisMode, amp]);

  const commit = () => {
    const t = text.trim();
    if (t === '') {
      if (allowEmpty) onCommit(undefined);
      else setText(display);
      return;
    }
    const num = Number(t);
    if (!Number.isFinite(num)) { setText(display); return; }
    onCommit(amp ? xValueToCycle(num, xAxisMode, amp) : Math.round(num));
  };

  return (
    <input
      type="number"
      value={text}
      placeholder={placeholderCycle != null ? toDisp(placeholderCycle) : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
      className={`${className ?? ''} ${FOCUS_RING}`}
    />
  );
}

export function AnalysisTab() {
  const baselineEnabled = useAppState((s) => s.baselineEnabled);
  const baselineAuto = useAppState((s) => s.baselineAuto);
  const baselineMethod = useAppState((s) => s.baselineMethod);
  const baselineStart = useAppState((s) => s.baselineStart);
  const baselineEnd = useAppState((s) => s.baselineEnd);
  const showRawOverlay = useAppState((s) => s.showRawOverlay);
  const thresholdEnabled = useAppState((s) => s.thresholdEnabled);
  const thresholdRfu = useAppState((s) => s.thresholdRfu);
  const smoothingEnabled = useAppState((s) => s.smoothingEnabled);
  const smoothingWindow = useAppState((s) => s.smoothingWindow);
  const selectedWells = useAppState((s) => s.selectedWells);
  const wellBaselineOverrides = useAppState((s) => s.wellBaselineOverrides);

  const setBaselineEnabled = useAppState((s) => s.setBaselineEnabled);
  const setBaselineAuto = useAppState((s) => s.setBaselineAuto);
  const setBaselineMethod = useAppState((s) => s.setBaselineMethod);
  const setBaselineZone = useAppState((s) => s.setBaselineZone);
  const setShowRawOverlay = useAppState((s) => s.setShowRawOverlay);
  const setThresholdEnabled = useAppState((s) => s.setThresholdEnabled);
  const setThresholdRfu = useAppState((s) => s.setThresholdRfu);
  const setSmoothingEnabled = useAppState((s) => s.setSmoothingEnabled);
  const setSmoothingWindow = useAppState((s) => s.setSmoothingWindow);
  const meltThresholdEnabled = useAppState((s) => s.meltThresholdEnabled);
  const meltThresholdValue = useAppState((s) => s.meltThresholdValue);
  const setMeltThresholdEnabled = useAppState((s) => s.setMeltThresholdEnabled);
  const setMeltThresholdValue = useAppState((s) => s.setMeltThresholdValue);
  const setWellBaselineOverride = useAppState((s) => s.setWellBaselineOverride);
  const clearWellBaselineOverrides = useAppState((s) => s.clearWellBaselineOverrides);

  const experiments = useAppState((s) => s.experiments);
  const activeIdx = useAppState((s) => s.activeExperimentIndex);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const normalizeEnabled = useAppState((s) => s.normalizeEnabled);
  const setNormalizeEnabled = useAppState((s) => s.setNormalizeEnabled);
  const wellNormalizeOverrides = useAppState((s) => s.wellNormalizeOverrides);
  const setWellNormalizeOverride = useAppState((s) => s.setWellNormalizeOverride);
  const clearWellNormalizeOverrides = useAppState((s) => s.clearWellNormalizeOverrides);
  const hoveredWell = useAppState((s) => s.hoveredWell);
  const setHoveredWell = useAppState((s) => s.setHoveredWell);
  const driftCorrectionEnabled = useAppState((s) => s.driftCorrectionEnabled);
  const setDriftCorrectionEnabled = useAppState((s) => s.setDriftCorrectionEnabled);
  const activeChannel = useAppState((s) => s.activeChannel);
  const setActiveChannel = useAppState((s) => s.setActiveChannel);
  const analysisScopeAll = useAppState((s) => s.analysisScopeAll);
  const setAnalysisScopeAll = useAppState((s) => s.setAnalysisScopeAll);
  const channelLabels = useAppState((s) => s.channelLabels);
  const analysisResults = useAnalysisResults();
  const { slope: driftSlope, nWells: driftWells } = useGlobalDrift();

  const exp = experiments[activeIdx];
  const amp = exp?.amplification ?? null;
  const unitLabel = X_AXIS_UNIT_LABEL[xAxisMode];

  const selectedArr = useMemo(() => [...selectedWells], [selectedWells]);
  const selectedOverride: WellBaselineOverride | null = useMemo(() => {
    if (selectedArr.length === 0) return null;
    const overrides = selectedArr.map((w) => wellBaselineOverrides.get(w)).filter(Boolean) as WellBaselineOverride[];
    if (overrides.length === 0) return null;
    if (overrides.length === 1) return overrides[0];
    const first = overrides[0];
    const allMatch = overrides.every(
      (o) => o.method === first.method && o.start === first.start && o.end === first.end
    );
    return allMatch ? first : { method: undefined, start: undefined, end: undefined };
  }, [selectedArr, wellBaselineOverrides]);

  const hasSelectedOverrides = selectedArr.some((w) => wellBaselineOverrides.has(w));

  // Tri-state for per-well auto baseline across current selection.
  // 'on' = every selected well is auto, 'off' = every selected well is manual,
  // 'mixed' = selection spans both modes. A well's effective mode is
  // override.auto ?? baselineAuto.
  const selectedAutoState: 'on' | 'off' | 'mixed' | null = useMemo(() => {
    if (selectedArr.length === 0) return null;
    let anyOn = false, anyOff = false;
    for (const w of selectedArr) {
      const ov = wellBaselineOverrides.get(w);
      const effective = ov?.auto ?? baselineAuto;
      if (effective) anyOn = true; else anyOff = true;
      if (anyOn && anyOff) return 'mixed';
    }
    return anyOn ? 'on' : 'off';
  }, [selectedArr, wellBaselineOverrides, baselineAuto]);

  const channels = exp?.channels ?? [];
  const viewMode = useAppState((s) => s.viewMode);

  // Drift correction is hidden for now (the underlying state/action and
  // `computeDriftSlope`/`useGlobalDrift` are kept intact — flip this to bring
  // the section back). Default is off, so nothing applies drift.
  const SHOW_DRIFT_UI = false;

  return (
    <div className="space-y-3">
      {channels.length > 1 && viewMode === 'multi' && (
        <div className="flex items-center gap-2 text-sm border-b pb-2">
          <span className="font-medium text-muted-foreground">Settings for:</span>
          <select
            value={analysisScopeAll ? '__all__' : activeChannel}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__all__') setAnalysisScopeAll(true);
              else { setAnalysisScopeAll(false); setActiveChannel(v); }
            }}
            className={`flex-1 h-7 border rounded-md px-1 text-sm bg-background ${FOCUS_RING}`}
            title="Choose a channel to edit, or All channels to apply settings to every channel at once"
          >
            <option value="__all__">All channels</option>
            {channels.map((ch) => (
              <option key={ch} value={ch}>
                {effectiveChannelLabel(ch, channelLabels, exp?.channelFluorophore)}
              </option>
            ))}
          </select>
        </div>
      )}

      {SHOW_DRIFT_UI && (
      <CollapsibleSection title="Drift Correction" defaultOpen={false}>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={driftCorrectionEnabled}
            onCheckedChange={(v) => setDriftCorrectionEnabled(v === true)}
          />
          Global slope correction
        </label>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Fitted drift:</span>
          <span className="font-medium">
            {driftWells > 0
              ? `${driftSlope >= 0 ? '+' : '−'}${Math.abs(driftSlope).toFixed(2)} RFU/min`
              : 'not detected'}
          </span>
          {driftWells > 0 && (
            <span className="text-muted-foreground">({driftWells} well{driftWells > 1 ? 's' : ''})</span>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground italic">
          Removes a single run-level slope, fitted across every well's
          pre-amplification baseline, from all curves before baseline
          correction. Per-well baseline offset is handled separately.
        </p>
      </CollapsibleSection>
      )}

      <CollapsibleSection title="Baseline Correction">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={baselineEnabled}
            onCheckedChange={(v) => setBaselineEnabled(v === true)}
          />
          Baseline correction
        </label>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={baselineAuto}
            onCheckedChange={(v) => setBaselineAuto(v === true)}
            disabled={!baselineEnabled}
          />
          Auto baseline
        </label>

        <div className={`space-y-2 transition-opacity ${baselineAuto ? 'opacity-50' : ''}`}>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">Method:</span>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="baseline-method"
              checked={baselineMethod === 'horizontal'}
              onChange={() => setBaselineMethod('horizontal')}
              style={{ accentColor: 'var(--brand-red-dark)' }}
              className={FOCUS_RING}
            />
            Horizontal
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="baseline-method"
              checked={baselineMethod === 'linear'}
              onChange={() => setBaselineMethod('linear')}
              style={{ accentColor: 'var(--brand-red-dark)' }}
              className={FOCUS_RING}
            />
            Linear
          </label>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Zone:</span>
          <span>Start:</span>
          <ZoneInput
            valueCycle={baselineStart}
            amp={amp}
            xAxisMode={xAxisMode}
            onCommit={(c) => { if (c != null) setBaselineZone(c, baselineEnd); }}
            className="w-14 h-6 border rounded-md px-1 text-center text-sm"
          />
          <span>End:</span>
          <ZoneInput
            valueCycle={baselineEnd}
            amp={amp}
            xAxisMode={xAxisMode}
            onCommit={(c) => { if (c != null) setBaselineZone(baselineStart, c); }}
            className="w-14 h-6 border rounded-md px-1 text-center text-sm"
          />
          <span className="text-xs text-muted-foreground">{unitLabel}</span>
          </div>
        </div>

        {baselineAuto && (
          <p className="text-[11px] text-muted-foreground italic">
            Method/zone above apply only to wells opted out of auto baseline
          </p>
        )}

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={showRawOverlay}
            onCheckedChange={(v) => setShowRawOverlay(v === true)}
          />
          Show raw curves behind corrected
        </label>

        {selectedArr.length > 0 && (
          <div className="border-t pt-2 mt-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Per-well override ({selectedArr.length} well{selectedArr.length > 1 ? 's' : ''})
              </span>
              {hasSelectedOverrides && (
                <button
                  className={`text-xs text-destructive hover:underline ${FOCUS_RING}`}
                  onClick={() => clearWellBaselineOverrides(selectedArr)}
                >
                  Clear
                </button>
              )}
            </div>

            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={selectedAutoState === 'on'}
                indeterminate={selectedAutoState === 'mixed'}
                onCheckedChange={(v) =>
                  setWellBaselineOverride(selectedArr, { auto: v === true })
                }
              />
              Auto baseline
              {selectedAutoState === 'mixed' && (
                <span className="text-foreground/70 italic">(mixed)</span>
              )}
            </label>

            <div className={`space-y-2 transition-opacity ${selectedAutoState === 'on' ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">Method:</span>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="well-baseline-method"
                  checked={selectedOverride?.method === 'horizontal'}
                  onChange={() => setWellBaselineOverride(selectedArr, { method: 'horizontal' })}
                  style={{ accentColor: 'var(--brand-red-dark)' }}
                  className={FOCUS_RING}
                />
                Horiz.
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="well-baseline-method"
                  checked={selectedOverride?.method === 'linear'}
                  onChange={() => setWellBaselineOverride(selectedArr, { method: 'linear' })}
                  style={{ accentColor: 'var(--brand-red-dark)' }}
                  className={FOCUS_RING}
                />
                Linear
              </label>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Zone:</span>
              <span>Start:</span>
              <ZoneInput
                valueCycle={selectedOverride?.start}
                placeholderCycle={baselineStart}
                amp={amp}
                xAxisMode={xAxisMode}
                allowEmpty
                onCommit={(c) => setWellBaselineOverride(selectedArr, { start: c })}
                className="w-12 h-6 border rounded-md px-1 text-center text-xs"
              />
              <span>End:</span>
              <ZoneInput
                valueCycle={selectedOverride?.end}
                placeholderCycle={baselineEnd}
                amp={amp}
                xAxisMode={xAxisMode}
                allowEmpty
                onCommit={(c) => setWellBaselineOverride(selectedArr, { end: c })}
                className="w-12 h-6 border rounded-md px-1 text-center text-xs"
              />
              <span className="text-muted-foreground">{unitLabel}</span>
            </div>
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Normalization" defaultOpen={false}>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={normalizeEnabled}
            onCheckedChange={(v) => setNormalizeEnabled(v === true)}
          />
          Normalize selected
        </label>

        <p className="text-[11px] text-muted-foreground italic">
          Rescales each curve 0→1 between its baseline and plateau regions. The baseline zone
          follows Auto baseline; the plateau is auto-detected, falling back to the final reading
          when no plateau is found.
        </p>

        {normalizeEnabled && exp && (
          <div className="border-t pt-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Per-well zones</span>
              <button
                className={`text-xs text-destructive hover:underline ${FOCUS_RING}`}
                onClick={() => clearWellNormalizeOverrides(exp.wellsUsed)}
              >
                Reset
              </button>
            </div>
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-muted-foreground">
                    <th className="px-0.5 py-0.5 text-left">Well</th>
                    <th className="px-0.5 py-0.5 text-center" title="Normalize this well">N</th>
                    <th className="px-0.5 py-0.5 text-center" colSpan={2}>Baseline ({unitLabel})</th>
                    <th className="px-0.5 py-0.5 text-center" colSpan={2}>Plateau ({unitLabel})</th>
                  </tr>
                </thead>
                <tbody>
                  {exp.wellsUsed.map((well) => {
                    const ar = analysisResults.get(well);
                    const normOv = wellNormalizeOverrides.get(well);
                    const normOn = normOv?.enabled ?? true;
                    const bw = ar?.baselineWindow ?? null;
                    const pw = ar?.plateauWindow ?? null;
                    const isHovered = hoveredWell === well;
                    const isSelected = selectedWells.has(well);
                    const shadowParts: string[] = [];
                    if (isSelected) shadowParts.push('inset 3px 0 0 var(--brand-red)');
                    if (isHovered) shadowParts.push('inset 0 0 0 9999px color-mix(in srgb, var(--brand-red) 18%, transparent)');
                    const inputCls = 'w-9 h-5 border rounded-md px-0.5 text-center text-[10px] bg-background';
                    return (
                      <tr
                        key={well}
                        style={{ boxShadow: shadowParts.join(', ') || undefined, opacity: normOn ? 1 : 0.5 }}
                        onMouseEnter={() => setHoveredWell(well)}
                        onMouseLeave={() => { if (hoveredWell === well) setHoveredWell(null); }}
                      >
                        <td className="px-0.5 font-medium">{well}</td>
                        <td className="px-0.5 text-center">
                          <Checkbox
                            className="h-3 w-3"
                            checked={normOn}
                            onCheckedChange={(v) => setWellNormalizeOverride([well], { enabled: v === true })}
                          />
                        </td>
                        <td className="px-0.5">
                          <ZoneInput
                            valueCycle={bw?.start} placeholderCycle={baselineStart}
                            amp={amp} xAxisMode={xAxisMode} allowEmpty
                            onCommit={(c) => setWellBaselineOverride([well], { start: c, end: bw?.end, auto: false })}
                            className={inputCls}
                          />
                        </td>
                        <td className="px-0.5">
                          <ZoneInput
                            valueCycle={bw?.end} placeholderCycle={baselineEnd}
                            amp={amp} xAxisMode={xAxisMode} allowEmpty
                            onCommit={(c) => setWellBaselineOverride([well], { start: bw?.start, end: c, auto: false })}
                            className={inputCls}
                          />
                        </td>
                        <td className="px-0.5" title={pw ? undefined : 'No plateau detected; normalized to final reading'}>
                          <ZoneInput
                            valueCycle={pw?.start}
                            amp={amp} xAxisMode={xAxisMode} allowEmpty
                            onCommit={(c) => setWellNormalizeOverride([well], { plateauStart: c, plateauEnd: pw?.end, plateauAuto: false })}
                            className={inputCls}
                          />
                        </td>
                        <td className="px-0.5" title={pw ? undefined : 'No plateau detected; normalized to final reading'}>
                          <ZoneInput
                            valueCycle={pw?.end}
                            amp={amp} xAxisMode={xAxisMode} allowEmpty
                            onCommit={(c) => setWellNormalizeOverride([well], { plateauStart: pw?.start, plateauEnd: c, plateauAuto: false })}
                            className={inputCls}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Threshold Detection">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={thresholdEnabled}
            onCheckedChange={(v) => setThresholdEnabled(v === true)}
          />
          Enable threshold
        </label>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Threshold:</span>
          <input
            type="number"
            min={0}
            max={1000000}
            step={100}
            value={thresholdRfu}
            onChange={(e) => setThresholdRfu(Number(e.target.value))}
            className={`w-24 h-7 border rounded-md px-1 text-sm ${FOCUS_RING}`}
          />
          <span className="text-muted-foreground">RFU</span>
        </div>

        <p className="text-xs text-muted-foreground italic">
          Drag the red dashed line on the plot to adjust
        </p>
      </CollapsibleSection>

      <CollapsibleSection title="Melt Threshold" defaultOpen={false}>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={meltThresholdEnabled}
            onCheckedChange={(v) => setMeltThresholdEnabled(v === true)}
          />
          Enable melt threshold
        </label>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Threshold:</span>
          <input
            type="number"
            min={0}
            max={100000}
            step={0.1}
            value={meltThresholdValue}
            onChange={(e) => setMeltThresholdValue(Number(e.target.value))}
            disabled={!meltThresholdEnabled}
            className={`w-24 h-7 border rounded-md px-1 text-sm bg-background disabled:opacity-50 ${FOCUS_RING}`}
          />
          <span className="text-muted-foreground">-dF/dT</span>
        </div>

        <p className="text-xs text-muted-foreground italic">
          Wells with peak -dF/dT below this value are dimmed on melt plots
        </p>
      </CollapsibleSection>

      <CollapsibleSection title="Amp smoothing" defaultOpen={false}>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={smoothingEnabled}
            onCheckedChange={(v) => setSmoothingEnabled(v === true)}
          />
          Smooth amplification curves
        </label>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Window:</span>
          <input
            type="number"
            min={3}
            max={51}
            step={2}
            value={smoothingWindow}
            onChange={(e) => {
              let v = Number(e.target.value);
              if (v % 2 === 0) v = v + 1;
              v = Math.max(3, Math.min(51, v));
              setSmoothingWindow(v);
            }}
            disabled={!smoothingEnabled}
            className={`w-14 h-6 text-center text-sm border rounded-md px-1 bg-background disabled:opacity-50 ${FOCUS_RING}`}
          />
        </div>

        <p className="text-xs text-muted-foreground italic">
          Savitzky-Golay filter. The melt -dF/dT is already smoothed at the
          parser (BioRad CFX Maestro algorithm) and needs no extra pass.
        </p>
      </CollapsibleSection>
    </div>
  );
}
