# sharpplot in Claude Cowork — the recommended path for the team

**Last Updated:** 2026-08-05 17:44 EDT

**One file to upload. Nothing to install. No Node, no Chrome, no PATH.**

The Cowork build of the skill carries the engine inside it: `SKILL.md`, the
reference docs, and a `bin/` folder holding the whole CLI (`sharpplot.mjs`,
its side chunks, and `plotly.min.js`). Claude finds it beside `SKILL.md` and
runs it in the sandbox. Nobody has to touch a terminal.

## Build the file

On a machine with the repo:

```bash
npm run skill:pack:cowork
```

Writes `dist-skill/sharpplot-cowork.skill` (~1.9 MB). It is build output, not
tracked — rebuild it rather than keeping a copy around, so what gets uploaded
is always current. That is the whole point: the old "send a folder" bundle
could silently drift from the repo, and this cannot.

## Upload it

In claude.ai → **Settings → Capabilities → Skills → Upload skill**, pick
`sharpplot-cowork.skill`. Anyone in the workspace it is shared with gets it;
there is nothing further for them to do.

## Use it

Attach a data file to the conversation — `.sharpx`, `.sharp`, `.pcrd`,
`.tlpd`, `.eds`, `.amxd`, or a zipped Bio-Rad CFX export folder — and describe
the figure:

> inspect this file and tell me what's in it

> amplification plot from that, 3.4 inches wide, PDF and PNG

Claude renders it, shows the PNG, and you react. You never see or edit a spec
file.

## Verify the sandbox once, before promising anyone it works

The one thing that cannot be checked from outside is what the Cowork container
actually has. Upload the skill, start a conversation, and ask:

> run these and paste the output:
> `node --version`
> `ls /opt/pw-browsers/chromium-*/chrome-linux/chrome /root/.cache/ms-playwright/chromium-*/chrome-linux/chrome /usr/bin/chromium 2>/dev/null || echo "no browser"`
> `which pdftoppm || echo "no poppler"`

Read the result against this table:

| Result | What works |
|---|---|
| Node 20+, a chromium, `pdftoppm` | everything — PDF and PNG |
| Node 20+, a chromium, no `pdftoppm` | PDF only. Ask for `"formats": ["pdf"]`. PDF is the better format for Word and Illustrator anyway |
| Node 20+, no browser | the data half only — `inspect`, `figure`, `convert`, `group`. Claude can write the figure and hand back a `fig.json` to render on a Mac |
| Node older than 20, or no Node | nothing runs. Use the Claude Code path instead |

`render` finds those browser paths by itself; the check is only so you know
what to expect.

## Two things worth knowing

- **Arial is substituted in the sandbox.** Linux resolves Arial to Liberation
  Sans, which is metrically identical — every dimension, margin and alignment
  is right — but the letterforms are not pixel-identical. Fine for review and
  for iterating. A final publication render belongs on a Mac with real Arial.
- **Third-party confidential data.** Attaching a file to a Cowork conversation puts it in that
  workspace. Check authorization before uploading anything that is not ours.

## If you would rather use Claude Code

See `PROMPT — paste into Claude Code.md` in this folder. That path needs Node
20+ installed locally and works offline, but it is a terminal workflow — use
it if you already live in one. A third option, now that the repo is public:
clone it and run `npm install && npm run cli:build`.
