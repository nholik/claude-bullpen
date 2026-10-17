# Bullpen design

This is the design that came out of the planning session on 2026-10-17. Mockups are targets, not specs: build toward them and adjust them as you dogfood.

## Context
The user runs agent teams (now enabled in `~/.claude/settings.json`) and wants to point them at
GitHub issues. Claude Code's own UI already drills into single agents; what's missing is the
**overview**: walking into an organized office and seeing at a glance who is huddled on which
issue, what got kicked back, what teammates are saying to each other, how the burndown is going,
and whether morale is good or the office needs help. TUI-first (GNOME Terminal at home, Windows
Terminal/PowerShell at work); browser not a goal but not precluded. The MVP is a base to morph
per use case (home vs work, different team shapes), pushed to a repo the user will create, then
built further *by an agent team watching itself in the mod* (dogfooding).

Design converged over 4 rounds of mockups: V1+V2 blend (desk cards with relationship tags,
grouped into huddles by issue — a swarm, not a pipeline), Riff 1 header + auto-waking hallway,
plus a live pixel floorplan with light animation as the "wow".

## Target layout (one pane, regions expand/focus)
```
┌ Bullpen · label:bug · 5/12 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ☀ 14:32 ┐
│ ⚑ gate: "#204 flaky test — skip or fix?"                 [1] answer │
│▐   ╔═#208═╗   ·  ✉ · ·   ╔═#204═╗         ╔═#217═╗    ░DONE 7░  ▌│  floor (Raster,
│▐  ●smith ●ada ────────▶   ◐gate             ●lead     ░░░░░░░░  ▌│  half-block pixels)
│▐    ◐iris ↺      ○scout             ✓#199 ✦·✦ ──▶              ▌│
├ Huddles ───────────────────────────────┬ Hallway ▾ live ───────────┤
│ ╭ #208 auth redirect · 3 · 22m ↺1 ▁▃▅▇╮│ gate → smith ↺ test_log… │
│ │ ●smith ⇄ ●ada  ◐iris ↺              ││ iris → lead  #199 ✓ …    │
│ ╰─────────────────────────────────────╯│                           │
├────────────────────────────────────────┴───────────────────────────┤
│ burndown 12 ▇▇▇▆▆▅▄▃▂┄┄ 5 · pace ~45m      f floor h huddles t talk │
└────────────────────────────────────────────────────────────────────┘
band above prompt:  ☰ bullpen ☀  ●#208×3  ◐#204⚑  ✉2  5/12 ▂▃▄   (press → open pane)
```
- `f`/`h`/`t` focus a region full-pane, again to restore; `Esc` back. Ellipses for overflow.
- Narrow (<110 cols): floor collapses to a 1-row strip, huddles stack.
- Huddle press → **issue story** (cross-agent timeline for one issue: assigned, edits, verdicts,
  kickbacks, messages about it, GH state). Teammate press → Claude's own transcript via
  `$.ui.view({ agentId })` (reuse, don't rebuild). Hallway auto-expands on recent messages,
  collapses to one line after ~3 min quiet.

### Eye candy — MVP set (restrained)
- Per-teammate color identity everywhere (sprite, name, tags, sparkline).
- Sprite **walks** between issue tables when a teammate's issue changes; **message dot**
  travels sender→receiver in sender's color; kickback = red spark.
- Issue close: table flashes green + small confetti burst, slides into DONE pile; burndown ticks.
- Change-glow: card border bright → dim over ~60s.
- **Morale**: score from closes(+), kickbacks/failing gates(−), open "needs you" asks(−),
  stalled huddles(−), idle-while-work-open(−). Shown as floor lighting warmth/dimness + header
  glyph `☀ ☁ ☂ ☇`. Low morale → header hint ("#204 stalled 20m — check in?").
- Animation loop runs only while tweens are active (`$.clock.every(66)` + `$.ui.blit`), stops
  when idle. Toggle `animations: off` in config.

### Terminal compatibility (GNOME Terminal/VTE + Windows Terminal)
Both do 24-bit color, half-block `▀▄█▌▐`, box drawing. Use only width-1 glyphs (no emoji);
avoid braille for core visuals (font-dependent on Windows). No kitty `Image`. Keyboard-first
(hotkeys); hover cards are a bonus where the fullscreen terminal reports the mouse. Verify on
both in Phase 0.

## Architecture (layers so it can morph later)
1. **Collector** (`src/collect.ts`) — hooks normalize engine events into `BullpenEvent`s:
   `agent.spawn` (teammate joined, name/role), `turn.start`/`turn.complete` (busy/idle by
   `agentId`), `tool.call` observe-only (Edit/Write → files; Bash `gh`/test runs; TaskCreate/
   TaskUpdate → task + issue refs), `session.send` (hallway message, from/to/text), periodic
   `$.agent.list()` reconcile for status. Never blocks or rewrites; always `return next(e)`.
2. **Journal** (`src/journal.ts`) — ring buffer in `$.state`, appended to
   `~/.claude/bullpen/<team>/events.jsonl` via `$.fs` (replay, tests, future browser view).
3. **Model** (`src/model/*.ts`) — pure reducers `events → BullpenModel` { teammates, huddles
   (by issue), hallway, issues/burndown, asks, morale }. Issue attribution: `#N` refs in spawn
   prompt/description, SendMessage text, task subjects/metadata, `gh issue` args, branch names;
   last-ref-wins per teammate. All pure → unit-testable.
4. **Sources** (`src/github.ts`) — read-only `gh issue list --json number,title,state,labels,
   closedAt,assignees --search <filter>` via `$.process.run` every 60s; burndown snapshots kept
   in `$.store`. Graceful when `gh` missing/unauthed (header says so).
5. **Profile** (`bullpen.json` in project `.claude/` or plugin `userConfig`) — issue filter,
   role map (teammate name/type → role, color), animations on/off. This is the morph point for
   home vs work variants.
6. **Render** (`src/render/*.tsx`) — header, floor (Raster + `src/anim.ts` tween engine),
   huddles, hallway, burndown, band, issue story. Draw from `$.state` atoms only.
7. **Commands** — `/bullpen` (toggle pane), `/bullpen story <#N>`, `/bullpen filter <query>`,
   `/bullpen demo` (replay a fixture journal — drives the UI with no live team; key for dev,
   tests, screenshots).

## Repo layout (plugin at repo root, installable as its own marketplace)
```
.claude-plugin/plugin.json        name "bullpen", types → ./types/index.d.ts
.claude-plugin/marketplace.json   { plugins: [{ name: "bullpen", source: "./" }] }
hooks/hooks.json                  { "modules": ["./register.tsx"] }
hooks/register.tsx                wires collector, timers, commands, render hooks
src/{collect,journal,github,anim,profile}.ts  src/model/*.ts  src/render/*.tsx
types/index.d.ts                  PluginState contract for "bullpen"
fixtures/demo-*.jsonl             recorded/synthetic sessions for /bullpen demo + tests
tests/*.test.ts                   claude plugin test
docs/design.md                    mockups + design decisions from this planning session
README.md                         install line, config, screenshots
```
Reference: mod skill examples `pane.tsx` (pane + command + atoms), `band.tsx` (band + toast)
under the bundled plugin-authoring skill; API types laid into `.claude-plugin/types/` on load.

## Build phases (each a task set for the team; dependencies noted)
- **P0 Spike (lead, blocking)** — scaffold mod; confirm in this build: `tool.call`/`turn.*`
  carry teammate `agentId`; `session.send` fires for teammate SendMessage; multiple pane ids
  layout vs one pane; Raster half-block sprite + blit animation in GNOME Terminal and Windows
  Terminal. Record a real team session journal as first fixture.
- **P1 Core** (parallel after P0): (a) collector + journal; (b) model reducers + attribution +
  morale with tests; (c) GitHub poller + burndown; (d) profile/config.
- **P2 Views** (after P1b): (e) header + band + burndown; (f) huddles + hallway (auto-wake);
  (g) floor static layout + color identity; (h) `/bullpen` commands, region focus, narrow layout.
- **P3 Alive** (after P2g): (i) tween engine + walk/message-dot/close-burst/glow; (j) morale →
  lighting + hints; (k) issue story drill-down; (l) `/bullpen demo` polish + screenshots.
- **Later (not MVP)**: per-huddle plain-English narration via throttled `$.model.complete`;
  "since you looked away" replay card; hallway threads; role-kit agent definitions +
  `/issues-team` kickoff command; sound; browser view off the same journal.

## Verification
- `claude plugin validate .` and `tsc -p .` clean after every phase.
- `claude plugin test .`: reducer tests over fixture journals (huddle grouping, kickback
  detection, attribution, morale), UI mount tests on `terminal` surface for header/band/
  huddles/hallway/story, tween engine with mocked clock.
- Dev loop: `claude --plugin-dir <repo>` (hot reload); `/bullpen demo` for visuals; `--debug`
  for refused trees.
- Manual: run in GNOME Terminal and Windows Terminal at 80, 120, 180 cols; check glyphs,
  colors, animation stops when idle.
- Dogfood: once pushed, open a few real issues on the repo and spawn a team (lead + builders +
  gate + UX + QA) to work them while the Bullpen pane is open; file what feels wrong as issues.

## Tech stack (decided 2026-10-17)
- TypeScript 7 (the native Go compiler) for type-checking; Biome 2.5 with default settings
  for formatting and linting; Node 24+ for tooling only; MIT license.
- No whole-mod build step: the engine loads `hooks/register.tsx` directly, so hot reload and
  `claude plugin test` work on source. Borrowed npm libraries are compiled by esbuild into
  `src/vendor/*.js` (committed, pinned, licenses collected) and imported by relative path,
  because a mod and its tests may import only their own files and `claude-code`.
- Rule: borrow when a small pure-JS library saves real work or brings correctness we shouldn't
  hand-write; vendor only the exports we use. Current: culori, string-width, valibot.
- Performance habits: batch state writes (~100 ms), throttle redraws (≤10 Hz), animate only
  while something moves, cap buffers; no minification (readable stack traces).
- CI (GitHub Actions): Biome, tsc, vendor freshness check; `claude plugin validate/test` in CI
  once confirmed to run without sign-in.

## Status
- P0 spike in progress: scaffold, event recorder (`hooks/register.tsx`, `src/events.ts`),
  half-block floor (`src/floor.ts`), `/bullpen` pane and band. Still to confirm: which events
  carry teammate `agentId` in practice, multi-pane layout, and rendering in Windows Terminal.
