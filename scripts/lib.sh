# Wspólne helpery dla scripts/*. Source'owane, nie uruchamiane.
# Konwencja exit codes (patrz onFail.retryOn w .ai/cezar/workflows):
#   1 = praca jest zła — agent może to naprawić (Cezar wraca do kroku agenta)
#   2 = infrastruktura (brak narzędzia, zły shell) — agent nie naprawi, run staje
#   3 = decyzja człowieka (BLOCKED, naruszenie reguł chaina) — run staje

set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "INFRA: to nie jest repo git"; exit 2; }
cd "$ROOT"

# Cezar uruchamia checki przez `bash -lc`. Na Windows pierwszy w PATH bywa WSL bash
# (C:\Windows\System32\bash.exe), który nie ma naszego toolchainu.
if [ -n "${WSL_DISTRO_NAME:-}" ] || [ -e /proc/sys/fs/binfmt_misc/WSLInterop ]; then
  echo "INFRA: check działa w WSL zamiast Git Bash. Uruchom cezar z Git Bash (patrz docs/agent-workflow.md)."
  exit 2
fi

for tool in dotnet pnpm git; do
  command -v "$tool" >/dev/null 2>&1 || { echo "INFRA: brak '$tool' w PATH"; exit 2; }
done

export DOTNET_NOLOGO=1 DOTNET_CLI_TELEMETRY_OPTOUT=1 FORCE_COLOR=0 NO_COLOR=1

SLN="dotnet/TerrariaMapStudio.sln"

# Co jest "testem" — jedno źródło prawdy dla wszystkich bramek TDD.
TEST_PATHSPEC=(
  ':(glob)dotnet/**/*.Tests/**'
  ':(glob)**/*.test.ts'
  ':(glob)**/*.spec.ts'
  ':(glob)packages/test-fixtures/**'
)

# Gałąź, od której Cezar forkuje worktree.
base_ref() {
  local b
  for b in "${BASE_BRANCH:-}" origin/main main; do
    [ -n "$b" ] && git rev-parse -q --verify "$b" >/dev/null && { git merge-base HEAD "$b"; return; }
  done
  git rev-list --max-parents=0 HEAD | tail -1
}

# Pliki testów zmienione względem $1 (commitowane + working tree + nowe).
changed_tests_since() {
  { git diff --name-only "$1" -- "${TEST_PATHSPEC[@]}"
    git ls-files -o --exclude-standard -- "${TEST_PATHSPEC[@]}"; } | sort -u
}

commit_state() {
  git add -A
  git commit -q --allow-empty -m "$1"
}

# Świeży worktree (Cezar) nie ma node_modules. Install ze store'a pnpm to kilka sekund.
ensure_deps() {
  if [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules/.modules.yaml ]; then
    echo "== pnpm install"
    pnpm install --frozen-lockfile --prefer-offline --reporter=silent || { echo "INFRA: pnpm install nie przeszedł"; exit 2; }
  fi
}
