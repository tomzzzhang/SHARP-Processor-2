import { create } from 'zustand';
import type { ExperimentData, XAxisMode, ContentType } from '../types/experiment';
import type { DilutionConfig } from '../lib/analysis';
import {
  DEFAULT_BASELINE_METHOD, DEFAULT_BASELINE_START, DEFAULT_BASELINE_END,
  DEFAULT_THRESHOLD_RFU, DEFAULT_LINE_WIDTH, DEFAULT_FONT_FAMILY,
  DEFAULT_TITLE_SIZE, DEFAULT_LABEL_SIZE, DEFAULT_TICK_SIZE,
  DEFAULT_LEGEND_SIZE, DEFAULT_FIGURE_DPI, DEFAULT_GRID_ALPHA,
} from '../lib/constants';

export type PlotTab = 'amplification' | 'melt' | 'doubling';

export interface WellStyleOverride {
  color?: string;
  lineWidth?: number;
  lineStyle?: 'solid' | 'dash' | 'dot' | 'dashdot';
}

export interface WellBaselineOverride {
  method?: 'horizontal' | 'linear';
  start?: number;
  end?: number;
  /** Per-well opt-in/out of auto baseline. undefined = follow global baselineAuto. */
  auto?: boolean;
}

/** State that is isolated per experiment tab */
export interface ExperimentViewState {
  // Selection
  selectedWells: Set<string>;
  hiddenWells: Set<string>;
  deactivatedWells: Set<string>;

  // Per-well overrides
  wellStyleOverrides: Map<string, WellStyleOverride>;
  wellBaselineOverrides: Map<string, WellBaselineOverride>;
  wellGroups: Map<string, string>;
  legendWells: Set<string>;

  // View
  xAxisMode: XAxisMode;
  logScale: boolean;
  plotTab: PlotTab;

  // Analysis - Baseline
  baselineEnabled: boolean;
  baselineAuto: boolean;     // auto-detect flat baseline region per well
  baselineMethod: 'horizontal' | 'linear';
  baselineStart: number;
  baselineEnd: number;
  showRawOverlay: boolean;

  // Analysis - Threshold
  thresholdEnabled: boolean;
  thresholdRfu: number;

  // Analysis - Melt Threshold
  meltThresholdEnabled: boolean;
  meltThresholdValue: number;  // -dF/dT threshold

  // Analysis - Smoothing
  smoothingEnabled: boolean;
  smoothingWindow: number;  // odd, 5-21
  smoothingMeltDerivative: boolean;

  // Analysis - Fitting
  fittingEnabled: boolean;
  fitStartFraction: number;
  fitEndFraction: number;

  // Dilution series (standard curve wizard)
  dilutionConfig: DilutionConfig | null;

  // Style
  palette: string;
  paletteReversed: boolean;
  paletteGroupColors: boolean;
  selectionPaletteGroupColors: boolean;
  lineWidth: number;
  fontFamily: string;
  titleSize: number;
  labelSize: number;
  tickSize: number;
  legendSize: number;
  showLegend: boolean;
  showLegendAmp: boolean;
  showLegendMelt: boolean;
  showLegendDoubling: boolean;
  legendPosition: string;
  legendContent: 'well' | 'sample';
  legendVisibleOnly: boolean;
  showGrid: boolean;
  gridAlpha: number;
  plotBgColor: string;  // '' = auto (off-white for light, dark surface for dark)
  figureDpi: number;
}

function defaultViewState(wellsUsed: string[] = []): ExperimentViewState {
  return {
    selectedWells: new Set(wellsUsed),
    hiddenWells: new Set(),
    deactivatedWells: new Set(),
    wellStyleOverrides: new Map(),
    wellBaselineOverrides: new Map(),
    wellGroups: new Map(),
    legendWells: new Set(),
    xAxisMode: 'time_min',
    logScale: false,
    plotTab: 'amplification',
    baselineEnabled: true,
    baselineAuto: true,
    baselineMethod: DEFAULT_BASELINE_METHOD,
    baselineStart: DEFAULT_BASELINE_START,
    baselineEnd: DEFAULT_BASELINE_END,
    showRawOverlay: false,
    thresholdEnabled: false,
    thresholdRfu: DEFAULT_THRESHOLD_RFU,
    meltThresholdEnabled: true,
    meltThresholdValue: 400,
    smoothingEnabled: false,
    smoothingWindow: 7,
    smoothingMeltDerivative: true,
    fittingEnabled: false,
    fitStartFraction: 0.10,
    fitEndFraction: 0.90,
    dilutionConfig: null,
    palette: 'SHARP',
    paletteReversed: false,
    paletteGroupColors: false,
    selectionPaletteGroupColors: true,
    lineWidth: DEFAULT_LINE_WIDTH,
    fontFamily: DEFAULT_FONT_FAMILY,
    titleSize: DEFAULT_TITLE_SIZE,
    labelSize: DEFAULT_LABEL_SIZE,
    tickSize: DEFAULT_TICK_SIZE,
    legendSize: DEFAULT_LEGEND_SIZE,
    showLegend: true,
    showLegendAmp: true,
    showLegendMelt: true,
    showLegendDoubling: true,
    legendPosition: 'best',
    legendContent: 'sample',
    legendVisibleOnly: true,
    showGrid: true,
    gridAlpha: DEFAULT_GRID_ALPHA,
    plotBgColor: '',
    figureDpi: DEFAULT_FIGURE_DPI,
  };
}

/** Extract current per-experiment view state fields from the store */
function snapshotViewState(state: AppState): ExperimentViewState {
  return {
    selectedWells: state.selectedWells,
    hiddenWells: state.hiddenWells,
    deactivatedWells: state.deactivatedWells,
    wellStyleOverrides: state.wellStyleOverrides,
    wellBaselineOverrides: state.wellBaselineOverrides,
    wellGroups: state.wellGroups,
    legendWells: state.legendWells,
    xAxisMode: state.xAxisMode,
    logScale: state.logScale,
    plotTab: state.plotTab,
    baselineEnabled: state.baselineEnabled,
    baselineAuto: state.baselineAuto,
    baselineMethod: state.baselineMethod,
    baselineStart: state.baselineStart,
    baselineEnd: state.baselineEnd,
    showRawOverlay: state.showRawOverlay,
    thresholdEnabled: state.thresholdEnabled,
    thresholdRfu: state.thresholdRfu,
    meltThresholdEnabled: state.meltThresholdEnabled,
    meltThresholdValue: state.meltThresholdValue,
    smoothingEnabled: state.smoothingEnabled,
    smoothingWindow: state.smoothingWindow,
    smoothingMeltDerivative: state.smoothingMeltDerivative,
    fittingEnabled: state.fittingEnabled,
    fitStartFraction: state.fitStartFraction,
    fitEndFraction: state.fitEndFraction,
    dilutionConfig: state.dilutionConfig,
    palette: state.palette,
    paletteReversed: state.paletteReversed,
    paletteGroupColors: state.paletteGroupColors,
    selectionPaletteGroupColors: state.selectionPaletteGroupColors,
    lineWidth: state.lineWidth,
    fontFamily: state.fontFamily,
    titleSize: state.titleSize,
    labelSize: state.labelSize,
    tickSize: state.tickSize,
    legendSize: state.legendSize,
    showLegend: state.showLegend,
    showLegendAmp: state.showLegendAmp,
    showLegendMelt: state.showLegendMelt,
    showLegendDoubling: state.showLegendDoubling,
    legendPosition: state.legendPosition,
    legendContent: state.legendContent,
    legendVisibleOnly: state.legendVisibleOnly,
    showGrid: state.showGrid,
    gridAlpha: state.gridAlpha,
    plotBgColor: state.plotBgColor,
    figureDpi: state.figureDpi,
  };
}

interface UndoEntry {
  snapshot: ExperimentViewState;
  description: string;
}

const MAX_UNDO_DEPTH = 50;

interface AppState extends ExperimentViewState {
  // Data (null entries represent empty "home" tabs)
  experiments: (ExperimentData | null)[];
  activeExperimentIndex: number;

  // Source file paths (index → file path that was opened)
  sourceFilePaths: Map<number, string>;

  // Transient (not per-experiment)
  hoveredWell: string | null;
  dragPreviewWells: Set<string> | null;
  showDilutionWizard: boolean;
  showExportWizard: boolean;

  // Per-experiment state snapshots (index → snapshot)
  _experimentSnapshots: Map<number, ExperimentViewState>;

  // Undo/redo stacks (per experiment)
  _undoStacks: Map<number, UndoEntry[]>;
  _redoStacks: Map<number, UndoEntry[]>;
  _restoringSnapshot: boolean;

  // Actions
  addEmptyTab: () => void;
  loadExperiment: (data: ExperimentData, sourcePath?: string) => void;
  getActiveSourcePath: () => string | undefined;
  pushUndo: (description: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getUndoDescription: () => string | undefined;
  getRedoDescription: () => string | undefined;
  switchExperiment: (index: number) => void;
  removeExperiment: (index: number) => void;
  setSelectedWells: (wells: Set<string>) => void;
  addToSelection: (wells: string[]) => void;
  toggleWellSelection: (well: string) => void;
  selectOnly: (well: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  selectByType: (type: string) => void;
  selectShown: () => void;
  selectHidden: () => void;
  toggleWellHidden: (well: string) => void;
  showWells: (wells: string[]) => void;
  hideWells: (wells: string[]) => void;
  activateWells: (wells: string[]) => void;
  deactivateWells: (wells: string[]) => void;
  setWellContentType: (wells: string[], type: ContentType) => void;
  setWellSampleName: (well: string, name: string) => void;
  setWellStyleOverride: (wells: string[], style: WellStyleOverride) => void;
  clearWellStyleOverrides: (wells: string[]) => void;
  setWellBaselineOverride: (wells: string[], override: WellBaselineOverride) => void;
  clearWellBaselineOverrides: (wells: string[]) => void;
  setWellGroup: (wells: string[], group: string) => void;
  removeWellGroup: (wells: string[]) => void;
  autoGroupBySample: () => void;
  addToLegend: (wells: string[]) => void;
  removeFromLegend: (wells: string[]) => void;
  setHoveredWell: (well: string | null) => void;
  setDragPreviewWells: (wells: Set<string> | null) => void;
  setXAxisMode: (mode: XAxisMode) => void;
  setLogScale: (on: boolean) => void;
  setPlotTab: (tab: PlotTab) => void;
  setBaselineEnabled: (on: boolean) => void;
  setBaselineAuto: (on: boolean) => void;
  setBaselineMethod: (method: 'horizontal' | 'linear') => void;
  setBaselineZone: (start: number, end: number) => void;
  setShowRawOverlay: (on: boolean) => void;
  setThresholdEnabled: (on: boolean) => void;
  setThresholdRfu: (rfu: number) => void;
  setMeltThresholdEnabled: (on: boolean) => void;
  setMeltThresholdValue: (value: number) => void;
  setSmoothingEnabled: (on: boolean) => void;
  setSmoothingWindow: (window: number) => void;
  setSmoothingMeltDerivative: (on: boolean) => void;
  setFittingEnabled: (on: boolean) => void;
  setFitStartFraction: (fraction: number) => void;
  setFitEndFraction: (fraction: number) => void;
  setDilutionConfig: (config: DilutionConfig | null) => void;
  setDilutionStepEnabled: (stepIndex: number, enabled: boolean) => void;
  setPalette: (palette: string) => void;
  setLineWidth: (width: number) => void;
  setFontFamily: (font: string) => void;
  setTitleSize: (size: number) => void;
  setLabelSize: (size: number) => void;
  setTickSize: (size: number) => void;
  setLegendSize: (size: number) => void;
  setShowLegend: (on: boolean) => void;
  setShowLegendAmp: (on: boolean) => void;
  setShowLegendMelt: (on: boolean) => void;
  setShowLegendDoubling: (on: boolean) => void;
  setLegendPosition: (pos: string) => void;
  setLegendContent: (content: 'well' | 'sample') => void;
  setLegendVisibleOnly: (on: boolean) => void;
  setPaletteReversed: (reversed: boolean) => void;
  setPaletteGroupColors: (on: boolean) => void;
  setSelectionPaletteGroupColors: (on: boolean) => void;
  reversePalette: () => void;
  setShowGrid: (on: boolean) => void;
  setGridAlpha: (alpha: number) => void;
  setPlotBgColor: (color: string) => void;
  setFigureDpi: (dpi: number) => void;
  setShowDilutionWizard: (show: boolean) => void;
  setShowExportWizard: (show: boolean) => void;
}

export const useAppState = create<AppState>((set, get) => ({
  experiments: [null],  // Start with one Welcome tab
  activeExperimentIndex: 0,
  sourceFilePaths: new Map(),
  _experimentSnapshots: new Map(),
  _undoStacks: new Map(),
  _redoStacks: new Map(),
  _restoringSnapshot: false,
  hoveredWell: null,
  dragPreviewWells: null,
  showDilutionWizard: false,
  showExportWizard: false,

  // Spread default view state as initial top-level fields
  ...defaultViewState(),

  addEmptyTab: () =>
    set((state) => {
      const snapshots = new Map(state._experimentSnapshots);
      if (state.experiments.length > 0) {
        snapshots.set(state.activeExperimentIndex, snapshotViewState(state));
      }
      const newIndex = state.experiments.length;
      const newView = defaultViewState();
      snapshots.set(newIndex, newView);
      return {
        experiments: [...state.experiments, null],
        activeExperimentIndex: newIndex,
        _experimentSnapshots: snapshots,
        hoveredWell: null,
        dragPreviewWells: null,
        ...newView,
      };
    }),

  loadExperiment: (data, sourcePath?) =>
    set((state) => {
      const snapshots = new Map(state._experimentSnapshots);
      const paths = new Map(state.sourceFilePaths);
      const currentIsEmpty = state.experiments[state.activeExperimentIndex] === null;

      if (currentIsEmpty) {
        // Replace the current empty/Welcome tab with this experiment
        const idx = state.activeExperimentIndex;
        const newView = defaultViewState(data.wellsUsed);
        const exps = [...state.experiments];
        exps[idx] = data;
        snapshots.set(idx, newView);
        if (sourcePath) paths.set(idx, sourcePath);
        return {
          experiments: exps,
          sourceFilePaths: paths,
          _experimentSnapshots: snapshots,
          hoveredWell: null,
          dragPreviewWells: null,
          ...newView,
        };
      }

      // Save current experiment's view state before switching
      if (state.experiments.length > 0) {
        snapshots.set(state.activeExperimentIndex, snapshotViewState(state));
      }
      const newIndex = state.experiments.length;
      const newView = defaultViewState(data.wellsUsed);
      snapshots.set(newIndex, newView);
      if (sourcePath) paths.set(newIndex, sourcePath);
      return {
        experiments: [...state.experiments, data],
        activeExperimentIndex: newIndex,
        sourceFilePaths: paths,
        _experimentSnapshots: snapshots,
        hoveredWell: null,
        dragPreviewWells: null,
        ...newView,
      };
    }),

  getActiveSourcePath: () => {
    const state = get();
    return state.sourceFilePaths.get(state.activeExperimentIndex);
  },

  pushUndo: (description) => {
    const state = get();
    if (state._restoringSnapshot || state.experiments.length === 0) return;
    const idx = state.activeExperimentIndex;
    const undoStacks = new Map(state._undoStacks);
    const redoStacks = new Map(state._redoStacks);
    const stack = [...(undoStacks.get(idx) ?? [])];
    stack.push({ snapshot: snapshotViewState(state), description });
    if (stack.length > MAX_UNDO_DEPTH) stack.shift();
    undoStacks.set(idx, stack);
    redoStacks.set(idx, []); // clear redo on new action
    set({ _undoStacks: undoStacks, _redoStacks: redoStacks });
  },

  undo: () => {
    const state = get();
    const idx = state.activeExperimentIndex;
    const undoStack = [...(state._undoStacks.get(idx) ?? [])];
    if (undoStack.length === 0) return;
    const entry = undoStack.pop()!;
    const redoStack = [...(state._redoStacks.get(idx) ?? [])];
    redoStack.push({ snapshot: snapshotViewState(state), description: entry.description });
    const undoStacks = new Map(state._undoStacks);
    const redoStacks = new Map(state._redoStacks);
    undoStacks.set(idx, undoStack);
    redoStacks.set(idx, redoStack);
    set({ _restoringSnapshot: true, _undoStacks: undoStacks, _redoStacks: redoStacks, ...entry.snapshot });
    set({ _restoringSnapshot: false });
  },

  redo: () => {
    const state = get();
    const idx = state.activeExperimentIndex;
    const redoStack = [...(state._redoStacks.get(idx) ?? [])];
    if (redoStack.length === 0) return;
    const entry = redoStack.pop()!;
    const undoStack = [...(state._undoStacks.get(idx) ?? [])];
    undoStack.push({ snapshot: snapshotViewState(state), description: entry.description });
    const undoStacks = new Map(state._undoStacks);
    const redoStacks = new Map(state._redoStacks);
    undoStacks.set(idx, undoStack);
    redoStacks.set(idx, redoStack);
    set({ _restoringSnapshot: true, _undoStacks: undoStacks, _redoStacks: redoStacks, ...entry.snapshot });
    set({ _restoringSnapshot: false });
  },

  canUndo: () => {
    const state = get();
    return (state._undoStacks.get(state.activeExperimentIndex)?.length ?? 0) > 0;
  },

  canRedo: () => {
    const state = get();
    return (state._redoStacks.get(state.activeExperimentIndex)?.length ?? 0) > 0;
  },

  getUndoDescription: () => {
    const state = get();
    const stack = state._undoStacks.get(state.activeExperimentIndex);
    return stack?.length ? stack[stack.length - 1].description : undefined;
  },

  getRedoDescription: () => {
    const state = get();
    const stack = state._redoStacks.get(state.activeExperimentIndex);
    return stack?.length ? stack[stack.length - 1].description : undefined;
  },

  switchExperiment: (index) =>
    set((state) => {
      if (index === state.activeExperimentIndex) return {};
      if (index < 0 || index >= state.experiments.length) return {};
      const snapshots = new Map(state._experimentSnapshots);
      // Save current state
      snapshots.set(state.activeExperimentIndex, snapshotViewState(state));
      // Restore target state
      const target = snapshots.get(index) ?? defaultViewState(state.experiments[index]?.wellsUsed);
      return {
        activeExperimentIndex: index,
        _experimentSnapshots: snapshots,
        hoveredWell: null,
        dragPreviewWells: null,
        ...target,
      };
    }),

  removeExperiment: (index) =>
    set((state) => {
      if (state.experiments.length <= 1) {
        // Last tab — replace with Welcome instead of removing
        const newView = defaultViewState();
        return {
          experiments: [null],
          activeExperimentIndex: 0,
          sourceFilePaths: new Map(),
          _experimentSnapshots: new Map([[0, newView]]),
          hoveredWell: null,
          dragPreviewWells: null,
          ...newView,
        };
      }
      const experiments = state.experiments.filter((_, i) => i !== index);
      const snapshots = new Map<number, ExperimentViewState>();
      const paths = new Map<number, string>();
      // Re-index snapshots and source paths (skip removed, shift down higher indices)
      for (const [i, snap] of state._experimentSnapshots) {
        if (i < index) snapshots.set(i, snap);
        else if (i > index) snapshots.set(i - 1, snap);
      }
      for (const [i, p] of state.sourceFilePaths) {
        if (i < index) paths.set(i, p);
        else if (i > index) paths.set(i - 1, p);
      }

      // Determine new active index
      let newActive = state.activeExperimentIndex;
      if (index === state.activeExperimentIndex) {
        // Closing the active tab: switch to nearest
        newActive = Math.min(index, experiments.length - 1);
        const restored = snapshots.get(newActive) ?? defaultViewState(experiments[newActive]?.wellsUsed);
        return {
          experiments,
          activeExperimentIndex: newActive,
          sourceFilePaths: paths,
          _experimentSnapshots: snapshots,
          hoveredWell: null,
          dragPreviewWells: null,
          ...restored,
        };
      } else if (index < state.activeExperimentIndex) {
        newActive = state.activeExperimentIndex - 1;
      }
      return {
        experiments,
        activeExperimentIndex: newActive,
        sourceFilePaths: paths,
        _experimentSnapshots: snapshots,
        hoveredWell: null,
        dragPreviewWells: null,
      };
    }),

  setSelectedWells: (wells) => set({ selectedWells: wells }),
  addToSelection: (wells) =>
    set((state) => {
      const next = new Set(state.selectedWells);
      for (const w of wells) next.add(w);
      return { selectedWells: next };
    }),
  toggleWellSelection: (well) =>
    set((state) => {
      const next = new Set(state.selectedWells);
      if (next.has(well)) next.delete(well);
      else next.add(well);
      return { selectedWells: next };
    }),
  selectOnly: (well) => set({ selectedWells: new Set([well]) }),
  selectAll: () => {
    const exp = get().experiments[get().activeExperimentIndex];
    if (exp) set({ selectedWells: new Set(exp.wellsUsed) });
  },
  deselectAll: () => set({ selectedWells: new Set() }),
  selectByType: (type) => {
    const exp = get().experiments[get().activeExperimentIndex];
    if (!exp) return;
    const wells = exp.wellsUsed.filter((w) => {
      const content = exp.wells[w]?.content ?? '';
      if (type === 'Unkn') return content === 'Unkn' || content === '';
      return content === type;
    });
    set({ selectedWells: new Set(wells) });
  },
  selectShown: () => {
    const state = get();
    const exp = state.experiments[state.activeExperimentIndex];
    if (!exp) return;
    const wells = exp.wellsUsed.filter((w) => !state.hiddenWells.has(w));
    set({ selectedWells: new Set(wells) });
  },
  selectHidden: () => {
    const state = get();
    const exp = state.experiments[state.activeExperimentIndex];
    if (!exp) return;
    const wells = exp.wellsUsed.filter((w) => state.hiddenWells.has(w));
    set({ selectedWells: new Set(wells) });
  },
  toggleWellHidden: (well) => {
    get().pushUndo('Toggle visibility');
    set((state) => {
      const next = new Set(state.hiddenWells);
      if (next.has(well)) next.delete(well);
      else next.add(well);
      return { hiddenWells: next };
    });
  },
  showWells: (wells) => {
    get().pushUndo('Show wells');
    set((state) => {
      const next = new Set(state.hiddenWells);
      for (const w of wells) next.delete(w);
      return { hiddenWells: next };
    });
  },
  hideWells: (wells) => {
    get().pushUndo('Hide wells');
    set((state) => {
      const next = new Set(state.hiddenWells);
      for (const w of wells) next.add(w);
      return { hiddenWells: next };
    });
  },
  activateWells: (wells) => {
    get().pushUndo('Activate wells');
    set((state) => {
      const next = new Set(state.deactivatedWells);
      for (const w of wells) next.delete(w);
      return { deactivatedWells: next };
    });
  },
  deactivateWells: (wells) => {
    get().pushUndo('Deactivate wells');
    set((state) => {
      const next = new Set(state.deactivatedWells);
      for (const w of wells) next.add(w);
      return { deactivatedWells: next };
    });
  },
  setWellContentType: (wells, type) => {
    get().pushUndo('Set content type');
    set((state) => {
      const current = state.experiments[state.activeExperimentIndex];
      if (!current) return {};
      const exps = [...state.experiments];
      const exp = { ...current };
      const wellMap = { ...exp.wells };
      for (const w of wells) {
        if (wellMap[w]) wellMap[w] = { ...wellMap[w], content: type };
      }
      exp.wells = wellMap;
      exps[state.activeExperimentIndex] = exp;
      return { experiments: exps };
    });
  },
  setWellSampleName: (well, name) => {
    get().pushUndo('Set sample name');
    set((state) => {
      const current = state.experiments[state.activeExperimentIndex];
      if (!current) return {};
      const exps = [...state.experiments];
      const exp = { ...current };
      const wellMap = { ...exp.wells };
      if (wellMap[well]) wellMap[well] = { ...wellMap[well], sample: name };
      exp.wells = wellMap;
      exps[state.activeExperimentIndex] = exp;
      return { experiments: exps };
    });
  },
  setWellStyleOverride: (wells, style) => {
    get().pushUndo('Set well style');
    set((state) => {
      const next = new Map(state.wellStyleOverrides);
      for (const w of wells) {
        next.set(w, { ...next.get(w), ...style });
      }
      return { wellStyleOverrides: next };
    });
  },
  clearWellStyleOverrides: (wells) => {
    get().pushUndo('Clear well styles');
    set((state) => {
      const next = new Map(state.wellStyleOverrides);
      for (const w of wells) next.delete(w);
      return { wellStyleOverrides: next };
    });
  },
  setWellBaselineOverride: (wells, override) => {
    get().pushUndo('Set well baseline');
    set((state) => {
      const next = new Map(state.wellBaselineOverrides);
      for (const w of wells) {
        next.set(w, { ...next.get(w), ...override });
      }
      return { wellBaselineOverrides: next };
    });
  },
  clearWellBaselineOverrides: (wells) => {
    get().pushUndo('Clear well baselines');
    set((state) => {
      const next = new Map(state.wellBaselineOverrides);
      for (const w of wells) next.delete(w);
      return { wellBaselineOverrides: next };
    });
  },
  setWellGroup: (wells, group) => {
    get().pushUndo('Set group');
    set((state) => {
      const next = new Map(state.wellGroups);
      for (const w of wells) next.set(w, group);
      return { wellGroups: next };
    });
  },
  removeWellGroup: (wells) => {
    get().pushUndo('Remove group');
    set((state) => {
      const next = new Map(state.wellGroups);
      for (const w of wells) next.delete(w);
      return { wellGroups: next };
    });
  },
  autoGroupBySample: () => {
    const exp = get().experiments[get().activeExperimentIndex];
    if (!exp) return;
    get().pushUndo('Auto-group by sample');
    const next = new Map<string, string>();
    for (const w of exp.wellsUsed) {
      const sample = exp.wells[w]?.sample;
      if (sample) next.set(w, sample);
    }
    set({ wellGroups: next });
  },
  addToLegend: (wells) => {
    get().pushUndo('Add to legend');
    set((state) => {
      const next = new Set(state.legendWells);
      for (const w of wells) next.add(w);
      return { legendWells: next };
    });
  },
  removeFromLegend: (wells) => {
    get().pushUndo('Remove from legend');
    set((state) => {
      const next = new Set(state.legendWells);
      for (const w of wells) next.delete(w);
      return { legendWells: next };
    });
  },
  setHoveredWell: (well) => set({ hoveredWell: well }),
  setDragPreviewWells: (wells) => set({ dragPreviewWells: wells }),
  setXAxisMode: (mode) => set({ xAxisMode: mode }),
  setLogScale: (on) => set({ logScale: on }),
  setPlotTab: (tab) => set({ plotTab: tab }),
  setBaselineEnabled: (on) => { get().pushUndo('Toggle baseline'); set({ baselineEnabled: on }); },
  setBaselineAuto: (on) => { get().pushUndo('Toggle auto baseline'); set({ baselineAuto: on }); },
  setBaselineMethod: (method) => { get().pushUndo('Change baseline method'); set({ baselineMethod: method }); },
  setBaselineZone: (start, end) => set({ baselineStart: start, baselineEnd: end }),
  setShowRawOverlay: (on) => set({ showRawOverlay: on }),
  setThresholdEnabled: (on) => { get().pushUndo('Toggle threshold'); set({ thresholdEnabled: on }); },
  setThresholdRfu: (rfu) => set({ thresholdRfu: rfu }),
  setMeltThresholdEnabled: (on) => { get().pushUndo('Toggle melt threshold'); set({ meltThresholdEnabled: on }); },
  setMeltThresholdValue: (value) => set({ meltThresholdValue: value }),
  setSmoothingEnabled: (on) => { get().pushUndo('Toggle smoothing'); set({ smoothingEnabled: on }); },
  setSmoothingWindow: (window) => set({ smoothingWindow: window }),
  setSmoothingMeltDerivative: (on) => set({ smoothingMeltDerivative: on }),
  setFittingEnabled: (on) => set({ fittingEnabled: on }),
  setFitStartFraction: (fraction) => set({ fitStartFraction: fraction }),
  setFitEndFraction: (fraction) => set({ fitEndFraction: fraction }),
  setDilutionConfig: (config) => set({ dilutionConfig: config }),
  setDilutionStepEnabled: (stepIndex, enabled) =>
    set((state) => {
      if (!state.dilutionConfig) return {};
      const steps = state.dilutionConfig.steps.map((s, i) =>
        i === stepIndex ? { ...s, enabled } : s
      );
      return { dilutionConfig: { ...state.dilutionConfig, steps } };
    }),
  setPalette: (palette) => { get().pushUndo('Change palette'); set({ palette }); },
  setLineWidth: (width) => set({ lineWidth: width }),
  setFontFamily: (font) => set({ fontFamily: font }),
  setTitleSize: (size) => set({ titleSize: size }),
  setLabelSize: (size) => set({ labelSize: size }),
  setTickSize: (size) => set({ tickSize: size }),
  setLegendSize: (size) => set({ legendSize: size }),
  setShowLegend: (on) => { get().pushUndo('Toggle legend'); set({ showLegend: on }); },
  setShowLegendAmp: (on) => set({ showLegendAmp: on }),
  setShowLegendMelt: (on) => set({ showLegendMelt: on }),
  setShowLegendDoubling: (on) => set({ showLegendDoubling: on }),
  setLegendPosition: (pos) => set({ legendPosition: pos }),
  setLegendContent: (content) => set({ legendContent: content }),
  setLegendVisibleOnly: (on) => set({ legendVisibleOnly: on }),
  setPaletteReversed: (reversed) => { get().pushUndo('Reverse palette'); set({ paletteReversed: reversed }); },
  setPaletteGroupColors: (on) => { get().pushUndo('Toggle group colors'); set({ paletteGroupColors: on }); },
  setSelectionPaletteGroupColors: (on) => set({ selectionPaletteGroupColors: on }),
  reversePalette: () => { get().pushUndo('Reverse palette'); set((state) => ({ paletteReversed: !state.paletteReversed })); },
  setShowGrid: (on) => set({ showGrid: on }),
  setGridAlpha: (alpha) => set({ gridAlpha: alpha }),
  setPlotBgColor: (color) => set({ plotBgColor: color }),
  setFigureDpi: (dpi) => set({ figureDpi: dpi }),
  setShowDilutionWizard: (show) => set({ showDilutionWizard: show }),
  setShowExportWizard: (show) => set({ showExportWizard: show }),
}));

// Dev: expose store for debugging
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__STORE__ = useAppState;
}
