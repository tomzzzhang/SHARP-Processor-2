# CLAUDE.md — SHARP Processor 2

## Project Overview

SHARP Processor 2 — a modern desktop app for qPCR/isothermal amplification data analysis. This is a ground-up rewrite of the v1 PyQt6+matplotlib app using **Tauri 2 + React + TypeScript + Plotly.js**.

## Tech Stack

- **Frontend:** React 18+, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui, Plotly.js (via react-plotly.js + plotly.js-dist-min)
- **State:** Zustand
- **Backend:** Tauri 2.x (Rust)
- **Python sidecar:** For instrument file parsing (.pcrd, .tlpd, .eds, .amxd) via scoped shell command
- **Build:** Tauri CLI → `.exe` x64+x86 (Windows), `.app` (macOS)

## Build & Run

### Windows
```bash
# Double-click dev.bat, or:
set CARGO_TARGET_DIR=%cd%\build-cache
npx tauri dev
```
- **CARGO_TARGET_DIR** is set to `build-cache/` inside the project directory (handled automatically by `dev.bat` and `build.bat`).
- Requires: Rust (stable), VS 2022 Build Tools (C++ workload), Node 24+
- Rust targets: `x86_64-pc-windows-msvc` (64-bit), `i686-pc-windows-msvc` (32-bit)
- `build.bat` builds both x64 and x86 installers → `dist-release/windows-x64/` and `dist-release/windows-x86/`

### macOS
```bash
# Prerequisites: xcode-select --install, Rust via rustup, Node 24+
chmod +x dev.sh build.sh
./dev.sh          # development
./build.sh        # production DMG → dist-release/macos/
```
- First launch: right-click > Open to bypass "unidentified developer" warning (ad-hoc signed)
- Xcode Command Line Tools required (not full Xcode)

### dist-release/ Structure
```
dist-release/
  windows-x64/    # 64-bit NSIS (.exe) + MSI
  windows-x86/    # 32-bit NSIS (.exe) + MSI
  macos/          # DMG + .app bundle
```

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
| 21 | macOS build support | **Done** | Bundle targets "all" (DMG+app on Mac, NSIS+MSI on Win), build.sh/dev.sh launchers, platform-aware shortcut labels (⌘/Ctrl), .gitattributes LF for .sh |
| 22 | Update checker + melt threshold + UX | **Done** | GitHub release update checker (auto + manual), melt derivative threshold (draggable, dims low-peak wells), Tm column in results, SHARP theme warm grey, smaller checkboxes, well grid outlines |
| 23 | Welcome tab + sidebar home | **Done** | Welcome tab on startup, SidebarHome with load button + recent experiments, greyed-out tabs when no experiment, padded macOS icon |
| 24 | Plot bg + melt drag-select | **Done** | Plot background defaults to off-white (#fafafa) instead of theme bg, customizable via Style tab color picker. Melt tab derivative subplot now supports drag-select (yaxis2-aware box select) |
| 25 | TianLong sample parsing + UX | **Done** | .tlpd parser extracts actual sample names from Well hex blobs (Test Name priority, Sample fallback). Only populated wells shown. Well names mapped to correct plate layout (A1-A8/B1-B8 for Gentier Mini). Dynamic well count from instrument model. SHARP theme sepia toned down. Dark mode number input spinners fixed. Cross-platform npm install fix (removed darwin-arm64 dep) |
| 26 | Legend improvements | **Done** | Legend content selector (sample name default, well name option) via `legendContent` state. Legend click disabled (`onLegendClick={() => false}`). Legend hover wired to `setHoveredWell` via `useLegendHover` hook using native `plotly_legendhover` event. Well list rows now subscribe to `hoveredWell` and show a brand-red left bar + 18% tint when hovered from anywhere. Legend now on by default. |

## Instrument File Formats & Encryption

Most instrument formats are parsed in pure TypeScript (`src/lib/parsers/`). The Python sidecar (`scripts/parse_instrument.py`) is used as a fallback for formats requiring v1 parser dependencies. Key details for each format:

### BioRad CFX96 (.pcrd)
- **Structure:** Nested ZIP → inner `datafile.pcrd` entry is ZipCrypto encrypted → UTF-8 XML
- **Password:** `SecureCompressDecompressKeyiQ5V4Files!!##$$`
- **Source:** Hardcoded in Bio-Rad CFX Manager's `BioRad.Common.dll` (`FileCryptor` class)
- **XML root:** `<experimentalData2>` — contains plate setup, protocol, fluorescence data (PAr blobs), per-cycle timestamps, RunInfo (66 KV pairs), event log
- **PAr data:** 2592 semicolon-separated floats per plate read: 108 wells × 4 stats × 6 channels. Channel 0 = FAM/SYBR. Index: `c*432 + w*4 + stat`. Wells 0-95 = data (A1-H12), 96-107 = reference (skip)
- **Plate layout:** Always 96-well (8×12), defined by `plateSetup2` XML section
- **Full reverse engineering notes:** `PCRD_FORMAT.md` in v1 repo

### TianLong Gentier (.tlpd)
- **Structure:** Password-protected ZIP archive
- **Password:** `82218051`
- **Contents:** INI-style text files (`experiment_data`, `run_method`, `coefficient`, `experiment_log`)
- **AmpData:** Hex-encoded uint16 LE fluorescence values, N wells per cycle (N = well count from model)
- **MeltData:** Same hex format, temperatures derived from protocol step definitions
- **Step definitions:** 26-byte hex blobs — temp at offset +2 (uint16 LE, hundredths °C), hold time at +10, read flag at +14
- **SampleSetup Well blobs:** `Well\N\Value` in `[SampleSetup]` section — hex-encoded binary per well:
  - Byte 0: active flag (01 = populated, 00 = empty)
  - Bytes 4-7: color (RGBA)
  - Bytes 12+: sample name (ASCII, null-terminated)
  - `Well\N\Value\Test`: same structure, contains Test Name field (preferred over Sample name)
- **Well count:** Determined from `InstrumentTypeName` in `FileInfo` section via model lookup
- **Physical layout:** Mapped from instrument model (not stored in file): Gentier Mini → 2×8, Gentier 48 → 6×8, Gentier 96 → 8×12
- **Well name mapping:** 0-based index → row/col: `index / cols` → row letter, `index % cols + 1` → column number
- **Time reconstruction:** `TempData` section contains real 1-second resolution instrument telemetry

### ThermoFisher QuantStudio (.eds)
- **Structure:** ZIP archive (unencrypted)
- **Two formats:** Modern (JSON-based `.quant` files) and legacy (XML-based)
- **Fluorescence:** Rn (normalized) values; per-cycle timestamps from `.quant` files
- **Plate layout:** 96-well (8×12)

### Agilent AriaMx (.amxd / .adxd)
- **Structure:** Double-encrypted: outer PGP TAR (.amxd) → inner PGP TAR (.SPM) → XML files
- **GPG key:** ID `3F1AF07D202BF668`, empty passphrase. Must be imported: `gpg --import ariamx_key.asc`
- **Fluorescence:** Hex-encoded 1160-byte binary packets in `InstrumentData.xml`. Header 8 bytes; 6 channels × 96 wells × 2 bytes (uint16 LE). Channel order: CY5(0), ROX(1), HEX(2), FAM(3), SYBR(4), CY3(5)
- **Primary channel:** Auto-detected from first packet (non-ROX channel with most non-zero wells)
- **Plate layout:** 96-well (8×12)
- **Requires:** GPG on PATH with AriaMx key imported

### Instrument Plate Layouts

Physical plate dimensions are NOT stored in most instrument files. The app uses this priority chain:
1. Explicit `plate_layout` in `.sharp` metadata (if present)
2. Instrument model lookup (`constants.ts:INSTRUMENT_PLATE_LAYOUTS`)
3. Inferred from well names in data (max row letter + max column number)
4. Default: 8×12 (standard 96-well)

Known instrument layouts:
| Instrument | Model | Wells | Layout |
|------------|-------|-------|--------|
| TianLong | Gentier Mini | 16 | 2×8 |
| TianLong | Gentier 48 | 48 | 6×8 |
| TianLong | Gentier 96 | 96 | 8×12 |
| BioRad | CFX96 | 96 | 8×12 |
| ThermoFisher | QuantStudio | 96 | 8×12 |
| Agilent | AriaMx | 96 | 8×12 |

## .sharp File Format (Quick Reference)

ZIP archive (rename to `.zip` to open) containing:

| File | Required | Description |
|------|----------|-------------|
| `metadata.json` | Yes | Instrument info, protocol, per-well results, data summary |
| `amplification.csv` | Yes | Wide format: `cycle, time_s, time_min, A1, B1, ...` (RFU) |
| `melt_rfu.csv` | No | Wide format: `temperature_C, A1, B1, ...` |
| `melt_derivative.csv` | No | Wide format: `temperature_C, A1, B1, ...` (-dF/dT) |
| `parsing_log.json` | No | Append-only parse history |

**metadata.json key sections:** `format_version` (currently "1.0"), `instrument` (manufacturer, model, serial), `run_info` (operator, notes, timestamps), `protocol` (type, temp, cycles, melt config), `wells` (per-well: sample, content, Cq, melt peaks), `data_summary` (wells_used, cycle count), `plate_layout` (rows, cols — added by v2), `time_reconstruction` (source, cycle duration stats)

**Well name format:** `{row_letter}{column_number}`, no zero-padding. E.g., `A1`, `B3`, `H12`. Sorted row-first.

**Experiment types:** `sharp` (isothermal 65°C), `unwinding` (~37°C), `standard_pcr` (thermal cycling), `fast_pcr`, `isothermal`, `unknown`

**Full spec:** `SHARP_FORMAT.md` in v1 repo

## Known Issues / Workarounds

- **react-plotly.js CJS interop:** `react-plotly.js` and its factory are CJS. With Vite + `esModuleInterop`, we use `plotly.js-dist-min` + `createPlotlyComponent` factory with a runtime `.default` fallback to handle the namespace object. See `PlotArea.tsx`.
- **Plotly.js bundle size:** ~3.5 MB (using `plotly.js-dist-min`). Fine for dev, consider custom partial bundle later.
- **verbatimModuleSyntax:** Disabled in `tsconfig.app.json` because it breaks CJS default imports. Using `esModuleInterop` + `allowSyntheticDefaultImports` instead.
- **Shell scoping for Python sidecar:** `Command.create('python-parser', ...)` uses a scoped command defined in `src-tauri/capabilities/default.json`. The command name must match the scope — don't use raw executable paths with `Command.create()`.
- **Hover-highlight scrapped:** Intentionally removed — user determined it was not useful. State fields remain in Zustand store but are unused.

## Python Environment

The Python sidecar requires a `sharp` conda environment with the v1 parser dependencies. See `CLAUDE.local.md` for platform-specific Python paths.

## Repository

- GitHub: https://github.com/tomzzzhang/SHARP-Processor-2
- v1 repo: https://github.com/tomzzzhang/SHARP-data-processor

## Key References

- v1 design doc: `PROCESSOR_DESIGN.md` (in v1 repo)
- v1 .sharp format spec: `SHARP_FORMAT.md` (in v1 repo)
- v1 BioRad reverse engineering: `PCRD_FORMAT.md` (in v1 repo)
- v1 user guide: `PROCESSOR_GUIDE.md` (in v1 repo)
