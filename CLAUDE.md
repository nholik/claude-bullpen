# CLAUDE.md — claude-bullpen

Bullpen is a Claude Code **mod** (function-hooks plugin): a live TUI view of an agent team,
answering at a glance what needs you, who is stuck and what is shipping. The design brief
(the three questions, layout, moods and motion rules) is `docs/design.md`; read it before feature work.

## Commands

```sh
npm install            # dev tools (Biome, TypeScript 7, esbuild); Node 24+
npm run check          # Biome + tsc + vendor freshness + plugin validate + tests: run before every commit
                       # (queues behind any other check on the machine; see "Team budget")
npm run format         # Biome format + safe fixes
npm run vendor         # recompile borrowed libraries into src/vendor/
scripts/snap.sh        # real screenshot: runs `/bullpen demo` in tmux → .scratch/snaps/*.ansi + .png
scripts/ci-types.sh    # write .claude-plugin/types/ without signing in (what CI does)
```

`tsc` needs `.claude-plugin/types/`, which Claude Code writes when it loads the mod (`claude --plugin-dir .`).
CI (`.github/workflows/ci.yml`) runs every step of `npm run check` against the Claude Code version it
pins in `CLAUDE_CODE_VERSION`; bump it when you move to a newer build.

## The mod API

- The authority is `.claude-plugin/types/claude-code/index.d.ts` (~22k lines, written per build).
  Grep it for the event or noun at hand (`'tool.call'`, `Pane: {`, `RasterProps`) and read the
  declaration; don't guess shapes. Long-form notes: the `plugin-authoring` skill.
- Hooks are `($, e, next)`. A mod has no Node and no DOM; everything outside goes through `$`.
- A mod and its tests may import **only their own files (relative paths) and `claude-code`**.

## Architecture and conventions

- `hooks/register.tsx` is the only file that wires events, commands and drawing. Keep it thin.
- `src/` holds pure, engine-free modules (normalizing, model reducers, floor drawing, color),
  tested in `tests/*.test.ts` via `claude plugin test`. New logic goes here first, with tests.
- `types/index.d.ts` is the `$.state` contract; declare every state key there.
- Tests run in a sandbox with no fs: fixtures are TypeScript modules exporting JSONL strings
  (`tests/fixtures/*.ts`), not `.jsonl` files.
- Observer hooks (`tool.call`, `session.send`, `turn.*`, `agent.spawn`) must never block, deny or
  rewrite: record with `void ... .catch(() => {})` and `return next(e)` immediately.
- Performance: batch state writes, throttle redraws (≤10 Hz), animate only while something
  moves (blit, not re-render), cap buffers. No minification.
- Render and model code runs on the host's thread: a hang there freezes Claude Code. Every
  `while`/`for (;;)` loop must provably shrink its input each pass, and real journals are
  rendered under `timeout 10` before a PR is opened.
- Terminals: GNOME Terminal (VTE) and Windows Terminal. Only width-1 glyphs (no emoji in UI),
  24-bit color, half-blocks `▀▄█▌▐`, box drawing. Measure text with `oneLine`/`string-width`.
- Formatting: Biome defaults (tabs, double quotes). TypeScript strict with
  `noUncheckedIndexedAccess`; avoid `!` and `as` casts.

## Borrowing libraries

Borrow a small, pure-JS, MIT-ish library when it is cheaper and better than writing it.
Add it to `package.json` `dependencies` (exact version) and to `scripts/vendor.mjs` exporting
only what's used, add a `.d.ts` re-export beside the output, run `npm run vendor`, commit
`src/vendor/` (including `LICENSES.md`). Never edit `src/vendor/*.js` by hand.

## Looking at the UI

Engine-free previews (Node 24), using the same demo replay and view-models as the pane:

```sh
node --experimental-strip-types scripts/preview.ts --cols 72 --rows 32 --at 16 --out .scratch/preview/pane.ansi
python3 scripts/ansi2png.py .scratch/preview/pane.ansi .scratch/preview/pane.png
node --experimental-strip-types scripts/preview.ts --cols 72 --at 55 --frames 24 --out .scratch/preview/close.ansi
node --experimental-strip-types scripts/preview.ts --cols 72 --at 80 --story 204 --out .scratch/preview/story.ansi
```

Omit `--out` for stdout. Frames advance by 100 ms and use numbered filenames.
To see a real team, point `--journal` at a journal directory
(`~/.claude/bullpen/session-<id>`): it reads every `events-*.jsonl`, keeps the last
`STATE_EVENTS`, derives members (running if active in the last 60 s) and renders
`--at` seconds (default 2) after the last event, e.g.
`timeout 10 node --experimental-strip-types scripts/preview.ts --cols 110 --journal <dir>`.
A frame that takes over 2 s aborts the process with an error, so a render hang cannot pin a CPU;
still run previews under `timeout`.
Sizes are **pane body** columns: check 60, 72, 80, 100, 110 and 160. The full floor
starts at 48 columns, and regions sit side by side from 60. `npm run typecheck`
checks both engine source and the Node preview tool. The 80-second demo explicitly
advances its simulated clock by 21 minutes at T=25s to demonstrate hallway quiet,
stalls and morale without making the viewer wait; `/bullpen live` restores live data.


Look at the real UI whenever drawing code changes: run `scripts/snap.sh` (or
`SHOTS="3 8 14" scripts/snap.sh` for several moments) and read the `.png` (or `cat` the `.ansi`).
`/bullpen demo` plays a scripted team with no model calls. Check at 110 and 160 columns.

## Team budget

The team runs on one laptop. Keep it cool:
- At most three working agents at once; spawn reviewers when there is something to review.
- Iterate with `npm run typecheck` and reading previews; run the full `npm run check` once,
  right before pushing. It takes a machine-wide lock, so a second check waits its turn.
- Never `git stash`: the stack is shared by every worktree, so a pop can take another
  teammate's work. Commit a WIP instead.

## Git workflow

- `main` is protected by convention: work on a branch `<issue>-<slug>` (e.g. `12-journal`),
  in a git worktree under `.worktrees/` (gitignored), and open a PR that says `Closes #<issue>`.
- On each PR the lead comments `@codex review` to get a Codex review, plus our own gate
  review; merge when both are satisfied and `npm run check` is green.
- Review triage: fix P0/P1 findings before merging. P2+ findings become follow-up issues (link
  the PR); nits can be left alone. MVP progress beats polishing a PR.
- Commit messages: imperative subject, short body. **No attribution lines** (no
  Co-Authored-By, no "Generated with").
- The repo is **public**: no secrets, no employer names, internal URLs or work content.
