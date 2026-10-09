#!/usr/bin/env bash
# Tests only; assumes build.sh ran first. STUDIO_VERIFY_PART (scripts/lib.sh) selects one half.
source "$(dirname "$0")/lib.sh"
rc=0
if runs_part web; then
  echo "== backlog automation routing"
  run_logged backlog-tests node --test scripts/backlog/automation-routing.test.mjs scripts/backlog/baseline.test.mjs scripts/backlog/resume.test.mjs scripts/backlog/usage-probe.test.mjs scripts/backlog/security.test.mjs || rc=1
  echo "== map palette exporter"
  run_logged map-palette-tests node --test scripts/map-palette/export.test.mjs scripts/map-palette/observe.test.mjs || rc=1
fi
if runs_part dotnet; then
  # Microsoft.Testing.Platform mode (opted in via global.json "test.runner").
  echo "== dotnet test"
  run_logged dotnet-test dotnet test --solution "$SLN" --no-build --no-progress || rc=1
fi
if runs_part web; then
  echo "== vitest"
  vitest_args=()
  if [ "${STUDIO_SKIP_PERF:-}" = 1 ]; then
    echo "   (STUDIO_SKIP_PERF=1: skipping tests tagged perf)"
    vitest_args+=(--tags-filter '!perf')
  fi
  run_logged vitest pnpm -s test "${vitest_args[@]}" || rc=1
fi
exit $rc
