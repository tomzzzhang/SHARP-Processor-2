# Paste everything below into Claude Code

**Last Updated:** 2026-08-05 00:23 EDT

Open Claude Code **in this folder** (the one containing `sharpplot-cli/` and
`sharpplot-skill/`), then paste the whole block below as your first message.

---

I want to install the `sharpplot` skill and its CLI on this Windows machine.
Everything needed is in the folder you're running in — don't download anything.

**What's here**

- `sharpplot-skill/` — the skill itself (`SKILL.md` + `references/`)
- `sharpplot-cli/` — a self-contained Node bundle (`sharpplot.mjs`,
  `plotly.min.js`, `openpgp.mjs`). No `node_modules`, no build step, no network.

**Please do this, checking as you go and telling me if something's wrong
rather than working around it:**

1. **Check Node.** Run `node --version`. It must be **v20 or newer**. If it's
   missing or older, stop and tell me — don't try to install it yourself. I'll
   get it from https://nodejs.org (LTS) and re-run this.

2. **Install the skill.** Copy `sharpplot-skill/` to
   `$env:USERPROFILE\.claude\skills\sharpplot` — so `SKILL.md` ends up at
   `...\.claude\skills\sharpplot\SKILL.md`, with `references/` beside it.
   Create the parent folders if needed. If a `sharpplot` folder is already
   there, tell me before overwriting.

3. **Install the CLI.** Copy `sharpplot-cli/` to
   `$env:USERPROFILE\.claude\tools\sharpplot` — so `sharpplot.mjs` ends up at
   `...\.claude\tools\sharpplot\sharpplot.mjs`, with the other two files
   beside it. Same rule about overwriting.

4. **Smoke-test the CLI.** Run:
   `node "$env:USERPROFILE\.claude\tools\sharpplot\sharpplot.mjs" --help`
   It should print a usage block listing verbs (`inspect`, `figure`, `render`,
   `plot`, `convert`, `group`, `bundle`). Paste me the first few lines so I
   can confirm.

5. **Check for a browser (only needed to render PDFs/PNGs).** The tool looks
   for Chrome, and falls back to Edge, at these paths:
   - `C:\Program Files\Google\Chrome\Application\chrome.exe`
   - `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`
   - `C:\Program Files\Microsoft\Edge\Application\msedge.exe`
   - `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`

   Tell me which of those actually exist. If none do, say so — the data half
   of the tool still works, only rendering to PDF/PNG would be blocked.

6. **Check for `pdftoppm`** by running `pdftoppm -v`. This is **optional**:
   it's only needed for **PNG** output. PDF output works without it. If it's
   missing, just tell me — don't install it.

7. **Report back**: Node version, where the skill and CLI landed, the
   `--help` output, which browser was found, and whether `pdftoppm` exists.

**Please don't** install any software, change PATH or environment variables,
or edit anything outside those two `.claude` folders. If a step fails, stop
and show me the actual error.

---

## After it finishes

Restart Claude Code so it picks up the new skill. Then point it at a data
file — `.sharpx`, `.pcrd`, `.tlpd`, `.eds`, `.amxd`, or a Bio-Rad CFX export
folder — and describe the figure you want. Start with:

> inspect this file and tell me what's in it: `<path to your file>`

## If PNG output matters to you

PNG is rasterized from the PDF by `pdftoppm` (part of poppler), which isn't
on Windows by default. PDF output needs only a browser, and PDF is the better
format for Word/Illustrator anyway — so try PDF first and only chase poppler
if you specifically need PNG.
