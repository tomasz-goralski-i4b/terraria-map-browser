// Creates issues from the backlog file written by the planner (default .tdd/backlog.json).
// The LLM proposes, the script creates — validates shape, dependency order and duplicates.
// Exit: 0 OK, 1 bad file (the planner can fix it), 2 GitHub error.
import { readFileSync } from "node:fs";
import { gh, ghJson } from "./gh.mjs";

const file = process.argv[2] ?? ".tdd/backlog.json";
// "human" = work an agent cannot do (e.g. generating a world in the game); the promoter skips it.
const FLOWS = ["tdd", "foundation", "spike", "tests", "human"];
const RUNNERS = ["claude", "codex"];

function fail(msg) {
  console.log(`BACKLOG: ${msg}`);
  process.exit(1);
}

let raw;
let backlog;
try {
  raw = readFileSync(file, "utf8").replace(/^﻿/, "");
  backlog = JSON.parse(raw);
} catch (e) {
  fail(`cannot read ${file}: ${e.message}`);
}
// UTF-8 decoded as Windows-1252 (PowerShell 5.1 Get-Content/Set-Content without -Encoding) yields "â€”", "Ã©", "Ä…".
const mojibake = raw.match(/Ã.|Ä.|Å.|Ĺ.|â€./u);
if (mojibake) {
  fail(`the file has broken encoding (e.g. "${mojibake[0]}"). Write .tdd/backlog.json as UTF-8 with the file-editing tool ` +
    "(apply_patch/Write), not PowerShell Set-Content/Out-File; read files with Get-Content -Encoding UTF8.");
}
if (!backlog || typeof backlog.milestone !== "string" || !Array.isArray(backlog.issues) || backlog.issues.length === 0) {
  fail('expected shape: {"milestone": "M1", "issues": [...]}');
}

const seen = new Set();
for (const [i, it] of backlog.issues.entries()) {
  const where = `issues[${i}] (${it?.key ?? "?"})`;
  if (!it.key || !/^[a-z0-9-]+$/.test(it.key)) fail(`${where}: key must be kebab-case`);
  if (seen.has(it.key)) fail(`${where}: duplicate key`);
  if (!it.title || it.title.length > 120) fail(`${where}: title is required, max 120 chars`);
  if (!FLOWS.includes(it.flow)) fail(`${where}: flow ∈ ${FLOWS.join("|")}`);
  if (it.flow !== "human" && !RUNNERS.includes(it.runner)) fail(`${where}: runner ∈ ${RUNNERS.join("|")}`);
  if (!it.area || !/^[a-z]+$/.test(it.area)) fail(`${where}: area is required (e.g. codec, model, fixtures, docs, infra)`);
  if (!it.body || !it.body.includes("## Acceptance criteria")) fail(`${where}: body must contain a "## Acceptance criteria" section`);
  if (it.flow !== "human" && !/^## Spec$/m.test(it.body ?? "")) fail(`${where}: body must contain a "## Spec" section (doc parts to read, or "none")`);
  for (const dep of it.blockedBy ?? []) {
    // "#123" = an existing GitHub issue (e.g. an unfinished issue of the previous milestone).
    if (/^#\d+$/.test(dep)) continue;
    if (!seen.has(dep)) fail(`${where}: blockedBy "${dep}" must point to an issue EARLIER in the list, or be an existing issue as "#123"`);
  }
  seen.add(it.key);
}

let existing;
try {
  existing = ghJson(["issue", "list", "--state", "all", "--limit", "500", "--json", "number,title,body"]);
} catch {
  console.log("INFRA: gh issue list failed");
  process.exit(2);
}
// Dedupe by backlog key (survives title edits) and by exact title.
const byKey = new Map();
const byTitle = new Map();
for (const x of existing) {
  const key = /<!-- backlog-key: ([a-z0-9-]+) -->/.exec(x.body ?? "")?.[1];
  if (key) byKey.set(key, x.number);
  byTitle.set(x.title, x.number);
}
const numbers = new Map();

for (const it of backlog.issues) {
  const title = `[${backlog.milestone}] ${it.title}`;
  const dup = byKey.get(it.key) ?? byTitle.get(title);
  if (dup) {
    numbers.set(it.key, dup);
    console.log(`skip (exists): #${dup} ${title}`);
    continue;
  }
  const deps = (it.blockedBy ?? []).map((k) => (/^#\d+$/.test(k) ? k : `#${numbers.get(k)}`));
  const body = `${deps.length ? `Blocked by: ${deps.join(", ")}\n\n` : ""}${it.body.trim()}\n\n<!-- backlog-key: ${it.key} -->\n`;
  const labels = it.flow === "human"
    ? ["human", `area:${it.area}`]
    : ["backlog", `flow:${it.flow}`, `agent:${it.runner}`, `area:${it.area}`];
  try {
    gh(["label", "create", `area:${it.area}`, "--color", "fbca04"], { quiet: true });
  } catch {
    // label already exists
  }
  let url;
  try {
    url = gh(["issue", "create", "--title", title, "--body-file", "-", ...labels.flatMap((l) => ["--label", l])], { input: body });
  } catch {
    console.log(`INFRA: failed to create "${title}"`);
    process.exit(2);
  }
  const n = Number(url.split("/").pop());
  numbers.set(it.key, n);
  console.log(`created: #${n} ${title}  [${labels.join(", ")}]${deps.length ? `  blocked by ${deps.join(", ")}` : ""}`);
}
console.log(`BACKLOG: OK — ${backlog.issues.length} items. Unblock with: bash scripts/backlog/promote.sh (or Actions → promote).`);
