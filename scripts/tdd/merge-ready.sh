#!/usr/bin/env bash
# Final step of every chain: the PR becomes "ready to merge" only when
#   - the independent reviewer's verdict is APPROVE (.tdd/review.md), and
#   - GitHub CI on the PR head is green.
# Then: undraft the PR, label PR + issue `status:ready-to-merge`, post a summary comment.
# The merge itself stays with a human.
# Exit: 0 ready, 2 infrastructure (gh, CI never reported, timeout), 3 human needed (CI red, no APPROVE).
source "$(dirname "$0")/../lib.sh"
command -v gh >/dev/null || { echo "INFRA: gh is missing"; exit 2; }

CI_TIMEOUT_SECONDS="${CI_TIMEOUT_SECONDS:-1200}"
LABEL="status:ready-to-merge"

branch=$(git rev-parse --abbrev-ref HEAD)
pr=$(gh pr view "$branch" --json number -q .number 2>/dev/null) || { echo "INFRA: no PR for branch $branch (open-pr must run first)"; exit 2; }
issue=""
[ -f .tdd/issue ] && issue=$(tr -dc '0-9' < .tdd/issue)

verdict=$(head -1 .tdd/review.md 2>/dev/null | tr -d '\r')
if [ "$verdict" != "VERDICT: APPROVE" ]; then
  echo "MERGE-READY: no APPROVE verdict in .tdd/review.md ('${verdict:-missing}') — PR #$pr stays a draft."
  exit 3
fi

# The PR must be tested at the commit we pushed, not an older one.
head_sha=$(git rev-parse HEAD)
echo "MERGE-READY: waiting for CI on PR #$pr ($head_sha, timeout ${CI_TIMEOUT_SECONDS}s)"
deadline=$(( $(date +%s) + CI_TIMEOUT_SECONDS ))
while :; do
  pr_sha=$(gh pr view "$pr" --json headRefOid -q .headRefOid 2>/dev/null || true)
  checks=$(gh pr checks "$pr" --json state -q 'length' 2>/dev/null || echo 0)
  [ "$pr_sha" = "$head_sha" ] && [ "${checks:-0}" -gt 0 ] && break
  [ "$(date +%s)" -ge "$deadline" ] && { echo "INFRA: CI did not report on PR #$pr in time"; exit 2; }
  sleep 15
done

remaining=$(( deadline - $(date +%s) ))
checks_out=$(timeout "$remaining" gh pr checks "$pr" --watch --interval 20 2>&1)
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "$checks_out"
  if [ "$rc" -eq 124 ]; then echo "INFRA: CI still running after ${CI_TIMEOUT_SECONDS}s"; exit 2; fi
  gh pr comment "$pr" --body "❌ **Not ready to merge** — CI failed on \`${head_sha:0:7}\` although \`scripts/verify.sh\` passed in the agent's worktree. Needs a human look (environment difference?)." >/dev/null || true
  echo "MERGE-READY: CI failed on PR #$pr — human needed."
  exit 3
fi

gh label create "$LABEL" --color 0e8a16 --description "Reviewed by a second model, CI green — waiting for a human merge" >/dev/null 2>&1 || true
gh pr ready "$pr" >/dev/null 2>&1 || true
gh pr edit "$pr" --add-label "$LABEL" >/dev/null || { echo "INFRA: cannot label PR #$pr"; exit 2; }
if [ -n "$issue" ]; then
  gh issue edit "$issue" --remove-label status:pr-ready --add-label "$LABEL" >/dev/null || true
fi

{
  echo "✅ **Ready to merge**"
  echo
  echo "- Independent review: \`VERDICT: APPROVE\` (see *Cross-review* in the description)"
  echo "- CI: green on \`${head_sha:0:7}\`"
  echo "- Gates passed in the agent worktree: \`scripts/verify.sh\` → \`VERIFY: OK\`"
  echo
  echo "Suggested: **Squash and merge**, delete the branch. Merging closes ${issue:+#$issue and }unblocks the next backlog items."
} > .tdd/merge-ready.md
gh pr comment "$pr" --body-file .tdd/merge-ready.md >/dev/null || true
echo "MERGE-READY: PR #$pr is ready to merge."
