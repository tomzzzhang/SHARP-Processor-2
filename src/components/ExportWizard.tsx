/**
 * Export Wizard — a floating modal that lets the user pick a plot type,
 * size, DPI, and format; previews the figure at its true export size
 * (scaled visually to fit the preview pane); and renders a pixel-perfect
 * output via Plotly.toImage on an offscreen Plotly instance.
 *
 * The preview mirrors the main app's style state (palette, fonts, line
 * widths, legend, grid, background), so tweaks in the Style tab update
 * the preview live. Size, DPI, format, and plot-type selection are
 * local to the wizard (transient).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import _createPlotlyComponent from 'react-plotly.js/factory';
import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import { buildFigure, type PlotType, type PlotFigureStyle, type BuildFigureInput } from '@/lib/plot-figure';
import { exportWizardFigure } from '@/lib/export';
import { Button } from '@/components/ui/button';
import { getTheme } from '@/lib/theme';

const createPlotlyComponent =
  typeof _createPlotlyComponent === 'function'
    ? _createPlotlyComponent
    : (_createPlotlyComponent as unknown as { default: typeof _createPlotlyComponent }).default;
const Plot = createPlotlyComponent(Plotly);

interface ExportWizardProps {
  onClose: () => void;
}

interface SizePreset {
  label: string;
  widthIn: number;
  heightIn: number;
}

const SIZE_PRESETS: SizePreset[] = [
  { label: 'Single column (journal)', widthIn: 3.5, heightIn: 2.5 },
  { label: '1.5 column', widthIn: 5.0, heightIn: 3.0 },
  { label: 'Double column', widthIn: 7.0, heightIn: 4.5 },
  { label: 'Slide 16:9', widthIn: 10.0, heightIn: 5.625 },
  { label: 'Slide 4:3', widthIn: 10.0, heightIn: 7.5 },
  { label: 'Square', widthIn: 5.0, heightIn: 5.0 },
];

const PLOT_TYPES: { value: PlotType; label: string }[] = [
  { value: 'amp', label: 'Amplification' },
  { value: 'melt', label: 'Melt (RFU + dF)' },
  { value: 'melt_deriv', label: 'Melt Derivative only' },
  { value: 'doubling', label: 'Doubling Time' },
];

const MAX_PREVIEW_W = 560;
const MAX_PREVIEW_H = 400;

export function ExportWizard({ onClose }: ExportWizardProps) {
  // Pull everything the figure builder needs from the store.
  const experiments = useAppState((s) => s.experiments);
  const activeIdx = useAppState((s) => s.activeExperimentIndex);
  const exp = experiments[activeIdx];
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const wellGroups = useAppState((s) => s.wellGroups);
  const legendOrder = useAppState((s) => s.legendOrder);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const logScale = useAppState((s) => s.logScale);
  const baselineEnabled = useAppState((s) => s.baselineEnabled);
  const thresholdEnabled = useAppState((s) => s.thresholdEnabled);
  const thresholdRfu = useAppState((s) => s.thresholdRfu);
  const meltThresholdEnabled = useAppState((s) => s.meltThresholdEnabled);
  const meltThresholdValue = useAppState((s) => s.meltThresholdValue);
  const smoothingEnabled = useAppState((s) => s.smoothingEnabled);
  const smoothingWindow = useAppState((s) => s.smoothingWindow);
  const smoothingMeltDerivative = useAppState((s) => s.smoothingMeltDerivative);
  const plotTab = useAppState((s) => s.plotTab);
  const figureDpi = useAppState((s) => s.figureDpi);

  // Style state (the preview reads from global state so Style-tab edits update live)
  const palette = useAppState((s) => s.palette);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const paletteGroupColors = useAppState((s) => s.paletteGroupColors);
  const lineWidth = useAppState((s) => s.lineWidth);
  const fontFamily = useAppState((s) => s.fontFamily);
  const titleSize = useAppState((s) => s.titleSize);
  const labelSize = useAppState((s) => s.labelSize);
  const tickSize = useAppState((s) => s.tickSize);
  const legendSize = useAppState((s) => s.legendSize);
  const showLegend = useAppState((s) => s.showLegend);
  const legendPosition = useAppState((s) => s.legendPosition);
  const legendContent = useAppState((s) => s.legendContent);
  const showTitle = useAppState((s) => s.showTitle);
  const showLabels = useAppState((s) => s.showLabels);
  const showTicks = useAppState((s) => s.showTicks);
  const showGrid = useAppState((s) => s.showGrid);
  const gridAlpha = useAppState((s) => s.gridAlpha);
  const plotBgColor = useAppState((s) => s.plotBgColor);

  const analysisResults = useAnalysisResults();

  // Initial plot type: the active tab, mapped into PlotType values.
  const initialPlotType: PlotType = (() => {
    if (plotTab === 'melt') return 'melt';
    if (plotTab === 'doubling') return 'doubling';
    return 'amp';
  })();

  const [plotType, setPlotType] = useState<PlotType>(initialPlotType);
  const [preset, setPreset] = useState<string>('Double column');
  const [widthIn, setWidthIn] = useState<number>(7.0);
  const [heightIn, setHeightIn] = useState<number>(4.5);
  const [dpi, setDpi] = useState<number>(figureDpi || 300);
  const [format, setFormat] = useState<'png' | 'svg' | 'jpeg'>('png');
  const [exporting, setExporting] = useState(false);

  const isDark = (() => {
    try { return getTheme() === 'sharp-dark'; } catch { return false; }
  })();

  const style: PlotFigureStyle = useMemo(() => ({
    palette, paletteReversed, paletteGroupColors,
    lineWidth, fontFamily, titleSize, labelSize, tickSize, legendSize,
    showLegend, legendPosition, legendContent,
    showTitle, showLabels, showTicks,
    showGrid, gridAlpha,
    plotBgColor,
    isDark,
  }), [palette, paletteReversed, paletteGroupColors, lineWidth, fontFamily, titleSize, labelSize, tickSize, legendSize, showLegend, legendPosition, legendContent, showTitle, showLabels, showTicks, showGrid, gridAlpha, plotBgColor, isDark]);

  const visibleWells = useMemo(
    () => (exp ? exp.wellsUsed.filter((w) => !hiddenWells.has(w)) : []),
    [exp, hiddenWells],
  );

  // Target pixel dimensions (what will actually be written to disk)
  const targetW = Math.round(widthIn * dpi);
  const targetH = Math.round(heightIn * dpi);

  // Preview scaling — fit target dims into the preview area, preserving
  // aspect ratio. This gives a true WYSIWYG: fonts, margins, and line
  // widths render at their real absolute size on a real-sized canvas,
  // then the whole thing is visually scaled to fit.
  const previewScale = Math.min(MAX_PREVIEW_W / targetW, MAX_PREVIEW_H / targetH, 1);
  const previewScaledW = targetW * previewScale;
  const previewScaledH = targetH * previewScale;

  const figure = useMemo(() => {
    if (!exp) return { data: [], layout: {} };
    const input: BuildFigureInput = {
      exp, visibleWells, wellGroups, wellStyleOverrides, analysisResults,
      legendOrder,
      style, xAxisMode, logScale,
      baselineEnabled, thresholdEnabled, thresholdRfu,
      meltThresholdEnabled, meltThresholdValue,
      smoothingEnabled, smoothingWindow, smoothingMeltDerivative,
    };
    return buildFigure(plotType, input);
  }, [exp, visibleWells, wellGroups, wellStyleOverrides, analysisResults, legendOrder, style, xAxisMode, logScale, baselineEnabled, thresholdEnabled, thresholdRfu, meltThresholdEnabled, meltThresholdValue, smoothingEnabled, smoothingWindow, smoothingMeltDerivative, plotType]);

  // Preset switching
  const applyPreset = useCallback((label: string) => {
    const p = SIZE_PRESETS.find((x) => x.label === label);
    if (!p) return;
    setPreset(label);
    setWidthIn(p.widthIn);
    setHeightIn(p.heightIn);
  }, []);

  const onWidthChange = useCallback((v: number) => {
    setWidthIn(v);
    setPreset('Custom');
  }, []);
  const onHeightChange = useCallback((v: number) => {
    setHeightIn(v);
    setPreset('Custom');
  }, []);

  // Draggable floating panel (mirrors DilutionWizard)
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<{ x: number; y: number } | null>(null);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragOffset.current) return;
      setPanelPos({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const handleUp = () => { dragOffset.current = null; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const panelStyle: React.CSSProperties = panelPos
    ? { position: 'fixed', left: panelPos.x, top: panelPos.y, zIndex: 50 }
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 50 };

  const handleExport = useCallback(async () => {
    if (!exp || exporting) return;
    setExporting(true);
    try {
      const name = `${exp.experimentId ?? 'plot'}_${plotType}`;
      await exportWizardFigure(figure, targetW, targetH, format, name);
    } catch (err) {
      console.error('Export failed:', err);
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }, [exp, exporting, plotType, figure, targetW, targetH, format]);

  if (!exp) {
    return (
      <div ref={panelRef} style={panelStyle} className="bg-background border rounded-md shadow-xl p-6 text-sm">
        <p>No experiment loaded.</p>
        <Button size="sm" onClick={onClose} className="mt-3">Close</Button>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      style={panelStyle}
      className="bg-background border rounded-md shadow-xl w-[940px] max-w-[96vw] max-h-[92vh] overflow-hidden flex flex-col"
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-5 pt-4 pb-2 cursor-move select-none border-b"
        onMouseDown={onTitleMouseDown}
      >
        <h2 className="text-base font-bold">Export Wizard</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-lg leading-none px-1"
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Body: two columns */}
      <div className="flex-1 flex min-h-0">
        {/* Left: controls */}
        <div className="w-[280px] shrink-0 border-r p-4 space-y-4 overflow-y-auto text-sm">
          <section className="space-y-2">
            <div className="font-semibold text-xs uppercase text-muted-foreground tracking-wide">Plot type</div>
            {PLOT_TYPES.map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="export-plot-type"
                  checked={plotType === value}
                  onChange={() => setPlotType(value)}
                  style={{ accentColor: 'var(--brand-red-dark)' }}
                />
                {label}
              </label>
            ))}
          </section>

          <section className="space-y-2">
            <div className="font-semibold text-xs uppercase text-muted-foreground tracking-wide">Size</div>
            <label className="space-y-1 block">
              <span className="text-xs text-muted-foreground">Preset</span>
              <select
                value={preset}
                onChange={(e) => applyPreset(e.target.value)}
                className="w-full h-8 border rounded px-2 bg-background"
              >
                {SIZE_PRESETS.map((p) => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
                <option value="Custom">Custom</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">Width (in)</span>
                <input
                  type="number"
                  min={1}
                  max={40}
                  step={0.1}
                  value={widthIn}
                  onChange={(e) => onWidthChange(Number(e.target.value))}
                  className="w-full h-8 border rounded px-2"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs text-muted-foreground">Height (in)</span>
                <input
                  type="number"
                  min={1}
                  max={40}
                  step={0.1}
                  value={heightIn}
                  onChange={(e) => onHeightChange(Number(e.target.value))}
                  className="w-full h-8 border rounded px-2"
                />
              </label>
            </div>
            <label className="space-y-1 block">
              <span className="text-xs text-muted-foreground">DPI</span>
              <input
                type="number"
                min={72}
                max={1200}
                step={50}
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value))}
                className="w-full h-8 border rounded px-2"
              />
            </label>
            <div className="text-[11px] text-muted-foreground">
              Output: <b>{targetW} × {targetH}</b> px
            </div>
          </section>

          <section className="space-y-2">
            <div className="font-semibold text-xs uppercase text-muted-foreground tracking-wide">Format</div>
            <div className="flex gap-3">
              {(['png', 'svg', 'jpeg'] as const).map((f) => (
                <label key={f} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="export-format"
                    checked={format === f}
                    onChange={() => setFormat(f)}
                    style={{ accentColor: 'var(--brand-red-dark)' }}
                  />
                  {f.toUpperCase()}
                </label>
              ))}
            </div>
          </section>

          <section className="text-[11px] text-muted-foreground italic pt-1 border-t">
            Edit colors, fonts, legend, and grid in the <b>Style</b> tab — the preview updates live.
          </section>
        </div>

        {/* Right: preview */}
        <div className="flex-1 min-w-0 p-4 flex flex-col items-center justify-center bg-muted/30 overflow-auto">
          <div
            className="border shadow-sm bg-white"
            style={{
              width: previewScaledW,
              height: previewScaledH,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: targetW,
                height: targetH,
                transform: `scale(${previewScale})`,
                transformOrigin: 'top left',
              }}
            >
              <Plot
                data={figure.data}
                layout={{ ...figure.layout, width: targetW, height: targetH }}
                config={{ displayModeBar: false, staticPlot: true }}
                style={{ width: targetW, height: targetH }}
              />
            </div>
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground">
            Preview scaled to {Math.round(previewScale * 100)}% of final size
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          onClick={handleExport}
          disabled={exporting || figure.data.length === 0}
        >
          {exporting ? 'Exporting…' : 'Export…'}
        </Button>
      </div>
    </div>
  );
}
