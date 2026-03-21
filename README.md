<p align="center">
  <img src="public/sharp-logo.png" alt="SHARP Logo" width="120" />
</p>

<h1 align="center">SHARP Processor 2</h1>

<p align="center">
  Desktop app for visualizing and analyzing qPCR &amp; isothermal amplification data.<br/>
  No programming required — just download, install, and open your data files.
</p>

<p align="center">
  <a href="https://github.com/tomzzzhang/SHARP-Processor-2/releases/latest">
    <img src="https://img.shields.io/github/v/release/tomzzzhang/SHARP-Processor-2?label=Download&style=for-the-badge&color=c42a30" alt="Download latest release" />
  </a>
</p>

---

## Download & Install

1. Click the **Download** button above (or go to the [Releases](https://github.com/tomzzzhang/SHARP-Processor-2/releases/latest) page)
2. Download **`SHARP Processor 2_x64-setup.exe`**
3. Double-click the installer and follow the prompts
4. Open **SHARP Processor 2** from the Start Menu or desktop shortcut

> **Windows may show a SmartScreen warning** the first time you run the app ("Windows protected your PC"). This is normal for new apps that haven't been code-signed yet. Click **"More info"** → **"Run anyway"** to proceed.

---

## Opening Your Data

**Drag and drop** any supported file onto the app window, or go to **File → Open**.

| Instrument | File type you'll have |
|---|---|
| BioRad CFX96 | `.pcrd` |
| TianLong Gentier (Mini / 48 / 96) | `.tlpd` |
| ThermoFisher QuantStudio | `.eds` |
| Agilent AriaMx | `.amxd` or `.adxd` |
| Previously saved SHARP files | `.sharp` |

You don't need to export from your instrument software first — SHARP Processor reads the raw instrument files directly.

You can open multiple experiments at the same time. Each one gets its own tab.

---

## What You Can Do

### View amplification curves
See all your wells plotted together. Switch the x-axis between **Cycle**, **Seconds**, or **Minutes**. Toggle **Log Scale** for a logarithmic view.

### View melt curves
Switch to the **Melt** tab to see raw fluorescence and the negative derivative (−dF/dT) side by side. A small melt derivative preview also appears below the amplification chart.

### Select wells
- **Click** a well on the 96-well plate grid to select it
- **Ctrl+Click** to add wells to your selection
- **Click and drag** on the plate grid to select a rectangular region
- **Click a curve** on the plot to select that well
- **Drag a box** on the plot to select all wells in that region
- Use the toolbar buttons to quickly select **All**, **Samples**, **NTCs**, **Standards**, etc.

Selecting a well highlights it everywhere — on the grid, in the well list, on the plot, and in the results table.

### Correct baselines
Turn on **Baseline Correction** in the Analysis panel. Choose **Horizontal** (flat) or **Linear** (slope-corrected). Adjust the fitting zone by changing the start and end cycle numbers, or drag the shaded region on the plot.

### Set a detection threshold
Enable **Threshold Detection** to see a red dashed line on your amplification plot. Drag it up or down to set your threshold level. The app calculates **Tt** (time-to-threshold), **doubling time**, and a **positive/negative call** for each well.

### Measure doubling time
Switch to the **Doubling Time** tab for exponential growth fitting results. The app fits the log-linear growth region of each curve and reports the doubling time with confidence intervals.

### Change colors and styles
- Right-click any well or curve to change its **color**, **line style**, or **line width**
- Assign wells to **groups** — grouped wells automatically share colors
- Choose from **18 color palettes** including colorblind-safe options
- Switch between **3 themes**: Classic (greyscale), SHARP (brand red), or SHARP Dark

### Export your results
Go to **Export** in the menu bar:
- **Plot image** — save as PNG, SVG, or JPEG at any resolution
- **Amplification CSV** — raw or baseline-corrected fluorescence data
- **Melt CSV** — melt curve data
- **Results CSV** — detection results table (Tt, doubling time, call, end RFU)
- **Save as .sharp** — save the experiment with your edits (sample names, well types, etc.)

---

## Keyboard Shortcuts

| Shortcut | What it does |
|---|---|
| `Ctrl+O` | Open a file |
| `Ctrl+A` | Select all wells |
| `Ctrl+H` | Show/hide selected wells on the plot |

---

## Supported Instruments

| Instrument | Model(s) | Wells | File type |
|---|---|---|---|
| BioRad | CFX96 | 96 | `.pcrd` |
| TianLong | Gentier Mini | 16 | `.tlpd` |
| TianLong | Gentier 48 | 48 | `.tlpd` |
| TianLong | Gentier 96 | 96 | `.tlpd` |
| ThermoFisher | QuantStudio | 96 | `.eds` |
| Agilent | AriaMx | 96 | `.amxd` / `.adxd` |

> **Note for AriaMx users:** `.amxd` files use PGP encryption. You'll need [GPG](https://gnupg.org/download/) installed with the AriaMx key imported. Contact us if you need help setting this up.

---

## Upgrading from SHARP Processor v1

SHARP Processor 2 is a complete rewrite with a modern interface. If you used the original [SHARP Processor](https://github.com/tomzzzhang/SHARP-data-processor), here's what's new:

- **Faster** — native desktop app (no Python startup delay)
- **Interactive plots** — click and drag directly on curves (powered by Plotly.js)
- **Multiple experiments** — open several files in tabs
- **Modern UI** — resizable panels, dark theme, brand styling
- **Same file format** — your `.sharp` files from v1 work in v2

---

## About the .sharp File Format

A `.sharp` file is just a ZIP archive containing your experiment data in open formats (CSV + JSON). You can rename it to `.zip` and open it with any ZIP tool to access:

- `amplification.csv` — fluorescence readings per cycle for each well
- `melt_rfu.csv` — melt curve fluorescence (if available)
- `melt_derivative.csv` — melt derivative data (if available)
- `metadata.json` — instrument info, protocol settings, well assignments, and results

---

## Need Help?

- Open an issue on [GitHub](https://github.com/tomzzzhang/SHARP-Processor-2/issues)
- Check the in-app help: **Help → User Guide**

---

## Architecture

SHARP Processor 2 is a ground-up rewrite of the [original SHARP Processor](https://github.com/tomzzzhang/SHARP-data-processor) (Python + PyQt6 + matplotlib). Key improvements:

- **Native desktop performance** — Tauri 2 (Rust) shell with a React frontend, no Python startup delay
- **Interactive charts** — Plotly.js replaces matplotlib for click-to-select, box-select, and drag-to-adjust
- **Multi-experiment tabs** — open several files simultaneously, each with isolated analysis state
- **Modern UI** — resizable panels, three themes (including dark mode), 18 color palettes

Your `.sharp` files from v1 work in v2 without any changes.

### Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2.x (Rust) |
| Frontend | React 18, TypeScript, Vite 8 |
| Styling | Tailwind CSS v4, shadcn/ui |
| Charts | Plotly.js (react-plotly.js) |
| State management | Zustand |
| Instrument parsing | Python sidecar (bundled) |

### Instrument File Parsing

Instrument files (`.pcrd`, `.tlpd`, `.eds`, `.amxd`) use proprietary and encrypted formats. SHARP Processor includes a bundled Python sidecar that handles decryption and conversion:

- **BioRad `.pcrd`** — ZipCrypto-encrypted ZIP containing XML fluorescence data
- **TianLong `.tlpd`** — password-protected ZIP with hex-encoded uint16 fluorescence
- **ThermoFisher `.eds`** — ZIP with JSON (modern) or XML (legacy) quantification data
- **Agilent `.amxd`** — double-encrypted PGP TAR archives with binary fluorescence packets

All formats are parsed into the universal `.sharp` archive format for consistent downstream analysis.

## Development

### Prerequisites

- Node.js 24+
- Rust 1.94+ with VS 2022 Build Tools (C++ desktop workload)
- Python 3.13 in the `sharp` conda environment (for instrument file parsing sidecar)

### Setup & Run

```bash
npm install

# Windows — set CARGO_TARGET_DIR to avoid OneDrive sync on Rust target/
set CARGO_TARGET_DIR=C:\tauri-build-cache
npx tauri dev
```

Or double-click `dev.bat`.

### Build Release Installers

```bash
npx tauri build
```

Or double-click `build.bat`. Produces NSIS (`.exe`) and MSI installers in `target/release/bundle/`.

### Documentation

- [`CLAUDE.md`](CLAUDE.md) — Developer guide, architecture, implementation notes
- [v1 .sharp Format Spec](https://github.com/tomzzzhang/SHARP-data-processor/blob/main/SHARP_FORMAT.md)
- [v1 .pcrd Reverse Engineering](https://github.com/tomzzzhang/SHARP-data-processor/blob/main/PCRD_FORMAT.md)

---

<p align="center">
  <sub>SHARP Diagnostics</sub>
</p>
