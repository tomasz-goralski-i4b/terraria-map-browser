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
| `status:stalled` | promoter (watchdog) | the chain stopped without a PR (usage limit, crash) — **needs you**; area stays busy |
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

### Review notes → follow-up issues
An `APPROVE` review can still carry non-blocking notes. The reviewer writes them as `Needs a human decision:`
(something you must confirm, e.g. a contract change outside the issue's Ownership) and `Nice to have:`
(suggestions). `merge-ready` files them as **one issue per PR** labelled `follow-up` (+ the area), links it in
the "Ready to merge" comment, and warns when a decision is needed. Follow-ups are not `backlog`, so nothing runs
automatically: triage them (plan, decide or close). The planner reads open follow-ups when planning the next
milestone. For older PRs: `node scripts/backlog/followups.mjs <pr> [--dry-run]`.

### Who can start agent work (public repo)
Anyone can open an issue in this public repository; only **trusted authors** (`.ai/cezar/trusted-authors.json`)
can get work into the agent pipeline. Layers, each sufficient on its own:
1. **Cezar automations** start a task only for issues authored by a trusted author (`filters.authors`).
2. **The promoter** promotes only trusted authors' issues and logs untrusted ones as ignored.
3. **The `issue-guard` Action** strips pipeline labels (`backlog`, `agent:*`, `flow:*`, `status:*`) from any
   untrusted author's issue as soon as it is opened, edited or labelled — e.g. labels an issue template attached.
4. **Agents** read issues with `gh issue view` **without** `--comments` and treat the body as a spec, not as
   instructions.
5. `security.test.mjs` (in `verify.sh`) fails if an automation loses its author filter, its authors drift from the
   trusted list, or an issue template attaches a pipeline label.

Only collaborators can add labels, so outsiders cannot label their own issues. To trust another person, add their
login to `trusted-authors.json` **and** re-run `bash scripts/backlog/install-automations.sh` after updating the
`authors` filter of every automation definition (the test enforces that they match).

### Usage preflight
Every chain needs both providers (one implements, the other reviews). The first step of every workflow,
`preflight`, runs `scripts/backlog/usage-probe.mjs` and refuses to start when either provider is out of credits
or has less than `USAGE_MIN_REMAINING_PERCENT` (default 10) left in any window:
- **Codex:** `codex app-server` → `account/rateLimits/read` — the official, zero-cost read of the 5-hour and weekly
  windows, credits and `ordinaryUsageAllowed` (no model call).
- **Claude Code:** there is no zero-cost API (anthropics/claude-code#32796; `/usage` is interactive only), so the
  probe sends one minimal Haiku request and reads the `rate_limit_event` (five_hour / seven_day utilization).
  Skipped when Codex is already LOW.

Results are cached in `~/.cache/terraria-map-studio/usage-probe.json` (OK for 10 min, LOW for 3 min). The local
promoter does not promote while usage is LOW, and moves an issue whose run stopped at `preflight` back to
`backlog` (deferred, not stalled), so work resumes by itself once limits reset or credits are refilled.
The CI promoter cannot probe usage; the local promoter publishes its verdict as the repository Actions
variable `PIPELINE_USAGE_LOW` (set while LOW, deleted when OK) and the CI promoter promotes nothing while it is set.
Check by hand: `node scripts/backlog/usage-probe.mjs [--fresh]`.

### Resuming chains Cezar ended early
Cezar bug: when an agent step hits a usage/session limit, auto-resume finishes the conversation (`continue-N`
steps) and then marks the run `done` — the remaining gates, `open-pr` and `merge-ready` never run.
`scripts/backlog/resume.mjs` finishes such a run: it executes the remaining **command** steps of the run's own
workflow definition in its worktree (`bash -lc`, as Cezar would), skips the optional `refactor`, and stops at
the first other agent step or failing gate (no agent is available for a retry loop). It only acts when the
failed step is an agent step with a usage-limit error and its continuation finished; the PR description gets a
"Chain resumed after a usage limit" section. The local promoter calls it automatically before flagging a stall;
by hand: `node scripts/backlog/resume.mjs <run-id> [--dry-run]`.

Run the local watcher next to Cezar so this happens without you (Git Bash, repo root):

```bash
bash scripts/backlog/watch.sh        # promoter every 10 min, using the scripts from origin/main
```

### Stall watchdog
A chain can die without any GitHub event (e.g. the agent hits a usage limit and Cezar ends the run early).
The promoter therefore also runs every 30 minutes (Action cron) and checks issues on `agent:ready`:
- **locally** (`bash scripts/backlog/promote.sh`, Cezar cockpit reachable): stalled as soon as Cezar's run for the
  issue is finished/failed while the issue never reached `status:pr-ready`, or no run started within 15 min;
- **in CI** (no access to the local cockpit): stalled after `STALL_MINUTES` (120) on `agent:ready`.

A stalled issue gets `status:stalled` and one comment with the reason (e.g. the failed step and its error).
The label is cleared automatically when a new Cezar run for the issue is live, or when `open-pr` succeeds.

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
| (check-red-defect) | script | — | green wrote `.tdd/red-defect.md` ("this red test can never pass, per spec") → back to red, which fixes the test (`test: fix red-phase defect`) or rejects the report; once per run; shown to the reviewer and in the PR |
| refactor | implementer | clean-up, docs | same as green |
| review | the other provider | `.tdd/review.md` with a verdict | reviewer changed nothing; APPROVE=0, REQUEST_CHANGES=1 (rework), BLOCKED=3 (stop) |
| open-pr | script | push, draft PR `Closes #N` | — |
| merge-ready | script | waits for GitHub CI | APPROVE + CI green → undraft, `status:ready-to-merge`, summary comment; CI red → 3 (human) |

Rework goes back to `red`: behavioural bug → failing test first; style-only findings → red without tests (the gate lets it through).

Every workflow except `plan-backlog` ends with `review → check-review → open-pr → merge-ready`:
the implementer never reviews its own work, and a PR is only marked ready when a second model approved it
and CI is green. `spike` is researched by Claude and reviewed by Codex. Foundation issues select
`foundation` (Claude implements, Codex reviews) with `agent:claude`, or `foundation-codex`
(Codex implements, Claude reviews) with `agent:codex`. The two automation filters are disjoint;
foundation issues must carry exactly one implementer label. Step runners override the task default.

## Models per step

Not every step needs the strongest model. Each agent step pins `runner` + `model` in its workflow YAML
(Cezar: the step setting wins over the task/automation default). Tiers:

| Tier | Claude | Codex | Used for | Why |
|---|---|---|---|---|
| deep | `opus` | `gpt-6.1-sol` | TDD **red**, **review**, spike **research** | tests are the spec; review is the last independent check; research needs judgement |
| standard | `sonnet` | `gpt-6.1-sol` | TDD **green**, foundation **implement** | the tests and gates constrain the work |
| light | `haiku` | `gpt-6-luna` | TDD **refactor** | optional clean-up; an empty refactor is fine and the gates guard behaviour |
| (task) | picked in the New Task dialog | | `plan-backlog` | rare, high leverage — choose per run |

The strongest models (`fable`, `gpt-6-astra`) are not used by default — escalate manually for a hard issue
(change the model of that step on a branch, or restart the issue after editing the workflow).
Codex reasoning effort is not settable per step; it comes from `~/.codex/config.toml` (`model_reasoning_effort`).
Model ids come from `GET /api/v1/models?runner=claude|codex` on the cockpit; the Claude aliases float to the newest release.
Review the tiering with the experiment metrics (first-CI result, rework cycles per step) and move steps up or down.

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
