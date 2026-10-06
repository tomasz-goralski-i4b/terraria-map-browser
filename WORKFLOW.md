# WORKFLOW.md

```
plan-backlog → issue [backlog] → promoter [agent:ready] → automation Cezara → worktree → chain z bramkami → draft PR → CI → human merge → promoter…
```

Statusy (GitHub Project):
`Todo → Agent Ready → In Progress → PR Ready → Agent Review → Human Review → Done` (+ `Rework`).

Wybór workflow:
| Typ pracy | Workflow |
|---|---|
| Zmiana zachowania (codec, model, renderer) | `tdd-feature` (Claude impl / Codex review) lub `tdd-feature-codex` |
| CI, tooling, scaffolding, docs | `foundation` |
| Rozpoznanie formatu, research | `spike` |
| Rozpisanie milestone na issue | `plan-backlog` |

Szczegóły: `docs/agent-workflow.md`.
