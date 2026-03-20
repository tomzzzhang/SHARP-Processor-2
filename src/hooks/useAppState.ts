import { create } from 'zustand';
import type { ExperimentData, XAxisMode, ContentType } from '../types/experiment';
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

/** State that is isolated per experiment tab */
export interface ExperimentViewState {
  // Selection
  selectedWells: Set<string>;
  hiddenWells: Set<string>;
  deactivatedWells: Set<string>;

  // Per-well overrides
  wellStyleOverrides: Map<string, WellStyleOverride>;
  wellGroups: Map<string, string>;
  legendWells: Set<string>;

  // View
  xAxisMode: XAxisMode;
  logScale: boolean;
  plotTab: PlotTab;

  // Analysis - Baseline
  baselineEnabled: boolean;
  baselineMethod: 'horizontal' | 'linear';
  baselineStart: number;
  baselineEnd: number;
  showRawOverlay: boolean;

  // Analysis - Threshold
  thresholdEnabled: boolean;
  thresholdRfu: number;

  // Analysis - Fitting
  fittingEnabled: boolean;
  fitStartFraction: number;
  fitEndFraction: number;

  // Style
  palette: string;
  paletteReversed: boolean;
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
  legendVisibleOnly: boolean;
  showGrid: boolean;
  gridAlpha: number;
  figureDpi: number;
}

function defaultViewState(wellsUsed: string[] = []): ExperimentViewState {
  return {
    selectedWells: new Set(wellsUsed),
    hiddenWells: new Set(),
    deactivatedWells: new Set(),
    wellStyleOverrides: new Map(),
    wellGroups: new Map(),
    legendWells: new Set(),
    xAxisMode: 'time_min',
    logScale: false,
    plotTab: 'amplification',
    baselineEnabled: true,
    baselineMethod: DEFAULT_BASELINE_METHOD,
    baselineStart: DEFAULT_BASELINE_START,
    baselineEnd: DEFAULT_BASELINE_END,
    showRawOverlay: false,
    thresholdEnabled: false,
    thresholdRfu: DEFAULT_THRESHOLD_RFU,
    fittingEnabled: false,
    fitStartFraction: 0.10,
    fitEndFraction: 0.90,
    palette: 'Tableau 10',
    paletteReversed: false,
    lineWidth: DEFAULT_LINE_WIDTH,
    fontFamily: DEFAULT_FONT_FAMILY,
    titleSize: DEFAULT_TITLE_SIZE,
    labelSize: DEFAULT_LABEL_SIZE,
    tickSize: DEFAULT_TICK_SIZE,
    legendSize: DEFAULT_LEGEND_SIZE,
    showLegend: false,
    showLegendAmp: true,
    showLegendMelt: true,
    showLegendDoubling: true,
    legendPosition: 'best',
    legendVisibleOnly: true,
    showGrid: true,
    gridAlpha: DEFAULT_GRID_ALPHA,
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
    wellGroups: state.wellGroups,
    legendWells: state.legendWells,
    xAxisMode: state.xAxisMode,
    logScale: state.logScale,
    plotTab: state.plotTab,
    baselineEnabled: state.baselineEnabled,
    baselineMethod: state.baselineMethod,
    baselineStart: state.baselineStart,
    baselineEnd: state.baselineEnd,
    showRawOverlay: state.showRawOverlay,
    thresholdEnabled: state.thresholdEnabled,
    thresholdRfu: state.thresholdRfu,
    fittingEnabled: state.fittingEnabled,
    fitStartFraction: state.fitStartFraction,
    fitEndFraction: state.fitEndFraction,
    palette: state.palette,
    paletteReversed: state.paletteReversed,
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
    legendVisibleOnly: state.legendVisibleOnly,
    showGrid: state.showGrid,
    gridAlpha: state.gridAlpha,
    figureDpi: state.figureDpi,
  };
}

interface AppState extends ExperimentViewState {
  // Data
  experiments: ExperimentData[];
  activeExperimentIndex: number;

  // Transient (not per-experiment)
  hoveredWell: string | null;
  dragPreviewWells: Set<string> | null;

  // Per-experiment state snapshots (index → snapshot)
  _experimentSnapshots: Map<number, ExperimentViewState>;

  // Actions
  loadExperiment: (data: ExperimentData) => void;
  switchExperiment: (index: number) => void;
  removeExperiment: (index: number) => void;
  setSelectedWells: (wells: Set<string>) => void;
  addToSelection: (wells: string[]) => void;
  toggleWellSelection: (well: string) => void;
  selectOnly: (well: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  selectByType: (type: string) => void;
  toggleWellHidden: (well: string) => void;
  showWells: (wells: string[]) => void;
  hideWells: (wells: string[]) => void;
  activateWells: (wells: string[]) => void;
  deactivateWells: (wells: string[]) => void;
  setWellContentType: (wells: string[], type: ContentType) => void;
  setWellStyleOverride: (wells: string[], style: WellStyleOverride) => void;
  clearWellStyleOverrides: (wells: string[]) => void;
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
  setBaselineMethod: (method: 'horizontal' | 'linear') => void;
  setBaselineZone: (start: number, end: number) => void;
  setShowRawOverlay: (on: boolean) => void;
  setThresholdEnabled: (on: boolean) => void;
  setThresholdRfu: (rfu: number) => void;
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
  setLegendVisibleOnly: (on: boolean) => void;
  setPaletteReversed: (reversed: boolean) => void;
  reversePalette: () => void;
  setShowGrid: (on: boolean) => void;
  setGridAlpha: (alpha: number) => void;
  setFigureDpi: (dpi: number) => void;
}

export const useAppState = create<AppState>((set, get) => ({
  experiments: [],
  activeExperimentIndex: 0,
  _experimentSnapshots: new Map(),
  hoveredWell: null,
  dragPreviewWells: null,

  // Spread default view state as initial top-level fields
  ...defaultViewState(),

  loadExperiment: (data) =>
    set((state) => {
      const snapshots = new Map(state._experimentSnapshots);
      // Save current experiment's view state before switching
      if (state.experiments.length > 0) {
        snapshots.set(state.activeExperimentIndex, snapshotViewState(state));
      }
      const newIndex = state.experiments.length;
      const newView = defaultViewState(data.wellsUsed);
      snapshots.set(newIndex, newView);
      return {
        experiments: [...state.experiments, data],
        activeExperimentIndex: newIndex,
        _experimentSnapshots: snapshots,
        hoveredWell: null,
        dragPreviewWells: null,
        ...newView,
      };
    }),

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
      if (state.experiments.length <= 1) return {}; // Don't remove the last one
      const experiments = state.experiments.filter((_, i) => i !== index);
      const snapshots = new Map<number, ExperimentViewState>();
      // Re-index snapshots (skip removed, shift down higher indices)
      for (const [i, snap] of state._experimentSnapshots) {
        if (i < index) snapshots.set(i, snap);
        else if (i > index) snapshots.set(i - 1, snap);
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
        _experimentSnapshots: snapshots,
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
  toggleWellHidden: (well) =>
    set((state) => {
      const next = new Set(state.hiddenWells);
      if (next.has(well)) next.delete(well);
      else next.add(well);
      return { hiddenWells: next };
    }),
  showWells: (wells) =>
    set((state) => {
      const next = new Set(state.hiddenWells);
      for (const w of wells) next.delete(w);
      return { hiddenWells: next };
    }),
  hideWells: (wells) =>
    set((state) => {
      const next = new Set(state.hiddenWells);
      for (const w of wells) next.add(w);
      return { hiddenWells: next };
    }),
  activateWells: (wells) =>
    set((state) => {
      const next = new Set(state.deactivatedWells);
      for (const w of wells) next.delete(w);
      return { deactivatedWells: next };
    }),
  deactivateWells: (wells) =>
    set((state) => {
      const next = new Set(state.deactivatedWells);
      for (const w of wells) next.add(w);
      return { deactivatedWells: next };
    }),
  setWellContentType: (wells, type) =>
    set((state) => {
      const exps = [...state.experiments];
      const exp = { ...exps[state.activeExperimentIndex] };
      const wellMap = { ...exp.wells };
      for (const w of wells) {
        if (wellMap[w]) wellMap[w] = { ...wellMap[w], content: type };
      }
      exp.wells = wellMap;
      exps[state.activeExperimentIndex] = exp;
      return { experiments: exps };
    }),
  setWellStyleOverride: (wells, style) =>
    set((state) => {
      const next = new Map(state.wellStyleOverrides);
      for (const w of wells) {
        next.set(w, { ...next.get(w), ...style });
      }
      return { wellStyleOverrides: next };
    }),
  clearWellStyleOverrides: (wells) =>
    set((state) => {
      const next = new Map(state.wellStyleOverrides);
      for (const w of wells) next.delete(w);
      return { wellStyleOverrides: next };
    }),
  setWellGroup: (wells, group) =>
    set((state) => {
      const next = new Map(state.wellGroups);
      for (const w of wells) next.set(w, group);
      return { wellGroups: next };
    }),
  removeWellGroup: (wells) =>
    set((state) => {
      const next = new Map(state.wellGroups);
      for (const w of wells) next.delete(w);
      return { wellGroups: next };
    }),
  autoGroupBySample: () => {
    const exp = get().experiments[get().activeExperimentIndex];
    if (!exp) return;
    const next = new Map<string, string>();
    for (const w of exp.wellsUsed) {
      const sample = exp.wells[w]?.sample;
      if (sample) next.set(w, sample);
    }
    set({ wellGroups: next });
  },
  addToLegend: (wells) =>
    set((state) => {
      const next = new Set(state.legendWells);
      for (const w of wells) next.add(w);
      return { legendWells: next };
    }),
  removeFromLegend: (wells) =>
    set((state) => {
      const next = new Set(state.legendWells);
      for (const w of wells) next.delete(w);
      return { legendWells: next };
    }),
  setHoveredWell: (well) => set({ hoveredWell: well }),
  setDragPreviewWells: (wells) => set({ dragPreviewWells: wells }),
  setXAxisMode: (mode) => set({ xAxisMode: mode }),
  setLogScale: (on) => set({ logScale: on }),
  setPlotTab: (tab) => set({ plotTab: tab }),
  setBaselineEnabled: (on) => set({ baselineEnabled: on }),
  setBaselineMethod: (method) => set({ baselineMethod: method }),
  setBaselineZone: (start, end) => set({ baselineStart: start, baselineEnd: end }),
  setShowRawOverlay: (on) => set({ showRawOverlay: on }),
  setThresholdEnabled: (on) => set({ thresholdEnabled: on }),
  setThresholdRfu: (rfu) => set({ thresholdRfu: rfu }),
  setPalette: (palette) => set({ palette }),
  setLineWidth: (width) => set({ lineWidth: width }),
  setFontFamily: (font) => set({ fontFamily: font }),
  setTitleSize: (size) => set({ titleSize: size }),
  setLabelSize: (size) => set({ labelSize: size }),
  setTickSize: (size) => set({ tickSize: size }),
  setLegendSize: (size) => set({ legendSize: size }),
  setShowLegend: (on) => set({ showLegend: on }),
  setShowLegendAmp: (on) => set({ showLegendAmp: on }),
  setShowLegendMelt: (on) => set({ showLegendMelt: on }),
  setShowLegendDoubling: (on) => set({ showLegendDoubling: on }),
  setLegendPosition: (pos) => set({ legendPosition: pos }),
  setLegendVisibleOnly: (on) => set({ legendVisibleOnly: on }),
  setPaletteReversed: (reversed) => set({ paletteReversed: reversed }),
  reversePalette: () => set((state) => ({ paletteReversed: !state.paletteReversed })),
  setShowGrid: (on) => set({ showGrid: on }),
  setGridAlpha: (alpha) => set({ gridAlpha: alpha }),
  setFigureDpi: (dpi) => set({ figureDpi: dpi }),
}));
