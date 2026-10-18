// A small frozen journal whose reduced state fingerprints the reducer
// (`MODEL_VERSION`, version.ts). Unlike demo.ts it is not edited for the UI.
// Holds an ask, a reply, a review verdict and a PR announcement. JSONL in a
// string because a mod may import only code files. Editing it changes the
// version, which only costs one rebuild.

export default `
{"version":1,"at":1792245600000,"kind":"spawn","who":"lead","target":"ada","detail":"teammate ada joined","issues":[7]}
{"version":1,"at":1792245610000,"kind":"spawn","who":"lead","target":"gate","detail":"teammate gate joined","issues":[7]}
{"version":1,"at":1792245900000,"kind":"tool","agentId":"a-ada","who":"ada","target":"Edit","detail":"edit model.ts","issues":[7]}
{"version":1,"at":1792246200000,"kind":"message","agentId":"a-ada","who":"ada","target":"team-lead","detail":"#7 should the cache be per session or global?","issues":[7]}
{"version":1,"at":1792246260000,"kind":"message","who":"lead","target":"ada","detail":"#7: per session","issues":[7]}
{"version":1,"at":1792246800000,"kind":"message","agentId":"a-ada","who":"ada","target":"team-lead","detail":"#7: PR is up https://example.invalid/pull/41","issues":[7,41]}
{"version":1,"at":1792246860000,"kind":"pr","agentId":"a-ada","who":"ada","detail":"opened PR #41","issues":[41],"url":"https://example.invalid/pr/41"}
{"version":1,"at":1792247100000,"kind":"message","agentId":"a-gate","who":"gate","target":"team-lead","detail":"PR #41 (#7): CHANGES, one P1 blocks the merge","issues":[7]}
{"version":1,"at":1792247400000,"kind":"message","agentId":"a-gate","who":"gate","target":"team-lead","detail":"PR #41 (#7): PASS","issues":[7]}
{"version":1,"at":1792247500000,"kind":"tool","agentId":"a-ada","who":"ada","target":"SendMessage","detail":"to gate: look at #52 too","issues":[52]}
{"version":1,"at":1792247510000,"kind":"message","agentId":"a-ada","who":"ada","target":"team-lead","detail":"Round: | #50 (merged) | ok |","issues":[50]}
{"version":1,"at":1792247600000,"kind":"tool","agentId":"a-ada","who":"ada","target":"Bash","detail":"git worktree add .worktrees/53-x","issues":[53],"owns":53,"ownedBy":"worktree"}
{"version":1,"at":1792247700000,"kind":"message","agentId":"a-ada","who":"ada","target":"team-lead","detail":"while at it, #54 looks related","issues":[54]}
{"version":1,"at":1792247800000,"kind":"message","who":"lead","target":"gate","detail":"closed #7, shipped #41","issues":[7,41]}
{"version":1,"at":1792247900000,"kind":"message","agentId":"a-gate","who":"gate","target":"team-lead","detail":"PR #58 (#9): CHANGES, tests fail on the empty journal","issues":[9,58]}
{"version":1,"at":1792248000000,"kind":"message","agentId":"a-ada","who":"ada","target":"team-lead","detail":"#9 blocked: skip or fix the empty-journal test?","issues":[9]}
{"version":1,"at":1792248100000,"kind":"message","agentId":"a-code-reviewer","who":"code-reviewer","target":"team-lead","detail":"PR #60 (#11): FAIL, the empty team renders a blank card","issues":[11,60]}
{"version":1,"at":1792248100000,"kind":"decision","who":"lead","detail":"Ship the cache per session or wait for review?","issues":[7],"context":"The reviewer has not answered and the branch is green."}
{"version":1,"at":1792248200000,"kind":"decision","who":"lead","detail":"Cut the second flag?","issues":[9]}
{"version":1,"at":1792248300000,"kind":"reply","who":"lead","detail":"replied","issues":[],"answered":["d1792248100000-0"]}
{"version":1,"at":1792248400000,"kind":"decision","who":"lead","detail":"Merge #58 now?","issues":[58],"context":"Checks are green."}
`;
