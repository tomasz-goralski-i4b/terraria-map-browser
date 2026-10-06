#!/usr/bin/env bash
# Same testy, zakłada wcześniejszy build.sh.
source "$(dirname "$0")/lib.sh"
rc=0
echo "== dotnet test"
dotnet test "$SLN" --no-build -v q -nologo || rc=1
echo "== vitest"
pnpm -s test || rc=1
exit $rc
