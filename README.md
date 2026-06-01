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

### Windows

1. Click the **Download** button above (or go to the [Releases](https://github.com/tomzzzhang/SHARP-Processor-2/releases/latest) page)
2. Download the installer for your system:
   - **64-bit** (most PCs): **`SHARP Processor 2_x64-setup.exe`**
   - **32-bit** (older lab PCs): **`SHARP Processor 2_x86-setup.exe`**
3. Double-click the installer and follow the prompts
4. Open **SHARP Processor 2** from the Start Menu or desktop shortcut

> **Not sure which to pick?** If your PC runs Windows 10 or 11, use the 64-bit version. Use 32-bit only for older machines (e.g., lab PCs connected to legacy instruments).

> **Windows may show a SmartScreen warning** the first time you run the app ("Windows protected your PC"). This is normal for new apps that haven't been code-signed yet. Click **"More info"** → **"Run anyway"** to proceed.

### macOS (Apple Silicon)

1. Download the **`.dmg`** file from the [Releases](https://github.com/tomzzzhang/SHARP-Processor-2/releases/latest) page
2. Open the DMG and drag **SHARP Processor 2** into the **Applications** folder
3. **First launch — bypass the macOS security warning:**
   - Open **System Settings → Privacy & Security**
   - Scroll down to the Security section — you'll see a message saying *"SHARP Processor 2" was blocked from use because it is not from an identified developer*
   - Click **Open Anyway** and confirm
   - Alternatively: right-click the app in Applications → **Open** → click **Open** in the dialog

> macOS builds are ad-hoc signed (not notarized with Apple). After you allow it once via the steps above, subsequent launches work normally. This is standard for open-source Tauri apps distributed outside the Mac App Store.

---

## What's New in v0.2.0 — Multichannel Support

SHARP Processor 2 now reads **every fluorophore channel** in your experiment, not just one. Open a multi-dye run — FAM + HEX, SYBR + Cal Orange 560, or a full 4-plex — and work with each dye independently. Single-dye runs look and behave exactly as before.

- **Automatic channel detection.** Every instrument format now extracts all of its optical channels. If a file has one dye, nothing changes; if it has several, the extra channels appear automatically.
- **Show or hide each channel.** Toggle fluorophores on the plot — all wells at once, or per individual well.
- **Assign Fluorophores** (**Tools → Assign Fluorophores…**). Give each channel a name and color; the labels flow through the legend, the wells table, and the results.
- **Independent analysis per dye.** Baseline, threshold, normalization, and drift correction are set separately for each channel — pick the channel with **"Settings for: [channel]"** in the Analysis panel. Each dye remembers its own settings.
- **Single-channel view for multi-dye files.** **View → Channel Display → Single** hides the channel controls and shows the familiar one-curve-per-well layout, so you can focus on a single dye. Switch back to **Multichannel** anytime.
- **Per-channel results.** The results table shows **Tt**, **Tm**, and the positive/negative call for each (well, dye) combination, with collapsible per-sample rows and a **Fluorophore** column.
- **Channel-aware selection.** Click a curve to select that one (well, dye); click a well on the grid to select all of its dyes. A new **"Fluor…"** button in the Wells tab selects every curve of a chosen dye at once.

**Smoother, too.** Plots and interactions — hovering, selecting, dragging the threshold line, toggling channels — are noticeably more responsive in this version.

**Backward compatible.** Single-channel `.sharp` and `.sharpx` files from any earlier version open unchanged.

---

## Opening Your Data

**Drag and drop** any supported file onto the app window, or go to **File → Open**.

| Instrument | File type you'll have |
|---|---|
| BioRad CFX96 | `.pcrd` |
| BioRad CFX96 (CSV export folder) | Folder of CSVs from CFX Manager |
| TianLong Gentier (Mini / 48 / 96) | `.tlpd` |
| ThermoFisher QuantStudio | `.eds` |
| Agilent AriaMx | `.amxd` or `.adxd` |
| Previously saved SHARP files | `.sharp` (data only) or `.sharpx` (data + your session) |

You don't need to export from your instrument software first — SHARP Processor reads the raw instrument files directly. For BioRad, you can also open the CSV export folder from CFX Manager via **File → Open BioRad Folder**.

You can open multiple experiments at the same time. Each one gets its own tab.

---

## What You Can Do

### View amplification curves
See all your wells plotted together. Switch the x-axis between **Cycle**, **Seconds**, or **Minutes**. Toggle **Log Scale** for a logarithmic view.

### View melt curves
Switch to the **Melt** tab to see raw fluorescence and the negative derivative (−dF/dT) side by side. A small melt derivative preview also appears below the amplification chart. Enable the **Melt Threshold** to dim wells with low derivative peaks — useful for identifying negative or weak reactions. The threshold line is draggable.

### Select wells
- **Click** a well on the 96-well plate grid to select it
- **Ctrl+Click** to add wells to your selection
- **Click and drag** on the plate grid to select a rectangular region
- **Click a curve** on the plot to select that well
- **Drag a box** on the plot to select all wells in that region
- Use the toolbar buttons to quickly select **All**, **Samples**, **NTCs**, **Standards**, etc.

Selecting a well highlights it everywhere — on the grid, in the well list, on the plot, and in the results table.

**Hover to preview.** Moving the mouse over any curve, grid cell, legend entry, or sample list row highlights the same well across all of them. The legend defaults to showing sample names; switch to well names via **Style > Legend > Content**.

### Correct baselines
Turn on **Baseline Correction** in the Analysis panel. **Auto baseline** is on by default — the app finds the first flat region of each well (before amplification starts) and uses it as a horizontal baseline. This handles early signal dips (helicase warm-up on SHARP curves) and wells that amplify at different times without any manual tuning.

Need to override? Turn **Auto baseline** off for a global manual range (Horizontal or Linear fit over a cycle window you choose), or right-click specific wells → **Baseline → Manual** to opt just those wells out of auto while everyone else stays auto. Baseline Start/End inputs are entered in whatever x-axis unit you're viewing (cycle / seconds / minutes); they snap to the nearest cycle on commit.

### Correct instrument drift
Enable **Drift Correction** in the Analysis panel for runs where the baseline visibly slopes across the plate. The app estimates a single run-level drift slope by pooling the pre-amplification baseline regions of every well (using a within-well fit so genuine per-well baseline offsets don't bias the result) and subtracts it before per-well baseline correction. The detected slope appears as a small readout (e.g. *Fitted drift: +0.04 RFU/min, 84 wells*) so you can report it in a methods section.

### Normalize curves
Turn on **Normalize selected** in the Analysis panel to rescale every visible amp curve from 0 → 1 between its baseline and its plateau — a common preparation for visual comparison across plates. Non-amplifying wells (NTCs, failed reactions) are detected by SNR and divided by the median amplifying-well plateau, so they render as a small flat curve near 0 instead of blowing up the shared y-axis. The Melt tab has its own **Normalize** checkbox that does the analogous HRM-style 1 → 0 rescale on melt curves; the −dF/dT derivative is always computed from the raw signal, so peak heights stay physically meaningful.

### Set a detection threshold
Enable **Threshold Detection** to see a red dashed line on your amplification plot. Drag it up or down to set your threshold level. The app calculates **Tt** (time-to-threshold), **Tm** (melt temperature), **doubling time**, and a **positive/negative call** for each well.

### Measure doubling time
Switch to the **Doubling Time** tab for exponential growth fitting results. The app fits the log-linear growth region of each curve and reports the doubling time with confidence intervals.

### Change colors and styles
- Right-click any well or curve to change its **color**, **line style**, or **line width**
- Pick from **palette-based swatches** (SHARP, Tableau, Colorblind Safe, Paired) or use a custom hex color
- Assign wells to **groups** — grouped wells automatically share colors
- Choose from **18 color palettes** including colorblind-safe options
- **Assign palette by arrow** — draw an arrow across curves to assign palette colors in visual order
- Switch between **3 themes**: Classic (greyscale), SHARP (brand red), or SHARP Dark
- **Built-in style presets** (Default, Publication, Presentation) — one-click to optimize for different outputs
- Toggle **title**, **axis labels**, and **tick labels** on/off individually via the Typography panel

### Export your results
Go to **Export** in the menu bar. There are two ways to export plots:

**Export Wizard** — A configuration dialog for publication-ready figures. Pick the plot type (amplification, melt, melt derivative, or doubling time), choose a size preset (single/double column, slide, square, or custom), set DPI and format (PNG/SVG/JPEG), and see a live preview that reflects your Style tab settings at the true target size. Click **Export…** and save.

**Export As Seen** — A quick submenu (PNG/SVG/JPEG) that exports the currently-displayed plot exactly as it appears on screen, upscaled by your configured DPI. On the amplification tab this includes the melt-derivative mini-plot stacked below the main plot, so the exported image matches the on-screen layout one-to-one.

Data exports:
- **Amplification CSV** — raw or baseline-corrected fluorescence data
- **Melt CSV** — melt curve data
- **Results CSV** — detection results table (Tt, Tm, doubling time, call, end RFU)
- **Save as .sharp** — save the experiment with your edits (sample names, well types, etc.). Clean, data-only, intended for sharing.
- **Save Session** — write a `.sharpx` file: the same data plus your current workspace (selections, hidden wells, baseline / normalization / drift settings, threshold, style, plot tab, groups, per-well overrides, dilution wizard config). Re-open the `.sharpx` to pick up exactly where you left off. `Ctrl/⌘+S` re-saves in whichever format the file was opened as.

---

## Keyboard Shortcuts

| Shortcut | What it does |
|---|---|
| `Ctrl/⌘+O` | Open a file |
| `Ctrl/⌘+A` | Select all wells |
| `Ctrl/⌘+H` | Show/hide selected wells on the plot |
| `Ctrl/⌘+G` | Group selected wells |
| `Ctrl/⌘+U` | Ungroup selected wells |

> **Tip:** The **MENU** panel on the right edge shows keyboard shortcut hints next to each action.

---

## Supported Instruments

| Instrument | Model(s) | Wells | File type |
|---|---|---|---|
| BioRad | CFX96 | 96 | `.pcrd` or CSV folder |
| TianLong | Gentier Mini | 16 | `.tlpd` |
| TianLong | Gentier 48 | 48 | `.tlpd` |
| TianLong | Gentier 96 | 96 | `.tlpd` |
| ThermoFisher | QuantStudio | 96 | `.eds` |
| Agilent | AriaMx | 96 | `.amxd` / `.adxd` |

> **Note for AriaMx users:** `.amxd` files use PGP encryption. You'll need [GPG](https://gnupg.org/download/) installed with the AriaMx key imported. Contact us if you need help setting this up.

---

## Upgrading from SHARP Processor v1

SHARP Processor 2 is a complete rewrite with a modern interface. If you used the original [SHARP Processor](https://github.com/tomzzzhang/SHARP-processor), here's what's new:

- **Faster** — native desktop app (no Python startup delay)
- **Interactive plots** — click and drag directly on curves (powered by Plotly.js)
- **Multiple experiments** — open several files in tabs
- **Modern UI** — resizable panels, dark theme, brand styling
- **Same file format** — your `.sharp` files from v1 work in v2

---

## The .sharp / .sharpx File Format

`.sharp` is SHARP Processor's native file format — a plain ZIP archive of your experiment in open formats (CSV, JSON, and plain text). Every instrument file you open gets converted to `.sharp` on save, and `.sharp` is the recommended way to share or archive a run.

`.sharpx` is a session variant — the **same ZIP layout** as `.sharp` with one extra entry, `session.json`, carrying your working view-state (selections, hidden wells, baseline / normalization / drift settings, threshold, style, plot tab, groups, per-well overrides, dilution wizard config). Use `.sharp` for sharing data; use `.sharpx` to resume your own work later.

### What's inside

Rename a `.sharp` file to `.zip` and any ZIP tool will open it. You'll see:

| File | What it is |
|------|-----------|
| `SUMMARY.txt` | **Start here.** Human-readable overview — experiment ID, operator, instrument, protocol, plate size, and a description of every other file in the archive. |
| `wells.csv` | **Well manifest** — one row per populated well: `well, sample, content, cq, end_rfu, melt_temp_c, melt_peak_height`. Opens in Excel. |
| `amplification.csv` | Per-cycle fluorescence per well (wide format: `cycle, time_s, time_min, A1, B1, …`). |
| `melt_rfu.csv` | Per-temperature fluorescence per well (if the run had a melt step). |
| `melt_derivative.csv` | Per-temperature `-dF/dT` per well. Pre-smoothed using the BioRad CFX Maestro algorithm. |
| `metadata.json` | **Authoritative** machine-readable metadata — instrument, protocol, run info, per-well analysis outputs, time reconstruction. |

`wells.csv` and `SUMMARY.txt` were added in format version 1.1 (SHARP Processor 2 v0.1.11); multichannel data was added in format version 1.2 (v0.2.0). Older `.sharp` files still load — the app falls back to `metadata.json`, and single-channel files are read exactly as before.

### How to create one

- **Open an instrument file** (`.pcrd`, `.tlpd`, `.eds`, `.amxd`, or a BioRad CSV export folder) via **File → Open**, then **Export → Save as .sharp…** to save.
- Or **File → Save** (Ctrl/⌘+S) if you're working on a file you already opened as `.sharp` — this overwrites in place.
- Edits you've made in the app — sample names, well types, groups, notes — are baked into the saved `.sharp`.

### How to use one

- **Re-open it in SHARP Processor** to pick up exactly where you left off, with all sample names and analysis settings preserved.
- **Plot in Excel / R / Python** — just read `amplification.csv` and `melt_rfu.csv` directly; they're standard wide-format CSVs with a header row. Pair rows with wells using `wells.csv`.
- **Share with a collaborator** — the archive is self-contained. The `SUMMARY.txt` tells them what's inside without needing the app.
- **Diff / version-control** — all three text files (SUMMARY, CSV, JSON) diff cleanly.

### Editing by hand

If you need to rename a sample or fix a content type without opening the app, edit `wells.csv` in Excel and save it back into the ZIP. The app prefers `wells.csv` over `metadata.json` on reload. `SUMMARY.txt` is regenerated every save, so don't bother editing it.

Full format spec: [`docs/SHARP_FORMAT.md`](docs/SHARP_FORMAT.md).

---

## Need Help?

- Open an issue on [GitHub](https://github.com/tomzzzhang/SHARP-Processor-2/issues)
- Check the in-app help: **Help → User Manual**
- Check for updates: **Help → Check for Updates**

---

## Architecture

SHARP Processor 2 is a ground-up rewrite of the [original SHARP Processor](https://github.com/tomzzzhang/SHARP-processor) (Python + PyQt6 + matplotlib). Key improvements:

- **Native desktop performance** — Tauri 2 (Rust) shell with a React frontend, no Python startup delay
- **Interactive charts** — Plotly.js replaces matplotlib for click-to-select, box-select, and drag-to-adjust
- **Multi-experiment tabs** — open several files simultaneously, each with isolated analysis state
- **Modern UI** — resizable panels, three themes (including dark mode), 18 color palettes

Your `.sharp` files from v1 work in v2 without any changes.

### Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2.x (Rust) |
| Frontend | React 19, TypeScript, Vite 8 |
| Styling | Tailwind CSS v4, shadcn/ui |
| Charts | Plotly.js (react-plotly.js) |
| State management | Zustand |
| Instrument parsing | Pure TypeScript (most formats) + Python sidecar (fallback) |

### Instrument File Parsing

Instrument files (`.pcrd`, `.tlpd`, `.eds`, `.amxd`) use proprietary and encrypted formats. SHARP Processor includes a bundled Python sidecar that handles decryption and conversion:

- **BioRad `.pcrd`** — ZipCrypto-encrypted ZIP containing XML fluorescence data
- **TianLong `.tlpd`** — password-protected ZIP with hex-encoded uint16 fluorescence
- **ThermoFisher `.eds`** — ZIP with JSON (modern) or XML (legacy) quantification data
- **Agilent `.amxd`** — double-encrypted PGP TAR archives with binary fluorescence packets

Most formats are parsed in pure TypeScript; the Python sidecar is used as a fallback for formats requiring legacy parser dependencies. All formats are converted into the universal `.sharp` archive format for consistent downstream analysis.

## Development

### Prerequisites

- Node.js 24+
- Rust 1.94+
- **Windows:** VS 2022 Build Tools (C++ desktop workload)
- **macOS:** Xcode Command Line Tools (`xcode-select --install`)
- Python 3.12+ in the `sharp` conda environment (optional — only needed if the pure-TS instrument parsers fall back to the v1 Python sidecar)

### Setup & Run

```bash
npm install

# Windows — double-click dev.bat, or:
set CARGO_TARGET_DIR=C:\tauri-build-cache
npx tauri dev

# macOS
./dev.sh
```

### Build Release Installers

```bash
# Windows — double-click build.bat, or:
set CARGO_TARGET_DIR=C:\tauri-build-cache
npx tauri build --target x86_64-pc-windows-msvc   # 64-bit
npx tauri build --target i686-pc-windows-msvc      # 32-bit

# macOS
./build.sh
```

`build.bat` builds both x64 and x86 installers automatically. Build output goes to:

```
dist-release/
  windows-x64/    # 64-bit NSIS + MSI
  windows-x86/    # 32-bit NSIS + MSI
  macos/          # DMG + .app
```

### Documentation

- [`CLAUDE.md`](CLAUDE.md) — Developer guide, architecture, implementation notes
- [`docs/SHARP_FORMAT.md`](docs/SHARP_FORMAT.md) — `.sharp` file format specification (current: v1.2)
- [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md) — Active vs archived analysis algorithms
- [v1 .pcrd Reverse Engineering](https://github.com/tomzzzhang/SHARP-processor/blob/main/PCRD_FORMAT.md)

---

<p align="center">
  <sub>© 2026 SHARP Diagnostics, Inc. All rights reserved.</sub>
</p>
