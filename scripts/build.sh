#!/usr/bin/env bash
# Compile everything with warnings as errors. No tests.
source "$(dirname "$0")/lib.sh"
ensure_deps
# CI must restore exactly what the committed packages.lock.json files pin.
restore_args=()
[ "${CI:-}" = "true" ] && restore_args=(--locked-mode)
echo "== dotnet restore ${restore_args[*]}"
dotnet restore "$SLN" "${restore_args[@]}" -v q || exit 1
echo "== dotnet build (warnaserror)"
dotnet build "$SLN" --no-restore -warnaserror -v q -nologo -clp:"NoSummary;ErrorsOnly" || exit 1
echo "== tsc -b"
pnpm -s typecheck || exit 1
echo "== web app build (vite)"
pnpm --filter @studio/web build || exit 1
