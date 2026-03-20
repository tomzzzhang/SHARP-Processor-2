import { useAppState } from '@/hooks/useAppState';
import { Checkbox } from '@/components/ui/checkbox';

export function AnalysisTab() {
  const baselineEnabled = useAppState((s) => s.baselineEnabled);
  const baselineMethod = useAppState((s) => s.baselineMethod);
  const baselineStart = useAppState((s) => s.baselineStart);
  const baselineEnd = useAppState((s) => s.baselineEnd);
  const showRawOverlay = useAppState((s) => s.showRawOverlay);
  const thresholdEnabled = useAppState((s) => s.thresholdEnabled);
  const thresholdRfu = useAppState((s) => s.thresholdRfu);

  const setBaselineEnabled = useAppState((s) => s.setBaselineEnabled);
  const setBaselineMethod = useAppState((s) => s.setBaselineMethod);
  const setBaselineZone = useAppState((s) => s.setBaselineZone);
  const setShowRawOverlay = useAppState((s) => s.setShowRawOverlay);
  const setThresholdEnabled = useAppState((s) => s.setThresholdEnabled);
  const setThresholdRfu = useAppState((s) => s.setThresholdRfu);

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
