#!/usr/bin/env bash
# The single definition of "green": used by the Cezar chains, CI and humans.
source "$(dirname "$0")/lib.sh"
bash scripts/build.sh || exit $?
echo "== eslint (max-warnings=0)"
pnpm -s lint || exit 1
echo "== fixtures"
node scripts/check-fixtures.mjs || exit 1
bash scripts/test.sh || exit $?
echo "== inspector smoke"
out=$(dotnet run --project dotnet/Terraria.WorldInspector --no-build) || { echo "SMOKE: inspector exited with $?"; exit 1; }
out=${out%$'\r'}
[ "$out" = "Terraria World Inspector" ] || { echo "SMOKE: unexpected inspector output: '$out'"; exit 1; }
echo "VERIFY: OK"
