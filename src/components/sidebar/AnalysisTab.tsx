import { useMemo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import type { WellBaselineOverride } from '@/hooks/useAppState';
import { Checkbox } from '@/components/ui/checkbox';

export function AnalysisTab() {
  const baselineEnabled = useAppState((s) => s.baselineEnabled);
  const baselineMethod = useAppState((s) => s.baselineMethod);
  const baselineStart = useAppState((s) => s.baselineStart);
  const baselineEnd = useAppState((s) => s.baselineEnd);
  const showRawOverlay = useAppState((s) => s.showRawOverlay);
  const thresholdEnabled = useAppState((s) => s.thresholdEnabled);
  const thresholdRfu = useAppState((s) => s.thresholdRfu);
  const selectedWells = useAppState((s) => s.selectedWells);
  const wellBaselineOverrides = useAppState((s) => s.wellBaselineOverrides);

  const setBaselineEnabled = useAppState((s) => s.setBaselineEnabled);
  const setBaselineMethod = useAppState((s) => s.setBaselineMethod);
  const setBaselineZone = useAppState((s) => s.setBaselineZone);
  const setShowRawOverlay = useAppState((s) => s.setShowRawOverlay);
  const setThresholdEnabled = useAppState((s) => s.setThresholdEnabled);
  const setThresholdRfu = useAppState((s) => s.setThresholdRfu);
  const setWellBaselineOverride = useAppState((s) => s.setWellBaselineOverride);
  const clearWellBaselineOverrides = useAppState((s) => s.clearWellBaselineOverrides);

  // Check if any selected wells have overrides
  const selectedArr = useMemo(() => [...selectedWells], [selectedWells]);
  const selectedOverride: WellBaselineOverride | null = useMemo(() => {
    if (selectedArr.length === 0) return null;
    // If exactly one well selected with an override, show its values
    // If multiple selected, show values only if they all match
    const overrides = selectedArr.map((w) => wellBaselineOverrides.get(w)).filter(Boolean) as WellBaselineOverride[];
    if (overrides.length === 0) return null;
    if (overrides.length === 1) return overrides[0];
    // Check if all overrides match
    const first = overrides[0];
    const allMatch = overrides.every(
      (o) => o.method === first.method && o.start === first.start && o.end === first.end
    );
    return allMatch ? first : { method: undefined, start: undefined, end: undefined };
  }, [selectedArr, wellBaselineOverrides]);

  const hasSelectedOverrides = selectedArr.some((w) => wellBaselineOverrides.has(w));

  return (
    <div className="space-y-4">
      {/* Baseline Correction */}
      <fieldset className="border rounded p-3 space-y-3">
        <legend className="text-sm font-semibold px-1">Baseline Correction</legend>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={baselineEnabled}
            onCheckedChange={(v) => setBaselineEnabled(v === true)}
          />
          Baseline correction
        </label>

        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">Method:</span>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="baseline-method"
              checked={baselineMethod === 'horizontal'}
              onChange={() => setBaselineMethod('horizontal')}
              className="accent-primary"
            />
            Horizontal
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="baseline-method"
              checked={baselineMethod === 'linear'}
              onChange={() => setBaselineMethod('linear')}
              className="accent-primary"
            />
            Linear
          </label>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Zone:</span>
          <span>Start:</span>
          <input
            type="number"
            min={1}
            max={999}
            value={baselineStart}
            onChange={(e) => setBaselineZone(Number(e.target.value), baselineEnd)}
            className="w-14 h-7 border rounded px-1 text-center text-sm"
          />
          <span>End:</span>
          <input
            type="number"
            min={1}
            max={999}
            value={baselineEnd}
            onChange={(e) => setBaselineZone(baselineStart, Number(e.target.value))}
            className="w-14 h-7 border rounded px-1 text-center text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={showRawOverlay}
            onCheckedChange={(v) => setShowRawOverlay(v === true)}
          />
          Show raw curves behind corrected
        </label>

        {/* Per-well baseline overrides */}
        {selectedArr.length > 0 && (
          <div className="border-t pt-2 mt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Per-well override ({selectedArr.length} well{selectedArr.length > 1 ? 's' : ''})
              </span>
              {hasSelectedOverrides && (
                <button
                  className="text-xs text-destructive hover:underline"
                  onClick={() => clearWellBaselineOverrides(selectedArr)}
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">Method:</span>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="well-baseline-method"
                  checked={selectedOverride?.method === 'horizontal'}
                  onChange={() => setWellBaselineOverride(selectedArr, { method: 'horizontal' })}
                  className="accent-primary"
                />
                Horiz.
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="well-baseline-method"
                  checked={selectedOverride?.method === 'linear'}
                  onChange={() => setWellBaselineOverride(selectedArr, { method: 'linear' })}
                  className="accent-primary"
                />
                Linear
              </label>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Zone:</span>
              <span>Start:</span>
              <input
                type="number"
                min={1}
                max={999}
                value={selectedOverride?.start ?? ''}
                placeholder={String(baselineStart)}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : undefined;
                  setWellBaselineOverride(selectedArr, { start: v });
                }}
                className="w-12 h-6 border rounded px-1 text-center text-xs"
              />
              <span>End:</span>
              <input
                type="number"
                min={1}
                max={999}
                value={selectedOverride?.end ?? ''}
                placeholder={String(baselineEnd)}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : undefined;
                  setWellBaselineOverride(selectedArr, { end: v });
                }}
                className="w-12 h-6 border rounded px-1 text-center text-xs"
              />
            </div>
          </div>
        )}
      </fieldset>

      {/* Threshold & Detection */}
      <fieldset className="border rounded p-3 space-y-3">
        <legend className="text-sm font-semibold px-1">Threshold Detection</legend>

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
            className="w-24 h-7 border rounded px-1 text-sm"
          />
          <span className="text-muted-foreground">RFU</span>
        </div>

        <p className="text-xs text-muted-foreground italic">
          Drag the red dashed line on the plot to adjust
        </p>
      </fieldset>
    </div>
  );
}
