# Agent workflow (Cezar)

## Starting Cezar — IMPORTANT on Windows

Cezar runs `command` steps via `bash -lc`. In plain PowerShell/cmd the first bash on PATH is
`C:\Windows\System32\bash.exe`, i.e. **WSL**, without our toolchain. Therefore:

**Start Cezar from Git Bash**, in the repo directory:

```bash
cd /d/REPOS/AI/terraria-map-studio
npx cezar-run
```

If a gate still ends up in WSL, `scripts/lib.sh` exits with code 2 and an `INFRA: ... WSL` message.

Recommended environment (e.g. in `~/.bashrc` or before `npx`):
```bash
export CEZ_DISPATCH=0      # agents in a chain do not spawn their own subtasks (those have no TDD gates)
```
Every chain ends with the `open-pr` step (push + draft PR), so Cezar's review gate is not needed
and runs started by automations can be `autonomous`.

## Backlog flow: planner → promoter → automations → you

```
1. plan-backlog (Cezar, manual)     "Plan M1"  → .tdd/backlog.json → gate creates issues [backlog]
2. promoter (GitHub Action / manual)           → issues with no open blockers, free area → [agent:ready]
3. Cezar automation (polls every 2 min)        → task with the workflow picked by flow:* / agent:* labels (autonomous)
4. chain                                        → red → green → refactor → review → open-pr → merge-ready
                                                 → draft PR "Closes #N", issue → [status:pr-ready]
                                                 → APPROVE + CI green → PR undrafted, PR + issue → [status:ready-to-merge]
5. you                                          → read the PR (description has the cross-review) → squash & merge
6. issue closed → `promote` Action              → unblocks the next ones → back to 3
```

| Label | Set by | Meaning |
|---|---|---|
| `backlog` | planner (create-issues) | planned, waiting |
| `agent:ready` | promoter | an automation starts the task |
| `status:pr-ready` | `open-pr.sh` | draft PR exists, waiting for CI |
| `status:ready-to-merge` | `merge-ready.sh` | second model approved + CI green — **your turn to merge** |
| `human` | planner | your work (e.g. a fixture from the game); close the issue when done — it unblocks dependants |
| `flow:tdd|foundation|spike` + `agent:claude|codex` | planner | workflow and implementer choice |
| `area:*` | planner | the promoter runs one issue at a time per area |

Promoter rules (`scripts/backlog/promote.mjs`): ordered by issue number, every `Blocked by: #N` closed,
area free (an area stays busy until the PR is merged), globally in flight < `MAX_ACTIVE` (2 = Cezar's `maxParallel`).

Automations (`.ai/cezar/automation-defs/*.json`) listen for `issue.labeled` = `agent:ready`, only on issues
opened by the repo owner (the repo is public). Install/update (the cockpit must be running for this repo):
```bash
bash scripts/backlog/install-automations.sh
```
New ones are created **paused**; enable them in the UI → Automations. Enabling sets a "from now on" baseline —
labels added earlier are not picked up (remove and re-add `agent:ready` in that case).

### When something goes wrong
- A Cezar task `failed` (retries exhausted, BLOCKED, INFRA) → the issue stays on `agent:ready` and its area stays busy.
  Read the log, fix the issue/code, then remove and re-add `agent:ready` (the automation starts a new task),
  or set `backlog` and run the promoter.
- `merge-ready` failed (CI red on GitHub, or no APPROVE) → the PR stays a draft with a comment; fix on the PR branch or Continue the task.
- PR feedback → Continue the task in Cezar with a comment, or fix it by hand on the PR branch.
- Bad plan → close/edit the issues on GitHub; `create-issues` skips items whose backlog key or title already exists.

## The `tdd-feature` chain

```
red ─► check-red ─► green ─► check-green ─► refactor ─► check-refactor ─► review ─► check-review ─► open-pr ─► merge-ready
 ▲        │           ▲          │             ▲             │                          │
 └─retry──┘           └──retry───┘             └───retry─────┘                          │
 ▲                                                                                      │
 └────────────────────── REQUEST_CHANGES (findings are appended to the prompt) ─────────┘
```

| Step | Who | Does | The gate checks |
|---|---|---|---|
| red | implementer | `.tdd/plan.md`, tests, stubs | tests changed, build OK, tests FAIL → commit `test: red`, `.tdd/red-sha` |
| green | implementer | minimal implementation | tests unchanged since `red-sha`, `verify.sh` OK → commit, `.tdd/green-sha` |
| refactor | implementer | clean-up, docs | same as green |
| review | the other provider | `.tdd/review.md` with a verdict | reviewer changed nothing; APPROVE=0, REQUEST_CHANGES=1 (rework), BLOCKED=3 (stop) |
| open-pr | script | push, draft PR `Closes #N` | — |
| merge-ready | script | waits for GitHub CI | APPROVE + CI green → undraft, `status:ready-to-merge`, summary comment; CI red → 3 (human) |

Rework goes back to `red`: behavioural bug → failing test first; style-only findings → red without tests (the gate lets it through).

Every workflow except `plan-backlog` ends with `review → check-review → open-pr → merge-ready`:
the implementer never reviews its own work, and a PR is only marked ready when a second model approved it
and CI is green. `spike` is researched by Claude and reviewed by Codex; `foundation` the same.

## Gate exit codes
| Code | Meaning | Cezar |
|---|---|---|
| 0 | OK | next step |
| 1 | the work is wrong, the agent can fix it | `retry` (with the output in the prompt), up to `max` |
| 2 | infrastructure (missing tool, WSL) | stop — no agent attempts wasted (`retryOn: [1]`) |
| 3 | human decision (BLOCKED, reviewer edited code) | stop |

## Cezar facts this relies on
- Every agent step is a **new session** — hence the `.tdd/` handoff and skills that tell agents to read files.
- A step is either `prompt`/`skill` or `command` — never both.
- `retry` jumps back to the named step and re-runs everything after it; `max` is counted per gate.
- Codex ignores `allowedTools` — the "reviewer must not edit" rule is enforced by `check-review.sh`, not by permissions.
- Cezar keeps task worktrees inside the repo (`.ai/cezar/worktrees/`, gitignored); tooling must ignore `.ai/`.

## Experiment metrics (per issue, recorded in the PR)
time Agent Ready → draft PR · human interventions · first CI result · rework cycles · provider · failure cause.
