#!/usr/bin/env bash
# Exercise publication with mocked git/gh; no network or real repository mutations.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/terraria-pr-body.XXXXXX")
[[ "$sandbox" == "${TMPDIR:-/tmp}/terraria-pr-body."* ]] || exit 2
trap 'rm -rf -- "$sandbox"' EXIT
export PUBLISH_ROOT="$sandbox"
mkdir -p "$sandbox/scripts/tdd" "$sandbox/.tdd"
cp "$root/scripts/tdd/open-pr.sh" "$sandbox/scripts/tdd/open-pr.sh"
cat > "$sandbox/scripts/lib.sh" <<'MOCK'
set -uo pipefail
cd "$PUBLISH_ROOT"
base_ref() { echo 395922f; }
git() {
  case "$*" in
    'rev-parse --abbrev-ref HEAD') echo cez/f6153187 ;;
    'rev-list 395922f..HEAD') echo 15087e5 ;;
    'push -q -u origin HEAD') echo push >> .tdd/calls ;;
    'log --reverse --format=- %s 395922f..HEAD') echo '- fix: validate shared vector offsets semantically (#33)' ;;
    *) echo "Unexpected git call: $*" >&2; return 2 ;;
  esac
}
gh() {
  case "$1 $2" in
    'pr view') return 1 ;;
    'issue view') echo '[M2+M3] Publish shared metadata and tile vectors with JSON Schemas' ;;
    'pr create')
      echo create >> .tdd/calls
      while [ "$#" -gt 0 ]; do
        if [ "$1" = '--body-file' ]; then cp "$2" .tdd/published.md; break; fi
        shift
      done
      echo 'https://github.com/tomasz-goralski-i4b/terraria-map-browser/pull/65'
      ;;
    'issue edit') echo label >> .tdd/calls ;;
    *) echo "Unexpected gh call: $*" >&2; return 2 ;;
  esac
}
MOCK
printf '33\n' > "$sandbox/.tdd/issue"
printf 'VERDICT: APPROVE\n' > "$sandbox/.tdd/review.md"
printf 'Closes #33\n\nClaude review is pending.\n' > "$sandbox/.tdd/prepared body.md"

bash "$sandbox/scripts/tdd/open-pr.sh" --body-file '.tdd/prepared body.md' >/dev/null
cmp "$sandbox/.tdd/prepared body.md" "$sandbox/.tdd/published.md"
echo 'PR BODY: prepared body preserved'

rm -f "$sandbox/.tdd/calls"
status=0
bash "$sandbox/scripts/tdd/open-pr.sh" --body-file .tdd/missing.md >/dev/null || status=$?
[ "$status" -eq 2 ] && [ ! -e "$sandbox/.tdd/calls" ]
echo 'PR BODY: missing body rejected before push'

status=0
bash "$sandbox/scripts/tdd/open-pr.sh" --unsupported >/dev/null || status=$?
[ "$status" -eq 2 ] && [ ! -e "$sandbox/.tdd/calls" ]
echo 'PR BODY: unknown arguments rejected before push'

bash "$sandbox/scripts/tdd/open-pr.sh" >/dev/null
grep -q 'Closes #33' "$sandbox/.tdd/published.md"
grep -q 'VERDICT: APPROVE' "$sandbox/.tdd/published.md"
echo 'PR BODY: default approved-chain description retained'
