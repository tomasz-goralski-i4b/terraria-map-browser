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

commit_state() {
  git add -A
  git commit -q --allow-empty -m "$1"
}

# A fresh worktree (Cezar) has no node_modules. Installing from the pnpm store takes seconds.
ensure_deps() {
  if [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
    echo "== pnpm install"
    pnpm install --frozen-lockfile --prefer-offline --reporter=silent || { echo "INFRA: pnpm install failed"; exit 2; }
  fi
}
