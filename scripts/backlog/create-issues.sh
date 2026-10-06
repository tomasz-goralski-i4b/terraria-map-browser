#!/usr/bin/env bash
# Planner gate: validates .tdd/backlog.json and creates issues from it (label `backlog`, no agent:ready).
source "$(dirname "$0")/../lib.sh"
command -v gh >/dev/null || { echo "INFRA: gh is missing"; exit 2; }
node scripts/backlog/create-issues.mjs "${1:-.tdd/backlog.json}"
