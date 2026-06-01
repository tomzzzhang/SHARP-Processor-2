# AGENTS.md — SHARP Processor 2

**Last Updated:** 2026-06-01 PST — Claude (v0.2.0 release prep — user-facing docs updated (README / in-app UserManual / RELEASE_NOTES) + cautious **pre-release** rollout decided (v0.1.13 stays "Latest"; Windows-first; Mac DMGs from the tags later); building Windows installers for live-UI sign-off. Batch 4: **performance sweep** — render/interaction smoothness, **no behaviour change**, Mac+PC safe. Plotly no longer full-redraws every render (memoized `usePlotStyle`; data-keyed `datarevision` counter replaces `Date.now()` → hover/selection are cheap restyles); per-well analysis computed **once** via a shared `AnalysisResultsProvider` context instead of in ~8 components; threshold/box-select drags coalesced to `requestAnimationFrame`. tsc + vite build clean, 12/12 regression, no new eslint, live-UI pending. See CLAUDE.md table #46. Prior: batch 3 curve-centric selection #45.)

The shared project instructions live in [`CLAUDE.md`](CLAUDE.md).

Codex should follow `CLAUDE.md` as the source of truth for project architecture,
build/run instructions, file-format notes, and collaboration rules. Machine-local
details live in `CLAUDE.local.md`, and cross-agent coordination notes live in the
shared OneDrive Markdown folder documented there.
