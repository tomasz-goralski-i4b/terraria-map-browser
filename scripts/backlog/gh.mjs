// Shared helpers for the backlog scripts: a thin wrapper over `gh` (keyring locally, GITHUB_TOKEN in CI).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function gh(args, { input, quiet = false } = {}) {
  return execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", quiet ? "ignore" : "inherit"] }).trim();
}

export function ghJson(args) {
  const out = gh(args);
  return out ? JSON.parse(out) : null;
}

export const LABELS = {
  backlog: "backlog",
  ready: "agent:ready",
  prReady: "status:pr-ready",
  mergeReady: "status:ready-to-merge",
  stalled: "status:stalled",
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

/** Logins whose issues may enter the agent pipeline (.ai/cezar/trusted-authors.json). */
export const TRUSTED_AUTHORS = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../.ai/cezar/trusted-authors.json"), "utf8"),
).authors;

/** Labels that put an issue into the pipeline; an untrusted issue must never carry them. */
export const PIPELINE_LABEL = /^(backlog|agent:ready|agent:claude|agent:codex|flow:.+|status:(pr-ready|ready-to-merge|stalled))$/;

export function isTrusted(issue) {
  return TRUSTED_AUTHORS.includes(issue.author?.login);
}
