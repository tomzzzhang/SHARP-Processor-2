import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { FONT_FAMILIES, LEGEND_POSITIONS, MAIN_PALETTE_NAMES, GRADIENT_PALETTE_NAMES } from '@/lib/constants';
import { CollapsibleSection } from './CollapsibleSection';
import {
  listStylePresets, getStylePreset, saveStylePreset, deleteStylePreset,
  type StyleSnapshot,
} from '@/lib/style-presets';

export function StyleTab() {
  const palette = useAppState((s) => s.palette);
  const lineWidth = useAppState((s) => s.lineWidth);
  const fontFamily = useAppState((s) => s.fontFamily);
  const titleSize = useAppState((s) => s.titleSize);
  const labelSize = useAppState((s) => s.labelSize);
  const tickSize = useAppState((s) => s.tickSize);
  const legendSize = useAppState((s) => s.legendSize);
  const showLegend = useAppState((s) => s.showLegend);
  const showLegendAmp = useAppState((s) => s.showLegendAmp);
  const showLegendMelt = useAppState((s) => s.showLegendMelt);
  const showLegendDoubling = useAppState((s) => s.showLegendDoubling);
  const legendPosition = useAppState((s) => s.legendPosition);
  const legendContent = useAppState((s) => s.legendContent);
  const legendVisibleOnly = useAppState((s) => s.legendVisibleOnly);
  const legendOrder = useAppState((s) => s.legendOrder);
  const setLegendOrder = useAppState((s) => s.setLegendOrder);
  const showTitle = useAppState((s) => s.showTitle);
  const setShowTitle = useAppState((s) => s.setShowTitle);

  // Current visible wells + groups — used to build the reorder list so
  // the user can drag the legend entries that actually exist.
  const experiments = useAppState((s) => s.experiments);
  const activeIdx = useAppState((s) => s.activeExperimentIndex);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const wellGroups = useAppState((s) => s.wellGroups);
  const activeExp = experiments[activeIdx];

  /** Current legend entries in their effective display order. Each
   *  entry has a stable `key` matching what PlotArea uses for
   *  `legendgroup`, so reordering here matches what Plotly renders. */
  const legendEntries = useMemo(() => {
    if (!activeExp) return [] as { key: string; label: string }[];
    const visible = activeExp.wellsUsed.filter((w) => !hiddenWells.has(w));
    const seen = new Set<string>();
    const raw: { key: string; label: string }[] = [];
    for (const well of visible) {
      let key: string, label: string;
      if (legendContent === 'group') {
        const g = wellGroups.get(well);
        if (g) { key = `grp:${g}`; label = g; }
        else { key = `well:${well}`; label = activeExp.wells[well]?.sample ?? well; }
      } else if (legendContent === 'sample') {
        key = `well:${well}`; label = activeExp.wells[well]?.sample ?? well;
      } else {
        key = `well:${well}`; label = well;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      raw.push({ key, label });
    }
    // Sort by legendOrder rank (entries in the order array first, in
    // that order; everything else follows in natural order).
    const rank = new Map<string, number>();
    legendOrder.forEach((k, i) => rank.set(k, i));
    raw.sort((a, b) => {
      const ra = rank.get(a.key);
      const rb = rank.get(b.key);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return 0;
    });
    return raw;
  }, [activeExp, hiddenWells, wellGroups, legendContent, legendOrder]);

  // Pointer-event reorder (HTML5 drag is intercepted by the Tauri
  // webview as a file drop, so we handle mousedown/move/up manually).
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropOverKey, setDropOverKey] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());
  const dragKeyRef = useRef<string | null>(null);
  const dropOverKeyRef = useRef<string | null>(null);
  dragKeyRef.current = dragKey;
  dropOverKeyRef.current = dropOverKey;

  const handleReorder = useCallback((fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const keys = legendEntries.map((e) => e.key);
    const fromIdx = keys.indexOf(fromKey);
    const toIdx = keys.indexOf(toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...keys];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setLegendOrder(reordered);
  }, [legendEntries, setLegendOrder]);

  const handleResetLegendOrder = useCallback(() => {
    setLegendOrder([]);
  }, [setLegendOrder]);

  const startDrag = useCallback((key: string, e: React.PointerEvent) => {
    e.preventDefault();
    setDragKey(key);

    const onMove = (ev: PointerEvent) => {
      // Hit-test the row refs by Y coordinate.
      let hit: string | null = null;
      for (const [k, el] of rowRefs.current) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
          hit = k;
          break;
        }
      }
      if (hit !== dropOverKeyRef.current) setDropOverKey(hit);
    };

    const onUp = () => {
      const from = dragKeyRef.current;
      const to = dropOverKeyRef.current;
      if (from && to) handleReorder(from, to);
      setDragKey(null);
      setDropOverKey(null);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }, [handleReorder]);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const paletteGroupColors = useAppState((s) => s.paletteGroupColors);
  const showGrid = useAppState((s) => s.showGrid);
  const gridAlpha = useAppState((s) => s.gridAlpha);
  const plotBgColor = useAppState((s) => s.plotBgColor);
  const figureDpi = useAppState((s) => s.figureDpi);

  const setPalette = useAppState((s) => s.setPalette);
  const setLineWidth = useAppState((s) => s.setLineWidth);
  const setFontFamily = useAppState((s) => s.setFontFamily);
  const setTitleSize = useAppState((s) => s.setTitleSize);
  const setLabelSize = useAppState((s) => s.setLabelSize);
  const setTickSize = useAppState((s) => s.setTickSize);
  const setLegendSize = useAppState((s) => s.setLegendSize);
  const setShowLegend = useAppState((s) => s.setShowLegend);
  const setShowLegendAmp = useAppState((s) => s.setShowLegendAmp);
  const setShowLegendMelt = useAppState((s) => s.setShowLegendMelt);
  const setShowLegendDoubling = useAppState((s) => s.setShowLegendDoubling);
  const setLegendPosition = useAppState((s) => s.setLegendPosition);
  const setLegendContent = useAppState((s) => s.setLegendContent);
  const setLegendVisibleOnly = useAppState((s) => s.setLegendVisibleOnly);
  const reversePalette = useAppState((s) => s.reversePalette);
  const setPaletteGroupColors = useAppState((s) => s.setPaletteGroupColors);
  const setShowGrid = useAppState((s) => s.setShowGrid);
  const setGridAlpha = useAppState((s) => s.setGridAlpha);
  const setPlotBgColor = useAppState((s) => s.setPlotBgColor);
  const setFigureDpi = useAppState((s) => s.setFigureDpi);
  const resetStyle = useAppState((s) => s.resetStyle);
  const applyStyleSnapshot = useAppState((s) => s.applyStyleSnapshot);

  // Preset management
  const [presetNames, setPresetNames] = useState<string[]>(() => listStylePresets());
  const refreshPresets = useCallback(() => setPresetNames(listStylePresets()), []);

  // Keep the dropdown fresh if another component writes to localStorage.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'sharp-processor-style-presets') refreshPresets();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshPresets]);

  const handleSavePreset = useCallback(() => {
    const name = prompt('Save current style as preset:\n\nEnter a name:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (presetNames.includes(trimmed)) {
      if (!confirm(`Preset "${trimmed}" already exists. Overwrite?`)) return;
    }
    const snapshot: StyleSnapshot = {
      palette, paletteReversed, paletteGroupColors,
      lineWidth, fontFamily,
      titleSize, labelSize, tickSize, legendSize,
      showLegend, showLegendAmp, showLegendMelt, showLegendDoubling,
      legendPosition, legendContent, legendVisibleOnly,
      showTitle,
      showGrid, gridAlpha, plotBgColor, figureDpi,
    };
    saveStylePreset(trimmed, snapshot);
    refreshPresets();
  }, [palette, paletteReversed, paletteGroupColors, lineWidth, fontFamily, titleSize, labelSize, tickSize, legendSize, showLegend, showLegendAmp, showLegendMelt, showLegendDoubling, legendPosition, legendContent, legendVisibleOnly, showTitle, showGrid, gridAlpha, plotBgColor, figureDpi, presetNames, refreshPresets]);

  const handleLoadPreset = useCallback((name: string) => {
    if (!name) return;
    const snapshot = getStylePreset(name);
    if (!snapshot) {
      alert(`Preset "${name}" not found.`);
      refreshPresets();
      return;
    }
    applyStyleSnapshot(snapshot);
  }, [applyStyleSnapshot, refreshPresets]);

  const handleDeletePreset = useCallback((name: string) => {
    if (!name) return;
    if (!confirm(`Delete preset "${name}"?`)) return;
    deleteStylePreset(name);
    refreshPresets();
  }, [refreshPresets]);

  const handleResetStyle = useCallback(() => {
    if (!confirm('Reset all style settings to defaults?\n\nThis will change palette, fonts, line width, legend, grid, and DPI.')) return;
    resetStyle();
  }, [resetStyle]);

  return (
    <div className="space-y-3">
      <CollapsibleSection title="Colors & Lines">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Palette:</span>
          <select
            value={palette}
            onChange={(e) => setPalette(e.target.value)}
            className="flex-1 h-7 border rounded px-1 text-sm bg-background"
          >
            {MAIN_PALETTE_NAMES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
            <optgroup label="Gradients">
              {GRADIENT_PALETTE_NAMES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={paletteReversed} onCheckedChange={() => reversePalette()} />
          Reversed
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={paletteGroupColors} onCheckedChange={(v) => setPaletteGroupColors(v === true)} />
          Group coloring
        </label>

        <div className="border-t pt-2 mt-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Line width:</span>
            <input
              type="number"
              min={0.3}
              max={5.0}
              step={0.1}
              value={lineWidth}
              onChange={(e) => setLineWidth(Number(e.target.value))}
              className="w-16 h-7 border rounded px-1 text-sm text-center"
            />
            <span className="text-muted-foreground">pt</span>
          </div>
        </div>

        <div className="border-t pt-2 mt-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Plot bg:</span>
            <input
              type="color"
              value={plotBgColor || '#fafafa'}
              onChange={(e) => setPlotBgColor(e.target.value)}
              className="w-7 h-7 border rounded cursor-pointer p-0"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={() => setPlotBgColor('')}
            >
              Auto
            </Button>
            {plotBgColor && (
              <span className="text-xs text-muted-foreground">{plotBgColor}</span>
            )}
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Typography" defaultOpen={false}>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={showTitle} onCheckedChange={(v) => setShowTitle(v === true)} />
          Show plot title
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Font:</span>
          <select
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            className="flex-1 h-7 border rounded px-1 text-sm bg-background"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        <div className="text-xs text-muted-foreground font-medium">Sizes:</div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-1">
            <span>Title:</span>
            <input type="number" min={6} max={24} value={titleSize}
              onChange={(e) => setTitleSize(Number(e.target.value))}
              className="w-12 h-7 border rounded px-1 text-center text-sm" />
          </div>
          <div className="flex items-center gap-1">
            <span>Labels:</span>
            <input type="number" min={6} max={24} value={labelSize}
              onChange={(e) => setLabelSize(Number(e.target.value))}
              className="w-12 h-7 border rounded px-1 text-center text-sm" />
          </div>
          <div className="flex items-center gap-1">
            <span>Ticks:</span>
            <input type="number" min={6} max={20} value={tickSize}
              onChange={(e) => setTickSize(Number(e.target.value))}
              className="w-12 h-7 border rounded px-1 text-center text-sm" />
          </div>
          <div className="flex items-center gap-1">
            <span>Legend:</span>
            <input type="number" min={6} max={20} value={legendSize}
              onChange={(e) => setLegendSize(Number(e.target.value))}
              className="w-12 h-7 border rounded px-1 text-center text-sm" />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Legend">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={showLegend} onCheckedChange={(v) => setShowLegend(v === true)} />
          Show legend
        </label>
        <div className="ml-6 space-y-1">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={showLegendAmp} onCheckedChange={(v) => setShowLegendAmp(v === true)} disabled={!showLegend} />
            Amplification
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={showLegendMelt} onCheckedChange={(v) => setShowLegendMelt(v === true)} disabled={!showLegend} />
            Melt
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={showLegendDoubling} onCheckedChange={(v) => setShowLegendDoubling(v === true)} disabled={!showLegend} />
            Doubling Time
          </label>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Content:</span>
          <select
            value={legendContent}
            onChange={(e) => setLegendContent(e.target.value as 'well' | 'sample' | 'group')}
            className="flex-1 h-7 border rounded px-1 text-sm bg-background"
          >
            <option value="sample">Sample</option>
            <option value="well">Well</option>
            <option value="group">Group (one entry per group)</option>
          </select>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Position:</span>
          <select
            value={legendPosition}
            onChange={(e) => setLegendPosition(e.target.value)}
            className="flex-1 h-7 border rounded px-1 text-sm bg-background"
          >
            {LEGEND_POSITIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={legendVisibleOnly} onCheckedChange={(v) => setLegendVisibleOnly(v === true)} />
          Visible wells only
        </label>

        {activeExp && legendEntries.length > 1 && (
          <div className="pt-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Order (drag to reorder)</span>
              {legendOrder.length > 0 && (
                <button
                  className="text-[10px] text-muted-foreground hover:text-foreground underline"
                  onClick={handleResetLegendOrder}
                  title="Revert to natural order"
                >
                  reset
                </button>
              )}
            </div>
            <div className="border rounded overflow-hidden">
              {legendEntries.map((entry) => {
                const isDragging = dragKey === entry.key;
                const isOver = dropOverKey === entry.key && dragKey !== entry.key;
                return (
                  <div
                    key={entry.key}
                    ref={(el) => { rowRefs.current.set(entry.key, el); }}
                    onPointerDown={(e) => startDrag(entry.key, e)}
                    className={`flex items-center gap-2 px-2 py-1 text-xs select-none cursor-grab active:cursor-grabbing border-b border-border last:border-b-0 touch-none ${isDragging ? 'opacity-40' : ''} ${isOver ? 'bg-accent' : 'hover:bg-muted/40'}`}
                    title={entry.key}
                  >
                    <span className="text-muted-foreground">⋮⋮</span>
                    <span className="flex-1 truncate">{entry.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Grid & Export" defaultOpen={false}>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={showGrid} onCheckedChange={(v) => setShowGrid(v === true)} />
          Show grid lines
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Opacity:</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={gridAlpha}
            onChange={(e) => setGridAlpha(Number(e.target.value))}
            className="w-16 h-7 border rounded px-1 text-sm text-center"
          />
        </div>

        <div className="border-t pt-2 mt-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">DPI:</span>
            <input
              type="number"
              min={72}
              max={600}
              step={50}
              value={figureDpi}
              onChange={(e) => setFigureDpi(Number(e.target.value))}
              className="w-16 h-7 border rounded px-1 text-sm text-center"
            />
            <span className="text-xs text-muted-foreground">(for export)</span>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Presets" defaultOpen={false}>
        <div className="space-y-2">
          {presetNames.length > 0 ? (
            <div className="flex items-center gap-1">
              <select
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) handleLoadPreset(v);
                  e.target.value = '';
                }}
                className="flex-1 h-7 border rounded px-1 text-xs bg-background"
              >
                <option value="">Load preset…</option>
                {presetNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <select
                defaultValue=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) handleDeletePreset(v);
                  e.target.value = '';
                }}
                className="h-7 border rounded px-1 text-xs bg-background"
                title="Delete a preset"
              >
                <option value="">✕</option>
                {presetNames.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              No saved presets. Adjust styles and click Save to store one.
            </p>
          )}
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={handleSavePreset}>
              Save…
            </Button>
            <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={handleResetStyle}>
              Reset
            </Button>
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
}
