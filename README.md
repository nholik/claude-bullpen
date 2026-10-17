# claude-bullpen

**Bullpen** is a [Claude Code](https://claude.com/claude-code) mod that gives you a live, at-a-glance view of your agent team in the terminal. It's like walking into an organized office: you see who is huddled on which issue, what got sent back, what teammates are saying to each other, and how the burndown is going.

> Status: functional prototype. The images below are deterministic previews; real-terminal UX and Windows Terminal verification remain ongoing.

![Bullpen at 72 pane columns](docs/img/bullpen-72.png)

The header surfaces the next decision and issue progress. Huddles show who is
pairing, where work was sent back, and which issue has stalled. The hallway wakes
when a teammate speaks and collapses after three quiet minutes. Sprites walk
between tables; message dots and close confetti show activity without reading logs.
Morale changes the floor lighting and suggests one check-in. Press a huddle heading
for its cross-agent story, or a teammate name for Claude's transcript.

![Studio theme at 160 pane columns](docs/img/studio-160.png)

## Requirements

- Claude Code 2.1.302 (the version used by CI and this release). Older mod-capable builds are not validated.
- Agent teams enabled. In `~/.claude/settings.json`:
  ```json
  { "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1", "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }
  ```
- A terminal with 24-bit color. Linux terminal captures are verified; Windows Terminal is a target awaiting machine verification.
- Optional, for the burndown: the `gh` CLI, signed in.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin marketplace add nholik/claude-bullpen
/plugin install bullpen@claude-bullpen
```

From a shell:

```
claude plugin marketplace add nholik/claude-bullpen
claude plugin install bullpen@claude-bullpen
```

The marketplace name is `claude-bullpen`, and its root plugin is `bullpen`.
In-session installation opens a details panel; select an install scope and follow
any reload instruction. Syntax checked against the official
[installation documentation](https://code.claude.com/docs/en/discover-plugins).

## Use it at work

Use Claude Code 2.1.302 with mods permitted by your organization's policy. Enable
agent teams before starting Claude Code. For the current PowerShell session:

```powershell
$env:CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1"
gh auth login
claude
```

For GitHub Enterprise, authenticate against its host instead:

```powershell
gh auth login --hostname ghe.example.com
```

Bullpen uses the repository resolved by `gh repo view`, including `GH_HOST` when
gh uses it. Its API requests and stored history retain the resolved host. The
read-only GitHub commands are compatible with gh 2.4.0; newer gh is fine too.
Use the normal repository checkout as Claude's working directory.

Put this optional profile in the project's `.claude/bullpen.json`:

```json
{
  "issues": { "filter": "label:sprint-12", "pollSeconds": 60 },
  "glyphs": "ascii",
  "animations": true
}
```

Run `/bullpen` to open the pane, `/bullpen demo` to check it without a live team or
GitHub access, and `/bullpen reload` after editing the profile. `/bullpen live`
returns to the real team. Long asks and story entries wrap; hallway rows remain
single-line. Story panes show the most recent events within their available rows.

When GitHub data is unavailable, the header reports `gh not installed`,
`gh not signed in`, `GitHub SSO authorization required`, `GitHub rate limited`,
`not a GitHub repo`, or `GitHub network unavailable` (timeouts say `gh timed out`).
Unexpected failures show a short gh error. Failed automatic polls back off to
at most ten minutes unless the configured interval is already longer. Successful
automatic polls restore the configured cadence. If exact search totals fail for a
full issue list, the header shows `200+ issues (counts unavailable)`.

Troubleshooting:

- No `/bullpen` command or band: check the Errors tab in `/plugin` and the debug
  log. When managed policy blocks user mods, the guard message names the mod and
  `allowManagedModsOnly`; its hooks do not run. Ask the administrator whether
  Bullpen is permitted. See the official
  [mod policy documentation](https://code.claude.com/docs/en/plugins/mods/admin).
- Glyph boxes or poor font rendering: set `"glyphs":"ascii"`, then `/bullpen reload`.
- Sign-in or SSO: authenticate to the repository's host and authorize the account
  or token for the organization. Use `/bullpen live` for an immediate retry.
- No teammates: the band appears after a teammate joins; `/bullpen demo` checks
  rendering independently. A policy-blocked mod cannot run the demo either.

Windows path handling has automated drive/UNC tests. Real Windows Terminal fonts,
Windows filesystem access and a SAML-protected Enterprise deployment still need
target-machine verification. Known follow-ups are tracked in [#44](https://github.com/nholik/claude-bullpen/issues/44)
through [#47](https://github.com/nholik/claude-bullpen/issues/47), plus
[#52](https://github.com/nholik/claude-bullpen/issues/52) for Unicode teammate names in ASCII story links
and [#53](https://github.com/nholik/claude-bullpen/issues/53) for an unnecessary overflow row in exact-fit stories.

## Appearance and terminal setup

The default `"style":"studio"` draws teammates at desks, recent messages on the
work surfaces, a quiet lounge, and completion effects. For an abstract work
console, use `"style":"operations"`: sharp text workstreams, agent nodes, a live
agent register, a decision queue, and a timestamped event trace. This view uses
only terminal glyphs, with an ASCII fallback; it does not require image support. Set either in project
`.claude/bullpen.json` or the user profile, then `/bullpen reload`:

```json
{ "style": "operations", "glyphs": "unicode", "animations": true }
```

![Operations console in the actual terminal](docs/img/operations-glyphs-terminal.png)

[80-column layout](docs/img/operations-glyphs-80.png) · [ASCII fallback](docs/img/operations-glyphs-ascii.png)

The side-by-side studio/topology layout starts at **110 pane-body columns and
28 rows**. Aim for **160 columns and 40 rows in the pane** for more space; Claude's
conversation and chrome also need room in the terminal window. Smaller panes
use a compact floor and cards. `f`, `h`, and `t` focus a region when space is tight.
The animated floor uses ordinary single-cell text and half-blocks; no Nerd Font,
emoji, graphics protocol, or font installation is required.

Recommended GNOME Terminal profile (personal preference; nothing is changed automatically):

- In **Preferences → profile → Text**, try an installed fixed-width font such as
  DejaVu Sans Mono at 11–12 pt. Keep **Cell spacing** width and height at **1.0**
  so pixels and borders meet. See [GNOME's font/spacing settings](https://help.gnome.org/gnome-terminal/app-fonts.html).
- Use a dark background with light text; `#101923` is a good starting point for
  matching the floor. Turn off **Show bold text in bright colors** to keep weight
  independent of color. See [GNOME's color settings](https://help.gnome.org/gnome-terminal/app-colors.html).
- Keep the background opaque and give the pane enough room before shrinking the
  font. Enlarged line spacing can introduce visible seams in half-block sprites.

For Windows Terminal, start with **Cascadia Mono**, normal weight, around 12 pt.
Use an opaque dark background with background images and retro effects off.
These are profile appearance options, described in
[Microsoft's settings reference](https://learn.microsoft.com/en-us/windows/terminal/customize-settings/profile-appearance).
No PowerShell-specific rendering settings are needed. Native Windows font and
raster rendering still require a check on an actual Windows machine.

Graceful fallbacks:

- `"glyphs":"ascii"` replaces the pixel floor with a readable one-row team strip,
  and uses ASCII borders and symbols throughout both styles. It retains issue
  and teammate links in the cards.
- `"animations":false` keeps the same information in a static view.
- Narrow or short panes show compact cards and explicit overflow counts. On
  surfaces without Raster support, text regions use the available space.
- Status labels accompany color; active, idle, review and decision states do not
  depend on color alone. External names and titles are sanitized to single-cell
  glyphs.

If using tmux, the full palette needs RGB support through tmux as well as the outer
terminal. The screenshot helper uses a separate tmux server with RGB enabled and
leaves your normal tmux configuration alone. The app cannot reliably identify a
broken font; choose ASCII mode explicitly if you see missing glyphs or gaps.

## Use

- `/bullpen` opens the Bullpen pane.
- `/bullpen demo` plays an 80-second scripted team without model calls or GitHub requests. `/bullpen live` restores live data; real observers continue recording during the demo.
- Demo beats: pairing/kickback at 7s, ask at 16s, quiet/stall at 25s, hallway wakes at 35s, issue closes at 55s and 70s, newcomer at 72s. At 25s its simulated clock advances 21 minutes. The final scene stays visible until `/bullpen live`.
- Once a teammate joins, a one-line band shows the team above the prompt. Press `# bullpen` in the band to open the pane.
- Ask Claude to spawn named teammates, for example "Spawn teammates named smith and gate to work on #12 and #14". Each teammate appears on the floor at its issue's table, and bobs while it's working.

## Configure

Optional. Put a `bullpen.json` in your project's `.claude/` folder (`/bullpen reload` rereads it). Every field is optional; a bad field falls back to its default and shows a toast.

```json
{
	"issues": { "filter": "label:sprint-12", "pollSeconds": 60 },
	"roles": {
		"smith": { "role": "builder", "color": "#4fc3f7" },
		"gate": { "role": "reviewer", "color": 3 }
	},
	"animations": true,
	"glyphs": "unicode",
	"palette": ["#4fc3f7", "#ffb74d", "#81c784", "#f06292"]
}
```

- `issues.filter`: a `gh search issues` query (default empty: all issues). State qualifiers are removed so the burndown includes both open and closed issues.
- `issues.pollSeconds`: how often GitHub is polled (default 60, minimum 15).
- `roles`: a teammate name or agent type to `{ role, color }`. `color` is `#rrggbb` or an index into the palette.
- `animations`: set `false` to stop the floor animating (default `true`).
- `style`: `"studio"` (default) shows the animated office; `"operations"` uses abstract workstream nodes and console labels.
- `glyphs`: `"unicode"` (default) uses portable single-cell symbols; `"ascii"` uses plain ASCII for fonts that show boxes.
- `palette`: member colors selected by stable teammate name, as `#rrggbb` (default: the built-in palette). Bad entries are dropped with a warning; an empty list keeps the default.

Role colors are shared by the floor, band, huddles and issue stories.

Pane controls: `f` floor, `h` huddles, `t` talk; press again or `r` to restore.
These keys work while the pane has keyboard focus. Escape returns keyboard focus
to Claude (the mod API does not deliver it). `/bullpen focus floor|huddles|talk|all`
also works from the prompt. The full pixel floor fits pane bodies from 48 columns;
huddles and hallway sit side by side from 60 columns.

`/bullpen story #208` opens a second pane with the issue’s cross-agent journal
and GitHub state. Press a huddle heading to open its story, or a teammate name
to open Claude’s own transcript. `r` returns from the story. The journal only
contains files/details the collector recorded; it does not reconstruct transcripts.

## Develop

Requires Node 24+. Claude Code is needed for live use and the real plugin tests; the preview is engine-free.

```sh
npm install                    # dev tools: Biome, TypeScript 7, esbuild
claude --plugin-dir .          # load from this folder; hot-reloads on save
npm run check                  # lint + typecheck + vendor check + validate + tests
npm run format                 # Biome format and safe fixes
```

`tsc -p .` (and `npm run check`) needs the API types, which Claude Code writes to `.claude-plugin/types/` (gitignored) the first time it loads the mod.

Preview at a timestamp, export to PNG, or produce animation frames:

```sh
node --experimental-strip-types scripts/preview.ts --cols 72 --rows 32 --at 16 --out .scratch/preview/pane.ansi
python3 scripts/ansi2png.py .scratch/preview/pane.ansi .scratch/preview/pane.png
node --experimental-strip-types scripts/preview.ts --cols 72 --at 55 --frames 24 --out .scratch/preview/close.ansi
node --experimental-strip-types scripts/preview.ts --cols 72 --at 80 --story 204 --out .scratch/preview/story.ansi
```

Omit `--out` to print truecolor ANSI. Frames are 100 ms apart. Check pane body
widths 60, 72, 80, 100, 110 and 160: a 160-column terminal may give the pane only
72 columns. The preview and live demo share collector replay, GitHub parsing,
clock, view-models and animation sampling. PNG conversion uses Pillow and a local
monospace font; the committed images are previews for the lead to replace later.

**Borrowed libraries.** A mod can only import its own files and `claude-code`, so npm libraries are compiled into self-contained modules under `src/vendor/` by `npm run vendor` and committed. The source imports them by relative path. Versions are pinned in `package.json`, and licenses are collected in `src/vendor/LICENSES.md`. To borrow something, add it to `dependencies` and to `scripts/vendor.mjs` (exporting only what's used), write a `.d.ts` beside it, then run `npm run vendor`. Borrowed so far: `culori` (color mixing), `string-width` (display width), `valibot` (schemas), `pathe` (Windows-safe joins), `wrap-ansi` (story/ask wrapping).

Layout:

```
.claude-plugin/   plugin.json, marketplace.json
hooks/            hooks.json + register.tsx (wires events, commands, drawing)
src/              events.ts (normalizing), floor.ts (pixel floor), color.ts
src/vendor/       compiled third-party code (generated; don't edit)
scripts/          vendor.mjs
types/index.d.ts  the mod's state contract
tests/            claude plugin test suites
docs/design.md    design, mockups, build phases (planned files live there)
```

## License

[MIT](LICENSE)
