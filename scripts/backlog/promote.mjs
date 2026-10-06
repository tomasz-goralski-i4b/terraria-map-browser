// Promoter: the deterministic backlog "manager". No LLM. Two jobs:
//
// 1. Stall watchdog — an issue on agent:ready whose chain will never open a PR (e.g. the agent hit a
//    usage limit and Cezar ended the run early) gets `status:stalled` and one comment. Precise when the
//    local Cezar cockpit is reachable (its run for the issue finished, yet the issue never reached
//    status:pr-ready); otherwise time-based (agent:ready for longer than STALL_MINUTES, e.g. in CI).
//    A stalled issue keeps its area busy until a human resolves it.
//
// 2. Promotion — adds agent:ready to issues labelled `backlog` when:
//    - every "Blocked by: #N" is closed,
//    - nothing else is in flight in the same area (agent:ready / status:pr-ready / status:ready-to-merge),
//    - globally fewer than MAX_ACTIVE are in flight (default 2 = Cezar's maxParallel).
//    Order: ascending issue number (the planner creates issues in execution order).
import { execFileSync } from "node:child_process";
import { gh, ghJson, LABELS, blockedBy, labelNames, areaOf } from "./gh.mjs";

const MAX_ACTIVE = Number(process.env.MAX_ACTIVE ?? 2);
const STALL_MINUTES = Number(process.env.STALL_MINUTES ?? 120);
const DRY = process.argv.includes("--dry-run");
const LIVE_RUN = new Set(["running", "queued", "waiting", "monitoring", "review"]);

const open = ghJson(["issue", "list", "--state", "open", "--limit", "500", "--json", "number,title,body,labels"]);

await watchStalls(open.filter((i) => labelNames(i).includes(LABELS.ready)));
promote(open);

// ---------------------------------------------------------------------------------------------

async function watchStalls(ready) {
  if (!ready.length) return;
  const cezar = await cezarRuns();
  console.log(`stall watchdog: ${cezar ? `Cezar at ${cezar.url}` : `no Cezar cockpit — time-based (${STALL_MINUTES} min)`}`);

  for (const issue of ready) {
    const readyAt = lastLabeledAt(issue.number, LABELS.ready);
    const minutes = readyAt ? (Date.now() - readyAt.getTime()) / 60000 : 0;
    const stalled = labelNames(issue).includes(LABELS.stalled);
    let verdict = null; // null = fine, otherwise why it is stalled

    if (cezar) {
      const run = cezar.runs
        .filter((r) => Number(r.issueNumber) === issue.number && (!readyAt || new Date(r.createdAt) >= readyAt))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      if (run && LIVE_RUN.has(run.status)) {
        if (stalled) {
          console.log(`  #${issue.number} has a live Cezar run again (${run.id.slice(0, 8)} ${run.status}) — clearing ${LABELS.stalled}`);
          if (!DRY) gh(["issue", "edit", String(issue.number), "--remove-label", LABELS.stalled]);
        }
        continue;
      }
      if (run) {
        const failedStep = (run.steps ?? []).find((s) => s.status === "failed");
        verdict = `Cezar run \`${run.id.slice(0, 8)}\` ended as **${run.status}** but the chain never reached \`open-pr\`` +
          (failedStep ? ` (step \`${failedStep.id}\` failed: ${String(failedStep.error ?? "").slice(0, 200)})` : "") + ".";
      } else if (minutes > 15) {
        verdict = `no Cezar run picked this issue up in ${Math.round(minutes)} min (automation paused, filter mismatch, or the cockpit is down).`;
      }
    } else if (minutes > STALL_MINUTES) {
      verdict = `on \`${LABELS.ready}\` for ${Math.round(minutes)} min without a PR (threshold ${STALL_MINUTES} min).`;
    }

    if (!verdict) continue;
    if (stalled) {
      console.log(`  #${issue.number} still stalled`);
      continue;
    }
    console.log(`⚠ stalled #${issue.number}: ${verdict.replace(/\*\*|`/g, "")}${DRY ? " (dry-run)" : ""}`);
    if (DRY) continue;
    gh(["issue", "edit", String(issue.number), "--add-label", LABELS.stalled]);
    gh(["issue", "comment", String(issue.number), "--body-file", "-"], {
      input: `⚠️ **Stalled** — ${verdict}\n\nThe area stays busy until this is resolved. Options:\n` +
        "- inspect the task in Cezar (its worktree under `.ai/cezar/worktrees/` keeps the work so far);\n" +
        `- restart from scratch: remove and re-add \`${LABELS.ready}\` (the watchdog clears \`${LABELS.stalled}\` when a new run starts);\n` +
        "- finish by hand on the task branch, then run the remaining gates and `bash scripts/tdd/open-pr.sh` in its worktree.\n",
    });
  }
}

function promote(issues) {
  const openNumbers = new Set(issues.map((i) => i.number));
  const inFlightLabels = [LABELS.ready, LABELS.prReady, LABELS.mergeReady];
  const inFlight = issues.filter((i) => labelNames(i).some((n) => inFlightLabels.includes(n)));
  const busyAreas = new Set(inFlight.map(areaOf));
  let active = inFlight.length;

  console.log(`in flight: ${active}/${MAX_ACTIVE}${inFlight.length ? " — " + inFlight.map((i) => `#${i.number} ${areaOf(i)}`).join(", ") : ""}`);

  const candidates = issues
    .filter((i) => labelNames(i).includes(LABELS.backlog))
    .sort((a, b) => a.number - b.number);

  for (const issue of candidates) {
    if (active >= MAX_ACTIVE) break;
    const area = areaOf(issue);
    const blockers = blockedBy(issue.body).filter((n) => openNumbers.has(n));
    if (blockers.length) {
      console.log(`  #${issue.number} waiting for ${blockers.map((n) => "#" + n).join(", ")}`);
      continue;
    }
    if (busyAreas.has(area)) {
      console.log(`  #${issue.number} waiting — ${area} is busy`);
      continue;
    }
    console.log(`→ promoting #${issue.number} ${issue.title}${DRY ? " (dry-run)" : ""}`);
    if (!DRY) gh(["issue", "edit", String(issue.number), "--remove-label", LABELS.backlog, "--add-label", LABELS.ready]);
    busyAreas.add(area);
    active++;
  }
}

/** When the label was last added (issue events API), or null. */
function lastLabeledAt(number, label) {
  try {
    const events = ghJson(["api", "--paginate", "--slurp", `repos/{owner}/{repo}/issues/${number}/events`]).flat();
    const hits = events.filter((e) => e.event === "labeled" && e.label?.name === label);
    return hits.length ? new Date(hits[hits.length - 1].created_at) : null;
  } catch {
    return null;
  }
}

/** Runs from the local Cezar cockpit serving this repo (CEZ_API_URL, else ports 4321-4330), or null. */
async function cezarRuns() {
  const project = process.env.CEZ_PROJECT_ID ?? "terraria-map-studio";
  if (process.env.GITHUB_ACTIONS) return null; // CI cannot see the local cockpit
  let repoRoot = "";
  try {
    repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim().replace(/\\/g, "/").toLowerCase();
  } catch {
    return null;
  }
  const urls = process.env.CEZ_API_URL
    ? [process.env.CEZ_API_URL]
    : Array.from({ length: 10 }, (_, i) => `http://localhost:${4321 + i}`);
  for (const url of urls) {
    try {
      const health = await (await fetch(`${url}/api/v1/health`, { signal: AbortSignal.timeout(1500) })).json();
      const served = String(health.repoRoot ?? "").replace(/\\/g, "/").toLowerCase();
      if (!process.env.CEZ_API_URL && served !== repoRoot) continue;
      const body = await (await fetch(`${url}/api/v1/p/${project}/runs`, { signal: AbortSignal.timeout(5000) })).json();
      return { url, runs: body.runs ?? body };
    } catch {
      // not this port / not reachable
    }
  }
  return null;
}
