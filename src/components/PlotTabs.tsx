import { useAppState, type PlotTab } from '@/hooks/useAppState';
import { Checkbox } from '@/components/ui/checkbox';
import type { XAxisMode } from '@/types/experiment';

const TABS: { value: PlotTab; label: string }[] = [
  { value: 'amplification', label: 'Amplification' },
  { value: 'melt', label: 'Melt' },
  { value: 'doubling', label: 'Doubling Time' },
];

const MODES: { value: XAxisMode; label: string }[] = [
  { value: 'cycle', label: 'Cycle' },
  { value: 'time_s', label: 'Sec' },
  { value: 'time_min', label: 'Min' },
];

export function PlotTabs() {
  const plotTab = useAppState((s) => s.plotTab);
  const setPlotTab = useAppState((s) => s.setPlotTab);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const setXAxisMode = useAppState((s) => s.setXAxisMode);
  const logScale = useAppState((s) => s.logScale);
  const setLogScale = useAppState((s) => s.setLogScale);
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const hasExperiment = !!experiments[idx];

  return (
    <div className="flex items-center border-b shrink-0">
      {/* Plot view tabs — left side */}
      {TABS.map(({ value, label }) => (
        <button
          key={value}
          disabled={!hasExperiment}
          className={`px-4 py-1.5 text-sm font-medium border-b-2 transition-colors ${
            !hasExperiment
              ? 'border-transparent text-muted-foreground/40 cursor-default'
              : plotTab === value
                ? 'border-[var(--brand-red-mid)] text-[var(--brand-red-dark)]'
                : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => hasExperiment && setPlotTab(value)}
        >
          {label}
        </button>
      ))}

      <div className="flex-1" />

      {/* X-axis selector + Log Scale — right side */}
      <div className={`flex items-center gap-3 px-3 text-xs ${!hasExperiment ? 'opacity-40 pointer-events-none' : ''}`}>
        <span className="mx-1 text-border">|</span>
        <span className="font-medium text-muted-foreground">X:</span>
        {MODES.map(({ value, label }) => (
          <label key={value} className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="x-axis"
              checked={xAxisMode === value}
              onChange={() => setXAxisMode(value)}
              style={{ accentColor: 'var(--brand-red-dark)' }}
            />
            {label}
          </label>
        ))}

        <span className="mx-1 text-border">|</span>

        <label className="flex items-center gap-1.5 cursor-pointer">
          <Checkbox
            checked={logScale}
            onCheckedChange={(v) => setLogScale(v === true)}
            className="h-3.5 w-3.5"
          />
          Log
        </label>
      </div>
    </div>
  );
}
