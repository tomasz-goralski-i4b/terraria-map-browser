#!/usr/bin/env bash
# The single definition of "green": used by the Cezar chains, CI and humans.
source "$(dirname "$0")/lib.sh"
bash scripts/build.sh || exit $?
echo "== eslint (max-warnings=0)"
pnpm -s lint || exit 1
echo "== contracts"
run_logged contracts-validation node --test scripts/contracts-validation.test.mjs || exit 1
node scripts/check-contracts.mjs || exit 1
echo "== draft PR body"
bash scripts/tdd/open-pr-body.test.sh || exit 1
echo "== fixtures"
node scripts/check-fixtures.mjs || exit 1
bash scripts/test.sh || exit $?
echo "== inspector smoke"
smoke_stdout=$(mktemp) || exit 1
smoke_stderr=$(mktemp) || { rm -f "$smoke_stdout"; exit 1; }
trap 'rm -f "$smoke_stdout" "$smoke_stderr"' EXIT
smoke_status=0
dotnet run --project dotnet/Terraria.WorldInspector --no-build >"$smoke_stdout" 2>"$smoke_stderr" || smoke_status=$?
[ "$smoke_status" -eq 2 ] || { echo "SMOKE: expected argument exit code 2, got $smoke_status"; exit 1; }
[ ! -s "$smoke_stdout" ] || { echo "SMOKE: unexpected inspector stdout"; exit 1; }
usage=$(cat "$smoke_stderr")
usage=${usage//$'\r'/}
expected=$'Usage: Terraria.WorldInspector inspect <file.wld>\n       Terraria.WorldInspector export-json <file.wld> [--region x,y,w,h]'
[ "$usage" = "$expected" ] || { echo "SMOKE: unexpected inspector diagnostic: '$usage'"; exit 1; }
echo "VERIFY: OK"
