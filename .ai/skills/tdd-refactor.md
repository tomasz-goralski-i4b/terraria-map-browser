---
name: tdd-refactor
description: REFACTOR phase of the tdd-feature chain — improve structure without changing behaviour or tests.
---
You are in the **REFACTOR** phase of a TDD chain (fresh session).

1. Review the diff against the base: `git diff main...HEAD` (or `git log --oneline main..HEAD`).
   Acceptance criteria: `gh issue view $(cat .tdd/issue)` if `.tdd/issue` exists (without `--comments`).
2. Improve names, duplication and module boundaries according to `AGENTS.md` and `docs/architecture.md`.
   Update `docs/` when the change requires it (e.g. `docs/file-format.md`).
3. Behaviour and public API stay as the tests define them — you **do not change tests**.
4. If nothing needs improving, change nothing. An empty refactor is fine.
5. At the end `bash scripts/verify.sh` must print `VERIFY: OK`.
Do not commit — the gate does it.
