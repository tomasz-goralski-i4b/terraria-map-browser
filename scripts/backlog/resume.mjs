// Finishes a chain that Cezar ended early after a usage limit.
//
// Cezar bug this works around: when an agent step hits the provider's session/usage limit, Cezar's auto-resume
// finishes the *conversation* (steps `continue-1`, `continue-2`, …) and then marks the run `done` without running
// the rest of the workflow — gates, open-pr and merge-ready never execute, and the issue silently stalls.
//
// This script runs the remaining **command** steps of the run's own workflow definition, in order, in the run's
// worktree, exactly as Cezar would (`bash -lc <command>`). It is deliberately conservative:
//   - only for a run whose failed step is an agent step that failed on a usage/session limit and whose
//     continuation finished (a `continue-N` step is done) — the gates that follow verify that work;
//   - it never runs an agent; it stops at the first agent step (except `refactor`, which is optional by design —
//     an empty refactor is valid and `check-refactor` still runs) and at the first gate that does not pass
//     (no agent is available for the retry loop);
//   - it records what it did in `.tdd/resumed.md`, which open-pr puts into the PR description.
//
// Usage: node scripts/backlog/resume.mjs <run-id> [--dry-run]        (CEZ_API_URL / CEZ_PROJECT_ID as in promote.mjs)
// Exit: 0 reached the end of the workflow, 1 stopped (reason printed), 2 not resumable / infrastructure.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const LIMIT = /session limit|usage limit|rate limit|hit your .*limit|quota/i;
const SKIPPABLE_AGENT_STEPS = new Set(["refactor"]);
const STEP_TIMEOUT_MS = 30 * 60 * 1000;

/** Whether a finished run can be completed by running its remaining command steps. */
export function resumability(run) {
  if (!run || !["done", "failed"].includes(run.status)) return { ok: false, reason: `run status is ${run?.status}` };
  const defs = run.workflowDef?.steps ?? [];
  const byId = new Map((run.steps ?? []).map((s) => [s.id, s]));
  const failedIndex = defs.findIndex((d) => byId.get(d.id)?.status === "failed");
  if (failedIndex < 0) return { ok: false, reason: "no failed workflow step" };
  const failedDef = defs[failedIndex];
  const failed = byId.get(failedDef.id);
  if (failedDef.command) return { ok: false, reason: `gate ${failedDef.id} failed — needs the agent retry loop` };
  if (!LIMIT.test(failed.error ?? "")) return { ok: false, reason: `agent step ${failedDef.id} failed for another reason: ${failed.error}` };
  const continued = (run.steps ?? []).some((s) => /^continue-\d+$/.test(s.id) && s.status === "done");
  if (!continued) return { ok: false, reason: `agent step ${failedDef.id} hit a limit but its continuation did not finish` };
  if (!run.worktreePath) return { ok: false, reason: "run has no worktree" };
  return { ok: true, failedStep: failedDef.id, remaining: defs.slice(failedIndex + 1) };
}

export async function fetchRun(apiUrl, project, runId) {
  const res = await fetch(`${apiUrl}/api/v1/p/${project}/runs/${runId}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Cezar API ${res.status} for run ${runId}`);
  const body = await res.json();
  return body.run ?? body;
}

/** Runs the remaining command steps. Returns { ok, reached, stoppedAt, reason, log }. */
export function resumeRun(run, { dryRun = false, log = console.log } = {}) {
  const r = resumability(run);
  if (!r.ok) return { ok: false, resumable: false, reason: r.reason };
  const cwd = run.worktreePath;
  const note = (line) => {
    log(line);
    if (!dryRun) {
      mkdirSync(join(cwd, ".tdd"), { recursive: true });
      appendFileSync(join(cwd, ".tdd", "resumed.md"), `${line}\n`);
    }
  };
  note(`Resumed by \`scripts/backlog/resume.mjs\` on ${new Date().toISOString()}: Cezar ended run \`${run.id.slice(0, 8)}\` ` +
    `after step \`${r.failedStep}\` hit a usage limit and its continuation finished; the remaining gates were run unchanged.`);
  const reached = [];
  for (const step of r.remaining) {
    if (!step.command) {
      if (SKIPPABLE_AGENT_STEPS.has(step.id)) {
        note(`- \`${step.id}\`: skipped (optional agent step; no agent available)`);
        continue;
      }
      note(`- stopped before agent step \`${step.id}\` — it needs an agent`);
      return { ok: false, resumable: true, reached, stoppedAt: step.id, reason: `needs agent step ${step.id}` };
    }
    if (dryRun) {
      log(`- would run \`${step.id}\`: ${step.command}`);
      reached.push(step.id);
      continue;
    }
    const res = spawnSync("bash", ["-lc", step.command], { cwd, encoding: "utf8", timeout: STEP_TIMEOUT_MS });
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim().split(/\r?\n/).slice(-15).join("\n");
    if (res.status !== 0) {
      note(`- \`${step.id}\` exited ${res.status ?? "(timeout)"} — stopped (a failing gate needs the agent retry loop)`);
      return { ok: false, resumable: true, reached, stoppedAt: step.id, reason: `gate ${step.id} exited ${res.status}`, output: out };
    }
    note(`- \`${step.id}\`: OK`);
    reached.push(step.id);
  }
  return { ok: true, resumable: true, reached };
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const runId = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!runId) {
    console.log("usage: resume.mjs <run-id> [--dry-run]");
    process.exit(2);
  }
  const api = process.env.CEZ_API_URL ?? "http://localhost:4322";
  const project = process.env.CEZ_PROJECT_ID ?? "terraria-map-studio";
  try {
    const run = await fetchRun(api, project, runId);
    const result = resumeRun(run, { dryRun });
    if (!result.resumable) console.log(`RESUME: not resumable — ${result.reason}`);
    else if (result.ok) console.log(`RESUME: OK — reached ${result.reached.join(", ")}`);
    else console.log(`RESUME: stopped at ${result.stoppedAt} — ${result.reason}${result.output ? `\n${result.output}` : ""}`);
    process.exit(result.ok ? 0 : result.resumable ? 1 : 2);
  } catch (e) {
    console.log(`INFRA: ${e.message}`);
    process.exit(2);
  }
}
