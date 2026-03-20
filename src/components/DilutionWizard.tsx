import { useState, useMemo, useCallback, useRef } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import type { DilutionConfig, DilutionStep } from '@/lib/analysis';
import { getPlateRowLetters, getPlateColNumbers, WELL_EMPTY_COLOR, WELL_SELECTED_BORDER, DEFAULT_PLATE_ROW_COUNT, DEFAULT_PLATE_COL_COUNT } from '@/lib/constants';

// ── Page 1: Concentration Setup ────────────────────────────────────────

interface Page1Props {
  config: {
    unit: string;
    highestConcentration: number;
    dilutionFactor: number;
    numSteps: number;
  };
  setConfig: (c: Page1Props['config']) => void;
  onNext: () => void;
  onCancel: () => void;
}

function formatConcentration(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}×10⁶`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}×10³`;
  if (value < 0.01) return value.toExponential(2);
  return value.toFixed(2);
}

function Page1({ config, setConfig, onNext, onCancel }: Page1Props) {
  const concentrations = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < config.numSteps; i++) {
      out.push(config.highestConcentration / Math.pow(config.dilutionFactor, i));
    }
    return out;
  }, [config.highestConcentration, config.dilutionFactor, config.numSteps]);

  const valid = config.dilutionFactor >= 2 && config.numSteps >= 2 && config.numSteps <= 20 && config.highestConcentration > 0;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Step 1: Define Dilution Series</h3>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="space-y-1">
          <span className="text-muted-foreground">Highest concentration</span>
          <input
            type="number"
            min={0}
            step="any"
            value={config.highestConcentration}
            onChange={(e) => setConfig({ ...config, highestConcentration: Number(e.target.value) })}
            className="w-full h-8 border rounded px-2 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Units (optional)</span>
          <input
            type="text"
            value={config.unit}
            onChange={(e) => setConfig({ ...config, unit: e.target.value })}
            placeholder="e.g., copies/µL"
            className="w-full h-8 border rounded px-2 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Dilution factor</span>
          <input
            type="number"
            min={2}
            max={1000}
            value={config.dilutionFactor}
            onChange={(e) => setConfig({ ...config, dilutionFactor: Number(e.target.value) })}
            className="w-full h-8 border rounded px-2 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Number of steps</span>
          <input
            type="number"
            min={2}
            max={20}
            value={config.numSteps}
            onChange={(e) => setConfig({ ...config, numSteps: Number(e.target.value) })}
            className="w-full h-8 border rounded px-2 text-sm"
          />
        </label>
      </div>

      {/* Preview */}
      <div className="border rounded p-2 max-h-40 overflow-y-auto">
        <div className="text-xs font-medium text-muted-foreground mb-1">Preview</div>
        {concentrations.map((c, i) => (
          <div key={i} className="text-xs py-0.5 flex justify-between">
            <span>Step {i + 1}:</span>
            <span className="font-mono">{formatConcentration(c)}{config.unit ? ` ${config.unit}` : ''}</span>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <button onClick={onCancel} className="px-4 py-1.5 text-sm border rounded hover:bg-accent">
          Cancel
        </button>
        <button
          onClick={onNext}
          disabled={!valid}
          className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ── Page 2: Well Assignment ────────────────────────────────────────────

const CELL_SIZE = 19;
const HEADER_COL_W = 16;

interface Page2Props {
  steps: DilutionStep[];
  setSteps: (s: DilutionStep[]) => void;
  unit: string;
  onBack: () => void;
  onFinish: () => void;
  onCancel: () => void;
}

function MiniWellGrid({
  selectedWells,
  onSelectionChange,
  usedWells,
  assignedWells,
  plateRows,
  plateCols,
}: {
  selectedWells: Set<string>;
  onSelectionChange: (wells: Set<string>) => void;
  usedWells: Set<string>;
  assignedWells: Map<string, number>;
  plateRows: number;
  plateCols: number;
}) {
  const rows = getPlateRowLetters(plateRows);
  const cols = getPlateColNumbers(plateCols);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);

  const pixelToRowCol = useCallback((px: number, py: number) => {
    const col = Math.floor((px - HEADER_COL_W) / (CELL_SIZE + 1));
    const row = Math.floor((py - 16) / (CELL_SIZE + 1));
    return { row, col };
  }, []);

  const getWellsInRect = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    const tl = pixelToRowCol(Math.min(x1, x2), Math.min(y1, y2));
    const br = pixelToRowCol(Math.max(x1, x2), Math.max(y1, y2));
    const wells: string[] = [];
    for (let r = Math.max(0, tl.row); r <= Math.min(plateRows - 1, br.row); r++) {
      for (let c = Math.max(0, tl.col); c <= Math.min(plateCols - 1, br.col); c++) {
        const well = `${rows[r]}${cols[c]}`;
        if (usedWells.has(well)) wells.push(well);
      }
    }
    return wells;
  }, [pixelToRowCol, usedWells, plateRows, plateCols, rows, cols]);

  return (
    <div
      ref={gridRef}
      className="inline-grid gap-[1px] select-none"
      style={{ gridTemplateColumns: `${HEADER_COL_W}px repeat(${plateCols}, ${CELL_SIZE}px)` }}
      onMouseDown={(e) => {
        if (e.button !== 0 || !gridRef.current) return;
        const rect = gridRef.current.getBoundingClientRect();
        dragStart.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        isDragging.current = false;
      }}
      onMouseMove={(e) => {
        if (!dragStart.current || !gridRef.current) return;
        const rect = gridRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (!isDragging.current && Math.abs(x - dragStart.current.x) + Math.abs(y - dragStart.current.y) > 4) {
          isDragging.current = true;
        }
      }}
      onMouseUp={(e) => {
        if (isDragging.current && dragStart.current && gridRef.current) {
          const rect = gridRef.current.getBoundingClientRect();
          const wells = getWellsInRect(
            dragStart.current.x, dragStart.current.y,
            e.clientX - rect.left, e.clientY - rect.top
          );
          if (wells.length > 0) {
            const next = new Set(selectedWells);
            if (e.ctrlKey || e.metaKey) {
              for (const w of wells) next.add(w);
            } else {
              onSelectionChange(new Set(wells));
              dragStart.current = null;
              isDragging.current = false;
              return;
            }
            onSelectionChange(next);
          }
        }
        dragStart.current = null;
        isDragging.current = false;
      }}
    >
      <div />
      {cols.map((col) => (
        <div key={col} className="text-center text-[8px] text-muted-foreground font-medium leading-4">{col}</div>
      ))}
      {[...rows].flatMap((row) => [
        <div key={`l-${row}`} className="text-[8px] text-muted-foreground font-medium flex items-center justify-center">{row}</div>,
        ...cols.map((col) => {
          const well = `${row}${col}`;
          const isUsed = usedWells.has(well);
          const isSel = selectedWells.has(well);
          const assignedStep = assignedWells.get(well);
          const stepColors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
            '#1f78b4', '#33a02c', '#e31a1c', '#ff7f00', '#6a3d9a', '#b15928', '#a6cee3', '#b2df8a', '#fb9a99', '#fdbf6f'];
          const bg = !isUsed ? WELL_EMPTY_COLOR
            : assignedStep != null ? stepColors[assignedStep % stepColors.length]
            : '#f0f0f0';
          return (
            <div
              key={well}
              style={{
                width: CELL_SIZE, height: CELL_SIZE,
                backgroundColor: bg,
                border: `${isSel ? 2 : 1}px solid ${isSel ? WELL_SELECTED_BORDER : '#ccc'}`,
                borderRadius: 2,
                opacity: isUsed ? 1 : 0.3,
                cursor: isUsed ? 'pointer' : 'default',
              }}
              title={well + (assignedStep != null ? ` (Step ${assignedStep + 1})` : '')}
              onClick={(e) => {
                if (!isUsed) return;
                e.stopPropagation();
                const next = new Set(selectedWells);
                if (e.ctrlKey || e.metaKey) {
                  if (next.has(well)) next.delete(well); else next.add(well);
                } else {
                  onSelectionChange(new Set([well]));
                  return;
                }
                onSelectionChange(next);
              }}
            />
          );
        }),
      ])}
    </div>
  );
}

function Page2({ steps, setSteps, unit, onBack, onFinish, onCancel }: Page2Props) {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const exp = experiments[idx];
  const [activeStep, setActiveStep] = useState(0);
  const [wizardSelection, setWizardSelection] = useState<Set<string>>(new Set());
  const analysisResults = useAnalysisResults();

  const usedWells = useMemo(() => new Set(exp?.wellsUsed ?? []), [exp]);
  const plateRows = exp?.plateRows ?? DEFAULT_PLATE_ROW_COUNT;
  const plateCols = exp?.plateCols ?? DEFAULT_PLATE_COL_COUNT;

  // Build map of well → step index (for coloring assigned wells)
  const assignedWells = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < steps.length; i++) {
      for (const w of steps[i].wells) m.set(w, i);
    }
    return m;
  }, [steps]);

  const assignToStep = useCallback(() => {
    if (wizardSelection.size === 0) return;
    const newSteps = steps.map((s, i) => {
      if (i === activeStep) {
        // Add selected wells (avoid duplicates)
        const wellSet = new Set(s.wells);
        for (const w of wizardSelection) wellSet.add(w);
        return { ...s, wells: [...wellSet] };
      }
      // Remove these wells from other steps
      return { ...s, wells: s.wells.filter((w) => !wizardSelection.has(w)) };
    });
    setSteps(newSteps);
    setWizardSelection(new Set());
  }, [steps, activeStep, wizardSelection, setSteps]);

  const clearStep = useCallback(() => {
    const newSteps = steps.map((s, i) =>
      i === activeStep ? { ...s, wells: [] } : s
    );
    setSteps(newSteps);
  }, [steps, activeStep, setSteps]);

  // Count steps with assigned wells for validation
  const assignedStepCount = steps.filter((s) => s.wells.length > 0).length;
  const canFinish = assignedStepCount >= 3;

  // Sort wells in the wizard selection by Tt (for quick visual feedback)
  const sortedWellsForStep = useCallback((wells: string[]) => {
    return [...wells].sort((a, b) => {
      const ttA = analysisResults.get(a)?.tt;
      const ttB = analysisResults.get(b)?.tt;
      if (ttA == null && ttB == null) return a.localeCompare(b);
      if (ttA == null) return 1;
      if (ttB == null) return -1;
      return ttA - ttB;
    });
  }, [analysisResults]);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Step 2: Assign Wells to Concentration Steps</h3>

      <div className="flex gap-3" style={{ minHeight: 300 }}>
        {/* Left: Step list */}
        <div className="w-48 border rounded overflow-y-auto shrink-0">
          {steps.map((step, i) => {
            const wellNames = sortedWellsForStep(step.wells);
            return (
              <div
                key={i}
                className={`px-2 py-1.5 text-xs cursor-pointer border-b last:border-b-0 ${i === activeStep ? 'bg-accent' : 'hover:bg-accent/50'}`}
                onClick={() => setActiveStep(i)}
              >
                <div className="font-medium">
                  Step {i + 1}: {formatConcentration(step.concentration)}
                  {unit ? ` ${unit}` : ''}
                </div>
                <div className="text-muted-foreground truncate">
                  {wellNames.length > 0 ? wellNames.join(', ') : '(none)'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Well grid */}
        <div className="flex-1 flex flex-col gap-2">
          <MiniWellGrid
            selectedWells={wizardSelection}
            onSelectionChange={setWizardSelection}
            usedWells={usedWells}
            assignedWells={assignedWells}
            plateRows={plateRows}
            plateCols={plateCols}
          />
          <div className="flex gap-2">
            <button
              onClick={assignToStep}
              disabled={wizardSelection.size === 0}
              className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-40"
            >
              Assign {wizardSelection.size > 0 ? `${wizardSelection.size} well${wizardSelection.size > 1 ? 's' : ''}` : ''} to Step {activeStep + 1}
            </button>
            <button
              onClick={clearStep}
              disabled={steps[activeStep]?.wells.length === 0}
              className="px-3 py-1 text-xs border rounded hover:bg-accent disabled:opacity-40"
            >
              Clear Step
            </button>
          </div>
        </div>
      </div>

      {!canFinish && (
        <p className="text-xs text-amber-600">
          Assign wells to at least 3 steps to enable Finish.
        </p>
      )}

      <div className="flex justify-between pt-2 border-t">
        <button onClick={onBack} className="px-4 py-1.5 text-sm border rounded hover:bg-accent">
          Back
        </button>
        <div className="flex gap-2">
          <button onClick={onCancel} className="px-4 py-1.5 text-sm border rounded hover:bg-accent">
            Cancel
          </button>
          <button
            onClick={onFinish}
            disabled={!canFinish}
            className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-40"
          >
            Finish
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Wizard Container ───────────────────────────────────────────────────

interface DilutionWizardProps {
  onClose: () => void;
}

export function DilutionWizard({ onClose }: DilutionWizardProps) {
  const existingConfig = useAppState((s) => s.dilutionConfig);
  const setDilutionConfig = useAppState((s) => s.setDilutionConfig);
  const setPlotTab = useAppState((s) => s.setPlotTab);

  const [page, setPage] = useState<1 | 2>(1);
  const [params, setParams] = useState({
    unit: existingConfig?.unit ?? '',
    highestConcentration: existingConfig?.highestConcentration ?? 5e6,
    dilutionFactor: existingConfig?.dilutionFactor ?? 10,
    numSteps: existingConfig?.numSteps ?? 5,
  });

  // Build steps from params (preserve existing assignments if editing)
  const [steps, setSteps] = useState<DilutionStep[]>(() => {
    if (existingConfig && existingConfig.steps.length === params.numSteps) {
      return existingConfig.steps;
    }
    return Array.from({ length: params.numSteps }, (_, i) => ({
      concentration: params.highestConcentration / Math.pow(params.dilutionFactor, i),
      wells: existingConfig?.steps[i]?.wells ?? [],
      enabled: true,
    }));
  });

  const handleNext = useCallback(() => {
    // Rebuild steps with updated concentrations, preserving well assignments
    const newSteps = Array.from({ length: params.numSteps }, (_, i) => ({
      concentration: params.highestConcentration / Math.pow(params.dilutionFactor, i),
      wells: steps[i]?.wells ?? [],
      enabled: steps[i]?.enabled ?? true,
    }));
    setSteps(newSteps);
    setPage(2);
  }, [params, steps]);

  const handleFinish = useCallback(() => {
    const config: DilutionConfig = {
      unit: params.unit,
      highestConcentration: params.highestConcentration,
      dilutionFactor: params.dilutionFactor,
      numSteps: params.numSteps,
      steps,
    };
    setDilutionConfig(config);
    setPlotTab('doubling');
    onClose();
  }, [params, steps, setDilutionConfig, setPlotTab, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background border rounded-lg shadow-xl p-5 w-[640px] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-bold mb-4">Doubling Time Wizard</h2>
        {page === 1 ? (
          <Page1
            config={params}
            setConfig={setParams}
            onNext={handleNext}
            onCancel={onClose}
          />
        ) : (
          <Page2
            steps={steps}
            setSteps={setSteps}
            unit={params.unit}
            onBack={() => setPage(1)}
            onFinish={handleFinish}
            onCancel={onClose}
          />
        )}
      </div>
    </div>
  );
}
