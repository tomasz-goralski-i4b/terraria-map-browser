#!/usr/bin/env bash
# Bramka dla chainów bez TDD (foundation/spike): pełne verify.sh + punkt odniesienia dla review.
source "$(dirname "$0")/../lib.sh"
mkdir -p .tdd
bash scripts/verify.sh || exit $?
commit_state "chore: verified"
git rev-parse HEAD > .tdd/green-sha
echo "VERIFY: OK — zapisano $(cat .tdd/green-sha)"
