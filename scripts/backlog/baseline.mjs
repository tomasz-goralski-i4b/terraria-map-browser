// Cezar re-baselines its automations whenever the cockpit starts (or an automation is re-enabled): events from
// before the baseline are never launched. An issue that got agent:ready while the cockpit was down (the CI promoter
// or a human labelled it overnight) therefore never starts a chain. These helpers detect that case.
import { readFileSync } from "node:fs";

/**
 * The baseline that made Cezar skip a label added at `readyAt`, or null when it may have been seen.
 * Uses the earliest baseline over all automations, so it only reports a miss that every automation skipped.
 * @param {Date | null} readyAt when agent:ready was last added
 * @param {{ states?: Record<string, { baselineAt?: string }> } | null} state `.ai/cezar/automation-state.json`
 */
export function missedByBaseline(readyAt, state) {
  if (!readyAt || !state?.states) return null;
  const baselines = Object.values(state.states)
    .map((s) => (s?.baselineAt ? new Date(s.baselineAt) : null))
    .filter((d) => d && !Number.isNaN(d.getTime()));
  if (!baselines.length) return null;
  const earliest = new Date(Math.min(...baselines.map((d) => d.getTime())));
  return readyAt < earliest ? earliest : null;
}

/** Cezar's automation state from the repo root (cwd), or null when it cannot be read. */
export function readAutomationState(path = ".ai/cezar/automation-state.json") {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
