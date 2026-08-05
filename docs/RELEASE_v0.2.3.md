# SHARP Processor 2 — v0.2.3 (Kinetics Report: residuals + melt-Tm hover + data/fit) — Dev Documentation

**Last Updated:** 2026-08-05 00:23 EDT — Claude (Mac session — cut v0.2.3: committed the report work + version bump (`32f5faf`), tagged `v0.2.3`, built + verified the macOS aarch64 DMG, and published the **`v0.2.3` GitHub pre-release** with the DMG. `v0.2.2` stays "Latest"; the Windows installers were then built + uploaded (Windows session, from `3ee52ac`) so v0.2.3 now carries all 5 assets; it was then promoted to the **"Latest"** release (`gh release edit v0.2.3 --prerelease=false --latest`; `v0.2.2` no longer Latest but kept available for rollback) — see OneDrive `WINDOWS_BUILD_HANDOFF_2026-07-06.md`.)

> This is the **internal** engineering record for 0.2.3. User-facing notes live in
> `README.md` ("What's New in v0.2.3") and the GitHub release body.

---

## 1. Headline

v0.2.3 is a focused update to the per-curve **Kinetics Report** (Tools → Kinetics
Report) and its shareable HTML export. The shared `curvefit/` module
(`FREESHOULDER_FIT_VERSION 1.2.0`) and everything else since v0.2.2 (multichannel,
FreeShoulder auto-baseline, CSV export) are **unchanged**. All changes are app-side
React/TS and therefore identical on the Windows and macOS builds.

Four things:

1. **Residual strip** — click a sample's row → a thin plot below the amp panel of
   `observed − fit` with a ±1 run σ band; a censored curve (no plateau) states why
   instead of silently omitting the fit.
2. **Melt Tm on hover / click** — hover a melt curve, or click its row, to highlight
   it and show its Tm at the peak (replaces always-on labels that overlapped when
   Tms clustered).
3. **Data bold / fit faint** — raw data is the prominent line; the fit is a fainter,
   thinner overlay. New Data / Fit / landmark toggle checkboxes.
4. **User Manual "Methods: Fitting & Statistics"** section.

---

## 2. Version bump (single source of truth = 5 files)

Bumped **0.2.2 → 0.2.3** in lockstep: `package.json`, `package-lock.json` (root +
`packages[""]` — the coincidental `stdin-discarder@0.2.2` dep left untouched),
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
(`name = "app"`). `APP_VERSION` (UI) auto-syncs from `package.json` via the Vite
`__APP_VERSION__` define; `build.sh` / `build.bat` derive the installer version from
`tauri.conf.json`.

---

## 3. Changes (all in the Kinetics Report layer)

### 3.1 Residual strip — `KineticsReport.tsx` + `report-html.ts`
- Clicking a table row (`selected`) shows a thin residual plot below the amp panel:
  `residual = rawRfu[i] − curveAt(timeS[i], fitParams)` (display-invariant — the
  baseline offset cancels), rendered with a **±1 run σ** shaded band and a zero line;
  y-range auto-fits to `max(4·runσ, 1.1·max|resid|)`.
- Only curves with a usable fit have residuals (same gate as the drawn fit line). A
  censored curve shows a flagged note via a shared **`fitCensorReason(row)`** helper
  (`kinetics-report.ts`): `fit_A === null` ⇒ "did not converge"; `!plateau_observed`
  ⇒ **"No plateau observed — the curve has not leveled off … can't be pinned down"**
  (the common "looks perfect but still rising" case); else "transition outside the
  measured window". Used by BOTH the in-app strip and the export (single source of
  wording).
- Export (`report-html.ts`): pre-computes per-curve residuals + notes, embeds them,
  and a hidden "Residuals" card renders the selected curve's strip (or the note) via
  the existing row-click `setIso` handler. `runSigma` threaded through
  `buildReportHtml` for the ±band.

### 3.2 Melt Tm on hover / click — `KineticsReport.tsx`
- The highlighted melt curve is `meltHover ?? selected`: clicking a sample row
  highlights its melt curve (others dim) and shows its **Tm callout at the peak**,
  mirroring the amp isolation; hovering peeks transiently.
- **Bug fixed — the callout vanished on selection switch.** Root cause is a
  `Plotly.react` quirk: a 1→1 annotation change combined with a trace-data change is
  dropped (reproduced against raw `Plotly.react`; adding `Plotly.relayout` after it
  restores the annotation). Fix: the callout annotation (`meltAnns`) is re-applied via
  an explicit **`Plotly.relayout` in a `useLayoutEffect`** (runs after react-plotly's
  internal `Plotly.react`), with the graph div captured through `onInitialized` /
  `onUpdate`. Hover flicker additionally handled by a debounced `unhover` (120 ms) +
  `captureevents: false` on the annotation. Clicking a row clears `meltHover` so
  selection always wins.
- Replaced the previous always-on Tm labels (which overlapped into a smear when melt
  temperatures clustered — e.g. the length-test plate: five Tms 85.5–87.5 °C, 0.5 °C
  apart).

### 3.3 Data bold / fit faint + toggles — `KineticsReport.tsx` + `report-html.ts`
- Amp panel: raw **data** drawn width 1.8 / full opacity (the ground truth); **fit**
  width 1 / 0.5 opacity (fainter, thinner overlay). Flipped in BOTH the in-app report
  and the export (line weights + the export legend swatch stroke-widths).
- New `showData` / `showFit` state → the raw / fit traces carry `visible`. The legend
  row is now **checkboxes**: Data (thick line swatch), Fit (thin faint swatch), and a
  checkbox to the left of each landmark (▲ t_lod / ◆ t_onset10 / ● inflection). The
  export already had data/fit/landmark checkboxes; only its swatch weights flipped.

### 3.4 Docs — `UserManual.tsx`
- New **"Methods: Fitting & Statistics"** section: the FreeShoulder model equations +
  parameter table, the multi-start LM fit + fitted-`A` baseline, the noise-floor
  statistics (1.4826·MAD of pre-onset differences → per-well σ → median run σ), the
  LoD rule (8·run σ, two-point confirmation, SE), the closed-form `t_onset10` / `Td`
  formulas, the covariance + Monte-Carlo SEs, residuals, and the censoring rules.
- Kinetics Report + Melt panel bullets updated (hover/click Tm, data-bold/fit-faint,
  Data/Fit/landmark toggles).

---

## 4. Verification record

- `tsc -b` + `vite build` — **clean**.
- `npm run test:codex` — **12/12**.
- `npx eslint .` — **49 problems (zero new)** — the documented pre-existing debt.
- Melt Tm declutter / hover / the `Plotly.react` annotation-drop bug were reproduced
  and the fixes validated in an isolated Plotly harness (real length-test melt data);
  the exported-report `renderResid` JS was runtime-checked (mocked DOM) on both the
  plotted and the no-plateau-note paths.
- macOS live-UI sign-off in `dev.sh`: residual strip, no-plateau flag, melt Tm
  click/hover (reliable across switches), data-bold/fit-faint, Data/Fit/landmark
  toggles all confirmed on WKWebView.

---

## 5. Release / rollout

- `feat(report): … (v0.2.3)` committed to `main` as **`32f5faf`** (post-release beta
  line, per #47), pushed. Tag **`v0.2.3`** (== `32f5faf`), pushed.
- **macOS DMG** built on the Mac via `./build.sh` from `32f5faf`
  (`SHARP.Processor.2_0.2.3_aarch64.dmg`), `hdiutil verify` VALID + `codesign
  --verify --deep --strict` clean, and **attached to the v0.2.3 pre-release**
  (`gh release create v0.2.3 … --prerelease`).
- **Windows installers** are built separately on the PC (no Windows in this session)
  — see OneDrive `WINDOWS_BUILD_HANDOFF_2026-07-06.md` for the exact steps (build.bat
  → upload the four assets → **promote v0.2.3 to "Latest"** + tidy the README).
- `v0.2.3` stays a **pre-release** and `v0.2.2` remains **"Latest"** until the Windows
  installers are up and Tom promotes — so existing (mostly Windows) installs are not
  prompted to update to a release that lacks a Windows installer.

---

## 6. File change map (0.2.3, on top of `main` @ `33c2a89`)

**Modified**
- `src/components/KineticsReport.tsx` — residual strip; melt Tm hover/click + the
  `Plotly.relayout` annotation fix; data/fit weights + toggles
- `src/lib/report/report-html.ts` — residual card + `renderResid`; `runSigma`;
  data/fit weights + legend swatches
- `src/lib/report/kinetics-report.ts` — `fitCensorReason` helper
- `src/components/UserManual.tsx` — "Methods" section + report/melt bullets
- 5 version-source files (§2)
- `README.md`, `CLAUDE.md`, `docs/RELEASE_v0.2.3.md` (this file), doc timestamps

The `curvefit/` module is **untouched** (`FREESHOULDER_FIT_VERSION 1.2.0`).
