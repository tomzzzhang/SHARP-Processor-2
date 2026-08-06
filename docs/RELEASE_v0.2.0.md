# SHARP Processor 2 — v0.2.0 (Multichannel) — Dev Documentation

**Last Updated:** 2026-08-06 13:56 EDT
**Version:** 0.1.13 → **0.2.0** (minor bump — major feature: multichannel / multi-fluorophore support)
**Branch:** `feature/multichannel-support`
**Status:** Implemented + typecheck/regression green + parser-level validation on real files. **NOT yet committed, tagged, or released.** Awaiting live-UI sign-off in a dev/installer build. A preliminary bug-sweep of the diff has been done — **2 High + 2 Medium issues fixed (§12)**; Low/defensive items and a pre-existing eslint-debt note are logged in **§13** for the next session.
**Plan of record:** `~/.claude/plans/eager-wondering-pearl.md` (the 11-phase plan this implements).

> This is the **internal** engineering record for the 0.2.0 multichannel work — full
> detail (file paths, functions, formats, reverse-engineering). A user-facing release
> note (plain language, no internals) is a separate artifact to write at tag time.

---

## 1. Headline

Before 0.2.0 every well had exactly one fluorescence curve; each parser saw multiple
optical channels and discarded all but one. 0.2.0 makes the whole app multi-channel:
extract **all** fluorophore channels, let the user enable/disable each (globally and
per sample), analyze **per channel**, and persist channels in `.sharp`/`.sharpx`.
Single-channel files behave exactly as before (the channel UI stays hidden at ≤1
channel).

All five instrument formats now emit channels: BioRad `.pcrd`, BioRad CFX folder,
QuantStudio `.eds`, Agilent `.amxd`, TianLong `.tlpd`.

---

## 2. Version bump (single source of truth = 5 files)

| File | Field |
|------|-------|
| `package.json` | `"version": "0.2.0"` |
| `package-lock.json` | root + `packages[""]` entry |
| `src-tauri/tauri.conf.json` | `"version": "0.2.0"` |
| `src-tauri/Cargo.toml` | `version = "0.2.0"` |
| `src-tauri/Cargo.lock` | `[[package]] name = "app"` pin |

UI label auto-syncs: `APP_VERSION` in `src/lib/constants.ts` reads the Vite-injected
`__APP_VERSION__` (defined in `vite.config.ts` from `package.json`). `build.sh` derives
the macOS DMG filename from `tauri.conf.json`. So no other file needs the version.

---

## 3. Architecture — the channel data model

### Data model (`src/types/experiment.ts`)
`ExperimentData` is now channel-major with derived active pointers:
```ts
channels: string[];                                  // canonical IDs, display order; ['default'] when single
channelFluorophore?: Record<string, string>;         // parser-detected dye per channel (FAM/VIC/…)
amplificationByChannel: Record<string, AmplificationData | null>;
meltByChannel: Record<string, MeltData | null>;
amplification: AmplificationData | null;             // DERIVED → active channel (live pointer)
melt: MeltData | null;                                // DERIVED → active channel
```
`amplification`/`melt` stay as live pointers the store re-points on channel switch, so
channel-agnostic code keeps reading them.

**Canonical channel ID convention:** the dye name when the file provides one (`FAM`,
`SYBR`, `HEX`, `Cal Orange 560`…), else `Channel 1`/`Channel 2`, else `'default'`.

**Backward-compat shim** `normalizeExperiment(data)` (`src/lib/parsers/utils.ts`, called
at the top of `loadExperiment`): if a value lacks the channel fields (old `.sharp`,
old `.sharpx`, any pre-channel path), it synthesizes a single `'default'` channel from
the legacy `amplification`/`melt`.

### State (`src/hooks/useAppState.ts`)
- **`ChannelAnalysisState`** — the per-channel analysis subset (baseline*/threshold*/
  normalize/drift/melt*/smoothing*/fitting* + the `wellBaselineOverrides` /
  `wellNormalizeOverrides` Maps). Mirrored onto the top-level store for the **active**
  channel; the full set per channel lives in `_channelSnapshots`.
- **`ExperimentViewState`** — shared per experiment: selection sets, `wellStyleOverrides`,
  `wellGroups`, `legendWells`, all style fields, x-axis/log/plotTab, dilution, plus the
  channel-display fields: `activeChannel`, `visibleChannels: Set<string>`,
  `wellChannelHidden: Map<well, Set<channel>>`, `channelLabels: Map<channel,string>`,
  `channelColors: Map<channel,string>`.
- **`_channelSnapshots: Map<expIdx, Map<channel, ChannelAnalysisState>>`** — per-experiment,
  per-channel storage. Flushed/restored alongside `_experimentSnapshots` in
  `loadExperiment` / `switchExperiment` / `removeExperiment` / `addEmptyTab` via the
  `flushChannel(state)` helper.
- **Actions:** `setActiveChannel` (flush current channel → restore target → re-point
  derived pointers via `withActiveChannel`; **not undoable**, mirrors `switchExperiment`),
  `toggleChannelGlobal` (undoable), `toggleWellChannel(wells, channel)` (undoable,
  selection-aware — caller passes the expanded selection; flips relative to `wells[0]`
  then applies uniformly), `setChannelMeta(labels, colors)` (undoable; the wizard's commit).
- **Undo/redo:** each `UndoEntry` carries the active experiment's **full** channel map
  (`channelSnapshot`), so undo after a channel switch restores every channel rather than
  corrupting an inactive one. `undo`/`redo` restore the map + the active channel's
  per-channel top-level fields + the experiment's derived pointers.
- **Effective trace visibility** predicate:
  `!hiddenWells.has(well) && visibleChannels.has(channel) && !(wellChannelHidden.get(well)?.has(channel))`.

### Channel-label/colour helper (`src/lib/channels.ts`, NEW)
- `effectiveChannelLabel(ch, channelLabels, channelFluorophore)` = `labels[ch] ?? fluorophore[ch] ?? ch`.
- `effectiveChannelColor(ch, channelColors, channelLabels, channelFluorophore)` = user
  override → dye default (`fluorophoreColor`) .
- `isSingleDefaultChannel(channels)` — true when the lone channel is `'default'` (used to
  suppress the `| fluorophore` hover suffix so single-channel hover looks like before).

### Constants (`src/lib/constants.ts`)
- `FLUOROPHORE_COLORS` — default colour per dye family (FAM/SYBR green, HEX/VIC
  yellow-green, ROX/ABY/Texas Red red, Cy5/JUN purple, Cy5.5 deep red).
- `COMMON_FLUOROPHORES` — dropdown list for the wizard.
- `CHANNEL_DASH = ['solid','dash','dot','dashdot','longdash','longdashdot']` — channel→dash
  (index 0 = solid, so one visible channel renders identically to before).
- `fluorophoreColor(label)` helper.

### Analysis hook (`src/hooks/useAnalysisResults.ts`)
- `computeChannelResults(amp, wellsUsed, xAxisMode, channelState, driftSlope)` — pure,
  extracted from the old hook body. Adds a resolved **`displayRfu`** per well
  (normalized → corrected → raw, based on that channel's settings) so rendering picks the
  right curve per channel without re-deriving settings. `WellAnalysisResult.displayRfu`
  added in `src/lib/analysis.ts`.
- `useAnalysisResults()` returns the **active** channel's map (drives Analysis-tab
  readouts, threshold line, drift, doubling, results in single-channel mode).
- `useAllChannelResults()` returns `Map<channel, Map<well, WellAnalysisResult>>` — every
  channel with its own `ChannelAnalysisState` (active channel from live top-level fields,
  others from `_channelSnapshots`) and its own `computeDriftSlope`. Drives the multichannel
  plot + results table.

---

## 4. Rendering (`src/components/PlotArea.tsx`)

One trace path; single-channel is the degenerate case.
- Build the visible channel list = `exp.channels ∩ visibleChannels`. `multiChannel = >1`.
- A `renderedPairs: {well, channel}[]` list is computed in render order (skipping
  `wellChannelHidden`); **`curveNumber → (well, channel)` resolution uses this list**
  (replaces the old modulo math, which broke with per-well channel skips).
- Trace loop: `for channel → for well`. `line.color = colorMap.get(well)` (well→hue,
  unchanged), `line.dash = multiChannel ? CHANNEL_DASH[channelIndex] : perWellLineStyle`.
  y = `allChannelResults.get(ch).get(well).displayRfu ?? rawWells[well]`.
- **Legend:** one well/sample/group entry per well, emitted only in the **first** channel
  block (`ci===0`); plus a neutral **per-channel legend block** (`legendgroup: 'chan:'+ch`,
  `legendrank: 9000+i`) shown when `multiChannel`.
- **Hover popup:** `hoverinfo:'text'` + `hovertext = "{sampleLabel} | {fluorophore}"`
  (suffix omitted for a single `default` channel → identical to before).
- Amp raw-overlay only in the single-visible-channel case (keeps the trace count regular).
- Box-select / click / hover / `useLegendHover` all resolve through `renderedPairs` (or a
  `resolveWell(curveNumber)` ref). `useLegendHover` was generalised to take a resolver.
- **Melt plot:** RFU block (yaxis `y`) then derivative block (`x2`/`y2`), parallel
  `(well,channel)` order; `resolveWell` handles both blocks (`cn < L` RFU, `cn < 2L`
  deriv, else channel-legend marker → null). Per-channel HRM normalize via
  `meltRfuByChannel`. **Melt derivative stays raw** (peak height = raw rate).
- **MeltDerivMini:** same `(well,channel)` loop; threshold dimming keyed by `${ch} ${well}`.

### UI controls
- **`PlotTabs.tsx`** — per-channel checkboxes (colour + dash swatch) shown only on amp/melt
  tabs when `channels.length > 1`, bound to `visibleChannels` / `toggleChannelGlobal`.
- **`AnalysisTab.tsx`** — "Settings for: [channel ▾]" `<select>` (bound `activeChannel` /
  `setActiveChannel`), shown only when `channels.length > 1`. Rest of the tab edits the
  active channel via the mirrored top-level fields.
- **`WellList.tsx`** — per-well channel chips (colour + dash-styled border; greyed when
  globally off, dimmed when per-well hidden). Click → `toggleWellChannel(targetWells, ch)`
  (selection-aware: all selected wells when the row is in a multi-selection).
- **`ResultsTable.tsx`** — when `>1` channel visible, renders **one row per (well, channel)**
  with a **Fluorophore** column; single-channel keeps the original one-row-per-well table.
  *(Deviation from plan: flat per-channel rows, not a collapsible parent/child tree — same
  information, lower risk. See §8.)*
- **`FluorophoreWizard.tsx` (NEW)** — Tools → "Assign Fluorophores…". Draggable modal,
  per-channel dye `<datalist>` + hex colour input, seeded from effective values; OK commits
  `setChannelMeta` (one undoable action). Disabled at ≤1 channel. Wired in `App.tsx`
  (`showFluorophoreWizard`) + `MenuBar.tsx` Tools menu. *(Wells-tab button from the plan was
  skipped — Tools menu is the single entry point.)*

---

## 5. Parsers — per-format channel layout

All route through the extended `buildExperimentData` funnel (`src/lib/parsers/utils.ts`),
which accepts channel-keyed maps (`channels`, `amplificationByChannel`, `meltByChannel`,
`channelFluorophore`) and derives the active channel = `channels[0]`. A single-channel
convenience path (`amplification`/`melt`) is preserved for back-compat.

### BioRad `.pcrd` (`src/lib/parsers/pcrd.ts`)
- `extractAllChannels(plateRead)` reads all **6 PAr optical channels** per plate read.
  PAr layout: 2592 floats = 108 wells × 4 stats × 6 channels; index `c*432 + w*4 + stat`
  (stat 0 = mean); wells 0–95 = data.
- `parseDyeLayers(doc)` reads the authoritative channel→dye map from
  `<plateSetup2><dyeLayersList><dyeLayer><fluor channelPosition="N" fluorName="FAM" .../>`.
  `channelPosition` = PAr channel index; `fluorName` = dye = canonical channel ID.
- A channel is emitted only if it carries real signal (unused channels are exactly 0).
  Assigned dye layers are authoritative; else `Channel N`. Melt derivative computed per
  channel. Single-dye → one channel (e.g. SYBR), UI hidden.

### TianLong `.tlpd` (`src/lib/parsers/tlpd.ts`)  ← NEW in 0.2.0 (was deferred)
- Each AmpData/MeltData cycle blob holds a fixed **6 optical-channel slots**. Well `w` of
  channel-slot `c` is at uint16 index `c*stride + w`, `stride = floor(uint16Count / 6)`
  (≈97 = 96 well slots + 1 trailer; `TL_MAX_CHANNELS = 6`).
- Channel→dye map = `run_method`'s **`[DyeInfo]`**: `Dye\N\Name`, `Dye\N\Enable`,
  `Dye\size`. The i-th enabled dye occupies channel slot `i-1` (DyeInfo order = slot order).
- `parseDyeInfo`, `parseAmpDataChannels`, `parseMeltDataChannels` added. ≥2 enabled dyes →
  channel funnel; single-dye → the unchanged single-channel path. `stride < wellCount`
  guard falls back to single-channel.

### QuantStudio `.eds` (`src/lib/parsers/eds.ts`)
- **Legacy:** dropped `_M1_`-only; `resolveLegacyFilters` builds the dye→channel map from
  the file — `plate_setup.ini [dye]` (dye list + passive ref), `calibrations/puredye.ini`
  (each dye's strongest matched filter `x{i}-m{i}`). One channel per non-reference dye
  whose matched `_M{i}_X{i}_` quant files carry data; amp + melt per filter. Fallback name
  `m{i}-x{i}`.
- **Modern:** iterate all `reactionResults` per well (was `[0]`); channel from each
  reaction's dye/reporter/target.

### Agilent `.amxd` (`src/lib/parsers/amxd.ts`)
- Dropped `pickPrimaryChannel`; emits every populated channel named from the parsed
  `<Dye>` `channelNames`, excluding the ROX passive reference when reporters exist.

### BioRad CFX folder (`src/lib/parsers/biorad-folder.ts`)
- Discovery groups per-fluor CSV variants (`Quantification Amplification Results_<Fluor>.csv`
  + matching melt RFU/derivative/end-point); one channel per fluor (ID = fluor). Shared
  files (Cq, run info, melt peaks, event log) stay single.
- **Bug fix (real):** `cq_results` (and optional `melt_peaks`) regex required literal
  `Results.csv`, but real CFX exports name them `...Results_0.csv` — relaxed to tolerate an
  optional `_<suffix>`. Without this, NO real folder loaded.

### TianLong note
`.tlpd` multiplex is now done (was the one deferred parser). No remaining deferred parser.

---

## 6. Persistence (format 1.2)

`buildSharpZip` (`src/lib/export.ts`):
- `metadata.channels: string[]` + `metadata.channel_fluorophore: Record<channel,dye>` added.
- `format_version` → **`1.2`** for multichannel; stays `1.1` for single-channel.
- Multichannel also writes **index-keyed** per-channel CSVs: `amplification_ch{i}.csv`,
  `melt_rfu_ch{i}.csv`, `melt_derivative_ch{i}.csv` (index `i` → `metadata.channels`). Index
  keys avoid filename-sanitization issues for dye names with spaces/dots ("Cal Orange 560").
- The legacy `amplification.csv` / `melt_*.csv` still carry the **first** channel, so 1.0/1.1
  readers load that one. Defensive against a missing `exp.channels` (the codex test fixture).

Reader `loadSharpFile` (`src/lib/sharp-loader.ts`): when `metadata.channels.length > 1` and
the per-channel files exist, rebuild `amplificationByChannel`/`meltByChannel`; else fall back
to a single channel. `.sharpx` session serializer (`useAppState.ts`) carries
`channelSnapshots` + `visibleChannels` + `wellChannelHidden` + `channelLabels`/`channelColors`;
pre-channel sessions fold their top-level analysis settings into the default channel.

Full format spec: `docs/SHARP_FORMAT.md` (§ "Multichannel (format 1.2)").

---

## 7. Verification record

- `npx tsc -b` clean; `npx eslint` clean on all changed files (repo has pre-existing lint
  debt in untouched code — not introduced here).
- `node scripts/codex-regression-tests.cjs` → **12/12** throughout.
- **Phase-2 store harness** (throwaway, removed): channel-switch isolation, cross-channel
  undo/redo not corrupting inactive channel, `.sharpx` round-trip, single-channel parity,
  legacy-session fold-in — 8/8.
- **Parser validation on REAL files** (throwaway harnesses, removed):
  - `4Plex_Multiplex_MMx_10uL.eds` → **[FAM, VIC, ABY, JUN]**; single-dye EDS → [SYBR].
  - `a private multichannel fixture` → **[FAM, HEX]**, 9 wells, 40 amp cycles + 77-pt melt/channel.
  - `a private multichannel fixture` (real multi-fluor BioRad) → **[SYBR, Cal Orange 560]**.
  - BioRad CFX folder (agent) → 2 channels; single-dye `.pcrd`/folder → 1, byte-identical.
  - Multichannel `.sharp` round-trip (export → reload) → channels + per-channel data preserved.
- **NOT yet done:** live-UI exercise in a Tauri dev/installer build (the one thing only a
  human can do here). See §9 checklist.

---

## 8. Sample data fixtures

Convention: keep all sample fixtures in
`…/OneDrive - SHARP Diagnostics/SHARP data processor/SHARP Processor 2/Sample data/`.
Currently:
- `a private multichannel fixture` — TianLong multiplex (FAM + HEX).
- `a private multichannel fixture` — BioRad multiplex (SYBR + Cal Orange 560).

The confirmed 4-plex EDS fixture lives at
`C:/QuantStudio Design & Analysis Software/examples/4Plex_Multiplex_MMx_10uL.eds`.

---

## 9. Known limitations / deferred work (resume here)

1. **Export Wizard standalone figure is active-channel-only (Phase 9 — NOT done).**
   `src/lib/plot-figure.ts` (`buildFigure`/`buildAmp`/`buildMelt`, `BuildFigureInput`) was
   not threaded with channels, so the **Export Wizard** renders only the active channel.
   **"Export As Seen" already exports the live multichannel plot** (it screenshots the real
   chart), so the common export path works. To finish: add `channels`/`visibleChannels`/
   `wellChannelHidden`/`allChannelResults` to `BuildFigureInput`; mirror PlotArea's
   `(well,channel)` loop + channel-dash + per-channel legend in `buildAmp`/`buildMelt`; pass
   the channel state from the store in `ExportWizard.tsx`. Reference implementation =
   `PlotArea.tsx` amp/melt trace builders.
2. **Hover emphasis is whole-well, not per-(well,channel).** The plan wanted hovering a
   single sample-channel curve to emphasise only that curve (extend transient state with
   `hoveredChannel`). Current behaviour: hovering highlights all of that well's channels.
   The hover *popup* is already per-channel (`sample | fluorophore`). To finish: add
   `hoveredChannel` to the store, set it from the plot hover via `renderedPairs`, and gate
   the per-trace width boost on `(well,channel)` match.
3. **ResultsTable is flat per-(well,channel) rows, not a collapsible tree.** Plan wanted a
   parent sample row + expandable per-channel child rows. Current: flat rows + Fluorophore
   column. Same data; revisit if a tree is desired.
4. **Per-channel results not cached into the saved file** (`wellResultsByChannel`) — outputs
   are derived live on load; intentionally deferred.

---

## 10. How to resume / release steps

1. **Build + live test (human):** `build.bat` (Win) / `./build.sh` (mac), then open both
   Sample-data fixtures and run the §"Testing checklist" below.
2. **Commit** the version bump + multichannel work (branch `feature/multichannel-support`).
   Note 2 new untracked files: `src/lib/channels.ts`, `src/components/FluorophoreWizard.tsx`.
3. **Merge / tag `v0.2.0`** and write the public release note (plain language, no internals)
   only after installer sign-off (per the release-verification rule from the v0.1.6 incident).
4. **Optional follow-ups:** Phase 9 (Export Wizard multichannel), per-channel hover emphasis,
   collapsible results tree.

### Testing checklist (live UI)
- **Single-channel regression:** open a single-dye `.pcrd` → no channel checkboxes, no
  "Settings for" dropdown, no Fluorophore column, hover = sample only; undo/redo works;
  old `.sharp`/`.sharpx` open unchanged.
- **`a private multichannel fixture`** → FAM + HEX checkboxes; amp overlays FAM solid / HEX dashed;
  per-channel legend block; un-check HEX → its curves vanish; melt tab overlays both on RFU +
  derivative.
- **`a private multichannel fixture`** → SYBR + "Cal Orange 560" (the latter defaults to
  grey — not in the dye colour table; recolor via the wizard).
- **AnalysisTab "Settings for"** → change baseline/threshold on HEX, switch to FAM, switch
  back → each channel keeps its own settings.
- **WellList chips** → click a chip to hide a channel for a well; multi-select + click → all.
- **ResultsTable** → one row per (well, channel) with Fluorophore column.
- **Tools → Assign Fluorophores…** → rename/recolor → propagates to legend/chips/results;
  undoable; survives `.sharpx` round-trip.
- **Persistence** → save `.tlpd` as `.sharp` → reopen (FAM/HEX restore); save `.sharpx` →
  reopen (per-channel settings + channel visibility restore).

---

## 11. File-by-file change map (0.2.0)

**New:** `src/lib/channels.ts`, `src/components/FluorophoreWizard.tsx`, `docs/RELEASE_v0.2.0.md`.

**Data/state:** `src/types/experiment.ts` (channel fields), `src/hooks/useAppState.ts`
(`ChannelAnalysisState`, `_channelSnapshots`, channel actions, undo map, session serializer,
wizard flag), `src/hooks/useAnalysisResults.ts` (`computeChannelResults` + `useAllChannelResults`),
`src/lib/analysis.ts` (`displayRfu`).

**Parsers/funnel:** `src/lib/parsers/utils.ts` (`buildExperimentData` channel maps +
`normalizeExperiment`), `pcrd.ts`, `tlpd.ts`, `eds.ts`, `amxd.ts`, `biorad-folder.ts`.

**Rendering/UI:** `src/components/PlotArea.tsx` (the big one — amp/melt/deriv `(well,channel)`),
`PlotTabs.tsx`, `sidebar/AnalysisTab.tsx`, `WellList.tsx`, `ResultsTable.tsx`, `App.tsx`,
`MenuBar.tsx`, `src/lib/constants.ts`.

**Persistence:** `src/lib/export.ts`, `src/lib/sharp-loader.ts`.

**Version:** `package.json`, `package-lock.json`, `src-tauri/{tauri.conf.json,Cargo.toml,Cargo.lock}`.

**Docs:** `CLAUDE.md` (row 42 + TianLong format section), `AGENTS.md`, `docs/ALGORITHMS.md`,
`docs/SHARP_FORMAT.md` (format 1.2), `CLAUDE.local.md`, plus OneDrive `STATUS.md` / `DEV_NOTES.md`.

---

## 12. Post-review bug-fix pass (2026-05-29, Claude)

A preliminary bug sweep of the 0.2.0 multichannel diff (before the human live-UI
verification) surfaced several issues. The **two High and two Medium were fixed**; the
Low/defensive/cosmetic items are logged in §13 for a later pass. All four fixes are
contained, **preserve single-channel behavior**, and are verified green (`tsc -b` clean,
codex regression 12/12). All changes are in the same uncommitted working tree as the rest
of 0.2.0.

### Fixes applied

**[High] 1 — single-channel hover regression** · `src/components/PlotArea.tsx:704` (+ import, line 8)
- *Symptom:* every single-dye file (its lone channel is named e.g. `SYBR` / `Channel 1`,
  **not** `default`) showed a `sample | <dye>` hover suffix on the amp plot, where pre-0.2.0
  it showed `sample` only. `isSingleDefaultChannel(['SYBR'])` is `false`, so the suffix gate
  was wrong. Also inconsistent with the melt/derivative plots (still `hoverinfo:'name'`), and
  a save→reload (which rewrites the lone channel to `default`) flipped hover on the *same* file.
- *Fix:* `const showFluor = multiChannel;` (was `!isSingleDefaultChannel(exp.channels)`). The
  suffix now shows only when ≥2 channels overlay — exactly when disambiguation is needed, and
  consistent with the channel-dash gate just below it. Removed the now-unused
  `isSingleDefaultChannel` import (still exported from `channels.ts`).
- *Safety:* a true multi-channel overlay still shows `sample | dye`; narrowing to one visible
  channel correctly drops the suffix.

**[High] 2 — melt-derivative wrong-well selection** · `src/components/PlotArea.tsx:1471–1476, 1492`
- *Symptom:* the melt **derivative** trace block carried an extra `if (!derData) continue` skip
  that `renderedPairs` / `resolveWell` don't account for. `resolveWell` assumes the deriv block
  is exactly `L` traces parallel to `renderedPairs` (`cn ∈ [L,2L) → pairs[cn−L]`); any rendered
  `(well,channel)` with melt RFU but **no derivative entry** shifts every later deriv trace →
  click / hover / box-select on the derivative subplot lands on the wrong well, and the
  channel-legend markers resolve to real wells.
- *Reachability:* in-app parsers compute the derivative from RFU (key sets match → safe), so the
  common path was unaffected; the bug bites **BioRad-folder imports** (independent RFU/derivative
  CSVs) and externally-authored / hand-edited `.sharp` files.
- *Fix:* dropped the `!derData` skip; the trace is now
  `x: derData ? m.temperatureC : [], y: derData ?? []`. A well lacking a derivative renders an
  empty (invisible) trace that **keeps its curveNumber slot**, so the deriv block stays
  index-parallel with `renderedPairs`.
- *Safety:* in the normal path every pair has a derivative → byte-identical output; nothing new
  is drawn.

**[Medium] 3 — legacy `.sharp` CSV carried the active channel, not channel 0** · `src/lib/export.ts:548–554, 557, 572, 588`
- *Symptom:* `buildSharpZip` wrote `amplification.csv` / `melt_rfu.csv` / `melt_derivative.csv`
  from `exp.amplification` / `exp.melt`, which are the **active-channel** pointers
  (`setActiveChannel` re-points them). Switch active channel → save → 1.0/1.1 readers and Excel
  inspection got the wrong channel. (In-app 1.2 reload was masked — it rebuilds from
  `amplification_ch0.csv`.) Contradicts §6 / `SHARP_FORMAT.md`, which say the legacy CSV carries
  the **first** channel.
- *Fix:* added `legacyAmp` / `legacyMelt` = `exp.amplificationByChannel[exp.channels[0]] ?? exp.amplification`
  (and the melt equivalent); pointed the three legacy CSVs at them.
- *Safety:* single-channel files have channel 0 ≡ active channel, so this is a **no-op** there
  (the regression "round-trip" tests confirm). The `?? exp.amplification` fallback also covers a
  fixture missing `channels`, and incidentally keeps `amplification.csv` populated if channel 0
  is amp-less (partial mitigation of §13 item 2). Per-channel `_ch{i}.csv` files are untouched.

**[Medium] 4 — EDS multiplex reaction-ID collision dropped a curve** · `src/lib/parsers/eds.ts:141–148`
- *Symptom:* in the modern-EDS per-reaction loop, two reactions in one well that resolve to the
  same `channelId` (e.g. both fall back to `'Channel 1'` when dye metadata is absent) overwrote
  each other in `ampByChannelRaw[channelId][well]` → silent loss of one fluorophore's curve.
- *Fix:* on collision (`ampByChannelRaw[id]?.[well] !== undefined`), give the collider a distinct
  `…(2)` ID instead of overwriting.
- *Safety:* only fires on an actual same-well / same-ID collision; properly-tagged multiplex
  files (distinct dye per reaction) take the identical original path.

### Verification after the fixes
- `npx tsc -b` — clean (exit 0).
- `node scripts/codex-regression-tests.cjs` — **12/12** (single-channel coverage; exercises the
  §3 round-trip as a no-op).
- `npx eslint` on the three changed files — `export.ts` and `eds.ts` clean; `PlotArea.tsx` shows
  only **pre-existing** debt (see §13).

---

## 13. Open items from the review (next-session TODO)

Found in the same sweep, deliberately left for a follow-up pass (Low / defensive / cosmetic).
**None block live verification.** All file:line refs are pre-fix-pass positions and may drift a
few lines.

1. **Channel→dash swatch mismatch when an earlier channel is hidden** (Low cosmetic).
   `PlotTabs.tsx` / `WellList.tsx` index `CHANNEL_DASH` by position in the full `exp.channels`;
   `PlotArea` indexes by position in the *visible* list (`ci`). Hide channel 0 → the plot redraws
   the remaining channels from `dash[0]=solid`, but the checkbox/chip swatches still show the
   full-list dash → the swatch mislabels which dash = which dye. Pick one convention (index by
   `exp.channels` position everywhere).
2. **Null channel-0 → unloadable file** (Low). `export.ts` + `sharp-loader.ts:236`: if
   `channels[0]` has null amplification, no `amplification_ch0.csv` is written and
   `hasPerChannelFiles` (gated on `ch0`) is false → the loader falls back to a single `default`
   channel and can throw "missing amplification.csv". Low reachability (amp experiments have amp
   on every channel). Fix idea: gate `hasPerChannelFiles` on *any* `amplification_ch{i}.csv`,
   and/or let the loader tolerate a missing `amplification.csv` when per-channel files exist.
   (Fix-pass item 3's `?? exp.amplification` fallback partially mitigates this.)
3. **Amp channel-legend swatch for a visible-but-null-amp channel** (Low cosmetic). `PlotArea.tsx`
   (~763) loops the full visible list; a channel skipped by the data loop still gets a legend
   entry that draws nothing. Doesn't break resolution. Skip channels where
   `!exp.amplificationByChannel[ch]`.
4. **`MenuBar.tsx:416`** `(exp?.channels.length ?? 0)` throws if `exp` is truthy but `channels` is
   undefined — unreachable today (`normalizeExperiment` guarantees `channels`) but
   `exp?.channels?.length ?? 0` is safer.
5. **`useAnalysisResults.ts:237`** a non-active channel missing from `_channelSnapshots` falls
   back to the active channel's `live` state; should be `defaultChannelState()`. Unreachable
   (`loadExperiment` seeds every channel) but tidy.
6. **AriaMx duplicate-dye suffix** uses `usedIds.size+1`, not the channel index (`amxd.ts:85`) —
   collision-free but the label is misleading vs pcrd's `idx+1`.
7. **`bestLegendPosition`** counts the `[null]`-point channel-legend markers (`PlotArea.tsx`
   ~89–130) — a tiny bias to `'best'` auto-placement; negligible with real curves.

### Pre-existing eslint debt (NOT introduced by this review pass)
`npx eslint src/components/PlotArea.tsx` reports **9 errors**, none in the fix-pass edits:
- 6× `datarevision: Date.now()` → `react-hooks/purity` ("impure function during render").
- 1× `resolveRef.current = resolveWell` → `react-hooks/refs` ("update ref during render").
- 2× plotly element `as any` → `@typescript-eslint/no-explicit-any`.

These are intentional patterns in the multichannel PlotArea (the `Date.now()` datarevision forces
Plotly redraws; the ref-resolver feeds `useLegendHover`). They **contradict §7's "eslint clean"
claim** — most likely an `eslint-plugin-react-hooks` v6 bump that now flags them. Not build-blocking
(eslint isn't wired into the vite build). Decision needed next session: targeted
`eslint-disable-next-line` comments, a config relaxation, or a refactor (move `datarevision` into a
memo/ref, type the plotly div).

### State for the next session
- Branch `feature/multichannel-support`, **uncommitted** (the review fixes are part of the same
  uncommitted working tree as 0.2.0). 3 untracked files: `src/lib/channels.ts`,
  `src/components/FluorophoreWizard.tsx`, `docs/RELEASE_v0.2.0.md`.
- **Still required before commit/tag:** the live-UI verification in §10's testing checklist (only
  a human can do it), then the eslint-debt decision above, then the §9 deferred work (Export
  Wizard multichannel, per-`(well,channel)` hover emphasis, optional results tree) as desired.
- **Recommended resume read order:** this doc (§12 → §13 first) → §10 testing checklist → §9
  deferred work.

## 14. Multichannel styling + plot-UX pass (2026-05-31, Claude)

User feedback after using #42's multichannel build: prefer colour over line-style to tell channels
apart, want to edit line styles, want per-channel and all-channel editing scopes, and want explicit
axis auto-scaling control. Seven changes, all landed (plan: `~/.claude/plans/i-see-that-you-tranquil-swan.md`).

1. **Channel separation by colour (new default).** Shared `channelSeparation: 'color' | 'lineStyle'`
   (default `'color'`). Colour mode gives each channel a monochrome continuous ramp built from its
   representative colour via `monochromeRamp(baseColor, n)` in [`constants.ts`](../src/lib/constants.ts)
   (parses `#hex` + `rgb()`, light tint → base → dark shade through `interpolateGradient`). Each
   channel's ramp is ordered by **its own** Tt (`useAllChannelResults`), so a well can sit at a
   different ramp position per channel. `useGroupedColors` body extracted to pure
   `buildColorMap(visibleWells, colorsFor, …)`; new `useChannelColorMaps` → `Map<channel,Map<well,color>>`
   (colour+multi → per-channel ramp; line-style/single → shared palette). Used in amp, melt-RFU,
   melt-deriv; doubling unchanged (active channel).
2. **Per-channel line-style editor.** New shared `channelLineStyles: Map<channel,dash>` (serialized
   in `.sharpx` via `SESSION_MAP_FIELDS`). Style tab "Line style" `<select>` (Solid/Dashed/Dotted/
   Dash-dot/Long dash) under Line width, scoped by the new Style "Settings for" selector
   (`setChannelLineStyle` / `setAllChannelLineStyles`). New `resolveDash(well,ch,ci,…)` precedence:
   per-well lineStyle override → per-channel `channelLineStyles` → mode default (line-style: the
   `CHANNEL_DASH` ladder; colour: solid). **This also fixes the #42 gap where a per-well line-style
   override was ignored in multichannel.**
3. **Style "Settings for" + "Separate by".** Style tab, when >1 channel: a local `styleScope`
   selector (`'all'` or a channel — deliberately NOT `activeChannel`, to avoid coupling to the
   Analysis channel), a global "Separate by: Color | Line style" select, and (scope ≠ all) a
   representative-colour `ColorPicker` writing the existing `channelColors` (`setChannelColor`;
   "Default" deletes the key → dye default). `channelSeparation` added to `StyleSnapshot` /
   built-in presets / `resetStyle`; `channelLineStyles` deliberately excluded from presets.
4. **Analysis "All channels".** Transient `analysisScopeAll` + `setAnalysisScopeAll`; AnalysisTab
   "Settings for" gains an "All channels" option. Flat analysis setters route through
   `broadcastAnalysis(s, partial)` which, in all-scope, merges into every channel's
   `_channelSnapshots` entry — **global toggles only**; per-well baseline/normalize overrides stay
   on the viewed channel (confirmed with Tom). Cleared on switch/load/`setActiveChannel`.
5. **Auto-scale.** Shared `autoScale` (default **on**) + transient `_autoScalePulse` +
   `triggerAutoScale`. Amp/melt `uirevision` folds a data-transform signature (normalize/baseline/
   drift/log; melt: meltNormalize) when `autoScale` so axes re-fit on transform change, else stays
   stable so a manual zoom persists. A "Fit" button in `PlotTabs` bumps the pulse; each plot's
   `useEffect` relayouts to autorange (amp x/y; melt x/y/y2). Double-RMB reset unchanged.
6. **Banner cleanup** (`PlotTabs`): "Doubling Time" tab `whitespace-nowrap shrink-0` (no 2-line
   wrap); removed the doubled `| |` divider after the channel toggles; X-unit Cycle/Sec/Min radios
   → a dropdown to save width; Auto-scale checkbox + Fit button added.
7. **Legend / swatches.** Channel legend block (amp + melt) and the `PlotTabs` channel swatches now
   reflect the separation mode: colour mode → solid rep-colour; line-style mode → neutral/colour +
   dash. (Partially mitigates §13.1's full-list-vs-visible-list dash index mismatch, since colour
   mode doesn't key on dash — the underlying indexing convention is still worth unifying.)

**Verification:** `npx tsc --noEmit` clean; `npx vite build` clean; no NEW eslint errors (pre-existing
`Date.now()` purity / ref-during-render / `any` debt unchanged). Live-UI verification on the Sample-data
FAM/HEX `.tlpd` and multi-fluor `.pcrd` still pending a human (per the release-verification rule).

**Post-implementation bug sweep (same day, Claude):** a max-effort review caught and fixed three
regressions from this pass: (a) `analysisScopeAll` was not reset in `addEmptyTab`,
`loadExperiment`'s currentIsEmpty branch (the common open-into-Welcome-tab path), or either
`removeExperiment` branch — only the non-empty `loadExperiment` branch got it — so a stale "All
channels" scope could silently fan analysis edits across a freshly opened experiment's channels
(added `analysisScopeAll: false` to all four returns); (b) `StyleTab`'s `styleScope` is component-local
and `StyleTab` stays mounted across experiment-tab switches, so a per-channel scope could outlive its
experiment and route the colour/line-style controls to a ghost channel (added a clamp `useEffect` that
resets to `'all'` when the scope no longer names a current channel); (c) `WellList` per-sample channel
chips still drew `CHANNEL_DASH` borders unconditionally, contradicting the plot + PlotTabs swatch in
colour mode (now resolve dash the same way: `channelLineStyles.get(ch) ?? (lineStyle-mode ? ladder :
'solid')`). Re-verified `tsc`/build clean.

**Second fix round (same day, Claude — user-requested + remaining review items):**
- **Removed the in-plot per-channel legend block** (amp + melt). Tom: the FAM/HEX toggles in the
  plot-tabs bar already serve as the channel key (with colour/dash swatches), so the extra "FAM"/
  "HEX" legend rows were redundant. The per-sample/group legend entries remain.
- **Legend-rep-on-first-channel** (was §13/sweep): the per-sample legend entry is now emitted on the
  FIRST channel where its representative well actually renders (tracked via an `emittedLegend` Set),
  instead of being hardcoded to channel 0 — so hiding a rep well's first channel no longer drops the
  whole group from the legend. Applied to amp + melt RFU loops.
- **Dash index unified (fixes §13.1):** `resolveDash` is now passed the channel's STABLE index in
  `exp.channels` (`exp.channels.indexOf(ch)`) rather than the visible-list `ci`, so a channel keeps
  its dash when others are toggled off and amp/melt/PlotTabs/WellList all agree. Applied at all four
  PlotArea call sites.
- **`Math.max(...[])`→-Infinity guard:** both `wellPeakDeriv` loops now skip zero-length derivative
  arrays (`!derData || derData.length === 0`), preventing -Infinity from poisoning melt-threshold dimming.
- **WellList channel chips** dash resolution aligned with the plot/PlotTabs (colour mode → solid).
- **"Fit" button now works on the Doubling tab** — `DilutionPlot` + `PerWellDoublingPlot` gained the
  `_autoScalePulse` relayout effect (previously a no-op there).
Re-verified `tsc --noEmit` clean, `vite build` clean, no new eslint errors.

**Deferred (unchanged):** Export Wizard figure builder (`plot-figure.ts`) remains single-active-channel.

## 15. Single-channel view mode + small fixes (batch 2, 2026-05-31, Claude)

Multichannel made the app heavier than the v0.1.x it grew from. Rather than add the proposed curve-centric refactor (deferred), this batch lets users **present** the simple single-channel UI. **No 0.2 core code is reverted** — single mode is the same engine constrained to one channel with the channel chrome hidden (the renderer already produces a clean single-channel result when one channel is visible).

- **`viewMode: 'single' | 'multi'`** in `ExperimentViewState`: autodetected in `defaultViewState` (`channels.length>1?'multi':'single'`), in `snapshotViewState` + `.sharpx` serialization, `setViewMode` (undoable). View-menu **"Channel Display"** submenu (Single/Multichannel), disabled when `channels.length<=1`.
- **The one mechanism:** `PlotArea`'s amp/melt/deriv `visibleChannelList` becomes `viewMode==='single' ? [activeChannel] : <filtered>`. The existing single-visible-channel path then renders the v0.1.x look. The banner shows a compact **`Channel: [▾]`** dropdown (→ `setActiveChannel`) in single view of a multichannel dataset; `Ch:` toggles only in multi view.
- **Chrome gated behind `viewMode==='multi'`:** `PlotTabs` channel toggles, `AnalysisTab` "Settings for", `StyleTab` channel block, `WellList` Channels column, `ResultsTable` Fluor column + per-(well,channel) rows (single view → flat per-well for the active channel).
- **Colour ramps gated on `viewMode==='multi' && channels.length>1`** → single view uses the SHARP palette (v0.1.x). This is also the **colour-preserve fix**: ramps key on the experiment's channel count, not the visible count, so hiding a channel via the `Ch` toggles no longer snaps the rest back to the palette.
- **Item A:** removed the `channelSeparation` mode everywhere (interface, defaults, `snapshotViewState`, `resetStyle`, serialization, `style-presets`). Replaced the Style "Separate by" dropdown with two one-shot Apply buttons — `applySeparateByColor` (clears manual colours + resets `channelColors` → standard ramps) and `applySeparateByLineStyle` (clears manual line styles + writes the `CHANNEL_DASH` ladder; **secondary dash is now `'dot'`/dotted**). `resolveDash` simplified to `perWell ?? channelLineStyles.get(ch) ?? 'solid'`. Swatches (`PlotTabs`/`WellList`) drop the mode branch.
- **Item D:** new `clearAllWellStyleOverrides` + a "Clear individual styles" button (gated on a `hasCustomStyle` memo); a Line Style `<select>` added to `QuickStylePanel` (the RMB ContextMenu already had one).
- **Item E:** `whitespace-nowrap` on the banner labels — "Auto Baseline" no longer folds.
- **Item F (auto-scale freeze):** amp + melt now pin an explicit `range` + `autorange:false` in the layout when `autoScale` is OFF, via helpers `readPlotRanges`/`rangeProps` and a `frozenRanges` state captured (rAF) on an `[autoScale, exp.experimentId, xAxisMode]` effect and re-pinned after "Fit". With `autorange:false` set, a data change (toggling a channel) can no longer rescale; manual zoom is preserved by `uirevision`. Melt `xaxis2` is never pinned (`matches:'x'`). `MeltDerivMini`/doubling stay pulse-only.

**Deferred:** custom grid legend, curve-centric grouping of arbitrary (well,channel) curves + per-curve colour/line-style, results-table sample/sample-channel tree.

**Verification:** `tsc --noEmit` + `vite build` clean; no new eslint errors (pre-existing `Date.now`/ref/`any`/`_saveStatus` debt unchanged). Live-UI verification on the Sample-data FAM/HEX `.tlpd` + single-dye `.pcrd` still pending a human.

## 16. Curve-centric selection / styling / grouping + results-table tree (batch 3, 2026-05-31, Claude)

Closes the two items deferred across §14/§15 ("curve-centric grouping of arbitrary `(well,channel)`
curves + per-curve colour/line-style" and "results-table sample/sample-channel tree"). Plan of
record: `~/.claude/plans/mellow-dazzling-marble.md`. **No 0.2 core is reverted**; single-channel
behaviour is preserved exactly (a curve ≡ its well when there is one channel).

### Identity — NEW `src/lib/curves.ts`
A **curve** (sample-channel / **S-C pair**) is a `(well, channel)` pair — the unit of selection /
styling / grouping. `curveKey(well, channel)` joins with a single space; `parseCurveKey` splits on
the FIRST space (well names are `{row}{col}` and never contain spaces; channel names may, e.g.
`Cal Orange 560`, `Channel 1`). `wellCurves`, `curvesToWells`, `allCurves` round it out. The
composite string key is a `Map`/`Set` key and JSON-round-trips through `.sharpx` with no special
handling.

### Selection — curve-primary, well-mirror (`src/hooks/useAppState.ts`)
- `selectedCurves: Set<curveKey>` is the **primary** selection; `selectedWells` is a **derived
  mirror** (`curvesToWells(selectedCurves)`) recomputed by every selection action via the helper
  `applySelection(curves)`. Keeping `selectedWells` as a stored mirror means the ~15 well-level
  readers (well grid, well list, MenuBar, visibility, sample rename, content-type, baseline,
  doubling) need **no change** and single-channel files behave identically.
- Well-level actions (`selectOnly`, `toggleWellSelection`, `setSelectedWells`, `addToSelection`,
  `selectAll`, `deselectAll`, `selectByType`, `selectShown`, `selectHidden`) are rewritten as thin
  wrappers that expand a well → `wellCurves(well, exp.channels)`. New curve actions:
  `setSelectedCurves`, `selectCurvesOnly`, `toggleCurves` (remove-all-if-all-present else add-all),
  `addCurvesToSelection`.
- New per-curve maps `curveStyleOverrides` / `curveGroups` (+ `setCurveStyleOverride`,
  `clearCurveStyleOverrides`, `setCurveGroup`, `removeCurveGroup`). `clearAllColorOverrides` /
  `clearAllWellStyleOverrides` clear both the well + curve maps. All four new fields ride
  `snapshotViewState` (undo/redo, tab switch, remove-all) and the `.sharpx` session.

### Rendering (`src/components/PlotArea.tsx`)
- Per-curve colour / width / dash, most-specific-first at the trace level: `colour =
  curveStyleOverrides[key]?.color ?? <ramp/palette>`, `width = curve ?? well ?? selection-default`
  (`resolveCurveColorWidth`), `dash = curve ?? well ?? channel ?? solid` (`resolveDash`).
- Dimming keys on `selectedCurves.has(key)`; plot click → `selectCurvesOnly([key])` / `toggleCurves`
  (new `resolveCurve(curveNumber)`); box-select → curveKeys via `matchWellsInBox` wired to
  `setSelectedCurves` + a new transient `dragPreviewCurves` (the well grid keeps `dragPreviewWells`).
  Hover stays whole-well (`hoveredWell`) — per-`(well,channel)` hover emphasis remains deferred.
- Legend: `computeLegendInfo` → `computeCurveLegendInfo`, keyed by curveKey. Applied to amp + melt
  RFU + melt-derivative; doubling stays active-channel. *(The exact legend behaviour was refined in
  **Follow-up #5** below — per-S-C-pair entries in multichannel, curve groups honoured only in group
  mode, legendgroup `grp:`/`curve:` not `cgrp:`. Read #5 for the current logic.)*

### Styling UI surfaces
- `ContextMenu.tsx` + `QuickStylePanel.tsx`: header reads "N curves selected"; colour / line-style /
  group / clear / palette-apply / reverse write **curve**-level over `selectedCurves` (palette-apply
  groups by effective curve-group). Visibility / sample-type / baseline / legend stay **well**-level.
- `MenuBar.tsx` Ctrl+G / Ctrl+Shift+G → curve group / ungroup on `selectedCurves`.
- `StyleTab.tsx` "Clear custom colors" / "Clear individual styles" (+ enabled state) include
  `curveStyleOverrides`. `WellGrid.tsx` / `WellList.tsx` colour map overlays the **active channel's**
  per-curve colour so single-channel custom colours still appear on the coarse grid/list.

### Results-table tree (`src/components/ResultsTable.tsx`)
The multichannel view renders a collapsible **parent (well/sample) row** + per-channel **S-C child
rows** (Fluorophore + Tt/Tm/Call/EndRFU from `useAllChannelResults`). A well with one visible channel
renders inline on the parent (no caret); parent-click selects all the well's curves, child-click
selects that one; a parent highlights when any of its curves is selected, a child when its curve is.
Parents sort by an aggregate of their channels (min Tt/Tm, max End RFU, best call). Single-channel /
single-view keeps the flat per-well table (now selecting through the well wrappers → curve mirror).

### Persistence
`selectedCurves` (Set) + `curveStyleOverrides` / `curveGroups` (Maps) added to `SESSION_SET_FIELDS` /
`SESSION_MAP_FIELDS`, so `.sharpx` `session.json` round-trips them. A **pre-curve** session (only
`selectedWells`, no `selectedCurves`) backfills `selectedCurves = selectedWells × channels` in
`loadExperiment`; the `selectedWells` mirror is always re-derived after load. Plain `.sharp` is
unaffected (carries no session). `docs/SHARP_FORMAT.md` updated.

### Verification
- `npx tsc --noEmit` clean; `npx vite build` clean; `node scripts/codex-regression-tests.cjs` 12/12.
- Throwaway curve-logic harness (removed) — 10/10: `curveKey` round-trip incl. `Cal Orange 560`,
  single-channel mirror parity, single-curve→well mirror, whole-well toggle, session round-trip of
  `selectedCurves` / `curveStyleOverrides`, and the pre-curve backfill.
- **No new eslint errors**: PlotArea's documented 9 (6× `Date.now` datarevision purity, 1×
  ref-during-render, 2× `any`) + the `_saveStatus` / ContextMenu / StyleTab ref-during-render debt
  are all pre-existing and unchanged.
- **Still pending (human):** live-UI exercise on the Sample-data FAM/HEX `.tlpd` + a single-dye
  `.pcrd` — per the release-verification rule, no commit/tag until installer sign-off.

*(Deferred items are consolidated at the end of this section — see "Known limitations / deferred".)*

### Follow-up — SC pair as the fundamental unit everywhere (same session, user feedback)
Four refinements so the Wells/Sample table and the remaining tools treat each S-C pair as a
first-class unit:
1. **Flat, sortable SC-pair Wells list** (`WellList.tsx` rewritten). The Wells table now lists
   **one row per S-C pair** (a 6-sample × 2-channel set = 12 rows), not a tree — columns L /
   Well / Sample / Type / Fluor / Group, every header **click-sortable** (asc/desc) with a stable
   tiebreak (e.g. sorting by Fluor groups FAM then HEX, wells natural-ordered within each). The
   **Group column shows the curve's effective group** (`curveGroups[key] ?? wellGroups[well]`), so
   curve-level group names are visible. Row select = `selectedCurves` (curve adapters fed to the
   generic `useDragSelect` over the ordered curveKeys — click / Ctrl-click / Shift-range all work
   per curve). The **L checkbox** toggles per-curve visibility (`toggleWellChannel`) in multichannel,
   or the whole well (`toggleWellHidden`) in single-channel / single-view; Sample / Type edits stay
   well-level (batch over the selected wells). Single-channel = one row per well (v0.1.x look) + the
   new sortability. The per-channel chips column was dropped (each row *is* a channel now).
2. **Expand/collapse-all caret** in the ResultsTable header — a caret left of "Well" (multichannel
   only, via a new `prefix` slot on `SortableHeader`) toggles every collapsible parent at once.
3. **Select by fluorophore** — a "Fluor…" dropdown in the Wells-tab Select panel (second button row,
   shown only in multichannel) → new store action `selectByChannel(channel)` selects every well's
   curve for that dye. The **Group…** dropdown now spans curve + well groups and selects the matching
   **curves** (`setSelectedCurves`), fixing "can't select an SC-pair group".
4. **Per-SC-pair palette arrow** — `handlePaletteArrow` now intersects the arrow against **every
   visible `(well, channel)` curve** (across all visible channels, using each channel's `displayRfu`)
   and assigns the palette per S-C pair via `setCurveStyleOverride` — so dragging across individual
   curves colours them individually rather than requiring the arrow to cross all of a sample's curves.
   **It also honours "Group coloring"** (`paletteGroupColors`): when on, crossed curves sharing an
   effective group (curve group → well group) collapse to **one colour unit** (ordered by the group's
   earliest crossing) instead of one colour per curve — matching the right-click apply-palette path.
   And when armed from a single-channel **Settings for** scope, it colours **only that channel's**
   curves (via a transient `paletteArrowChannel` carried through `setPaletteArrowMode(on, channel)`),
   ignoring any curves it crosses in other channels.
5. **Legend shows S-C pairs in multichannel** (`computeCurveLegendInfo`). With >1 channel visible the
   legend emits **one entry per S-C pair** (label `<sample|well> · <fluor>`, legendgroup `curve:<key>`)
   instead of collapsing a well's channels into one sample entry. Curve groups are honoured **only in
   group mode** — fixing the bug where a curve-group name (e.g. "test") leaked into a Sample-mode
   legend. Single channel keeps the one-entry-per-well look (no fluor suffix). `legendVisibleOnly`,
   group mode, and the Style-tab legend **reorder** list all updated to mirror the new per-curve
   legendgroup keys; the amp hover popup was decoupled from the legend label so it stays `sample | fluor`.
6. **Channel styling moved into Colors & Lines** (`StyleTab`). The "Settings for" channel selector +
   "Separate by color / line style" buttons + per-channel colour picker moved from a separate top
   block into the top of the **Colors & Lines** section (Typography / Legend / Grid / Presets are
   global and unchanged).
7. **Palette picker works per channel in multichannel** (`StyleTab` + new store `setCurveColorsBatch`).
   The global `palette` is inert in multichannel (the plot colours by per-channel ramps, ignoring it).
   Now, when **Settings for** is a specific channel, an **Apply** button colours **that channel's S-C
   pairs** with the selected palette by the channel's Tt order — group-aware (`paletteGroupColors`) and
   reversed-aware — writing per-curve colour overrides in **one** undoable step (`setCurveColorsBatch`).
   The Palette **dropdown only selects** (non-destructive) in this scope, so an accidental change can't
   overwrite custom colours — nothing is written until **Apply** is hit. Other channels keep their
   colours. In single-channel / "All channels" scope the dropdown sets the global palette live, as before.

Re-verified: `tsc --noEmit` + `vite build` clean, 12/12 regression, **no new eslint errors**
(PlotArea's documented 9 + StyleTab's 2 pre-existing ref-during-render unchanged; the other changed
files are clean).

### File-by-file change map (batch 3 + follow-ups)
- **New:** `src/lib/curves.ts` (curve identity helpers).
- **State (`src/hooks/useAppState.ts`):** `selectedCurves` (+ derived `selectedWells` mirror),
  `curveStyleOverrides`, `curveGroups`, `dragPreviewCurves`, `paletteArrowChannel`; actions
  `setSelectedCurves`/`selectCurvesOnly`/`toggleCurves`/`addCurvesToSelection`,
  `setCurveStyleOverride`/`clearCurveStyleOverrides`/`setCurveColorsBatch`,
  `setCurveGroup`/`removeCurveGroup`, `selectByChannel`, `setPaletteArrowMode(on, channel)`; well-level
  selection actions rewritten as curve wrappers; session field lists + `loadExperiment` backfill.
- **Rendering (`src/components/PlotArea.tsx`):** `computeCurveLegendInfo`, `resolveCurveColorWidth`,
  `resolveDash` (curve precedence), `resolveCurve`, curve-aware `matchWellsInBox`/dimming/drag-preview,
  group-aware + channel-scoped `handlePaletteArrow`.
- **UI:** `ResultsTable.tsx` (tree + collapse-all caret + `SortableHeader` `prefix`),
  `WellList.tsx` (rewritten flat sortable SC-pair list), `sidebar/WellsTab.tsx` (Fluor + curve-group
  selectors), `ContextMenu.tsx` / `QuickStylePanel.tsx` (curve-level writes), `MenuBar.tsx` (Ctrl+G
  curve groups), `WellGrid.tsx` (active-channel curve-colour overlay), `sidebar/StyleTab.tsx`
  (per-curve clears, channel block in Colors & Lines, per-channel palette Apply + legend reorder keys).
- **Docs:** `CLAUDE.md` (row #45), this §16, `docs/SHARP_FORMAT.md` (session fields), `AGENTS.md`,
  `docs/ALGORITHMS.md` (analysis unchanged), `CLAUDE.local.md`, OneDrive `STATUS.md` / `DEV_NOTES.md`.

### State for the next session (resume here)
- **Branch `feature/multichannel-support`, still uncommitted.** This batch's only new untracked file
  is `src/lib/curves.ts`; everything else is edits (plus the batch-1/2 untracked `src/lib/channels.ts`,
  `src/components/FluorophoreWizard.tsx`, this `docs/RELEASE_v0.2.0.md`).
- **Verified green** at handoff: `npx tsc --noEmit` clean, `npx vite build` clean,
  `node scripts/codex-regression-tests.cjs` 12/12, **no new eslint** (9 in `PlotArea.tsx` + 2 in
  `StyleTab.tsx` are pre-existing — see §13).
- **The one thing left before commit/tag: live-UI sign-off** in a dev/installer build (release-
  verification rule). Suggested exercise on `Sample data/a private multichannel fixture` (FAM+HEX) + a
  single-dye `.pcrd`: curve selection (plot click = one curve, grid click = whole well, results
  parent = all, child = one); per-curve colour/line-style/group via right-click + Quick panel; the
  flat **sortable** SC-pair Wells list + Select-by-fluorophore + the Group dropdown; the results tree
  + collapse-all caret; the SC-pair legend (and "test"-style curve groups showing only in Group mode);
  the per-channel palette **Apply** (dropdown is non-destructive) and the group-aware + channel-scoped
  palette **arrow**; `.sharpx` round-trip; and that a single-dye file is byte-for-byte v0.1.x in feel.
- **Plan of record:** `~/.claude/plans/mellow-dazzling-marble.md`.

### Known limitations / deferred (after this batch)
- **Global automatic "Group coloring" keys on WELL groups, not curve groups.** The Style-tab
  "Group coloring" checkbox drives `buildColorMap` (the automatic plot colouring), which still groups
  by `wellGroups`. The MANUAL paths (right-click apply-palette, palette arrow, per-channel palette
  Apply) ARE curve-group-aware. Aligning `buildColorMap` was offered and deferred (low priority;
  in multichannel multi-view the automatic colouring is per-channel ramps anyway, so the global
  palette + this checkbox are inert there).
- Per-`(well,channel)` **hover emphasis** (hover stays whole-well).
- **Export Wizard** standalone figure builder (`plot-figure.ts`) remains single-active-channel
  ("Export As Seen" already captures the live multichannel plot).
- Custom grid legend.
