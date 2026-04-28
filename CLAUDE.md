# CLAUDE.md — SHARP Processor 2

**Last Updated:** 2026-04-28 PST — Codex

## Project Overview

SHARP Processor 2 — a modern desktop app for qPCR/isothermal amplification data analysis. This is a ground-up rewrite of the v1 PyQt6+matplotlib app using **Tauri 2 + React + TypeScript + Plotly.js**.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS v4, shadcn/ui, Plotly.js (via react-plotly.js + plotly.js-dist-min)
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
    QuickStylePanel.tsx      # Right-side expandable drawer (120px, full height)
    QuickStylePanel.tsx      # Right-side expandable drawer mirroring context menu items
    XAxisBar.tsx             # X-axis radio (Cycle/Sec/Min) + Log Scale checkbox
    ResultsTable.tsx         # Detection results table (Well/Sample/Content/Tt/Dt/Call/End RFU)
    ui/                      # shadcn/ui components (button, tabs, card, table, checkbox, color-picker)
  hooks/
    useAppState.ts           # Zustand store — all app state + actions
    useAnalysisResults.ts    # Reactive analysis results (memoized per-well)
  lib/
    analysis.ts              # Baseline correction, threshold detection, doubling time fit
    constants.ts             # Colors, palettes, defaults (matching v1 constants.py)
    export.ts                # Plot image export (PNG/SVG/JPEG) + CSV data/results export
    instrument-loader.ts     # Multi-format loader (.pcrd/.tlpd/.eds/.amxd) + BioRad folder
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
| 27 | Auto baseline | **Done** | Per-well flat-region detection via `findFlatBaselineWindow` in `analysis.ts` — noise floor from min 5-point rolling std, two-pointer Welford sweep for longest window with std ≤ 2.5σ, capped to first 70% of curve. Global `baselineAuto` state (default on) in `useAppState`. `WellBaselineOverride` extended with `auto?: boolean` for per-well opt-in/out. `useAnalysisResults` forces horizontal method and overrides start/end when effective auto. Analysis tab: global "Auto baseline" checkbox + tri-state per-well checkbox (uses Base UI `indeterminate` prop). Context menu + QuickStylePanel: new "Baseline" submenu/section with Auto/Manual/Follow-default. PlotArea: baseline zone shading hidden when all visible wells are auto. |
| 28 | Version auto-sync | **Done** | `APP_VERSION` in `src/lib/constants.ts` now reads from a build-time injected `__APP_VERSION__` constant (Vite `define` in `vite.config.ts` reads `package.json` at config-load time). Also fixed `build.sh` to derive `VERSION` from `tauri.conf.json` for the DMG filename. Eliminates two separate single-source-of-truth violations where bumping `package.json` + `tauri.conf.json` + `Cargo.toml` left the UI / mac DMG on the previous version. |
| 29 | Export wizard + export as seen | **Done** | Two export paths under the Export menu. **Export As Seen** (PNG/SVG/JPEG submenu) captures the currently-displayed plot(s) at the on-screen container size and upscales via Plotly's `scale: dpi/96` parameter — fonts, lines, and margins scale in lockstep with the canvas (fixes the tiny-font export bug from pre-multiplying width/height with `scale: 1`). On the amplification tab, amp + melt-derivative mini-plot are stitched top-to-bottom via an offscreen HTML canvas (`exportCompositePlotImage`); SVG composites fall back to the main plot only. **Export Wizard** is a floating modal (same draggable pattern as `DilutionWizard`) that picks plot type (amp/melt/melt-derivative/doubling), size preset + width/height/DPI, and format. Live preview uses a real Plotly instance rendered at the target pixel dimensions and visually scaled via CSS `transform: scale()` to fit the preview pane — true WYSIWYG. Figure building for both preview and export lives in `src/lib/plot-figure.ts` (hook-free trace/layout builders that re-use color mapping, grid style, and legend positioning from the main plot state). Stable DOM `id`s on PlotArea plot containers let Export As Seen find the right div without fragile `querySelector('.js-plotly-plot')`. Extended `MenuBar` with submenu support for the "As Seen →" dropdown. |
| 31 | BioRad folder import + legend polish (v0.1.8) | **Done** | **BioRad CSV folder import** — new `src/lib/parsers/biorad-folder.ts` ports v1's `_parse_biorad` to pure TS. Discovers standard BioRad CFX Manager exports (Amplification / Cq / Run Info / Melt RFU / Derivative / End Point / Melt Peaks / PCREventLogXMLFile.xml), parses them with a quote-aware CSV reader, and builds an `ExperimentData`. Cycle timestamps come from the event-log XML when present, otherwise fall back to ~23s/cycle. Reaction temp + experiment type inferred from the Cq Set Point mode. Wired into MenuBar (File → Open BioRad Folder…), SidebarHome and DataTab buttons, and the drag-and-drop handler. Paths without a known extension fall through to the folder loader, so dragging a BioRad export folder onto the window or clicking a recent-files entry for one works transparently. **Legend group-only mode** — Style tab Legend Content dropdown gains "Group (one entry per group)". Wells sharing a group collapse to one entry labeled with the group name; ungrouped wells still show individually. Implemented via Plotly `legendgroup` + a single rep trace per group (selected wells preferred in visible-only mode). **Hide plot title** — new "Show plot title" checkbox under Typography; when off, all plot titles clear and the top margin collapses. Both options flow through Style presets and the Export Wizard. **Legend spacing fix** — every trace carries a `legendgroup` now, so Plotly's default `tracegroupgap: 10` was inserting a gap between every single entry — legend looked triple-spaced. Set `tracegroupgap: 0` on both on-screen and export legend objects. **Legend reorder** — new `legendOrder: string[]` state storing an ordered list of legend-group keys. Each trace's Plotly `legendrank` is computed from its position in that array (traces not in the list keep the default rank of 1000 and fall to the bottom in natural order). Style tab Legend section grows a drag-and-drop list of the currently-visible entries — native HTML5 `draggable`, no library — plus a "reset" link that clears the order. Changing `legendContent` (sample↔well↔group) clears the order since the keys no longer mean the same thing. |
| 32 | Style UX polish (v0.1.8) | **Done** | **Built-in presets** — Default, Publication, Presentation presets shipped in `style-presets.ts`; Load dropdown shows them with "(built-in)" suffix, cannot be deleted. **Typography toggles** — Title, Labels, Ticks each get a show/hide checkbox to the left of their size input; unchecking hides the element and shrinks the margin. `showLabels`, `showTicks` added to state + presets + export. **Color picker** — new `src/components/ui/color-picker.tsx` with palette-based swatch rows (Basics, SHARP, Tableau, CB Safe, Paired) + custom hex + OK. Uses `createPortal` for fixed positioning. `InlineColorPicker` variant embedded in ContextMenu and QuickStylePanel (replaces native OS color picker). **Arrow-based palette** — "Assign palette by arrow" button in Colors section. Enters a crosshair mode on the amp plot; user draws an arrow, curves intersected are sorted by parameter t along the arrow and assigned palette colors in that order. Non-intersected curves keep current color. Uses segment-segment intersection math via `segmentIntersectT`. Integrated into `useBoxSelect` as a priority mode. **Auto-scaling margins** — `computeMargins(style)` replaces fixed `{l:70, r:20, t:50, b:50}` with formula based on font sizes: `l = 40 + labelSize*1.5 + tickSize*2`, etc. Hidden labels/ticks excluded. **Layout** — QuickStylePanel extends full height (alongside plot + results table), results table width matches plot area. Panel compressed to 120px. |
| 30 | Export wizard polish (v0.1.7) | **Done** | v0.1.6 regression fixes. **Plotly graph div resolution** — `exportPlotImage` and `exportCompositePlotImage` now call `resolvePlotlyDiv` to walk a caller-supplied outer wrapper down to the `.js-plotly-plot` child. The stable-id wrappers added in v0.1.6 were being passed directly to `Plotly.toImage`, which found no internal state (`_fullLayout`) on them and rendered empty figures with default axis ranges. One helper, two call sites, bug fixed for good. **Style presets wired up** — the Save/Load/Reset buttons in Style > Presets were dead placeholders. New `src/lib/style-presets.ts` persists named `StyleSnapshot` objects to `localStorage` under `sharp-processor-style-presets`. Store gains `resetStyle()` + `applyStyleSnapshot()` actions (both undoable via `pushUndo`). `StyleTab.tsx` UI: Save prompts for a name, Load shows a dropdown of saved presets that applies on select, ✕ shows a dropdown to delete, Reset reverts all style fields to defaults. **Legend styling** — bgcolor changed from `rgba(…, 0.8–0.85)` translucent to solid `#ffffff` / `#1f1f1f` + 1px `rgba(…, 0.2–0.25)` border. Applied in both `PlotArea.tsx::legendLayout` and `src/lib/plot-figure.ts` (two occurrences via `replace_all`) so on-screen, Export As Seen, and wizard preview all match. **Mini derivative plot typography** — `MeltDerivMini` layout had hardcoded axis font sizes `9`/`8`; replaced with `style.labelSize` / `style.tickSize` so the Style tab's Typography sliders affect the derivative sub-plot under the amplification chart, not just the main amp plot. In-place patch to v0.1.7 (same tag, binaries re-uploaded via `gh release upload --clobber`). |
| 33 | Deep-debug bug sweep (v0.1.9) | **Done** | Fixes surfaced by a thorough audit of v0.1.6–0.1.8 changes. **Undo infrastructure overhaul** — `UndoEntry` now also carries a reference to the active experiment at snapshot time, so `undo`/`redo` swap `experiments[activeIdx]` back alongside the view-state spread. This finally makes Ctrl+Z work for data mutations (`setWellSampleName`, `setWellSampleNameBatch`, `setWellContentType`) that live inside `ExperimentData.wells` — before this, pushUndo was silently checkpointing view state that had nothing to do with the mutation. Since every such action creates a new exp object via `{ ...exp, wells: newMap }`, restore is an O(1) pointer swap. **Undo stack leak on tab close** — `removeExperiment` now re-indexes `_undoStacks` and `_redoStacks` the same way it re-indexes `_experimentSnapshots` / `sourceFilePaths`, and the "last tab → Welcome" branch resets both undo maps to empty. Previously, closing tab N left stale stacks keyed to old indices, and later-opened experiments would adopt someone else's undo history. **Auto-margins respect `showTicks` on the bottom edge** — `computeMargins` at both `PlotArea.tsx:179` and `plot-figure.ts:211` computed `tickContrib` but only used it on the left margin; the bottom edge was hardcoded `+ style.tickSize * 1.2` regardless. Hiding ticks would shrink the left but leave asymmetric bottom padding. Also fixed the matching `computeMiniMargins` for the derivative sub-plot. **Preset shadowing** — `StyleTab.handleSavePreset` now rejects attempts to save a user preset under a built-in name ("Default" / "Publication" / "Presentation") before reaching localStorage. Previously the write succeeded but `getStylePreset` read built-in first, so user saves were silently shadowed. **`setLegendContent` undo entry** — clearing `legendOrder` when switching sample↔well↔group mode is intentional (keys change meaning), but pushUndo was missing so the cleared order couldn't be recovered. Now pushes `'Change legend content'`. **BioRad parser polish** — empty content cells preserved instead of downgraded to `'Unkn'` (`''` added to `contentMap`; content key trimmed); NaN cells still default to 0 but now emit a single `console.warn` per CSV with the count, making silent data corruption diagnosable. **Undo coverage** — nine previously-non-undoable discrete toggles/selects gained `pushUndo` entries: `setFontFamily`, `setShowLegendAmp/Melt/Doubling`, `setLegendPosition`, `setLegendVisibleOnly`, `setSelectionPaletteGroupColors`, `setShowGrid`, `setPlotBgColor`. Number inputs (sizes, DPI, gridAlpha, lineWidth) intentionally excluded to avoid flooding the stack per keystroke. **Escape key handlers** — `ColorPicker` popover and arrow-palette mode both close on Escape. |
| 37 | .sharp format 1.1 — human-readable layer (v0.1.11) | **Done** | Added two spreadsheet-friendly / text-friendly siblings to `metadata.json` inside the .sharp ZIP: **`wells.csv`** — flat well manifest (`well, sample, content, cq, end_rfu, melt_temp_c, melt_peak_height`), proper CSV quoting for commas/quotes in sample names; and **`SUMMARY.txt`** — human prose overview (experiment ID, operator, notes, run start, instrument, protocol, plate + well count, file listing). Both written by `buildSharpZip` in [`src/lib/export.ts`](src/lib/export.ts). `metadata.json` stays authoritative and unchanged in shape — the CSV is a view, not a replacement. Reader in [`src/lib/sharp-loader.ts`](src/lib/sharp-loader.ts) gains `parseWellsCsv` (quote-aware CSV row parser handles escaped `","` and `""`); when both the CSV and `metadata.wells` are present, CSV wins for user-editable string fields (sample, content) and non-null numeric fields, with `metadata.json` as fallback. `format_version` bumped to `"1.1"`; 1.0 readers continue to work (new files ignored; JSON unchanged). In-repo spec at [`docs/SHARP_FORMAT.md`](docs/SHARP_FORMAT.md). Motivation: per-well sample info was only reachable by reading JSON; path to "I want to eyeball the experiment in Excel" now exists without going through the app. |
| 36 | Melt threshold drag on y2 + Clear colors button (v0.1.10) | **Done** | **Melt threshold drag in full melt view** — after the melt-plot axis split, the threshold line sits on `yaxis2` (derivative subplot) but `useBoxSelect.isNearMeltThreshold` was still hit-testing against `yaxis` (RFU axis on top). Added `axis?: 'y' \| 'y2'` to the hook's `meltThreshold` option; hit-test reads `_fullLayout.yaxis2.d2p` and the drag-move handler picks `pixelToY2Value` when `axis === 'y2'`. `MeltPlot`'s `useBoxSelect` call now wires the threshold (previously un-wired entirely — only `MeltDerivMini` had it) with `axis: 'y2'`. `MeltDerivMini` keeps the default `axis: 'y'`. **Clear custom colors** — new button in Style → Colors & Lines (below "Assign palette by arrow"). Wires new `clearAllColorOverrides` store action that walks `wellStyleOverrides` and drops only the `color` field, preserving any per-well `lineWidth` / `lineStyle`. No selection required — a global one-click reset. Button disables when no well has a custom color; skips the undo push if nothing to clear. |
| 35 | Melt derivative — BioRad algorithm port + cleanup (v0.1.10) | **Done** | Reverse-engineered from `BioRad.PCR.Analysis.dll` + `BioRad.Math.dll` (CFX Maestro, installed at `C:\Program Files (x86)\Bio-Rad\CFX\`, decompiled with `ilspycmd`). Ported to `src/lib/parsers/utils.ts::computeMeltDerivative`. Full pipeline: (1) two passes of 5-point centered moving average on raw RFU; (2) linear extrapolation of the first 5 points from the line through [5,6]; (3) SavGol 1st-derivative with polynomial order 4, width 5, signal padded by replicating first/last value before SavGol so edges get real SavGol outputs (matches BioRad's `FilterSavitskyGolay.CreatePaddedVector`). For width=5/poly=4 the SavGol fit is exact, collapsing the interior coefficients to the classical 4th-order central difference `[1,-8,0,8,-1]/12h`; (4) divide by fixed ΔT = (Tmax-Tmin)/(N-1); (5) linear extrapolation of the first 2 derivative points (matches `FixStartingPoints(_, 2)`); (6) negate for -dF/dT convention. Key insight: BioRad does NOT naive-central-difference then smooth — it smooths the RFU then uses SavGol to compute the derivative analytically from a polynomial fit, which is implicitly smooth. Our previous approach (central difference → optional post-smooth) amplified noise before filtering. On the test .pcrd file, B1's raw-central-diff showed a double peak (353 at 84.4°C, dip to 180 at 85.86°C, 391 at 86.86°C); the BioRad port gives a single clean peak of 281 at 85.37°C, matching CFX Maestro's display. **Cleanup** — with the parser producing already-smooth derivatives, all post-smoothing code paths were removed from the live app: `smoothingMeltDerivative` state field, `setSmoothingMeltDerivative` action, "Smooth melt -dF/dT" Analysis-tab checkbox, and the four `savitzkyGolaySmooth(melt.derivative[well], …)` call sites in `PlotArea.tsx` (x2), `ResultsTable.tsx`, `plot-figure.ts`. `BuildFigureInput` no longer carries `smoothingMeltDerivative`. Retired-code patterns preserved in new `src/lib/_archive.ts` museum (old central-diff derivative + the post-smoothing pattern) with a dated banner. Master index of active vs archived algorithms lives in new `docs/ALGORITHMS.md`. Split melt-plot xaxis into `xaxis` (top, ticks hidden) + `xaxis2` (bottom, `matches: 'x'`, carries Temperature label) so the derivative subplot gets its x-axis labels back — applied to both on-screen and export figures. Melt threshold default flipped `true → false` in the same pass so real peaks aren't silently dimmed by the 400-unit threshold. Amp smoothing remains available via the existing `smoothingEnabled` checkbox, now in the "Amp smoothing" sidebar section (renamed from "Smoothing"). |
| 34 | Text color + batch rename + table polish (v0.1.9) | **Done** | **Text color override** — new `textColor: 'auto' \| 'black' \| 'white'` in per-experiment view state (default `'auto'` preserves theme-driven behavior). 3-button segmented control under Style → Typography. Applied uniformly: `plotFontColor(isDark, textColor)` now checks the override first and only falls back to theme-based color for `'auto'`. Wired in `usePlotTheme()` which returns `{ plotBg, isDark, textColor }`, consumed at all 6 plot-font-color call sites in `PlotArea.tsx` (amp, melt, melt standalone, doubling, mini-deriv) and all 3 in `plot-figure.ts` for exports. Included in `StyleSnapshot`, `BUILTIN_PRESETS`, `resetStyle`, and the ExportWizard style memo. Motivation: when users set a dark plot background, the default theme text color became invisible; now explicit black/white forces readable text regardless of bg. **Batch sample rename** — new `setWellSampleNameBatch(wells: string[], name: string)` action with a single pushUndo entry (`'Rename N samples'`). In `WellList`, when the sample cell of a well in a multi-selection is edited, all selected wells get the new name on Enter/blur; solo edits still go through `setWellSampleName` as before. **Selection preserves on click** — `useDragSelect.onUp` now only calls `selectOnly` when clicking an **unselected** well. Clicking an already-selected well is a no-op (preserves the multi-selection so sample-cell edits can act on all selected wells). Ctrl/Cmd+click still toggles, Shift+click still ranges. **Well list selection visual** — selected rows get `bg-primary/10` (subtle red tint) + persistent 3px red left-bar via boxShadow + `font-medium`. Hover overlays a red 18% tint via a second boxShadow layer, so a selected-and-hovered row reads as "extra selected". Replaces the near-invisible `bg-accent/50` that was being visually dominated by the hover cue. **Plate view: dim unselected** — when `selectedWells.size > 0 && size < usedWells.length` (partial selection), unselected populated wells drop to `opacity: 0.55`; full/empty selection leaves everything at normal opacity. Drag-preview dimming still takes precedence over selection dimming. **Plate view: extended drag zone** — grid is wrapped in a `p-4 -m-4 mb-0` drag-target div. Mouse handlers moved to the wrapper; `gridRef` and `pixelToRowCol` unchanged (still measure the inner grid). Negative margin compensates the padding on three sides so cells don't shift; `mb-0` overrides `-mb-4` so the bottom retains 16px of visible spacing. User can now start drag-selects up to 16px outside the plate on every edge. |

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
| `metadata.json` | Yes | Authoritative machine-readable metadata. Format version, instrument, protocol, run info, per-well sample + analysis outputs, data summary, plate layout, time reconstruction. |
| `amplification.csv` | Yes | Wide format: `cycle, time_s, time_min, A1, B1, ...` (RFU) |
| `melt_rfu.csv` | No | Wide format: `temperature_C, A1, B1, ...` |
| `melt_derivative.csv` | No | Wide format: `temperature_C, A1, B1, ...` (-dF/dT) |
| `wells.csv` | 1.1+ | Flat well manifest — `well, sample, content, cq, end_rfu, melt_temp_c, melt_peak_height`. Spreadsheet-friendly view of what's also in `metadata.json > wells`. CSV-quoted for commas/quotes in sample names. Preferred for user-editable fields on read; `metadata.json` still authoritative for structure. |
| `SUMMARY.txt` | 1.1+ | Plain-text human overview of the experiment. Regenerated on every write. Not read by the app. |
| `parsing_log.json` | No | Append-only parse history |

**metadata.json key sections:** `format_version` (currently "1.1"), `instrument` (manufacturer, model, serial), `run_info` (operator, notes, timestamps), `protocol` (type, temp, cycles, melt config), `wells` (per-well: sample, content, Cq, melt peaks), `data_summary` (wells_used, cycle count), `plate_layout` (rows, cols — added by v2), `time_reconstruction` (source, cycle duration stats). Full spec at [docs/SHARP_FORMAT.md](docs/SHARP_FORMAT.md).

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
