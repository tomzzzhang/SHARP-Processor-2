# AGENTS.md — SHARP Processor 2

**Last Updated:** 2026-06-25 PST — Claude (branch `feature/ui-ux-enhancements`. **Live-UI tweaks (CLAUDE.md #51)** — (1) all binary **toggles now render as a native checkbox** (red checkmark box) instead of #49's radio-dot (the tri-state per-well auto-baseline stays an `indeterminate` checkbox; real radio groups — baseline Method, X-axis unit — untouched); (2) the **plot gesture-hint moved to the top-right beside the reset/"house" button** at its natural ~house-icon size on a theme-aware translucent chip — `displaylogo:false` makes the house the sole rightmost modebar control, and #50's `extraBottom` bottom-strip reservation was reverted (resolving the original hint↔x-label collision); (3) the in-app **User Manual** mockup updated to match and greyscaled per request. `tsc -b` + `vite build` clean, eslint 50=50 (zero new). **No behaviour change** — presentation only. Live-UI sign-off ongoing via `dev.bat`; installer rebuild pending for merge. Prior: #48 restyle, #49 dialogs/notes + User Manual fact-check, #50 axis-label scaling, #47 v0.2.0 beta post-release fixes.)

The shared project instructions live in [`CLAUDE.md`](CLAUDE.md).

Codex should follow `CLAUDE.md` as the source of truth for project architecture,
build/run instructions, file-format notes, and collaboration rules. Machine-local
details live in `CLAUDE.local.md`, and cross-agent coordination notes live in the
shared OneDrive Markdown folder documented there.
