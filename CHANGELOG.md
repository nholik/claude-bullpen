# Changelog

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
auxiliary-verb close confirmations (#46), send-back negation scope (#47), and ASCII story teammate links (#52).
Windows Terminal and real Enterprise verification remain outstanding.
