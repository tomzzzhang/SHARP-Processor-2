import { useCallback, useRef, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import { Button } from '@/components/ui/button';
import { loadSharpFile } from '@/lib/sharp-loader';
import { exportPlotImage, exportDataCsv, exportResultsCsv, exportMeltCsv, exportAsSharp } from '@/lib/export';

export function DataTab() {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const loadExperiment = useAppState((s) => s.loadExperiment);
  const hiddenWells = useAppState((s) => s.hiddenWells);
  const xAxisMode = useAppState((s) => s.xAxisMode);
  const figureDpi = useAppState((s) => s.figureDpi);
  const exp = experiments[idx];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisResults = useAnalysisResults();
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.name.endsWith('.sharp')) continue;
      const buffer = await file.arrayBuffer();
      const experiment = await loadSharpFile(buffer, file.name);
      loadExperiment(experiment);
    }
  }, [loadExperiment]);

  const visibleWells = exp
    ? exp.wellsUsed.filter((w) => !hiddenWells.has(w))
    : [];

  const showStatus = (msg: string) => {
    setExportStatus(msg);
    setTimeout(() => setExportStatus(null), 3000);
  };

  const handleExportPlot = useCallback(async (format: 'png' | 'svg' | 'jpeg') => {
    const plotDiv = document.querySelector('.js-plotly-plot') as HTMLElement | null;
    if (!plotDiv || !exp) return;
    try {
      const path = await exportPlotImage(plotDiv, format, figureDpi, exp.experimentId);
      if (path) showStatus(`Saved ${format.toUpperCase()}`);
    } catch (err) {
      showStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [exp, figureDpi]);

  const handleExportData = useCallback(async () => {
    if (!exp) return;
    try {
      const path = await exportDataCsv(exp, xAxisMode, visibleWells);
      if (path) showStatus('Saved data CSV');
    } catch (err) {
      showStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [exp, xAxisMode, visibleWells]);

  const handleExportResults = useCallback(async () => {
    if (!exp) return;
    try {
      const path = await exportResultsCsv(exp, analysisResults, visibleWells, xAxisMode);
      if (path) showStatus('Saved results CSV');
    } catch (err) {
      showStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [exp, analysisResults, visibleWells, xAxisMode]);

  const handleExportMelt = useCallback(async () => {
    if (!exp) return;
    try {
      const path = await exportMeltCsv(exp, visibleWells);
      if (path) showStatus('Saved melt CSV');
    } catch (err) {
      showStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [exp, visibleWells]);

  const handleSaveSharp = useCallback(async () => {
    if (!exp) return;
    try {
      const path = await exportAsSharp(exp);
      if (path) showStatus('Saved .sharp');
    } catch (err) {
      showStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [exp]);

  if (!exp) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          No experiment loaded.
        </p>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => fileInputRef.current?.click()}
        >
          Open .sharp file...
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".sharp"
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
        <p className="text-xs text-muted-foreground text-center">
          or drag & drop a .sharp file anywhere
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm space-y-1">
        <div><span className="font-medium">Experiment:</span> {exp.experimentId}</div>
        <div><span className="font-medium">Type:</span> {exp.protocolType || 'sharp'}</div>
        <div><span className="font-medium">Operator:</span> {exp.operator || '—'}</div>
        <div><span className="font-medium">Wells:</span> {exp.wellsUsed.length}</div>
        <div><span className="font-medium">Cycles:</span> {exp.amplification?.cycle.length ?? '—'}</div>
        <div><span className="font-medium">Melt data:</span> {exp.melt ? 'Yes' : 'No'}</div>
        <div><span className="font-medium">Started:</span> {exp.runStarted || '—'}</div>
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-1">Experiment Notes</h3>
        <textarea
          className="w-full h-24 text-sm border rounded p-2 resize-none bg-background"
          placeholder="Add notes..."
          defaultValue={exp.notes}
        />
      </div>

      {/* Export */}
      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-sm font-semibold px-1">Export Plot</legend>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => handleExportPlot('png')}>PNG</Button>
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => handleExportPlot('svg')}>SVG</Button>
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => handleExportPlot('jpeg')}>JPEG</Button>
        </div>
      </fieldset>

      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-sm font-semibold px-1">Export Data</legend>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={handleExportData}>Data CSV</Button>
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={handleExportResults}>Results CSV</Button>
        </div>
        {exp.melt && (
          <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={handleExportMelt}>Melt CSV</Button>
        )}
      </fieldset>

      <fieldset className="border rounded p-3 space-y-2">
        <legend className="text-sm font-semibold px-1">Save</legend>
        <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={handleSaveSharp}>Save as .sharp</Button>
      </fieldset>

      {exportStatus && (
        <p className="text-xs text-center text-muted-foreground">{exportStatus}</p>
      )}

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => fileInputRef.current?.click()}
      >
        Open another file...
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".sharp"
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files)}
      />
    </div>
  );
}
