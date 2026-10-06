// Usage preflight: do Claude Code and Codex both have room for a chain right now?
//
// Every workflow uses both providers (one implements, the other reviews), so a chain started while either is
// out of credits or near a limit burns the other provider's tokens and then dies mid-way.
//
//   - Codex: `codex app-server` JSON-RPC `account/rateLimits/read` — the official, zero-cost way (no model call):
//     used percent + reset time per window (5 h / weekly), credits, `ordinaryUsageAllowed`, `rateLimitReachedType`.
//   - Claude Code: there is no zero-cost programmatic API (anthropics/claude-code#32796); `/usage` is interactive
//     only. A minimal headless request (`claude -p … --model haiku --output-format stream-json`) emits a
//     `rate_limit_event` with the utilization of every window. Cached, so it runs at most every few minutes.
//
// A provider passes when nothing is rejected/depleted and every window has at least
// USAGE_MIN_REMAINING_PERCENT (default 10) left. OK results are cached USAGE_PROBE_CACHE_MINUTES (default 10),
// LOW results 3 minutes, so a refill or reset is noticed quickly.
//
// CLI: node scripts/backlog/usage-probe.mjs [--fresh]   → exit 0 both OK, 3 at least one provider LOW,
//                                                         2 the probe itself could not run
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MIN_REMAINING = Number(process.env.USAGE_MIN_REMAINING_PERCENT ?? 10);
const CACHE_MS = Number(process.env.USAGE_PROBE_CACHE_MINUTES ?? 10) * 60_000;
const LOW_CACHE_MS = Math.min(CACHE_MS, 3 * 60_000);
const CACHE_FILE = join(homedir(), ".cache", "terraria-map-studio", "usage-probe.json");
const WIN = process.platform === "win32"; // npm shims (claude.cmd / codex.cmd) need a shell on Windows

const fmtReset = (epochSec) => (epochSec ? new Date(epochSec * 1000).toISOString().replace(".000Z", "Z") : "unknown");
const lowWindow = (windows, minRemaining) => Object.entries(windows).find(([, w]) => 100 - w.usedPercent < minRemaining);
const windowName = (mins) => (mins === 300 ? "5h" : mins === 10080 ? "weekly" : mins ? `${mins}m` : "window");

// ---------------------------------------------------------------------------------------------------- Codex

/** `account/rateLimits/read` result → verdict. */
export function evaluateCodex(result, minRemaining = MIN_REMAINING) {
  const rl = result?.rateLimits ?? {};
  const windows = {};
  for (const w of [rl.primary, rl.secondary]) {
    if (w) windows[windowName(w.windowDurationMins)] = { usedPercent: Math.round(w.usedPercent ?? 0), resetsAt: fmtReset(w.resetsAt) };
  }
  if (rl.rateLimitReachedType) return { provider: "codex", ok: false, windows, reason: `limit reached: ${rl.rateLimitReachedType}` };
  if (result?.ordinaryUsageAllowed === false) return { provider: "codex", ok: false, windows, reason: "usage not allowed for this account right now" };
  if (rl.spendControlReached) return { provider: "codex", ok: false, windows, reason: "workspace spend control reached" };
  const low = lowWindow(windows, minRemaining);
  if (low) return { provider: "codex", ok: false, windows, reason: `${low[0]} window ${low[1].usedPercent}% used (< ${minRemaining}% left), resets ${low[1].resetsAt}` };
  return { provider: "codex", ok: true, windows };
}

/** Reads Codex rate limits over the app-server JSON-RPC protocol (stdio, one JSON object per line). */
export function readCodexRateLimits(timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const p = WIN ? spawn("codex app-server", { shell: true }) : spawn("codex", ["app-server"]);
    let buf = "";
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); p.kill(); fn(v); } };
    const send = (m) => p.stdin.write(`${JSON.stringify(m)}\n`);
    const timer = setTimeout(() => finish(reject, new Error("codex app-server did not answer in time")), timeoutMs);
    p.on("error", (e) => finish(reject, e));
    p.stdout.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) {
          if (m.error) return finish(reject, new Error(`initialize failed: ${m.error.message}`));
          send({ method: "initialized" });
          send({ id: 2, method: "account/rateLimits/read" });
        } else if (m.id === 2) {
          if (m.error) return finish(reject, new Error(`account/rateLimits/read failed: ${m.error.message}`));
          finish(resolve, m.result);
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "terraria-usage-probe", version: "1" } } });
  });
}

export async function probeCodex() {
  try {
    return evaluateCodex(await readCodexRateLimits());
  } catch (e) {
    return { provider: "codex", ok: false, reason: `cannot read Codex rate limits: ${e.message}` };
  }
}

// --------------------------------------------------------------------------------------------------- Claude

/** Claude Code `rate_limit_event.rate_limit_info` → verdict. */
export function evaluateClaude(rl, minRemaining = MIN_REMAINING) {
  const windows = Object.fromEntries(Object.entries(rl.unifiedWindows ?? {}).map(([k, w]) => [k, { usedPercent: Math.round((w.utilization ?? 0) * 100), resetsAt: fmtReset(w.resetsAt) }]));
  if (rl.status === "rejected") return { provider: "claude", ok: false, windows, reason: `limit reached (${rl.rateLimitType}), resets ${fmtReset(rl.resetsAt)}` };
  const low = lowWindow(windows, minRemaining);
  if (low) return { provider: "claude", ok: false, windows, reason: `${low[0]} window ${low[1].usedPercent}% used (< ${minRemaining}% left), resets ${low[1].resetsAt}` };
  return { provider: "claude", ok: true, windows };
}

export function probeClaude() {
  const cwd = mkdtempSync(join(tmpdir(), "usage-probe-")); // empty dir: no repo context
  try {
    const args = ["-p", '"Reply with OK."', "--model", "haiku", "--output-format", "stream-json", "--verbose", "--max-turns", "1"];
    const r = WIN
      ? spawnSync(`claude ${args.join(" ")}`, { cwd, encoding: "utf8", timeout: 120_000, shell: true })
      : spawnSync("claude", args.map((a) => a.replace(/^"|"$/g, "")), { cwd, encoding: "utf8", timeout: 120_000 });
    if (r.error) return { provider: "claude", ok: false, reason: `cannot run claude: ${r.error.message}` };
    const events = `${r.stdout ?? ""}`.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const rl = events.filter((e) => e.type === "rate_limit_event").pop()?.rate_limit_info;
    const result = events.find((e) => e.type === "result");
    if (rl) {
      const verdict = evaluateClaude(rl);
      if (!verdict.ok) return verdict;
    }
    if (result?.is_error || r.status !== 0) {
      return { provider: "claude", ok: false, reason: String(result?.result ?? r.stderr ?? `exit ${r.status}`).trim().slice(0, 300) };
    }
    return rl ? evaluateClaude(rl) : { provider: "claude", ok: true, windows: {}, note: "no rate_limit_event reported" };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------------------------------------- combined

/** Both providers, cached. */
export async function probeAll({ fresh = false } = {}) {
  if (!fresh) {
    try {
      const cached = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
      const maxAge = cached.ok ? CACHE_MS : LOW_CACHE_MS;
      if (Date.now() - cached.at < maxAge && cached.minRemaining === MIN_REMAINING) return { ...cached, cached: true };
    } catch { /* no cache */ }
  }
  // Codex first: it is free, and when it is LOW there is no reason to spend a Claude request.
  const codex = await probeCodex();
  const claude = codex.ok ? probeClaude() : { provider: "claude", ok: true, skipped: true, note: "not probed — Codex is LOW" };
  const results = [claude, codex];
  const report = { at: Date.now(), minRemaining: MIN_REMAINING, ok: results.every((r) => r.ok), results };
  try {
    mkdirSync(join(homedir(), ".cache", "terraria-map-studio"), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(report, null, 2));
  } catch { /* cache is best effort */ }
  return report;
}

export function describe(report) {
  return report.results.map((r) => {
    const w = Object.entries(r.windows ?? {}).map(([k, v]) => `${k} ${v.usedPercent}%`).join(", ");
    return `${r.skipped ? "SKIP" : r.ok ? "OK  " : "LOW "} ${r.provider}${w ? ` (${w} used)` : ""}${r.ok ? "" : ` — ${r.reason}`}${r.note ? ` [${r.note}]` : ""}`;
  }).join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const report = await probeAll({ fresh: process.argv.includes("--fresh") });
    console.log(`USAGE${report.cached ? " (cached)" : ""}: need ≥ ${MIN_REMAINING}% left in every window`);
    console.log(describe(report));
    process.exit(report.ok ? 0 : 3);
  } catch (e) {
    console.log(`INFRA: usage probe failed: ${e.message}`);
    process.exit(2);
  }
}
