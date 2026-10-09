#!/usr/bin/env bash
# Compile everything with warnings as errors. No tests. STUDIO_VERIFY_PART (scripts/lib.sh) selects one half.
source "$(dirname "$0")/lib.sh"
if runs_part dotnet; then
  # CI must restore exactly what the committed packages.lock.json files pin.
  restore_args=()
  [ "${CI:-}" = "true" ] && restore_args=(--locked-mode)
  echo "== dotnet restore ${restore_args[*]}"
  dotnet restore "$SLN" "${restore_args[@]}" -v q || exit 1
  echo "== dotnet build (warnaserror)"
  dotnet build "$SLN" --no-restore -warnaserror -v q -nologo -clp:"NoSummary;ErrorsOnly" || exit 1
fi
if runs_part web; then
  ensure_deps
  echo "== tsc -b"
  pnpm -s typecheck || exit 1
  echo "== web app build (vite)"
  pnpm --filter @studio/web build || exit 1
fi
