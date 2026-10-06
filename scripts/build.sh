#!/usr/bin/env bash
# Kompilacja całości z warnings-as-errors. Bez testów.
source "$(dirname "$0")/lib.sh"
echo "== dotnet build (warnaserror)"
dotnet build "$SLN" -warnaserror -v q -nologo -clp:"NoSummary;ErrorsOnly" || exit 1
echo "== tsc -b"
pnpm -s typecheck || exit 1
