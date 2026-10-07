#!/usr/bin/env bash
# Tests only; assumes build.sh ran first.
source "$(dirname "$0")/lib.sh"
rc=0
echo "== backlog automation routing"
run_logged backlog-tests node --test scripts/backlog/automation-routing.test.mjs scripts/backlog/resume.test.mjs scripts/backlog/usage-probe.test.mjs scripts/backlog/security.test.mjs || rc=1
# Microsoft.Testing.Platform mode (opted in via global.json "test.runner").
echo "== local map palette exporter"
run_logged map-palette-tests node --test scripts/map-palette/export-map-palette.test.mjs || rc=1
echo "== dotnet test"
run_logged dotnet-test dotnet test --solution "$SLN" --no-build --no-progress || rc=1
echo "== vitest"
run_logged vitest pnpm -s test || rc=1
exit $rc
