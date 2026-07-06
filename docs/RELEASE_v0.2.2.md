# SHARP Processor 2 — v0.2.2 (Kinetics Report + FreeShoulder baseline) — Dev Documentation

**Last Updated:** 2026-07-06 PST — Claude (**Mac session — v0.2.3 shipped (macOS side)** (#56 — Kinetics Report residuals + melt-Tm + data/fit toggles; separate release, see [`docs/RELEASE_v0.2.3.md`](RELEASE_v0.2.3.md)); this v0.2.2 record is unchanged. **Prior — v0.2.2 macOS aarch64 DMG built, verified, and published to the v0.2.2 release** (`gh release upload v0.2.2 … --clobber`; built from `main` @ `ce47947`; `hdiutil verify` VALID + `codesign --verify --deep --strict` valid on disk / satisfies its Designated Requirement / ad-hoc). The release-page macOS install line now names the DMG, so v0.2.2 is cross-platform complete (Win x64/x86 + macOS aarch64). v0.2.2 stays **"Latest"**, tag frozen at `0ee94fc`. macOS live-UI sign-off not run this session. **Prior (Windows session) — v0.2.2 promoted to "Latest".** The Kinetics Report was beautified + made interactive + given an **HTML/CSV bundle export** (repo CLAUDE.md #55, merge `8163281`); the fresh Windows x64/x86 installers were rebuilt and **re-uploaded**, and the `v0.2.2` GitHub release was **flipped from pre-release to "Latest"** (`gh release edit v0.2.2 --prerelease=false --latest`; `/releases/latest` → v0.2.2) so existing installs get the in-app update prompt, with a prominent **v0.1.13 rollback link** in the notes (v0.1.13 no longer marked Latest but stays available). **macOS DMG still to be built from `main` (`8163281`) + uploaded** to the v0.2.2 release. **Prior:** cut the v0.2.2 pre-release — committed the kinetics-report work on `feature/kinetics-report`, merged to `main` via PR #11, bumped 0.2.1 → 0.2.2, built Windows x64/x86 installers, published the `v0.2.2` GitHub pre-release (v0.1.13 was Latest). Mac DMG handoff prepared for a separate Mac build.)

> This is the **internal** engineering record for 0.2.2 — full detail (file paths,
> functions, algorithm provenance). The user-facing release note lives in `README.md`
> ("What's New in v0.2.2") and the GitHub release body, in plain language with no
> internals.

---

## 1. Headline

v0.2.2 is the first public release on the 0.2.x line since the v0.2.0 multichannel
pre-release. It bundles **everything since v0.2.0** — the in-repo 0.2.1 baseline slice
(never released standalone) plus the kinetics-report work — into one pre-release:

1. **Fit-first FreeShoulder auto-baseline** (the 0.2.1 slice). Auto baseline fits each
   curve to the 6-param Kumaraswamy-warped logistic and subtracts the fitted lower
   asymptote `A`, replacing the flat-window method as the **default** Auto path. Poor
   fits (junk / double-shoulder NTCs) are rejected via the fit's `baselineObserved`
   flag and fall back to the robust trough. Drift-correction UI hidden (code kept).
   Doubling Time panel + wizard renamed **Standard Curve**.
2. **Native Kinetics Report** (**Tools → Kinetics Report**) — a general per-curve
   kinetics readout with fitted model, landmarks, melt −dF/dT, a sortable ±SE table,
   and self-contained HTML export.
3. **Kinetic landmarks promoted into the main app** — Analysis → Kinetics draws
   `t_lod` / `t_onset10` / inflection on the main amp plot (so they ride the normal
   figure-export path), plus **t_LoD** / **10%** results columns; Threshold Detection
   renamed **Thresholds** (Tt reads "—" when detection is off, the default).

The public tag sequence jumps **v0.2.0 → v0.2.2**; there is no public `v0.2.1` (0.2.1
was an in-repo baseline bump only, never shipped standalone).

---

## 2. Version bump (single source of truth = 5 files)

Bumped **0.2.1 → 0.2.2** in lockstep:

| File | Field |
|------|-------|
| `package.json` | `"version": "0.2.2"` |
| `package-lock.json` | root + `packages[""]` entry |
| `src-tauri/tauri.conf.json` | `"version": "0.2.2"` |
| `src-tauri/Cargo.toml` | `[package] version = "0.2.2"` |
| `src-tauri/Cargo.lock` | `[[package]] name = "app"` pin |

UI label auto-syncs: `APP_VERSION` in `src/lib/constants.ts` reads the Vite-injected
`__APP_VERSION__` (from `package.json`). `build.sh` derives the macOS DMG filename from
`tauri.conf.json`. No other file needs the version. (Third-party lockfile entries that
coincidentally read 0.2.1/0.2.2 — `@choojs/findup`, `is-arrayish`, `stdin-discarder` —
are left untouched.)

---

## 3. Slice A — Fit-first FreeShoulder auto-baseline (the 0.2.1 content)

Committed on `main` as `305daa6` (branch `feature/freeshoulder-baseline`, merged via
PR #11). Summary — full detail in `CLAUDE.md` #52:

- **Shared `freeshoulder-fit` module** copied into `src/lib/curvefit/` (`fivepl.ts`,
  `baseline.ts`, `util.ts`, `types.ts`, `index.ts`) — the 6-param Kumaraswamy-warped
  logistic fit (multi-start Levenberg-Marquardt in normalised coords; dep
  `ml-levenberg-marquardt`). `computeCovariance` opt-in, **off** on the baseline path.
- **`computeAutoFitBaseline`** in `analysis.ts`: fits the raw signal (in seconds; `A`
  is x-unit independent), uses fitted `A` as the baseline level. Seeds `A` near the
  starting RFU, robust-trough fallback. `AUTO_BASELINE_KNOBS` caps LM at 120 iters.
- **Poor-fit rejection** via `baselineObserved` (r²≥0.9 AND ≥8 reads below the pre-onset
  level). A curve the single logistic can't represent (junk / two-shouldered NTC) falls
  back to the trough. The fit runs on the **original** raw array (stable reference) so
  smoothing / drift toggles reuse a `WeakMap`-cached fit.
- **Drift-correction UI hidden** behind `SHOW_DRIFT_UI = false` (state / setter /
  `computeDriftSlope` kept, default off).
- **Doubling Time → Standard Curve** rename across the plot tab, View/Tools menus,
  wizard, StyleTab legend toggle, and docs. Per-well doubling-time metric stays in the
  results table + CSV.

---

## 4. Slice B — Kinetics Report + landmarks (the 0.2.2 content)

Committed on `feature/kinetics-report` as `d26e832` / `f89d888` / `af1b506`. Full
detail in `CLAUDE.md` #53 + #54.

### Shared module → v1.2.0
- `src/lib/curvefit/` gains `onset.ts` / `landmarks.ts` / `melt.ts` / `signal.ts`
  (sha-checked byte-identical with the CLI copy; `fivepl`/`baseline`/`util` already
  matched).
- **Additive** `covarianceAtParams(rfu, timeS, params)` in `fivepl.ts` — per-parameter
  SEs + 6×6 covariance recovered from a fit solved with `computeCovariance` OFF
  (recomputes the residual SS then the SAME numeric Jacobian + one `JᵀJ` inversion;
  **no** multi-start LM re-solve).
- `FREESHOULDER_FIT_VERSION = '1.2.0'` in both this repo and the CLI (`shared_module_
  freeshoulder-fit.md`, both copies in sync). **Do not edit the module here** — it is
  co-maintained with the CLI.

### Kinetics Report
- Role-free orchestrator `src/lib/report/kinetics-report.ts`: per-curve `t_lod` /
  `t_onset10` / `td_5/20/50` / `yield` / `melt_tm` each with an SE (covariance on demand
  + MC-propagated landmark SEs), run-σ pooled over amplifying wells with **no** NTC
  exclusion, plateau-window yield fallback, `+`/`−` call. Reuses the baseline pass's
  WeakMap-cached `FivePLResult` (`AutoFitBaseline` now retains the whole fit) so the
  report never re-solves the LM.
- `KineticsReport.tsx` overlay (Tools → Kinetics Report; store flag `showKineticsReport`):
  amp panel (raw + fit + landmark marks), melt −dF/dT panel, sortable ±SE table with
  row-isolate, collapsed 6-param reconstruction. Compute is rAF-deferred + memoized on
  `(exp, channel)`.
- Standalone self-contained HTML export via `src/lib/report/report-html.ts` +
  `exportReportHtml` in `export.ts`.

### Landmarks in the main app
- `computeChannelLandmarks` (`kinetics-report.ts`) = the report's fit-first pipeline
  minus covariance/MC, gated on `plateauObserved`; shared once via a second context in
  `AnalysisResultsProvider` (`useAllChannelLandmarks` / `useChannelLandmarks`), memoized
  on the experiment (fits already cached).
- **Analysis → Kinetics** (`AnalysisTab`) toggles `t_lod` / `t_onset10` / inflection;
  global `landmarks` state (default off). `PlotArea` draws them on the displayed amp
  curves with one legend entry per shown landmark at the end (`legendrank` 10001+);
  `datarevision` folds `landmarks` so a toggle replots.
- `ResultsTable` gains sortable **t_LoD** / **10%** columns (x-axis time unit); Tt reads
  "—" when threshold detection is off. **Threshold Detection → Thresholds** (amp + melt
  merged).

### Report UX (from live use of the private collaborator/private validation dilution `.sharpx`)
- Group-coloring default; the report reuses the processor's curve colours via the
  extracted shared `src/lib/curve-colors.ts` (`buildColorMap` + `resolveCurveColorWidth`:
  curve → well override → grouped palette).
- Signal baseline-corrected (default) / raw toggle; `t_lod` drawn on censored curves;
  scroll-zoom off; time-unit selector (s/min) + unit-labelled table headers; sample
  toggles redesigned as horizontal Tint tiles (master checkbox + measured uniform width
  via a `--tm` CSS var); clickable landmark POI toggles threaded into the HTML export.

---

## 5. Verification record

- `tsc -b` + `vite build` — **clean**.
- `npm run test:codex` — **12/12**.
- `npm run lint` — **49 problems (zero new)**: the documented pre-existing debt
  (`useBoxSelect.ts` ref-during-render + `_archive.ts` unused-disable). Matches the
  #53/#54 baseline.
- Kinetics engine cross-checked vs the CLI `verify-readouts` on the private validation SYBR
  fixture (representative well / representative well fit-kinetics exact; reused 120-iter cached fit params
  bit-identical to a fresh 200-iter fit; censoring via truncation). See `CLAUDE.md` #53.
- Landmarks verified identical to the full report engine (representative well / representative well); censored/junk
  NTCs (private validation B4/B5) null the fit-derived landmarks.

---

## 6. Release / rollout

**Rollout (superseded the staged-beta precedent):**

- `v0.2.2` was **first published as a Pre-release** with `v0.1.13` kept as "Latest" (so
  the in-app updater, which reads `/releases/latest`, did not prompt existing users).
- **2026-07-06 — Tom promoted `v0.2.2` to "Latest"** (`gh release edit v0.2.2
  --prerelease=false --latest`). `/releases/latest` now → v0.2.2, so existing installs
  DO get the in-app update prompt. The release notes were rewritten with a prominent
  **rollback link to v0.1.13** (v0.1.13 is no longer marked Latest but stays available;
  `.sharp` / `.sharpx` open in both).
- **Never** silently change what is marked Latest — this promotion was an explicit
  decision by Tom, recorded here and in the release notes.

**Merge:** `feature/kinetics-report` → `main` via PR #11, merge commit (revertible,
matching PR #9/#10). Branch kept (not deleted), matching prior convention.

**Windows installers** built via `build.bat` (x64 + x86) → `dist-release/windows-x64/`
+ `dist-release/windows-x86/`. Attached to the GitHub release.

**Mac DMG** — **built + published 2026-07-06 (Mac session).**
`SHARP.Processor.2_0.2.2_aarch64.dmg` built from `main` @ `ce47947` via `./build.sh`
(→ `/tmp/tauri-build-cache`, ad-hoc signed, DMG rebuilt with an Applications symlink,
copied to `dist-release/macos/`), integrity + signature verified (`hdiutil verify`
VALID; `codesign --verify --deep --strict` valid on disk / satisfies its Designated
Requirement), and uploaded to the v0.2.2 release with `gh release upload v0.2.2 …
--clobber`. All five assets now present (Win x64/x86 exe+msi + macOS aarch64 DMG); the
release-page macOS install line names the DMG. macOS live-UI sign-off of the Kinetics
Report / landmarks on WKWebView was **not** run this session (still Windows-verified
only) — see `MAC_BUILD_HANDOFF_2026-07-06.md` §2/§6 if it's picked up later.

---

## 7. File-by-file change map (0.2.2, on top of `main` @ c73cf81)

**New**
- `src/lib/curvefit/onset.ts`, `landmarks.ts`, `melt.ts`, `signal.ts` — shared module v1.2.0 helpers
- `src/lib/report/kinetics-report.ts` — role-free orchestrator + `computeChannelLandmarks`
- `src/lib/report/report-html.ts` — standalone HTML export
- `src/components/KineticsReport.tsx` — report overlay
- `src/lib/curve-colors.ts` — shared curve colour resolution (used by PlotArea + report)
- `docs/RELEASE_v0.2.2.md` — this file

**Modified**
- `src/lib/curvefit/fivepl.ts` — `covarianceAtParams`; `index.ts` — version 1.2.0 + re-exports; `types.ts`
- `src/lib/analysis.ts` — `AutoFitBaseline` retains the full `FivePLResult`
- `src/hooks/useAnalysisResults.ts` — landmarks context in `AnalysisResultsProvider`
- `src/hooks/useAppState.ts` — `landmarks` + `showKineticsReport` state
- `src/components/PlotArea.tsx` — landmarks on amp curves
- `src/components/ResultsTable.tsx` — t_LoD / 10% columns; Tt "—" when off
- `src/components/sidebar/AnalysisTab.tsx` — Kinetics section; Thresholds rename
- `src/components/MenuBar.tsx` — Tools → Kinetics Report
- `src/App.tsx` — mount report overlay
- `src/lib/export.ts` — `exportReportHtml`
- `src/components/UserManual.tsx`, `README.md`, `CLAUDE.md`, `docs/ALGORITHMS.md` — docs
- 5 version-source files (§2)

---

## 8. Post-release fix — `5bd70d0` (on `main`, beta refreshed in place)

Live use of the Kinetics Report on `a private kinetics fixture`
(a 42-well plate with ~19 wells all named "NTC") surfaced two problems.

**Bug — nonsensical NTC onset times.** Two flat NTC wells reported fit-derived
onset times *before the run started*: **F4** `t_onset10 = −78.8 min`, **A5**
`−3.2 min`. Root cause: `timeAtFraction` (t_onset10 + the Td profile) is a
closed-form extrapolation off the warped FreeShoulder sigmoid
(`t(f) = C + ln(S_f/(1−S_f))/B`). A near-flat NTC that the flexible 6-param
model fits as the tail of a heavily-warped curve (F4: fitted yield 172 RFU vs
~5000 real; `foot=0.05`, `shoulder=0.31`, `C=28 min`) places its 10%-of-height
time far outside the data. The fit-kinetics gate was `plateauObserved` alone —
a flat NTC's plateau IS observed, its rise is not, so the extrapolation slipped
through. (`inflectionT` is an argmax over the data window, so it is always
in-range and is NOT a useful discriminator — the closed-form `timeAtFraction`
is.)

**Fix.** A fit-derived TIME landmark is a measurement only when it lands inside
the observed window `[t0, tEnd]`. New `withinWindow` gate in
`kinetics-report.ts` on the fit-kinetics block (`buildRow`) AND on
`computeChannelLandmarks` (the always-on main-app path → on-plot `t_onset10`
markers + results-table `t_LoD`/`10%`), so the censoring is identical
everywhere. Verified on the fixture with a headless harness: F4 + A5
`t_onset10`/`Td`/inflection now null; **every real amplifier and every
genuinely-late NTC is byte-for-byte unchanged** (0 rows left with an
out-of-window `t_onset10`). `t_lod` (a data-threshold crossing, not
fit-derived) is retained. The report footnote now names the second censoring
reason.

**Well column.** The report keyed rows by sample name only, so ~19 "NTC" rows
were indistinguishable. Added a sortable **Well** column (natural A1<A2<A10 via
`wellSortKey`) left of Sample in both the kinetics table and the 6-param
reconstruction table, and in the standalone-HTML export; Well is also a stable
tiebreak for the other sort columns.

**Scope.** App-side report layer only — `src/lib/report/kinetics-report.ts`,
`src/lib/report/report-html.ts`, `src/components/KineticsReport.tsx`. The shared
`src/lib/curvefit/` module (`FREESHOULDER_FIT_VERSION 1.2.0`) is **untouched**.
`tsc -b` + `vite build` clean, codex 12/12, eslint 49 (zero new).

**Rollout.** Committed straight to `main` (post-release beta line, per #47). The
v0.2.2 **Windows installers were rebuilt from `5bd70d0` and re-uploaded in
place** (`gh release upload v0.2.2 … --clobber`); the `v0.2.2` tag stays frozen
at the release commit `0ee94fc`, and **v0.1.13 remains "Latest."** The Mac DMG
is to be rebuilt from `main` (see `MAC_BUILD_HANDOFF_2026-07-06.md`).

**Noted, not fixed (separate item):** the standalone-HTML export renders times in
raw **seconds** under unit-less headers, while the in-app table honours the
s/min selector.
