import { create } from 'zustand';
import type { ExperimentData, XAxisMode, ContentType, WellInfo } from '../types/experiment';
import { normalizeExperiment } from '../lib/parsers/utils';
import { curveKey, wellCurves, curvesToWells, parseCurveKey } from '../lib/curves';
import type { DilutionConfig } from '../lib/analysis';
import {
  DEFAULT_BASELINE_METHOD, DEFAULT_BASELINE_START, DEFAULT_BASELINE_END,
  DEFAULT_THRESHOLD_RFU, DEFAULT_LINE_WIDTH, DEFAULT_FONT_FAMILY,
  DEFAULT_TITLE_SIZE, DEFAULT_LABEL_SIZE, DEFAULT_TICK_SIZE,
  DEFAULT_LEGEND_SIZE, DEFAULT_FIGURE_DPI, DEFAULT_GRID_ALPHA, CHANNEL_DASH,
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

export interface WellNormalizeOverride {
  /** Per-well opt-out of normalization. undefined = on (follows global
   *  normalizeEnabled). false = this well stays raw/corrected. */
  enabled?: boolean;
  /** Plateau fit zone (1-indexed cycles). Used only when plateauAuto is false. */
  plateauStart?: number;
  plateauEnd?: number;
  /** undefined = auto-detect the plateau region; false = use plateauStart/End. */
  plateauAuto?: boolean;
}

/** Analysis settings tracked independently per fluorescence channel. These
 *  are mirrored onto top-level store fields for the ACTIVE channel; the full
 *  per-channel set lives in `_channelSnapshots`. Single-channel experiments
 *  carry exactly one entry (`'default'`), so behavior is unchanged from before
 *  the channel split. */
export interface ChannelAnalysisState {
  // Per-well overrides (per channel)
  wellBaselineOverrides: Map<string, WellBaselineOverride>;
  wellNormalizeOverrides: Map<string, WellNormalizeOverride>;

  // Baseline
  baselineEnabled: boolean;
  baselineAuto: boolean;     // auto-detect flat baseline region per well
  baselineMethod: 'horizontal' | 'linear';
  baselineStart: number;
  baselineEnd: number;

  // Global drift correction (run-level slope, applied pre-baseline)
  driftCorrectionEnabled: boolean;

  // Normalization (rescale curves 0→1 between baseline and plateau)
  normalizeEnabled: boolean;

  // Melt RFU normalization (HRM-style 1→0 rescale, display only)
  meltNormalizeEnabled: boolean;

  // Threshold
  thresholdEnabled: boolean;
  thresholdRfu: number;

  // Melt Threshold
  meltThresholdEnabled: boolean;
  meltThresholdValue: number;  // -dF/dT threshold

  // Smoothing (amplification only; melt -dF/dT is pre-smoothed at the parser
  // via the BioRad CFX Maestro algorithm port in src/lib/parsers/utils.ts —
  // no post-smoothing needed).
  smoothingEnabled: boolean;
  smoothingWindow: number;  // odd, 5-21

  // Fitting
  fittingEnabled: boolean;
  fitStartFraction: number;
  fitEndFraction: number;
}

/** Which kinetic landmarks are drawn on the amplification plot. Per-experiment
 *  view state: saved into a `.sharpx` `session.json` and restored on reopen, so
 *  a saved view redraws with the same markers it was saved with. */
export interface LandmarkVisibility {
  lod: boolean;
  onset: boolean;
  infl: boolean;
}

/** State that is isolated per experiment tab and shared across that
 *  experiment's channels (selection, grouping, style, channel display). */
export interface ExperimentViewState {
  // Selection — curve-level (S-C pairs, keyed by curveKey(well, channel)) is the
  // primary selection; `selectedWells` is a DERIVED mirror (wells owning ≥1
  // selected curve) kept in sync by every selection action, so well-level
  // surfaces (grid, list, menus, visibility, sample/type/baseline) read it
  // unchanged. Single channel ⇒ one curve per well ⇒ the two are isomorphic.
  selectedCurves: Set<string>;
  selectedWells: Set<string>;
  hiddenWells: Set<string>;
  deactivatedWells: Set<string>;

  // Per-well overrides (shared across channels)
  wellStyleOverrides: Map<string, WellStyleOverride>;
  wellGroups: Map<string, string>;
  legendWells: Set<string>;

  // Per-curve (S-C pair) overrides — keyed by curveKey(well, channel). Layered
  // on top of the per-well maps (curve → well → palette default) so one
  // channel's curve can be styled / grouped independently of the well's others.
  curveStyleOverrides: Map<string, WellStyleOverride>;
  curveGroups: Map<string, string>;

  // Channels — display + identity (shared across an experiment's channels)
  activeChannel: string;                          // channel the Analysis tab edits
  visibleChannels: Set<string>;                   // global channel enable toggles
  wellChannelHidden: Map<string, Set<string>>;    // per-well channel suppression
  channelLabels: Map<string, string>;             // user fluorophore overrides
  channelColors: Map<string, string>;             // per-channel colour overrides
  channelLineStyles: Map<string, string>;         // per-channel dash override (channel → dash)
  /** 'single' = show one channel at a time with the simple v0.1.x UI (channel
   *  chrome hidden); 'multi' = the full multichannel overlay. Autodetected on
   *  load from channel count; switchable via the View menu. */
  viewMode: 'single' | 'multi';

  // View
  xAxisMode: XAxisMode;
  logScale: boolean;
  autoScale: boolean;                             // re-fit axes on transform change
  plotTab: PlotTab;

  showRawOverlay: boolean;

  /** Kinetic landmarks drawn on the amplification plot (Analysis → Kinetics).
   *  Per-experiment so each tab keeps its own, and saved with the view. */
  landmarks: LandmarkVisibility;

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
  legendContent: 'well' | 'sample' | 'group';
  legendOrder: string[];
  showTitle: boolean;
  showLabels: boolean;
  showTicks: boolean;
  /** Legend shows only SELECTED curves/wells when on (UI label: "Selected wells only"). */
  legendVisibleOnly: boolean;
  showGrid: boolean;
  gridAlpha: number;
  plotBgColor: string;  // '' = auto (off-white for light, dark surface for dark)
  textColor: 'auto' | 'black' | 'white';
  figureDpi: number;
}

/** All curveKeys for the given wells × channels (the "all curves" set). */
function wellsToCurves(wells: Iterable<string>, channels: string[]): Set<string> {
  const out = new Set<string>();
  for (const w of wells) for (const c of channels) out.add(curveKey(w, c));
  return out;
}

/** The active experiment's channel list (for expanding a well → its curves). */
function activeChannels(s: AppState): string[] {
  return s.experiments[s.activeExperimentIndex]?.channels ?? [];
}

/** Selection delta: set the primary curve selection + recompute the derived
 *  well mirror (`selectedWells` = wells owning ≥1 selected curve). Every
 *  selection action returns this so the two stay consistent. */
function applySelection(curves: Set<string>): Pick<AppState, 'selectedCurves' | 'selectedWells'> {
  return { selectedCurves: curves, selectedWells: curvesToWells(curves) };
}

/** Default per-channel analysis settings. One of these exists per channel. */
function defaultChannelState(): ChannelAnalysisState {
  return {
    wellBaselineOverrides: new Map(),
    wellNormalizeOverrides: new Map(),
    baselineEnabled: true,
    baselineAuto: true,
    baselineMethod: DEFAULT_BASELINE_METHOD,
    baselineStart: DEFAULT_BASELINE_START,
    baselineEnd: DEFAULT_BASELINE_END,
    driftCorrectionEnabled: false,
    normalizeEnabled: false,
    meltNormalizeEnabled: false,
    thresholdEnabled: false,
    thresholdRfu: DEFAULT_THRESHOLD_RFU,
    meltThresholdEnabled: false,
    meltThresholdValue: 400,
    smoothingEnabled: false,
    smoothingWindow: 11,
    fittingEnabled: false,
    fitStartFraction: 0.10,
    fitEndFraction: 0.90,
  };
}

function defaultViewState(wellsUsed: string[] = [], channels: string[] = []): ExperimentViewState {
  return {
    selectedCurves: wellsToCurves(wellsUsed, channels),
    selectedWells: new Set(wellsUsed),
    hiddenWells: new Set(),
    deactivatedWells: new Set(),
    wellStyleOverrides: new Map(),
    wellGroups: new Map(),
    legendWells: new Set(),
    curveStyleOverrides: new Map(),
    curveGroups: new Map(),
    activeChannel: channels[0] ?? 'default',
    visibleChannels: new Set(channels),
    wellChannelHidden: new Map(),
    channelLabels: new Map(),
    channelColors: new Map(),
    channelLineStyles: new Map(),
    viewMode: channels.length > 1 ? 'multi' : 'single',
    xAxisMode: 'time_min',
    logScale: false,
    autoScale: true,
    plotTab: 'amplification',
    showRawOverlay: false,
    landmarks: { lod: false, onset: false, infl: false },
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
    legendOrder: [],
    showTitle: true,
    showLabels: true,
    showTicks: true,
    legendVisibleOnly: false,
    showGrid: true,
    gridAlpha: DEFAULT_GRID_ALPHA,
    plotBgColor: '',
    textColor: 'auto',
    figureDpi: DEFAULT_FIGURE_DPI,
  };
}

/** Extract current shared per-experiment view state fields from the store
 *  (everything except the per-channel analysis fields, which live in
 *  `snapshotChannelState`). */
function snapshotViewState(state: AppState): ExperimentViewState {
  return {
    selectedCurves: state.selectedCurves,
    selectedWells: state.selectedWells,
    hiddenWells: state.hiddenWells,
    deactivatedWells: state.deactivatedWells,
    wellStyleOverrides: state.wellStyleOverrides,
    wellGroups: state.wellGroups,
    legendWells: state.legendWells,
    curveStyleOverrides: state.curveStyleOverrides,
    curveGroups: state.curveGroups,
    activeChannel: state.activeChannel,
    visibleChannels: state.visibleChannels,
    wellChannelHidden: state.wellChannelHidden,
    channelLabels: state.channelLabels,
    channelColors: state.channelColors,
    channelLineStyles: state.channelLineStyles,
    viewMode: state.viewMode,
    xAxisMode: state.xAxisMode,
    logScale: state.logScale,
    autoScale: state.autoScale,
    plotTab: state.plotTab,
    showRawOverlay: state.showRawOverlay,
    landmarks: state.landmarks,
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
    legendOrder: state.legendOrder,
    showTitle: state.showTitle,
    showLabels: state.showLabels,
    showTicks: state.showTicks,
    legendVisibleOnly: state.legendVisibleOnly,
    showGrid: state.showGrid,
    gridAlpha: state.gridAlpha,
    plotBgColor: state.plotBgColor,
    textColor: state.textColor,
    figureDpi: state.figureDpi,
  };
}

/** Extract the active channel's per-channel analysis settings from the
 *  top-level (mirror) fields. */
function snapshotChannelState(state: ChannelAnalysisState): ChannelAnalysisState {
  return {
    wellBaselineOverrides: state.wellBaselineOverrides,
    wellNormalizeOverrides: state.wellNormalizeOverrides,
    baselineEnabled: state.baselineEnabled,
    baselineAuto: state.baselineAuto,
    baselineMethod: state.baselineMethod,
    baselineStart: state.baselineStart,
    baselineEnd: state.baselineEnd,
    driftCorrectionEnabled: state.driftCorrectionEnabled,
    normalizeEnabled: state.normalizeEnabled,
    meltNormalizeEnabled: state.meltNormalizeEnabled,
    thresholdEnabled: state.thresholdEnabled,
    thresholdRfu: state.thresholdRfu,
    meltThresholdEnabled: state.meltThresholdEnabled,
    meltThresholdValue: state.meltThresholdValue,
    smoothingEnabled: state.smoothingEnabled,
    smoothingWindow: state.smoothingWindow,
    fittingEnabled: state.fittingEnabled,
    fitStartFraction: state.fitStartFraction,
    fitEndFraction: state.fitEndFraction,
  };
}

/** Build the active experiment's complete channel→state map, refreshing the
 *  active channel's entry from the live top-level mirror fields. Returns a
 *  fresh outer Map so callers can store it without further cloning. */
function flushChannel(state: AppState): Map<string, ChannelAnalysisState> {
  const map = new Map(state._channelSnapshots.get(state.activeExperimentIndex) ?? []);
  map.set(state.activeChannel, snapshotChannelState(state));
  return map;
}

/** Re-point an experiment's derived `amplification`/`melt` to a given channel. */
function withActiveChannel(exp: ExperimentData, channel: string): ExperimentData {
  return {
    ...exp,
    amplification: exp.amplificationByChannel[channel] ?? null,
    melt: exp.meltByChannel[channel] ?? null,
  };
}

/** Compute the store delta for a flat analysis-setting change. Always updates
 *  the active channel's live mirror (`partial`); when the Analysis tab is in
 *  "All channels" scope (`analysisScopeAll`), also merges `partial` into every
 *  channel's snapshot for the active experiment so one edit broadcasts across
 *  channels. Per-well override edits intentionally do NOT route through here —
 *  they stay on the viewed channel. */
function broadcastAnalysis(s: AppState, partial: Partial<ChannelAnalysisState>): Partial<AppState> {
  if (!s.analysisScopeAll) return partial;
  const idx = s.activeExperimentIndex;
  const channelSnaps = new Map(s._channelSnapshots);
  const map = new Map(channelSnaps.get(idx) ?? []);
  const exp = s.experiments[idx];
  const channels = exp?.channels ?? [...map.keys()];
  for (const ch of channels) {
    const base = ch === s.activeChannel ? snapshotChannelState(s) : (map.get(ch) ?? defaultChannelState());
    map.set(ch, { ...base, ...partial });
  }
  channelSnaps.set(idx, map);
  return { ...partial, _channelSnapshots: channelSnaps };
}

/** View-state fields that are Sets — serialized as plain arrays. */
const SESSION_SET_FIELDS = ['selectedCurves', 'selectedWells', 'hiddenWells', 'deactivatedWells', 'legendWells', 'visibleChannels'] as const;
/** Shared view-state fields that are Maps — serialized as [key, value] entry
 *  arrays. (Per-channel override Maps live in the channel snapshots instead.) */
const SESSION_MAP_FIELDS = ['wellStyleOverrides', 'wellGroups', 'curveStyleOverrides', 'curveGroups', 'channelLabels', 'channelColors', 'channelLineStyles'] as const;
/** Per-channel Maps inside a `ChannelAnalysisState`. */
const CHANNEL_MAP_FIELDS = ['wellBaselineOverrides', 'wellNormalizeOverrides'] as const;
/** Per-channel keys, used to strip legacy top-level analysis fields out of the
 *  shared view partial when reading a pre-channel `.sharpx`. */
const CHANNEL_STATE_KEYS: (keyof ChannelAnalysisState)[] = [
  'wellBaselineOverrides', 'wellNormalizeOverrides',
  'baselineEnabled', 'baselineAuto', 'baselineMethod', 'baselineStart', 'baselineEnd',
  'driftCorrectionEnabled', 'normalizeEnabled', 'meltNormalizeEnabled',
  'thresholdEnabled', 'thresholdRfu', 'meltThresholdEnabled', 'meltThresholdValue',
  'smoothingEnabled', 'smoothingWindow', 'fittingEnabled', 'fitStartFraction', 'fitEndFraction',
];

/** Narrow an unknown session field to a plain object (not null, not an array). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Serialize a shared view-state snapshot to a JSON-safe object for a
 *  `.sharpx` session file (Sets → arrays, Maps → entry arrays). The nested
 *  `wellChannelHidden` (Map<well, Set<channel>>) is flattened to
 *  `[well, channel[]]` entries. */
function serializeViewState(vs: ExperimentViewState): Record<string, unknown> {
  const out: Record<string, unknown> = { ...vs };
  for (const f of SESSION_SET_FIELDS) out[f] = [...(vs[f] as Set<string>)];
  for (const f of SESSION_MAP_FIELDS) out[f] = [...(vs[f] as Map<string, unknown>).entries()];
  out.wellChannelHidden = [...vs.wellChannelHidden].map(([w, set]) => [w, [...set]]);
  return out;
}

/** Inverse of `serializeViewState` — rebuilds Sets/Maps. Missing fields are
 *  left for the caller's defaults to fill, so a session written by another
 *  app version still loads cleanly. Per-channel analysis keys (legacy
 *  top-level form) and the serialized channel snapshots are stripped — those
 *  are handled by `parseSession`. */
function deserializeViewState(obj: Record<string, unknown>): Partial<ExperimentViewState> {
  const out: Record<string, unknown> = { ...obj };
  for (const f of SESSION_SET_FIELDS) {
    if (Array.isArray(obj[f])) out[f] = new Set(obj[f] as string[]);
  }
  for (const f of SESSION_MAP_FIELDS) {
    if (Array.isArray(obj[f])) out[f] = new Map(obj[f] as [string, unknown][]);
  }
  if (Array.isArray(obj.wellChannelHidden)) {
    out.wellChannelHidden = new Map(
      (obj.wellChannelHidden as [string, string[]][]).map(([w, arr]) => [w, new Set(arr)]),
    );
  }
  // `landmarks` is a nested object, so a plain spread over the defaults would
  // replace it wholesale and leave any key the file omits `undefined`. Rebuild
  // it key-by-key instead: a pre-1.3 `.sharpx` (no `landmarks` at all) drops the
  // field so the caller's default wins, and a partial block fills the rest with
  // `false` rather than drawing markers the saved view never had.
  if (isRecord(obj.landmarks)) {
    const lm = obj.landmarks;
    out.landmarks = { lod: lm.lod === true, onset: lm.onset === true, infl: lm.infl === true };
  } else {
    delete out.landmarks;
  }
  for (const k of CHANNEL_STATE_KEYS) delete out[k];
  delete out.channelSnapshots;
  return out as Partial<ExperimentViewState>;
}

/** Serialize one channel's analysis state (its Maps → entry arrays). */
function serializeChannelState(cs: ChannelAnalysisState): Record<string, unknown> {
  const out: Record<string, unknown> = { ...cs };
  for (const f of CHANNEL_MAP_FIELDS) out[f] = [...(cs[f] as Map<string, unknown>).entries()];
  return out;
}

/** Inverse of `serializeChannelState` — fills missing fields from defaults. */
function deserializeChannelState(obj: Record<string, unknown>): ChannelAnalysisState {
  const base = defaultChannelState();
  const out = { ...base, ...obj } as Record<string, unknown>;
  for (const f of CHANNEL_MAP_FIELDS) {
    out[f] = Array.isArray(obj[f]) ? new Map(obj[f] as [string, unknown][]) : base[f];
  }
  // Re-extract only the known keys so stray serialized fields don't leak in.
  return snapshotChannelState(out as unknown as ChannelAnalysisState);
}

/** Parse a `.sharpx` session blob into the shared view partial plus the full
 *  per-channel state map. Handles both the channel-aware form
 *  (`channelSnapshots`) and the pre-channel form (analysis settings stored at
 *  the top level — folded into every channel). */
function parseSession(session: Record<string, unknown>, channels: string[]): {
  view: Partial<ExperimentViewState>;
  channelMap: Map<string, ChannelAnalysisState>;
} {
  const view = deserializeViewState(session);
  const channelMap = new Map<string, ChannelAnalysisState>();
  if (Array.isArray(session.channelSnapshots)) {
    for (const [ch, cs] of session.channelSnapshots as [string, Record<string, unknown>][]) {
      channelMap.set(ch, deserializeChannelState(cs));
    }
  } else {
    // Pre-channel `.sharpx`: analysis settings lived at the top level. Fold
    // them into every channel so a single-channel session still restores.
    const legacy = deserializeChannelState(session);
    for (const ch of channels) channelMap.set(ch, legacy);
  }
  return { view, channelMap };
}

interface UndoEntry {
  snapshot: ExperimentViewState;
  /** The active experiment's complete channel→state map at action time. Stored
   *  in full (not just the active channel) so an undo after a channel switch
   *  restores every channel's settings rather than corrupting inactive ones. */
  channelSnapshot: Map<string, ChannelAnalysisState>;
  /** Snapshot of the active experiment at the time of the action.
   *  Needed to undo data mutations (sample rename, content-type change)
   *  that live inside `ExperimentData.wells`, not in the view state. */
  experimentData: ExperimentData | null;
  description: string;
}

const MAX_UNDO_DEPTH = 50;

/** A sample whose name reads as a no-template control (NTC, NTC 1,
 *  NTC-2, …). */
function isNtcName(sample: string): boolean {
  return /^ntc(\d|\s|[-_]|$)/i.test(sample.trim());
}

/** Infer content type from sample name: a well named "NTC" is a
 *  no-template control. Applied on load so NTC wells don't need their
 *  type set by hand. */
function inferContentTypes(data: ExperimentData): ExperimentData {
  let changed = false;
  const wells: Record<string, WellInfo> = {};
  for (const [k, w] of Object.entries(data.wells)) {
    if (w.content !== 'Neg Ctrl' && isNtcName(w.sample)) {
      wells[k] = { ...w, content: 'Neg Ctrl' };
      changed = true;
    } else {
      wells[k] = w;
    }
  }
  return changed ? { ...data, wells } : data;
}

/**
 * Resolve a freshly-loaded experiment into the view + per-channel analysis
 * state the app adopts for it: normalize the channel model, infer NTC content
 * types, restore any `.sharpx` session over the defaults, backfill curve
 * selection for pre-curve sessions, and seed parser-detected empty wells into
 * `deactivatedWells`.
 *
 * Pure — a function of `data` alone, with no dependency on current store state.
 * Extracted verbatim from `loadExperiment` (which now calls it) so a headless
 * consumer reconstructs exactly the state the GUI would show for the same file
 * rather than reimplementing the merge and silently drifting from it.
 */
export function resolveExperimentState(input: ExperimentData): {
  /** Normalized experiment with `amplification`/`melt` pointed at the active channel. */
  data: ExperimentData;
  view: ExperimentViewState;
  channelStates: Map<string, ChannelAnalysisState>;
  activeChannelState: ChannelAnalysisState;
} {
  let data = normalizeExperiment(input);
  data = inferContentTypes(data);

  // Restore working-session state when opening a `.sharpx` (shared view +
  // per-channel analysis snapshots).
  const parsed = data.session ? parseSession(data.session, data.channels) : null;
  const view: ExperimentViewState = {
    ...defaultViewState(data.wellsUsed, data.channels),
    ...(parsed?.view ?? {}),
  };
  // Constrain the active channel to one that actually exists.
  if (!data.channels.includes(view.activeChannel)) view.activeChannel = data.channels[0];

  // Curve selection: a pre-curve `.sharpx` carries `selectedWells` but no
  // `selectedCurves` — expand those wells across all channels. Always
  // re-derive the `selectedWells` mirror from the resolved curve set so the
  // two stay consistent regardless of which the session provided.
  if (parsed) {
    const sessionHadCurves = parsed.view.selectedCurves instanceof Set;
    view.selectedCurves = sessionHadCurves
      ? (parsed.view.selectedCurves as Set<string>)
      : wellsToCurves(view.selectedWells, data.channels);
    view.selectedWells = curvesToWells(view.selectedCurves);
  }

  // Seed parser-detected empty (never-loaded) wells into the deactivated set
  // so they don't clutter plots/analysis — unless a saved session already
  // carries a plate configuration (which then wins). Keep deactivated wells
  // out of the initial selection.
  if (!(parsed?.view.deactivatedWells instanceof Set) && data.autoEmptyWells?.length) {
    view.deactivatedWells = new Set(data.autoEmptyWells);
  }
  if (view.deactivatedWells.size > 0) {
    view.selectedCurves = new Set(
      [...view.selectedCurves].filter((k) => !view.deactivatedWells.has(parseCurveKey(k).well)),
    );
    view.selectedWells = curvesToWells(view.selectedCurves);
  }

  // Seed one analysis-state entry per channel (from the session if present).
  const channelStates = new Map<string, ChannelAnalysisState>();
  for (const ch of data.channels) {
    channelStates.set(ch, parsed?.channelMap.get(ch) ?? defaultChannelState());
  }
  const activeChannelState = channelStates.get(view.activeChannel) ?? defaultChannelState();

  return {
    data: withActiveChannel(data, view.activeChannel),
    view,
    channelStates,
    activeChannelState,
  };
}

interface AppState extends ExperimentViewState, ChannelAnalysisState {
  // Data (null entries represent empty "home" tabs)
  experiments: (ExperimentData | null)[];
  activeExperimentIndex: number;

  // Source file paths (index → file path that was opened)
  sourceFilePaths: Map<number, string>;

  // Transient (not per-experiment)
  hoveredWell: string | null;
  dragPreviewWells: Set<string> | null;
  /** Curve-level drag-select preview (plot box-select). The well grid keeps
   *  using `dragPreviewWells`; plots preview at curve granularity. */
  dragPreviewCurves: Set<string> | null;
  showDilutionWizard: boolean;
  showExportWizard: boolean;
  showFluorophoreWizard: boolean;
  /** The native kinetics report overlay (lazy per-curve readouts). */
  showKineticsReport: boolean;
  /** Bumped by `triggerAutoScale()` — PlotArea plots watch it to relayout to
   *  autorange. Transient (not persisted, not per-experiment). */
  _autoScalePulse: number;
  /** Analysis tab "All channels" scope — when true, flat analysis setters
   *  broadcast to every channel of the active experiment. Transient. */
  analysisScopeAll: boolean;

  // Per-experiment state snapshots (index → snapshot)
  _experimentSnapshots: Map<number, ExperimentViewState>;
  // Per-experiment, per-channel analysis snapshots (expIndex → channel → state)
  _channelSnapshots: Map<number, Map<string, ChannelAnalysisState>>;

  // Undo/redo stacks (per experiment)
  _undoStacks: Map<number, UndoEntry[]>;
  _redoStacks: Map<number, UndoEntry[]>;
  _restoringSnapshot: boolean;

  // Actions
  addEmptyTab: () => void;
  loadExperiment: (data: ExperimentData, sourcePath?: string) => void;
  getActiveSourcePath: () => string | undefined;
  setActiveSourcePath: (path: string) => void;
  /** Current per-experiment view state, serialized for a `.sharpx` session file. */
  getSessionState: () => Record<string, unknown>;
  pushUndo: (description: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getUndoDescription: () => string | undefined;
  getRedoDescription: () => string | undefined;
  switchExperiment: (index: number) => void;
  removeExperiment: (index: number) => void;
  /** Switch which channel the Analysis tab edits (mirrors `switchExperiment`:
   *  flushes the current channel, restores the target, re-points derived
   *  `amplification`/`melt`). Not undoable. */
  setActiveChannel: (channel: string) => void;
  /** Toggle a channel's global visibility across all wells (undoable). */
  toggleChannelGlobal: (channel: string) => void;
  /** Single-channel vs multichannel display mode (undoable). */
  setViewMode: (mode: 'single' | 'multi') => void;
  /** One-shot: clear manual colours + reset channel colours → standard ramps. */
  applySeparateByColor: () => void;
  /** One-shot: clear manual line styles + assign the per-channel dash ladder. */
  applySeparateByLineStyle: () => void;
  /** Set the per-channel line-style (dash) override for one channel (undoable). */
  setChannelLineStyle: (channel: string, style: string) => void;
  /** Set the per-channel line-style for every channel of the active experiment. */
  setAllChannelLineStyles: (style: string) => void;
  /** Set (or, with an empty string, reset to dye default) a channel's
   *  representative colour (undoable). */
  setChannelColor: (channel: string, color: string) => void;
  /** Analysis tab "All channels" editing scope (transient). */
  setAnalysisScopeAll: (on: boolean) => void;
  /** Toggle whether axes auto-fit on transform change (undoable). */
  setAutoScale: (on: boolean) => void;
  /** Request an immediate axis auto-scale on all plots (transient pulse). */
  triggerAutoScale: () => void;
  /** Toggle a channel on/off for the given wells. The clicked well's resulting
   *  state is applied uniformly to all wells (selection-aware batch — the
   *  caller passes the expanded selection). Undoable. */
  toggleWellChannel: (wells: string[], channel: string) => void;
  setSelectedWells: (wells: Set<string>) => void;
  addToSelection: (wells: string[]) => void;
  toggleWellSelection: (well: string) => void;
  selectOnly: (well: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  /** Curve-level (S-C pair) selection. The `selectedWells` mirror updates with
   *  each of these. `toggleCurves` removes all the given curves if all are
   *  already selected, else adds them (coherent toggle of a curve or group). */
  setSelectedCurves: (curves: Set<string>) => void;
  selectCurvesOnly: (curves: string[]) => void;
  toggleCurves: (curves: string[]) => void;
  addCurvesToSelection: (curves: string[]) => void;
  selectByType: (type: string) => void;
  /** Select every well's curve for one channel (all S-C pairs of that fluorophore). */
  selectByChannel: (channel: string) => void;
  selectShown: () => void;
  selectHidden: () => void;
  toggleWellHidden: (well: string) => void;
  showWells: (wells: string[]) => void;
  hideWells: (wells: string[]) => void;
  activateWells: (wells: string[]) => void;
  deactivateWells: (wells: string[]) => void;
  setWellContentType: (wells: string[], type: ContentType) => void;
  setWellSampleName: (well: string, name: string) => void;
  setWellSampleNameBatch: (wells: string[], name: string) => void;
  /** Persist the active experiment's free-text notes (undoable). */
  setExperimentNotes: (notes: string) => void;
  setWellStyleOverride: (wells: string[], style: WellStyleOverride) => void;
  clearWellStyleOverrides: (wells: string[]) => void;
  /** Per-curve (S-C pair) style overrides — keyed by curveKey. */
  setCurveStyleOverride: (curves: string[], style: WellStyleOverride) => void;
  clearCurveStyleOverrides: (curves: string[]) => void;
  /** Apply many per-curve colours in one undoable action (a palette apply).
   *  Optionally set the global palette in the same step (so the Style dropdown
   *  reflects the choice without a second undo entry). */
  setCurveColorsBatch: (entries: [string, string][], palette?: string) => void;
  /** Remove only the `color` field from every per-well AND per-curve style
   *  override, preserving `lineWidth` / `lineStyle`. No selection required. */
  clearAllColorOverrides: () => void;
  /** Remove ALL per-well AND per-curve style overrides (colour + width + style). */
  clearAllWellStyleOverrides: () => void;
  setWellBaselineOverride: (wells: string[], override: WellBaselineOverride) => void;
  clearWellBaselineOverrides: (wells: string[]) => void;
  setNormalizeEnabled: (on: boolean) => void;
  setWellNormalizeOverride: (wells: string[], override: WellNormalizeOverride) => void;
  clearWellNormalizeOverrides: (wells: string[]) => void;
  setDriftCorrectionEnabled: (on: boolean) => void;
  setMeltNormalizeEnabled: (on: boolean) => void;
  setWellGroup: (wells: string[], group: string) => void;
  removeWellGroup: (wells: string[]) => void;
  /** Per-curve (S-C pair) grouping — keyed by curveKey. */
  setCurveGroup: (curves: string[], group: string) => void;
  removeCurveGroup: (curves: string[]) => void;
  autoGroupBySample: () => void;
  addToLegend: (wells: string[]) => void;
  removeFromLegend: (wells: string[]) => void;
  setHoveredWell: (well: string | null) => void;
  setDragPreviewWells: (wells: Set<string> | null) => void;
  setDragPreviewCurves: (curves: Set<string> | null) => void;
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
  setLegendContent: (content: 'well' | 'sample' | 'group') => void;
  setLegendOrder: (order: string[]) => void;
  setShowTitle: (on: boolean) => void;
  setShowLabels: (on: boolean) => void;
  setShowTicks: (on: boolean) => void;
  setLegendVisibleOnly: (on: boolean) => void;
  setPaletteReversed: (reversed: boolean) => void;
  setPaletteGroupColors: (on: boolean) => void;
  setSelectionPaletteGroupColors: (on: boolean) => void;
  reversePalette: () => void;
  setShowGrid: (on: boolean) => void;
  setGridAlpha: (alpha: number) => void;
  setPlotBgColor: (color: string) => void;
  setTextColor: (color: 'auto' | 'black' | 'white') => void;
  setFigureDpi: (dpi: number) => void;
  paletteArrowMode: boolean;
  /** When arrow-palette mode is armed from a single-channel Style scope, the
   *  channel to restrict colouring to; null = colour every curve the arrow
   *  touches (all visible channels). Transient. */
  paletteArrowChannel: string | null;
  setPaletteArrowMode: (on: boolean, channel?: string | null) => void;
  setShowDilutionWizard: (show: boolean) => void;
  setShowExportWizard: (show: boolean) => void;
  setShowFluorophoreWizard: (show: boolean) => void;
  setShowKineticsReport: (show: boolean) => void;
  setLandmark: (kind: keyof LandmarkVisibility, on: boolean) => void;
  /** Apply user fluorophore labels + colours per channel (one undoable action). */
  setChannelMeta: (labels: Map<string, string>, colors: Map<string, string>) => void;
  resetStyle: () => void;
  applyStyleSnapshot: (snapshot: import('../lib/style-presets').StyleSnapshot) => void;
}

export const useAppState = create<AppState>((set, get) => ({
  experiments: [null],  // Start with one Welcome tab
  activeExperimentIndex: 0,
  sourceFilePaths: new Map(),
  _experimentSnapshots: new Map(),
  _channelSnapshots: new Map(),
  _undoStacks: new Map(),
  _redoStacks: new Map(),
  _restoringSnapshot: false,
  hoveredWell: null,
  dragPreviewWells: null,
  dragPreviewCurves: null,
  showDilutionWizard: false,
  showExportWizard: false,
  showFluorophoreWizard: false,
  showKineticsReport: false,
  _autoScalePulse: 0,
  analysisScopeAll: false,

  // Spread default view + channel state as initial top-level fields
  ...defaultViewState(),
  ...defaultChannelState(),

  addEmptyTab: () =>
    set((state) => {
      const snapshots = new Map(state._experimentSnapshots);
      const channelSnaps = new Map(state._channelSnapshots);
      if (state.experiments.length > 0) {
        snapshots.set(state.activeExperimentIndex, snapshotViewState(state));
        channelSnaps.set(state.activeExperimentIndex, flushChannel(state));
      }
      const newIndex = state.experiments.length;
      const newView = defaultViewState();
      const newChannel = defaultChannelState();
      snapshots.set(newIndex, newView);
      channelSnaps.set(newIndex, new Map());
      return {
        experiments: [...state.experiments, null],
        activeExperimentIndex: newIndex,
        _experimentSnapshots: snapshots,
        _channelSnapshots: channelSnaps,
        hoveredWell: null,
        dragPreviewWells: null,
        analysisScopeAll: false,
        ...newView,
        ...newChannel,
      };
    }),

  loadExperiment: (data, sourcePath?) => {
    // Pure, state-independent resolution (normalize → infer types → restore
    // session over defaults → seed deactivated wells). Shared with the headless
    // CLI so both reconstruct identical state from the same file.
    const {
      data: dataActive,
      view: newView,
      channelStates: chanMap,
      activeChannelState,
    } = resolveExperimentState(data);
    set((state) => {
      const snapshots = new Map(state._experimentSnapshots);
      const channelSnaps = new Map(state._channelSnapshots);
      const paths = new Map(state.sourceFilePaths);
      const currentIsEmpty = state.experiments[state.activeExperimentIndex] === null;

      if (currentIsEmpty) {
        // Replace the current empty/Welcome tab with this experiment
        const idx = state.activeExperimentIndex;
        const exps = [...state.experiments];
        exps[idx] = dataActive;
        snapshots.set(idx, newView);
        channelSnaps.set(idx, chanMap);
        if (sourcePath) paths.set(idx, sourcePath);
        return {
          experiments: exps,
          sourceFilePaths: paths,
          _experimentSnapshots: snapshots,
          _channelSnapshots: channelSnaps,
          hoveredWell: null,
          dragPreviewWells: null,
          analysisScopeAll: false,
          ...newView,
          ...activeChannelState,
        };
      }

      // Save current experiment's state before switching
      if (state.experiments.length > 0) {
        snapshots.set(state.activeExperimentIndex, snapshotViewState(state));
        channelSnaps.set(state.activeExperimentIndex, flushChannel(state));
      }
      const newIndex = state.experiments.length;
      snapshots.set(newIndex, newView);
      channelSnaps.set(newIndex, chanMap);
      if (sourcePath) paths.set(newIndex, sourcePath);
      return {
        experiments: [...state.experiments, dataActive],
        activeExperimentIndex: newIndex,
        sourceFilePaths: paths,
        _experimentSnapshots: snapshots,
        _channelSnapshots: channelSnaps,
        hoveredWell: null,
        dragPreviewWells: null,
        analysisScopeAll: false,
        ...newView,
        ...activeChannelState,
      };
    });
  },

  getActiveSourcePath: () => {
    const state = get();
    return state.sourceFilePaths.get(state.activeExperimentIndex);
  },

  setActiveSourcePath: (path) =>
    set((state) => {
      const paths = new Map(state.sourceFilePaths);
      paths.set(state.activeExperimentIndex, path);
      return { sourceFilePaths: paths };
    }),

  getSessionState: () => {
    const state = get();
    const shared = serializeViewState(snapshotViewState(state));
    const channelSnapshots = [...flushChannel(state)].map(
      ([ch, cs]) => [ch, serializeChannelState(cs)] as [string, unknown],
    );
    return { ...shared, channelSnapshots };
  },

  pushUndo: (description) => {
    const state = get();
    if (state._restoringSnapshot || state.experiments.length === 0) return;
    const idx = state.activeExperimentIndex;
    const undoStacks = new Map(state._undoStacks);
    const redoStacks = new Map(state._redoStacks);
    const stack = [...(undoStacks.get(idx) ?? [])];
    stack.push({
      snapshot: snapshotViewState(state),
      channelSnapshot: flushChannel(state),
      experimentData: state.experiments[idx] ?? null,
      description,
    });
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
    redoStack.push({
      snapshot: snapshotViewState(state),
      channelSnapshot: flushChannel(state),
      experimentData: state.experiments[idx] ?? null,
      description: entry.description,
    });
    const undoStacks = new Map(state._undoStacks);
    const redoStacks = new Map(state._redoStacks);
    undoStacks.set(idx, undoStack);
    redoStacks.set(idx, redoStack);
    const experiments = [...state.experiments];
    experiments[idx] = entry.experimentData;
    const channelSnaps = new Map(state._channelSnapshots);
    channelSnaps.set(idx, entry.channelSnapshot);
    const activeChannelState = entry.channelSnapshot.get(entry.snapshot.activeChannel) ?? defaultChannelState();
    set({ _restoringSnapshot: true, _undoStacks: undoStacks, _redoStacks: redoStacks, _channelSnapshots: channelSnaps, experiments, ...entry.snapshot, ...activeChannelState });
    set({ _restoringSnapshot: false });
  },

  redo: () => {
    const state = get();
    const idx = state.activeExperimentIndex;
    const redoStack = [...(state._redoStacks.get(idx) ?? [])];
    if (redoStack.length === 0) return;
    const entry = redoStack.pop()!;
    const undoStack = [...(state._undoStacks.get(idx) ?? [])];
    undoStack.push({
      snapshot: snapshotViewState(state),
      channelSnapshot: flushChannel(state),
      experimentData: state.experiments[idx] ?? null,
      description: entry.description,
    });
    const undoStacks = new Map(state._undoStacks);
    const redoStacks = new Map(state._redoStacks);
    undoStacks.set(idx, undoStack);
    redoStacks.set(idx, redoStack);
    const experiments = [...state.experiments];
    experiments[idx] = entry.experimentData;
    const channelSnaps = new Map(state._channelSnapshots);
    channelSnaps.set(idx, entry.channelSnapshot);
    const activeChannelState = entry.channelSnapshot.get(entry.snapshot.activeChannel) ?? defaultChannelState();
    set({ _restoringSnapshot: true, _undoStacks: undoStacks, _redoStacks: redoStacks, _channelSnapshots: channelSnaps, experiments, ...entry.snapshot, ...activeChannelState });
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
      const channelSnaps = new Map(state._channelSnapshots);
      // Save current state (shared + per-channel)
      snapshots.set(state.activeExperimentIndex, snapshotViewState(state));
      channelSnaps.set(state.activeExperimentIndex, flushChannel(state));
      // Restore target state
      const targetExp = state.experiments[index];
      const target = snapshots.get(index) ?? defaultViewState(targetExp?.wellsUsed, targetExp?.channels);
      const targetChannelState = channelSnaps.get(index)?.get(target.activeChannel) ?? defaultChannelState();
      return {
        activeExperimentIndex: index,
        _experimentSnapshots: snapshots,
        _channelSnapshots: channelSnaps,
        hoveredWell: null,
        dragPreviewWells: null,
        analysisScopeAll: false,
        ...target,
        ...targetChannelState,
      };
    }),

  removeExperiment: (index) =>
    set((state) => {
      if (state.experiments.length <= 1) {
        // Last tab — replace with Welcome instead of removing
        const newView = defaultViewState();
        const newChannel = defaultChannelState();
        return {
          experiments: [null],
          activeExperimentIndex: 0,
          sourceFilePaths: new Map(),
          _experimentSnapshots: new Map([[0, newView]]),
          _channelSnapshots: new Map([[0, new Map()]]),
          _undoStacks: new Map(),
          _redoStacks: new Map(),
          hoveredWell: null,
          dragPreviewWells: null,
          analysisScopeAll: false,
          ...newView,
          ...newChannel,
        };
      }
      const experiments = state.experiments.filter((_, i) => i !== index);
      const snapshots = new Map<number, ExperimentViewState>();
      const channelSnaps = new Map<number, Map<string, ChannelAnalysisState>>();
      const paths = new Map<number, string>();
      const undoStacks = new Map<number, UndoEntry[]>();
      const redoStacks = new Map<number, UndoEntry[]>();
      // Re-index snapshots, channel snapshots, source paths, and undo/redo
      // stacks (skip removed, shift down higher indices)
      for (const [i, snap] of state._experimentSnapshots) {
        if (i < index) snapshots.set(i, snap);
        else if (i > index) snapshots.set(i - 1, snap);
      }
      for (const [i, snap] of state._channelSnapshots) {
        if (i < index) channelSnaps.set(i, snap);
        else if (i > index) channelSnaps.set(i - 1, snap);
      }
      for (const [i, p] of state.sourceFilePaths) {
        if (i < index) paths.set(i, p);
        else if (i > index) paths.set(i - 1, p);
      }
      for (const [i, stack] of state._undoStacks) {
        if (i < index) undoStacks.set(i, stack);
        else if (i > index) undoStacks.set(i - 1, stack);
      }
      for (const [i, stack] of state._redoStacks) {
        if (i < index) redoStacks.set(i, stack);
        else if (i > index) redoStacks.set(i - 1, stack);
      }

      // Determine new active index
      let newActive = state.activeExperimentIndex;
      if (index === state.activeExperimentIndex) {
        // Closing the active tab: switch to nearest
        newActive = Math.min(index, experiments.length - 1);
        const restored = snapshots.get(newActive) ?? defaultViewState(experiments[newActive]?.wellsUsed, experiments[newActive]?.channels);
        const restoredChannel = channelSnaps.get(newActive)?.get(restored.activeChannel) ?? defaultChannelState();
        return {
          experiments,
          activeExperimentIndex: newActive,
          sourceFilePaths: paths,
          _experimentSnapshots: snapshots,
          _channelSnapshots: channelSnaps,
          _undoStacks: undoStacks,
          _redoStacks: redoStacks,
          hoveredWell: null,
          dragPreviewWells: null,
          analysisScopeAll: false,
          ...restored,
          ...restoredChannel,
        };
      } else if (index < state.activeExperimentIndex) {
        newActive = state.activeExperimentIndex - 1;
      }
      return {
        experiments,
        activeExperimentIndex: newActive,
        sourceFilePaths: paths,
        _experimentSnapshots: snapshots,
        _channelSnapshots: channelSnaps,
        _undoStacks: undoStacks,
        _redoStacks: redoStacks,
        hoveredWell: null,
        dragPreviewWells: null,
      };
    }),

  setActiveChannel: (channel) => {
    const state = get();
    const exp = state.experiments[state.activeExperimentIndex];
    if (!exp || channel === state.activeChannel || !exp.channels.includes(channel)) return;
    set((s) => {
      const idx = s.activeExperimentIndex;
      const channelSnaps = new Map(s._channelSnapshots);
      const map = flushChannel(s);          // capture the outgoing channel's edits
      channelSnaps.set(idx, map);
      const targetState = map.get(channel) ?? defaultChannelState();
      const experiments = [...s.experiments];
      const current = experiments[idx];
      if (current) experiments[idx] = withActiveChannel(current, channel);
      return {
        _channelSnapshots: channelSnaps,
        experiments,
        activeChannel: channel,
        analysisScopeAll: false,
        ...targetState,
      };
    });
  },

  toggleChannelGlobal: (channel) => {
    get().pushUndo('Toggle channel');
    set((state) => {
      const next = new Set(state.visibleChannels);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return { visibleChannels: next };
    });
  },

  setViewMode: (mode) => { get().pushUndo('Change channel view'); set({ viewMode: mode }); },
  /** "Separate by colour": clear any manual per-well colour overrides and reset
   *  per-channel representative colours to dye defaults → the standard
   *  per-channel colour ramps. One-shot; overrides the user's manual colours. */
  applySeparateByColor: () => {
    get().pushUndo('Separate by colour');
    set((state) => {
      // Drop the colour field from a style-override map (keep width/line-style),
      // discarding now-empty entries. Applied to BOTH the per-well and per-curve
      // override maps so a manually-set curve colour can't survive and win over
      // the per-channel ramp (resolution is curve → well → ramp).
      const stripColor = (m: Map<string, WellStyleOverride>) => {
        const next = new Map<string, WellStyleOverride>();
        for (const [k, ov] of m) {
          const { color: _drop, ...rest } = ov;
          void _drop;
          if (rest.lineWidth != null || rest.lineStyle != null) next.set(k, rest);
        }
        return next;
      };
      return {
        wellStyleOverrides: stripColor(state.wellStyleOverrides),
        curveStyleOverrides: stripColor(state.curveStyleOverrides),
        channelColors: new Map(),
      };
    });
  },
  /** "Separate by line style": clear any manual per-well line-style overrides and
   *  assign the standard per-channel dash ladder (FAM solid, HEX dotted, …). */
  applySeparateByLineStyle: () => {
    const exp = get().experiments[get().activeExperimentIndex];
    if (!exp) return;
    get().pushUndo('Separate by line style');
    set((state) => {
      // Drop the line-style field from both override maps so a manual per-curve
      // or per-well line style can't override the per-channel dash ladder
      // (resolution is curve → well → channel).
      const stripLineStyle = (m: Map<string, WellStyleOverride>) => {
        const next = new Map<string, WellStyleOverride>();
        for (const [k, ov] of m) {
          const { lineStyle: _drop, ...rest } = ov;
          void _drop;
          if (rest.color != null || rest.lineWidth != null) next.set(k, rest);
        }
        return next;
      };
      const dashes = new Map(state.channelLineStyles);
      exp.channels.forEach((ch, i) => dashes.set(ch, CHANNEL_DASH[i % CHANNEL_DASH.length]));
      return {
        wellStyleOverrides: stripLineStyle(state.wellStyleOverrides),
        curveStyleOverrides: stripLineStyle(state.curveStyleOverrides),
        channelLineStyles: dashes,
      };
    });
  },
  setChannelLineStyle: (channel, style) => {
    get().pushUndo('Set channel line style');
    set((s) => {
      const next = new Map(s.channelLineStyles);
      next.set(channel, style);
      return { channelLineStyles: next };
    });
  },
  setAllChannelLineStyles: (style) => {
    const exp = get().experiments[get().activeExperimentIndex];
    if (!exp) return;
    get().pushUndo('Set channel line style');
    set((s) => {
      const next = new Map(s.channelLineStyles);
      for (const ch of exp.channels) next.set(ch, style);
      return { channelLineStyles: next };
    });
  },
  setChannelColor: (channel, color) => {
    get().pushUndo('Set channel color');
    set((s) => {
      const next = new Map(s.channelColors);
      if (color) next.set(channel, color);
      else next.delete(channel);  // empty string → reset to dye default
      return { channelColors: next };
    });
  },
  setAnalysisScopeAll: (on) => set({ analysisScopeAll: on }),
  setAutoScale: (on) => { get().pushUndo('Toggle auto-scale'); set({ autoScale: on }); },
  triggerAutoScale: () => set((s) => ({ _autoScalePulse: s._autoScalePulse + 1 })),

  toggleWellChannel: (wells, channel) => {
    if (wells.length === 0) return;
    get().pushUndo('Toggle sample channel');
    set((state) => {
      const next = new Map(state.wellChannelHidden);
      // Flip relative to the clicked well (passed first), then apply that
      // resulting state uniformly to every well in the batch.
      const refHidden = next.get(wells[0])?.has(channel) ?? false;
      const hide = !refHidden;
      for (const w of wells) {
        const cur = new Set(next.get(w) ?? []);
        if (hide) cur.add(channel);
        else cur.delete(channel);
        if (cur.size === 0) next.delete(w);
        else next.set(w, cur);
      }
      return { wellChannelHidden: next };
    });
  },

  // Well-level selection wrappers — expand the well(s) to all their channels'
  // curves, then update the curve selection + the derived well mirror. Keep the
  // existing signatures so WellGrid / WellList / useDragSelect / MenuBar are
  // unchanged. Single channel ⇒ one curve per well ⇒ behaves exactly as before.
  setSelectedWells: (wells) => set((s) => applySelection(wellsToCurves(wells, activeChannels(s)))),
  addToSelection: (wells) =>
    set((state) => {
      const next = new Set(state.selectedCurves);
      for (const k of wellsToCurves(wells, activeChannels(state))) next.add(k);
      return applySelection(next);
    }),
  toggleWellSelection: (well) =>
    set((state) => {
      const keys = wellCurves(well, activeChannels(state));
      const next = new Set(state.selectedCurves);
      const anyPresent = keys.some((k) => next.has(k));
      for (const k of keys) { if (anyPresent) next.delete(k); else next.add(k); }
      return applySelection(next);
    }),
  selectOnly: (well) => set((s) => applySelection(new Set(wellCurves(well, activeChannels(s))))),
  selectAll: () => {
    const s = get();
    const exp = s.experiments[s.activeExperimentIndex];
    if (exp) set(applySelection(wellsToCurves(exp.wellsUsed.filter((w) => !s.deactivatedWells.has(w)), exp.channels)));
  },
  deselectAll: () => set(applySelection(new Set())),
  setSelectedCurves: (curves) => set(applySelection(new Set(curves))),
  selectCurvesOnly: (curves) => set(applySelection(new Set(curves))),
  toggleCurves: (curves) =>
    set((state) => {
      const next = new Set(state.selectedCurves);
      const allPresent = curves.length > 0 && curves.every((k) => next.has(k));
      for (const k of curves) { if (allPresent) next.delete(k); else next.add(k); }
      return applySelection(next);
    }),
  addCurvesToSelection: (curves) =>
    set((state) => {
      const next = new Set(state.selectedCurves);
      for (const k of curves) next.add(k);
      return applySelection(next);
    }),
  selectByType: (type) => {
    const s = get();
    const exp = s.experiments[s.activeExperimentIndex];
    if (!exp) return;
    const wells = exp.wellsUsed.filter((w) => {
      if (s.deactivatedWells.has(w)) return false;
      const content = exp.wells[w]?.content ?? '';
      if (type === 'Unkn') return content === 'Unkn' || content === '';
      return content === type;
    });
    set(applySelection(wellsToCurves(wells, exp.channels)));
  },
  selectByChannel: (channel) => {
    const s = get();
    const exp = s.experiments[s.activeExperimentIndex];
    if (!exp || !exp.channels.includes(channel)) return;
    const wells = exp.wellsUsed.filter((w) => !s.deactivatedWells.has(w));
    set(applySelection(new Set(wells.map((w) => curveKey(w, channel)))));
  },
  selectShown: () => {
    const state = get();
    const exp = state.experiments[state.activeExperimentIndex];
    if (!exp) return;
    const wells = exp.wellsUsed.filter((w) => !state.hiddenWells.has(w) && !state.deactivatedWells.has(w));
    set(applySelection(wellsToCurves(wells, exp.channels)));
  },
  selectHidden: () => {
    const state = get();
    const exp = state.experiments[state.activeExperimentIndex];
    if (!exp) return;
    const wells = exp.wellsUsed.filter((w) => state.hiddenWells.has(w));
    set(applySelection(wellsToCurves(wells, exp.channels)));
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
      if (wellMap[well]) {
        wellMap[well] = { ...wellMap[well], sample: name };
        if (isNtcName(name)) wellMap[well].content = 'Neg Ctrl';
      }
      exp.wells = wellMap;
      exps[state.activeExperimentIndex] = exp;
      return { experiments: exps };
    });
  },
  setExperimentNotes: (notes) => {
    get().pushUndo('Edit notes');
    set((state) => {
      const current = state.experiments[state.activeExperimentIndex];
      if (!current) return {};
      const exps = [...state.experiments];
      exps[state.activeExperimentIndex] = { ...current, notes };
      return { experiments: exps };
    });
  },
  setWellSampleNameBatch: (wells, name) => {
    if (wells.length === 0) return;
    get().pushUndo(wells.length === 1 ? 'Set sample name' : `Rename ${wells.length} samples`);
    set((state) => {
      const current = state.experiments[state.activeExperimentIndex];
      if (!current) return {};
      const exps = [...state.experiments];
      const exp = { ...current };
      const wellMap = { ...exp.wells };
      const ntc = isNtcName(name);
      for (const w of wells) {
        if (wellMap[w]) {
          wellMap[w] = { ...wellMap[w], sample: name };
          if (ntc) wellMap[w].content = 'Neg Ctrl';
        }
      }
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
  clearAllColorOverrides: () => {
    // No-op if nothing to do (skip the undo entry to avoid clutter).
    const hasColor = (m: Map<string, WellStyleOverride>) => {
      for (const ov of m.values()) if (ov.color) return true;
      return false;
    };
    if (!hasColor(get().wellStyleOverrides) && !hasColor(get().curveStyleOverrides)) return;
    get().pushUndo('Clear custom colors');
    const stripColor = (m: Map<string, WellStyleOverride>) => {
      const next = new Map<string, WellStyleOverride>();
      for (const [k, ov] of m) {
        const { color: _drop, ...rest } = ov;
        void _drop;
        if (rest.lineWidth != null || rest.lineStyle != null) next.set(k, rest);
      }
      return next;
    };
    set((state) => ({
      wellStyleOverrides: stripColor(state.wellStyleOverrides),
      curveStyleOverrides: stripColor(state.curveStyleOverrides),
    }));
  },
  /** Remove ALL per-well and per-curve style overrides (colour + width + style). */
  clearAllWellStyleOverrides: () => {
    if (get().wellStyleOverrides.size === 0 && get().curveStyleOverrides.size === 0) return;
    get().pushUndo('Clear individual styles');
    set({ wellStyleOverrides: new Map(), curveStyleOverrides: new Map() });
  },
  setCurveStyleOverride: (curves, style) => {
    if (curves.length === 0) return;
    get().pushUndo('Set curve style');
    set((state) => {
      const next = new Map(state.curveStyleOverrides);
      for (const k of curves) next.set(k, { ...next.get(k), ...style });
      return { curveStyleOverrides: next };
    });
  },
  clearCurveStyleOverrides: (curves) => {
    get().pushUndo('Clear curve styles');
    set((state) => {
      const next = new Map(state.curveStyleOverrides);
      for (const k of curves) next.delete(k);
      return { curveStyleOverrides: next };
    });
  },
  setCurveColorsBatch: (entries, palette) => {
    if (entries.length === 0 && palette === undefined) return;
    get().pushUndo('Apply palette');
    set((state) => {
      const next = new Map(state.curveStyleOverrides);
      for (const [key, color] of entries) next.set(key, { ...next.get(key), color });
      return palette !== undefined ? { curveStyleOverrides: next, palette } : { curveStyleOverrides: next };
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
  setNormalizeEnabled: (on) => { get().pushUndo('Toggle normalization'); set((s) => broadcastAnalysis(s, { normalizeEnabled: on })); },
  setDriftCorrectionEnabled: (on) => { get().pushUndo('Toggle drift correction'); set((s) => broadcastAnalysis(s, { driftCorrectionEnabled: on })); },
  setMeltNormalizeEnabled: (on) => { get().pushUndo('Toggle melt normalization'); set((s) => broadcastAnalysis(s, { meltNormalizeEnabled: on })); },
  setWellNormalizeOverride: (wells, override) => {
    get().pushUndo('Set well normalization');
    set((state) => {
      const next = new Map(state.wellNormalizeOverrides);
      for (const w of wells) {
        next.set(w, { ...next.get(w), ...override });
      }
      return { wellNormalizeOverrides: next };
    });
  },
  clearWellNormalizeOverrides: (wells) => {
    get().pushUndo('Clear well normalization');
    set((state) => {
      const next = new Map(state.wellNormalizeOverrides);
      for (const w of wells) next.delete(w);
      return { wellNormalizeOverrides: next };
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
  setCurveGroup: (curves, group) => {
    if (curves.length === 0) return;
    get().pushUndo('Set group');
    set((state) => {
      const next = new Map(state.curveGroups);
      for (const k of curves) next.set(k, group);
      return { curveGroups: next };
    });
  },
  removeCurveGroup: (curves) => {
    get().pushUndo('Remove group');
    set((state) => {
      const next = new Map(state.curveGroups);
      for (const k of curves) next.delete(k);
      return { curveGroups: next };
    });
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
  setDragPreviewCurves: (curves) => set({ dragPreviewCurves: curves }),
  setXAxisMode: (mode) => set({ xAxisMode: mode }),
  setLogScale: (on) => set({ logScale: on }),
  setPlotTab: (tab) => set({ plotTab: tab }),
  setBaselineEnabled: (on) => { get().pushUndo('Toggle baseline'); set((s) => broadcastAnalysis(s, { baselineEnabled: on })); },
  setBaselineAuto: (on) => { get().pushUndo('Toggle auto baseline'); set((s) => broadcastAnalysis(s, { baselineAuto: on })); },
  setBaselineMethod: (method) => { get().pushUndo('Change baseline method'); set((s) => broadcastAnalysis(s, { baselineMethod: method })); },
  setBaselineZone: (start, end) => set((s) => broadcastAnalysis(s, { baselineStart: start, baselineEnd: end })),
  setShowRawOverlay: (on) => set({ showRawOverlay: on }),
  setThresholdEnabled: (on) => { get().pushUndo('Toggle threshold'); set((s) => broadcastAnalysis(s, { thresholdEnabled: on })); },
  setThresholdRfu: (rfu) => set((s) => broadcastAnalysis(s, { thresholdRfu: rfu })),
  setMeltThresholdEnabled: (on) => { get().pushUndo('Toggle melt threshold'); set((s) => broadcastAnalysis(s, { meltThresholdEnabled: on })); },
  setMeltThresholdValue: (value) => set((s) => broadcastAnalysis(s, { meltThresholdValue: value })),
  setSmoothingEnabled: (on) => { get().pushUndo('Toggle smoothing'); set((s) => broadcastAnalysis(s, { smoothingEnabled: on })); },
  setSmoothingWindow: (window) => set((s) => broadcastAnalysis(s, { smoothingWindow: window })),
  setFittingEnabled: (on) => set((s) => broadcastAnalysis(s, { fittingEnabled: on })),
  setFitStartFraction: (fraction) => set((s) => broadcastAnalysis(s, { fitStartFraction: fraction })),
  setFitEndFraction: (fraction) => set((s) => broadcastAnalysis(s, { fitEndFraction: fraction })),
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
  setFontFamily: (font) => { get().pushUndo('Change font'); set({ fontFamily: font }); },
  setTitleSize: (size) => set({ titleSize: size }),
  setLabelSize: (size) => set({ labelSize: size }),
  setTickSize: (size) => set({ tickSize: size }),
  setLegendSize: (size) => set({ legendSize: size }),
  setShowLegend: (on) => { get().pushUndo('Toggle legend'); set({ showLegend: on }); },
  setShowLegendAmp: (on) => { get().pushUndo('Toggle legend on amp'); set({ showLegendAmp: on }); },
  setShowLegendMelt: (on) => { get().pushUndo('Toggle legend on melt'); set({ showLegendMelt: on }); },
  setShowLegendDoubling: (on) => { get().pushUndo('Toggle legend on doubling'); set({ showLegendDoubling: on }); },
  setLegendPosition: (pos) => { get().pushUndo('Move legend'); set({ legendPosition: pos }); },
  setLegendContent: (content) => { get().pushUndo('Change legend content'); set({ legendContent: content, legendOrder: [] }); },
  setLegendOrder: (order) => { get().pushUndo('Reorder legend'); set({ legendOrder: order }); },
  setShowTitle: (on) => { get().pushUndo('Toggle title'); set({ showTitle: on }); },
  setShowLabels: (on) => { get().pushUndo('Toggle labels'); set({ showLabels: on }); },
  setShowTicks: (on) => { get().pushUndo('Toggle ticks'); set({ showTicks: on }); },
  setLegendVisibleOnly: (on) => { get().pushUndo('Toggle legend selected-only'); set({ legendVisibleOnly: on }); },
  setPaletteReversed: (reversed) => { get().pushUndo('Reverse palette'); set({ paletteReversed: reversed }); },
  setPaletteGroupColors: (on) => { get().pushUndo('Toggle group colors'); set({ paletteGroupColors: on }); },
  setSelectionPaletteGroupColors: (on) => { get().pushUndo('Toggle selection group colors'); set({ selectionPaletteGroupColors: on }); },
  reversePalette: () => { get().pushUndo('Reverse palette'); set((state) => ({ paletteReversed: !state.paletteReversed })); },
  setShowGrid: (on) => { get().pushUndo('Toggle grid'); set({ showGrid: on }); },
  setGridAlpha: (alpha) => set({ gridAlpha: alpha }),
  setPlotBgColor: (color) => { get().pushUndo('Change plot background'); set({ plotBgColor: color }); },
  setTextColor: (color) => { get().pushUndo('Change text color'); set({ textColor: color }); },
  setFigureDpi: (dpi) => set({ figureDpi: dpi }),
  paletteArrowMode: false,
  paletteArrowChannel: null,
  setPaletteArrowMode: (on, channel = null) => set({ paletteArrowMode: on, paletteArrowChannel: on ? channel : null }),
  setShowDilutionWizard: (show) => set({ showDilutionWizard: show }),
  setShowExportWizard: (show) => set({ showExportWizard: show }),
  setShowFluorophoreWizard: (show) => set({ showFluorophoreWizard: show }),
  setShowKineticsReport: (show) => set({ showKineticsReport: show }),
  setLandmark: (kind, on) => set((s) => ({ landmarks: { ...s.landmarks, [kind]: on } })),
  setChannelMeta: (labels, colors) => {
    get().pushUndo('Assign fluorophores');
    set({ channelLabels: new Map(labels), channelColors: new Map(colors) });
  },

  /** Reset all Style-tab fields to their v2 defaults. */
  resetStyle: () => {
    get().pushUndo('Reset style');
    set({
      palette: 'SHARP',
      paletteReversed: false,
      paletteGroupColors: false,
      channelLineStyles: new Map(),
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
      legendOrder: [],
      showTitle: true,
    showLabels: true,
    showTicks: true,
      legendVisibleOnly: false,
      showGrid: true,
      gridAlpha: DEFAULT_GRID_ALPHA,
      plotBgColor: '',
      textColor: 'auto',
      figureDpi: DEFAULT_FIGURE_DPI,
    });
  },

  /** Apply a named style snapshot (loaded from localStorage) to the
   *  active experiment. All fields of the snapshot are applied in one
   *  update; fields not in the snapshot are left unchanged. */
  applyStyleSnapshot: (snapshot) => {
    get().pushUndo('Apply style preset');
    set({ ...snapshot });
  },
}));

// Dev: expose store for debugging
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__STORE__ = useAppState;
}
