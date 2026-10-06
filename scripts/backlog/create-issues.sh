#!/usr/bin/env bash
# Bramka planner'a: waliduje .tdd/backlog.json i tworzy z niego issue (label `backlog`, bez agent:ready).
source "$(dirname "$0")/../lib.sh"
command -v gh >/dev/null || { echo "INFRA: brak gh"; exit 2; }
node scripts/backlog/create-issues.mjs "${1:-.tdd/backlog.json}"
