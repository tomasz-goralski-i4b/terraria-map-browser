#!/usr/bin/env bash
# Ręczne odpalenie promotera (normalnie robi to GitHub Action po zamknięciu issue).
# Użycie: bash scripts/backlog/promote.sh [--dry-run]
exec node "$(dirname "$0")/promote.mjs" "$@"
