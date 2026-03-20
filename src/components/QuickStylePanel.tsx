import { useCallback, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { Button } from '@/components/ui/button';
import { MAIN_PALETTE_NAMES, GRADIENT_PALETTE_NAMES, getPaletteColors } from '@/lib/constants';
import type { ContentType } from '@/types/experiment';

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

  const selectedWells = useAppState((s) => s.selectedWells);
  const showWells = useAppState((s) => s.showWells);
  const hideWells = useAppState((s) => s.hideWells);
  const activateWells = useAppState((s) => s.activateWells);
  const deactivateWells = useAppState((s) => s.deactivateWells);
  const deselectAll = useAppState((s) => s.deselectAll);
  const setWellContentType = useAppState((s) => s.setWellContentType);
  const setWellStyleOverride = useAppState((s) => s.setWellStyleOverride);
  const clearWellStyleOverrides = useAppState((s) => s.clearWellStyleOverrides);
  const setWellGroup = useAppState((s) => s.setWellGroup);
  const removeWellGroup = useAppState((s) => s.removeWellGroup);
  const autoGroupBySample = useAppState((s) => s.autoGroupBySample);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const addToLegend = useAppState((s) => s.addToLegend);
  const removeFromLegend = useAppState((s) => s.removeFromLegend);

  const wells = [...selectedWells];
  const n = wells.length;

  const handleColorPick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'color';
    input.onchange = () => {
      setWellStyleOverride(wells, { color: input.value });
    };
    input.click();
  }, [wells, setWellStyleOverride]);

  const handleGroup = useCallback(() => {
    const name = prompt('Group name:');
    if (name) setWellGroup(wells, name);
  }, [wells, setWellGroup]);

  const applyPaletteToSelection = useCallback((paletteName: string) => {
    if (wells.length === 0) return;
    const colors = getPaletteColors(paletteName, wells.length);
    for (let i = 0; i < wells.length; i++) {
      setWellStyleOverride([wells[i]], { color: colors[i % colors.length] });
    }
  }, [wells, setWellStyleOverride]);

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

  const btn = (label: string, action: () => void, disabled = false) => (
    <Button
      variant="outline"
      size="sm"
      className="w-full h-6 text-[10px] justify-start"
      disabled={disabled}
      onClick={action}
    >
      {label}
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
          className="text-[10px] font-bold text-muted-foreground tracking-widest"
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

          {/* Activation */}
          <div className="space-y-0.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase">Activation</div>
            {btn('Activate', () => activateWells(wells), n === 0)}
            {btn('Deactivate', () => deactivateWells(wells), n === 0)}
          </div>

          {/* Visibility */}
          <div className="space-y-0.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase">Visibility</div>
            {btn('Show', () => showWells(wells), n === 0)}
            {btn('Hide', () => hideWells(wells), n === 0)}
            {btn('Deselect All', deselectAll)}
          </div>

          {/* Sample Type */}
          <div className="space-y-0.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase">Sample Type</div>
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
          </div>

          {/* Grouping */}
          <div className="space-y-0.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase">Grouping</div>
            {btn('Group...', handleGroup, n === 0)}
            {btn('Ungroup', () => removeWellGroup(wells), n === 0)}
            {btn('Auto-Group by Sample', autoGroupBySample)}
          </div>

          {/* Style */}
          <div className="space-y-0.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase">Style</div>
            {btn('Color...', handleColorPick, n === 0)}
            {btn('Reverse Colors', reverseSelectionColors, n === 0)}
            {btn('Clear Overrides', () => clearWellStyleOverrides(wells), n === 0)}
          </div>

          {/* Palette */}
          <div className="space-y-0.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase">Palette</div>
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
          </div>

          {/* Legend */}
          <div className="space-y-0.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase">Legend</div>
            {btn('Add to Legend', () => addToLegend(wells), n === 0)}
            {btn('Remove from Legend', () => removeFromLegend(wells), n === 0)}
          </div>
        </div>
      )}
    </div>
  );
}
