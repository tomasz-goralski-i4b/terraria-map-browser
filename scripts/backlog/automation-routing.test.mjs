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

const startedBy = (labels) => definitions.filter((definition) =>
  definition.filters.changedLabels.includes("agent:ready") &&
  definition.filters.allLabels.every((label) => labels.includes(label)));

for (const runner of ["claude", "codex"]) {
  test(`tests-only routes flow:tests with agent:${runner} to exactly one chain, Claude writing and Codex reviewing`, () => {
    const matches = startedBy(["agent:ready", "flow:tests", `agent:${runner}`, "area:codec"]);
    assert.equal(matches.length, 1, "An eligible issue must start exactly one chain");
    assert.equal(matches[0].task.workflow, "tests-only");
    const yaml = readFileSync(".ai/cezar/workflows/tests-only.yaml", "utf8");
    assert.match(yaml.split("  - id: tests\n")[1]?.split("  - id:")[0] ?? "", /runner: claude\b/);
    assert.match(yaml.split("  - id: review\n")[1]?.split("  - id:")[0] ?? "", /runner: codex\b/);
  });
}

for (const workflow of ["tdd-feature", "tdd-feature-codex"]) {
  test(`${workflow}: style-only review findings go back to green before check-review can send them to red`, () => {
    const yaml = readFileSync(`.ai/cezar/workflows/${workflow}.yaml`, "utf8");
    const ids = [...yaml.matchAll(/^ {2}- id: (\S+)$/gm)].map((m) => m[1]);
    assert.ok(ids.indexOf("check-review-style") === ids.indexOf("check-review") - 1);
    assert.match(yaml.split("  - id: check-review-style\n")[1]?.split("  - id:")[0] ?? "", /retry: green\b/);
    assert.ok(!ids.includes("refactor"), "the refactor step is folded into green");
  });
}
