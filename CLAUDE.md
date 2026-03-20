# CLAUDE.md — SHARP Processor 2

**Last Updated:** 2026-03-21 PST

## Project Overview

SHARP Processor 2 — a modern desktop app for qPCR/isothermal amplification data analysis. This is a ground-up rewrite of the v1 PyQt6+matplotlib app using **Tauri 2 + React + TypeScript + Plotly.js**.

See `HANDOFF.md` for the full context, feature list, and architecture plan from v1.

## Tech Stack

- **Frontend:** React 18+, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui, Plotly.js (via react-plotly.js + plotly.js-dist-min)
- **State:** Zustand
- **Backend:** Tauri 2.x (Rust)
- **Python sidecar:** For instrument file parsing (.pcrd, .tlpd, .eds, .amxd) via scoped shell command
- **Build:** Tauri CLI → `.exe` (Windows), `.app` (macOS)

## Build & Run

```bash
# Double-click dev.bat, or:
set CARGO_TARGET_DIR=C:\tauri-build-cache
npx tauri dev
```

- **CARGO_TARGET_DIR** must be set to `C:\tauri-build-cache` to avoid OneDrive sync overhead on the Rust `target/` directory.
- Rust 1.94.0, VS 2022 Build Tools (C++ workload), Node 24.14.0

## Project Structure

```
src/
  App.tsx                    # Main layout: sidebar + x-axis bar + plot tabs + plot + results
  main.tsx                   # React entry point
  components/
    Sidebar.tsx              # 4-tab sidebar container (Data/Wells/Analysis/Style)
    sidebar/
      DataTab.tsx            # Experiment info + notes + file open button
      WellsTab.tsx           # Well grid + selection toolbar + well list
      AnalysisTab.tsx        # Baseline correction + threshold detection controls
      StyleTab.tsx           # Colors, lines, typography, legend, grid, DPI, presets
    WellGrid.tsx             # 96-well plate (19px cells, rubber-band drag-select, unpopulated wells disabled)
    WellList.tsx             # Well table (L/Well/Sample/Type columns)
    ContextMenu.tsx          # Right-click context menu (v1 parity: activate, hide, type, group, style, legend)
    MenuBar.tsx              # Custom HTML menu bar (File/Edit/View) with keyboard shortcuts
    PlotArea.tsx             # Plotly charts — amp (box-select, baseline zone, draggable threshold, resizable melt deriv below), melt, doubling time
    PlotTabs.tsx             # Amplification / Melt / Doubling Time tab bar
    QuickStylePanel.tsx      # Right-side expandable drawer mirroring context menu items
    XAxisBar.tsx             # X-axis radio (Cycle/Sec/Min) + Log Scale checkbox
    ResultsTable.tsx         # Detection results table (Well/Sample/Content/Tt/Dt/Call/End RFU)
    ui/                      # shadcn/ui components (button, tabs, card, table, checkbox)
  hooks/
    useAppState.ts           # Zustand store — all app state + actions
    useAnalysisResults.ts    # Reactive analysis results (memoized per-well)
  lib/
    analysis.ts              # Baseline correction, threshold detection, doubling time fit
    constants.ts             # Colors, palettes, defaults (matching v1 constants.py)
    export.ts                # Plot image export (PNG/SVG/JPEG) + CSV data/results export
    instrument-loader.ts     # Multi-format loader (.pcrd/.tlpd/.eds/.amxd) via Python sidecar
    sharp-loader.ts          # .sharp ZIP parser (JSZip → ExperimentData)
    utils.ts                 # shadcn utility (cn)
  types/
    experiment.ts            # TypeScript data model (ExperimentData, WellInfo, etc.)
    plotly.d.ts              # Type declaration for plotly.js-dist-min

src-tauri/
  src/lib.rs                 # Tauri app with greet IPC command
  src/main.rs                # Tauri entry point
  tauri.conf.json            # Window 1200×800, identifier com.sharp-diagnostics.processor
  Cargo.toml                 # Rust dependencies

scripts/
  parse_instrument.py        # Python sidecar: instrument file → .sharp conversion

dev.bat                      # Double-click launcher (sets CARGO_TARGET_DIR, runs npx tauri dev)
build.bat                    # Double-click build launcher
```

## Implementation Progress (10-step roadmap)

| # | Step | Status | Notes |
|---|------|--------|-------|
| 1 | Scaffold | **Done** | Tauri 2 + React + Vite + Tailwind v4 + shadcn + Plotly |
| 2 | Data loading | **Done** | .sharp parser, drag-drop (Tauri API), file picker, Plotly chart, log scale |
| 3 | Well grid + selection | **Done** | Palette colors, click/ctrl+click, visibility toggle (L checkbox), select-by-type toolbar |
| 4 | Cross-linked interaction | **Done** | Click-to-select on plot traces, selection sync across grid/list/table/plot, hidden wells filtered |
| 5 | Analysis | **Done** | Baseline (horizontal/linear), threshold detection (Tt/Ct), doubling time (log-linear fit), call determination. Threshold line on plot, raw overlay option |
| 6 | Melt plots | **Done** | Stacked subplots (RFU + -dF/dT), click-to-select, "No melt data" fallback |
| 7 | Style controls | **Done** | Palette, line width, fonts, legend (show/position/visible-only), grid (show/opacity) all wired to all plot types |
| 8 | Export | **Done** | PNG/SVG/JPEG plot export, data CSV, melt CSV, results CSV, save as .sharp — via sidebar buttons + File menu |
| 9 | Custom menu bar | **Done** | File/Edit/View menus with keyboard shortcuts (Ctrl+O, Ctrl+A), styled consistently |
| 10 | Build & release | **Done** | NSIS+MSI targets, .sharp file association, build.bat launcher |
| 11 | Instrument file loading | **Done** | Python sidecar via scoped shell command, multi-format dialog |
| 12 | Drag-select + context menu | **Done** | Box-select on plots, RMB context menu, QuickStylePanel drawer |
| 13 | Melt derivative mini-plot | **Done** | -dF/dT plot rendered below amplification chart |
| 14 | Baseline zone + threshold drag | **Done** | Shaded baseline zone on amp plot, draggable threshold line (vertical-only, custom mouse handler) |
| 15 | Drag-resize + grid drag-select | **Done** | Resizable plot boundary divider, rubber-band well grid selection, unpopulated wells disabled |
| 16 | UX polish | **Done** | Line width 1.2→1.8, multi-format Open dialog, drop overlay shows all formats |
| 17 | Grouping visual effects | **Done** | Grouped wells share palette color, 5 discrete + Viridis/Magma/Inferno/Plasma/Turbo + 7 single-hue gradients |
| 18 | UX fixes round 2 | **Done** | Box-select via Plotly event API, sidebar resize (200-450px), well list Group column, melt derivative computed on-the-fly, palette submenu hover fix |
| 19 | Welcome screen + .sharp export | **Done** | Informative welcome screen (format table, tips), melt CSV export, save as .sharp (preserves edited metadata/sample names) |
| 20 | Multi-experiment tabs + menu parity | **Done** | Experiment tab bar (closable, visible when >1), per-experiment isolated state (view, analysis, style settings). File/Edit/View/Tools/Export menu structure matching v1 |

## Known Issues / Workarounds

- **react-plotly.js CJS interop:** `react-plotly.js` and its factory are CJS. With Vite + `esModuleInterop`, we use `plotly.js-dist-min` + `createPlotlyComponent` factory with a runtime `.default` fallback to handle the namespace object. See `PlotArea.tsx`.
- **Plotly.js bundle size:** ~3.5 MB (using `plotly.js-dist-min`). Fine for dev, consider custom partial bundle later.
- **verbatimModuleSyntax:** Disabled in `tsconfig.app.json` because it breaks CJS default imports. Using `esModuleInterop` + `allowSyntheticDefaultImports` instead.
- **Shell scoping for Python sidecar:** `Command.create('python-parser', ...)` uses a scoped command defined in `src-tauri/capabilities/default.json`. The command name must match the scope — don't use raw executable paths with `Command.create()`.
- **Hover-highlight scrapped:** Intentionally removed — user determined it was not useful. State fields remain in Zustand store but are unused.

## Python Environment

If working with the Python sidecar (parser), use the `sharp` conda environment:

| Platform | Python path |
|----------|-------------|
| Windows  | `C:\Users\Tom\anaconda3\envs\sharp\python.exe` |
| macOS    | `~/anaconda3/envs/sharp/bin/python` |

## Repository

- GitHub: https://github.com/tomzzzhang/SHARP-Processor-2
- v1 repo: https://github.com/tomzzzhang/SHARP-data-processor

## Key References

- `HANDOFF.md` — complete feature spec, architecture, and implementation priority from v1
- v1 source: `C:\Users\Tom\OneDrive - SHARP Diagnostics\SHARP data processor\Unwinding data processing\`
- v1 design doc: `PROCESSOR_DESIGN.md` (in v1 repo)
- .sharp format spec: `SHARP_FORMAT.md` (in v1 repo)

## Documentation Timestamps (MANDATORY)

All project MD files have a `**Last Updated:**` field. Update ALL of them whenever any project file is modified. Format: `**Last Updated:** YYYY-MM-DD PST`
