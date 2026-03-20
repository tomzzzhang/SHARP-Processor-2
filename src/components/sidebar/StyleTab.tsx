import { useAppState } from '@/hooks/useAppState';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { FONT_FAMILIES, LEGEND_POSITIONS, MAIN_PALETTE_NAMES, GRADIENT_PALETTE_NAMES } from '@/lib/constants';

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
  const legendVisibleOnly = useAppState((s) => s.legendVisibleOnly);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const paletteGroupColors = useAppState((s) => s.paletteGroupColors);
  const showGrid = useAppState((s) => s.showGrid);
  const gridAlpha = useAppState((s) => s.gridAlpha);
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
  const setLegendVisibleOnly = useAppState((s) => s.setLegendVisibleOnly);
  const reversePalette = useAppState((s) => s.reversePalette);
  const setPaletteGroupColors = useAppState((s) => s.setPaletteGroupColors);
  const setShowGrid = useAppState((s) => s.setShowGrid);
  const setGridAlpha = useAppState((s) => s.setGridAlpha);
  const setFigureDpi = useAppState((s) => s.setFigureDpi);

  return (
    <div className="space-y-4">
      {/* Colors */}
      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-sm font-semibold px-1">Colors</legend>
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
          <Checkbox checked={paletteReversed} onCheckedChange={(v) => reversePalette()} />
          Reversed
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={paletteGroupColors} onCheckedChange={(v) => setPaletteGroupColors(v === true)} />
          Group coloring
        </label>
      </fieldset>

      {/* Lines */}
      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-sm font-semibold px-1">Lines</legend>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Width:</span>
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
      </fieldset>

      {/* Typography */}
      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-sm font-semibold px-1">Typography</legend>
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
        <div className="text-sm text-muted-foreground">Sizes:</div>
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
      </fieldset>

      {/* Legend */}
      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-sm font-semibold px-1">Legend</legend>
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
      </fieldset>

      {/* Grid */}
      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-sm font-semibold px-1">Grid</legend>
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
      </fieldset>

      {/* Figure */}
      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-sm font-semibold px-1">Figure</legend>
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
      </fieldset>

      {/* Presets */}
      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-sm font-semibold px-1">Presets</legend>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs">Save...</Button>
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs">Load...</Button>
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs">Reset</Button>
        </div>
      </fieldset>
    </div>
  );
}
