# Bullpen design brief

**The glass wall into your agent team.** Glance at it for three seconds and you know
what needs you, who is stuck, and what is shipping. When nothing needs you, it stays out of the way.

This brief is the bar for every visual PR. Mockups are targets: build toward them and
change them when dogfooding proves them wrong. The pixel floor from the first planning
round (sprites, walking, confetti, floor lighting) is **retired**. It looked bad in a
real terminal. Studio glyph cards are the canvas now.

## The three questions

A glance answers these, in this order:

1. **What needs me?** Asks, decisions and blocked work that only the human can unblock.
2. **Who is stuck?** A teammate who is spinning, failing, idle with work open, or waiting too long.
3. **What is shipping?** Where each issue is on the way to done: issue, PR, review, merge.

The visual pulse matters too: recent communication highlights both participants,
completed turns briefly brighten, and a flow row shows review pressure, idle
capacity, and net backlog growth. Conversation and the office atmosphere make
coordination visible without treating useful questions or reviews as failures.

## Principles

- **Calm by default.** A healthy team looks quiet. Color and motion are alarms, so spend them only when there is something to act on.
- **Truth over coverage.** A blank cell is better than a wrong one. Don't show
  "teammate", raw shell text or guessed attribution. If we can't say it plainly, say less.
- **Words, not codes.** Activity reads like a sentence: "reviewing PR #77", not
  `gh pr review 77 --comment --body "...`. Tool names, paths under `$HOME` and shell
  plumbing never reach the screen.
- **Cheap to leave open.** Nothing animates while nothing changes. Redraws stay at 10 Hz or less and buffers are capped.
- **Portable.** GNOME Terminal (VTE) and Windows Terminal. Width-1 glyphs only, no
  emoji, 24-bit color, box drawing. `glyphs: "ascii"` must still read well.
- **Observe, with a human reply path.** Bullpen observes the team and reuses Claude's
  transcript UI. A blocker opens a small reply form; submitting sends the human's
  direction to the original asking agent through `session.send`. Failed delivery
  preserves the draft. Demo and replay never send messages.

## Information hierarchy

| Loudness | What | How it shows |
|---|---|---|
| Loud | Needs-you queue | Row 1 under the header at every width; amber; the only thing that pulses |
| Loud | Failing / kicked back | Coral face and card frame; ship rail stop turns ✗ |
| Firm | Stuck | Face changes, plus a reason ("no progress 18m"); no motion |
| Medium | Ship path changes | Rail stop fills; merge gets a one-shot flourish |
| Quiet | Heads-down work | Normal text, no frame color |
| Quiet | Hallway talk | Muted; sender colored; one line each at narrow widths |
| Quietest | Idle, away, gone | Dimmed card, snoozing z's |
| Ambient | Morale, burndown | Header glyph and a footer sparkline |

If two things fight for a row, the one higher in this table wins.

## Screen anatomy (top to bottom)

1. **Header** (2 rows). Repo (never "workspace" when gh knows it), morale glyph, clock.
   Row 2 shows shipped / in flight / needs-you counts. "Shipped" counts merges from the
   ship model, so it never says 0 after a merge.
2. **Needs you.** One row per open ask, oldest first, capped at 3 with "+N more". When the
   queue is empty it collapses to nothing. There's no "No open decisions" row taking up space.
3. **Shipping.** One row per issue in flight, with its rail. This replaces the old
   Huddles list: who works on an issue together is visible on the rail's names.
4. **Team.** Cards (wide) or two-line rows (narrow), ordered by urgency: needs-you,
   failing, stuck, running, idle, gone.
5. **Hallway.** Recent teammate-to-teammate messages. At 110 and up it's a sidebar; below
   that it takes whatever rows are left.
6. **Out of office.** After 30 minutes, idle teammates without an open ask or a
   stalled assignment fold into a colored, transcript-linked `out:` line. New
   activity brings the card back. Departed teammates linger as clocked out for
   two minutes before disappearing.
7. **Footer.** Burndown sparkline and key hints, one row. Say "no GitHub data" once
   per screen, not once per region.

### Needs-you queue

```
 ! gate → you  #204 flaky test: skip or fix?                     6m  [t]
 ! ada  → you  #208 can I change the login redirect contract?    1m  [t]
```

An ask is open until the lead answers it or a human reply is successfully queued.
The human form resolves only the selected request. Other questions from the same
agent stay open. Delivery is not an acknowledgement; the UI says so explicitly. The age
turns from amber to coral at 10 minutes. The pulse runs for 10 s when an ask arrives,
then holds steady: a pulse that never stops is just noise.

### Ship path

Four stops, issue → PR → review → merged:

```
 #204 session expiry   ●━━●━━✗━━○  PR #91 · changes asked     smith gate
 #208 auth redirect    ●━━○━━○━━○  no PR yet · 22m            ada
 #199 tooltip align    ●━━●━━●━━✓  merged 2m ago              iris
```

- `●` reached, `○` not yet, `✗` review asked for changes (coral), `✓` merged (mint).
- The current stop takes the owner's color. Earlier stops are muted.
- The label says the one fact that matters now: the PR number and the last verdict, or how long it's
  been waiting. If a review loops (✗ twice), add "2nd round".
- Merged rows stay for 10 minutes, then fold into the header's shipped count.
- The model is `src/model/ship.ts` (PR #77). The model doesn't guess: a stop only fills on evidence.

### Card anatomy (4 rows, wide layouts)

```
╭──────────────────────────────────╮
│ (o_o)/ gate · reviewer        6m │   face · name · role, age of last change
│ #204 session expiry · review ✗   │   issue, title and ship stop
│ needs you: skip or fix flaky…    │   activity, as a verb phrase
│ → lead: #204 flaky test – skip…  │   last thing said or heard, muted
╰──────────────────────────────────╯
```

- 4 content rows plus a border. The old 8-row card spent half its height on chrome
  (status row, divider). Cards sit in 6-row slots; no blank bands between rows.
- **Role** comes from the agent type or the profile role map. If neither knows, show no
  role at all. "teammate" is never correct.
- **Activity** comes from a small verb vocabulary over the latest tool event: reading,
  editing `file.ts`, running tests, reviewing PR #N, opening PR #N, rebasing,
  merging, messaging NAME, researching. If nothing matches, fall back to the last message.
  Never show raw commands, tool names (`Monitor`), or `cd /home/...`.
- **Frame** is muted except for needs-you (amber) and failing (coral). The change-glow
  (a bright border decaying over 60 s) is the only other frame color.
- Unassigned teammates (lead, directors, reviewers between reviews) show their
  activity instead of an issue row. Reading or reviewing an issue doesn't make someone its owner.

### Narrow team row (2 rows, below 110 cols)

```
 (o_o)/ gate   reviewer #204  needs you: skip or fix the flaky test?
        → lead: #204 flaky test – skip or fix?                     6m
```

## State vocabulary and moods

Faces are printable ASCII so every terminal and font draws them the same. A face always
appears with its word: color and face are never the only signal.

| State | Face | Word | Color | Card | Motion |
|---|---|---|---|---|---|
| needs you | `(o_o)/` | needs you | amber | amber frame | 10 s pulse, then steady |
| failing | `(>_<)` | checks red ×N | coral | coral frame | none |
| kicked back | `(>_<)` | sent back | coral | coral frame | none |
| stuck | `(._.)` | stuck · reason | amber text | normal | none |
| in review | `(o_o)?` | waiting on review | lavender | normal | none |
| running | `(o.o)` | heads-down | text | normal | none |
| merged | `(^_^)b` | merged | mint | normal | one-shot, ≤2 s |
| idle | `(-_-)` | snoozing | muted | dimmed | z's drift |
| away | `(-_-)` | out of office | muted | folded into the out line | none |
| gone | `(u_u)` | clocked out | edge | dimmed | none |

Every state has its own face except idle/away (same face, different word). Precedence runs
from top to bottom: the first state that matches wins.

**Stuck** fires on any of: running with no tool progress for 10 min; the same failing
command three times; two review kickbacks on one issue; idle for 5 min while assigned
an open issue; waiting on review for 15 min. The reason goes on the card ("no progress
14m"). Morale's stall detection and the card must agree: if the header says an issue
stalled, its owner's card says stuck. **Cost** shows turns and wall-clock per teammate.
Token or dollar figures appear only if the engine reports them. We never estimate.

## Motion rules

Only four things move, and each has to earn it:

1. **Needs-you pulse.** Amber, 1 Hz, for 10 s after the ask arrives.
2. **Merge flourish.** One shot, at most 2 s, on the card face and the rail's ✓.
3. **Snooze.** Idle z's drift one frame every 2 s.
4. **Card resize.** When the team grows or shrinks and cards change width, the width eases over
   about 0.4 s at no more than 10 redraws a second, then the timer stops. No bounce, no overshoot.
   A card is never wider than 70 columns, and a small team's cards sit left-aligned.

In addition, the change-glow is a decay, not an animation: it is redrawn on the existing
1 s refresh. Nothing else moves: no marquee text, no spinners, no walking. With nothing
changing, the timer stops. `animations: false` freezes all four at their resting frame.

## Hallway

- One line per message below 110 columns, two lines in the sidebar. Show the sender colored, then
  `→ receiver`, then the text. Truncate with `…`, never a space and a period.
- Strip a leading "Name:" that repeats the sender.
- After 3 min of quiet, collapse to `hallway quiet 12m`. A new message wakes it.
- Ship verdicts ("PASS", "CHANGES", "merged") move the rail. They still show in the
  hallway, but the rail is where the eye goes for them.

## Identity

- Each teammate gets a distinct color from the palette in join order, not from a hash of
  their name. Two teammates on screen never share a hue.
- That color marks the name, the rail stop and hallway sender wherever they appear.

## Widths

Sizes are pane body columns.

| Width | Layout |
|---|---|
| < 60 | Header, needs-you, shipping rows (no rail labels), one-line team rows |
| 60–109 (72) | Single column: header, needs-you, shipping, 2-row team rows, hallway one-liners in the remaining rows |
| 110–149 | Left: shipping plus 4-row cards, 2 across. Right sidebar (≥ 34 cols): hallway |
| ≥ 150 (160) | Left: shipping plus cards 3 across. Right sidebar (~48 cols): hallway, 2 lines per message |

Needs-you always spans the full width under the header. If there are no rows left for the hallway, it
drops before shipping or the team does. Talk must never vanish while blank rows sit
elsewhere.

### 72 columns

```
 BULLPEN  nholik/claude-bullpen                 ☀  17:32  2 shipped
 3 in flight · 5 teammates · 1 needs you
 ! gate → you  #204 flaky test: skip or fix?                     6m [t]
 ─ SHIPPING ────────────────────────────────────────────────────────────
 #204 session expiry  ●━━●━━✗━━○  PR #91 · changes asked     smith gate
 #208 auth redirect   ●━━○━━○━━○  no PR yet · 22m                   ada
 #199 tooltip align   ●━━●━━●━━✓  merged 2m ago                    iris
 ─ TEAM ────────────────────────────────────────────────────────────────
 (o_o)/ gate   reviewer #204  needs you: skip or fix the flaky test?
        → lead: #204 flaky test – skip or fix?                     6m
 (o.o)  smith  engineer #204  running tests · session_test.py
        → gate: fixed, please re-run                              <1m
 (._.)  ada    engineer #208  stuck · no progress 14m
        → smith: repro test is in, fails as expected              14m
 (^_^)b iris   designer #199  merged
 (-_-)  scout  researcher     snoozing  z z
 ─ HALLWAY ─────────────────────────────────────────────────────────────
 smith → gate   #204: fixed, please re-run                          17:31
 iris → lead    #199 looks good, filed a spacing nit as #217        17:29
 burndown ▇▇▆▅▄▃ 5 open · pace ~45m              f team · t talk · r reset
```

### 160 columns

```
 BULLPEN  nholik/claude-bullpen                                                                       ☀  17:32
 3 in flight · 5 teammates · 2 shipped this session                                                  1 needs you
 ! gate → you  #204 flaky test: skip or fix?                                                                       6m  [t] answer
 ─ SHIPPING ───────────────────────────────────────────────────────────────────────────────┬─ HALLWAY ─────────────────────────────────────
 #204 session expiry   ●━━●━━✗━━○  PR #91 · changes asked, 2nd round        smith gate      │ smith → gate                            17:31
 #208 auth redirect    ●━━○━━○━━○  no PR yet · 22m                                 ada      │ #204: fixed, please re-run
 #199 tooltip align    ●━━●━━●━━✓  merged 2m ago                                   iris     │
 ─ TEAM ───────────────────────────────────────────────────────────────────────────────────┤ iris → lead                             17:29
 ╭────────────────────────────╮ ╭────────────────────────────╮ ╭────────────────────────────╮ │ #199 looks good, filed a spacing nit as
 │ (o_o)/ gate · reviewer  6m │ │ (o.o) smith · engineer <1m │ │ (._.) ada · engineer   14m │ │ #217
 │ #204 session expiry · ✗    │ │ #204 session expiry · ✗    │ │ #208 auth redirect · issue │ │
 │ needs you: skip or fix?    │ │ running tests              │ │ stuck · no progress 14m    │ │ ada → smith                             17:18
 │ → lead: flaky test – skip… │ │ → gate: fixed, please re-… │ │ → smith: repro test is in… │ │ #208: repro test is in, fails as
 ╰────────────────────────────╯ ╰────────────────────────────╯ ╰────────────────────────────╯ │ expected
 ╭────────────────────────────╮ ╭────────────────────────────╮                                │
 │ (^_^)b iris · designer  2m │ │ (-_-) scout · researcher   │                                │
 │ #199 tooltip align · ✓     │ │ unassigned                 │                                │
 │ merged                     │ │ snoozing   z Z             │                                │
 │ → lead: #199 looks good…   │ │                            │                                │
 ╰────────────────────────────╯ ╰────────────────────────────╯                                │
 burndown ▇▇▇▆▆▅▄▃▂ 12 → 5 · pace ~45m                                                        f team · t talk · r reset
```

## Drill-downs

- Press an issue (rail or card) to open the **issue story**: the cross-agent timeline for
  one issue, including assigned, edits, verdicts, kickbacks, messages about it and GitHub state.
- Press a name to open Claude Code's own transcript via `$.ui.view({ agentId })`. Reuse it; don't rebuild it.
- The band above the prompt is the one-line version of the three questions:
  `bullpen ☀  !1  #204 ✗  #208 ○  #199 ✓  2 shipped`.

## Non-goals

- Pixel floor, sprites, walking, confetti, floor lighting. Retired.
- Controlling the team from the pane. Bullpen observes; Claude Code acts.
- Rebuilding transcripts or the agent detail view.
- Estimated tokens or dollars. Only what the engine reports.
- Emoji, braille, kitty images, or anything wider than one cell.
- Sound, desktop notifications, a browser view. All possible later off the same journal,
  but none of them is the product now.
- A second dashboard. Studio is the single view. Operations is retired; old
  `style` settings are ignored.

## Roadmap (pillars)

1. **Role and live activity on every card.** #72 / PR #80. Includes the verb vocabulary and no-"teammate".
2. **Ship path.** #73: model in PR #77, then the Shipping rail and the header's shipped count.
3. **Needs-you queue.** Promote asks to row 1, add multiple asks and ages.
4. **Stuck and cost signals.** The stuck rules above, plus turns and wall-clock per teammate.
5. **Moods.** #74 / PR #92. The faces, words and motion above.
6. **Truth fixes.** Attribution (touching ≠ owning), join-order colors, repo name in the header.

## Architecture

The layers stay, so the mod can be reshaped later:

1. **Collector** (`src/collect.ts`). Hooks normalize engine events into journal events.
   Observers never block, deny or rewrite. They always `return next(e)`.
2. **Journal** (`src/journal.ts`). A ring buffer in `$.state`, appended under
   `~/.claude/bullpen/<session-id>/` for replay, tests and the demo.
3. **Model** (`src/model/*.ts`). Pure reducers: teammates, huddles, hallway, asks, ship
   path, morale. All of them unit-tested.
4. **Sources** (`src/github.ts`). Read-only `gh` polling for issue state and burndown.
   Degrades gracefully without `gh`.
5. **Profile** (`.claude/bullpen.json`). Issue filter, role map, glyphs, animations. This is
   where the mod gets reshaped per team.
6. **Render** (`src/render/*.ts`). View-models from model atoms. `team-studio.ts` is the
   canvas.
7. **Commands.** `/bullpen`, `/bullpen story #N`, `/bullpen demo`, `/bullpen live`,
   `/bullpen reload`.

## Verification

- Every visual PR attaches previews at 72, 110 and 160 (`scripts/preview.ts`, always under
  `timeout 10`) and one real-terminal snap (`scripts/snap.sh`).
- Check it against the live team (`--journal`), not just the demo: the demo is where the design
  was tuned, and the live team is where it breaks.
- The three-second test: show the screenshot, cover it, and ask what needs you, who is stuck and
  what is shipping. If those take longer than three seconds to answer, the PR isn't done.
