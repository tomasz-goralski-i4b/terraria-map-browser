// Idempotentnie tworzy labels używane przez backlog, promotera i automations Cezara.
import { gh } from "./gh.mjs";

const labels = [
  ["backlog", "c5def5", "Zaplanowane, czeka na odblokowanie przez promotera"],
  ["agent:ready", "0e8a16", "Promoter odblokował — automation Cezara startuje task"],
  ["status:pr-ready", "1d76db", "Chain skończony, draft PR czeka na człowieka"],
  ["human", "e99695", "Wymaga człowieka (np. gra, decyzja) — promoter pomija, agenci czekają na zamknięcie"],
  ["flow:tdd","5319e7", "Workflow tdd-feature"],
  ["flow:foundation", "5319e7", "Workflow foundation (bez TDD)"],
  ["flow:spike", "5319e7", "Workflow spike (research → docs)"],
  ["agent:claude", "d4c5f9", "Implementuje Claude, reviewuje Codex"],
  ["agent:codex", "d4c5f9", "Implementuje Codex, reviewuje Claude"],
  ["area:codec", "fbca04", "dotnet/Terraria.WorldCodec, packages/world-codec"],
  ["area:model", "fbca04", "packages/world-model"],
  ["area:fixtures", "fbca04", "packages/test-fixtures"],
  ["area:web", "fbca04", "apps/web, renderer"],
  ["area:mods", "fbca04", "mod-registry, Mod Export Pack"],
  ["area:infra", "fbca04", "CI, scripts, tooling"],
  ["area:docs", "fbca04", "docs/"],
];

for (const [name, color, description] of labels) {
  gh(["label", "create", name, "--color", color, "--description", description, "--force"]);
  console.log(`label: ${name}`);
}
