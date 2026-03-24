import { useMemo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { WellGrid } from '../WellGrid';
import { WellList } from '../WellList';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from './CollapsibleSection';

export function WellsTab() {
  const selectAll = useAppState((s) => s.selectAll);
  const selectByType = useAppState((s) => s.selectByType);
  const selectShown = useAppState((s) => s.selectShown);
  const selectHidden = useAppState((s) => s.selectHidden);
  const wellGroups = useAppState((s) => s.wellGroups);
  const setSelectedWells = useAppState((s) => s.setSelectedWells);

  // Derive sorted group names and group→wells mapping
  const groupNames = useMemo(() => {
    const names = new Set<string>();
    for (const g of wellGroups.values()) names.add(g);
    return [...names].sort();
  }, [wellGroups]);

  const handleSelectGroup = (groupName: string) => {
    const wells: string[] = [];
    for (const [well, group] of wellGroups) {
      if (group === groupName) wells.push(well);
    }
    setSelectedWells(new Set(wells));
  };

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      {/* Plate grid — fixed height */}
      <div className="shrink-0">
        <h3 className="text-xs font-semibold mb-1 text-foreground uppercase tracking-wide">Plate</h3>
        <div className="flex justify-center">
          <WellGrid />
        </div>
      </div>

      {/* Selection toolbar — fixed height */}
      <div className="shrink-0">
        <CollapsibleSection title="Select">
          <div className="space-y-1">
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={selectAll}>All</Button>
              <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => selectByType('Unkn')}>Samp</Button>
              <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => selectByType('Neg Ctrl')}>NTC</Button>
              <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => selectByType('Std')}>Std</Button>
            </div>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={selectShown}>Shown</Button>
              <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={selectHidden}>Hidden</Button>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) handleSelectGroup(e.target.value);
                  e.target.value = '';
                }}
                disabled={groupNames.length === 0}
                className="flex-1 h-7 text-xs border rounded-md px-1 bg-background text-foreground disabled:opacity-40"
                title="Select all wells in a group"
              >
                <option value="" disabled>Group…</option>
                {groupNames.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          </div>
        </CollapsibleSection>
      </div>

      {/* Well list — fills remaining space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CollapsibleSection title="Wells">
          <div className="-mx-3 -mb-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 420px)' }}>
            <WellList />
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
