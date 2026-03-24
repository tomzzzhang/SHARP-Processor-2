import { useAppState, type PlotTab } from '@/hooks/useAppState';

const TABS: { value: PlotTab; label: string }[] = [
  { value: 'amplification', label: 'Amplification' },
  { value: 'melt', label: 'Melt' },
  { value: 'doubling', label: 'Doubling Time' },
];

export function PlotTabs() {
  const plotTab = useAppState((s) => s.plotTab);
  const setPlotTab = useAppState((s) => s.setPlotTab);
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const hasExperiment = !!experiments[idx];

  return (
    <div className="flex border-b shrink-0">
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
    </div>
  );
}
