# Release v0.2.4 — QuantStudio `.eds` support, correct time axis, colour/palette model

**Last Updated:** 2026-07-13 PST — Claude (macOS DMG built + published; release now cross-platform complete)

Internal record. Public-facing notes live in `README.md` → *What's New in v0.2.4* and on the GitHub release page. Everything below is implementation detail and stays here.

Driven by the plan at OneDrive `a private validation plan (not tracked)` (which now carries a full Implementation Record). Test file: `a private QuantStudio fixture` (QuantStudio 6 Pro, the operator, 2026-07-06), with ground truth in `private ground-truth worksheet` (21 loaded wells of 96) and the Results / Multicomponent / Melt-Raw CSV exports.

---

## 1. The blocker the plan missed: bare `NaN` in QuantStudio JSON

`primary/analysis_result.json` contains **bare `NaN`** tokens (QuantStudio's encoding for undetermined values, e.g. `cq` on a `NO_AMP` well). That is **not valid JSON**:

- JavaScript `JSON.parse` **rejects** it → the modern `.eds` path silently received `null` for `analysis_result.json` → **no amplification, no melt, no channels**.
- Python's `json` is **lenient** and accepts `NaN`, which is why file inspection looked fine and the plan concluded "amplification parses correctly". It did not.

**Fix** — `readJson` in [`eds.ts`](../src/lib/parsers/eds.ts) retries after replacing bare `NaN` / `Infinity` **in value position only** (never inside a quoted string):

```
text.replace(/([:,[]\s*)(-?Infinity|NaN)(?=\s*[,\]}])/g, '$1null')
```

The lookahead (rather than a consuming group) makes consecutive `NaN,NaN` work; requiring a preceding structural char protects a literal `"NaN"` string value.

## 2. Amplification signal → raw reporter dye (not `rn`)

QuantStudio's `amplificationResult.rn` is `SYBR / ROX`. Verified against the file: `rn` equals raw SYBR ÷ raw ROX **exactly** (A5 final: 2501.14 both ways). SHARP's master mix contains **no ROX** (enzyme mix, small-molecule mix, intercalating dye, primers, water), so the instrument divides by a near-zero, noisy background — on A1 the ROX channel even goes **negative** (−214), making `rn` swing −19,364 → +14,342. `rn` is division-by-noise.

**Fix** — new `parseMulticomponent` reads `primary/multicomponent_data.json` (`wellData[].dyeData[].fluorescences`), sliced to the amplification stage via `collectionPoints[].stage`; `pickPrimaryDye` picks the reporter (non-passive-reference) dye. Amplification uses the **raw dye fluorescence**, falling back to `rn` only when multicomponent is absent. This also matches `.pcrd` / `.tlpd` / legacy `.eds`, which all feed raw fluorescence.

Verified ordering (final RFU): 1e7 = 1.32 M > 1e5 = 1.20 M > 1e4 = 327 k > NTC = 112 k.

## 3. Time axis — real per-cycle timestamps

`buildTiming` scanned only the **legacy** `apldbio/sds/quant/` folder. Modern files store quant under `run/quant/`, so it found nothing and fell back to `estimateTiming`, which spreads the **whole run** across the cycles — including the 5-minute initial hold *and* the melt ramp.

| | Before | After (verified) |
|---|---|---|
| Mean cycle | 29.39 s | **21.69 s** (protocol: 1 s + 20 s read) |
| Cycle 90 at | 43.60 min | **32.17 min** |

Every time-based readout (`t_LoD`, `10%`) was inflated ~1.36×.

Second trap: the modern `[conditions]` block is a tab-separated **header row + value row**, so the legacy `parseQuantTime` (which expects a `Time<TAB>value` line) never matches. New `parseQuantConditionTime` handles both encodings; new `buildModernTiming` takes one read per **amplification-stage** cycle (`S{stage}_C{cycle}` in the filename) and rebases on the **first amp read** (cycle 1 → t 0, matching `.pcrd`). The legacy path now also tries the robust reader first.

**This is now a standing project rule** — `CLAUDE.md` → *Parser Principles → Time reconstruction: always use the most stringent source*, with a per-format real-source/fallback table. Audit result: `.pcrd`, `.tlpd` and the BioRad folder importer all already used real timestamps; legacy `.eds` was the only other gap and is now closed.

> Known, deliberately **not** changed: legacy `.eds` rebases on run start (`startTimeMs`) rather than the first read, so its axis includes the initial hold — unlike `.pcrd`/`.tlpd`/BioRad. No legacy `.eds` fixture is available to verify a change against.

## 4. The four issues from the plan

| # | Issue | Fix |
|---|-------|-----|
| 1 | Melt never parsed (`meltByChannel = null`) | Read per-reaction `meltResult` (`rn` + `rnTemperatures`, 109 pts) → `buildModernMelt`. Shared axis = first well's `rnTemperatures` (per-well axes differ by sub-step jitter; lengths asserted, mismatches warned + skipped). Derivative **recomputed** via `computeMeltDerivative` — the file's `derivativeRn` sits on a different axis. `has_melt` keys off parsed melt. |
| 2 | `run_method.json` schema mismatch | `parseRunMethodJson` rewritten for the qPCR File API 2.0 schema: stages carry `repeat` (not `cycleCount`); steps nest temp/duration under `ramp`/`hold`; a collecting step has a `collectionProfile` (`PCR_HAC_SETTING` ⇒ amplification read, `MELT_RAC_SETTING` / `collectionMode: "CONTINUOUS"` ⇒ melt ramp). Old string-named schema kept as fallback. Also returns the 1-based amp/melt `collectionPoints` stage numbers. → 90 cycles, 65 °C, melt = true. |
| 3 | Channel labelled by target (`16s`) not dye | `targetName → reporter` map from `plate_setup.targets`. `modernReactionChannel` precedence: dye field on the reaction → target's reporter (`SYBR`) → target name → generic. `channelFluorophore` = `SYBR`. |
| 4 | Blank well labels | `sample = sampleName || wellName` at **both** sites (plate-setup loop and the analysis-only fallback). Content stays `Unkn`. |

Real sample identities (1e7…NTC, EXCL vs corrected) exist only in `private ground-truth worksheet` and are unrecoverable from the `.eds` — the operator would need to type sample names into the QuantStudio software before export.

## 5. Empty-well detection + a real `deactivated` state

QuantStudio assigns a target to the **whole** plate, so all 96 wells look populated though only 21 were loaded. Nothing in the file distinguishes them (`plate_setup` entries are byte-identical; `omitted` is `false`; `ampStatus` is `NO_AMP` everywhere). But a loaded well fluoresces from its intercalating dye and an empty one sits at background:

- Loaded (21): raw-SYBR pre-amp baseline **≥ 51,911**
- Empty (75): **≤ 41,176**

`detectEmptyWells` / `clearlyLowWells` flag empties by a **top-anchored gap** on that baseline: find the tight loaded cluster at the top and cut below it. Chosen over the alternatives after testing all three on the real data:

- *Largest global gap* — fooled by a single very-low outlier (one empty well at −7,910) and flagged only 1 well.
- *Otsu / 2-means* — both put A12 (baseline 41,078, stranded between the clusters) on the loaded side and flagged 74.
- *Top-anchored gap* — flags exactly **75**, keeping all 21 loaded wells. Conservative: no clear gap ⇒ nothing flagged; a well within ~70 % of the loaded level is kept.

Also honours an explicit signal when present (a `plate_setup` well with no `targetAssignments`).

Results ride a new transient `ExperimentData.autoEmptyWells`; `loadExperiment` seeds them into **`deactivatedWells`** — a store field that previously had setters but **no reader** (inert). It is now wired as the real "off" state: excluded from every `visibleWells` site (PlotArea / ExportWizard / MenuBar / DataTab / StyleTab), the WellGrid populated set, analysis pooling (drift + run σ), ResultsTable, WellList, and the bulk-select actions; kept out of the initial selection at load. Reversible, session-persisted (already in `SESSION_SET_FIELDS`), undoable. **Foundation for a future Configure Plate UI** (deferred per Tom — it will simply edit `deactivatedWells`).

`.pcrd` / `.tlpd` pre-filter empties at parse, so their `deactivatedWells` stays empty and every consumer filter is a no-op.

## 6. Curve-colour fixes (app-wide, pre-existing since #45)

All surfaced during live sign-off; none are `.eds`-specific. Recorded as invariants in `CLAUDE.md` → *Curve-colour invariants*.

1. **Grouping never coloured.** Since the curve-centric migration (#45) every grouping action writes `curveGroups`, but the live plot / plate-grid / report colour maps all read the legacy `wellGroups` (always empty) — so grouped wells never shared a colour anywhere except via the explicit "Apply palette by group" button. All now resolve the **effective group** (`curveGroups[curveKey] ?? wellGroups[well]`).
2. **`WellGrid` had an inline duplicate** of the colour logic → replaced with the shared `buildColorMap`.
3. **Domain mismatch.** `buildColorMap` divides the palette among **units**, so surfaces must colour over the same well set. The grid coloured over all used wells and the report over all non-deactivated wells, while the plot used the visible set (6 hidden wells → 11 units vs 5) → colours desynced.
4. **Unstable sort.** `buildColorMap`'s Tt sort was `Infinity − Infinity = NaN` whenever threshold detection is off (the default) — an inconsistent comparator V8 sorts unpredictably, letting two surfaces order the same groups differently. Made stable with `(a - b) || 0`.
5. `applyPaletteToChannel` excluded hidden but **not deactivated** wells — it would have spread the palette across all 75 empties.

## 7. Palette application model (per Tom)

The palette dropdown is now **non-destructive** — it only stages a choice. **Apply** (`applySelectedPalette` → `applyPaletteToChannel`) assigns the palette by Tt order to the curves **shown at that moment** and persists it as per-curve `curveStyleOverrides`. Because the result is *stored*, not re-derived, it **sticks**: hiding/showing wells afterwards never recolours. Press Apply again to re-spread.

Consequences: `Reversed` and `Group colors` become Apply *options* (overrides outrank the live map). The un-applied default map is assigned over the experiment's **active** wells (not the visible subset), so pre-Apply hide/show is stable too. `Clear custom colors` discards an applied palette and reverts to the default — the intended reset.

## 8. Kinetics Report

- Excludes deactivated (empty) wells, and by default wells hidden in the main window (`hidden` is already the app's "leave it out" mechanism — the results table and CSV exports honour it).
- New **`Show hidden (n)`** checkbox brings hidden wells in. They are **appended after** the sample/group tiles (dashed border, tooltip) so nothing already on screen moves, and they are kept **out of the run-σ pool** via a new optional `sigmaExclude` on `computeChannelReport` / `computeExperimentReport`.
- Sample tiles collapse by **group** when a curve belongs to one (previously keyed on `colour + sample name`, so groups of distinctly-named wells — well-position fallbacks A1/A2/A5 — never collapsed).
- Tile uniform-width measurement fixed: tiles are `shrink-0` (as flex items they were shrinking once the row overflowed, so the measured "natural" width was the **squeezed** one and every card silently narrowed as tile count grew), and only non-hidden tiles set the standard.
- Melt Tm callout `relayout` guarded with `gd.isConnected` — the panel unmounts while the report recomputes, and `Plotly.relayout` on a detached div throws internally. Deliberately a DOM check, not a Plotly-internals probe, so the #56 "callout vanishes" fix is untouched.

## 9. Verification

- **Headless parser harness** (rolldown-bundles the real `eds.ts`, runs `parseEds` on the QS6 file): **25/25** vs `private ground-truth worksheet` — channel `SYBR`; 90 cycles / 65 °C / melt; raw-SYBR ordering; melt 109 pts, −dF/dT peak 90.84 °C; cycle 1 = t 0, cycle 90 = 32.17 min, mean cycle 21.69 s; 75 empty / 21 active with all 21 loaded wells correct.
- **σ-invariance harness**: toggling "Show hidden" adds exactly 6 rows, run σ is **byte-identical** (295.898049) and all 15 shared wells' readouts bit-identical. Control run that *does* pool the hidden mis-pipetted wells moves σ to **401.68 (+36 %)** — confirming the guard matters.
- `tsc -b` clean, `vite build` clean, **eslint 48 = zero new** (pre-existing `useBoxSelect` ref-during-render + `_archive` debt), **codex regression 12/12**.
- Live-UI sign-off by Tom on Windows (WebView2) via `dev.bat`: amplification, melt, protocol, dye label, well labels, empty-well deactivation, group colours, plate/curve colour match, corrected time axis, palette Apply, report Show-hidden — all confirmed.

## 10. Release

Version 0.2.3 → **0.2.4** across all five sources (`package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`). `APP_VERSION` derives from `package.json` via the Vite `define`, so there is no sixth.

`curvefit/` (`FREESHOULDER_FIT_VERSION 1.2.0`) untouched.

Merged via **PR #12** (merge commit `22eb3e2`, revertible). Tagged `v0.2.4` → `22eb3e2`.

Windows x64 + x86 installers built and attached (4 assets). **Promoted to "Latest"** per Tom — `/releases/latest` → `v0.2.4`, so existing installs get the in-app update prompt. His rationale: the 0.2.x line is a single beta line, so rolling back to an earlier 0.2.x buys nothing ("they are equally untested"); **v0.1.13** stays the meaningful rollback target and is what the notes/README link.

**macOS DMG built and uploaded (2026-07-13 Mac session)** — `SHARP.Processor.2_0.2.4_aarch64.dmg` built from `main` @ `0799a21` via `./build.sh`, verified (`hdiutil verify` VALID; the DMG's enclosed `.app` `codesign --verify --deep --strict` valid on disk / satisfies its Designated Requirement, ad-hoc `com.sharp-diagnostics.processor`), and attached to the `v0.2.4` release (`gh release upload … --clobber`). **v0.2.4 is now cross-platform complete** (5 assets: aarch64 DMG + Win x64/x86 exe+msi). The release notes' macOS line + the README were updated from "DMG being built, use v0.2.3" to name the DMG. macOS live-UI sign-off has **not** been done for this release (Windows/WebView2 only) — the `MAC_BUILD_HANDOFF_2026-07-08.md` handoff carries a 9-point checklist, with the melt-Tm `Plotly.relayout` path flagged as the WKWebView risk surface.

### Build gotchas hit this session (both would have shipped the wrong thing)

- `build.bat` ends with `explorer` + `pause` — it hangs any non-interactive run. Invoke the two `npx tauri build --target …` commands directly with `CARGO_TARGET_DIR` set instead.
- Tauri never cleans `build-cache/*/release/bundle/`, so it still held 0.2.0 / 0.2.2 / 0.2.3 installers. A `copy *.exe` (which is exactly what `build.bat` does) stages **stale-version installers** alongside the new ones. Always prune to the current version before uploading.
