// A small frozen journal that pins the reducer's output (tests/model-version
// .test.ts). Unlike demo.ts it is not edited for the UI, so a fingerprint bump
// means the reducer changed. Holds an ask, a reply, a review verdict and a PR
// announcement. JSONL in a string because tests may import only code files.

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
`;
