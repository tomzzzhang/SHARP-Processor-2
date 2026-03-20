import { useAppState } from '@/hooks/useAppState';
import { Checkbox } from '@/components/ui/checkbox';
import type { XAxisMode } from '@/types/experiment';

const MODES: { value: XAxisMode; label: string }[] = [
  { value: 'cycle', label: 'Cycle' },
  { value: 'time_s', label: 'Sec' },
  { value: 'time_min', label: 'Min' },
];

export function XAxisBar() {
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const setXAxisMode = useAppState((s) => s.setXAxisMode);
  const logScale = useAppState((s) => s.logScale);
  const setLogScale = useAppState((s) => s.setLogScale);

  return (
    <div className="flex items-center gap-4 px-3 py-1 bg-muted/30 border-b text-sm shrink-0">
      <span className="font-medium text-muted-foreground text-xs">X-axis:</span>
      {MODES.map(({ value, label }) => (
        <label key={value} className="flex items-center gap-1 text-xs cursor-pointer">
          <input
            type="radio"
            name="x-axis"
            checked={xAxisMode === value}
            onChange={() => setXAxisMode(value)}
            className="accent-primary"
          />
          {label}
        </label>
      ))}

      <div className="flex-1" />

      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
        <Checkbox
          checked={logScale}
          onCheckedChange={(v) => setLogScale(v === true)}
          className="h-3.5 w-3.5"
        />
        Log Scale
      </label>
    </div>
  );
}
