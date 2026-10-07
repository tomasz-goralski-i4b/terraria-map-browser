# WORKFLOW.md

```
plan-backlog → issues [backlog] → promoter [agent:ready] → Cezar automation → worktree → gated chain → draft PR → CI → human merge → promoter…
```

State lives in issue labels (no GitHub Project):
`backlog → agent:ready → status:pr-ready → status:ready-to-merge` (+ `status:stalled`, `status:deferred`, `later`, `follow-up`).

Choosing a workflow:
| Kind of work | Workflow |
|---|---|
| Behaviour change (codec, model, renderer) | `tdd-feature` (Claude implements / Codex reviews) or `tdd-feature-codex` |
| Regression tests for behaviour that already works | `tests-only` |
| CI, tooling, scaffolding, docs | `foundation` (`agent:claude`) or `foundation-codex` (`agent:codex`) |
| Format research, investigation | `spike` |
| Splitting a milestone into issues | `plan-backlog` |

Details: `docs/agent-workflow.md`.
