#!/usr/bin/env bash
# Tests only; assumes build.sh ran first.
source "$(dirname "$0")/lib.sh"
rc=0
echo "== backlog automation routing"
node --test scripts/backlog/automation-routing.test.mjs scripts/backlog/resume.test.mjs scripts/backlog/usage-probe.test.mjs scripts/backlog/security.test.mjs || rc=1
# Microsoft.Testing.Platform mode (opted in via global.json "test.runner").
echo "== dotnet test"
dotnet test --solution "$SLN" --no-build --no-progress || rc=1
echo "== vitest"
pnpm -s test || rc=1
exit $rc
