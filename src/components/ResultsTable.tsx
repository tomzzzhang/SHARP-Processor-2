import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults, useAllChannelResults, useAllChannelLandmarks } from '@/hooks/useAnalysisResults';
import { useDragSelect } from '@/hooks/useDragSelect';
import { useMemo, useState, useCallback, useRef, Fragment } from 'react';
import { CONTENT_DISPLAY, getPaletteColors } from '@/lib/constants';
import { effectiveChannelLabel } from '@/lib/channels';
import { curveKey } from '@/lib/curves';
import { ChevronUp, ChevronDown } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const SEL_BG = 'var(--accent)'; // selection highlight — theme-aware

const CALL_COLORS: Record<string, string> = {
  positive: 'var(--call-positive)',
  negative: 'var(--call-negative)',
  invalid: 'var(--call-invalid)',
};


type SortKey = 'well' | 'sample' | 'content' | 'tt' | 'tlod' | 'tonset' | 'tm' | 'call' | 'endRfu';
type SortDir = 'asc' | 'desc';

interface RowData {
  well: string;
  sample: string;
  content: string;
  displayType: string;
  tt: number | null;
  /** Kinetic landmarks in seconds (converted for display). */
  tLod: number | null;
  tOnset10: number | null;
  tm: number | null;
  dt: number | null;
  call: string;
  endRfu: number | undefined;
  color: string;
  /** Channel ID for this row (multichannel only); undefined = single-channel. */
  channel?: string;
  /** Effective fluorophore label for the channel column (multichannel only). */
  fluor?: string;
}

/** A collapsible parent (well/sample) with its per-channel child rows. */
interface TreeNode {
  well: string;
  sample: string;
  displayType: string;
  color: string;
  children: RowData[];   // one per visible channel (S-C pair)
  sortRow: RowData;      // aggregate used to sort the parent
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
    case 'tlod':
      cmp = (a.tLod ?? Infinity) - (b.tLod ?? Infinity);
      break;
    case 'tonset':
      cmp = (a.tOnset10 ?? Infinity) - (b.tOnset10 ?? Infinity);
      break;
    case 'tm':
      cmp = (a.tm ?? Infinity) - (b.tm ?? Infinity);
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

function SortableHeader({ label, sortKey, currentKey, currentDir, onSort, className, width, onResize, prefix }: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
  width?: number;
  onResize?: (startX: number) => void;
  prefix?: React.ReactNode;
}) {
  const isActive = currentKey === sortKey;
  return (
    <TableHead
      className={`py-1 cursor-pointer select-none hover:text-foreground transition-colors relative ${className ?? ''} ${isActive ? 'text-[var(--brand-red-dark)]' : ''}`}
      style={width ? { width, minWidth: width, maxWidth: width } : undefined}
      onClick={() => onSort(sortKey)}
    >
      {prefix}{label}
      <span className="inline-flex w-3 align-middle justify-center">
        {isActive && (currentDir === 'asc'
          ? <ChevronUp className="size-3" />
          : <ChevronDown className="size-3" />)}
      </span>
      {onResize && (
        <div
          className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-10 flex items-center justify-center"
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onResize(e.clientX); }}
        >
          <div className="w-[2px] h-3 border-x border-border/50" />
        </div>
      )}
    </TableHead>
  );
}

export function ResultsTable() {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const selectedWells = useAppState((s) => s.selectedWells);
  const selectedCurves = useAppState((s) => s.selectedCurves);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const deactivatedWells = useAppState((s) => s.deactivatedWells);
  const selectOnly = useAppState((s) => s.selectOnly);
  const toggleWellSelection = useAppState((s) => s.toggleWellSelection);
  const setSelectedWells = useAppState((s) => s.setSelectedWells);
  const selectCurvesOnly = useAppState((s) => s.selectCurvesOnly);
  const toggleCurves = useAppState((s) => s.toggleCurves);
  const palette = useAppState((s) => s.palette);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const wellGroups = useAppState((s) => s.wellGroups);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const visibleChannels = useAppState((s) => s.visibleChannels);
  const channelLabels = useAppState((s) => s.channelLabels);
  const wellChannelHidden = useAppState((s) => s.wellChannelHidden);
  const viewMode = useAppState((s) => s.viewMode);
  const exp = experiments[idx];
  const melt = exp?.melt;
  const analysisResults = useAnalysisResults();
  const allChannelResults = useAllChannelResults();
  const allChannelLandmarks = useAllChannelLandmarks();
  const thresholdEnabled = useAppState((s) => s.thresholdEnabled);
  const activeChannel = useAppState((s) => s.activeChannel);

  const visibleChannelList = useMemo(
    () => (exp?.channels ?? []).filter((c) => visibleChannels.has(c)),
    [exp, visibleChannels],
  );
  // Per-(well,channel) rows + Fluor column only in the multichannel view; in
  // single view the table is flat per-well for the active channel (v0.1.x look).
  const multiChannel = viewMode === 'multi' && visibleChannelList.length > 1;
  // Column count for the empty-state row colSpan (extra Fluor column when multichannel).
  const colCount = multiChannel ? 10 : 9;

  /** Tm (temperature at peak -dF/dT) for a well in a specific channel's melt. */
  const tmFor = useCallback((channel: string, well: string): number | null => {
    const m = exp?.meltByChannel[channel];
    if (!m) return null;
    const derData = m.derivative[well];
    if (!derData || derData.length === 0) return null;
    let maxIdx = 0, maxVal = -Infinity;
    for (let i = 0; i < derData.length; i++) {
      if (derData[i] > maxVal) { maxVal = derData[i]; maxIdx = i; }
    }
    return (maxVal > 0 && maxIdx < m.temperatureC.length) ? m.temperatureC[maxIdx] : null;
  }, [exp]);

  // Single-channel Tm map (active channel) for the legacy path.
  const tmMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!melt || Object.keys(melt.derivative).length === 0) return map;
    for (const well of exp?.wellsUsed ?? []) {
      const derData = melt.derivative[well];
      if (!derData || derData.length === 0) continue;
      let maxIdx = 0;
      let maxVal = -Infinity;
      for (let i = 0; i < derData.length; i++) {
        if (derData[i] > maxVal) { maxVal = derData[i]; maxIdx = i; }
      }
      if (maxVal > 0 && maxIdx < melt.temperatureC.length) {
        map.set(well, melt.temperatureC[maxIdx]);
      }
    }
    return map;
  }, [melt, exp]);

  const [sortKey, setSortKey] = useState<SortKey>('well');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Column resize state
  const COL_ORDER: SortKey[] = ['well', 'sample', 'content', 'tt', 'tlod', 'tonset', 'tm', 'call', 'endRfu'];
  const MIN_COL_WIDTH = 32;
  // Percentage-based widths for even distribution (sample gets remainder)
  const COL_PCT: Record<SortKey, string> = { well: '7%', sample: '', content: '8%', tt: '9%', tlod: '9%', tonset: '9%', tm: '9%', call: '6%', endRfu: '10%' };
  const DEFAULT_WIDTHS: Record<SortKey, number> = { well: 50, sample: 100, content: 54, tt: 50, tlod: 52, tonset: 54, tm: 50, call: 42, endRfu: 66 };
  const [colWidths, setColWidths] = useState<Record<SortKey, number>>(DEFAULT_WIDTHS);
  const resizingCol = useRef<SortKey | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  const startResize = useCallback((col: SortKey) => (startX: number) => {
    const colIdx = COL_ORDER.indexOf(col);
    const nextCol = colIdx < COL_ORDER.length - 1 ? COL_ORDER[colIdx + 1] : null;
    resizingCol.current = col;
    resizeStartX.current = startX;
    resizeStartW.current = colWidths[col];
    const nextStartW = nextCol ? colWidths[nextCol] : 0;

    const onMove = (e: MouseEvent) => {
      if (!resizingCol.current) return;
      let delta = e.clientX - resizeStartX.current;
      // Clamp: current col can't go below MIN_COL_WIDTH
      delta = Math.max(delta, MIN_COL_WIDTH - resizeStartW.current);
      // Clamp: next col can't go below MIN_COL_WIDTH
      if (nextCol) {
        delta = Math.min(delta, nextStartW - MIN_COL_WIDTH);
      } else {
        // Last resizable col: don't grow beyond current width
        delta = Math.min(delta, 0);
      }
      setColWidths((prev) => {
        const updated = { ...prev, [resizingCol.current!]: resizeStartW.current + delta };
        if (nextCol) updated[nextCol] = nextStartW - delta;
        return updated;
      });
    };
    const onUp = () => {
      resizingCol.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [colWidths]);

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

  // Flat per-well rows (single-channel / single-view). The multichannel tree is
  // built separately below.
  const rows = useMemo((): RowData[] => {
    if (!exp) return [];
    const activeLandmarks = allChannelLandmarks.get(activeChannel);
    const result: RowData[] = [];
    for (const well of exp.wellsUsed) {
      if (hiddenWells.has(well) || deactivatedWells.has(well)) continue;
      const info = exp.wells[well];
      const analysis = analysisResults.get(well);
      const lm = activeLandmarks?.get(well);
      result.push({
        well,
        sample: info?.sample ?? '',
        content: info?.content ?? '',
        displayType: CONTENT_DISPLAY[info?.content ?? ''] ?? info?.content ?? '',
        color: colorMap.get(well) ?? 'var(--muted-foreground)',
        tt: analysis?.tt ?? null,
        tLod: lm?.tLod ?? null,
        tOnset10: lm?.tOnset10 ?? null,
        tm: tmMap.get(well) ?? null,
        dt: analysis?.dt ?? null,
        call: analysis?.call ?? 'unset',
        endRfu: analysis?.endRfu ?? info?.endRfu ?? undefined,
      });
    }
    result.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    return result;
  }, [exp, hiddenWells, deactivatedWells, analysisResults, colorMap, sortKey, sortDir, tmMap, allChannelLandmarks, activeChannel]);

  // Multichannel collapsible tree: one parent row per visible well + a child
  // row per visible channel (S-C pair). A well with a single visible channel
  // renders that channel inline on the parent (no caret). Parents are sorted by
  // an aggregate of their channels (min Tt/Tm, max End RFU, best call).
  const tree = useMemo((): TreeNode[] => {
    if (!exp || !multiChannel) return [];
    const minOf = (vals: (number | null | undefined)[]) => {
      const f = vals.filter((v): v is number => v != null);
      return f.length ? Math.min(...f) : null;
    };
    const maxOf = (vals: (number | null | undefined)[]) => {
      const f = vals.filter((v): v is number => v != null);
      return f.length ? Math.max(...f) : undefined;
    };
    const nodes: TreeNode[] = [];
    for (const well of exp.wellsUsed) {
      if (hiddenWells.has(well) || deactivatedWells.has(well)) continue;
      const info = exp.wells[well];
      const chs = visibleChannelList.filter((ch) => !wellChannelHidden.get(well)?.has(ch));
      if (chs.length === 0) continue;
      const color = colorMap.get(well) ?? 'var(--muted-foreground)';
      const displayType = CONTENT_DISPLAY[info?.content ?? ''] ?? info?.content ?? '';
      const children: RowData[] = chs.map((ch) => {
        const analysis = allChannelResults.get(ch)?.get(well);
        const lm = allChannelLandmarks.get(ch)?.get(well);
        return {
          well, sample: info?.sample ?? '', content: info?.content ?? '', displayType, color,
          tt: analysis?.tt ?? null, tLod: lm?.tLod ?? null, tOnset10: lm?.tOnset10 ?? null,
          tm: tmFor(ch, well), dt: analysis?.dt ?? null,
          call: analysis?.call ?? 'unset', endRfu: analysis?.endRfu ?? undefined,
          channel: ch, fluor: effectiveChannelLabel(ch, channelLabels, exp.channelFluorophore),
        };
      });
      const calls = children.map((c) => c.call);
      const aggCall = calls.includes('positive') ? 'positive'
        : calls.includes('negative') ? 'negative'
        : calls.includes('invalid') ? 'invalid' : 'unset';
      const sortRow: RowData = {
        well, sample: info?.sample ?? '', content: info?.content ?? '', displayType, color,
        tt: minOf(children.map((c) => c.tt)), tLod: minOf(children.map((c) => c.tLod)),
        tOnset10: minOf(children.map((c) => c.tOnset10)), tm: minOf(children.map((c) => c.tm)),
        dt: null, call: aggCall, endRfu: maxOf(children.map((c) => c.endRfu)),
      };
      nodes.push({ well, sample: info?.sample ?? '', displayType, color, children, sortRow });
    }
    nodes.sort((a, b) => compareRows(a.sortRow, b.sortRow, sortKey, sortDir));
    return nodes;
  }, [exp, multiChannel, hiddenWells, deactivatedWells, visibleChannelList, wellChannelHidden, allChannelResults, allChannelLandmarks, colorMap, tmFor, channelLabels, sortKey, sortDir]);

  // Expand/collapse per parent well (multichannel tree). Default collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((well: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(well)) next.delete(well); else next.add(well);
      return next;
    });
  }, []);
  // Expand/collapse all (header caret). Only parents with >1 child are
  // collapsible; single-child wells render inline.
  const collapsibleWells = useMemo(() => tree.filter((n) => n.children.length > 1).map((n) => n.well), [tree]);
  const allExpanded = collapsibleWells.length > 0 && collapsibleWells.every((w) => expanded.has(w));
  const toggleExpandAll = useCallback(() => {
    setExpanded(allExpanded ? new Set() : new Set(collapsibleWells));
  }, [allExpanded, collapsibleWells]);

  // Curve-level selection helpers for the tree.
  const wellVisibleCurves = useCallback((well: string) =>
    visibleChannelList.filter((ch) => !wellChannelHidden.get(well)?.has(ch)).map((ch) => curveKey(well, ch)),
    [visibleChannelList, wellChannelHidden]);
  const onParentSelect = useCallback((e: React.MouseEvent, well: string) => {
    const keys = wellVisibleCurves(well);
    if (e.ctrlKey || e.metaKey) toggleCurves(keys); else selectCurvesOnly(keys);
  }, [wellVisibleCurves, toggleCurves, selectCurvesOnly]);
  const onChildSelect = useCallback((e: React.MouseEvent, well: string, ch: string) => {
    const k = curveKey(well, ch);
    if (e.ctrlKey || e.metaKey) toggleCurves([k]); else selectCurvesOnly([k]);
  }, [toggleCurves, selectCurvesOnly]);

  const rowWells = useMemo(() => rows.map((r) => r.well), [rows]);
  const { onRowMouseDown, onRowMouseEnter } = useDragSelect(rowWells, {
    selectOnly, toggleWellSelection, setSelectedWells, selectedWells,
  });

  const ttLabel = xAxisMode === 'cycle' ? 'Ct' : 'Tt';
  // Landmark times are computed in seconds; show them in min when the x-axis is
  // in minutes, else seconds (cycle mode shows seconds).
  const tUnit = xAxisMode === 'time_min' ? 'min' : 's';
  const tScale = xAxisMode === 'time_min' ? 1 / 60 : 1;
  const fmtT = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : (v * tScale).toFixed(tUnit === 'min' ? 1 : 0));

  /** The channel-dependent metric cells (Tt / t_LoD / 10% / Tm / Call / End RFU).
   *  Tt reads "—" unless threshold detection is enabled. */
  const renderMetrics = (
    r: { tt: number | null; tLod: number | null; tOnset10: number | null; tm: number | null; call: string; endRfu: number | undefined },
    bg?: string,
  ) => (
    <>
      <TableCell className="py-0.5 text-right" style={{ backgroundColor: bg }}>{thresholdEnabled && r.tt != null ? r.tt.toFixed(2) : '—'}</TableCell>
      <TableCell className="py-0.5 text-right" style={{ backgroundColor: bg }}>{fmtT(r.tLod)}</TableCell>
      <TableCell className="py-0.5 text-right" style={{ backgroundColor: bg }}>{fmtT(r.tOnset10)}</TableCell>
      <TableCell className="py-0.5 text-right" style={{ backgroundColor: bg }}>{r.tm != null ? r.tm.toFixed(1) + '°' : '—'}</TableCell>
      <TableCell className="py-0.5 text-center text-sm font-bold leading-none" style={{ backgroundColor: bg, color: CALL_COLORS[r.call] }}>
        {r.call === 'unset' ? '—' : r.call === 'positive' ? '+' : r.call === 'negative' ? '−' : '?'}
      </TableCell>
      <TableCell className="py-0.5 text-right" style={{ backgroundColor: bg }}>{r.endRfu != null ? Math.round(r.endRfu).toLocaleString() : '—'}</TableCell>
    </>
  );

  return (
    <div className="p-2 tabular-nums">
      <Table style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: COL_PCT.well }} />
          <col />
          <col style={{ width: COL_PCT.content }} />
          {multiChannel && <col style={{ width: '12%' }} />}
          <col style={{ width: COL_PCT.tt }} />
          <col style={{ width: COL_PCT.tlod }} />
          <col style={{ width: COL_PCT.tonset }} />
          <col style={{ width: COL_PCT.tm }} />
          <col style={{ width: COL_PCT.call }} />
          <col style={{ width: COL_PCT.endRfu }} />
        </colgroup>
        <TableHeader>
          <TableRow className="text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--brand-red-mid) 5%, transparent)' }}>
            <SortableHeader
              label="Well" sortKey="well" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} onResize={startResize('well')}
              prefix={multiChannel ? (
                <button
                  type="button"
                  className="shrink-0 mr-1 align-middle text-muted-foreground hover:text-foreground"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); toggleExpandAll(); }}
                  title={allExpanded ? 'Collapse all' : 'Expand all'}
                  aria-label={allExpanded ? 'Collapse all' : 'Expand all'}
                >
                  <ChevronDown className={`inline w-3 h-3 transition-transform ${allExpanded ? '' : '-rotate-90'}`} />
                </button>
              ) : undefined}
            />
            <SortableHeader label="Sample" sortKey="sample" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} onResize={startResize('sample')} />
            <SortableHeader label="Content" sortKey="content" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} onResize={startResize('content')} />
            {multiChannel && <TableHead className="py-1">Fluor</TableHead>}
            <SortableHeader label={ttLabel} sortKey="tt" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" onResize={startResize('tt')} />
            <SortableHeader label={`t_LoD (${tUnit})`} sortKey="tlod" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" onResize={startResize('tlod')} />
            <SortableHeader label={`10% (${tUnit})`} sortKey="tonset" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" onResize={startResize('tonset')} />
            <SortableHeader label="Tm" sortKey="tm" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" onResize={startResize('tm')} />
            <SortableHeader label="Call" sortKey="call" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-center" onResize={startResize('call')} />
            <SortableHeader label="End RFU" sortKey="endRfu" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {multiChannel ? (
            tree.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center text-muted-foreground text-xs py-2">No data loaded</TableCell>
              </TableRow>
            ) : (
              tree.map((node, i) => {
                const pSel = wellVisibleCurves(node.well).some((k) => selectedCurves.has(k));
                const single = node.children.length === 1;
                const isExp = single || expanded.has(node.well);
                const pBg = pSel ? SEL_BG : i % 2 === 1 ? 'var(--muted)' : undefined;
                // Single visible channel → show its values inline; otherwise the
                // parent's metric cells are blank (the channel values live on the
                // child rows).
                const pMetrics = single ? node.children[0] : { tt: null, tLod: null, tOnset10: null, tm: null, call: 'unset', endRfu: undefined };
                return (
                  <Fragment key={node.well}>
                    <TableRow
                      className="text-xs cursor-pointer hover:bg-accent"
                      onMouseDown={(e) => onParentSelect(e, node.well)}
                    >
                      <TableCell className="py-0.5 font-medium overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: node.color, backgroundColor: pBg, borderLeft: pSel ? '2.5px solid var(--brand-red-mid)' : undefined }}>
                        <span className="inline-flex items-center gap-1">
                          {!single ? (
                            <button
                              type="button"
                              className="shrink-0 text-muted-foreground hover:text-foreground"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(node.well); }}
                              title={isExp ? 'Collapse' : 'Expand'}
                              aria-label={isExp ? 'Collapse' : 'Expand'}
                            >
                              <ChevronDown className={`w-3 h-3 transition-transform ${isExp ? '' : '-rotate-90'}`} />
                            </button>
                          ) : <span className="w-2.5 shrink-0" />}
                          {node.well}
                        </span>
                      </TableCell>
                      <TableCell className="py-0.5 overflow-hidden text-ellipsis whitespace-nowrap" style={{ backgroundColor: pBg }}>{node.sample}</TableCell>
                      <TableCell className="py-0.5 overflow-hidden text-ellipsis whitespace-nowrap" style={{ backgroundColor: pBg }}>{node.displayType}</TableCell>
                      <TableCell className="py-0.5 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground" style={{ backgroundColor: pBg }}>
                        {single ? node.children[0].fluor : `${node.children.length} ch`}
                      </TableCell>
                      {renderMetrics(pMetrics, pBg)}
                    </TableRow>
                    {!single && isExp && node.children.map((c) => {
                      const cSel = selectedCurves.has(curveKey(node.well, c.channel!));
                      const cBg = cSel ? SEL_BG : undefined;
                      return (
                        <TableRow
                          key={`${node.well}:${c.channel}`}
                          className="text-xs cursor-pointer hover:bg-accent"
                          onMouseDown={(e) => onChildSelect(e, node.well, c.channel!)}
                        >
                          <TableCell className="py-0.5" style={{ backgroundColor: cBg, borderLeft: cSel ? '2.5px solid var(--brand-red-mid)' : undefined }} />
                          <TableCell className="py-0.5" style={{ backgroundColor: cBg }} />
                          <TableCell className="py-0.5" style={{ backgroundColor: cBg }} />
                          <TableCell className="py-0.5 pl-3 overflow-hidden text-ellipsis whitespace-nowrap" style={{ backgroundColor: cBg, color: c.color }}>{c.fluor}</TableCell>
                          {renderMetrics(c, cBg)}
                        </TableRow>
                      );
                    })}
                  </Fragment>
                );
              })
            )
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colCount} className="text-center text-muted-foreground text-xs py-2">No data loaded</TableCell>
            </TableRow>
          ) : (
            rows.map((row, i) => {
              const isSelected = selectedWells.has(row.well);
              const cellBg = isSelected ? SEL_BG : i % 2 === 1 ? 'var(--muted)' : undefined;
              return (
                <TableRow
                  key={row.well}
                  className="text-xs cursor-pointer hover:bg-accent"
                  onMouseDown={(e) => onRowMouseDown(e, row.well)}
                  onMouseEnter={() => onRowMouseEnter(row.well)}
                >
                  <TableCell className="py-0.5 font-medium overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: row.color, backgroundColor: cellBg, borderLeft: isSelected ? '2.5px solid var(--brand-red-mid)' : undefined }}>{row.well}</TableCell>
                  <TableCell className="py-0.5 overflow-hidden text-ellipsis whitespace-nowrap" style={{ backgroundColor: cellBg }}>{row.sample}</TableCell>
                  <TableCell className="py-0.5 overflow-hidden text-ellipsis whitespace-nowrap" style={{ backgroundColor: cellBg }}>{row.displayType}</TableCell>
                  {renderMetrics(row, cellBg)}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
