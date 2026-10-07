#!/usr/bin/env bash
# Exercise TEST_PATHSPEC (what the TDD gates count as tests) in a throwaway repository.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/terraria-pathspec.XXXXXX")
[[ "$sandbox" == "${TMPDIR:-/tmp}/terraria-pathspec."* ]] || exit 2
trap 'rm -rf -- "$sandbox"' EXIT
git -C "$sandbox" init -q
git -C "$sandbox" config core.autocrlf false
mkdir -p "$sandbox/scripts"
cp "$root/scripts/lib.sh" "$sandbox/scripts/lib.sh"
git -C "$sandbox" -c user.name=t -c user.email=t@t add -A
git -C "$sandbox" -c user.name=t -c user.email=t@t commit -qm base

tests=(
  dotnet/Terraria.WorldCodec.Tests/Builders/TileBuilder.cs
  packages/world-codec/src/header.test.ts
  packages/world-codec/tests/shared-contract-support.ts
  packages/world-codec/tests/fixtures/world-worker-fixture.ts
  apps/web/tests/support/world-file.ts
  apps/web/tests/app.browser.test.tsx
  packages/test-fixtures/worlds/manifest.json
)
production=(
  packages/world-codec/src/header.ts
  packages/assets/src/xnb-fixture.ts
  apps/web/src/App.tsx
  scripts/verify.sh
)
for file in "${tests[@]}" "${production[@]}"; do
  mkdir -p "$sandbox/$(dirname "$file")"
  echo changed >> "$sandbox/$file"
done

matched=$(cd "$sandbox" && source scripts/lib.sh && changed_tests_since HEAD)
for file in "${tests[@]}"; do
  grep -qxF "$file" <<<"$matched" || { echo "TEST PATHSPEC: $file should count as a test"; exit 1; }
done
for file in "${production[@]}"; do
  if grep -qxF "$file" <<<"$matched"; then echo "TEST PATHSPEC: $file should count as production code"; exit 1; fi
done
echo 'TEST PATHSPEC: helpers under {packages,apps}/*/tests/ count as tests; src/ files without .test stay production'
