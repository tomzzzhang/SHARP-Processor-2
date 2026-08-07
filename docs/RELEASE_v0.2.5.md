# Release v0.2.5 — kinetic landmarks become saved view state (`.sharpx` format 1.3)

**Last Updated:** 2026-08-06 22:32 EDT

Internal record. Public-facing notes live in `README.md` → *What's New in v0.2.5* and on the GitHub release page. Everything below is implementation detail and stays here.

---

## 1. The gap

v0.2.2 (#54) promoted the kinetic landmarks out of the Kinetics Report and into the main app, so `t_lod` / `t_onset10` / inflection could be toggled from **Analysis → Kinetics** and would ride the normal figure-export path. The state backing those toggles was a single **session-global** triple on the store:

```ts
landmarks: { lod: boolean; onset: boolean; infl: boolean }   // transient, app-wide
```

Two consequences, both of them silent:

1. **`.sharpx` did not carry it.** `session.json` is built from `snapshotViewState`, and `landmarks` was not in the view state. Save a session with `t_lod` on, reopen it, and every curve came back — without its markers. Nothing errored; the figure just quietly lost information the user had put there.
2. **The Export Wizard never drew them at all.** `PlotArea.tsx` draws the landmarks for the on-screen plot; the wizard renders through the independent, hook-free `plot-figure.ts` builders, which had no landmark code. So the exported figure disagreed with the screen even within one session.

A third, smaller one: because the toggle was app-wide, turning it on in one tab changed what the user saw in every other open experiment.

## 2. Fix — the state moves, everything else follows

`landmarks` moved out of the transient block of `AppState` and into `ExperimentViewState` ([`useAppState.ts`](../src/hooks/useAppState.ts)), typed as a named `LandmarkVisibility`. That one move buys the whole feature:

- **Per-experiment** — `_experimentSnapshots` already stores one `ExperimentViewState` per tab, and `switchExperiment` already restores it.
- **Saved** — `getSessionState()` is `serializeViewState(snapshotViewState(state))`, so the field lands in `session.json` with no new plumbing. It is a plain JSON-safe object; no Set/Map handling needed.
- **Undoable** — undo entries snapshot the view state, so a landmark toggle is captured like any other view change.

The one place that needed real care is the read path. `resolveExperimentState` builds the view as `{ ...defaultViewState(), ...parsed.view }`, and a spread over a **nested object** replaces it wholesale — a session carrying `{ "landmarks": { "lod": true } }` would leave `onset` / `infl` as `undefined`, and `PlotArea`'s `landmarks.onset` reads would silently behave as false while a `datarevision` fold on the object still churned. So `deserializeViewState` rebuilds it key-by-key:

```ts
if (isRecord(obj.landmarks)) {
  const lm = obj.landmarks;
  out.landmarks = { lod: lm.lod === true, onset: lm.onset === true, infl: lm.infl === true };
} else {
  delete out.landmarks;   // pre-1.3 session → the caller's default wins
}
```

Deleting (rather than defaulting in place) is deliberate: it keeps the "missing key ⇒ caller's default" contract that the rest of `deserializeViewState` already relies on, so there is exactly one place that decides what "off" means.

## 3. Export Wizard parity

[`plot-figure.ts`](../src/lib/plot-figure.ts) `buildAmp` gained two optional inputs:

```ts
landmarks?: LandmarkVisibility | null;
landmarkPoints?: Map<string, WellLandmark> | null;
```

Points are **passed in, not computed**. `computeChannelLandmarks` is already memoized on the experiment and shared through `AnalysisResultsProvider`; recomputing here would burn the work twice and, worse, create a second code path that could drift from the plot's numbers. [`ExportWizard.tsx`](../src/components/ExportWizard.tsx) reads the view-state toggles plus `useChannelLandmarks()` — the same map `PlotArea` marks up.

Placement is a hook-free port of `PlotArea`'s `pointAtSec`. Landmarks are computed **in seconds** while the panel's x-axis may be cycles or minutes, so the time is located in `amp.timeS` and the between-samples fraction is applied to *both* the x series and the plotted y series. That keeps the marker on the drawn curve instead of at a nominal axis coordinate, and it means the marker follows a baseline-corrected or normalized y automatically. Symbols (`triangle-up` / `diamond` / `circle`), the `lm:` legend groups and the `legendrank` 10001+ ordering all match the on-screen traces, so the figure is the same picture.

Two guards worth naming: a well with no entry in `landmarkPoints` contributes nothing (a junk fit must not fabricate a marker), and a landmark trace with zero accumulated points is not emitted at all (no empty legend entry).

The **CLI does not read the key.** A `sharpplot` figure spec states its own landmark rendering; wiring the saved toggles into it would make the same spec render differently depending on which file it was pointed at. `buildFigure`'s new fields are optional and the CLI simply omits them.

## 4. Format 1.3 and why the version had to move

[`sharp-writer.ts`](../src/lib/sharp-writer.ts):

```ts
format_version: session ? '1.3' : multichannel ? '1.2' : '1.1',
```

The version is keyed on **`session` being present**, which is exactly "this is a `.sharpx`". Plain `.sharp` archives carry no `session.json` and are byte-for-byte unaffected — still 1.2 multichannel, 1.1 single-channel. `MAX_SHARPX_FORMAT` in [`version.ts`](../src/cli/version.ts) was bumped to `1.3` in the same commit; that pairing is the entire mechanism behind the CLI's format gate.

The bump is unconditional for `.sharpx` rather than "only when a landmark is on". A version that depends on a UI toggle is not a version — it makes "what format is this file" unanswerable without opening it, and it makes the gate untestable. The cost is real and known: **an older `sharpplot` build now stops on every newly-saved `.sharpx`**, including ones where nothing about landmarks matters to it. That is the gate working as designed (refuse rather than guess), and for this particular bump `--allow-newer-format` is genuinely safe, because the CLI never reads the new key. Both facts are documented in `SHARP_FORMAT.md` and `SHARPPLOT_MANUAL.md` so the escape hatch is not folklore.

## 5. Gates

Eight new cases in `test:codex` (20/20 green):

| Test | What it pins |
|---|---|
| landmarks live in the per-experiment view state | `ExperimentViewState` declaration + `snapshotViewState` + `defaultViewState` |
| per-experiment, not session-global | two tabs, toggle in one, switch back and forth |
| `.sharpx` save/reopen preserves the toggles | store → `getSessionState` → zip → production loader → `resolveExperimentState`, plus the `1.3` stamp |
| pre-1.3 session restores landmarks off | legacy `session.json` with no `landmarks` key; the rest of the session still restores |
| plain `.sharp` keeps its version | still `1.1`, still no `session.json` |
| CLI gate bumped in step with the writer | `MAX_SHARPX_FORMAT === '1.3'`, `isNewerFormat('1.4')`, and the writer's literal |
| exported figure draws the enabled landmarks | only the enabled ones, at the interpolated `(x, y)` on the curve, none without landmark data |
| Export Wizard wiring | reads both the toggles and the shared map, passes both, memo depends on both |

One harness change was needed: the `.ts` loader now rewrites `import.meta.env` to `({ DEV: false })` before compiling. `useAppState.ts` has a Vite dev-only `if (import.meta.env.DEV)` block that attaches the store to `window`; `import.meta` survives transpilation, Node then classifies the module as ESM and refuses the CommonJS `exports` it had just emitted. Same spirit as the existing Tauri / Plotly stubs.

`tsc -b`, `lint` (no new findings — 48 pre-existing problems, none in touched files), `test:codex` 20/20, `test:sharpplot` 5/5.

## 6. Also in this release

The `sharpplot` reusable-figure hardening (CLAUDE.md #59) had been sitting uncommitted in the working tree and shipped in the same commit: format-2 portable bundles with embedded image panels and build provenance, path-free public source manifests backed by a private `SHARPPLOT_SOURCE_MAP`, the `verify` / `archive` / `hash-source` verbs, and the synthetic `test:sharpplot` gate wired into CI and the packaging scripts. CLI-only — no GUI change.

## 7. Build + release

- macOS (Apple Silicon) DMG built from tag commit `d38fd17` with `./build.sh`; `hdiutil verify` and `codesign --verify --deep --strict` passed.
- Windows x64/x86 NSIS and MSI installers were rebuilt from `d38fd17` and uploaded on 2026-08-06. The release now has six assets total: four Windows installers, the macOS DMG, and `sharpplot.skill`.
- The Windows build matched the release gates exactly: `test:codex` 20/20, the tag's `test:sharpplot` 5/5, and the documented eslint baseline of 48 findings. The human WebView2 smoke test remains open.
- Windows installers and Apple Silicon DMGs for v0.1.13, v0.2.0, v0.2.2, v0.2.3, and v0.2.4 were rebuilt from their scrubbed tags and restored to their releases. Each DMG was built in an isolated worktree with the tag's exact lockfile, passed `hdiutil verify`, and contained an arm64 app with the matching bundle version that passed `codesign --verify --deep --strict` and satisfied its Designated Requirement. The uploaded assets were downloaded again and matched the verified local files byte-for-byte.
- Historical DMG SHA-256: v0.1.13 `ddbf4418fd976783cb7a470b8f542881c3bfa94b3badda7a9ed23f881352cff5`; v0.2.0 `b04cabe0cd0f6056c5d58c1ca049f4c72e59c6c3fe65ce5120c9c1467c32e7f4`; v0.2.2 `069f2d9d208f642ec5da5be121c26c4705811f9af982051d92dba3489d0e7b8e`; v0.2.3 `4da80f436845b29cae259b4063829d3441142d26cbec4c200e329871a18b3bf0`; v0.2.4 `5363a26fe9349deed903f6efdb07aeb0a19324253cca3167073e34b005aea63f`.
- The current customer/private denylist was applied to every tag and its reachable history before building. Its structural policy separately identified a machine-specific path in the historical developer-only `test-parsers.mjs`; that file is not referenced by the build and was confirmed absent from every shipped app bundle. No customer denylist term was found.

## 8. Post-release SharpPlot refresh and lockfile correction

The desktop tag remains `v0.2.5` at `d38fd17`; the released app binaries were not rebuilt or changed for this follow-up.

- `sharpplot` gained native fitted curves, selectable kinetic landmarks, residuals, Tm marks, Kinetics Report tables, and fit-parameter tables in follow-up commit `2e6ad9a`. The self-contained `sharpplot.skill` release asset was rebuilt from the clean follow-up state and replaced in place. It still reports Processor 0.2.5 and supports `.sharpx` through format 1.3.
- `package-lock.json` had been missed during the original version bump. Its root version and `packages[""]` version are now 0.2.5, restoring the five-version-source invariant. This metadata-only fix does not change the already-built installers.
- Follow-up gates: app build clean, `test:codex` 20/20, `test:sharpplot` 6/6, historical figure parity 4/4 byte-identical, skill validation and privacy checks clean.
