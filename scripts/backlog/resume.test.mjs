import assert from "node:assert/strict";
import { test } from "node:test";
import { resumability, resumeRun } from "./resume.mjs";

const workflowDef = {
  steps: [
    { id: "red", skill: "tdd-red" },
    { id: "check-red", command: "bash scripts/tdd/check-red.sh" },
    { id: "green", skill: "tdd-green" },
    { id: "check-green", command: "bash scripts/tdd/check-green.sh" },
    { id: "refactor", skill: "tdd-refactor" },
    { id: "check-refactor", command: "bash scripts/tdd/check-green.sh refactor" },
    { id: "review", skill: "reviewer" },
    { id: "check-review", command: "bash scripts/tdd/check-review.sh" },
    { id: "open-pr", command: "bash scripts/tdd/open-pr.sh" },
    { id: "merge-ready", command: "bash scripts/tdd/merge-ready.sh" },
  ],
};
const LIMIT = "You've hit your session limit · resets 6:40pm (Europe/Warsaw)";

function run(statuses, { status = "done", continued = true, error = LIMIT } = {}) {
  const steps = workflowDef.steps.map((d) => ({ id: d.id, status: statuses[d.id] ?? "pending", ...(statuses[d.id] === "failed" ? { error } : {}) }));
  if (continued) steps.push({ id: "continue-1", status: "done" });
  return { id: "f0a8ed3e-0000", status, worktreePath: "/tmp/wt", workflowDef, steps };
}
const doneUntil = (last) => Object.fromEntries(workflowDef.steps.slice(0, workflowDef.steps.findIndex((s) => s.id === last)).map((s) => [s.id, "done"]));

test("review hit a usage limit and the continuation finished → remaining gates are resumable", () => {
  const r = resumability(run({ ...doneUntil("review"), review: "failed" }));
  assert.equal(r.ok, true);
  assert.equal(r.failedStep, "review");
  assert.deepEqual(r.remaining.map((s) => s.id), ["check-review", "open-pr", "merge-ready"]);
});

test("dry run walks the remaining command steps without executing them", () => {
  const lines = [];
  const result = resumeRun(run({ ...doneUntil("review"), review: "failed" }), { dryRun: true, log: (l) => lines.push(l) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reached, ["check-review", "open-pr", "merge-ready"]);
});

test("green hit a limit → gates run, optional refactor is skipped, stops before review (needs an agent)", () => {
  const result = resumeRun(run({ ...doneUntil("green"), green: "failed" }), { dryRun: true, log: () => {} });
  assert.equal(result.ok, false);
  assert.equal(result.stoppedAt, "review");
  assert.deepEqual(result.reached, ["check-green", "check-refactor"]);
});

test("a failed gate is not resumable — it needs the agent retry loop", () => {
  assert.equal(resumability(run({ ...doneUntil("check-review"), "check-review": "failed" })).ok, false);
});

test("an agent step that failed for another reason is not resumable", () => {
  assert.equal(resumability(run({ ...doneUntil("review"), review: "failed" }, { error: "process crashed" })).ok, false);
});

test("a limit without a finished continuation is not resumable", () => {
  assert.equal(resumability(run({ ...doneUntil("review"), review: "failed" }, { continued: false })).ok, false);
});

test("a live run is never resumed", () => {
  assert.equal(resumability(run({ ...doneUntil("review"), review: "failed" }, { status: "running" })).ok, false);
});
