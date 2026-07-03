import { useAppState, type PlotTab } from '@/hooks/useAppState';
import { Checkbox } from '@/components/ui/checkbox';
import type { XAxisMode } from '@/types/experiment';
import { effectiveChannelLabel, effectiveChannelColor } from '@/lib/channels';
import { FOCUS_RING } from '@/lib/ui-classes';

const TABS: { value: PlotTab; label: string }[] = [
  { value: 'amplification', label: 'Amplification' },
  { value: 'melt', label: 'Melt' },
  { value: 'doubling', label: 'Standard Curve' },
];

const MODES: { value: XAxisMode; label: string }[] = [
  { value: 'cycle', label: 'Cycle' },
  { value: 'time_s', label: 'Sec' },
  { value: 'time_min', label: 'Min' },
];

/** SVG dash pattern for a Plotly dash name (channel swatch preview). */
function dashArray(dash: string): string | undefined {
  switch (dash) {
    case 'dash': return '5,3';
    case 'dot': return '2,2';
    case 'dashdot': return '5,2,2,2';
    case 'longdash': return '8,3';
    case 'longdashdot': return '8,2,2,2';
    default: return undefined;
  }
}

export function PlotTabs() {
  const plotTab = useAppState((s) => s.plotTab);
  const setPlotTab = useAppState((s) => s.setPlotTab);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const setXAxisMode = useAppState((s) => s.setXAxisMode);
  const logScale = useAppState((s) => s.logScale);
  const setLogScale = useAppState((s) => s.setLogScale);
  const baselineAuto = useAppState((s) => s.baselineAuto);
  const setBaselineAuto = useAppState((s) => s.setBaselineAuto);
  const baselineEnabled = useAppState((s) => s.baselineEnabled);
  const meltNormalizeEnabled = useAppState((s) => s.meltNormalizeEnabled);
  const setMeltNormalizeEnabled = useAppState((s) => s.setMeltNormalizeEnabled);
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const visibleChannels = useAppState((s) => s.visibleChannels);
  const channelLabels = useAppState((s) => s.channelLabels);
  const channelColors = useAppState((s) => s.channelColors);
  const channelLineStyles = useAppState((s) => s.channelLineStyles);
  const toggleChannelGlobal = useAppState((s) => s.toggleChannelGlobal);
  const viewMode = useAppState((s) => s.viewMode);
  const activeChannel = useAppState((s) => s.activeChannel);
  const setActiveChannel = useAppState((s) => s.setActiveChannel);
  const autoScale = useAppState((s) => s.autoScale);
  const setAutoScale = useAppState((s) => s.setAutoScale);
  const triggerAutoScale = useAppState((s) => s.triggerAutoScale);
  const exp = experiments[idx];
  const hasExperiment = !!exp;
  const channels = exp?.channels ?? [];
  const onPlotTab = plotTab === 'amplification' || plotTab === 'melt';
  // Multichannel view → channel toggles; single view of a multichannel dataset
  // → a channel picker; single-channel dataset → neither.
  const showChannels = channels.length > 1 && viewMode === 'multi' && onPlotTab;
  const showChannelPicker = channels.length > 1 && viewMode === 'single' && onPlotTab;

  return (
    <div className="flex items-center border-b shrink-0">
      {/* Plot view tabs — left side */}
      {TABS.map(({ value, label }) => (
        <button
          key={value}
          disabled={!hasExperiment}
          className={`px-4 py-1.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
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

      {/* Channel toggles — shown for multichannel experiments on amp/melt */}
      {showChannels && (
        <div className="flex items-center gap-2 px-3 text-xs">
          <span className="font-medium text-muted-foreground">Ch:</span>
          {channels.map((ch) => {
            const label = effectiveChannelLabel(ch, channelLabels, exp?.channelFluorophore);
            const color = effectiveChannelColor(ch, channelColors, channelLabels, exp?.channelFluorophore);
            // Channels differ by hue; a per-channel line-style (set via "Separate
            // by line style") shows as the swatch dash.
            const dash = channelLineStyles.get(ch) ?? 'solid';
            return (
              <label key={ch} className="flex items-center gap-1 cursor-pointer whitespace-nowrap" title={`${label} (${dash})`}>
                <Checkbox
                  checked={visibleChannels.has(ch)}
                  onCheckedChange={() => toggleChannelGlobal(ch)}
                  className="h-3 w-3"
                />
                <svg width="16" height="8" className="inline-block shrink-0">
                  <line x1="0" y1="4" x2="16" y2="4" stroke={color} strokeWidth="2"
                        strokeDasharray={dashArray(dash)} />
                </svg>
                {label}
              </label>
            );
          })}
        </div>
      )}

      {/* Single-channel view of a multichannel dataset — pick the shown channel */}
      {showChannelPicker && (
        <div className="flex items-center gap-1.5 px-3 text-xs whitespace-nowrap">
          <span className="font-medium text-muted-foreground">Channel:</span>
          <select
            value={activeChannel}
            onChange={(e) => setActiveChannel(e.target.value)}
            className={`h-7 border rounded-md px-1 text-xs bg-background ${FOCUS_RING}`}
          >
            {channels.map((ch) => (
              <option key={ch} value={ch}>{effectiveChannelLabel(ch, channelLabels, exp?.channelFluorophore)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Log Scale + X-axis selector — right side */}
      <div className={`flex items-center gap-3 px-3 text-xs ${!hasExperiment ? 'opacity-40 pointer-events-none' : ''}`}>
        <span aria-hidden className="mx-1 h-4 w-px bg-border self-center" />

        {plotTab === 'melt' && (
          <>
            <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
              <Checkbox
                checked={meltNormalizeEnabled}
                onCheckedChange={(v) => setMeltNormalizeEnabled(v === true)}
                className="h-3 w-3"
              />
              Normalize
            </label>
            <span aria-hidden className="mx-1 h-4 w-px bg-border self-center" />
          </>
        )}

        <label
          className={`flex items-center gap-1.5 whitespace-nowrap ${
            baselineEnabled ? 'cursor-pointer' : 'opacity-50 cursor-default'
          }`}
        >
          <Checkbox
            checked={baselineAuto}
            onCheckedChange={(v) => setBaselineAuto(v === true)}
            disabled={!baselineEnabled}
            className="h-3 w-3"
          />
          Auto Baseline
        </label>

        <span aria-hidden className="mx-1 h-4 w-px bg-border self-center" />

        <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
          <Checkbox
            checked={logScale}
            onCheckedChange={(v) => setLogScale(v === true)}
            className="h-3 w-3"
          />
          Log
        </label>

        <span aria-hidden className="mx-1 h-4 w-px bg-border self-center" />

        <label
          className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          title="Re-fit axes automatically when normalization / baseline / drift / log scale changes"
        >
          <Checkbox
            checked={autoScale}
            onCheckedChange={(v) => setAutoScale(v === true)}
            className="h-3 w-3"
          />
          Auto-scale
        </label>
        <button
          onClick={() => triggerAutoScale()}
          className={`px-1.5 py-0.5 border rounded text-xs hover:bg-accent transition-colors active:bg-accent/80 ${FOCUS_RING}`}
          title="Auto-scale axes now (same as double right-click on a plot)"
        >
          Fit
        </button>

        <span aria-hidden className="mx-1 h-4 w-px bg-border self-center" />

        <span className="font-medium text-muted-foreground">X:</span>
        <select
          value={xAxisMode}
          onChange={(e) => setXAxisMode(e.target.value as XAxisMode)}
          className={`h-7 border rounded-md px-1 text-xs bg-background ${FOCUS_RING}`}
        >
          {MODES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
