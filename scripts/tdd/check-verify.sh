#!/usr/bin/env bash
# Gate for non-TDD chains (foundation/spike): full verify.sh + a reference point for review.
# Usage: check-verify.sh [commit type] [phase] — "chore implement" (default) for foundation, "docs research" for spike.
source "$(dirname "$0")/../lib.sh"
stop_if_blocked
mkdir -p .tdd
bash scripts/verify.sh || exit $?
commit_state "${1:-chore}" "${2:-implement}"
git rev-parse HEAD > .tdd/green-sha
echo "VERIFY: OK — saved $(cat .tdd/green-sha)"
