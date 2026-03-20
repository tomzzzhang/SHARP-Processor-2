import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { MAIN_PALETTE_NAMES, GRADIENT_PALETTE_NAMES, CONTENT_DISPLAY, getPaletteColors } from '@/lib/constants';
import type { ContentType } from '@/types/experiment';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
}

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: 'Unkn', label: 'Sample' },
  { value: 'Neg Ctrl', label: 'NTC' },
  { value: 'Pos Ctrl', label: '+ Ctrl' },
  { value: 'Std', label: 'Standard' },
  { value: 'NPC', label: 'NPC' },
];

const LINE_STYLES: { value: 'solid' | 'dash' | 'dot' | 'dashdot'; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dash', label: 'Dashed' },
  { value: 'dot', label: 'Dotted' },
  { value: 'dashdot', label: 'Dash-Dot' },
];

export function ContextMenu({ x, y, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<string | null>(null);
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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Adjust position so menu stays on screen
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 400),
    zIndex: 100,
  };

  const item = (label: string, action: () => void, disabled = false) => (
    <button
      key={label}
      className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40 disabled:cursor-default"
      disabled={disabled}
      onClick={() => { action(); onClose(); }}
    >
      {label}
    </button>
  );

  const sep = (key: string) => <div key={key} className="border-t my-0.5" />;

  const handleColorPick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'color';
    input.onchange = () => {
      setWellStyleOverride(wells, { color: input.value });
      onClose();
    };
    input.click();
  }, [wells, setWellStyleOverride, onClose]);

  const handleGroupPrompt = useCallback(() => {
    const name = prompt('Group name:');
    if (name) {
      setWellGroup(wells, name);
      onClose();
    }
  }, [wells, setWellGroup, onClose]);

  const applyPaletteToSelection = useCallback((paletteName: string) => {
    if (wells.length === 0) return;
    const colors = getPaletteColors(paletteName, wells.length);
    for (let i = 0; i < wells.length; i++) {
      setWellStyleOverride([wells[i]], { color: colors[i % colors.length] });
    }
  }, [wells, setWellStyleOverride]);

  const reverseSelectionColors = useCallback(() => {
    if (wells.length === 0) return;
    // Collect current colors, reverse, and re-apply
    const currentColors = wells.map((w) => {
      const ov = wellStyleOverrides.get(w) as { color?: string } | undefined;
      return ov?.color;
    });
    const reversed = [...currentColors].reverse();
    for (let i = 0; i < wells.length; i++) {
      if (reversed[i]) setWellStyleOverride([wells[i]], { color: reversed[i] });
    }
  }, [wells, wellStyleOverrides, setWellStyleOverride]);

  return (
    <div ref={ref} style={style} className="bg-background border rounded-md shadow-lg py-1 min-w-[200px]">
      {/* Header */}
      <div className="px-3 py-1 text-xs text-muted-foreground font-medium border-b mb-0.5">
        {n > 0 ? `${n} well${n > 1 ? 's' : ''} selected` : 'No wells selected'}
      </div>

      {/* Activation */}
      {item('Activate', () => activateWells(wells), n === 0)}
      {item('Deactivate', () => deactivateWells(wells), n === 0)}
      {sep('s1')}

      {/* Visibility */}
      {item('Show', () => showWells(wells), n === 0)}
      {item('Hide', () => hideWells(wells), n === 0)}
      {item('Deselect All', deselectAll)}
      {sep('s2')}

      {/* Sample Type submenu */}
      <div
        className="relative"
        onMouseEnter={() => setSubmenu('type')}
        onMouseLeave={() => setSubmenu(null)}
      >
        <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40" disabled={n === 0}>
          Sample Type &rarr;
        </button>
        {submenu === 'type' && n > 0 && (
          <div className="absolute left-full top-0 bg-background border rounded-md shadow-lg py-1 min-w-[120px]">
            {CONTENT_TYPES.map(({ value, label }) => (
              <button
                key={value}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                onClick={() => { setWellContentType(wells, value); onClose(); }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {sep('s3')}

      {/* Grouping */}
      {item('Group...', handleGroupPrompt, n === 0)}
      {item('Remove from Group', () => removeWellGroup(wells), n === 0)}
      {item('Auto-Group by Sample', () => { autoGroupBySample(); onClose(); })}
      {sep('s4')}

      {/* Style */}
      {item('Color...', handleColorPick, n === 0)}
      <div
        className="relative"
        onMouseEnter={() => setSubmenu('linestyle')}
        onMouseLeave={() => setSubmenu(null)}
      >
        <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40" disabled={n === 0}>
          Line Style &rarr;
        </button>
        {submenu === 'linestyle' && n > 0 && (
          <div className="absolute left-full top-0 bg-background border rounded-md shadow-lg py-1 min-w-[100px]">
            {LINE_STYLES.map(({ value, label }) => (
              <button
                key={value}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                onClick={() => { setWellStyleOverride(wells, { lineStyle: value }); onClose(); }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {item('Clear Style Overrides', () => clearWellStyleOverrides(wells), n === 0)}
      {item('Reverse Colors', reverseSelectionColors, n === 0)}
      {sep('s5')}

      {/* Palette submenu */}
      <div
        className="relative"
        onMouseEnter={() => setSubmenu('palette')}
        onMouseLeave={() => { if (submenu !== 'gradients') setSubmenu(null); }}
      >
        <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent">
          Palette &rarr;
        </button>
        {(submenu === 'palette' || submenu === 'gradients') && (
          <div
            className="absolute left-full top-0 bg-background border rounded-md shadow-lg py-1 min-w-[120px]"
            onMouseEnter={() => { if (submenu !== 'gradients') setSubmenu('palette'); }}
            onMouseLeave={() => setSubmenu(null)}
          >
            {MAIN_PALETTE_NAMES.map((p) => (
              <button
                key={p}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                onClick={() => { applyPaletteToSelection(p); onClose(); }}
              >
                {p}
              </button>
            ))}
            <div className="border-t my-1" />
            <div
              className="relative"
              onMouseEnter={() => setSubmenu('gradients')}
              onMouseLeave={() => setSubmenu('palette')}
            >
              <button className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent">
                Gradients &rarr;
              </button>
              {submenu === 'gradients' && (
                <div
                  className="absolute left-full top-0 bg-background border rounded-md shadow-lg py-1 min-w-[100px]"
                  onMouseLeave={() => setSubmenu('palette')}
                >
                  {GRADIENT_PALETTE_NAMES.map((p) => (
                    <button
                      key={p}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent"
                      onClick={() => { applyPaletteToSelection(p); onClose(); }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {sep('s6')}

      {/* Legend */}
      {item('Add to Legend', () => addToLegend(wells), n === 0)}
      {item('Remove from Legend', () => removeFromLegend(wells), n === 0)}
    </div>
  );
}

// Hook to manage context menu state
export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  return { menu, onContextMenu, close };
}
