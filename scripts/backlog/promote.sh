#!/usr/bin/env bash
# Run the promoter by hand (normally the GitHub Action does it when an issue closes).
# Usage: bash scripts/backlog/promote.sh [--dry-run]
exec node "$(dirname "$0")/promote.mjs" "$@"
