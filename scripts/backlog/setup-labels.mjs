// Idempotently creates the labels used by the backlog, the promoter and the Cezar automations.
import { gh } from "./gh.mjs";

const labels = [
  ["backlog", "c5def5", "Planned, waiting to be unblocked by the promoter"],
  ["agent:ready", "0e8a16", "Unblocked by the promoter — a Cezar automation starts the task"],
  ["status:pr-ready", "1d76db", "Chain finished, draft PR waiting for a human"],
  ["status:ready-to-merge", "0e8a16", "Reviewed by a second model, CI green — waiting for a human merge"],
  ["status:stalled", "b60205", "Chain stopped without a PR (usage limit, crash) — needs a human; area stays busy"],
  ["status:deferred", "c2e0c6", "Waiting for provider usage (out of credits / near a limit) — the local promoter resumes it"],
  ["follow-up", "fef2c0", "Non-blocking review notes from a merged chain — triage: plan, decide or close"],
  ["human", "e99695", "Needs a human (e.g. the game, a decision) — the promoter skips it, agents wait for it to close"],
  ["flow:tdd", "5319e7", "tdd-feature workflow"],
  ["flow:foundation", "5319e7", "foundation workflow (no TDD)"],
  ["flow:spike", "5319e7", "spike workflow (research → docs)"],
  ["agent:claude", "d4c5f9", "Claude implements, Codex reviews"],
  ["agent:codex", "d4c5f9", "Codex implements, Claude reviews"],
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
