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
  &nbsp;&nbsp;
  <a href="https://github.com/tomzzzhang/SHARP-Processor-2/releases/tag/v0.1.13">
    <img src="https://img.shields.io/badge/Roll%20back-v0.1.13-6e7681?style=for-the-badge" alt="Roll back to v0.1.13" />
  </a>
</p>

---

## Download & Install

**The current version is v0.2.4.**

| Version | What it is | Download |
|---|---|---|
| **v0.2.4** (current) | QuantStudio `.eds` support, correct time axis, palette **Apply** | **[Download v0.2.4 →](https://github.com/tomzzzhang/SHARP-Processor-2/releases/tag/v0.2.4)** |
| **v0.2.3** | Kinetics Report residuals, melt-temp on hover, data/fit toggles | **[Download v0.2.3 →](https://github.com/tomzzzhang/SHARP-Processor-2/releases/tag/v0.2.3)** |
| **v0.2.2** | Multichannel support + kinetics report | **[Download v0.2.2 →](https://github.com/tomzzzhang/SHARP-Processor-2/releases/tag/v0.2.2)** |
| **v0.1.13** (previous stable) | Single-channel — roll back here if needed | **[Download v0.1.13 →](https://github.com/tomzzzhang/SHARP-Processor-2/releases/tag/v0.1.13)** |

v0.2.4 builds on v0.2.3 (see *What's New in v0.2.4* below) and is the auto-update "Latest". Windows (x64/x86) and macOS (Apple Silicon) installers are both attached.

**Need to roll back?** [v0.1.13](https://github.com/tomzzzhang/SHARP-Processor-2/releases/tag/v0.1.13) is the previous stable single-channel release. Your `.sharp` / `.sharpx` files open in every version, so switching is safe.

### Windows

1. Click the **Download** button above (or go to the [Releases](https://github.com/tomzzzhang/SHARP-Processor-2/releases/latest) page)
2. Download the installer for your system:
   - **64-bit:** **`SHARP Processor 2_x64-setup.exe`**
   - **32-bit:** **`SHARP Processor 2_x86-setup.exe`**
3. Double-click the installer and follow the prompts
4. Open **SHARP Processor 2** from the Start Menu or desktop shortcut

> **Windows may show a SmartScreen warning** the first time you run the app ("Windows protected your PC"). This is normal for new apps that haven't been code-signed yet. Click **"More info"** → **"Run anyway"** to proceed.

### macOS (Apple Silicon)

1. Download the **`.dmg`** file from the [latest release](https://github.com/tomzzzhang/SHARP-Processor-2/releases/latest) page
2. Open the DMG and drag **SHARP Processor 2** into the **Applications** folder
3. **First launch — bypass the macOS security warning:**
   - Open **System Settings → Privacy & Security**
   - Scroll down to the Security section — you'll see a message saying *"SHARP Processor 2" was blocked from use because it is not from an identified developer*
   - Click **Open Anyway** and confirm
   - Alternatively: right-click the app in Applications → **Open** → click **Open** in the dialog

> macOS builds are ad-hoc signed (not notarized with Apple). After you allow it once via the steps above, subsequent launches work normally. This is standard for open-source Tauri apps distributed outside the Mac App Store.

---

## What's New in v0.2.4

**ThermoFisher QuantStudio (`.eds`) files now open properly.** Previously a QuantStudio run would open but show little or nothing usable. It now loads with the same completeness as a Bio-Rad file.

- **Full QuantStudio support.** Amplification curves, melt curves and melt peaks, the run protocol (cycle count, reaction temperature, melt), and dye-named channels all load. Wells with no sample name are labelled by their plate position rather than left blank.
- **Correct time axis.** The amplification time axis now uses the **timestamps the instrument recorded for each cycle**, instead of assuming an average cycle length. On a typical run this corrects the axis by more than 10 minutes and, with it, every time-based readout (t_LoD, time-to-10%).
- **Only the wells you actually loaded.** QuantStudio marks the entire plate as set up, even when you loaded a handful of wells. The app now detects which wells actually contain reaction mix and switches the rest off, so your plate view shows real wells only. Nothing is discarded — the wells are simply turned off.
- **True amplification signal.** Curves are drawn from the raw dye fluorescence, which is the right signal for dye-based chemistries that don't use a passive reference.

**Colour and grouping fixes** (these apply to every file format):

- **Grouped wells share a colour.** Grouping replicates now actually colours them as one group — on the plot, the plate view, and in the Kinetics Report.
- **The plate view matches the curves.** Well colours on the plate now always match the colours of their curves.
- **Palettes are applied on purpose.** Picking a palette from the dropdown no longer instantly recolours everything. Press the new **Apply** button beside it: the palette is applied to the curves shown at that moment and **stays put** — hiding or showing wells afterwards will not recolour your figure. Press Apply again to re-spread it.

**Kinetics Report**

- **Show hidden.** The report now covers exactly the curves visible in the main window. If you have wells hidden, a **Show hidden** checkbox lets you bring them in for reference — appended at the end so nothing you were reading moves. Hidden wells never influence the run's noise floor, so showing them cannot change any other well's limit of detection.

All existing `.sharp` / `.sharpx` files and instrument formats open exactly as before.

---

## Making Figures with Claude (optional)

`sharpplot.skill` is a [Claude](https://claude.ai) skill that makes figures from your data by asking for them. It's a separate tool — not part of the app, and you don't need it.

1. Download **`sharpplot.skill`** from the [v0.2.4 release](https://github.com/tomzzzhang/SHARP-Processor-2/releases/tag/v0.2.4)
2. Upload it at claude.ai → Settings → Capabilities → Skills
3. Drag a `.sharpx` into a chat and say what you want

> make an amplification plot from this, 3.4 inches wide
>
> now drop the gridlines and move the legend bottom right

You get a vector PDF and a PNG, sized in inches so they go straight into Word without resampling. It does amplification curves, melt curves, melt derivatives, standard curves, and multi-panel figures that can include gel images.

Your `.sharpx` already holds your grouping, colours, hidden wells, baseline and threshold, so the figure comes out looking like what you had on screen — you only say what to change. Raw `.pcrd`, `.tlpd`, `.eds`, `.amxd` and BioRad folders work too.

Nothing to install: no Node, no Chrome, and the app itself doesn't need to be installed. It runs the Processor's own analysis code, so the numbers match the app.

Full documentation: [`docs/SHARPPLOT_MANUAL.md`](docs/SHARPPLOT_MANUAL.md).

---

## What's New in v0.2.3

Refinements to the **Kinetics Report** (Tools → Kinetics Report) and its exported HTML.

- **Residual view.** Click any sample's row to see a **residual strip** below the amplification plot — the difference between the measured data and the fitted model, with a **±1σ noise band** — so you can tell at a glance whether a fit is good (residuals inside the band) or shows lack of fit (structure poking outside). If a curve couldn't be fit confidently — usually because it **never reached a plateau** by the end of the run — the report now says so plainly instead of silently omitting the fit.
- **Melt temperatures on demand.** Instead of crowding every melt temperature onto the plot (where they overlapped into an unreadable smear), **hover a melt curve — or click its sample row — to highlight it and show its Tm** at the peak.
- **Data is the truth.** Amplification plots now draw your **raw data bold and solid**, with the **fitted model as a fainter, thinner overlay** (previously reversed). New checkboxes let you show/hide the **Data** lines, the **Fit** lines, and each kinetic landmark (t_lod / t_onset10 / inflection) independently.
- **Methods documentation.** The in-app **User Manual** gains a **"Methods: Fitting & Statistics"** section documenting exactly how the model is fit, how the noise floor and limit of detection are determined, and how the kinetic readouts and their uncertainties are computed.

All existing `.sharp` / `.sharpx` files and instrument formats open exactly as before.

---

## What's New in v0.2.2

Builds on the v0.2.0 multichannel release with a better automatic baseline and a new per-curve kinetics readout. (Everything below is new since v0.2.0.)

- **Smarter automatic baseline.** Auto baseline now fits each curve and uses the fitted floor as the baseline level — this handles slowly drifting and noisy baselines more reliably than the previous flat-region method, and it is the new default. Curves that can't be fit cleanly (junk wells, no-template controls) fall back to a robust estimate, and the manual baseline options are unchanged.
- **Kinetics Report** (**Tools → Kinetics Report**). A per-curve readout that turns each amplification curve into numbers: time to limit of detection, time to 10% of the fitted height, a doubling-time profile, yield, and melt temperature — each reported with an error estimate. It draws the fitted model on every curve, shows a melt −dF/dT panel, lists everything in a sortable table, and exports **two files at once** — a self-contained, interactive HTML report you can share, and a machine-readable CSV of every parameter with its uncertainty.
- **Kinetic landmarks on the plot.** Turn on markers under **Analysis → Kinetics** to show the limit-of-detection point, the 10% onset, and the inflection point directly on your amplification curves — they carry through into exported figures. New **t_LoD** and **10%** columns appear in the results table.
- **Thresholds are off by default.** Threshold detection now lives under **Analysis → Thresholds** and is off unless you switch it on; the **Tt** column reads "—" until you do.
- **Standard Curve.** The panel and wizard formerly called "Doubling Time" are now called **Standard Curve**. Per-well doubling time is still listed in the results table.
- **Report polish.** The Kinetics Report reuses the curve colors you set in the main app, groups replicates by color, offers a baseline-corrected or raw view, a seconds/minutes time unit, and streamlined per-sample toggles.

---

## What's New in v0.2.0 — Multichannel Support

SHARP Processor 2 now reads **every fluorophore channel** in your experiment, not just one. Open a multi-dye run — FAM + HEX, SYBR + Cal Orange 560, or a full 4-plex — and work with each dye independently. Single-dye runs look and behave exactly as before.

- **Automatic channel detection.** Every instrument format now extracts all of its optical channels. If a file has one dye, nothing changes; if it has several, the extra channels appear automatically.
- **Show or hide each channel.** Toggle fluorophores on the plot — all wells at once, or per individual well.
- **Assign Fluorophores** (**Tools → Assign Fluorophores…**). Give each channel a name and color; the labels flow through the legend, the wells table, and the results.
- **Independent analysis per dye.** Baseline, threshold, normalization, and drift correction are set separately for each channel — pick the channel with **"Settings for: [channel]"** in the Analysis panel. Each dye remembers its own settings.
- **Single-channel view for multi-dye files.** **View → Channel Display → Single** hides the channel controls and shows the familiar one-curve-per-well layout. Switch back to **Multichannel** anytime.
- **Per-channel results.** The results table shows **Tt**, **Tm**, and the positive/negative call for each (well, dye) combination, with collapsible per-sample rows and a **Fluorophore** column.
- **Channel-aware selection.** Click a curve to select that one (well, dye); click a well on the grid to select all of its dyes. A new **"Fluor…"** button in the Wells tab selects every curve of a chosen dye at once.

**Smoother, too.** Plots and interactions — hovering, selecting, dragging the threshold line, toggling channels — are noticeably more responsive in this version.

**Backward compatible.** Single-channel `.sharp` and `.sharpx` files from any earlier version open unchanged.

**[Download v0.2.0 (beta) →](https://github.com/tomzzzhang/SHARP-Processor-2/releases/tag/v0.2.0)**

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
Turn on **Baseline Correction** in the Analysis panel. **Auto baseline** is on by default — the app fits each well's amplification curve and uses the fitted baseline level. This follows the true pre-amplification baseline even through early signal dips (helicase warm-up on SHARP curves) and handles wells that amplify at different times, with no manual tuning. When a curve is too irregular to fit cleanly (for example a noisy non-amplifying control), the app automatically falls back to a robust low-level estimate rather than trusting a bad fit.

Need to override? Turn **Auto baseline** off for a global manual range (Horizontal or Linear fit over a cycle window you choose), or right-click specific wells → **Baseline → Manual** to opt just those wells out of auto while everyone else stays auto. Baseline Start/End inputs are entered in whatever x-axis unit you're viewing (cycle / seconds / minutes); they snap to the nearest cycle on commit.

### Normalize curves
Turn on **Normalize selected** in the Analysis panel to rescale every visible amp curve from 0 → 1 between its baseline and its plateau — a common preparation for visual comparison across plates. Non-amplifying wells (NTCs, failed reactions) are detected by SNR and divided by the median amplifying-well plateau, so they render as a small flat curve near 0 instead of blowing up the shared y-axis. The Melt tab has its own **Normalize** checkbox that does the analogous HRM-style 1 → 0 rescale on melt curves; the −dF/dT derivative is always computed from the raw signal, so peak heights stay physically meaningful.

### Set a detection threshold
Enable the amplification threshold under **Analysis → Thresholds** to see a red dashed line on your plot — drag it up or down to set the level. The app then reports **Tt** (time-to-threshold) and a **positive/negative call** for each well. Thresholds are **off by default**, so the **Tt** column reads "—" until you enable them.

### Read reaction kinetics
Turn on landmarks in **Analysis → Kinetics** to mark **t_lod** (limit of detection), **t_onset10** (time to 10% of the fitted height), and the **inflection** point on the amplification curves — they draw on the displayed curves and carry straight into exported figures, and **t_LoD** / **10%** columns appear in the results table. For the full picture, open **Tools → Kinetics Report**: a per-curve readout with each curve's fitted model, the local doubling-time profile, yield, and melt Tm — each with a standard error. One click exports **two files**: a self-contained, interactive HTML report (sortable, with show/hide toggles and click-to-highlight) to share, and a machine-readable CSV of every parameter and its standard error.

### Build a standard curve
Open **Tools → Standard Curve Wizard** to build a standard curve from a dilution series: define the dilution (unit, top concentration, fold-dilution, number of steps), assign wells to each level on the plate grid, and the app fits Tt vs log₂(concentration) and reports the **doubling time** with confidence intervals and fit statistics. The result appears on the **Standard Curve** plot tab, which prompts you to open the wizard when no series is configured. (Per-well doubling time is also listed in the results table.)

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

**Export Wizard** — A configuration dialog for publication-ready figures. Pick the plot type (amplification, melt, or melt derivative), choose a size preset (single/double column, slide, square, or custom), set DPI and format (PNG/SVG/JPEG), and see a live preview that reflects your Style tab settings at the true target size. Click **Export…** and save.

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
| `Ctrl/⌘+Shift+G` | Ungroup selected wells |

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
