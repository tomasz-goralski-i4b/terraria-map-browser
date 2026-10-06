// Shared helpers for the backlog scripts: a thin wrapper over `gh` (keyring locally, GITHUB_TOKEN in CI).
import { execFileSync } from "node:child_process";

export function gh(args, { input } = {}) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "inherit"] }).trim();
}

export function ghJson(args) {
  const out = gh(args);
  return out ? JSON.parse(out) : null;
}

export const LABELS = {
  backlog: "backlog",
  ready: "agent:ready",
  prReady: "status:pr-ready",
};

/** "Blocked by: #12, #14" — a single line in the issue body, written by create-issues.mjs. */
export function blockedBy(body) {
  const line = (body ?? "").split(/\r?\n/).find((l) => /^\s*Blocked by:/i.test(l));
  if (!line) return [];
  return [...line.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
}

export function labelNames(issue) {
  return issue.labels.map((l) => l.name);
}

export function areaOf(issue) {
  return labelNames(issue).find((n) => n.startsWith("area:")) ?? "area:none";
}
