import { useState, useRef, useEffect } from 'react';
import { DialogCloseButton } from '@/components/ui/DialogCloseButton';
import { FOCUS_RING } from '@/lib/ui-classes';

const isMac = navigator.platform.toUpperCase().includes('MAC');
const mod = isMac ? '⌘' : 'Ctrl';

// ── Section data ─────────────────────────────────────────────────────

interface Section {
  id: string;
  title: string;
  content: React.ReactNode;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="px-1.5 py-0.5 bg-muted rounded text-[11px] font-mono border border-border">{children}</kbd>;
}

function TH({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-2 py-1.5 text-xs font-semibold bg-muted/50 border-b border-border">{children}</th>;
}

function TD({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-1.5 text-xs border-b border-border/50">{children}</td>;
}

const sections: Section[] = [
  {
    id: 'overview',
    title: 'Overview',
    content: (
      <p>
        SHARP Processor 2 is a desktop application for analysing real-time amplification (qPCR / isothermal) data.
        It reads data from multiple instrument formats, displays amplification and melt curves, and provides
        baseline correction, threshold detection, standard-curve analysis, and flexible export options.
        Experiments with multiple fluorophores are fully supported — each dye is detected and analysed
        independently (see <strong>Multiple Fluorophores (Channels)</strong>).
      </p>
    ),
  },
  {
    id: 'getting-started',
    title: 'Getting Started',
    content: (
      <div className="space-y-3">
        <h4 className="font-semibold text-xs">Supported Formats</h4>
        <table className="w-full text-xs border border-border rounded">
          <thead>
            <tr><TH>Format</TH><TH>Source</TH><TH>Extension</TH></tr>
          </thead>
          <tbody>
            <tr><TD>SHARP archive</TD><TD>Native format (data only)</TD><TD>.sharp</TD></tr>
            <tr><TD>SHARP session</TD><TD>Native format (data + workspace)</TD><TD>.sharpx</TD></tr>
            <tr><TD>BioRad CFX96</TD><TD>Instrument file</TD><TD>.pcrd</TD></tr>
            <tr><TD>TianLong Gentier</TD><TD>Instrument file</TD><TD>.tlpd</TD></tr>
            <tr><TD>ThermoFisher QuantStudio</TD><TD>Instrument file</TD><TD>.eds</TD></tr>
            <tr><TD>Agilent AriaMx</TD><TD>Instrument file</TD><TD>.amxd / .adxd</TD></tr>
          </tbody>
        </table>

        <p className="text-xs text-muted-foreground mt-2">
          <strong>ThermoFisher QuantStudio (.eds).</strong> QuantStudio assigns a target to the whole plate, so a
          <code>.eds</code> looks "full" even when only some wells were loaded. The app detects the wells that were
          actually loaded (a loaded well fluoresces from its dye; an empty one does not) and switches the rest off, so
          your plate shows only real wells. The amplification signal is the <strong>raw dye fluorescence</strong>, and
          the time axis uses the instrument's <strong>recorded per-cycle timestamps</strong>, not an assumed cycle length.
        </p>

        <h4 className="font-semibold text-xs">Loading Data</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>File &gt; Open</strong> (<Kbd>{mod}+O</Kbd>) — file dialog</li>
          <li><strong>Drag and drop</strong> — drag any supported file onto the window</li>
          <li><strong>Recent Experiments</strong> — click any file in the sidebar list to reopen it</li>
          <li><strong>Load file…</strong> button in the sidebar (when no experiment is loaded)</li>
        </ul>
        <p>
          The app opens with a Welcome tab. Load a file to replace it with your experiment data.
          Multiple experiments can be loaded simultaneously — each gets its own tab above the plot area.
          Click <strong>+</strong> to open a new empty tab, or click × to close one.
        </p>

        <h4 className="font-semibold text-xs mt-3">Checking for Updates</h4>
        <p>
          Go to <strong>Help &gt; Check for Updates</strong> to see if a newer version is available.
          The app also checks automatically on launch and shows a banner if an update is found.
        </p>
      </div>
    ),
  },
  {
    id: 'layout',
    title: 'Window Layout',
    content: (
      <div className="space-y-3">
        {/* Visual layout diagram — styled to match actual app */}
        <div className="border border-border rounded-md overflow-hidden text-[9px] leading-none whitespace-nowrap" style={{ background: '#f3f2f0', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          {/* Menu bar */}
          <div className="flex items-center gap-3 px-2.5 py-1" style={{ borderBottom: '1px solid #ddd8d3', background: '#f3f2f0' }}>
            {['File', 'Edit', 'View', 'Tools', 'Export', 'Help'].map(m => (
              <span key={m} style={{ color: '#212224', fontSize: 9 }}>{m}</span>
            ))}
          </div>
          {/* Main row — sidebar | content column | MENU panel (full height) */}
          <div className="flex" style={{ minHeight: 200 }}>
            {/* Sidebar */}
            <div className="shrink-0" style={{ width: 170, borderRight: '1px solid #ddd8d3' }}>
              {/* Sidebar tabs */}
              <div className="flex" style={{ borderBottom: '1px solid #ddd8d3' }}>
                {['DATA', 'WELLS', 'ANALYSIS', 'STYLE'].map((t) => {
                  const active = t === 'WELLS';
                  return (
                    <div key={t} className="flex-1 text-center py-1" style={{
                      fontSize: 7.5, fontWeight: active ? 700 : 400, letterSpacing: '0.03em',
                      color: active ? '#aa2026' : '#888',
                      borderBottom: active ? '2px solid #aa2026' : 'none',
                    }}>{t}</div>
                  );
                })}
              </div>
              {/* Sidebar content — Wells tab: select buttons, mini plate grid, list row */}
              <div className="p-2 space-y-1.5">
                <div className="flex gap-1">
                  {['All', 'Samp', 'NTC', 'Shown'].map((b) => (
                    <span key={b} className="px-1 py-0.5 rounded" style={{ fontSize: 6.5, border: '1px solid #ddd8d3', background: '#faf9f8', color: '#555' }}>{b}</span>
                  ))}
                </div>
                <div className="grid" style={{ gridTemplateColumns: 'repeat(12, 1fr)', gap: 1.5 }}>
                  {Array.from({ length: 96 }).map((_, i) => {
                    const col = i % 12;
                    // Three samples, greyscale (curve colours are greyscale in this mock).
                    const greys = ['#4f4f4f', '#7d7d7d', '#a8a8a8'];
                    const selected = i === 13 || i === 14 || i === 25 || i === 26;
                    return (
                      <div key={i} style={{
                        aspectRatio: '1', borderRadius: 1,
                        background: col < 3 ? greys[col] : '#e6e2dd',
                        boxShadow: selected ? '0 0 0 1px #aa2026' : 'none',
                      }} />
                    );
                  })}
                </div>
                <div className="pt-0.5" style={{ borderTop: '1px solid #e8e5e2' }}>
                  <div className="flex" style={{ fontSize: 6.5, color: '#888', fontWeight: 600 }}>
                    <span style={{ width: 12 }}>L</span><span style={{ width: 22 }}>Well</span><span className="flex-1">Sample</span><span style={{ width: 26 }}>Type</span>
                  </div>
                  <div className="flex items-center" style={{ fontSize: 6.5, color: '#555', paddingTop: 1 }}>
                    <span style={{ width: 12, color: '#aa2026' }}>◉</span><span style={{ width: 22, color: '#4f4f4f' }}>A1</span><span className="flex-1">Sample 1</span><span style={{ width: 26 }}>Samp</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Content column — plot tabs + plot + mini-plot + resize handle + results table */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Experiment tab bar — one open experiment */}
              <div className="flex items-end gap-0.5 px-1 pt-0.5" style={{ borderBottom: '1px solid #ddd8d3', background: '#eeece9', minHeight: 14 }}>
                <span className="flex items-center gap-1 px-1.5 py-0.5" style={{ fontSize: 7, background: '#f9f8f7', borderBottom: '2px solid #aa2026', color: '#212224', fontWeight: 600, borderTopLeftRadius: 2, borderTopRightRadius: 2 }}>cov_run_private-date <span style={{ color: '#999' }}>×</span></span>
                <span className="px-1" style={{ fontSize: 8, color: '#999' }}>+</span>
              </div>

              {/* Plot tabs + Auto Baseline + Log + X-axis on same row */}
              <div className="flex items-center" style={{ borderBottom: '1px solid #ddd8d3' }}>
                {['Amplification', 'Melt', 'Standard Curve'].map((t, i) => (
                  <div key={t} className="px-1.5 py-1" style={{
                    fontSize: 7.5, color: i === 0 ? '#aa2026' : '#999',
                    fontWeight: i === 0 ? 600 : 400,
                    borderBottom: i === 0 ? '2px solid #aa2026' : 'none',
                  }}>{t}</div>
                ))}
                <span className="flex-1" />
                <div className="flex items-center gap-1 pr-2" style={{ fontSize: 6.5, color: '#666' }}>
                  <span style={{ color: '#ccc' }}>|</span>
                  <span style={{ color: '#aa2026' }}>◉</span><span>Auto Baseline</span>
                  <span style={{ color: '#ccc' }}>|</span>
                  <span>○ Log</span>
                  <span style={{ color: '#ccc' }}>|</span>
                  <span style={{ color: '#aa2026' }}>◉</span><span>Auto-scale</span>
                  <span className="px-1 rounded" style={{ border: '1px solid #ddd8d3', background: '#faf9f8', color: '#212224' }}>Fit</span>
                  <span style={{ color: '#ccc' }}>|</span>
                  <span>X:</span>
                  <span className="px-1 rounded" style={{ border: '1px solid #ddd8d3', background: '#faf9f8', color: '#212224' }}>Min ▾</span>
                </div>
              </div>

              {/* Plot area — sketch of amplification curves + draggable threshold */}
              <div className="flex-1 m-1 rounded relative" style={{ background: '#fafafa', border: '1px solid #e8e5e2', minHeight: 64 }}>
                <svg viewBox="0 0 200 80" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
                  {[20, 40, 60].map((y) => <line key={y} x1="6" y1={y} x2="196" y2={y} stroke="#efeae3" strokeWidth="0.6" />)}
                  <line x1="6" y1="40" x2="196" y2="40" stroke="#d32f2f" strokeWidth="0.8" strokeDasharray="4,2.5" />
                  <path d="M6,72 C70,71 95,68 110,30 C118,12 135,9 196,8" fill="none" stroke="#3a3a3a" strokeWidth="1.2" />
                  <path d="M6,73 C85,72 108,69 124,36 C132,18 150,15 196,14" fill="none" stroke="#707070" strokeWidth="1.2" />
                  <path d="M6,74 C95,73 120,70 138,44 C146,28 165,24 196,22" fill="none" stroke="#9a9a9a" strokeWidth="1.2" />
                  <path d="M6,75 C90,75 150,74 196,74" fill="none" stroke="#c8c8c8" strokeWidth="1" />
                </svg>
                <span style={{ position: 'absolute', left: 6, top: 3, fontSize: 7, color: '#bbb' }}>Amplification</span>
                {/* Reset ("house") button + gesture-hint chip, top-right */}
                <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2.4"
                     style={{ position: 'absolute', right: 3, top: 3 }}>
                  <path d="M3 11l9-8 9 8" /><path d="M5 9v11h14V9" />
                </svg>
                <span style={{
                  position: 'absolute', right: 13, top: 2.5,
                  fontSize: 5.5, color: '#9a9a9a', lineHeight: 1, whiteSpace: 'nowrap',
                  background: 'rgba(250,250,250,0.85)', border: '1px solid #ece8e3',
                  borderRadius: 2, padding: '1px 2.5px',
                }}>drag: select · pan · zoom · resize · reset</span>
              </div>

              {/* Melt deriv mini-plot — only on the Amplification tab when melt data is present */}
              <div className="mx-1 mb-0.5 rounded relative" style={{ height: 26, background: '#fafafa', border: '1px solid #e8e5e2' }}>
                <svg viewBox="0 0 200 26" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
                  <path d="M6,22 L70,21 C95,21 100,4 116,4 C132,4 138,21 160,21 L196,22" fill="none" stroke="#707070" strokeWidth="1.2" />
                </svg>
                <span style={{ position: 'absolute', left: 6, top: 2, fontSize: 6.5, color: '#bbb' }}>−dF/dT (melt derivative)</span>
              </div>

              {/* Resize handle — between plot area and results table */}
              <div className="flex items-center justify-center" style={{ height: 5, borderTop: '1px solid #ddd8d3', borderBottom: '1px solid #ddd8d3' }}>
                <span style={{ fontSize: 6, color: '#bbb', letterSpacing: '1px' }}>· · ·</span>
              </div>

              {/* Results table */}
              <div style={{ fontSize: 7, padding: '3px 6px', color: '#888' }}>
                <div className="flex" style={{ borderBottom: '1px solid #e8e5e2', paddingBottom: 2, marginBottom: 2, fontWeight: 600, color: '#555' }}>
                  <span style={{ width: '12%' }}>Well</span>
                  <span className="flex-1">Sample</span>
                  <span style={{ width: '12%' }}>Type</span>
                  <span style={{ width: '11%', textAlign: 'right' }}>Tt</span>
                  <span style={{ width: '11%', textAlign: 'right' }}>Tm</span>
                  <span style={{ width: '9%', textAlign: 'center' }}>Call</span>
                  <span style={{ width: '15%', textAlign: 'right' }}>End RFU</span>
                </div>
                <div className="flex" style={{ color: '#777' }}>
                  <span style={{ width: '12%', color: '#4f4f4f' }}>A1</span>
                  <span className="flex-1">Sample 1</span>
                  <span style={{ width: '12%' }}>Samp</span>
                  <span style={{ width: '11%', textAlign: 'right' }}>12.4</span>
                  <span style={{ width: '11%', textAlign: 'right' }}>85.3°</span>
                  <span style={{ width: '9%', textAlign: 'center', color: '#16a34a', fontWeight: 700 }}>+</span>
                  <span style={{ width: '15%', textAlign: 'right' }}>4,521</span>
                </div>
                <div className="flex" style={{ color: '#777' }}>
                  <span style={{ width: '12%', color: '#9a9a9a' }}>A2</span>
                  <span className="flex-1">NTC 1</span>
                  <span style={{ width: '12%' }}>NTC</span>
                  <span style={{ width: '11%', textAlign: 'right' }}>—</span>
                  <span style={{ width: '11%', textAlign: 'right' }}>—</span>
                  <span style={{ width: '9%', textAlign: 'center', color: '#9e9e9e', fontWeight: 700 }}>−</span>
                  <span style={{ width: '15%', textAlign: 'right' }}>182</span>
                </div>
              </div>
            </div>

            {/* MENU panel — full height, right edge */}
            <div className="flex items-center justify-center" style={{ width: 16, borderLeft: '1px solid #ddd8d3', background: '#f3f2f0', color: '#7d2126', writingMode: 'vertical-rl', fontSize: 7, fontWeight: 700, letterSpacing: '0.08em' }}>
              MENU
            </div>
          </div>
        </div>

        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Left sidebar</strong> — four tabs: Data, Wells, Analysis, Style (drag the right border to resize, 300–450 px).</li>
          <li><strong>Centre column</strong> — experiment tab bar (once files are loaded); a plot-tabs row with Auto Baseline, Log, Auto-scale, a Fit button, and an X-axis dropdown (plus a per-channel toggle block for multichannel data); the plot; an optional melt-derivative mini-plot below the amplification chart; and the results table at the bottom (drag the horizontal divider to resize).</li>
          <li><strong>Right edge</strong> — collapsible <strong>MENU</strong> panel spanning the full main-area height (quick actions mirroring the right-click context menu).</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'sidebar',
    title: 'Sidebar Tabs',
    content: (
      <div className="space-y-4">
        <div>
          <h4 className="font-semibold text-xs mb-1">Data Tab</h4>
          <p>A summary of the loaded experiment (ID, type, operator, well count, cycle count, melt availability, run start), an editable <strong>Experiment Notes</strong> box (type and click away to save), and Export / Save / Open buttons.</p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Wells Tab</h4>
          <p className="mb-2">Contains the plate grid, selection toolbar, and well list.</p>

          <p className="text-xs font-medium mb-1">Plate Grid</p>
          <p className="mb-1">Wells are colour-coded by state:</p>
          <table className="w-full text-xs border border-border rounded mb-2">
            <thead><tr><TH>State</TH><TH>Appearance</TH></tr></thead>
            <tbody>
              <tr><TD>Empty (no data)</TD><TD>Light grey, not selectable</TD></tr>
              <tr><TD>Populated</TD><TD>Filled with the well's curve colour</TD></tr>
              <tr><TD>Hidden</TD><TD>Dimmed grey</TD></tr>
              <tr><TD>Selected</TD><TD>Brand-red border</TD></tr>
              <tr><TD>Hovered</TD><TD>Brand-red outline</TD></tr>
            </tbody>
          </table>

          <p className="text-xs font-medium mb-1">Selecting wells:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><strong>Click</strong> a well to select it alone</li>
            <li><strong>{isMac ? '⌘' : 'Ctrl'}+Click</strong> to add/remove from selection</li>
            <li><strong>Click+Drag</strong> to rubber-band select a rectangular region</li>
          </ul>

          <p className="text-xs font-medium mt-2 mb-1">Selection Toolbar</p>
          <p>Quick-select buttons (All, Samp, NTC, Std, Shown, Hidden), a <strong>Group</strong> dropdown, and — for multichannel experiments — a <strong>Fluor</strong> dropdown to select every curve of one dye.</p>

          <p className="text-xs font-medium mt-2 mb-1">Well List</p>
          <p>Sortable table with columns <strong>L</strong> (visibility), <strong>Well</strong>, <strong>Sample</strong> (click to edit), <strong>Type</strong> (click to pick), <strong>Fluor</strong> (multichannel only), and <strong>Group</strong>. The Well label is tinted with its curve colour, and every header is click-to-sort. In multichannel view there is one row per sample-channel pair.</p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Analysis Tab</h4>
          <p className="text-xs font-medium mb-1">Baseline Correction</p>
          <ul className="list-disc pl-5 space-y-0.5 mb-2">
            <li>Enable/disable globally with the checkbox</li>
            <li><strong>Auto baseline</strong> (on by default): fits each well's amplification curve and uses the fitted baseline level. This follows the true pre-amplification baseline even through early signal dips (helicase warm-up) and handles wells that amplify at different times, with no manual tuning. If a curve is too irregular to fit cleanly (e.g. a noisy non-amplifying control), it automatically falls back to a robust low-level estimate rather than trusting a bad fit.</li>
            <li>Method &amp; Zone (Horizontal/Linear + Start/End): used only when Auto baseline is off globally, or for individual wells opted out of auto. Start/End values are entered in whatever x-axis unit you're viewing (cycle / sec / min) and snap to the nearest cycle on commit.</li>
            <li>Per-well opt-out: select wells, right-click → <em>Baseline → Manual</em> (or use the Analysis panel's per-well override section). Opted-out wells fall back to the global manual Method/Zone settings.</li>
            <li>Show raw overlay: draws faint dotted raw curves behind corrected curves</li>
          </ul>

          <p className="text-xs font-medium mb-1">Normalization</p>
          <ul className="list-disc pl-5 space-y-0.5 mb-2">
            <li><strong>Normalize selected</strong>: each amp curve rescales 0 → 1 between its baseline and its plateau.</li>
            <li>Non-amplifying wells (NTCs, failures) are detected by SNR and divided by the median amplifying-well plateau — they stay small and flat instead of blowing up the shared y-axis with divide-by-near-zero noise.</li>
            <li>Per-well overrides: opt a well out of normalization, or set custom plateau Start/End in the Analysis panel's per-well table.</li>
            <li>Baseline-zone shading, threshold line, and raw overlay are hidden when normalization is on (they're in raw-RFU units).</li>
            <li>Melt tab has its own <strong>Normalize</strong> checkbox doing the analogous HRM-style 1 → 0 rescale on melt RFU. The −dF/dT derivative is always computed from raw signal, so peak heights stay physical.</li>
          </ul>

          <p className="text-xs font-medium mb-1">Kinetics</p>
          <ul className="list-disc pl-5 space-y-0.5 mb-2">
            <li>Toggle kinetic <strong>landmarks</strong> onto the amplification plot — <strong>t_lod</strong> (limit of detection), <strong>t_onset10</strong> (time to 10% of fitted height), and the <strong>inflection</strong> point. They draw on the displayed curves (for the selected wells) and carry into exported figures.</li>
            <li>The results table below the plot also gains <strong>t_LoD</strong> and <strong>10%</strong> columns (in the x-axis time unit). Full per-curve readouts with standard errors live in the <strong>Kinetics Report</strong> (Tools menu — see that section).</li>
          </ul>

          <p className="text-xs font-medium mb-1">Thresholds</p>
          <ul className="list-disc pl-5 space-y-0.5 mb-2">
            <li><strong>Amplification</strong> — enable to show a red dashed line on the amp plot; set the RFU value by spinbox or by dragging the line. <em>Off by default</em>, so the results-table Tt column reads &ldquo;—&rdquo; until you enable it.</li>
            <li><strong>Melt</strong> — an optional minimum −dF/dT peak height; wells with no peak above it are dimmed on the melt plots.</li>
          </ul>

          <p className="text-xs font-medium mb-1">Amp Smoothing</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>Optional Savitzky–Golay smoothing of the amplification curves for display.</li>
            <li>Standard-curve / doubling-time fitting lives in the <strong>Standard Curve Wizard</strong> (Tools menu) — see that section.</li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Style Tab</h4>
          <table className="w-full text-xs border border-border rounded">
            <thead><tr><TH>Section</TH><TH>Controls</TH></tr></thead>
            <tbody>
              <tr><TD>Colors &amp; Lines</TD><TD>Palette + <strong>Apply</strong> (choosing a palette changes nothing until you press Apply — see below), reverse, group-colour, assign-by-arrow, clear custom colours/styles, line width (0.3–5.0 pt), line style, plot background. Multichannel adds per-channel colour / line-style controls.</TD></tr>
              <tr><TD>Typography</TD><TD>Font family; title / labels / ticks / legend sizes (each show-hide-able); text colour (auto / black / white)</TD></tr>
              <tr><TD>Legend</TD><TD>Show, per-plot toggles, content (sample / well / group), position, "Selected wells only", drag-to-reorder</TD></tr>
              <tr><TD>Grid &amp; Export</TD><TD>Grid show/opacity and export DPI (72–600)</TD></tr>
              <tr><TD>Presets</TD><TD>Save / Load / Reset / delete style presets</TD></tr>
            </tbody>
          </table>
          <p className="mt-2"><strong>Applying a palette.</strong> Choosing a palette from the dropdown does <em>not</em> recolour anything — press <strong>Apply</strong> next to it. Apply colours the curves that are <strong>shown at that moment</strong>, in order of detection time, and <strong>keeps them that way</strong>: hiding or showing wells afterwards never recolours your curves. Press Apply again to re-spread the palette over whatever is shown then. <strong>Reversed</strong> and <strong>Group colors</strong> are options for the next Apply. Grouped wells share one colour, so grouping replicates gives one colour per group.</p>
        </div>
      </div>
    ),
  },
  {
    id: 'plot-interactions',
    title: 'Plot Interactions',
    content: (
      <div className="space-y-3">
        <div>
          <h4 className="font-semibold text-xs mb-1">Amplification Plot</h4>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><strong>LMB drag</strong> — box-select wells whose curves pass through the box</li>
            <li><strong>MMB drag</strong> — pan the view</li>
            <li><strong>MMB scroll</strong> — zoom in/out (centered on the cursor)</li>
            <li><strong>RMB drag</strong> — resize the view to the dragged rectangle (blue dashed overlay)</li>
            <li><strong>Double right-click</strong> — reset the view to auto-range</li>
            <li><strong>Right-click (single, stationary)</strong> — context menu appears on release (see below)</li>
            <li><strong>Threshold drag</strong> — grab the red dashed line and drag up/down</li>
            <li><strong>Kinetic landmarks</strong> — enable in Analysis → Kinetics to mark t_lod / t_onset10 / inflection on the curves</li>
            <li><strong>Auto Baseline / Log Scale</strong> — checkboxes in the plot tabs bar above the chart</li>
            <li><strong>Click a trace</strong> — selects that well across grid, list, and table</li>
            <li><strong>Hover</strong> — highlights the corresponding well on the grid and in the sample list</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-1">Hint: a small mouse-icon legend in the top-right corner of the amplification and melt plots — just left of the reset (house) button — summarizes the LMB/MMB/RMB gestures.</p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Legend</h4>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>By default the legend shows <strong>sample names</strong>. Switch to well names via <em>Style → Legend → Content</em></li>
            <li><strong>Hover a legend entry</strong> — highlights the matching curve, grid cell, and sample list row</li>
            <li>Legend clicks are disabled (use the <strong>L</strong> checkbox in the sample list to hide/show wells instead)</li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Melt Plot</h4>
          <p>Two subplots: raw RFU (top) and −dF/dT derivative (bottom). Click-to-select and right-click context menu available. A melt derivative mini-plot also appears below the amplification plot when melt data is available.</p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Context Menu (Right-Click)</h4>
          <p className="mb-1 text-muted-foreground">The menu header shows how many curves are selected. Items:</p>
          <table className="w-full text-xs border border-border rounded">
            <thead><tr><TH>Item</TH><TH>Action</TH></tr></thead>
            <tbody>
              <tr><TD>Show / Hide</TD><TD>Toggle plot visibility of the selection</TD></tr>
              <tr><TD>Deselect All</TD><TD>Clear the selection</TD></tr>
              <tr><TD>Sample Type ›</TD><TD>Classify the selected wells</TD></tr>
              <tr><TD>Group… / Remove from Group</TD><TD>Assign to, or remove from, a named group</TD></tr>
              <tr><TD>Auto-Group by Sample</TD><TD>Create groups from matching sample names</TD></tr>
              <tr><TD>Color › / Line Style ›</TD><TD>Recolour or restyle the selected curves</TD></tr>
              <tr><TD>Clear Style Overrides</TD><TD>Drop custom colour / line style on the selection</TD></tr>
              <tr><TD>Palette ›</TD><TD>Apply a palette (with a Gradients submenu, a "Group coloring" option, and Reverse Colors)</TD></tr>
              <tr><TD>Baseline ›</TD><TD>Set the selection to Auto / Manual / Follow global default</TD></tr>
              <tr><TD>Add / Remove from Legend</TD><TD>Show or hide the selection in the legend</TD></tr>
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Quick-Action Panel</h4>
          <p>Click the <strong>MENU</strong> tab on the right edge to expand the <strong>Quick Actions</strong> panel — the same actions as the right-click menu, grouped into Visibility, Sample Type, Grouping, Style, Palette, Baseline, and Legend sections. Keyboard shortcut hints appear next to actions that have them.</p>
        </div>
      </div>
    ),
  },
  {
    id: 'channels',
    title: 'Multiple Fluorophores (Channels)',
    content: (
      <div className="space-y-3">
        <p>
          When an experiment contains more than one dye (for example FAM + HEX, or a 4-plex),
          SHARP Processor detects every fluorophore channel and lets you analyse each one
          independently. A single-dye experiment hides all of these controls and behaves exactly
          like earlier versions.
        </p>

        <h4 className="font-semibold text-xs">Showing &amp; hiding channels</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li>The plot-tabs bar gains a <strong>channel toggle</strong> for each dye — turn a fluorophore on or off for all wells at once.</li>
          <li>In the <strong>Wells</strong> tab, the <strong>L</strong> (visible) checkbox hides a single dye for one well.</li>
          <li><strong>View &gt; Channel Display</strong> switches between <strong>Multichannel</strong> (all dyes overlaid) and <strong>Single</strong> (one dye, classic layout). In single view a small <strong>Channel</strong> dropdown in the plot-tabs bar picks which dye you're viewing.</li>
        </ul>

        <h4 className="font-semibold text-xs">Naming &amp; colouring dyes</h4>
        <p>
          <strong>Tools &gt; Assign Fluorophores…</strong> opens a dialog where you can rename each
          channel and choose its colour. Names and colours flow through to the legend, the Wells
          table, and the results table. In multichannel view each dye's wells are drawn as a
          light-to-dark ramp of that dye's colour; you can also separate dyes by line style from
          the <strong>Style</strong> tab.
        </p>

        <h4 className="font-semibold text-xs">Analysing each dye separately</h4>
        <p>
          Baseline correction, threshold, normalization, and drift correction are stored
          <strong> per channel</strong>. In the <strong>Analysis</strong> tab, the{' '}
          <strong>"Settings for: [channel]"</strong> selector chooses which dye you're configuring;
          each dye keeps its own settings. Choose <strong>All channels</strong> to apply a global
          toggle to every dye at once.
        </p>

        <h4 className="font-semibold text-xs">Selecting by dye</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Click a curve</strong> on the plot to select that single (well, dye) pair.</li>
          <li><strong>Click a well</strong> on the plate grid to select all of that well's dyes.</li>
          <li>The Wells-tab <strong>Select</strong> panel has a <strong>Fluor…</strong> dropdown to select every curve of one dye.</li>
          <li>Right-click any selection to colour, group, style, or hide those specific curves.</li>
        </ul>

        <h4 className="font-semibold text-xs">Results per dye</h4>
        <p>
          In multichannel view the results table shows one row per <strong>(well, dye)</strong> pair,
          with a <strong>Fluorophore</strong> column and per-dye <strong>Tt</strong>, <strong>Tm</strong>,
          call, and end-RFU. Rows are grouped under a collapsible parent row per sample — click a
          parent to select all of that well's dyes, or a child to select just one.
        </p>

        <p className="text-muted-foreground">
          Multichannel data is saved inside <strong>.sharp</strong> / <strong>.sharpx</strong> files
          (format 1.2). Older single-channel files open unchanged.
        </p>
      </div>
    ),
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    content: (
      <table className="w-full text-xs border border-border rounded">
        <thead><tr><TH>Shortcut</TH><TH>Action</TH></tr></thead>
        <tbody>
          <tr><TD><Kbd>{mod}+O</Kbd></TD><TD>Open experiment file</TD></tr>
          <tr><TD><Kbd>{mod}+S</Kbd></TD><TD>Save (re-saves in opened format — .sharp or .sharpx)</TD></tr>
          <tr><TD><Kbd>{mod}+Z</Kbd></TD><TD>Undo</TD></tr>
          <tr><TD><Kbd>{mod}+Shift+Z</Kbd></TD><TD>Redo</TD></tr>
          <tr><TD><Kbd>{mod}+A</Kbd></TD><TD>Select all wells</TD></tr>
          <tr><TD><Kbd>{mod}+H</Kbd></TD><TD>Toggle visibility of selected wells</TD></tr>
          <tr><TD><Kbd>{mod}+G</Kbd></TD><TD>Group selected curves</TD></tr>
          <tr><TD><Kbd>{mod}+Shift+G</Kbd></TD><TD>Ungroup selected</TD></tr>
          <tr><TD><Kbd>{mod}+Shift+E</Kbd> / <Kbd>{mod}+Shift+S</Kbd></TD><TD>Export the current plot as PNG (Export As Seen)</TD></tr>
        </tbody>
      </table>
    ),
  },
  {
    id: 'exporting',
    title: 'Exporting',
    content: (
      <div className="space-y-3">
        <div>
          <h4 className="font-semibold text-xs mb-1">Plot Export — Two Paths</h4>
          <p className="mb-2">The Export menu has two ways to produce plot images:</p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Export Wizard…</strong> — Floating dialog for publication-ready figures. Pick a plot type (Amplification, Melt with both RFU and −dF/dT, Melt Derivative only, or Doubling Time), choose a size preset or enter custom width/height in inches, set DPI (starts from the Style tab's Figure DPI, default 100), and pick a format (PNG, SVG, or JPEG). A live preview renders the figure at its true target pixel dimensions and scales it visually to fit the preview pane — so fonts, line widths, and margins all appear at their real absolute size. Colors, fonts, legend, and grid come from the Style tab, so tweaks there update the preview live. Click <em>Export…</em> to save.
            </li>
            <li>
              <strong>Export As Seen ▸</strong> — Submenu with PNG/SVG/JPEG options. Captures the currently-displayed plot(s) at the on-screen container size and upscales by the Style tab's Figure DPI setting. On the amplification tab, both the main amp plot and the melt-derivative mini-plot below it are stitched into a single image for PNG/JPEG (SVG exports only the main amp plot). Shortcut: <Kbd>{'Ctrl'}+Shift+E</Kbd> for PNG.
            </li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Data Export (CSV)</h4>
          <table className="w-full text-xs border border-border rounded">
            <thead><tr><TH>Menu Item</TH><TH>Contents</TH></tr></thead>
            <tbody>
              <tr><TD>Amplification Data</TD><TD>Cycle/time columns + per-well RFU</TD></tr>
              <tr><TD>Melt Data</TD><TD>Temperature + per-well RFU and −dF/dT</TD></tr>
              <tr><TD>Results Table</TD><TD>Well, Sample, Content, Tt (Ct in cycle mode), Tm, Doubling Time, Call, End RFU</TD></tr>
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Save as .sharp</h4>
          <p>Saves the experiment as a <code>.sharp</code> archive, preserving any edits to sample names, well types, groups, and notes. Clean, data-only — intended for sharing with collaborators. See the next section for what's inside.</p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Save Session (.sharpx)</h4>
          <p className="mb-1">Writes a <code>.sharpx</code> file — the same archive as <code>.sharp</code> plus your current workspace: selections, hidden / deactivated wells, baseline / normalization / drift settings, threshold, style, x-axis, active plot tab, groups, per-well overrides, and dilution wizard config. Re-open the <code>.sharpx</code> later to pick up exactly where you left off.</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><strong>File &gt; Save Session</strong> — saves straight back to the source <code>.sharpx</code> with no dialog; falls through to Save As for a first-time session.</li>
            <li><strong>File &gt; Save Session As…</strong> — always prompts, then adopts the chosen path as the active source.</li>
            <li><Kbd>{mod}+S</Kbd> re-saves in whichever format the file was opened as (<code>.sharp</code> → data only, <code>.sharpx</code> → with refreshed session).</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    id: 'sharp-format',
    title: '.sharp / .sharpx Format',
    content: (
      <div className="space-y-3">
        <p>
          <code>.sharp</code> is SHARP Processor's native file format — a plain ZIP archive bundling one experiment in open, text-based formats. Every instrument file you open (<code>.pcrd</code>, <code>.tlpd</code>, <code>.eds</code>, <code>.amxd</code>, or a BioRad CSV folder) gets converted to <code>.sharp</code> when you save. It's the recommended format for sharing or archiving runs.
        </p>
        <p>
          <code>.sharpx</code> is the same ZIP layout plus one extra entry, <code>session.json</code>, carrying your working view-state. Use <code>.sharp</code> when sharing data with collaborators; use <code>.sharpx</code> when saving your own work in progress.
        </p>

        <div>
          <h4 className="font-semibold text-xs mb-1">What's inside</h4>
          <p className="mb-2">Rename a <code>.sharp</code> file to <code>.zip</code> to open it with any ZIP tool. The archive contains:</p>
          <table className="w-full text-xs border border-border rounded">
            <thead><tr><TH>File</TH><TH>What it is</TH></tr></thead>
            <tbody>
              <tr><TD><code>SUMMARY.txt</code></TD><TD><strong>Start here.</strong> Human overview — experiment ID, operator, instrument, protocol, plate size, and a description of every other file.</TD></tr>
              <tr><TD><code>wells.csv</code></TD><TD><strong>Well manifest.</strong> One row per populated well: <code>well, sample, content, cq, end_rfu, melt_temp_c, melt_peak_height</code>. Opens in Excel.</TD></tr>
              <tr><TD><code>amplification.csv</code></TD><TD>Per-cycle RFU per well (wide format).</TD></tr>
              <tr><TD><code>melt_rfu.csv</code></TD><TD>Per-temperature RFU per well, if the run had a melt step.</TD></tr>
              <tr><TD><code>melt_derivative.csv</code></TD><TD>Per-temperature −dF/dT per well. Pre-smoothed using the BioRad CFX Maestro algorithm.</TD></tr>
              <tr><TD><code>metadata.json</code></TD><TD><strong>Authoritative machine-readable</strong> — instrument, protocol, run info, per-well analysis outputs, time reconstruction.</TD></tr>
              <tr><TD><code>session.json</code></TD><TD><em>(<code>.sharpx</code> only)</em> Working-session state — selections, hidden wells, baseline / normalization / drift settings, threshold, style, plot tab, groups, per-well overrides, dilution config.</TD></tr>
            </tbody>
          </table>
          <p className="mt-1.5 text-muted-foreground italic">
            <code>wells.csv</code> and <code>SUMMARY.txt</code> were added in format v1.1. Older <code>.sharp</code> files still load — the app falls back to <code>metadata.json</code>.
          </p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">How to create one</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>Open any instrument file and choose <strong>Export → Save as .sharp…</strong></li>
            <li>If you already opened a <code>.sharp</code>, press <Kbd>{mod}+S</Kbd> to overwrite in place.</li>
            <li>Your edits to sample names, well types, groups, and notes are baked in.</li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">How to use one</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Re-open in SHARP Processor</strong> to resume exactly where you left off.</li>
            <li><strong>Plot in Excel / R / Python</strong> — <code>amplification.csv</code> and <code>melt_rfu.csv</code> are standard wide CSVs. Match rows to samples via <code>wells.csv</code>.</li>
            <li><strong>Share with a collaborator</strong> — the archive is self-contained. <code>SUMMARY.txt</code> tells them what's inside without needing the app.</li>
            <li><strong>Diff / version-control</strong> — every file is plain text, so diffs are meaningful.</li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Editing by hand</h4>
          <p>Rename samples or fix content types without opening the app: edit <code>wells.csv</code> in Excel and save it back into the ZIP. The app prefers <code>wells.csv</code> over <code>metadata.json</code> on reload, so your edits win. <code>SUMMARY.txt</code> is regenerated on every save — don't bother editing it.</p>
        </div>
      </div>
    ),
  },
  {
    id: 'well-types',
    title: 'Well Classification',
    content: (
      <div className="space-y-2">
        <p>Wells can be classified by type, affecting selection toolbar behaviour and plate grid appearance.</p>
        <table className="w-full text-xs border border-border rounded">
          <thead><tr><TH>Display</TH><TH>Category</TH></tr></thead>
          <tbody>
            <tr><TD>Samp</TD><TD>Sample / Unknown</TD></tr>
            <tr><TD>NTC</TD><TD>Negative control (no template)</TD></tr>
            <tr><TD>+ Ctrl</TD><TD>Positive control</TD></tr>
            <tr><TD>- Ctrl</TD><TD>Negative control</TD></tr>
            <tr><TD>NPC</TD><TD>No-primer control</TD></tr>
            <tr><TD>Std</TD><TD>Standard</TD></tr>
          </tbody>
        </table>
        <p>Change via the well list dropdown or right-click &gt; <strong>Sample Type</strong> on any plot.</p>
      </div>
    ),
  },
  {
    id: 'wizard',
    title: 'Standard Curve Wizard',
    content: (
      <div className="space-y-2">
        <p>Access via <strong>Tools &gt; Standard Curve Wizard</strong>.</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Define the series — unit, highest concentration, dilution factor, number of steps</li>
          <li>Assign wells to each dilution level using the plate grid</li>
          <li>The wizard fits Tt vs log₂(concentration) and reports doubling time and R²</li>
        </ol>
        <p>Results appear in the <strong>Standard Curve</strong> plot tab, which prompts you to open this wizard when no dilution series is configured.</p>
      </div>
    ),
  },
  {
    id: 'kinetics-report',
    title: 'Kinetics Report',
    content: (
      <div className="space-y-2">
        <p>Access via <strong>Tools &gt; Kinetics Report</strong> — a full-screen readout that turns every curve into quantifiable kinetics. It computes once when opened and reuses the analysis fit (no re-fitting), so it stays out of the live analysis path.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Amplification panel</strong> — each curve (baseline-corrected by default, or raw) with its fitted model overlaid. The raw <strong>data is drawn bold</strong> (it's the ground truth); the <strong>fit is a fainter, thinner overlay</strong>. Checkboxes under the plot toggle the <strong>Data</strong> lines, the <strong>Fit</strong> lines, and each landmark (<strong>t_lod</strong> / <strong>t_onset10</strong> / <strong>inflection</strong>).</li>
          <li><strong>Melt panel</strong> — −dF/dT curves; hover a curve (or click its row in the table) to highlight it (the others dim) and show its melt temperature (Tm) at the peak.</li>
          <li><strong>Kinetics table</strong> — t_lod, t_onset10, the local doubling-time profile (Td₅/₂₀/₅₀), yield, and melt Tm, each with a shaded ± standard-error column plus baseline-observed / plateau-observed flags. Sortable; click a row to isolate that curve.</li>
          <li><strong>Curve reconstruction</strong> (collapsed) — the six FreeShoulder fit parameters, kept so a curve can be reconstructed if the raw data is lost.</li>
          <li><strong>Sample tiles</strong> — one per group; a master checkbox toggles all replicates and tints the tile, and a time-unit selector switches the table between seconds and minutes.</li>
          <li><strong>Show hidden</strong> — the report covers exactly the curves shown in the main window. If you have wells hidden there, a <strong>Show hidden (n)</strong> checkbox appears; tick it to include them. They are appended after your sample tiles (with a dashed border) so nothing you were reading moves, and they are deliberately <strong>kept out of the run-σ pool</strong> — displaying an excluded well can never change another well's noise floor or limit of detection.</li>
          <li><strong>Export HTML + CSV</strong> — one click writes two files: a self-contained, shareable <strong>HTML report</strong> (interactive — sortable columns, a show/hide toggle for the ± uncertainties, checkboxes to toggle the raw data / fit / landmark markers, and click-a-row to highlight its curve on the plots) for people, plus a machine-readable <strong>CSV</strong> of every parameter and its standard error for downstream analysis (Excel, R, Python).</li>
        </ul>
        <p className="text-xs text-muted-foreground">The landmarks and readouts are fit-derived and independent of the manual baseline / threshold settings.</p>
      </div>
    ),
  },
  {
    id: 'methods',
    title: 'Methods: Fitting & Statistics',
    content: (
      <div className="space-y-4">
        <p>
          This section documents how the automatic baseline, the kinetic readouts, and the
          limit of detection are computed — the mathematics behind the <strong>Kinetics</strong> landmarks
          and the <strong>Kinetics Report</strong>. All of it runs on the <strong>raw</strong> fluorescence in
          seconds, so results are comparable across runs and independent of the x-axis unit you view.
        </p>

        <div>
          <h4 className="font-semibold text-xs mb-1">1 · The amplification model (FreeShoulder)</h4>
          <p className="mb-1.5">
            Each amplification curve is fit to a six-parameter sigmoid — a logistic whose upper and lower
            knees are independently rounded by a Kumaraswamy <em>warp</em>:
          </p>
          <div className="font-mono text-[11px] bg-muted/60 rounded px-3 py-2 my-1.5 leading-relaxed whitespace-pre overflow-x-auto">{`S(t) = 1 / (1 + e^(−B·(t − C)))          logistic
w(t) = 1 − (1 − S(t)^foot)^shoulder       warp  (0 → 1)
f(t) = A + (D − A) · w(t)                 fitted RFU`}</div>
          <table className="w-full text-xs border border-border rounded mt-1.5">
            <thead><tr><TH>Parameter</TH><TH>Meaning</TH></tr></thead>
            <tbody>
              <tr><TD><code>A</code></TD><TD>Baseline — the lower asymptote. This is the fitted baseline level.</TD></tr>
              <tr><TD><code>D</code></TD><TD>Ceiling — the upper asymptote (fitted plateau / &ldquo;max&rdquo;).</TD></tr>
              <tr><TD><code>B</code></TD><TD>Logistic rate (steepness of the rise).</TD></tr>
              <tr><TD><code>C</code></TD><TD>Logistic centre (s).</TD></tr>
              <tr><TD><code>foot</code></TD><TD>Lower-knee bend.</TD></tr>
              <tr><TD><code>shoulder</code></TD><TD>Upper-knee bend.</TD></tr>
            </tbody>
          </table>
          <p className="mt-1.5 text-muted-foreground">
            With <code>foot = shoulder = 1</code> the warp vanishes and the model reduces to an ordinary
            four-parameter logistic; the free shoulder lets it round the sharp upper corner that a plain
            logistic cannot.
          </p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">2 · Fitting &amp; the automatic baseline</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>The fit uses <strong>multi-start Levenberg–Marquardt</strong> in normalised coordinates: eight starting points span the rate and the two bend parameters, and the fit with the lowest sum-of-squared residuals wins.</li>
            <li><strong>Auto baseline = the fitted <code>A</code>.</strong> The curve is corrected by subtracting <code>A</code>. This follows the true pre-amplification level even through early dips or across wells that amplify at different times.</li>
            <li><strong>Poor-fit fallback.</strong> The fitted <code>A</code> is trusted only when a real flat pre-rise stretch anchors it — <code>r² ≥ 0.9</code> <em>and</em> at least 8 reads below 5% of the fitted height. Otherwise (a junk or non-amplifying control) the app falls back to a robust low-level estimate (the trough) instead of trusting a bad fit.</li>
            <li>Fit quality is reported as <strong>r²</strong> and <strong>RMSE</strong> in the report&rsquo;s curve-reconstruction table.</li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">3 · Noise floor (per-well σ and run σ)</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Per-well σ</strong> = <code>1.4826 × MAD</code> of the <em>consecutive differences</em> of the raw
              curve over the pre-amplification region (the reads before the fit reaches 5% of its height).
              Differencing removes slow drift and any constant offset; the median-absolute-deviation (MAD)
              resists the odd spike.
            </li>
            <li>
              <strong>Run σ</strong> = the <em>median</em> of the per-well σ across the amplifying wells (a well whose σ
              exceeds 3× the provisional median is dropped as an outlier). Noise is a property of the run,
              so a single pooled σ drives every well&rsquo;s detection call.
            </li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">4 · Limit of detection (t_lod)</h4>
          <p className="mb-1.5">
            The LoD is the first baseline-corrected reading that rises above <code>8 × run σ</code> whose
            <em> next</em> reading is at least as high (the two-point confirmation rejects single-point spikes);
            the crossing time is linearly interpolated:
          </p>
          <div className="font-mono text-[11px] bg-muted/60 rounded px-3 py-2 my-1.5 leading-relaxed whitespace-pre overflow-x-auto">{`threshold = 8 · runσ
t_lod     = first confirmed upward crossing of the threshold
SE(t_lod) = runσ / |local slope|   (≥ one read interval)`}</div>
          <p className="text-muted-foreground">
            This is a <strong>detection</strong> landmark only — it needs no fit. Speed and shape come from the
            fit-derived readouts below.
          </p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">5 · Time-to-onset &amp; doubling time (fit-derived)</h4>
          <p className="mb-1.5">Read off the fitted curve by inverting the warp. With <code>S<sub>f</sub></code> the logistic value at fraction <code>f</code> of height:</p>
          <div className="font-mono text-[11px] bg-muted/60 rounded px-3 py-2 my-1.5 leading-relaxed whitespace-pre overflow-x-auto">{`S_f       = [1 − (1 − f)^(1/shoulder)]^(1/foot)
t(f)      = C + ln(S_f / (1 − S_f)) / B        time to fraction f
Td(f)     = ln2 · f / w′(t_f)                  local doubling time`}</div>
          <ul className="list-disc pl-5 space-y-1 mt-1.5">
            <li><strong>t_onset10</strong> is <code>t(f)</code> at <code>f = 0.10</code> (time to 10% of height).</li>
            <li>The <strong>doubling-time profile</strong> <code>Td</code> is reported at 5 / 20 / 50% of height. Height cancels, so <code>Td</code> depends only on the shape (<code>B, C, foot, shoulder</code>) — not on <code>A</code> or <code>D</code>.</li>
            <li>The <strong>inflection</strong> (steepest-rise) point is located numerically — the warped curve has no closed-form inflection.</li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">6 · Uncertainties (± standard errors)</h4>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Parameter SEs come from the fit covariance
              <code> cov = σ̂² · (JᵀJ)⁻¹</code>, with <code>σ̂² = RSS / (n − 6)</code> (RSS = residual sum of squares,
              <code> n</code> = reads, 6 = parameters, <code>J</code> = Jacobian of the fitted curve).
            </li>
            <li>
              SEs for the <em>derived</em> landmarks (t_onset10, Td, …) are propagated by <strong>Monte-Carlo</strong>:
              500 parameter sets are drawn from the fit covariance and each landmark&rsquo;s spread is its reported ±.
            </li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">7 · Residuals</h4>
          <p>
            In the <strong>Kinetics Report</strong>, clicking a table row opens a <strong>residual strip</strong> beneath the
            amplification plot: the vertical distance from each measured point to the fitted curve
            (<code>observed − fit</code>). The shaded band is <strong>±1 run σ</strong> — the measurement-noise floor.
            Residuals that stay inside the band mean the fit is within noise; systematic curvature poking
            outside it signals lack of fit. Only curves with a usable fit have residuals — for a curve whose
            fit was censored (most often because <strong>no plateau was reached</strong> by the end of the run), the
            strip instead states why no fit is reported.
          </p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">8 · When readouts are blank</h4>
          <p>
            The %-of-height readouts (<code>t_onset10</code>, <code>Td</code>, yield, and <code>D / foot / shoulder</code>)
            are shown only when the plateau is actually observed (the curve reaches ~90% of its ceiling and
            <code> D</code> is tightly determined) <em>and</em> the fitted transition falls inside the measured time
            window. This suppresses nonsense values from a flat control that the flexible model bends into
            the tail of a warped curve. <code>t_lod</code> — a data threshold crossing, not a fitted quantity — is
            still reported for such curves.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 'tips',
    title: 'Tips',
    content: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li><strong>Palette ordering</strong> — <strong>Apply</strong> assigns colours by ascending detection time (Tt), so the fastest-amplifying wells get the first palette colour. Grouped wells count as one unit and share a colour. The assignment sticks until you press Apply again.</li>
        <li><strong>Box select</strong> — draw a rectangle on the amplification plot to quickly select wells whose curves pass through that region.</li>
        <li><strong>Auto-Group</strong> — right-click &gt; Auto-Group by Sample to create groups from matching sample names.</li>
        <li><strong>Multiple experiments</strong> — load several at once and switch via the tab bar. Each maintains its own analysis state.</li>
        <li><strong>Sidebar &amp; table resize</strong> — drag the borders between the sidebar/plot and plot/results table to adjust sizes.</li>
        <li><strong>Theme</strong> — switch between Classic, SHARP, and SHARP Dark directly under the View menu.</li>
      </ul>
    ),
  },
];

// ── Component ────────────────────────────────────────────────────────

interface UserManualProps {
  onClose: () => void;
}

export function UserManual({ onClose }: UserManualProps) {
  const [activeSection, setActiveSection] = useState('overview');
  const contentRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Draggable panel
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  const onTitleMouseDown = (e: React.MouseEvent) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragOffset.current) return;
      setPanelPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
    };
    const handleUp = () => { dragOffset.current = null; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Scroll to section
  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const el = document.getElementById(`manual-section-${id}`);
    if (el && contentRef.current) {
      contentRef.current.scrollTo({ top: el.offsetTop - contentRef.current.offsetTop - 8, behavior: 'smooth' });
    }
  };

  // Track scroll position to highlight active nav item
  const handleScroll = () => {
    if (!contentRef.current) return;
    const container = contentRef.current;
    const scrollTop = container.scrollTop + container.offsetTop + 20;
    for (let i = sections.length - 1; i >= 0; i--) {
      const el = document.getElementById(`manual-section-${sections[i].id}`);
      if (el && el.offsetTop <= scrollTop) {
        setActiveSection(sections[i].id);
        break;
      }
    }
  };

  const panelStyle: React.CSSProperties = panelPos
    ? { position: 'fixed', left: panelPos.x, top: panelPos.y, zIndex: 50 }
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 50 };

  return (
    <div
      ref={panelRef}
      className="bg-background border rounded-lg shadow-xl flex flex-col"
      style={{ ...panelStyle, width: 720, height: '80vh', maxHeight: 700 }}
    >
      {/* Draggable title bar */}
      <div
        className="flex items-center justify-between px-5 pt-4 pb-3 cursor-move select-none border-b border-border shrink-0"
        onMouseDown={onTitleMouseDown}
      >
        <h2 className="text-base font-bold">User Manual</h2>
        <DialogCloseButton onClick={onClose} title="Close (Esc)" />
      </div>

      {/* Body: nav sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Nav sidebar */}
        <nav className="w-[170px] shrink-0 border-r border-border overflow-y-auto py-2 px-2">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className={`block w-full text-left text-xs px-2 py-1.5 rounded transition-colors ${FOCUS_RING} ${
                activeSection === s.id
                  ? 'bg-primary/10 text-[var(--brand-red-dark)] font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              {s.title}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto px-5 py-4 text-xs leading-relaxed text-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.92em]"
          onScroll={handleScroll}
        >
          {sections.map((s) => (
            <div key={s.id} id={`manual-section-${s.id}`} className="mb-6">
              <h3 className="text-sm font-bold mb-2 text-foreground">{s.title}</h3>
              {s.content}
            </div>
          ))}
          <div className="text-center text-muted-foreground text-[10px] py-4 border-t border-border mt-4">
            SHARP Processor 2 · © 2026 SHARP Diagnostics, Inc. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
