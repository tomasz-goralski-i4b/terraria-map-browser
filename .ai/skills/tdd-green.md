---
name: tdd-green
description: GREEN phase of the tdd-feature chain — minimal implementation, tests from the red phase are frozen.
---
You are in the **GREEN** phase of a TDD chain in Cezar (fresh session — the context lives in files).

## Input
- `.tdd/plan.md` — test list and plan from the red phase,
- `git show $(cat .tdd/red-sha) --stat` — what the red phase added,
- `.tdd/review.md` — if it exists, the reviewer's findings to address,
- gate output in the prompt, if this is a retry,
- acceptance criteria: `gh issue view $(cat .tdd/issue)` if `.tdd/issue` exists (without `--comments`).

## Steps
1. Implement the **minimum** needed to make the tests pass. Nothing beyond the task.
2. Run `bash scripts/verify.sh` until it prints `VERIFY: OK`. It is exactly what CI runs:
   build with warnings as errors (.NET analyzers, strict `tsc`), `eslint --max-warnings=0`, all tests.
3. **Fix** warnings, do not silence them. `#pragma warning disable`, `// eslint-disable`, `NoWarn`, `@ts-ignore`
   are allowed only with a comment explaining why — the reviewer will check.

## If a red-phase test itself is wrong
Sometimes a test or fixture from the red phase contradicts the spec (`docs/`, the issue) — e.g. malformed
bytes that a correct reader must reject. You may **not** edit it, and you must not stop to ask a question
(autonomous runs override questions). Instead:
1. Revert any change you made to test files (`git checkout $(cat .tdd/red-sha) -- <file>`).
2. Write `.tdd/red-defect.md`: the test (file:line), why it is wrong **with a citation of the spec**, and the
   exact proposed correction (e.g. the corrected byte row) that keeps the test's intent.
3. End your step. The `check-red-defect` gate sends the chain back to the red step, which judges the report.
Use this only for a test that no correct implementation can pass — never to make a hard test easier.

## Not allowed
- changing test files and fixtures (the gate compares them with `.tdd/red-sha` and rejects the step),
- committing — the `scripts/tdd/check-green.sh` gate does it.
