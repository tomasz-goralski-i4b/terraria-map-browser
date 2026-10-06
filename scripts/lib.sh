# Shared helpers for scripts/*. Sourced, not executed.
# Exit code convention (see onFail.retryOn in .ai/cezar/workflows):
#   1 = the work is wrong — the agent can fix it (Cezar loops back to the agent step)
#   2 = infrastructure (missing tool, wrong shell) — the agent cannot fix it, the run stops
#   3 = human decision (BLOCKED, chain rule violated) — the run stops

set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "INFRA: not a git repository"; exit 2; }
cd "$ROOT"

# Cezar runs checks via `bash -lc`. On Windows the first bash on PATH is often WSL
# (C:\Windows\System32\bash.exe), which does not have our toolchain.
if [ -n "${WSL_DISTRO_NAME:-}" ] || [ -e /proc/sys/fs/binfmt_misc/WSLInterop ]; then
  echo "INFRA: the check is running in WSL instead of Git Bash. Start cezar from Git Bash (see docs/agent-workflow.md)."
  exit 2
fi

for tool in dotnet pnpm git; do
  command -v "$tool" >/dev/null 2>&1 || { echo "INFRA: '$tool' is not on PATH"; exit 2; }
done

export DOTNET_NOLOGO=1 DOTNET_CLI_TELEMETRY_OPTOUT=1 FORCE_COLOR=0 NO_COLOR=1

SLN="dotnet/TerrariaMapStudio.slnx"

# What counts as a "test" — single source of truth for all TDD gates.
TEST_PATHSPEC=(
  ':(glob)dotnet/**/*.Tests/**'
  ':(glob)**/*.test.ts'
  ':(glob)**/*.spec.ts'
  ':(glob)packages/test-fixtures/**'
)

# The commit Cezar forked the worktree from: the most recent merge-base of HEAD with
# BASE_BRANCH / main / origin/main (whichever of local and remote main is further ahead).
base_ref() {
  local b mb best=""
  for b in "${BASE_BRANCH:-}" main origin/main; do
    [ -n "$b" ] && git rev-parse -q --verify "$b" >/dev/null || continue
    mb=$(git merge-base HEAD "$b") || continue
    if [ -z "$best" ] || git merge-base --is-ancestor "$best" "$mb"; then best=$mb; fi
  done
  [ -n "$best" ] && { echo "$best"; return; }
  git rev-list --max-parents=0 HEAD | tail -1
}

# Test files changed since $1 (committed + working tree + untracked).
changed_tests_since() {
  { git diff --name-only "$1" -- "${TEST_PATHSPEC[@]}"
    git ls-files -o --exclude-standard -- "${TEST_PATHSPEC[@]}"; } | sort -u
}

# "Read .wld version and header (#5)" when the task comes from an issue (.tdd/issue), else empty.
task_label() {
  local n=""
  [ -f .tdd/issue ] && n=$(tr -dc '0-9' < .tdd/issue)
  [ -n "$n" ] || return 0
  if [ ! -s .tdd/issue-title ] && command -v gh >/dev/null; then
    gh issue view "$n" --json title -q .title 2>/dev/null | sed 's/^\[[^]]*\] //' > .tdd/issue-title || true
  fi
  if [ -s .tdd/issue-title ]; then echo "$(cat .tdd/issue-title) (#$n)"; else echo "issue #$n"; fi
}

# One commit per gate: "<type>: <phase> — <task>". Skipped when the phase changed nothing,
# so a phase that changed nothing leaves no empty commit; the .tdd/*-sha files point at HEAD either way.
commit_state() {
  local type="$1" phase="$2" label
  label=$(task_label)
  git add -A
  if git diff --cached --quiet; then
    echo "($phase: nothing to commit)"
    return 0
  fi
  git commit -q -m "$type: $phase${label:+ — $label}"
}

# An agent that cannot proceed without a human writes .tdd/blocked.md and ends its step (autonomous runs override
# questions with "continue", so asking in chat only loops). Every gate after an agent step calls this first: the
# chain stops with exit 3, and the issue gets status:stalled plus the agent's note, so the watchdog adds nothing.
stop_if_blocked() {
  [ -f .tdd/blocked.md ] || return 0
  echo "BLOCKED: the agent needs a human decision (.tdd/blocked.md):"
  cat .tdd/blocked.md
  local n=""
  [ -f .tdd/issue ] && n=$(tr -dc '0-9' < .tdd/issue)
  if [ -n "$n" ] && command -v gh >/dev/null; then
    gh issue edit "$n" --add-label status:stalled >/dev/null 2>&1 || true
    { printf '🛑 **Blocked — needs a human decision** (step before `%s`).\n\n' "$(basename "$0" .sh)"
      cat .tdd/blocked.md
      printf '\n\nDecide in the issue body (Scope / Acceptance criteria / flow label), then remove and re-add `agent:ready`.\n'
    } | gh issue comment "$n" --body-file - >/dev/null 2>&1 || true
  fi
  exit 3
}

# Runs a test command with its full output in .tdd/logs/<name>.log and prints a compact view: on success the
# last summary lines; on failure each failing test with its message (no stack traces, at most 20 tests), then
# the summary. Agent steps read this output, and full xUnit traces cost ~300 KB per red run. CI=true or
# VERBOSE=1 prints everything as before.
# Usage: run_logged <name> <command...>
run_logged() {
  local name="$1"; shift
  if [ "${CI:-}" = "true" ] || [ "${VERBOSE:-}" = "1" ]; then
    "$@"
    return
  fi
  local log=".tdd/logs/$name.log" rc=0
  mkdir -p .tdd/logs
  "$@" >"$log" 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then
    grep -E 'total:|failed:|succeeded:|Tests +[0-9]|Test Files|^ℹ (tests|pass|fail) ' "$log" || tail -n 3 "$log"
  else
    awk '
      /^[[:space:]]+at |----- Inner Stack Trace|^[[:space:]]+from .*\.dll|^Running tests from|^[[:space:]]*$/ { next }
      /^(failed|✗|×|not ok|✖) / || /^ *(FAIL|×) / {
        inblock = 1; msg = 0
        if (++shown > 20) { hidden++; skip = 1; next }
        skip = 0; print; next
      }
      /^  / && inblock { if (!skip && ++msg <= 4) print; next }
      { inblock = 0; skip = 0; print }
      END { if (hidden) printf "… %d more failing tests — full output in the log\n", hidden }
    ' "$log" | head -n 200
    echo "(full output: $log)"
  fi
  return "$rc"
}

# A fresh worktree (Cezar) has no node_modules. Installing from the pnpm store takes seconds.
ensure_deps() {
  local manifests_changed=""
  if [ -f node_modules/.modules.yaml ]; then
    manifests_changed=$(find . -path ./node_modules -prune -o -path ./.ai -prune -o \
      \( -name package.json -o -name pnpm-workspace.yaml \) -newer node_modules/.modules.yaml -print -quit 2>/dev/null)
  fi
  if [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ] || [ -n "$manifests_changed" ]; then
    echo "== pnpm install"
    if ! pnpm install --frozen-lockfile --prefer-offline --reporter=silent --config.confirmModulesPurge=false 2>/dev/null; then
      if [ -n "${CI:-}" ]; then
        echo "INFRA: pnpm install --frozen-lockfile failed in CI — is pnpm-lock.yaml committed and up to date?"; exit 1
      fi
      # Locally (agent worktrees) a task may legitimately add or change dependencies: update the lockfile;
      # the gate commits it with the change, and CI then enforces it with --frozen-lockfile.
      echo "== pnpm install (lockfile out of date — updating it)"
      if ! out=$(pnpm install --no-frozen-lockfile --prefer-offline --reporter=append-only --config.confirmModulesPurge=false 2>&1); then
        echo "$out" | tail -20
        echo "DEPS: pnpm install failed — fix the dependency declarations (package.json, pnpm-workspace.yaml catalog)."
        exit 1
      fi
    fi
  fi
}
