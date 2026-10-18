# Changelog

## 0.3.0 (preview)

- Rebuild the pane around three questions: what needs me, who is stuck, what is
  shipping. A needs-you row leads, a SHIPPING list traces each issue from issue to
  PR, review and merge, and a flow line sums up who is working and how much the team
  is talking. The design brief in `docs/design.md` describes the new view.
- Retire the pixel floor, huddles and the Operations console; Studio is the single view.
- Give every teammate a workstation card: a kaomoji mood, the role (from the agent
  type or `roles` in the profile), the issue, live activity phrased as a verb, and
  the last thing they said. Long-idle teammates fold into an `out:` line and leaving
  teammates show "clocked out" for two minutes.
- Answer a teammate's question from the pane (`a`, a click, or `/bullpen answer`);
  the reply goes to that agent's inbox and a failed send keeps the draft.
- Flag possible stalls with a reason: repeated failures, repeated send-backs, a
  waiting review, no tool progress, or idle with open work.
- Replay a recorded session with `/bullpen replay PATH`; focus one region with
  `/bullpen focus shipping|talk|all`.
- Treat a GitHub-confirmed merge as final and detect `gh pr merge` inside shell
  chains and loops.
- Cut render cost with a live team (32 ms to 2 ms) and guard the render path against
  hangs; preview real journals with `scripts/preview.ts --journal`.
- Assign teammate colors in join order, keep roles past the event window, and cut
  issue-attribution noise from spawn briefs and `gh` commands.
- Fix SSO phrase matching, manual-live backoff reset, auxiliary-verb close
  confirmations, send-back negation scope, ASCII story links and exact-fit story rows
  (#44–#47, #52, #53).
- Rewrite the README around the new view with fresh screenshots.

Known follow-ups: attribution noise (#83), wider cards for small teams (#115), and
a README recording of a real session (#108). It doesn't estimate tokens or cost yet.
Windows Terminal and real Enterprise verification remain outstanding.

## 0.2.0

- Add the shared 80-second demo, deterministic previews, header and burndown,
  huddle/hallway regions, issue stories, morale lighting and animated floor activity.
- Fix the above-prompt band crash and test its real engine mount and open button.
- Preserve GitHub Enterprise hosts in API calls and burndown history; cover GH_HOST
  resolution and same-name repository isolation through the poller.
- Distinguish SSO and network failures and back off repeated failed automatic polls.
  Verify gh 2.4 argv compatibility and accurate totals beyond the 200-issue list cap.
- Require successful foreground close results or explicit teammate confirmation;
  prevent questions from closing huddles and separate PASS/FAIL verdict clauses.
- Give nonterminal surfaces their floor space back and pack complete Unicode code points.
- Add portable glyph validation and ASCII mode, plus vendored pathe path joins.
- Wrap long story and needs-you text with vendored wrap-ansi; retain single-line hallway rows.
- Correct marketplace installation instructions and document workplace setup and troubleshooting.

Known P2 follow-ups: SSO hostname matching (#44), manual-live backoff reset (#45),
auxiliary-verb close confirmations (#46), send-back negation scope (#47), ASCII story teammate links (#52), and exact-fit story overflow (#53).
Windows Terminal and real Enterprise verification remain outstanding.
