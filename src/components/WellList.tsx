import { useAppState } from '@/hooks/useAppState';
import { Checkbox } from '@/components/ui/checkbox';
import { useDragSelect } from '@/hooks/useDragSelect';
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CONTENT_DISPLAY, getPaletteColors } from '@/lib/constants';
import { effectiveChannelLabel, effectiveChannelColor } from '@/lib/channels';
import { curveKey, parseCurveKey } from '@/lib/curves';
import { FOCUS_RING } from '@/lib/ui-classes';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { ContentType } from '@/types/experiment';

const CONTENT_TYPES: ContentType[] = ['Unkn', 'Neg Ctrl', 'Pos Ctrl', 'Std', 'NPC', 'Neg', ''];

type SortKey = 'visible' | 'well' | 'sample' | 'type' | 'channel' | 'group';
type SortDir = 'asc' | 'desc';

/** Natural well order: row letter then column number. */
function naturalWell(a: string, b: string): number {
  const am = a.match(/^([A-Z])(\d+)$/);
  const bm = b.match(/^([A-Z])(\d+)$/);
  if (am && bm) return am[1].localeCompare(bm[1]) || (Number(am[2]) - Number(bm[2]));
  return a.localeCompare(b);
}

function InlineEdit({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const commit = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed !== value) onCommit(trimmed);
    else onCommit(value); // signal done without change
  }, [text, value, onCommit]);

  return (
    <input
      ref={inputRef}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); onCommit(value); }
      }}
      className={`w-full h-5 px-0.5 text-xs border border-primary rounded-sm bg-background outline-none ${FOCUS_RING}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    />
  );
}

/**
 * Content-type picker — a custom dropdown menu rather than a native
 * `<select>` (the native popup is unreliable in the desktop WebView).
 */
function ContentTypeMenu({
  anchor, value, onPick, onClose,
}: {
  anchor: DOMRect;
  value: ContentType;
  onPick: (t: ContentType) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const menuH = CONTENT_TYPES.length * 26 + 8;
  const top = anchor.bottom + 2 + menuH > window.innerHeight
    ? Math.max(4, anchor.top - menuH - 2)
    : anchor.bottom + 2;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[1000] min-w-[100px] rounded-md border bg-popover shadow-md py-1 text-xs"
      style={{ top, left: anchor.left }}
    >
      {CONTENT_TYPES.map((ct) => (
        <button
          key={ct}
          type="button"
          className={`block w-full text-left px-2 py-1 hover:bg-accent ${ct === value ? 'font-medium text-primary' : ''}`}
          onClick={() => { onPick(ct); onClose(); }}
        >
          {CONTENT_DISPLAY[ct] || ct || '(none)'}
        </button>
      ))}
    </div>,
    document.body,
  );
}

interface SCRow {
  key: string;        // curveKey(well, channel)
  well: string;
  channel: string;
  sample: string;
  content: ContentType;
  displayType: string;
  fluor: string;
  group: string;      // effective curve group ('' = none)
  color: string;
}

export function WellList() {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const selectedCurves = useAppState((s) => s.selectedCurves);
  const selectedWells = useAppState((s) => s.selectedWells);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const deactivatedWells = useAppState((s) => s.deactivatedWells);
  const visibleChannels = useAppState((s) => s.visibleChannels);
  const wellChannelHidden = useAppState((s) => s.wellChannelHidden);
  const toggleWellHidden = useAppState((s) => s.toggleWellHidden);
  const toggleWellChannel = useAppState((s) => s.toggleWellChannel);
  const selectCurvesOnly = useAppState((s) => s.selectCurvesOnly);
  const toggleCurves = useAppState((s) => s.toggleCurves);
  const setSelectedCurves = useAppState((s) => s.setSelectedCurves);
  const palette = useAppState((s) => s.palette);
  const wellGroups = useAppState((s) => s.wellGroups);
  const curveGroups = useAppState((s) => s.curveGroups);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const curveStyleOverrides = useAppState((s) => s.curveStyleOverrides);
  const setWellSampleName = useAppState((s) => s.setWellSampleName);
  const setWellSampleNameBatch = useAppState((s) => s.setWellSampleNameBatch);
  const setWellContentType = useAppState((s) => s.setWellContentType);
  const hoveredWell = useAppState((s) => s.hoveredWell);
  const setHoveredWell = useAppState((s) => s.setHoveredWell);
  const channelLabels = useAppState((s) => s.channelLabels);
  const channelColors = useAppState((s) => s.channelColors);
  const activeChannel = useAppState((s) => s.activeChannel);
  const viewMode = useAppState((s) => s.viewMode);
  const exp = experiments[idx];
  const channels = exp?.channels ?? [];
  const multiChannel = channels.length > 1 && viewMode === 'multi';

  const [sortKey, setSortKey] = useState<SortKey>('well');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return prevKey; }
      setSortDir('asc');
      return key;
    });
  }, []);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [typeEditKey, setTypeEditKey] = useState<string | null>(null);
  const [typeAnchor, setTypeAnchor] = useState<DOMRect | null>(null);

  // Base well→palette colour (group-aware), overlaid per-row by curve/well overrides.
  const wellColorMap = useMemo(() => {
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
    for (const [, members] of groupMembers) { const c = colors[ci % colors.length]; for (const w of members) m.set(w, c); ci++; }
    for (const w of ungrouped) { m.set(w, colors[ci % colors.length]); ci++; }
    return m;
  }, [exp, palette, wellGroups]);

  // Channels shown as rows: all channels in multichannel multi-view; otherwise
  // just the active (single) channel — so single-channel / single-view shows one
  // row per well exactly like v0.1.x.
  const rowChannels = useMemo(() => (
    multiChannel ? channels : (channels.includes(activeChannel) ? [activeChannel] : channels.slice(0, 1))
  ), [multiChannel, channels, activeChannel]);

  const rowVisible = useCallback((well: string, ch: string) => {
    if (hiddenWells.has(well)) return false;
    if (!multiChannel) return true;
    return visibleChannels.has(ch) && !(wellChannelHidden.get(well)?.has(ch));
  }, [hiddenWells, multiChannel, visibleChannels, wellChannelHidden]);

  const toggleRowVisible = useCallback((well: string, ch: string) => {
    if (!multiChannel) toggleWellHidden(well);   // single-channel / single-view: hide the well
    else toggleWellChannel([well], ch);          // multichannel: hide just that curve
  }, [multiChannel, toggleWellHidden, toggleWellChannel]);

  // Build + sort the flat list of S-C pairs.
  const rows = useMemo((): SCRow[] => {
    if (!exp) return [];
    const out: SCRow[] = [];
    for (const well of exp.wellsUsed) {
      if (deactivatedWells.has(well)) continue;   // empty wells aren't listed
      const info = exp.wells[well];
      for (const ch of rowChannels) {
        const key = curveKey(well, ch);
        const color = (curveStyleOverrides.get(key)?.color)
          ?? (wellStyleOverrides.get(well)?.color)
          ?? wellColorMap.get(well) ?? 'var(--muted-foreground)';
        out.push({
          key, well, channel: ch,
          sample: info?.sample ?? '',
          content: info?.content ?? '',
          displayType: CONTENT_DISPLAY[info?.content ?? ''] ?? info?.content ?? '',
          fluor: effectiveChannelLabel(ch, channelLabels, exp.channelFluorophore),
          group: curveGroups.get(key) ?? wellGroups.get(well) ?? '',
          color,
        });
      }
    }
    const chIndex = (c: string) => { const i = channels.indexOf(c); return i < 0 ? 1e9 : i; };
    const primary = (a: SCRow, b: SCRow): number => {
      switch (sortKey) {
        case 'visible': return (rowVisible(a.well, a.channel) ? 0 : 1) - (rowVisible(b.well, b.channel) ? 0 : 1);
        case 'well': return naturalWell(a.well, b.well);
        case 'sample': return a.sample.localeCompare(b.sample);
        case 'type': return a.displayType.localeCompare(b.displayType);
        case 'channel': return chIndex(a.channel) - chIndex(b.channel);
        case 'group': return (a.group || '~~~').localeCompare(b.group || '~~~'); // ungrouped last
      }
    };
    out.sort((a, b) => {
      let c = primary(a, b);
      if (sortDir === 'desc') c = -c;
      if (c === 0) {
        // Stable tiebreak (always ascending): channel sort → by well; else by channel then well.
        if (sortKey === 'channel') c = naturalWell(a.well, b.well);
        else if (sortKey === 'well') c = chIndex(a.channel) - chIndex(b.channel);
        else { c = naturalWell(a.well, b.well); if (c === 0) c = chIndex(a.channel) - chIndex(b.channel); }
      }
      return c;
    });
    return out;
  }, [exp, deactivatedWells, rowChannels, channels, wellColorMap, curveStyleOverrides, wellStyleOverrides, curveGroups, wellGroups, channelLabels, sortKey, sortDir, rowVisible]);

  const orderedKeys = useMemo(() => rows.map((r) => r.key), [rows]);
  const { onRowMouseDown, onRowMouseEnter } = useDragSelect(orderedKeys, {
    selectOnly: (k) => selectCurvesOnly([k]),
    toggleWellSelection: (k) => toggleCurves([k]),
    setSelectedWells: (set) => setSelectedCurves(set),
    selectedWells: selectedCurves,
  });

  if (!exp) {
    return <div className="p-3 text-sm text-muted-foreground">No data loaded</div>;
  }

  const arrow = (k: SortKey) => {
    if (sortKey !== k) return <span className="inline-block w-3 shrink-0" aria-hidden />;
    const Icon = sortDir === 'asc' ? ChevronUp : ChevronDown;
    return <Icon className="inline-block w-3 h-3 shrink-0" aria-hidden />;
  };
  const thHeader = (k: SortKey, label: string, className = '', title?: string) => (
    <th
      key={k}
      title={title}
      className={`px-1 py-1 text-left cursor-pointer select-none hover:text-foreground ${sortKey === k ? 'text-[var(--brand-red-dark)]' : ''} ${className}`}
      onClick={() => handleSort(k)}
    >
      <span className="inline-flex items-center gap-0.5 align-middle">{label}{arrow(k)}</span>
    </th>
  );

  return (
    <div className="text-xs">
      <table className="w-full">
        <thead className="sticky top-0 bg-background border-b">
          <tr className="text-muted-foreground">
            {thHeader('visible', 'L', 'w-7 text-center', 'Show on plot')}
            {thHeader('well', 'Well', 'w-10')}
            {thHeader('sample', 'Sample')}
            {thHeader('type', 'Type', 'w-10')}
            {multiChannel && thHeader('channel', 'Fluor')}
            {thHeader('group', 'Group')}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = selectedCurves.has(row.key);
            const isHidden = !rowVisible(row.well, row.channel);
            const isHovered = hoveredWell === row.well;
            const cColor = multiChannel
              ? effectiveChannelColor(row.channel, channelColors, channelLabels, exp.channelFluorophore)
              : undefined;

            const shadowParts: string[] = [];
            if (isSelected) shadowParts.push('inset 3px 0 0 var(--brand-red)');
            if (isHovered) shadowParts.push('inset 0 0 0 9999px color-mix(in srgb, var(--brand-red) 18%, transparent)');
            const boxShadow = shadowParts.length ? shadowParts.join(', ') : undefined;

            return (
              <tr
                key={row.key}
                className={`cursor-pointer ${isSelected ? 'bg-primary/10 font-medium' : 'hover:bg-accent'}`}
                style={{ height: 22, opacity: isHidden ? 0.4 : 1, boxShadow }}
                onMouseDown={(e) => onRowMouseDown(e, row.key)}
                onMouseEnter={() => { onRowMouseEnter(row.key); setHoveredWell(row.well); }}
                onMouseLeave={() => { if (hoveredWell === row.well) setHoveredWell(null); }}
              >
                <td className="px-1 py-0 text-center" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={!isHidden}
                    onCheckedChange={() => toggleRowVisible(row.well, row.channel)}
                    className="h-3 w-3"
                  />
                </td>
                <td className="px-1 py-0 font-medium tabular-nums" style={{ color: row.color }}>
                  {row.well}
                </td>
                <td
                  className="px-1 py-0 truncate max-w-[120px] cursor-text hover:border-b hover:border-dashed hover:border-muted-foreground/50 transition-all duration-100"
                  onClick={(e) => { e.stopPropagation(); setEditingKey(row.key); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Click to edit"
                >
                  {editingKey === row.key ? (
                    <InlineEdit
                      value={row.sample}
                      onCommit={(v) => {
                        if (v !== row.sample) {
                          if (selectedWells.has(row.well) && selectedWells.size > 1) {
                            setWellSampleNameBatch(Array.from(selectedWells), v);
                          } else {
                            setWellSampleName(row.well, v);
                          }
                        }
                        setEditingKey(null);
                      }}
                    />
                  ) : (
                    row.sample
                  )}
                </td>
                <td
                  className={`px-1 py-0 cursor-pointer hover:bg-accent/60 rounded-sm group/type ${typeEditKey === row.key ? 'bg-accent' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeEditKey === row.key) {
                      setTypeEditKey(null);
                    } else {
                      setTypeAnchor(e.currentTarget.getBoundingClientRect());
                      setTypeEditKey(row.key);
                    }
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Click to change type"
                >
                  <span className="flex items-center gap-0.5">
                    {row.displayType}
                    <ChevronDown className="w-2.5 h-2.5 opacity-0 group-hover/type:opacity-40 shrink-0" />
                  </span>
                </td>
                {multiChannel && (
                  <td className="px-1 py-0 truncate max-w-[90px] font-medium" style={{ color: cColor }}>
                    {row.fluor}
                  </td>
                )}
                <td className="px-1 py-0 truncate max-w-[80px] text-muted-foreground">
                  {row.group}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {typeEditKey && typeAnchor && (() => {
        const w = parseCurveKey(typeEditKey).well;
        const info = exp.wells[w];
        if (!info) return null;
        return (
          <ContentTypeMenu
            anchor={typeAnchor}
            value={info.content}
            onPick={(t) => setWellContentType(
              selectedWells.has(w) && selectedWells.size > 1 ? Array.from(selectedWells) : [w],
              t,
            )}
            onClose={() => setTypeEditKey(null)}
          />
        );
      })()}
    </div>
  );
}
