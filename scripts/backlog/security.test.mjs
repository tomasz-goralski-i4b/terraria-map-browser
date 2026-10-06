// Public repo: anyone can open an issue. These tests keep every entry point into the agent pipeline
// restricted to the trusted authors in .ai/cezar/trusted-authors.json.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { isTrusted, PIPELINE_LABEL, TRUSTED_AUTHORS } from "./gh.mjs";

const automationDir = ".ai/cezar/automation-defs";
const automations = readdirSync(automationDir)
  .filter((n) => n.endsWith(".json"))
  .map((n) => ({ name: n, def: JSON.parse(readFileSync(`${automationDir}/${n}`, "utf8")) }));

test("trusted author list is not empty", () => {
  assert.ok(TRUSTED_AUTHORS.length > 0);
});

for (const { name, def } of automations) {
  test(`automation ${name} only starts tasks for trusted authors`, () => {
    const authors = def.filters?.authors ?? [];
    assert.ok(authors.length > 0, "an automation without an authors filter would run any stranger's issue");
    assert.deepEqual([...authors].sort(), [...TRUSTED_AUTHORS].sort());
  });
}

test("issue templates never attach pipeline labels (templates apply labels even for outsiders)", () => {
  const dir = ".github/ISSUE_TEMPLATE";
  for (const n of readdirSync(dir).filter((f) => /\.(md|ya?ml)$/.test(f))) {
    const text = readFileSync(`${dir}/${n}`, "utf8");
    const labelsLine = text.match(/^labels:\s*(.*)$/m)?.[1] ?? "";
    const listed = [...labelsLine.matchAll(/["']?([\w:.-]+)["']?/g)].map((m) => m[1]).filter((l) => l !== "[]");
    const listItems = [...text.matchAll(/^\s*-\s*["']?([\w:.-]+)["']?\s*$/gm)].map((m) => m[1]);
    for (const label of [...listed, ...listItems]) {
      assert.ok(!PIPELINE_LABEL.test(label), `${n} attaches pipeline label ${label}`);
    }
  }
});

test("pipeline label pattern covers every label that queues or advances work", () => {
  for (const l of ["backlog", "agent:ready", "agent:claude", "agent:codex", "flow:tdd", "flow:foundation", "status:pr-ready", "status:ready-to-merge"]) {
    assert.ok(PIPELINE_LABEL.test(l), l);
  }
  for (const l of ["bug", "area:codec", "follow-up", "human", "question"]) assert.ok(!PIPELINE_LABEL.test(l), l);
});

test("isTrusted checks the issue author", () => {
  assert.equal(isTrusted({ author: { login: TRUSTED_AUTHORS[0] } }), true);
  assert.equal(isTrusted({ author: { login: "someone-else" } }), false);
  assert.equal(isTrusted({}), false);
});
