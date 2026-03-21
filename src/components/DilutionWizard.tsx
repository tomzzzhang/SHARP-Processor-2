import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import type { DilutionConfig, DilutionStep } from '@/lib/analysis';
import { getPlateRowLetters, getPlateColNumbers, WELL_EMPTY_COLOR, WELL_SELECTED_BORDER, DEFAULT_PLATE_ROW_COUNT, DEFAULT_PLATE_COL_COUNT } from '@/lib/constants';

// ── Constants ─────────────────────────────────────────────────────────

const CONCENTRATION_UNITS = ['fM', 'pM', 'nM', 'µM', 'mM', 'copies/µL'] as const;

// ── Page 1: Concentration Setup ────────────────────────────────────────

interface Page1Props {
  config: {
    unit: string;
    highestConcentration: number;
    dilutionFactor: number;
    numSteps: number;
    copiesExponent: number;
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

function formatConcentrationWithUnit(value: number, unit: string, copiesExponent: number): string {
  const formatted = formatConcentration(value);
  if (!unit) return formatted;
  if (unit === 'copies/µL') {
    return `${formatted} ×10^${copiesExponent} copies/µL`;
  }
  return `${formatted} ${unit}`;
}

function Page1({ config, setConfig, onNext, onCancel }: Page1Props) {
  const isCopies = config.unit === 'copies/µL';

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
          <span className="text-muted-foreground">Units</span>
          <div className="flex gap-1">
            <select
              value={config.unit}
              onChange={(e) => setConfig({ ...config, unit: e.target.value })}
              className="flex-1 h-8 border rounded px-2 text-sm bg-background"
            >
              <option value="">(none)</option>
              {CONCENTRATION_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
            {isCopies && (
              <div className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <span>×10^</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={config.copiesExponent}
                  onChange={(e) => setConfig({ ...config, copiesExponent: Number(e.target.value) })}
                  className="w-10 h-8 border rounded px-1 text-sm text-center"
                />
              </div>
            )}
          </div>
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
            <span className="font-mono">{formatConcentrationWithUnit(c, config.unit, config.copiesExponent)}</span>
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
  copiesExponent: number;
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
  const [dragRect, setDragRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<Set<string> | null>(null);

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

  // Global mouse handlers for drag (so drag works outside grid bounds)
  useEffect(() => {
    const handleGlobalMove = (e: MouseEvent) => {
      if (!dragStart.current || !gridRef.current) return;
      const rect = gridRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (!isDragging.current && Math.abs(x - dragStart.current.x) + Math.abs(y - dragStart.current.y) > 4) {
        isDragging.current = true;
      }
      if (isDragging.current) {
        setDragRect({ x1: dragStart.current.x, y1: dragStart.current.y, x2: x, y2: y });
        const wells = getWellsInRect(dragStart.current.x, dragStart.current.y, x, y);
        setDragPreview(new Set(wells));
      }
    };
    const handleGlobalUp = (e: MouseEvent) => {
      if (isDragging.current && dragStart.current && gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect();
        const wells = getWellsInRect(
          dragStart.current.x, dragStart.current.y,
          e.clientX - rect.left, e.clientY - rect.top
        );
        if (wells.length > 0) {
          if (e.ctrlKey || e.metaKey) {
            const next = new Set(selectedWells);
            for (const w of wells) next.add(w);
            onSelectionChange(next);
          } else {
            onSelectionChange(new Set(wells));
          }
        }
      }
      dragStart.current = null;
      isDragging.current = false;
      setDragRect(null);
      setDragPreview(null);
    };
    window.addEventListener('mousemove', handleGlobalMove);
    window.addEventListener('mouseup', handleGlobalUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalUp);
    };
  }, [selectedWells, onSelectionChange, getWellsInRect]);

  const stepColors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
    '#1f78b4', '#33a02c', '#e31a1c', '#ff7f00', '#6a3d9a', '#b15928', '#a6cee3', '#b2df8a', '#fb9a99', '#fdbf6f'];

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
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
            const isInDragPreview = dragPreview?.has(well) ?? false;
            const isDragActive = dragPreview != null;

            const bg = !isUsed ? WELL_EMPTY_COLOR
              : assignedStep != null ? stepColors[assignedStep % stepColors.length]
              : 'var(--muted)';

            // During drag: highlight wells in selection box, grey out others
            let opacity = isUsed ? 1 : 0.3;
            if (isDragActive && isUsed) {
              opacity = isInDragPreview ? 1.0 : 0.25;
            }

            const highlighted = isSel || isInDragPreview;
            return (
              <div
                key={well}
                style={{
                  width: CELL_SIZE, height: CELL_SIZE,
                  backgroundColor: bg,
                  border: `${highlighted ? 2 : 1}px solid ${highlighted ? WELL_SELECTED_BORDER : '#ccc'}`,
                  borderRadius: 2,
                  opacity,
                  cursor: isUsed ? 'pointer' : 'default',
                  transition: isDragActive ? 'none' : 'opacity 0.1s',
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
      {/* Selection rectangle overlay */}
      {dragRect && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(dragRect.x1, dragRect.x2),
            top: Math.min(dragRect.y1, dragRect.y2),
            width: Math.abs(dragRect.x2 - dragRect.x1),
            height: Math.abs(dragRect.y2 - dragRect.y1),
            border: '1.5px dashed #aa2026',
            backgroundColor: 'rgba(170, 32, 38, 0.07)',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
}

function Page2({ steps, setSteps, unit, copiesExponent, onBack, onFinish, onCancel }: Page2Props) {
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
                  Step {i + 1}: {formatConcentrationWithUnit(step.concentration, unit, copiesExponent)}
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
    copiesExponent: existingConfig?.copiesExponent ?? 0,
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
      copiesExponent: params.copiesExponent,
      steps,
    };
    setDilutionConfig(config);
    setPlotTab('doubling');
    onClose();
  }, [params, steps, setDilutionConfig, setPlotTab, onClose]);

  // Draggable floating panel
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

  return (
    <div
      ref={panelRef}
      className="bg-background border rounded-md shadow-xl w-[640px] max-h-[90vh] overflow-y-auto"
      style={panelStyle}
    >
      {/* Draggable title bar */}
      <div
        className="flex items-center justify-between px-5 pt-4 pb-2 cursor-move select-none"
        onMouseDown={onTitleMouseDown}
      >
        <h2 className="text-base font-bold">Doubling Time Wizard</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-lg leading-none px-1"
          title="Close"
        >
          ×
        </button>
      </div>
      <div className="px-5 pb-5">
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
            copiesExponent={params.copiesExponent}
            onBack={() => setPage(1)}
            onFinish={handleFinish}
            onCancel={onClose}
          />
        )}
      </div>
    </div>
  );
}
