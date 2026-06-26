import { useMemo } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { WellGrid } from '../WellGrid';
import { WellList } from '../WellList';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from './CollapsibleSection';
import { effectiveChannelLabel } from '@/lib/channels';
import { curveKey } from '@/lib/curves';
import { FOCUS_RING } from '@/lib/ui-classes';

export function WellsTab() {
  const selectAll = useAppState((s) => s.selectAll);
  const selectByType = useAppState((s) => s.selectByType);
  const selectShown = useAppState((s) => s.selectShown);
  const selectHidden = useAppState((s) => s.selectHidden);
  const selectByChannel = useAppState((s) => s.selectByChannel);
  const wellGroups = useAppState((s) => s.wellGroups);
  const curveGroups = useAppState((s) => s.curveGroups);
  const setSelectedCurves = useAppState((s) => s.setSelectedCurves);
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const channelLabels = useAppState((s) => s.channelLabels);
  const viewMode = useAppState((s) => s.viewMode);
  const exp = experiments[idx];
  const channels = exp?.channels ?? [];
  const showChannels = channels.length > 1 && viewMode === 'multi';

  // Group names span both curve-level and well-level groups (a curve's
  // effective group is `curveGroups[curveKey] ?? wellGroups[well]`).
  const groupNames = useMemo(() => {
    const names = new Set<string>();
    for (const g of wellGroups.values()) names.add(g);
    for (const g of curveGroups.values()) names.add(g);
    return [...names].sort();
  }, [wellGroups, curveGroups]);

  // Select every S-C pair whose effective group matches — so a group built from
  // individual curves selects exactly those curves (and well-level groups still
  // select all of the well's curves).
  const handleSelectGroup = (groupName: string) => {
    if (!exp) return;
    const keys: string[] = [];
    for (const well of exp.wellsUsed) {
      for (const ch of exp.channels) {
        const key = curveKey(well, ch);
        const g = curveGroups.get(key) ?? wellGroups.get(well);
        if (g === groupName) keys.push(key);
      }
    }
    setSelectedCurves(new Set(keys));
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
              {showChannels && (
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) selectByChannel(e.target.value); e.target.value = ''; }}
                  className={`flex-1 h-7 text-xs border rounded-md px-1 bg-background text-foreground ${FOCUS_RING}`}
                  title="Select all S-C pairs for a fluorophore"
                >
                  <option value="" disabled>Fluor…</option>
                  {channels.map((ch) => (
                    <option key={ch} value={ch}>{effectiveChannelLabel(ch, channelLabels, exp?.channelFluorophore)}</option>
                  ))}
                </select>
              )}
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) handleSelectGroup(e.target.value);
                  e.target.value = '';
                }}
                disabled={groupNames.length === 0}
                className={`flex-1 h-7 text-xs border rounded-md px-1 bg-background text-foreground disabled:opacity-50 ${FOCUS_RING}`}
                title="Select all curves in a group"
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
