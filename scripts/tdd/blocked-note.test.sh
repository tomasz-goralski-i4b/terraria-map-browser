#!/usr/bin/env bash
# Exercise stop_if_blocked with a mocked gh in a throwaway repository; no network or real issue comments.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/terraria-blocked.XXXXXX")
[[ "$sandbox" == "${TMPDIR:-/tmp}/terraria-blocked."* ]] || exit 2
trap 'rm -rf -- "$sandbox"' EXIT
git -C "$sandbox" init -q
mkdir -p "$sandbox/scripts/tdd" "$sandbox/.tdd"
cp "$root/scripts/lib.sh" "$sandbox/scripts/lib.sh"
printf '50\n' > "$sandbox/.tdd/issue"

# Runs the gate once, as scripts/tdd/check-red.sh would; gh records each comment body in .tdd/comments.
gate() {
  local status=0
  (
    cd "$sandbox"
    source scripts/lib.sh
    gh() {
      case "$1 $2" in
        'issue edit') ;;
        'issue comment') { cat; echo '---'; } >> .tdd/comments ;;
        *) echo "Unexpected gh call: $*" >&2; return 2 ;;
      esac
    }
    stop_if_blocked
  ) >/dev/null || status=$?
  [ "$status" -eq 3 ]
}
comments() { grep -c '^---$' "$sandbox/.tdd/comments"; }

printf 'The spec contradicts itself.\n' > "$sandbox/.tdd/blocked.md"
gate
gate
[ "$(comments)" -eq 1 ]
echo 'BLOCKED NOTE: a re-run gate does not repeat the same note on the issue'

printf 'A different problem.\n' > "$sandbox/.tdd/blocked.md"
gate
[ "$(comments)" -eq 2 ]
grep -q 'A different problem.' "$sandbox/.tdd/comments"
echo 'BLOCKED NOTE: a changed note is posted again'
