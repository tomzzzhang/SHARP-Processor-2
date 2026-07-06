import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import _createPlotlyComponent from 'react-plotly.js/factory';
import { X, Download, ChevronDown, ChevronUp, Loader2, TriangleAlert } from 'lucide-react';
import { useAppState } from '@/hooks/useAppState';
import { useAnalysisResults } from '@/hooks/useAnalysisResults';
import { buildColorMap, resolveCurveColorWidth } from '@/lib/curve-colors';
import { computeExperimentReport, fitCensorReason, type KineticsReport as Report, type ReportRow } from '@/lib/report/kinetics-report';
import { buildReportHtml, type ReportHtmlCurve } from '@/lib/report/report-html';
import { exportReportBundle } from '@/lib/export';
import { buildReportCsv } from '@/lib/report/report-csv';
import { curveAt, type FivePLParams } from '@/lib/curvefit';
import { getPaletteColors } from '@/lib/constants';
import { wellSortKey } from '@/lib/parsers/utils';
import { effectiveChannelLabel } from '@/lib/channels';
import { toast } from '@/lib/dialogs';
import { Checkbox } from '@/components/ui/checkbox';
import { FOCUS_RING } from '@/lib/ui-classes';
import type { Data, Layout, PlotHoverEvent } from 'plotly.js';

// CJS interop (mirrors PlotArea).
const createPlotlyComponent =
  typeof _createPlotlyComponent === 'function'
    ? _createPlotlyComponent
    : (_createPlotlyComponent as unknown as { default: typeof _createPlotlyComponent }).default;
const Plot = createPlotlyComponent(Plotly);

const PLOT_CONFIG: Partial<Plotly.Config> = {
  responsive: true, displaylogo: false, scrollZoom: false,
  modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'] as Plotly.ModeBarDefaultButtons[],
};

/** Dark-mode detection (report uses its own clean surface). */
function useIsDark() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

type SortKey = 'well' | 'label' | 't_lod' | 't_onset10' | 'td_5' | 'td_20' | 'td_50' | 'yield_raw' | 'melt_tm';

/** Natural well order (row letter, then numeric column): A1 < A2 < A10 < B1. */
const compareWell = (a: string, b: string): number => {
  const [ar, ac] = wellSortKey(a);
  const [br, bc] = wellSortKey(b);
  return ar === br ? ac - bc : ar < br ? -1 : 1;
};
const fitParams = (r: ReportRow): FivePLParams | null =>
  r.fit_A !== null && r.fit_B !== null && r.fit_C !== null && r.fit_D !== null && r.fit_foot !== null && r.fit_shoulder !== null
    ? { A: r.fit_A, B: r.fit_B, C: r.fit_C, D: r.fit_D, foot: r.fit_foot, shoulder: r.fit_shoulder }
    : null;
const num = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? '—' : v.toFixed(d));
const seTxt = (v: number | null) => (v === null || !Number.isFinite(v) ? '' : `±${v < 100 ? v.toFixed(1) : Math.round(v)}`);

/** `metadata.instrument` is `{ manufacturer, model, ... }`, so `String(obj)`
 *  yields "[object Object]" — format it as "manufacturer model" instead. */
const instrumentLabel = (exp: { metadata?: Record<string, unknown>; protocolType?: string } | null | undefined): string => {
  const inst = exp?.metadata?.['instrument'];
  if (inst && typeof inst === 'object') {
    const o = inst as { manufacturer?: string; model?: string };
    const s = [o.manufacturer, o.model].filter(Boolean).join(' ').trim();
    if (s) return s;
  } else if (typeof inst === 'string' && inst.trim()) {
    return inst.trim();
  }
  return exp?.protocolType || '—';
};

/** Linear interpolation of a raw series on its time grid at time `t` — used to
 *  place the `t_lod` marker on the raw curve (it's a detection landmark that
 *  exists independently of the fit). */
function interpAt(rfu: number[], timeS: number[], t: number): number {
  const n = Math.min(rfu.length, timeS.length);
  if (n === 0) return NaN;
  if (t <= timeS[0]) return rfu[0];
  if (t >= timeS[n - 1]) return rfu[n - 1];
  for (let i = 1; i < n; i++) {
    if (timeS[i] >= t) {
      const t0 = timeS[i - 1], t1 = timeS[i];
      const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      return rfu[i - 1] + f * (rfu[i] - rfu[i - 1]);
    }
  }
  return rfu[n - 1];
}

/** One melt curve's peak (for the on-hover Tm callout). */
interface MeltTm { tm: number; peak: number | null; color: string; label: string }

export function KineticsReport({ onClose }: { onClose: () => void }) {
  const experiments = useAppState((s) => s.experiments);
  const idx = useAppState((s) => s.activeExperimentIndex);
  const exp = experiments[idx];
  const activeChannel = useAppState((s) => s.activeChannel);
  const channelLabels = useAppState((s) => s.channelLabels);
  const palette = useAppState((s) => s.palette);
  const paletteReversed = useAppState((s) => s.paletteReversed);
  const wellGroups = useAppState((s) => s.wellGroups);
  const wellStyleOverrides = useAppState((s) => s.wellStyleOverrides);
  const curveStyleOverrides = useAppState((s) => s.curveStyleOverrides);
  const analysisResults = useAnalysisResults();
  const isDark = useIsDark();

  // Lazy compute: deferred to after the overlay paints (rAF), recomputed only
  // when the experiment or channel changes (memoized). Threshold drags and other
  // analysis-setting changes never touch (exp, channel), so the report is stable.
  const [report, setReport] = useState<Report | null>(null);
  const [computing, setComputing] = useState(true);
  useEffect(() => {
    setComputing(true);
    const id = requestAnimationFrame(() => {
      setReport(exp ? computeExperimentReport(exp, activeChannel) : null);
      setComputing(false);
    });
    return () => cancelAnimationFrame(id);
  }, [exp, activeChannel]);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ampOnly, setAmpOnly] = useState(false);
  // Group coloring is the default: wells sharing a group share a colour (the
  // main-plot behaviour). 'curve' colours every S-C pair individually.
  const [colorMode, setColorMode] = useState<'group' | 'curve'>('group');
  // Baseline-corrected is the default (matches the main plot + the readouts:
  // yield = corrected plateau, t_lod on the corrected curve). Raw shows the
  // measured signal for QC.
  const [ampMode, setAmpMode] = useState<'corrected' | 'raw'>('corrected');
  // Time unit for the table + plot x-axis (report times are computed in seconds);
  // defaults to the app's current x-axis preference.
  const [timeUnit, setTimeUnit] = useState<'s' | 'min'>(() => (useAppState.getState().xAxisMode === 'time_min' ? 'min' : 's'));
  const [selected, setSelected] = useState<string | null>(null);
  // Curve currently hovered on the melt panel (curveKey) → highlight + Tm callout.
  const [meltHover, setMeltHover] = useState<string | null>(null);
  // Points-of-interest (landmark) visibility on the amp plot.
  const [showPoi, setShowPoi] = useState({ lod: true, onset: true, infl: true });
  // Raw-data / fitted-model line visibility on the amp panel (data is the truth,
  // drawn bold; the fit is a fainter, thinner overlay — both toggleable).
  const [showData, setShowData] = useState(true);
  const [showFit, setShowFit] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('t_lod');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showRecon, setShowRecon] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const rows = useMemo(() => report?.rows ?? [], [report]);
  const timeS = useMemo(() => report?.timeS ?? [], [report]);
  const amp = exp?.amplificationByChannel[activeChannel] ?? null;
  const melt = exp?.meltByChannel[activeChannel] ?? null;
  const fluor = exp ? effectiveChannelLabel(activeChannel, channelLabels, exp.channelFluorophore) : activeChannel;

  const label = useCallback((r: ReportRow) => r.sample || r.well, []);

  // Colour map — the SAME resolution the main plot uses (shared `curve-colors`),
  // so report colours always match the processor: per-curve override -> per-well
  // override -> grouped/Tt-ordered palette (a hand-set colour or gradient carries
  // through). 'group' mode groups the palette base; 'curve' colours each well.
  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    const base = buildColorMap(
      rows.map((r) => r.well),
      (n) => getPaletteColors(palette, n),
      wellGroups, wellStyleOverrides, analysisResults, paletteReversed, colorMode === 'group',
    );
    for (const r of rows) {
      const ov = resolveCurveColorWidth(r.well, activeChannel, curveStyleOverrides, wellStyleOverrides).color;
      const c = ov ?? base.get(r.well);
      if (c) m.set(r.curveKey, c);
    }
    return m;
  }, [rows, palette, paletteReversed, colorMode, wellGroups, wellStyleOverrides, curveStyleOverrides, analysisResults, activeChannel]);

  const visibleRows = useMemo(
    () => rows.filter((r) => !hidden.has(r.curveKey) && (!ampOnly || r.fired)),
    [rows, hidden, ampOnly],
  );

  const dimOf = useCallback((key: string) => (selected && selected !== key ? 0.12 : 1), [selected]);

  const tScale = timeUnit === 'min' ? 1 / 60 : 1;
  const xfmt = timeUnit === 'min' ? '.1f' : '.0f';

  // Collapse toggle entries that share a colour + name (e.g. group-coloured
  // replicates) into one dot + name + a vertical stack of per-curve checkboxes.
  const toggleGroups = useMemo(() => {
    const map = new Map<string, { color: string; name: string; rows: ReportRow[] }>();
    const order: string[] = [];
    for (const r of rows) {
      const color = colorMap.get(r.curveKey) ?? '#888';
      const name = label(r);
      const key = `${color} :: ${name}`;
      let g = map.get(key);
      if (!g) { g = { color, name, rows: [] }; map.set(key, g); order.push(key); }
      g.rows.push(r);
    }
    return order.map((k) => map.get(k)!);
  }, [rows, colorMap, label]);

  // Uniform tile width: measure the widest tile at its natural width and pin every
  // tile's min-width to it (via the `--tm` CSS var), so the longest label
  // ("Plasmid10⁷") sets the standard, shorter names match it, and the checkbox row
  // right-aligns to that shared edge. Re-measures once the app font has loaded.
  const tilesRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = tilesRef.current;
    if (!el) return;
    const measure = () => {
      el.style.setProperty('--tm', '0px');
      let max = 0;
      for (const t of Array.from(el.children)) max = Math.max(max, (t as HTMLElement).getBoundingClientRect().width);
      el.style.setProperty('--tm', `${Math.ceil(max)}px`);
    };
    measure();
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) measure(); });
    return () => { cancelled = true; };
  }, [toggleGroups]);

  // ── Amplification figure: raw (thin) + fit (bold) + landmark markers ──
  const ampFig = useMemo(() => {
    const data: Data[] = [];
    const xT = timeS.map((t) => t * tScale);
    const lodX: number[] = [], lodY: number[] = [], lodC: string[] = [];
    const onsX: number[] = [], onsY: number[] = [], onsC: string[] = [];
    const infX: number[] = [], infY: number[] = [], infC: string[] = [];
    for (const r of visibleRows) {
      const rfu = amp?.wells[r.well];
      if (!rfu) continue;
      const color = colorMap.get(r.curveKey) ?? '#888';
      const op = dimOf(r.curveKey);
      // Baseline-corrected (default) subtracts the fit's baseline level so every
      // curve starts near 0 and yields/timing are directly comparable; raw shows
      // the measured signal. Same offset applies to the curve, fit, and marks.
      const off = ampMode === 'corrected' ? (r.baseline_offset ?? 0) : 0;
      const disp = off !== 0 ? rfu.map((v) => v - off) : rfu;
      // Data is the ground truth → drawn bold and solid.
      data.push({
        x: xT, y: disp, type: 'scatter', mode: 'lines', name: label(r),
        legendgroup: r.curveKey, showlegend: false, visible: showData, opacity: op,
        line: { color, width: 1.8 }, hoverinfo: 'skip',
      } as Data);
      const showLm = !selected || selected === r.curveKey;
      // t_lod is a DETECTION landmark — computed from the raw curve + run σ,
      // independent of the fit. Mark it on the displayed curve so it shows even
      // when the fit is censored/unusable (e.g. a fired NTC that never plateaued).
      if (showLm && r.t_lod !== null && Number.isFinite(r.t_lod)) {
        lodX.push(r.t_lod * tScale); lodY.push(interpAt(disp, timeS, r.t_lod)); lodC.push(color);
      }
      const p = fitParams(r);
      if (p) {
        // The fit is a model, not data → a fainter, thinner overlay on the truth.
        data.push({
          x: xT, y: timeS.map((t) => curveAt(t, p) - off), type: 'scatter', mode: 'lines',
          name: label(r), legendgroup: r.curveKey, visible: showFit, opacity: 0.5 * op,
          line: { color, width: 1 },
          hovertemplate: `${label(r)} (fit)<br>%{x:${xfmt}} ${timeUnit} · %{y:.0f} RFU<extra></extra>`,
        } as Data);
        // t_onset10 / inflection are fit-derived — only defined when the fit is
        // usable, so they stay on the fitted curve.
        const pushFit = (t: number | null, X: number[], Y: number[], C: string[]) => {
          if (showLm && t !== null && Number.isFinite(t)) { X.push(t * tScale); Y.push(curveAt(t, p) - off); C.push(color); }
        };
        pushFit(r.t_onset10, onsX, onsY, onsC);
        pushFit(r.fit_inflection_t, infX, infY, infC);
      }
    }
    const lm = (x: number[], y: number[], c: string[], sym: string, name: string, visible: boolean): Data => ({
      x, y, type: 'scatter', mode: 'markers', name, visible,
      marker: { symbol: sym, size: 9, color: c, line: { color: isDark ? '#000' : '#fff', width: 1 } },
      hovertemplate: `${name}: %{x:${xfmt}} ${timeUnit}<extra></extra>`,
    } as Data);
    data.push(lm(lodX, lodY, lodC, 'triangle-up', 't_lod', showPoi.lod));
    data.push(lm(onsX, onsY, onsC, 'diamond', 't_onset10', showPoi.onset));
    data.push(lm(infX, infY, infC, 'circle', 'inflection', showPoi.infl));
    return data;
  }, [visibleRows, amp, timeS, colorMap, dimOf, selected, isDark, label, ampMode, tScale, xfmt, timeUnit, showPoi, showData, showFit]);

  // Curve keys in melt-trace order (stable — independent of hover), so a
  // plotly_hover `curveNumber` resolves back to the curve without churning the
  // hover handler on every mouse move.
  const meltKeys = useMemo(() => {
    if (!melt) return [] as string[];
    const keys: string[] = [];
    for (const r of visibleRows) {
      const d = melt.derivative[r.well];
      if (d && d.length >= 2) keys.push(r.curveKey);
    }
    return keys;
  }, [melt, visibleRows]);

  // ── Melt figure: −dF/dT traces. The highlighted melt curve is the hovered one,
  //    or — when nothing is hovered — the row selected in the table, so clicking a
  //    sample highlights its melt curve and shows its Tm at the peak, mirroring the
  //    amp-curve isolation (each sample has exactly one melt curve). This replaces
  //    the always-on Tm labels that overlapped when melt temperatures clustered. ──
  const meltFig = useMemo(() => {
    if (!melt) return { data: [] as Data[], activeTm: null as MeltTm | null };
    const active = meltHover ?? selected;
    const emph = active !== null;
    const data: Data[] = [];
    let activeTm: MeltTm | null = null;
    for (const r of visibleRows) {
      const d = melt.derivative[r.well];
      if (!d || d.length < 2) continue;
      const color = colorMap.get(r.curveKey) ?? '#888';
      const isActive = active === r.curveKey;
      data.push({
        x: melt.temperatureC, y: d, type: 'scatter', mode: 'lines', name: label(r),
        legendgroup: r.curveKey, showlegend: false,
        opacity: emph ? (isActive ? 1 : 0.12) : 1,
        line: { color, width: isActive ? 2.6 : 1.4 },
        hovertemplate: `${label(r)}<br>%{x:.1f}°C · %{y:.0f}<extra></extra>`,
      } as Data);
      if (isActive && r.melt_tm !== null && Number.isFinite(r.melt_tm)) {
        activeTm = { tm: r.melt_tm, peak: r.melt_peak_height, color, label: label(r) };
      }
    }
    return { data, activeTm };
  }, [melt, visibleRows, colorMap, label, meltHover, selected]);

  // Hover is a transient peek; the CLICKED row is the reliable driver (mirrors the
  // amp isolation). Plotly can fire a spurious `unhover` when the emphasis/callout
  // re-renders the plot under the cursor, which made the Tm callout flicker /
  // "not always show" — so debounce the clear (a re-hover within the window
  // cancels it), and clear any stale hover on row-click so a selection always wins.
  const meltUnhoverTimer = useRef<number | null>(null);
  const handleMeltHover = useCallback((e: Readonly<PlotHoverEvent>) => {
    if (meltUnhoverTimer.current !== null) { clearTimeout(meltUnhoverTimer.current); meltUnhoverTimer.current = null; }
    const cn = e.points?.[0]?.curveNumber;
    if (cn === undefined) return;
    const key = meltKeys[cn];
    if (key) setMeltHover((prev) => (prev === key ? prev : key));
  }, [meltKeys]);
  const handleMeltUnhover = useCallback(() => {
    if (meltUnhoverTimer.current !== null) clearTimeout(meltUnhoverTimer.current);
    meltUnhoverTimer.current = window.setTimeout(() => { setMeltHover(null); meltUnhoverTimer.current = null; }, 120);
  }, []);

  // `Plotly.react` (what react-plotly runs on prop change) DROPS a 1→1 annotation
  // change when the trace data also changes — so switching the selected/hovered
  // melt curve updated the emphasis but silently lost the Tm callout (verified
  // against a raw Plotly.react repro). Build the callout here and RE-APPLY it via
  // an explicit `Plotly.relayout` in a layout-effect (which runs after the child's
  // Plotly.react), which reliably repaints it on every switch.
  const meltGdRef = useRef<HTMLElement | null>(null);
  const meltAnns = useMemo<Partial<Layout>['annotations']>(() => {
    const h = meltFig.activeTm;
    if (!h) return [];
    const hasPeak = h.peak !== null && Number.isFinite(h.peak);
    return [{
      x: h.tm,
      y: hasPeak ? (h.peak as number) : 1,
      yref: (hasPeak ? 'y' : 'paper') as 'y' | 'paper',
      text: `${h.label} · Tm ${h.tm.toFixed(1)}°C`,
      showarrow: hasPeak, arrowhead: 0, arrowcolor: h.color, ax: 0, ay: -30,
      font: { size: 11, color: h.color },
      bgcolor: isDark ? 'rgba(28,28,30,0.92)' : 'rgba(255,255,255,0.92)',
      bordercolor: h.color, borderwidth: 1, borderpad: 3,
      yanchor: 'bottom' as const, xanchor: 'center' as const,
      captureevents: false,
    }];
  }, [meltFig.activeTm, isDark]);
  useLayoutEffect(() => {
    const gd = meltGdRef.current;
    if (gd && meltFig.data.length > 0) void Plotly.relayout(gd, { annotations: meltAnns } as Partial<Layout>);
  }, [meltAnns, meltFig.data.length]);

  // ── Residual strip: observed − fit for the row selected in the table. The
  //    residual is display-invariant (the baseline offset cancels on both terms),
  //    so it's simply raw − curveAt. Only curves with a usable fit have residuals
  //    — the same gate as the drawn fit line — otherwise `hasFit` is false and the
  //    strip shows a short note instead. The ±band is the run σ (noise floor). ──
  const residStrip = useMemo(() => {
    if (!selected) return null;
    const r = rows.find((x) => x.curveKey === selected);
    if (!r) return null;
    const runSigma = report?.runSigma ?? NaN;
    const color = colorMap.get(r.curveKey) ?? '#888';
    const p = fitParams(r);
    const rfu = amp?.wells[r.well];
    if (!p || !rfu) {
      const reason = !rfu ? 'No amplification data for this curve.' : fitCensorReason(r);
      return { hasFit: false as const, label: label(r), color, runSigma, reason };
    }
    const xT: number[] = [], resid: number[] = [];
    let maxAbs = 0;
    for (let i = 0; i < timeS.length; i++) {
      const rv = rfu[i] - curveAt(timeS[i], p);
      if (!Number.isFinite(rv)) continue;
      xT.push(timeS[i] * tScale);
      resid.push(rv);
      if (Math.abs(rv) > maxAbs) maxAbs = Math.abs(rv);
    }
    const R = Math.max(4 * (Number.isFinite(runSigma) ? runSigma : 0), 1.1 * maxAbs) || 1;
    const data: Data[] = [{
      x: xT, y: resid, type: 'scatter', mode: 'lines+markers',
      line: { color, width: 1.2 }, marker: { color, size: 3 }, showlegend: false,
      hovertemplate: `%{x:${xfmt}} ${timeUnit} · %{y:.0f} RFU<extra></extra>`, name: 'residual',
    } as Data];
    return { hasFit: true as const, label: label(r), color, runSigma, data, R };
  }, [selected, rows, amp, timeS, tScale, colorMap, label, report, xfmt, timeUnit]);

  const residLayout = useMemo<Partial<Layout> | null>(() => {
    if (!residStrip || !residStrip.hasFit) return null;
    const { R, runSigma, color } = residStrip;
    const band = Number.isFinite(runSigma) ? runSigma : 0;
    return {
      margin: { l: 62, r: 12, t: 6, b: 34 },
      paper_bgcolor: isDark ? '#1e1e1e' : '#ffffff',
      plot_bgcolor: isDark ? '#1e1e1e' : '#ffffff',
      font: { color: isDark ? '#e5e5e5' : '#1a1a1a', size: 11 },
      xaxis: { title: { text: `Time (${timeUnit})` }, gridcolor: isDark ? '#333' : '#f0f0f0', zeroline: false },
      yaxis: { title: { text: 'Residual (RFU)' }, gridcolor: isDark ? '#333' : '#f0f0f0', zeroline: false, range: [-R, R] },
      showlegend: false,
      hovermode: 'closest',
      shapes: [
        { type: 'rect', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: -band, y1: band, fillcolor: color, opacity: 0.1, line: { width: 0 }, layer: 'below' },
        { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 0, y1: 0, line: { color: isDark ? '#555' : '#c9ccd3', width: 1 } },
      ],
    } as Partial<Layout>;
  }, [residStrip, isDark, timeUnit]);

  const baseLayout = useCallback((title: string, xt: string, yt: string): Partial<Layout> => ({
    margin: { l: 62, r: 12, t: 28, b: 42 },
    title: { text: title, font: { size: 12 }, x: 0.01, xanchor: 'left' },
    paper_bgcolor: isDark ? '#1e1e1e' : '#ffffff',
    plot_bgcolor: isDark ? '#1e1e1e' : '#ffffff',
    font: { color: isDark ? '#e5e5e5' : '#1a1a1a', size: 11 },
    xaxis: { title: { text: xt }, gridcolor: isDark ? '#333' : '#f0f0f0', zeroline: false },
    yaxis: { title: { text: yt }, gridcolor: isDark ? '#333' : '#f0f0f0', zeroline: false },
    showlegend: false,
    hovermode: 'closest',
  }), [isDark]);

  const handleSort = useCallback((k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'label' ? 'asc' : 'asc'); }
  }, [sortKey]);

  const sortedRows = useMemo(() => {
    const val = (r: ReportRow): number | string =>
      sortKey === 'label' ? label(r) : (r[sortKey] ?? Infinity);
    const arr = [...rows].sort((a, b) => {
      let cmp: number;
      if (sortKey === 'well') cmp = compareWell(a.well, b.well);
      else {
        const va = val(a), vb = val(b);
        cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      }
      // Stable, meaningful tiebreak so equal values (e.g. shared t_lod) group by well.
      if (cmp === 0 && sortKey !== 'well') cmp = compareWell(a.well, b.well);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir, label]);

  const toggleCurve = useCallback((key: string) => {
    setHidden((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }, []);
  const setGroupVisible = useCallback((keys: string[], visible: boolean) => {
    setHidden((prev) => {
      const n = new Set(prev);
      for (const k of keys) { if (visible) n.delete(k); else n.add(k); }
      return n;
    });
  }, []);
  const allOn = useCallback(() => setHidden(new Set()), []);
  const allOff = useCallback(() => setHidden(new Set(rows.map((r) => r.curveKey))), [rows]);

  const doExport = useCallback(async () => {
    if (!report || !exp) return;
    setExporting(true);
    try {
      const htmlCurves: ReportHtmlCurve[] = sortedRows.map((r) => ({
        key: r.curveKey, label: label(r), color: colorMap.get(r.curveKey) ?? '#888',
        rfu: amp?.wells[r.well] ?? [], fit: fitParams(r), row: r,
        baselineOffset: r.baseline_offset ?? 0,
        deriv: melt?.derivative[r.well] ?? null,
      }));
      const html = buildReportHtml({
        title: exp.experimentId || 'Experiment',
        generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
        corrected: ampMode === 'corrected',
        poi: showPoi,
        condition: [
          { label: 'Instrument', value: instrumentLabel(exp) },
          { label: 'Channel', value: fluor },
          { label: 'Wells', value: String(rows.length) },
          { label: 'Operator', value: exp.operator || '—' },
          { label: 'Run', value: exp.runStarted || '—' },
        ],
        timeS, temperatureC: melt?.temperatureC ?? null, runSigma: report.runSigma, curves: htmlCurves,
      });
      const csv = buildReportCsv(sortedRows, { experiment: exp.experimentId || 'Experiment' });
      const res = await exportReportBundle(html, csv, `${exp.experimentId || 'report'}_kinetics`);
      if (res) toast(`Exported ${res.htmlPath.split(/[\\/]/).pop()} + ${res.csvPath.split(/[\\/]/).pop()}`);
    } catch (e) {
      toast(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }, [report, exp, sortedRows, colorMap, amp, melt, timeS, rows.length, fluor, label, ampMode, showPoi]);

  const SortTh = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th
      className={`px-2 py-1 cursor-pointer select-none hover:text-foreground ${sortKey === k ? 'text-[var(--brand-red-dark)]' : 'text-muted-foreground'} ${className ?? ''}`}
      onClick={() => handleSort(k)}
    >
      <span className="inline-flex items-center gap-0.5">{children}
        {sortKey === k && (sortDir === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
      </span>
    </th>
  );
  const SeCells = ({ v, s, d = 1, int = false, mul = 1 }: { v: number | null; s: number | null; d?: number; int?: boolean; mul?: number }) => (
    <>
      <td className="px-2 py-0.5 text-right tabular-nums">{int ? (v === null ? '—' : Math.round(v).toLocaleString()) : num(v === null ? null : v * mul, d)}</td>
      <td className="px-1 py-0.5 text-right tabular-nums text-[11px] text-muted-foreground bg-muted/50">{seTxt(s === null ? null : s * mul)}</td>
    </>
  );

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{exp?.experimentId || 'Kinetics report'}</h2>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {[
              ['Instrument', instrumentLabel(exp)],
              ['Channel', fluor],
              ['Wells', String(rows.length)],
              ['Operator', exp?.operator || '—'],
              ['Run', exp?.runStarted || '—'],
            ].map(([l, v]) => (
              <span key={l} className="inline-flex items-center gap-1 rounded-full bg-muted border border-border px-2 py-0.5 text-[11px]">
                <span className="text-muted-foreground font-medium">{l}</span>{v}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className={`inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent disabled:opacity-50 ${FOCUS_RING}`}
            onClick={doExport} disabled={exporting || computing || !report}
          >
            {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Export HTML + CSV
          </button>
          <button className={`p-1 rounded-md hover:bg-accent ${FOCUS_RING}`} onClick={onClose} title="Close report">
            <X className="size-4" />
          </button>
        </div>
      </div>

      {computing ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Computing kinetics (fit reused, covariance + landmarks)…</p>
        </div>
      ) : !report || rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          No amplification data to report. Open an experiment first.
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Sample toggles */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Samples</span>
            <button className={`text-xs underline text-muted-foreground hover:text-foreground ${FOCUS_RING}`} onClick={allOn}>all</button>
            <button className={`text-xs underline text-muted-foreground hover:text-foreground ${FOCUS_RING}`} onClick={allOff}>none</button>
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer ml-2">
              <Checkbox checked={ampOnly} onCheckedChange={() => setAmpOnly((v) => !v)} className="size-3" /> Amplifying only
            </label>
            <label className="inline-flex items-center gap-1 text-xs ml-2">
              <span className="text-muted-foreground">Signal</span>
              <select
                value={ampMode}
                onChange={(e) => setAmpMode(e.target.value as 'corrected' | 'raw')}
                className={`border border-border rounded px-1 py-0.5 bg-background ${FOCUS_RING}`}
              >
                <option value="corrected">Baseline-corrected</option>
                <option value="raw">Raw</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-1 text-xs ml-2">
              <span className="text-muted-foreground">Color by</span>
              <select
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value as 'group' | 'curve')}
                className={`border border-border rounded px-1 py-0.5 bg-background ${FOCUS_RING}`}
              >
                <option value="group">Group</option>
                <option value="curve">Curve</option>
              </select>
            </label>
            {selected && (
              <button className={`text-xs underline text-[var(--brand-red-dark)] ${FOCUS_RING}`} onClick={() => setSelected(null)}>clear isolation</button>
            )}
            {/* Content-width tiles — line 1: master · dot · name; line 2: replicate
                checkboxes right-justified to the name's right edge. Each tile hugs its
                own label and flows/wraps; the master toggles the group and tints the
                tile (all = wash, some = faint, off = dim). */}
            <div ref={tilesRef} className="w-full flex flex-wrap gap-2 mt-1 items-start">
              {toggleGroups.map((g) => {
                const keys = g.rows.map((r) => r.curveKey);
                const on = keys.reduce((n, k) => n + (hidden.has(k) ? 0 : 1), 0);
                const st = on === keys.length ? 'all' : on === 0 ? 'none' : 'some';
                const tint = st === 'all'
                  ? { background: `color-mix(in srgb, ${g.color} 12%, var(--card))`, borderColor: `color-mix(in srgb, ${g.color} 30%, var(--border))` }
                  : st === 'some'
                    ? { background: `color-mix(in srgb, ${g.color} 6%, var(--card))` }
                    : undefined;
                return (
                  <div
                    key={`${g.color}|${g.name}`}
                    className={`flex flex-col gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 transition-colors ${st === 'none' ? 'opacity-50' : ''}`}
                    style={{ minWidth: 'var(--tm, 0px)', ...tint }}
                  >
                    {/* Line 1: master · dot · name */}
                    <div className="flex items-center gap-2">
                      {keys.length === 1 ? (
                        <Checkbox
                          checked={st === 'all'}
                          onCheckedChange={() => toggleCurve(keys[0])}
                          className="size-3.5 shrink-0"
                          title={g.rows[0].well}
                        />
                      ) : (
                        <Checkbox
                          checked={st === 'all'}
                          indeterminate={st === 'some'}
                          onCheckedChange={() => setGroupVisible(keys, st !== 'all')}
                          className="size-3.5 shrink-0"
                          title={`Toggle all ${g.name}`}
                        />
                      )}
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: g.color }} />
                      <span className="text-xs font-medium whitespace-nowrap" title={g.name}>{g.name}</span>
                    </div>
                    {/* Line 2: replicate checkboxes, right-justified */}
                    {keys.length > 1 && (
                      <div className="flex justify-end gap-1.5">
                        {g.rows.map((r) => (
                          <Checkbox
                            key={r.curveKey}
                            checked={!hidden.has(r.curveKey)}
                            onCheckedChange={() => toggleCurve(r.curveKey)}
                            className="size-3"
                            title={r.well}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Amplification panel */}
          <div>
            <Plot
              data={ampFig}
              layout={baseLayout(
                ampMode === 'corrected' ? 'Amplification — baseline-corrected + FreeShoulder fit' : 'Amplification — raw + FreeShoulder fit',
                `Time (${timeUnit})`,
                ampMode === 'corrected' ? 'Baseline-corrected RFU' : 'Fluorescence (RFU)',
              )}
              config={PLOT_CONFIG} style={{ width: '100%', height: 340 }} useResizeHandler
            />
            <div className="flex flex-wrap gap-x-3 gap-y-1 items-center text-[11px] text-muted-foreground mt-1.5 px-1">
              {/* Data (bold, the truth) / Fit (faint overlay) line toggles */}
              <label className="inline-flex items-center gap-1.5 cursor-pointer" title="Show or hide the raw data curves">
                <Checkbox checked={showData} onCheckedChange={() => setShowData((v) => !v)} className="size-3" />
                <span className="inline-block w-4 h-[2px] bg-current rounded-full align-middle" />Data
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer" title="Show or hide the fitted model curves">
                <Checkbox checked={showFit} onCheckedChange={() => setShowFit((v) => !v)} className="size-3" />
                <span className="inline-block w-4 h-px bg-current opacity-50 align-middle" />Fit
              </label>
              <span className="w-px h-4 bg-border" />
              {/* Landmark marker toggles — a checkbox to the left of each */}
              {([
                ['lod', '▲', 't_lod', 'the limit-of-detection (t_lod)'],
                ['onset', '◆', 't_onset10', 'the time-to-10% (t_onset10)'],
                ['infl', '●', 'inflection', 'the inflection point'],
              ] as const).map(([k, glyph, txt, desc]) => (
                <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer" title={`Show or hide ${desc} markers`}>
                  <Checkbox checked={showPoi[k]} onCheckedChange={() => setShowPoi((p) => ({ ...p, [k]: !p[k] }))} className="size-3" />
                  <span aria-hidden>{glyph}</span>{txt}
                </label>
              ))}
              <span className="ml-auto">click a table row to isolate</span>
            </div>
          </div>

          {/* Residual strip — appears when a table row is selected */}
          {residStrip && (
            <div>
              {residStrip.hasFit && residLayout ? (
                <>
                  <div className="text-[11px] text-muted-foreground px-1 mb-0.5">
                    <span className="font-medium" style={{ color: residStrip.color }}>{residStrip.label}</span>
                    {' '}residuals (observed − fit) · shaded band = ±1 run σ ({Number.isFinite(residStrip.runSigma) ? Math.round(residStrip.runSigma) : '—'} RFU, the noise floor)
                  </div>
                  <Plot
                    data={residStrip.data}
                    layout={residLayout}
                    config={PLOT_CONFIG} style={{ width: '100%', height: 150 }} useResizeHandler
                  />
                </>
              ) : (
                <div className="flex items-start gap-2 text-[11px] px-3 py-2 border border-dashed border-border rounded-md bg-muted/30">
                  <TriangleAlert className="size-3.5 shrink-0 mt-px text-[var(--brand-red-dark)]" />
                  <div>
                    <span className="font-medium" style={{ color: residStrip.color }}>{residStrip.label}</span>
                    {' — '}<span className="text-muted-foreground">{residStrip.reason}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Melt panel */}
          {meltFig.data.length > 0 && (
            <div>
              <Plot
                data={meltFig.data}
                layout={{ ...baseLayout('Melt — −dF/dT', 'Temperature (°C)', '−dF/dT'), annotations: meltAnns } as Partial<Layout>}
                onInitialized={(_fig, gd) => { meltGdRef.current = gd as HTMLElement; }}
                onUpdate={(_fig, gd) => { meltGdRef.current = gd as HTMLElement; }}
                onHover={handleMeltHover}
                onUnhover={handleMeltUnhover}
                config={PLOT_CONFIG} style={{ width: '100%', height: 240 }} useResizeHandler
              />
              <div className="text-[11px] text-muted-foreground mt-1 px-1">Hover a curve — or click its row in the table — to highlight it and show its melt temperature.</div>
            </div>
          )}

          {/* Kinetics table */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Kinetics</span>
              <label className="inline-flex items-center gap-1 text-xs ml-auto">
                <span className="text-muted-foreground">Time unit</span>
                <select
                  value={timeUnit}
                  onChange={(e) => setTimeUnit(e.target.value as 's' | 'min')}
                  className={`border border-border rounded px-1 py-0.5 bg-background ${FOCUS_RING}`}
                >
                  <option value="s">seconds (s)</option>
                  <option value="min">minutes (min)</option>
                </select>
              </label>
            </div>
            <div className="overflow-x-auto border border-border rounded-md">
              <table className="text-xs w-full">
                <thead>
                  <tr className="border-b border-border" style={{ background: 'color-mix(in srgb, var(--brand-red-mid) 5%, transparent)' }}>
                    <SortTh k="well" className="text-left">Well</SortTh>
                    <SortTh k="label" className="text-left">Sample</SortTh>
                    <SortTh k="t_lod" className="text-right">t_lod ({timeUnit})</SortTh><th className="bg-muted/50" />
                    <SortTh k="t_onset10" className="text-right">t_onset10 ({timeUnit})</SortTh><th className="bg-muted/50" />
                    <SortTh k="td_5" className="text-right">Td₅ ({timeUnit})</SortTh><th className="bg-muted/50" />
                    <SortTh k="td_20" className="text-right">Td₂₀ ({timeUnit})</SortTh><th className="bg-muted/50" />
                    <SortTh k="td_50" className="text-right">Td₅₀ ({timeUnit})</SortTh><th className="bg-muted/50" />
                    <SortTh k="yield_raw" className="text-right">Yield (RFU)</SortTh><th className="bg-muted/50" />
                    <SortTh k="melt_tm" className="text-right">Tm (°C)</SortTh><th className="bg-muted/50" />
                    <th className="px-2 py-1 text-center text-muted-foreground" title="baseline observed">base</th>
                    <th className="px-2 py-1 text-center text-muted-foreground" title="plateau observed (unchecked = right-censored)">plat</th>
                    <th className="px-2 py-1 text-center text-muted-foreground">call</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => {
                    const sel = selected === r.curveKey;
                    return (
                      <tr
                        key={r.curveKey}
                        className="border-b border-border/60 cursor-pointer hover:bg-accent"
                        style={{ background: sel ? 'var(--accent)' : undefined, borderLeft: sel ? '2.5px solid var(--brand-red-mid)' : undefined }}
                        onClick={() => { setMeltHover(null); setSelected(sel ? null : r.curveKey); }}
                      >
                        <td className="px-2 py-0.5 font-mono text-muted-foreground whitespace-nowrap tabular-nums">{r.well}</td>
                        <td className="px-2 py-0.5 font-medium whitespace-nowrap" style={{ color: colorMap.get(r.curveKey) }}>{label(r)}</td>
                        <SeCells v={r.t_lod} s={r.t_lod_se} mul={tScale} />
                        <SeCells v={r.t_onset10} s={r.t_onset10_se} mul={tScale} />
                        <SeCells v={r.td_5} s={r.td_5_se} mul={tScale} />
                        <SeCells v={r.td_20} s={r.td_20_se} mul={tScale} />
                        <SeCells v={r.td_50} s={r.td_50_se} mul={tScale} />
                        <SeCells v={r.yield_raw} s={r.yield_raw_se} int />
                        <SeCells v={r.melt_tm} s={r.melt_tm_se} d={2} />
                        <td className="px-2 py-0.5 text-center">{r.baseline_observed ? <span className="text-green-600">✓</span> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-2 py-0.5 text-center">{r.plateau_observed ? <span className="text-green-600">✓</span> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-2 py-0.5 text-center font-bold" style={{ color: r.call === 'positive' ? 'var(--call-positive)' : r.call === 'negative' ? 'var(--call-negative)' : undefined }}>
                          {r.call === 'positive' ? '+' : r.call === 'negative' ? '−' : '?'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Shaded ± columns are standard errors. Fit-derived kinetics are nulled when the plateau is not observed (<b>plat</b> unchecked ⇒ right-censored) or the fitted transition falls outside the measured time window.
            </div>
          </div>

          {/* Curve reconstruction (collapsed) */}
          <div>
            <button
              className={`inline-flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wide ${FOCUS_RING}`}
              onClick={() => setShowRecon((v) => !v)}
            >
              {showRecon ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5 rotate-180" />}
              Curve reconstruction (FreeShoulder parameters)
            </button>
            {showRecon && (
              <div className="overflow-x-auto border border-border rounded-md mt-1">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="px-2 py-1 text-left">Well</th>
                      <th className="px-2 py-1 text-left">Sample</th>
                      {['A', 'B', 'C', 'D', 'foot', 'shoulder'].map((h) => (
                        <th key={h} className="px-2 py-1 text-right" colSpan={2}>{h}</th>
                      ))}
                      <th className="px-2 py-1 text-right">r²</th><th className="px-2 py-1 text-right">rmse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r) => (
                      <tr key={r.curveKey} className="border-b border-border/60">
                        <td className="px-2 py-0.5 font-mono text-muted-foreground whitespace-nowrap tabular-nums">{r.well}</td>
                        <td className="px-2 py-0.5 font-medium whitespace-nowrap" style={{ color: colorMap.get(r.curveKey) }}>{label(r)}</td>
                        <SeCells v={r.fit_A} s={r.fit_A_se} />
                        <SeCells v={r.fit_B} s={r.fit_B_se} d={4} />
                        <SeCells v={r.fit_C} s={r.fit_C_se} />
                        <SeCells v={r.fit_D} s={r.fit_D_se} />
                        <SeCells v={r.fit_foot} s={r.fit_foot_se} d={2} />
                        <SeCells v={r.fit_shoulder} s={r.fit_shoulder_se} d={2} />
                        <td className="px-2 py-0.5 text-right tabular-nums">{num(r.fit_r2, 3)}</td>
                        <td className="px-2 py-0.5 text-right tabular-nums">{num(r.fit_rmse, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
