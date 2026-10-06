import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const definitions = readdirSync(".ai/cezar/automation-defs")
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(`.ai/cezar/automation-defs/${name}`, "utf8")));

for (const [runner, reviewer, workflow] of [
  ["codex", "claude", "foundation-codex"],
  ["claude", "codex", "foundation"],
]) {
  test(`foundation routes agent:${runner} to ${runner}, with ${reviewer} reviewing`, () => {
    const labels = ["agent:ready", "flow:foundation", `agent:${runner}`, "area:fixtures"];
    const matches = definitions.filter((definition) =>
      definition.filters.changedLabels.includes("agent:ready") &&
      definition.filters.allLabels.every((label) => labels.includes(label)));
    assert.equal(matches.length, 1, "An eligible issue must start exactly one chain");
    assert.equal(matches[0].task.workflow, workflow);
    assert.equal(matches[0].task.runner, runner);
    const yaml = readFileSync(`.ai/cezar/workflows/${workflow}.yaml`, "utf8");
    const implementStep = yaml.split("  - id: implement\n")[1]?.split("  - id:")[0];
    const reviewStep = yaml.split("  - id: review\n")[1]?.split("  - id:")[0];
    assert.match(implementStep ?? "", new RegExp(`runner: ${runner}\\b`));
    assert.match(reviewStep ?? "", new RegExp(`runner: ${reviewer}\\b`));
  });
}
