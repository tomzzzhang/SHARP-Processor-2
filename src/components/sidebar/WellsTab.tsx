import { useAppState } from '@/hooks/useAppState';
import { WellGrid } from '../WellGrid';
import { WellList } from '../WellList';
import { Button } from '@/components/ui/button';

export function WellsTab() {
  const selectAll = useAppState((s) => s.selectAll);
  const deselectAll = useAppState((s) => s.deselectAll);
  const selectByType = useAppState((s) => s.selectByType);

  return (
    <div className="flex flex-col h-full">
      {/* Plate grid */}
      <div className="p-3 pb-1">
        <h3 className="text-xs font-semibold mb-1 text-muted-foreground uppercase tracking-wide">Plate</h3>
        <WellGrid />
      </div>

      {/* Selection toolbar */}
      <div className="px-3 py-1 space-y-1 border-b">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Select</h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={selectAll}>All</Button>
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => selectByType('Unkn')}>Samp</Button>
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => selectByType('Neg Ctrl')}>NTC</Button>
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => selectByType('Std')}>Std</Button>
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={selectAll}>Shown</Button>
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={deselectAll}>Hidden</Button>
        </div>
      </div>

      {/* Well list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-3 py-1">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Wells</h3>
        </div>
        <WellList />
      </div>
    </div>
  );
}
