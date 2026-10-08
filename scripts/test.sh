#!/usr/bin/env bash
# Tests only; assumes build.sh ran first.
source "$(dirname "$0")/lib.sh"
rc=0
echo "== backlog automation routing"
run_logged backlog-tests node --test scripts/backlog/automation-routing.test.mjs scripts/backlog/baseline.test.mjs scripts/backlog/resume.test.mjs scripts/backlog/usage-probe.test.mjs scripts/backlog/security.test.mjs || rc=1
echo "== map palette exporter"
run_logged map-palette-tests node --test scripts/map-palette/export.test.mjs scripts/map-palette/observe.test.mjs || rc=1
# dotnet test and vitest are independent and take about a minute each: run them side by side. vitest prints as it
# goes; the dotnet output is buffered and printed after it, so the two never interleave.
dotnet_out=$(mktemp) || { echo "INFRA: mktemp failed"; exit 2; }
trap 'rm -f "$dotnet_out"' EXIT
# Microsoft.Testing.Platform mode (opted in via global.json "test.runner").
{ echo "== dotnet test"; run_logged dotnet-test dotnet test --solution "$SLN" --no-build --no-progress; } >"$dotnet_out" 2>&1 &
dotnet_pid=$!
echo "== vitest"
run_logged vitest pnpm -s test || rc=1
wait "$dotnet_pid" || rc=1
cat "$dotnet_out"
exit $rc
