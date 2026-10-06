#!/usr/bin/env bash
# Gate for non-TDD chains (foundation/spike): full verify.sh + a reference point for review.
source "$(dirname "$0")/../lib.sh"
mkdir -p .tdd
bash scripts/verify.sh || exit $?
commit_state "chore: verified"
git rev-parse HEAD > .tdd/green-sha
echo "VERIFY: OK — saved $(cat .tdd/green-sha)"
