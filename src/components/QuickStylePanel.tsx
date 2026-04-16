import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import { Button } from '@/components/ui/button';
import { MAIN_PALETTE_NAMES, GRADIENT_PALETTE_NAMES, MOD_KEY, getPaletteColors } from '@/lib/constants';
import { InlineColorPicker } from '@/components/ui/color-picker';
import type { ContentType } from '@/types/experiment';

function PanelSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        className="w-full flex items-center justify-between text-[10px] font-semibold text-foreground/70 uppercase cursor-pointer hover:text-foreground transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{title}</span>
        <svg
          className={`h-2.5 w-2.5 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
          viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        >
          <path d="M3 4.5 L6 7.5 L9 4.5" />
        </svg>
      </button>
      {open && children}
    </div>
  );
}

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: 'Unkn', label: 'Sample' },
  { value: 'Neg Ctrl', label: 'NTC' },
  { value: 'Pos Ctrl', label: '+ Ctrl' },
  { value: 'Std', label: 'Standard' },
  { value: 'NPC', label: 'NPC' },
];

export function QuickStylePanel() {
  const [expanded, setExpanded] = useState(false);
  const [selectedType, setSelectedType] = useState<ContentType>('Unkn');

  // Trigger Plotly resize when panel expands/collapses
  useEffect(() => {
    const timer = setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    return () => clearTimeout(timer);
  }, [expanded]);

  const selectedWells = useAppState((s) => s.selectedWells);
  const showWells = useAppState((s) => s.showWells);
  const hideWells = useAppState((s) => s.hideWells);
  const deselectAll = useAppState((s) => s.deselectAll);
  const setWellContentType = useAppState((s) => s.setWellContentType);
  const setWellStyleOverride = useAppState((s) => s.setWellStyleOverride);
  const clearWellStyleOverrides = useAppState((s) => s.clearWellStyleOverrides);
  const setWellGroup = useAppState((s) => s.setWellGroup);
  const removeWellGroup = useAppState((s) => s.removeWellGroup);
  const autoGroupBySample = useAppState((s) => s.autoGroupBySample);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const wellBaselineOverrides = useAppState((s) => s.wellBaselineOverrides);
  const baselineAuto = useAppState((s) => s.baselineAuto);
  const setWellBaselineOverride = useAppState((s) => s.setWellBaselineOverride);
  const clearWellBaselineOverrides = useAppState((s) => s.clearWellBaselineOverrides);
  const wellGroups = useAppState((s) => s.wellGroups);
  const selectionPaletteGroupColors = useAppState((s) => s.selectionPaletteGroupColors);
  const setSelectionPaletteGroupColors = useAppState((s) => s.setSelectionPaletteGroupColors);
  const analysisResults = useAnalysisResults();
  const addToLegend = useAppState((s) => s.addToLegend);
  const removeFromLegend = useAppState((s) => s.removeFromLegend);

  const wells = [...selectedWells];
  const n = wells.length;

  const selectionAutoState: 'on' | 'off' | 'mixed' | null = (() => {
    if (n === 0) return null;
    let anyOn = false, anyOff = false;
    for (const w of wells) {
      const ov = wellBaselineOverrides.get(w);
      const effective = ov?.auto ?? baselineAuto;
      if (effective) anyOn = true; else anyOff = true;
      if (anyOn && anyOff) return 'mixed';
    }
    return anyOn ? 'on' : 'off';
  })();

  const handleGroup = useCallback(() => {
    const name = prompt('Group name:');
    if (name) setWellGroup(wells, name);
  }, [wells, setWellGroup]);

  const applyPaletteToSelection = useCallback((paletteName: string) => {
    if (wells.length === 0) return;
    const units: [number, string[]][] = [];
    if (selectionPaletteGroupColors) {
      const groupMembers = new Map<string, string[]>();
      const ungrouped: string[] = [];
      const seenGroups = new Set<string>();
      for (const well of wells) {
        const group = wellGroups.get(well);
        if (group) {
          if (!seenGroups.has(group)) { seenGroups.add(group); groupMembers.set(group, []); }
          groupMembers.get(group)!.push(well);
        } else {
          ungrouped.push(well);
        }
      }
      for (const [, members] of groupMembers) {
        let sum = 0, count = 0;
        for (const w of members) { const tt = analysisResults.get(w)?.tt; if (tt != null) { sum += tt; count++; } }
        units.push([count > 0 ? sum / count : Infinity, members]);
      }
      for (const well of ungrouped) { units.push([analysisResults.get(well)?.tt ?? Infinity, [well]]); }
    } else {
      for (const well of wells) { units.push([analysisResults.get(well)?.tt ?? Infinity, [well]]); }
    }
    units.sort((a, b) => a[0] - b[0]);
    const colors = getPaletteColors(paletteName, units.length);
    for (let i = 0; i < units.length; i++) {
      const color = colors[i % colors.length];
      for (const well of units[i][1]) setWellStyleOverride([well], { color });
    }
  }, [wells, wellGroups, analysisResults, selectionPaletteGroupColors, setWellStyleOverride]);

  const reverseSelectionColors = useCallback(() => {
    if (wells.length === 0) return;
    const currentColors = wells.map((w) => {
      const ov = wellStyleOverrides.get(w) as { color?: string } | undefined;
      return ov?.color;
    });
    const reversed = [...currentColors].reverse();
    for (let i = 0; i < wells.length; i++) {
      if (reversed[i]) setWellStyleOverride([wells[i]], { color: reversed[i] });
    }
  }, [wells, wellStyleOverrides, setWellStyleOverride]);

  const btn = (label: string, action: () => void, disabled = false, shortcut?: string) => (
    <Button
      variant="outline"
      size="sm"
      className="w-full h-6 text-[10px] justify-between"
      disabled={disabled}
      onClick={action}
    >
      <span>{label}</span>
      {shortcut && <span className="text-muted-foreground text-[8px] ml-1">{shortcut}</span>}
    </Button>
  );

  return (
    <div className="flex shrink-0 border-l bg-background">
      {/* Toggle button */}
      <button
        className="w-5 flex items-center justify-center hover:bg-accent cursor-pointer border-r"
        onClick={() => setExpanded(!expanded)}
        title={expanded ? 'Collapse panel' : 'Expand panel'}
      >
        <span
          className="text-[10px] font-bold text-[var(--brand-red-dark)] tracking-widest"
          style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
        >
          MENU
        </span>
      </button>

      {/* Panel content */}
      {expanded && (
        <div className="w-[160px] overflow-y-auto p-2 space-y-2 text-xs">
          <div className="font-semibold text-muted-foreground">Quick Actions</div>
          <div className="text-[10px] text-muted-foreground">
            {n > 0 ? `${n} well${n > 1 ? 's' : ''} selected` : 'No selection'}
          </div>

          {/* Visibility */}
          <PanelSection title="Visibility">
            {btn('Show', () => showWells(wells), n === 0, `${MOD_KEY}+H`)}
            {btn('Hide', () => hideWells(wells), n === 0, `${MOD_KEY}+H`)}
            {btn('Deselect All', deselectAll)}
          </PanelSection>

          {/* Sample Type */}
          <PanelSection title="Sample Type">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as ContentType)}
              className="w-full h-6 text-[10px] border rounded px-1 bg-background"
            >
              {CONTENT_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {btn('Apply Type', () => setWellContentType(wells, selectedType), n === 0)}
          </PanelSection>

          {/* Grouping */}
          <PanelSection title="Grouping">
            {btn('Group...', handleGroup, n === 0, `${MOD_KEY}+G`)}
            {btn('Ungroup', () => removeWellGroup(wells), n === 0, `${MOD_KEY}+⇧+G`)}
            {btn('Auto-Group by Sample', autoGroupBySample)}
          </PanelSection>

          {/* Style */}
          <PanelSection title="Style">
            {n > 0 && (
              <InlineColorPicker
                onChange={(c) => setWellStyleOverride(wells, { color: c })}
              />
            )}
            {btn('Clear Overrides', () => clearWellStyleOverrides(wells), n === 0)}
          </PanelSection>

          {/* Palette */}
          <PanelSection title="Palette" defaultOpen={false}>
            <label className="flex items-center gap-1.5 text-[10px] py-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={selectionPaletteGroupColors}
                onChange={(e) => setSelectionPaletteGroupColors(e.target.checked)}
                className="h-3 w-3"
              />
              Group coloring
            </label>
            <div className="max-h-[140px] overflow-y-auto border rounded">
              {MAIN_PALETTE_NAMES.map((p) => (
                <button
                  key={p}
                  className="w-full text-left px-2 py-0.5 text-[10px] hover:bg-accent"
                  onClick={() => applyPaletteToSelection(p)}
                >
                  {p}
                </button>
              ))}
              <div className="border-t mx-1 my-0.5" />
              <div className="px-2 py-0.5 text-[9px] font-medium text-muted-foreground uppercase">Gradients</div>
              {GRADIENT_PALETTE_NAMES.map((p) => (
                <button
                  key={p}
                  className="w-full text-left px-2 py-0.5 text-[10px] hover:bg-accent pl-4"
                  onClick={() => applyPaletteToSelection(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            {btn('Reverse Colors', reverseSelectionColors, n === 0)}
          </PanelSection>

          {/* Baseline */}
          <PanelSection title="Baseline">
            {btn(
              `${selectionAutoState === 'on' ? '✓ ' : ''}Auto`,
              () => setWellBaselineOverride(wells, { auto: true }),
              n === 0,
            )}
            {btn(
              `${selectionAutoState === 'off' ? '✓ ' : ''}Manual`,
              () => setWellBaselineOverride(wells, { auto: false }),
              n === 0,
            )}
            {btn('Follow Default', () => clearWellBaselineOverrides(wells), n === 0)}
          </PanelSection>

          {/* Legend */}
          <PanelSection title="Legend">
            {btn('Add to Legend', () => addToLegend(wells), n === 0)}
            {btn('Remove from Legend', () => removeFromLegend(wells), n === 0)}
          </PanelSection>
        </div>
      )}
    </div>
  );
}
