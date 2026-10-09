#!/usr/bin/env bash
# Tests only; assumes build.sh ran first.
source "$(dirname "$0")/lib.sh"
rc=0
echo "== backlog automation routing"
run_logged backlog-tests node --test scripts/backlog/automation-routing.test.mjs scripts/backlog/baseline.test.mjs scripts/backlog/resume.test.mjs scripts/backlog/usage-probe.test.mjs scripts/backlog/security.test.mjs || rc=1
echo "== map palette exporter"
run_logged map-palette-tests node --test scripts/map-palette/export.test.mjs scripts/map-palette/observe.test.mjs || rc=1
echo "== tile framing observer (opt-in: TERRARIA_ASSEMBLY)"
run_logged framing-tests node --test scripts/framing/observe.test.mjs || rc=1
# Microsoft.Testing.Platform mode (opted in via global.json "test.runner").
echo "== dotnet test"
run_logged dotnet-test dotnet test --solution "$SLN" --no-build --no-progress || rc=1
echo "== vitest"
vitest_args=()
if [ "${STUDIO_SKIP_PERF:-}" = 1 ]; then
  echo "   (STUDIO_SKIP_PERF=1: skipping tests tagged perf)"
  vitest_args+=(--tags-filter '!perf')
fi
run_logged vitest pnpm -s test "${vitest_args[@]}" || rc=1
exit $rc
