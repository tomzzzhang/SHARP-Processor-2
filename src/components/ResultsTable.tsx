import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import { useMemo } from 'react';
import { CONTENT_DISPLAY, getPaletteColors } from '@/lib/constants';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const CALL_COLORS: Record<string, string> = {
  positive: '#4caf50',
  negative: '#9e9e9e',
  invalid: '#ff9800',
};

export function ResultsTable() {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const selectedWells = useAppState((s) => s.selectedWells);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const selectOnly = useAppState((s) => s.selectOnly);
  const toggleWellSelection = useAppState((s) => s.toggleWellSelection);
  const palette = useAppState((s) => s.palette);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const wellGroups = useAppState((s) => s.wellGroups);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const exp = experiments[idx];
  const analysisResults = useAnalysisResults();

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
    // Build sortable units with Tt ordering
    const units: [number, string[]][] = [];
    for (const [, members] of groupMembers) {
      let sum = 0, count = 0;
      for (const w of members) {
        const tt = analysisResults.get(w)?.tt;
        if (tt != null) { sum += tt; count++; }
      }
      units.push([count > 0 ? sum / count : Infinity, members]);
    }
    for (const well of ungrouped) {
      const tt = analysisResults.get(well)?.tt;
      units.push([tt ?? Infinity, [well]]);
    }
    if (analysisResults.size > 0) units.sort((a, b) => a[0] - b[0]);

    let colors = getPaletteColors(palette, units.length);
    if (paletteReversed) colors = [...colors].reverse();
    for (let i = 0; i < units.length; i++) {
      const c = colors[i % colors.length];
      for (const w of units[i][1]) m.set(w, c);
    }
    for (const [well, ov] of wellStyleOverrides.entries()) {
      const override = ov as { color?: string } | undefined;
      if (override?.color) m.set(well, override.color);
    }
    return m;
  }, [exp, palette, paletteReversed, wellGroups, wellStyleOverrides, analysisResults]);

  const ttLabel = xAxisMode === 'cycle' ? 'Ct' : 'Tt';

  return (
    <div className="p-2">
      <Table>
        <TableHeader>
          <TableRow className="text-xs">
            <TableHead className="py-1">Well</TableHead>
            <TableHead className="py-1">Sample</TableHead>
            <TableHead className="py-1">Content</TableHead>
            <TableHead className="py-1 text-right">{ttLabel}</TableHead>
            <TableHead className="py-1 text-right">Dt</TableHead>
            <TableHead className="py-1">Call</TableHead>
            <TableHead className="py-1 text-right">End RFU</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!exp ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground text-xs py-2">
                No data loaded
              </TableCell>
            </TableRow>
          ) : (
            exp.wellsUsed
              .filter((well) => !hiddenWells.has(well))
              .map((well) => {
                const info = exp.wells[well];
                const isSelected = selectedWells.has(well);
                const color = colorMap.get(well) ?? '#999';
                const displayType = CONTENT_DISPLAY[info?.content ?? ''] ?? info?.content ?? '';
                const analysis = analysisResults.get(well);
                const endRfu = analysis?.endRfu ?? info?.endRfu;
                const tt = analysis?.tt;
                const dt = analysis?.dt;
                const call = analysis?.call ?? 'unset';

                return (
                  <TableRow
                    key={well}
                    className={`text-xs cursor-pointer hover:bg-accent ${isSelected ? 'bg-accent/40' : ''}`}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        toggleWellSelection(well);
                      } else {
                        selectOnly(well);
                      }
                    }}
                  >
                    <TableCell className="py-0.5 font-medium" style={{ color }}>{well}</TableCell>
                    <TableCell className="py-0.5">{info?.sample ?? ''}</TableCell>
                    <TableCell className="py-0.5">{displayType}</TableCell>
                    <TableCell className="py-0.5 text-right">
                      {tt != null ? tt.toFixed(2) : '—'}
                    </TableCell>
                    <TableCell className="py-0.5 text-right">
                      {dt != null ? dt.toFixed(2) : '—'}
                    </TableCell>
                    <TableCell className="py-0.5" style={{ color: CALL_COLORS[call] }}>
                      {call === 'unset' ? '—' : call === 'positive' ? '+' : call === 'negative' ? '−' : '?'}
                    </TableCell>
                    <TableCell className="py-0.5 text-right">
                      {endRfu != null ? Math.round(endRfu).toLocaleString() : '—'}
                    </TableCell>
                  </TableRow>
                );
              })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
