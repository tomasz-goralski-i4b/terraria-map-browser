#!/usr/bin/env bash
# Compile everything with warnings as errors. No tests.
source "$(dirname "$0")/lib.sh"
ensure_deps
echo "== dotnet build (warnaserror)"
dotnet build "$SLN" -warnaserror -v q -nologo -clp:"NoSummary;ErrorsOnly" || exit 1
echo "== tsc -b"
pnpm -s typecheck || exit 1
