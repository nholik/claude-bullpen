# CLAUDE.md — claude-bullpen

Bullpen is a Claude Code **mod** (function-hooks plugin): a live TUI view of an agent team,
showing who is huddled on which GitHub issue, what they are saying, the burndown, and morale. Design,
mockups and build phases are in `docs/design.md`; read it before feature work.

## Commands

```sh
npm install            # dev tools (Biome, TypeScript 7, esbuild); Node 24+
npm run check          # Biome + tsc + vendor freshness + plugin validate + tests: run before every commit
npm run format         # Biome format + safe fixes
npm run vendor         # recompile borrowed libraries into src/vendor/
scripts/snap.sh        # real screenshot: runs `/bullpen demo` in tmux → .scratch/snaps/*.ansi + .png
```

`tsc` needs `.claude-plugin/types/`, which Claude Code writes when it loads the mod (`claude --plugin-dir .`).

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

Look at the real UI whenever drawing code changes: run `scripts/snap.sh` (or
`SHOTS="3 8 14" scripts/snap.sh` for several moments) and read the `.png` (or `cat` the `.ansi`).
`/bullpen demo` plays a scripted team with no model calls. Check at 110 and 160 columns.

## Git workflow

- `main` is protected by convention: work on a branch `<issue>-<slug>` (e.g. `12-journal`),
  in a git worktree under `.worktrees/` (gitignored), and open a PR that says `Closes #<issue>`.
- On each PR the lead comments `@codex review` to get a Codex review, plus our own gate
  review; merge when both are satisfied and `npm run check` is green.
- Commit messages: imperative subject, short body. **No attribution lines** (no
  Co-Authored-By, no "Generated with").
- The repo is **public**: no secrets, no employer names, internal URLs or work content.
