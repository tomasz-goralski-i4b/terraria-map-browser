import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateClaude, evaluateCodex } from "./usage-probe.mjs";

// Shape of `account/rateLimits/read` from `codex app-server` (2026-10-06, team plan).
const codex = (primary, secondary, extra = {}) => ({
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: "codex",
    primary: { usedPercent: primary, windowDurationMins: 300, resetsAt: 1791310171 },
    secondary: { usedPercent: secondary, windowDurationMins: 10080, resetsAt: 1791878939 },
    credits: { hasCredits: true, unlimited: false, balance: null },
    spendControlReached: false,
    rateLimitReachedType: null,
    ...extra,
  },
});

// Shape of Claude Code's stream-json `rate_limit_event.rate_limit_info`.
const claude = (fiveHour, sevenDay, status = "allowed") => ({
  status,
  resetsAt: 1791322800,
  rateLimitType: "five_hour",
  unifiedWindows: {
    five_hour: { utilization: fiveHour, resetsAt: 1791322800 },
    seven_day: { utilization: sevenDay, resetsAt: 1791349200 },
  },
});

test("codex: windows with room → OK, named 5h / weekly by duration", () => {
  const v = evaluateCodex(codex(48, 26));
  assert.equal(v.ok, true);
  assert.deepEqual(Object.keys(v.windows), ["5h", "weekly"]);
});

test("codex: credits depleted (real response) → LOW with the reason", () => {
  const v = evaluateCodex({ ...codex(100, 26, { rateLimitReachedType: "workspace_member_credits_depleted" }), ordinaryUsageAllowed: false });
  assert.equal(v.ok, false);
  assert.match(v.reason, /workspace_member_credits_depleted/);
});

test("codex: 90% used leaves exactly 10% → OK; 91% → LOW", () => {
  assert.equal(evaluateCodex(codex(90, 10)).ok, true);
  const v = evaluateCodex(codex(10, 91));
  assert.equal(v.ok, false);
  assert.match(v.reason, /weekly window 91% used/);
});

test("codex: ordinary usage not allowed → LOW even with free windows", () => {
  assert.equal(evaluateCodex({ ...codex(5, 5), ordinaryUsageAllowed: false }).ok, false);
});

test("claude: real utilization 48% / 32% → OK", () => {
  assert.equal(evaluateClaude(claude(0.48, 0.32)).ok, true);
});

test("claude: rejected status → LOW", () => {
  assert.equal(evaluateClaude(claude(1, 0.4, "rejected")).ok, false);
});

test("claude: seven_day at 95% → LOW naming the window", () => {
  const v = evaluateClaude(claude(0.2, 0.95));
  assert.equal(v.ok, false);
  assert.match(v.reason, /seven_day window 95% used/);
});
