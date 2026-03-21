<p align="center">
  <img src="public/sharp-logo.png" alt="SHARP Logo" width="120" />
</p>

<h1 align="center">SHARP Processor 2</h1>

<p align="center">
  Desktop app for qPCR and isothermal amplification data analysis.<br/>
  Built with <strong>Tauri 2 + React + TypeScript + Plotly.js</strong> — a ground-up rewrite of the <a href="https://github.com/tomzzzhang/SHARP-data-processor">v1 PyQt6 app</a>.
</p>

---

## Quick Start (Windows)

1. Go to [**Releases**](https://github.com/tomzzzhang/SHARP-Processor-2/releases/latest)
2. Download the installer (`.exe` or `.msi`)
3. Run the installer — or extract the portable ZIP
4. Double-click **SHARP Processor 2**

No Python, no setup. Everything is bundled.

To load data: drag a file onto the window, or use **File > Open**.

## Supported Instruments

| Instrument | Extension | Notes |
|---|---|---|
| BioRad CFX96 | `.pcrd` | Encrypted ZIP, auto-decrypted |
| TianLong Gentier | `.tlpd` | Password-protected ZIP |
| ThermoFisher QuantStudio | `.eds` | ZIP with JSON/XML |
| Agilent AriaMx | `.amxd` / `.adxd` | Double-encrypted PGP (requires GPG) |
| SHARP | `.sharp` | Universal archive format |

All instrument files are parsed into the same `.sharp` format via a bundled Python sidecar.

## Features

### Data Visualization
- **Amplification curves** — cycle, seconds, or minutes x-axis with log scale toggle
- **Melt curves** — raw RFU and negative derivative (-dF/dT) as stacked subplots
- **Melt derivative mini-plot** — shown below the amplification chart for quick reference
- **Doubling time scatter** — Tt vs doubling time per well, or dilution standard curve
- **Interactive plots** — box-select wells on any chart, click traces to select

### Well Management
- **96-well plate grid** — click, Ctrl+click, Shift+click, and rubber-band drag selection
- **Automatic plate layouts** — 16-well (Gentier Mini), 48-well, and 96-well configurations
- **Well list** with editable sample names, content types, and group assignments
- **Context menu** — right-click for classification, grouping, color/style, visibility, baseline overrides
- **Quick Style Panel** — expandable right-side drawer for fast well styling

### Analysis
- **Baseline correction** — horizontal or linear, configurable zone with draggable boundaries
- **Per-well baseline overrides** — customize baseline for individual wells
- **Threshold detection** — draggable threshold line on amplification plot, automatic Tt/Ct calculation
- **Call determination** — positive/negative/invalid based on threshold crossing and endpoint RFU
- **Doubling time fitting** — log-linear exponential fit with configurable fit region
- **Doubling Time Wizard** — dilution series setup with drag-to-assign well groups and standard curve fitting

### Style & Themes
- **3 themes** — SHARP (brand colors), Classic (greyscale), SHARP Dark (Material Design dark theme)
- **11+ color palettes** — SHARP, Tableau 10, Colorblind Safe, Paired, Pastel, plus scientific gradients (Viridis, Magma, Inferno, Plasma, Turbo) and single-hue ramps
- **Colors assigned by detection time** — earliest Tt gets first palette color
- **Auto-group by sample** name with shared group colors
- **Style controls** — line width, fonts, legend (position, visible-only filter), grid opacity, export DPI

### Export
- **Plot images** — PNG, SVG, JPEG at configurable DPI
- **Data CSV** — amplification data for visible wells
- **Melt CSV** — melt curve data for visible wells
- **Results CSV** — detection results table (Well, Sample, Content, Tt, Doubling Time, Call, End RFU)
- **Save as .sharp** — preserves edited metadata, sample names, and well assignments

### General
- **Multi-experiment tabs** — load multiple files, each with isolated analysis state
- **Undo/Redo** for most actions
- **Resizable panels** — drag sidebar and plot boundaries
- **Drag-and-drop** file loading with format auto-detection
- **Recent files** menu
- **Session save** — Ctrl+S saves back to `.sharp` with current state

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Ctrl+A` | Select all wells |
| `Ctrl+H` | Toggle visibility of selected wells |
| `Ctrl+G` | Group selected wells |
| `Ctrl+Shift+G` | Ungroup selected wells |
| `Ctrl+Shift+E` | Export plot as PNG |

## .sharp File Format

Each `.sharp` file is a ZIP archive containing:

| File | Required | Description |
|---|---|---|
| `metadata.json` | Yes | Instrument info, protocol, per-well results, plate layout |
| `amplification.csv` | Yes | Wide format: `cycle, time_s, time_min, A1, B1, ...` |
| `melt_rfu.csv` | No | Wide format: `temperature_C, A1, B1, ...` |
| `melt_derivative.csv` | No | Wide format: `temperature_C, A1, B1, ...` (-dF/dT) |

See the v1 repo's [`SHARP_FORMAT.md`](https://github.com/tomzzzhang/SHARP-data-processor/blob/main/SHARP_FORMAT.md) for the full specification.

## Development

### Prerequisites

- **Node.js** 24+
- **Rust** 1.94+ with VS 2022 Build Tools (C++ workload)
- **Python** 3.13 in the `sharp` conda environment (for instrument file parsing)

### Setup

```bash
npm install
```

### Run

```bash
# Windows — set CARGO_TARGET_DIR to avoid OneDrive sync on Rust target/
set CARGO_TARGET_DIR=C:\tauri-build-cache
npx tauri dev

# Or double-click dev.bat
```

### Build

```bash
npx tauri build

# Or double-click build.bat
```

Produces NSIS installer (`.exe`) and MSI package in `src-tauri/target/release/bundle/`.

### Tech Stack

| Layer | Technology |
|---|---|
| Shell | Tauri 2.x (Rust) |
| Frontend | React 18, TypeScript, Vite 8 |
| Styling | Tailwind CSS v4, shadcn/ui |
| Charts | Plotly.js (via react-plotly.js) |
| State | Zustand |
| Parsing | Python sidecar (bundled) |

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — Developer guide, project structure, and implementation notes
- [v1 Processor Design](https://github.com/tomzzzhang/SHARP-data-processor/blob/main/PROCESSOR_DESIGN.md) — Architecture reference
- [v1 .sharp Format Spec](https://github.com/tomzzzhang/SHARP-data-processor/blob/main/SHARP_FORMAT.md) — File format specification
- [v1 BioRad .pcrd Notes](https://github.com/tomzzzhang/SHARP-data-processor/blob/main/PCRD_FORMAT.md) — Reverse engineering documentation

## License

Proprietary — SHARP Diagnostics.
