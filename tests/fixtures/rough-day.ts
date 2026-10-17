// A rougher afternoon, from 14:00 UTC: a gate failure, two asks to the lead
// (one answered), #12 closed twice over, a ↺ kickback, and #14 left to go
// quiet. Carries a kind and fields the model does not know, which it must
// ignore. JSONL in a string because tests may import only code files.

export default `
{"version":1,"at":1792245600000,"kind":"spawn","who":"lead","target":"smith","detail":"teammate smith joined","issues":[12]}
{"version":1,"at":1792245610000,"kind":"spawn","who":"lead","target":"gate","detail":"teammate gate joined","issues":[12]}
{"version":1,"at":1792245620000,"kind":"spawn","who":"lead","target":"ada","detail":"teammate ada joined","issues":[14]}
{"version":1,"at":1792245900000,"kind":"tool","agentId":"a-smith","who":"smith","target":"Edit","detail":"edit model.ts","issues":[12]}
{"version":1,"at":1792246200000,"kind":"message","agentId":"a-smith","who":"smith","target":"gate","detail":"#12 ready for review","issues":[12]}
{"version":1,"at":1792246320000,"kind":"message","agentId":"a-gate","who":"gate","target":"smith","detail":"#12: 3 tests fail in reduce","issues":[12]}
{"version":1,"at":1792246500000,"kind":"message","agentId":"a-ada","who":"ada","target":"team-lead","detail":"#14 flaky test, skip or fix","issues":[14]}
{"version":1,"at":1792246560000,"kind":"message","agentId":"a-gate","who":"gate","target":"lead","detail":"blocked on #13 until #12 lands","issues":[13,12]}
{"version":1,"at":1792246800000,"kind":"message","who":"lead","target":"ada","detail":"#14: skip it, file a follow-up","issues":[14]}
{"version":1,"at":1792247100000,"kind":"tool","agentId":"a-smith","who":"smith","target":"Bash","detail":"gh issue close 12","issues":[]}
{"version":1,"at":1792247160000,"kind":"message","agentId":"a-smith","who":"smith","target":"lead","detail":"#12 ✓ merged","issues":[12]}
{"version":1,"at":1792247220000,"kind":"turn-end","agentId":"a-smith","who":"smith","detail":"finished a turn (40s)","issues":[]}
{"version":1,"at":1792247280000,"kind":"pr","agentId":"a-ada","who":"ada","detail":"opened PR #31","issues":[31],"url":"https://example.invalid/pr/31"}
{"version":1,"at":1792247400000,"kind":"tool","agentId":"a-ada","who":"ada","target":"Edit","detail":"edit flaky.test.ts","issues":[14],"files":["tests/flaky.test.ts"]}
{"version":1,"at":1792247460000,"kind":"message","agentId":"a-ada","who":"ada","target":"smith","detail":"↺ #14 your fixture shape changed","issues":[14]}
`;
