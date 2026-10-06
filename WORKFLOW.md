# WORKFLOW.md

```
plan-backlog → issues [backlog] → promoter [agent:ready] → Cezar automation → worktree → gated chain → draft PR → CI → human merge → promoter…
```

Statuses (GitHub Project):
`Todo → Agent Ready → In Progress → PR Ready → Agent Review → Human Review → Done` (+ `Rework`).

Choosing a workflow:
| Kind of work | Workflow |
|---|---|
| Behaviour change (codec, model, renderer) | `tdd-feature` (Claude implements / Codex reviews) or `tdd-feature-codex` |
| CI, tooling, scaffolding, docs | `foundation` |
| Format research, investigation | `spike` |
| Splitting a milestone into issues | `plan-backlog` |

Details: `docs/agent-workflow.md`.
