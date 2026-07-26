/**
 * `sharpplot inspect` — read a data file and report what is actually in it.
 *
 * Two jobs:
 *
 *  1. **Ground truth.** Real well names, sample names, groups, colours,
 *     channels, cycle counts, and which plot types the file can actually
 *     support. Whoever writes a spec reads this first, so a spec never names a
 *     well that does not exist.
 *  2. **A starting spec.** For a `.sharpx` the saved session already describes
 *     the figure the user last looked at, so `inspect` emits a populated spec
 *     as `spec`. The normal editing loop is to take that and change the two or
 *     three fields the user asked about, not to author one from scratch.
 */
import path from 'node:path';
import type { PlotType } from '@/lib/plot-figure';
import { curveKey } from '@/lib/curves';
import { loadSource, analyzeChannel, visibleWellsOf, type LoadedExperiment } from './load';
import type { FigureSpec, PlotPanel } from './spec';

export interface WellReport {
  well: string;
  sample: string;
  content: string;
  /** Effective group: the curve-level group if one exists, else the well's. */
  group: string | null;
  /** Resolved colour override, if the user set one. */
  color: string | null;
  hidden: boolean;
  deactivated: boolean;
  /** Drawn in the figure: populated, not hidden, not deactivated. */
  visible: boolean;
  /** Per-channel analysis availability, keyed by channel ID. */
  analysis: Record<string, { tt: number | null; dt: number | null; endRfu: number | null; meltTm: number | null }>;
}

export interface GroupReport {
  name: string;
  wells: string[];
  colors: string[];
  visibleWells: number;
}

export interface InspectReport {
  source: string;
  hasSession: boolean;
  experiment: {
    experimentId: string;
    instrument: string;
    protocolType: string;
    operator: string;
    runStarted: string;
    plate: { rows: number; cols: number };
    wellsUsed: number;
    cycles: number;
    /** Time span of the amplification run, in minutes. */
    durationMin: number | null;
    meltPoints: number;
    meltTemperatureRange: [number, number] | null;
  };
  channels: { id: string; fluorophore: string | null; label: string | null; active: boolean; hasAmp: boolean; hasMelt: boolean }[];
  availablePlotTypes: PlotType[];
  /** Plot types the file cannot support, with the reason. */
  unavailablePlotTypes: { plotType: string; reason: string }[];
  xAxisUnits: string[];
  groups: GroupReport[];
  legendOrder: string[];
  wells: WellReport[];
  dilutionConfig: unknown | null;
  /** Every view/analysis setting restored from the file, as the GUI would show it. */
  session: Record<string, unknown>;
  /** A ready-to-render spec describing the file as saved. */
  spec: FigureSpec;
}

function instrumentLabel(metadata: Record<string, unknown>): string {
  const inst = metadata.instrument as { manufacturer?: string; model?: string } | string | undefined;
  if (!inst) return 'Unknown';
  if (typeof inst === 'string') return inst;
  return [inst.manufacturer, inst.model].filter(Boolean).join(' ') || 'Unknown';
}

/** Effective group for a well on a channel: curve-level first, then well-level.
 *  Mirrors the curve-colour invariant documented in CLAUDE.md. */
function effectiveGroup(loaded: LoadedExperiment, well: string, channel: string): string | null {
  return loaded.view.curveGroups.get(curveKey(well, channel))
    ?? loaded.view.wellGroups.get(well)
    ?? null;
}

export function buildReport(loaded: LoadedExperiment): InspectReport {
  const { exp, view } = loaded;
  const activeChannel = view.activeChannel;
  const visible = new Set(visibleWellsOf(loaded));

  // Analysis for every channel, so per-well availability is honest about
  // which channels actually produced a Tt.
  const resultsByChannel = new Map(exp.channels.map((ch) => [ch, analyzeChannel(loaded, ch)]));

  const wells: WellReport[] = exp.wellsUsed.map((well) => {
    const info = exp.wells[well];
    const analysis: WellReport['analysis'] = {};
    for (const ch of exp.channels) {
      const r = resultsByChannel.get(ch)?.get(well);
      analysis[ch] = {
        tt: r?.tt ?? null,
        dt: r?.dt ?? null,
        endRfu: r?.endRfu ?? null,
        meltTm: info?.meltTempC ?? null,
      };
    }
    const curveOv = view.curveStyleOverrides.get(curveKey(well, activeChannel));
    const wellOv = view.wellStyleOverrides.get(well);
    return {
      well,
      sample: info?.sample ?? '',
      content: info?.content ?? '',
      group: effectiveGroup(loaded, well, activeChannel),
      color: curveOv?.color ?? wellOv?.color ?? null,
      hidden: view.hiddenWells.has(well),
      deactivated: view.deactivatedWells.has(well),
      visible: visible.has(well),
      analysis,
    };
  });

  // Groups, ordered by legendOrder where it applies (the app writes entries as
  // `grp:<name>`), then any remaining groups in well order.
  const groupWells = new Map<string, string[]>();
  for (const w of wells) {
    if (!w.group) continue;
    const list = groupWells.get(w.group) ?? [];
    list.push(w.well);
    groupWells.set(w.group, list);
  }
  const ordered: string[] = [];
  for (const entry of view.legendOrder) {
    const name = entry.startsWith('grp:') ? entry.slice(4) : entry;
    if (groupWells.has(name) && !ordered.includes(name)) ordered.push(name);
  }
  for (const name of groupWells.keys()) if (!ordered.includes(name)) ordered.push(name);

  const byWell = new Map(wells.map((w) => [w.well, w]));
  const groups: GroupReport[] = ordered.map((name) => {
    const members = groupWells.get(name)!;
    const colors = [...new Set(members.map((m) => byWell.get(m)?.color).filter((c): c is string => Boolean(c)))];
    return {
      name,
      wells: members,
      colors,
      visibleWells: members.filter((m) => visible.has(m)).length,
    };
  });

  // Plot-type availability. Melt is judged by actual parsed melt content, not
  // by metadata.protocol.has_melt — that flag reads false on files that do
  // carry melt curves.
  const amp = exp.amplification;
  const melt = exp.melt;
  const meltPoints = melt?.temperatureC.length ?? 0;
  const hasMeltRfu = melt ? Object.keys(melt.rfu).length > 0 : false;
  const hasMeltDeriv = melt ? Object.keys(melt.derivative).length > 0 : false;

  const available: PlotType[] = [];
  const unavailable: { plotType: string; reason: string }[] = [];
  if (amp && amp.cycle.length > 0) available.push('amp');
  else unavailable.push({ plotType: 'amp', reason: 'no amplification data in the file' });

  if (hasMeltRfu) available.push('melt');
  else unavailable.push({ plotType: 'melt', reason: 'no melt RFU curves in the file' });

  if (hasMeltDeriv) available.push('melt_deriv');
  else unavailable.push({ plotType: 'melt_deriv', reason: 'no melt derivative curves in the file' });

  // `doubling` plots Tt against doubling time, so it needs BOTH threshold
  // detection (for Tt) and log-linear fitting (for dt) turned on. Name
  // whichever is missing — "no data" alone sends the reader looking in the
  // wrong place.
  const activeResults = resultsByChannel.get(activeChannel);
  const activeCs = loaded.channelStates.get(activeChannel);
  const withTt = activeResults ? [...activeResults.values()].filter((r) => r.tt != null).length : 0;
  const withDt = activeResults ? [...activeResults.values()].filter((r) => r.tt != null && r.dt != null).length : 0;
  if (withDt > 0) available.push('doubling');
  else {
    const missing: string[] = [];
    if (!activeCs?.thresholdEnabled) missing.push('thresholdEnabled is off, so no well has a Tt');
    if (!activeCs?.fittingEnabled) missing.push('fittingEnabled is off, so no well has a doubling time');
    unavailable.push({
      plotType: 'doubling',
      reason: missing.length > 0
        ? `${missing.join('; ')} — set them on the panel to enable this plot`
        : `${withTt} wells have a Tt but none produced a doubling-time fit`,
    });
  }

  const durationMin = amp && amp.timeMin.length > 0 ? amp.timeMin[amp.timeMin.length - 1] : null;

  const spec = buildStartingSpec(loaded);

  return {
    source: loaded.sourcePath,
    hasSession: loaded.hasSession,
    experiment: {
      experimentId: exp.experimentId,
      instrument: instrumentLabel(exp.metadata),
      protocolType: exp.protocolType,
      operator: exp.operator,
      runStarted: exp.runStarted,
      plate: { rows: exp.plateRows, cols: exp.plateCols },
      wellsUsed: exp.wellsUsed.length,
      cycles: amp?.cycle.length ?? 0,
      durationMin,
      meltPoints,
      meltTemperatureRange: meltPoints > 0
        ? [melt!.temperatureC[0], melt!.temperatureC[meltPoints - 1]]
        : null,
    },
    channels: exp.channels.map((ch) => ({
      id: ch,
      fluorophore: exp.channelFluorophore?.[ch] ?? null,
      label: view.channelLabels.get(ch) ?? null,
      active: ch === activeChannel,
      hasAmp: Boolean(exp.amplificationByChannel[ch]),
      hasMelt: Boolean(exp.meltByChannel[ch]),
    })),
    availablePlotTypes: available,
    unavailablePlotTypes: unavailable,
    xAxisUnits: ['cycle', 'time_s', 'time_min'],
    groups,
    legendOrder: view.legendOrder,
    wells,
    dilutionConfig: view.dilutionConfig,
    session: sessionSummary(loaded),
    spec,
  };
}

/** The view + analysis settings restored from the file, flattened for reading. */
function sessionSummary(loaded: LoadedExperiment): Record<string, unknown> {
  const { view } = loaded;
  const cs = loaded.channelStates.get(view.activeChannel);
  return {
    xAxisMode: view.xAxisMode,
    logScale: view.logScale,
    plotTab: view.plotTab,
    palette: view.palette,
    paletteReversed: view.paletteReversed,
    paletteGroupColors: view.paletteGroupColors,
    lineWidth: view.lineWidth,
    fontFamily: view.fontFamily,
    titleSize: view.titleSize,
    labelSize: view.labelSize,
    tickSize: view.tickSize,
    legendSize: view.legendSize,
    showLegend: view.showLegend,
    legendPosition: view.legendPosition,
    legendContent: view.legendContent,
    showTitle: view.showTitle,
    showLabels: view.showLabels,
    showTicks: view.showTicks,
    showGrid: view.showGrid,
    gridAlpha: view.gridAlpha,
    plotBgColor: view.plotBgColor,
    textColor: view.textColor,
    figureDpi: view.figureDpi,
    hiddenWells: [...view.hiddenWells],
    deactivatedWells: [...view.deactivatedWells],
    baselineEnabled: cs?.baselineEnabled,
    baselineAuto: cs?.baselineAuto,
    baselineMethod: cs?.baselineMethod,
    baselineStart: cs?.baselineStart,
    baselineEnd: cs?.baselineEnd,
    normalizeEnabled: cs?.normalizeEnabled,
    meltNormalizeEnabled: cs?.meltNormalizeEnabled,
    thresholdEnabled: cs?.thresholdEnabled,
    thresholdRfu: cs?.thresholdRfu,
    meltThresholdEnabled: cs?.meltThresholdEnabled,
    meltThresholdValue: cs?.meltThresholdValue,
    smoothingEnabled: cs?.smoothingEnabled,
    smoothingWindow: cs?.smoothingWindow,
    driftCorrectionEnabled: cs?.driftCorrectionEnabled,
  };
}

/**
 * A spec that reproduces the file as saved: one plot panel of the tab the user
 * was last on, inheriting everything else. Deliberately sparse — omitted
 * fields inherit from the file, so the spec stays readable and keeps tracking
 * the source if it is re-saved.
 */
export function buildStartingSpec(loaded: LoadedExperiment): FigureSpec {
  const { exp, view } = loaded;
  const hasMelt = Boolean(exp.melt && Object.keys(exp.melt.rfu).length > 0);
  const plotType: PlotType =
    view.plotTab === 'melt' && hasMelt ? 'melt' : 'amp';

  const panel: PlotPanel = {
    kind: 'plot',
    label: 'A',
    source: loaded.sourcePath,
    plotType,
  };
  if (exp.channels.length > 1) panel.channel = view.activeChannel;

  return {
    id: path.basename(loaded.sourcePath).replace(/\.[^.]+$/, ''),
    output: { width_in: 6.5, height_in: 3.2, dpi: 600, formats: ['pdf', 'png'] },
    layout: { rows: 1, cols: 1, gap_in: 0.14 },
    panelLabels: { mode: 'none' },
    panels: [panel],
  };
}

export async function inspectCommand(source: string): Promise<InspectReport> {
  const loaded = await loadSource(source);
  return buildReport(loaded);
}
