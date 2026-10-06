#!/usr/bin/env bash
# First step of every chain: refuse to start while Claude Code or Codex is out of credits or has less than
# USAGE_MIN_REMAINING_PERCENT (default 10) left in any window — every chain needs both (implementer + reviewer).
# The local watchdog (scripts/backlog/promote.mjs) moves an issue whose run stopped here back to `backlog`,
# so it starts again automatically once the limits allow it.
# Exit: 0 go, 3 not now (LOW), 2 the probe could not run.
source "$(dirname "$0")/../lib.sh"
node scripts/backlog/usage-probe.mjs
