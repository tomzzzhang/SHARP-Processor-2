import { useAppState } from '@/hooks/useAppState';
import { Checkbox } from '@/components/ui/checkbox';
import { useMemo } from 'react';
import { CONTENT_DISPLAY, getPaletteColors } from '@/lib/constants';

export function WellList() {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const selectedWells = useAppState((s) => s.selectedWells);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const selectOnly = useAppState((s) => s.selectOnly);
  const toggleWellSelection = useAppState((s) => s.toggleWellSelection);
  const toggleWellHidden = useAppState((s) => s.toggleWellHidden);
  const addToSelection = useAppState((s) => s.addToSelection);
  const palette = useAppState((s) => s.palette);
  const wellGroups = useAppState((s) => s.wellGroups);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const exp = experiments[idx];

  // Build color map respecting groups (same logic as plots)
  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    if (!exp) return m;
    const seenGroups = new Set<string>();
    const groupMembers = new Map<string, string[]>();
    const ungrouped: string[] = [];
    for (const well of exp.wellsUsed) {
      const group = wellGroups.get(well);
      if (group) {
        if (!seenGroups.has(group)) { seenGroups.add(group); groupMembers.set(group, []); }
        groupMembers.get(group)!.push(well);
      } else { ungrouped.push(well); }
    }
    const nUnits = seenGroups.size + ungrouped.length;
    const colors = getPaletteColors(palette, nUnits);
    let ci = 0;
    for (const [, members] of groupMembers) {
      const c = colors[ci % colors.length]; for (const w of members) m.set(w, c); ci++;
    }
    for (const w of ungrouped) { m.set(w, colors[ci % colors.length]); ci++; }
    for (const [well, ov] of wellStyleOverrides.entries()) {
      const override = ov as { color?: string } | undefined;
      if (override?.color) m.set(well, override.color);
    }
    return m;
  }, [exp, palette, wellGroups, wellStyleOverrides]);

  if (!exp) {
    return <div className="p-3 text-sm text-muted-foreground">No data loaded</div>;
  }

  return (
    <div className="text-xs">
      <table className="w-full">
        <thead className="sticky top-0 bg-background border-b">
          <tr className="text-muted-foreground">
            <th className="w-7 px-1 py-1 text-center">L</th>
            <th className="w-10 px-1 py-1 text-left">Well</th>
            <th className="px-1 py-1 text-left">Sample</th>
            <th className="w-10 px-1 py-1 text-left">Type</th>
            <th className="px-1 py-1 text-left">Group</th>
          </tr>
        </thead>
        <tbody>
          {exp.wellsUsed.map((well, i) => {
            const info = exp.wells[well];
            const isSelected = selectedWells.has(well);
            const isHidden = hiddenWells.has(well);
            const color = colorMap.get(well) ?? '#999';
            const displayType = CONTENT_DISPLAY[info?.content ?? ''] ?? info?.content ?? '';

            return (
              <tr
                key={well}
                className={`cursor-pointer hover:bg-accent ${isSelected ? 'bg-accent/50' : ''}`}
                style={{ height: 22, opacity: isHidden ? 0.4 : 1 }}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    toggleWellSelection(well);
                  } else {
                    selectOnly(well);
                  }
                }}
              >
                <td className="px-1 py-0 text-center" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={!isHidden}
                    onCheckedChange={() => toggleWellHidden(well)}
                    className="h-3.5 w-3.5"
                  />
                </td>
                <td className="px-1 py-0 font-medium" style={{ color }}>
                  {well}
                </td>
                <td className="px-1 py-0 truncate max-w-[120px]">
                  {info?.sample ?? ''}
                </td>
                <td className="px-1 py-0">
                  {displayType}
                </td>
                <td className="px-1 py-0 truncate max-w-[80px] text-muted-foreground">
                  {wellGroups.get(well) ?? ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
