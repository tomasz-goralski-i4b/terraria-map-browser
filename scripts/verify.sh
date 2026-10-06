#!/usr/bin/env bash
# The single definition of "green": used by the Cezar chains, CI and humans.
source "$(dirname "$0")/lib.sh"
bash scripts/build.sh || exit $?
echo "== eslint (max-warnings=0)"
pnpm -s lint || exit 1
bash scripts/test.sh || exit $?
echo "VERIFY: OK"
