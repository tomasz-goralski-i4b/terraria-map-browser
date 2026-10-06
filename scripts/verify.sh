#!/usr/bin/env bash
# Jedyna definicja "zielonego": używają jej chain Cezara, CI i człowiek.
source "$(dirname "$0")/lib.sh"
bash scripts/build.sh || exit $?
echo "== eslint (max-warnings=0)"
pnpm -s lint || exit 1
bash scripts/test.sh || exit $?
echo "VERIFY: OK"
