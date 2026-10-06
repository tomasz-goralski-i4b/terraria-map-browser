# WORKFLOW.md

```
issue → Cezar task (workflow) → osobny worktree → chain z bramkami → review gate → draft PR → CI → human merge
```

Statusy (GitHub Project):
`Todo → Agent Ready → In Progress → PR Ready → Agent Review → Human Review → Done` (+ `Rework`).

Wybór workflow:
| Typ pracy | Workflow |
|---|---|
| Zmiana zachowania (codec, model, renderer) | `tdd-feature` (Claude impl / Codex review) lub `tdd-feature-codex` |
| CI, tooling, scaffolding, docs | `foundation` |
| Rozpoznanie formatu, research | `spike` |

Szczegóły: `docs/agent-workflow.md`.
