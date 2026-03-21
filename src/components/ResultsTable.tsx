import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import { useDragSelect } from '@/hooks/useDragSelect';
import { useMemo, useState, useCallback } from 'react';
import { CONTENT_DISPLAY, getPaletteColors } from '@/lib/constants';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const SEL_BG = '#e5e7eb'; // selection highlight (gray-200)

const CALL_COLORS: Record<string, string> = {
  positive: '#22c55e',
  negative: '#9e9e9e',
  invalid: '#f59e0b',
};


type SortKey = 'well' | 'sample' | 'content' | 'tt' | 'call' | 'endRfu';
type SortDir = 'asc' | 'desc';

interface RowData {
  well: string;
  sample: string;
  content: string;
  displayType: string;
  tt: number | null;
  dt: number | null;
  call: string;
  endRfu: number | undefined;
  color: string;
}

function compareRows(a: RowData, b: RowData, key: SortKey, dir: SortDir): number {
  let cmp = 0;
  switch (key) {
    case 'well': {
      // Natural sort: letter part then number part
      const am = a.well.match(/^([A-Z])(\d+)$/);
      const bm = b.well.match(/^([A-Z])(\d+)$/);
      if (am && bm) {
        cmp = am[1].localeCompare(bm[1]) || (Number(am[2]) - Number(bm[2]));
      } else {
        cmp = a.well.localeCompare(b.well);
      }
      break;
    }
    case 'sample':
      cmp = a.sample.localeCompare(b.sample);
      break;
    case 'content':
      cmp = a.displayType.localeCompare(b.displayType);
      break;
    case 'tt':
      cmp = (a.tt ?? Infinity) - (b.tt ?? Infinity);
      break;
    case 'call':
      cmp = a.call.localeCompare(b.call);
      break;
    case 'endRfu':
      cmp = (a.endRfu ?? -Infinity) - (b.endRfu ?? -Infinity);
      break;
  }
  return dir === 'desc' ? -cmp : cmp;
}

function SortableHeader({ label, sortKey, currentKey, currentDir, onSort, className }: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const isActive = currentKey === sortKey;
  const arrow = isActive ? (currentDir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <TableHead
      className={`py-1 cursor-pointer select-none hover:text-foreground transition-colors ${className ?? ''} ${isActive ? 'text-foreground' : ''}`}
      onClick={() => onSort(sortKey)}
    >
      {label}{arrow}
    </TableHead>
  );
}

export function ResultsTable() {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const selectedWells = useAppState((s) => s.selectedWells);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const selectOnly = useAppState((s) => s.selectOnly);
  const toggleWellSelection = useAppState((s) => s.toggleWellSelection);
  const setSelectedWells = useAppState((s) => s.setSelectedWells);
  const palette = useAppState((s) => s.palette);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const wellGroups = useAppState((s) => s.wellGroups);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const exp = experiments[idx];
  const analysisResults = useAnalysisResults();

  const [sortKey, setSortKey] = useState<SortKey>('well');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = useCallback((key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

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

  const rows = useMemo((): RowData[] => {
    if (!exp) return [];
    const result: RowData[] = [];
    for (const well of exp.wellsUsed) {
      if (hiddenWells.has(well)) continue;
      const info = exp.wells[well];
      const analysis = analysisResults.get(well);
      result.push({
        well,
        sample: info?.sample ?? '',
        content: info?.content ?? '',
        displayType: CONTENT_DISPLAY[info?.content ?? ''] ?? info?.content ?? '',
        tt: analysis?.tt ?? null,
        dt: analysis?.dt ?? null,
        call: analysis?.call ?? 'unset',
        endRfu: analysis?.endRfu ?? info?.endRfu,
        color: colorMap.get(well) ?? '#999',
      });
    }
    result.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    return result;
  }, [exp, hiddenWells, analysisResults, colorMap, sortKey, sortDir]);

  const rowWells = useMemo(() => rows.map((r) => r.well), [rows]);
  const { onRowMouseDown, onRowMouseEnter } = useDragSelect(rowWells, {
    selectOnly, toggleWellSelection, setSelectedWells, selectedWells,
  });

  const ttLabel = xAxisMode === 'cycle' ? 'Ct' : 'Tt';

  return (
    <div className="p-2">
      <Table>
        <TableHeader>
          <TableRow className="text-xs">
            <SortableHeader label="Well" sortKey="well" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="w-14" />
            <SortableHeader label="Sample" sortKey="sample" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
            <SortableHeader label="Content" sortKey="content" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="w-16" />
            <SortableHeader label={ttLabel} sortKey="tt" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right w-16" />
            <SortableHeader label="Call" sortKey="call" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="w-12 text-center" />
            <SortableHeader label="End RFU" sortKey="endRfu" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground text-xs py-2">
                No data loaded
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => {
              const isSelected = selectedWells.has(row.well);
              const isPositive = row.call === 'positive';
              const isInvalid = row.call === 'invalid';
              const cellBg = isSelected
                ? SEL_BG
                : i % 2 === 1
                  ? '#f5f5f5'
                  : undefined;

              return (
                <TableRow
                  key={row.well}
                  className="text-xs cursor-pointer hover:bg-accent"
                  onMouseDown={(e) => onRowMouseDown(e, row.well)}
                  onMouseEnter={() => onRowMouseEnter(row.well)}
                >
                  <TableCell className="py-0.5 font-medium" style={{ color: row.color, backgroundColor: cellBg, borderLeft: isSelected ? '2.5px solid #555' : undefined }}>{row.well}</TableCell>
                  <TableCell className="py-0.5" style={{ backgroundColor: cellBg }}>{row.sample}</TableCell>
                  <TableCell className="py-0.5" style={{ backgroundColor: cellBg }}>{row.displayType}</TableCell>
                  <TableCell className="py-0.5 text-right" style={{ backgroundColor: cellBg }}>
                    {row.tt != null ? row.tt.toFixed(2) : '—'}
                  </TableCell>
                  <TableCell className="py-0.5 text-center" style={{ backgroundColor: cellBg, fontSize: 15, fontWeight: 700, color: CALL_COLORS[row.call] }}>
                    {row.call === 'unset' ? '—' : row.call === 'positive' ? '+' : row.call === 'negative' ? '−' : '?'}
                  </TableCell>
                  <TableCell className="py-0.5 text-right" style={{ backgroundColor: cellBg }}>
                    {row.endRfu != null ? Math.round(row.endRfu).toLocaleString() : '—'}
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
