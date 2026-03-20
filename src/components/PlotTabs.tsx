import { useAppState, type PlotTab } from '@/hooks/useAppState';

const TABS: { value: PlotTab; label: string }[] = [
  { value: 'amplification', label: 'Amplification' },
  { value: 'melt', label: 'Melt' },
  { value: 'doubling', label: 'Doubling Time' },
];

export function PlotTabs() {
  const plotTab = useAppState((s) => s.plotTab);
  const setPlotTab = useAppState((s) => s.setPlotTab);

  return (
    <div className="flex border-b shrink-0">
      {TABS.map(({ value, label }) => (
        <button
          key={value}
          className={`px-4 py-1.5 text-sm font-medium border-b-2 transition-colors ${
            plotTab === value
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setPlotTab(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
