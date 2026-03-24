import { useState, useRef, useEffect } from 'react';

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
        baseline correction, threshold detection, doubling-time analysis, and flexible export options.
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
            <tr><TD>SHARP archive</TD><TD>Native format</TD><TD>.sharp</TD></tr>
            <tr><TD>BioRad CFX96</TD><TD>Instrument file</TD><TD>.pcrd</TD></tr>
            <tr><TD>TianLong Gentier</TD><TD>Instrument file</TD><TD>.tlpd</TD></tr>
            <tr><TD>ThermoFisher QuantStudio</TD><TD>Instrument file</TD><TD>.eds</TD></tr>
            <tr><TD>Agilent AriaMx</TD><TD>Instrument file</TD><TD>.amxd</TD></tr>
          </tbody>
        </table>

        <h4 className="font-semibold text-xs">Loading Data</h4>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>File &gt; Open</strong> (<Kbd>{mod}+O</Kbd>) — file dialog</li>
          <li><strong>Drag and drop</strong> — drag any supported file onto the window</li>
        </ul>
        <p>
          Multiple experiments can be loaded simultaneously. When more than one is open, an experiment
          tab bar appears above the plot area. Click a tab to switch; click its × button to close.
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
        <div className="border border-border rounded-md overflow-hidden text-[9px] leading-none" style={{ background: '#f3f2f0', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          {/* Menu bar */}
          <div className="flex items-center gap-3 px-2.5 py-1" style={{ borderBottom: '1px solid #ddd8d3', background: '#f3f2f0' }}>
            {['File', 'Edit', 'View', 'Tools', 'Export', 'Help'].map(m => (
              <span key={m} style={{ color: '#212224', fontSize: 9 }}>{m}</span>
            ))}
          </div>
          <div className="flex" style={{ minHeight: 180 }}>
            {/* Sidebar */}
            <div className="shrink-0" style={{ width: 170, borderRight: '1px solid #ddd8d3' }}>
              {/* Sidebar tabs */}
              <div className="flex" style={{ borderBottom: '1px solid #ddd8d3' }}>
                {['DATA', 'WELLS', 'ANALYSIS', 'STYLE'].map((t, i) => (
                  <div key={t} className="flex-1 text-center py-1" style={{
                    fontSize: 8, fontWeight: i === 0 ? 700 : 400, letterSpacing: '0.03em',
                    color: i === 0 ? '#aa2026' : '#888',
                    borderBottom: i === 0 ? '2px solid #aa2026' : 'none',
                  }}>{t}</div>
                ))}
              </div>
              {/* Sidebar content */}
              <div className="p-2 space-y-1.5" style={{ fontSize: 8, color: '#666' }}>
                <div style={{ fontSize: 8, color: '#999' }}>No experiment loaded.</div>
                <div className="text-center py-1.5 rounded" style={{ border: '1px solid #ddd8d3', fontSize: 9, color: '#212224', fontWeight: 500, background: '#faf9f8' }}>Load file...</div>
                <div className="text-center" style={{ fontSize: 7, color: '#aaa' }}>or drag &amp; drop a file</div>
                <div className="text-center" style={{ fontSize: 7, color: '#bbb' }}>.sharp · .pcrd · .tlpd · .eds · .amxd</div>
              </div>
            </div>
            {/* Main area */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* X-axis bar */}
              <div className="flex items-center gap-2 px-2" style={{ borderBottom: '1px solid #ddd8d3', padding: '2px 8px', color: '#666' }}>
                <span style={{ fontSize: 8 }}>X-axis:</span>
                <span style={{ fontSize: 8 }}>○ Cycle</span>
                <span style={{ fontSize: 8 }}>○ Sec</span>
                <span style={{ fontSize: 8, color: '#aa2026' }}>● Min</span>
                <span className="flex-1" />
                <span style={{ fontSize: 8 }}>☐ Log Scale</span>
              </div>
              {/* Plot tabs */}
              <div className="flex" style={{ borderBottom: '1px solid #ddd8d3' }}>
                {['Amplification', 'Melt', 'Doubling Time'].map((t, i) => (
                  <div key={t} className="px-2 py-1" style={{
                    fontSize: 8, color: i === 0 ? '#aa2026' : '#999',
                    fontWeight: i === 0 ? 600 : 400,
                    borderBottom: i === 0 ? '2px solid #aa2026' : 'none',
                  }}>{t}</div>
                ))}
              </div>
              {/* Plot area + MENU */}
              <div className="flex flex-1">
                <div className="flex-1 flex items-center justify-center m-1 rounded" style={{ background: '#faf9f8', border: '1px solid #e8e5e2', color: '#bbb', fontSize: 10, minHeight: 70 }}>
                  Plot Area
                </div>
                <div className="flex items-center justify-center" style={{ width: 16, borderLeft: '1px solid #ddd8d3', background: '#f3f2f0', color: '#7d2126', writingMode: 'vertical-rl', fontSize: 7, fontWeight: 700, letterSpacing: '0.08em' }}>
                  MENU
                </div>
              </div>
              {/* Melt deriv mini-plot */}
              <div className="flex items-center justify-center mx-1 mb-0.5 rounded" style={{ height: 28, background: '#faf9f8', borderTop: '1px solid #e8e5e2', border: '1px solid #e8e5e2', color: '#bbb', fontSize: 8 }}>
                Melt derivative mini-plot
              </div>
              {/* Resize handle */}
              <div className="flex items-center justify-center" style={{ height: 5, borderTop: '1px solid #ddd8d3', borderBottom: '1px solid #ddd8d3' }}>
                <span style={{ fontSize: 6, color: '#bbb' }}>• • •</span>
              </div>
              {/* Results table */}
              <div style={{ fontSize: 7, padding: '3px 6px', color: '#888' }}>
                <div className="flex" style={{ borderBottom: '1px solid #e8e5e2', paddingBottom: 2, marginBottom: 2, fontWeight: 600, color: '#555' }}>
                  <span style={{ width: '14%' }}>Well</span>
                  <span className="flex-1">Sample</span>
                  <span style={{ width: '12%', textAlign: 'right' }}>Tt</span>
                  <span style={{ width: '12%', textAlign: 'right' }}>Tm</span>
                  <span style={{ width: '10%', textAlign: 'center' }}>Call</span>
                  <span style={{ width: '16%', textAlign: 'right' }}>End RFU</span>
                </div>
                <div className="flex" style={{ color: '#999' }}>
                  <span style={{ width: '14%', color: '#d81f27' }}>A1</span>
                  <span className="flex-1">Sample 1</span>
                  <span style={{ width: '12%', textAlign: 'right' }}>12.4</span>
                  <span style={{ width: '12%', textAlign: 'right' }}>85.3°</span>
                  <span style={{ width: '10%', textAlign: 'center', color: '#22c55e', fontWeight: 700 }}>+</span>
                  <span style={{ width: '16%', textAlign: 'right' }}>4,521</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Left sidebar</strong> — four tabs: Data, Wells, Analysis, Style (resizable drag-border)</li>
          <li><strong>Centre</strong> — plot tabs with optional melt derivative mini-plot below</li>
          <li><strong>Right edge</strong> — collapsible MENU panel (quick actions)</li>
          <li><strong>Bottom</strong> — results table with sortable columns (resizable drag-border)</li>
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
          <p>Read-only summary of the loaded experiment: ID, protocol, operator, well count, cycle count, melt availability, run notes, and timestamp.</p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Wells Tab</h4>
          <p className="mb-2">Contains the plate grid, selection toolbar, and well list.</p>

          <p className="text-xs font-medium mb-1">Plate Grid</p>
          <p className="mb-1">Wells are colour-coded by state:</p>
          <table className="w-full text-xs border border-border rounded mb-2">
            <thead><tr><TH>State</TH><TH>Appearance</TH></tr></thead>
            <tbody>
              <tr><TD>No data</TD><TD>Light grey</TD></tr>
              <tr><TD>Hidden</TD><TD>Blue-grey</TD></tr>
              <tr><TD>Active</TD><TD>Light blue</TD></tr>
              <tr><TD>Selected</TD><TD>Blue border</TD></tr>
              <tr><TD>NTC</TD><TD>Red tint</TD></tr>
              <tr><TD>NPC</TD><TD>Orange tint</TD></tr>
            </tbody>
          </table>

          <p className="text-xs font-medium mb-1">Selecting wells:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><strong>Click</strong> a well to select it alone</li>
            <li><strong>{isMac ? '⌘' : 'Ctrl'}+Click</strong> to add/remove from selection</li>
            <li><strong>Click+Drag</strong> to rubber-band select a rectangular region</li>
          </ul>

          <p className="text-xs font-medium mt-2 mb-1">Selection Toolbar</p>
          <p>Quick-select buttons: All, Samp, NTC, Std, Shown, Hidden, and a Group dropdown.</p>

          <p className="text-xs font-medium mt-2 mb-1">Well List</p>
          <p>Scrollable table showing visibility checkbox, colour swatch, well position, sample name, group, and type dropdown.</p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Analysis Tab</h4>
          <p className="text-xs font-medium mb-1">Baseline Correction</p>
          <ul className="list-disc pl-5 space-y-0.5 mb-2">
            <li>Enable/disable globally with the checkbox</li>
            <li>Method: Horizontal (constant) or Linear (slope-based)</li>
            <li>Start and End cycle spinboxes define the fitting zone</li>
            <li>Show raw overlay: draws faint dotted raw curves behind corrected curves</li>
          </ul>

          <p className="text-xs font-medium mb-1">Threshold &amp; Detection</p>
          <ul className="list-disc pl-5 space-y-0.5 mb-2">
            <li>Enable to show a red dashed horizontal line on the amplification plot</li>
            <li>Set the RFU threshold via spinbox or drag the line directly on the plot</li>
            <li>Results table appears below the plot with Tt, Dt, Tm, Call, and End RFU</li>
          </ul>

          <p className="text-xs font-medium mb-1">Doubling Time</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>Enable exponential fitting: RFU(t) = A·exp(kt) + C</li>
            <li>Start/End fraction spinboxes define the growth region</li>
            <li>Results appear in the Doubling Time plot tab</li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Style Tab</h4>
          <table className="w-full text-xs border border-border rounded">
            <thead><tr><TH>Section</TH><TH>Controls</TH></tr></thead>
            <tbody>
              <tr><TD>Colours</TD><TD>Global palette selector</TD></tr>
              <tr><TD>Lines</TD><TD>Line width (0.3–5.0 pt)</TD></tr>
              <tr><TD>Typography</TD><TD>Font family, title/label/tick/legend sizes</TD></tr>
              <tr><TD>Legend</TD><TD>Show/hide, position, visible-only filter</TD></tr>
              <tr><TD>Grid</TD><TD>Show/hide, opacity slider</TD></tr>
              <tr><TD>Figure</TD><TD>Export DPI (72–600)</TD></tr>
              <tr><TD>Presets</TD><TD>Save / Load / Reset style presets</TD></tr>
            </tbody>
          </table>
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
            <li><strong>Box select</strong> — click and drag to select wells whose curves pass through the box</li>
            <li><strong>Threshold drag</strong> — grab the red dashed line and drag up/down</li>
            <li><strong>Log Scale</strong> — checkbox at bottom-right for logarithmic Y-axis</li>
            <li><strong>Click a trace</strong> — selects that well across grid, list, and table</li>
            <li><strong>Right-click</strong> — context menu (see below)</li>
          </ul>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Melt Plot</h4>
          <p>Two subplots: raw RFU (top) and −dF/dT derivative (bottom). Click-to-select and right-click context menu available. A melt derivative mini-plot also appears below the amplification plot when melt data is available.</p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Context Menu (Right-Click)</h4>
          <table className="w-full text-xs border border-border rounded">
            <thead><tr><TH>Item</TH><TH>Action</TH></tr></thead>
            <tbody>
              <tr><TD>Show / Hide</TD><TD>Toggle plot visibility</TD></tr>
              <tr><TD>Deselect All</TD><TD>Clear the selection</TD></tr>
              <tr><TD>Sample Type ›</TD><TD>Classify selected wells</TD></tr>
              <tr><TD>Group… ({mod}+G)</TD><TD>Assign to a named group</TD></tr>
              <tr><TD>Remove from Group</TD><TD>Ungroup selected wells</TD></tr>
              <tr><TD>Auto-Group by Sample</TD><TD>Create groups from sample names</TD></tr>
              <tr><TD>Color…</TD><TD>Pick a colour for selected wells</TD></tr>
              <tr><TD>Line Style…</TD><TD>Solid, dashed, dash-dot, dotted</TD></tr>
              <tr><TD>Line Width…</TD><TD>Set thickness for selected wells</TD></tr>
              <tr><TD>Apply Palette ›</TD><TD>Assign a palette across the selection</TD></tr>
              <tr><TD>Reverse Palette</TD><TD>Flip the colour order</TD></tr>
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Quick-Action Panel</h4>
          <p>Click the <strong>MENU</strong> tab on the right edge to expand a panel that mirrors every context menu action as clickable buttons.</p>
        </div>
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
          <tr><TD><Kbd>{mod}+S</Kbd></TD><TD>Save as .sharp</TD></tr>
          <tr><TD><Kbd>{mod}+Z</Kbd></TD><TD>Undo</TD></tr>
          <tr><TD><Kbd>{mod}+Shift+Z</Kbd></TD><TD>Redo</TD></tr>
          <tr><TD><Kbd>{mod}+A</Kbd></TD><TD>Select all wells</TD></tr>
          <tr><TD><Kbd>{mod}+H</Kbd></TD><TD>Toggle visibility of selected wells</TD></tr>
          <tr><TD><Kbd>{mod}+G</Kbd></TD><TD>Group selected wells</TD></tr>
          <tr><TD><Kbd>{mod}+Shift+G</Kbd></TD><TD>Remove from group</TD></tr>
          <tr><TD><Kbd>{mod}+Shift+S</Kbd></TD><TD>Quick-export plot (PNG)</TD></tr>
          <tr><TD><Kbd>{mod}+Shift+E</Kbd></TD><TD>Export plot</TD></tr>
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
          <h4 className="font-semibold text-xs mb-1">Plot Export</h4>
          <p>Export menu offers PNG, SVG, and JPEG formats. DPI is configurable in the Style tab.</p>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Data Export (CSV)</h4>
          <table className="w-full text-xs border border-border rounded">
            <thead><tr><TH>Menu Item</TH><TH>Contents</TH></tr></thead>
            <tbody>
              <tr><TD>Amplification Data</TD><TD>Cycle/time columns + per-well RFU</TD></tr>
              <tr><TD>Melt Data</TD><TD>Temperature + per-well RFU and −dF/dT</TD></tr>
              <tr><TD>Results Table</TD><TD>Well, Tt, Dt, Tm, Call, End RFU</TD></tr>
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="font-semibold text-xs mb-1">Save as .sharp</h4>
          <p>Saves the experiment data as a .sharp archive, preserving any edits to sample names and metadata.</p>
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
            <tr><TD>+Ctrl</TD><TD>Positive control</TD></tr>
            <tr><TD>−Ctrl</TD><TD>Negative control</TD></tr>
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
    title: 'Doubling Time Wizard',
    content: (
      <div className="space-y-2">
        <p>Access via <strong>Tools &gt; Doubling Time Wizard</strong>.</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Define the series — unit, highest concentration, dilution factor, number of steps</li>
          <li>Assign wells to each dilution level using the plate grid</li>
          <li>The wizard calculates doubling time, amplification efficiency, and R²</li>
        </ol>
        <p>Results appear in the <strong>Doubling Time</strong> plot tab.</p>
      </div>
    ),
  },
  {
    id: 'tips',
    title: 'Tips',
    content: (
      <ul className="list-disc pl-5 space-y-1.5">
        <li><strong>Palette ordering</strong> — colours are assigned by ascending detection time (Tt), so the fastest-amplifying wells get the first palette colour.</li>
        <li><strong>Box select</strong> — draw a rectangle on the amplification plot to quickly select wells whose curves pass through that region.</li>
        <li><strong>Auto-Group</strong> — right-click &gt; Auto-Group by Sample Name to create groups from matching sample names.</li>
        <li><strong>Multiple experiments</strong> — load several at once and switch via the tab bar. Each maintains its own analysis state.</li>
        <li><strong>Sidebar &amp; table resize</strong> — drag the borders between the sidebar/plot and plot/results table to adjust sizes.</li>
        <li><strong>Theme</strong> — switch between Classic, SHARP, and SHARP Dark themes via View &gt; Theme.</li>
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
      className="bg-background border rounded-md shadow-xl flex flex-col"
      style={{ ...panelStyle, width: 720, height: '80vh', maxHeight: 700 }}
    >
      {/* Draggable title bar */}
      <div
        className="flex items-center justify-between px-5 pt-4 pb-3 cursor-move select-none border-b border-border shrink-0"
        onMouseDown={onTitleMouseDown}
      >
        <h2 className="text-base font-bold">User Manual</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-lg leading-none px-1"
          title="Close (Esc)"
        >
          ×
        </button>
      </div>

      {/* Body: nav sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Nav sidebar */}
        <nav className="w-[170px] shrink-0 border-r border-border overflow-y-auto py-2 px-2">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className={`block w-full text-left text-xs px-2 py-1.5 rounded transition-colors ${
                activeSection === s.id
                  ? 'bg-primary/10 text-primary font-medium'
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
          className="flex-1 overflow-y-auto px-5 py-4 text-xs leading-relaxed text-foreground"
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
