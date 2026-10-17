// The `/bullpen demo` script (src/demo.ts) as journal lines, in the shape the
// collector records live: the lead spawns each teammate with a brief, and
// demo waits are stretched x60 so the run spans about 13 minutes from 14:00 UTC.
// JSONL in a string because tests may import only code files.

export default `
{"at":1792245600000,"kind":"spawn","who":"lead","target":"smith","detail":"teammate smith joined","issues":[208]}
{"at":1792245624000,"kind":"spawn","who":"lead","target":"ada","detail":"teammate ada joined","issues":[208]}
{"at":1792245648000,"kind":"spawn","who":"lead","target":"gate","detail":"teammate gate joined","issues":[204]}
{"at":1792245672000,"kind":"spawn","who":"lead","target":"iris","detail":"teammate iris joined","issues":[199]}
{"at":1792245696000,"kind":"spawn","who":"lead","target":"scout","detail":"teammate scout joined","issues":[]}
{"at":1792245750000,"kind":"tool","agentId":"demo-smith","who":"smith","target":"Bash","detail":"read src/auth/redirect.ts","issues":[]}
{"at":1792245786000,"kind":"message","agentId":"demo-smith","who":"smith","target":"ada","detail":"#208: can you write the repro test for the redirect loop?","issues":[208]}
{"at":1792245828000,"kind":"tool","agentId":"demo-ada","who":"ada","target":"Bash","detail":"write tests/test_login.py","issues":[]}
{"at":1792245870000,"kind":"tool","agentId":"demo-gate","who":"gate","target":"Bash","detail":"npm test -- session","issues":[]}
{"at":1792245906000,"kind":"tool","agentId":"demo-iris","who":"iris","target":"Bash","detail":"review #199 tooltip","issues":[199]}
{"at":1792245960000,"kind":"turn-end","agentId":"demo-scout","who":"scout","detail":"finished a turn","issues":[]}
{"at":1792246008000,"kind":"message","agentId":"demo-gate","who":"gate","target":"smith","detail":"#204: 2 tests failing on session expiry, sending it back to you","issues":[204]}
{"at":1792246050000,"kind":"tool","agentId":"demo-smith","who":"smith","target":"Bash","detail":"edit src/session.ts","issues":[204]}
{"at":1792246104000,"kind":"message","agentId":"demo-iris","who":"iris","target":"lead","detail":"#199 looks good, filed a spacing nit as #217","issues":[199,217]}
{"at":1792246134000,"kind":"turn-end","agentId":"demo-iris","who":"iris","detail":"finished a turn","issues":[]}
{"at":1792246188000,"kind":"message","agentId":"demo-ada","who":"ada","target":"smith","detail":"#208: repro test is in, fails as expected","issues":[208]}
{"at":1792246236000,"kind":"turn-end","agentId":"demo-gate","who":"gate","detail":"finished a turn","issues":[]}
{"at":1792246308000,"kind":"tool","agentId":"demo-smith","who":"smith","target":"Bash","detail":"npm test","issues":[204]}
{"at":1792246362000,"kind":"message","agentId":"demo-smith","who":"smith","target":"gate","detail":"#204: fixed, please re-run","issues":[204]}
{"at":1792246398000,"kind":"tool","agentId":"demo-gate","who":"gate","target":"Bash","detail":"npm test -- session","issues":[]}
`;
