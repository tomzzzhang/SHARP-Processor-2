# SHARP Processor 2 — Handoff Document

**Last Updated:** 2026-03-19 PST

## What This Is

A ground-up rewrite of the SHARP Processor desktop app. The v1 app (PyQt6 + matplotlib) works but feels dated and is limited by matplotlib's rasterized plotting and PyQt6's widget aesthetics. v2 moves to **Tauri + React + Plotly** for a modern, fast, lightweight desktop app.

## Why Rewrite

| Problem (v1) | Solution (v2) |
|---------------|----------------|
| matplotlib rasterizes plots — no smooth zoom, sluggish with many wells | Plotly — vector/WebGL, interactive pan/zoom/hover, buttery smooth |
| PyQt6 widgets look like a 2005 app no matter how you style them | React + Tailwind/shadcn — modern UI for free |
| 245 MB exe, platform-specific builds, no auto-update | Tauri — 10-20 MB installer, auto-update built in, cross-platform from one codebase |
| Single-threaded Python blocks UI during heavy analysis | Rust backend (async) + web frontend = never blocks |
| Distribution is painful (PyInstaller quirks, scipy/MKL issues, code signing) | Tauri handles bundling, signing, and updates natively |

## Tech Stack

- **Frontend:** React 18+ (TypeScript), Tailwind CSS, shadcn/ui components, Plotly.js for plots
- **Backend:** Tauri 2.x (Rust) for native shell, file I/O, and compute
- **Analysis engine:** Python sidecar OR port to Rust/JS incrementally
  - Short term: call existing Python analysis code as a Tauri sidecar process
  - Long term: port critical paths (baseline, detection, fitting) to Rust for speed
- **Build:** Tauri CLI — produces `.exe` (Windows), `.app` (macOS), `.deb`/`.AppImage` (Linux)

## What to Carry Over from v1

All features from the v1 processor should be replicated. The v1 is feature-complete (all 9 phases done). Key features:

### Data & Parsing
- Load `.sharp` files (ZIP archives with CSV + JSON metadata)
- Direct instrument file loading: `.pcrd`, `.tlpd`, `.eds`, `.amxd`, BioRad CSV folders
- Multi-experiment support with experiment switching
- The full parser codebase lives in the v1 repo (`sharp/parser/`) — reuse as sidecar

### Visualization
- **Amplification plot**: RFU vs cycle/time(s)/time(min), per-well colored curves
- **Melt plot**: RFU + -dF/dT derivative, stacked subplots with shared x-axis
- **96-well grid**: click/drag/Ctrl+click selection, colored by palette, call dots (pos/neg/invalid)
- **Well list**: table with checkboxes, color swatches, sortable
- Cross-linked hover highlighting across all three views (grid, amp plot, melt plot)
- Box select on plot (drag rectangle to select curves)
- Log scale toggle

### Analysis
- **Baseline correction**: horizontal (mean) and linear (linregress), configurable zone, per-well overrides, raw curve overlay
- **Threshold & detection time (Tt)**: draggable threshold line, linear interpolation, NTC/positive control flagging
- **Doubling time**: exponential fit (A·exp(kt)+C), configurable fit region (fraction of threshold)
- **Dilution series**: Tt vs log10(concentration) linear fit

### Style & Export
- Color palettes: Tableau 10, Colorblind Safe, Grayscale
- Typography: font family, sizes for title/labels/ticks/legend
- Legend: show/hide, position, visible wells only
- Grid: show/hide, opacity
- Line width (global + per-well override)
- Per-well color/style/width overrides via right-click context menu
- Style presets: save/load/reset (JSON)
- Export: plots (PNG/SVG/PDF), data (CSV), results (CSV)

### Results Table
- Columns: Well, Sample, Content, Tt, Dt, Call, End RFU, Tm
- Click row to select well, warnings for NTC contamination / positive control failure
- Summary: positive count, mean Tt, mean Dt

## Architecture Suggestion

```
sharp-processor-2/
  src-tauri/           # Rust backend
    src/
      main.rs          # Tauri entry point
      commands.rs      # IPC commands (load_file, run_analysis, export)
      parser.rs        # Sidecar management for Python parser
    Cargo.toml
    tauri.conf.json

  src/                 # React frontend
    App.tsx
    components/
      WellGrid.tsx     # 96-well interactive grid (SVG or Canvas)
      WellList.tsx     # Table with checkboxes
      PlotArea.tsx     # Plotly amplification + melt plots
      ResultsTable.tsx # Detection/fitting results
      Sidebar.tsx      # Tabbed: Data, Wells, Analysis, Style
      StylePanel.tsx   # Color, typography, legend, grid controls
    hooks/
      useAppState.ts   # Zustand or similar — replaces PyQt signals
      useAnalysis.ts   # Baseline, detection, fitting logic
    lib/
      sharp-loader.ts  # Parse .sharp ZIP (JSZip) → data model
      analysis/        # Baseline, detection, fitting (TS ports or sidecar calls)
    types/
      experiment.ts    # TypeScript types matching v1 data model

  python-sidecar/      # Existing Python parser (copied or symlinked)
    sharp/
      parser/          # The full parser package from v1

  package.json
  tsconfig.json
  tailwind.config.js
  vite.config.ts
```

## v1 Source Reference

The complete v1 codebase is at:
```
C:\Users\Tom\OneDrive - SHARP Diagnostics\SHARP data processor\Unwinding data processing\
```
GitHub: https://github.com/tomzzzhang/SHARP-data-processor

Key files to reference:
- `sharp/processor/app.py` — main window layout, all UI wiring
- `sharp/processor/state.py` — AppState with all signals, analysis orchestration
- `sharp/processor/data_model.py` — ExperimentData, WellInfo dataclasses
- `sharp/processor/loader.py` — .sharp loader + instrument file routing
- `sharp/processor/analysis/` — baseline.py, detection.py, fitting.py, dilution.py
- `sharp/processor/plotting/` — amplification.py, melt.py
- `sharp/processor/widgets/` — well_grid.py, well_list.py, plot_canvas.py, melt_canvas.py, results_table.py
- `sharp/processor/constants.py` — colors, palettes, layout defaults
- `sharp/processor/export.py` — export functions
- `PROCESSOR_DESIGN.md` — full design doc with all phase details
- `SHARP_FORMAT.md` — .sharp file format specification

## .sharp File Format (Quick Reference)

ZIP archive containing:
- `amplification.csv` — wide format: cycle, time_s, time_min, A1, B1, ... (RFU values)
- `melt_rfu.csv` — wide format: temperature_C, A1, B1, ... (optional)
- `melt_derivative.csv` — wide format: temperature_C, A1, B1, ... (optional, -dF/dT)
- `metadata.json` — instrument info, protocol, per-well data (sample, content type, Cq, melt peaks)

Full spec: `SHARP_FORMAT.md` in the v1 repo.

## Implementation Priority

1. **Scaffold** — Tauri + React + Vite + Tailwind + Plotly setup, "Hello World" window
2. **Data loading** — Parse .sharp ZIP in JS (JSZip), display raw amplification curves in Plotly
3. **Well grid + selection** — Interactive 96-well SVG grid with click/drag/Ctrl+click
4. **Cross-linked interaction** — Hover/select syncing between grid, list, and plots
5. **Analysis** — Port baseline, detection, fitting to TypeScript (or wire up Python sidecar)
6. **Melt plots** — Stacked Plotly subplots with shared x-axis
7. **Style controls** — Palette, typography, legend, grid, line width
8. **Export** — Plots (Plotly image export), data/results CSV
9. **Instrument file loading** — Python sidecar for .pcrd/.tlpd/.eds/.amxd parsing
10. **Build & release** — Tauri bundler for Windows + macOS, GitHub Releases with auto-update

## Notes

- The Python sidecar approach means we don't need to port the parsers to Rust immediately. Tauri has first-class sidecar support — bundle a Python exe alongside the app.
- For the analysis engine, start with TypeScript ports (baseline and detection are simple math). Fitting (scipy curve_fit) is the hardest to port — use the sidecar for that initially.
- Plotly.js handles WebGL rendering for large datasets — should be smooth even with 96 wells × 100 cycles.
- Consider Zustand for state management — lightweight, simple, good for this scale.
