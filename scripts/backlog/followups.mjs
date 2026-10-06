// Turns the reviewer's non-blocking notes into one tracked GitHub issue per PR, so they are not lost
// in a merged PR description. Called by scripts/tdd/merge-ready.sh; can be run by hand for older PRs.
//
// Usage: node scripts/backlog/followups.mjs <pr-number> [--review <file>] [--dry-run]
//   --review  review file to read (default: the "Cross-review" section of the PR description)
//
// Reads two sections of the review (see .ai/skills/reviewer.md):
//   "Needs a human decision:"  → listed first, the issue is titled as needing a decision
//   "Nice to have:"            → suggestions
// The issue is labelled `follow-up` (+ the area of the closed issue). It is NOT `backlog`, so nothing runs
// automatically: a human triages it (turn items into backlog issues, or close). The planner reads open
// follow-ups when planning the next milestone. One issue per PR (dedupe marker in the body).
import { readFileSync } from "node:fs";
import { gh, ghJson } from "./gh.mjs";

const args = process.argv.slice(2);
const pr = Number(args.find((a) => /^\d+$/.test(a)));
const reviewFile = args.includes("--review") ? args[args.indexOf("--review") + 1] : null;
const DRY = args.includes("--dry-run");
if (!pr) {
  console.log("usage: followups.mjs <pr-number> [--review <file>] [--dry-run]");
  process.exit(2);
}

const info = ghJson(["pr", "view", String(pr), "--json", "title,url,body,closingIssuesReferences"]);
const review = reviewFile ? readFileSync(reviewFile, "utf8") : section(info.body ?? "", "## Cross-review");
const decisions = bullets(review, /^needs a human decision:?\s*$/i);
const suggestions = bullets(review, /^nice to have:?\s*$/i);
if (!decisions.length && !suggestions.length) {
  console.log(`FOLLOW-UPS: none in PR #${pr}`);
  process.exit(0);
}

const marker = `<!-- follow-up-of: #${pr} -->`;
const existing = ghJson(["issue", "list", "--state", "all", "--label", "follow-up", "--limit", "200", "--json", "number,body"]);
const dup = existing.find((i) => (i.body ?? "").includes(marker));
if (dup) {
  console.log(`FOLLOW-UPS: already tracked in #${dup.number}`);
  process.exit(0);
}

const closes = info.closingIssuesReferences.map((i) => i.number);
let area = null;
for (const n of closes) {
  const labels = ghJson(["issue", "view", String(n), "--json", "labels"]).labels.map((l) => l.name);
  area = labels.find((l) => l.startsWith("area:")) ?? area;
}
const prTitle = info.title.replace(/^\[[^\]]*\]\s*/, "");
const title = `[follow-up] ${decisions.length ? "Decision needed + review notes" : "Review notes"} from #${pr}: ${prTitle}`.slice(0, 120);
const body = [
  `Non-blocking notes from the independent review of ${info.url}${closes.length ? ` (closes ${closes.map((n) => `#${n}`).join(", ")})` : ""}.`,
  "The PR was approved; these were not required for the merge.",
  "",
  ...(decisions.length ? ["## Needs a human decision", ...decisions.map((d) => `- [ ] ${d}`), ""] : []),
  ...(suggestions.length ? ["## Suggestions", ...suggestions.map((s) => `- [ ] ${s}`), ""] : []),
  "## Triage",
  "- Decide each item: confirm, drop, or turn it into a planned issue (`backlog` + `flow:*` + `agent:*` + `area:*`,",
  "  with acceptance criteria) — e.g. by asking the planner to include open follow-ups in the next milestone.",
  "- Close this issue when every item is decided.",
  "",
  marker,
  "",
].join("\n");

const labels = ["follow-up", ...(area ? [area] : [])];
if (DRY) {
  console.log(`FOLLOW-UPS (dry-run): would create "${title}" [${labels.join(", ")}]\n${body}`);
  process.exit(0);
}
const url = gh(["issue", "create", "--title", title, "--body-file", "-", ...labels.flatMap((l) => ["--label", l])], { input: body });
console.log(`FOLLOW-UPS: ${decisions.length} decision(s), ${suggestions.length} suggestion(s) → ${url}`);

/** Text of a markdown "## heading" section, up to the next "## " or <details>. */
function section(md, heading) {
  const start = md.indexOf(heading);
  if (start < 0) return "";
  const rest = md.slice(start + heading.length);
  const end = rest.search(/\n## |\n<details>/);
  return end < 0 ? rest : rest.slice(0, end);
}

/** "- item" bullets (with indented continuation lines) under a line matching `header`. */
function bullets(text, header) {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => header.test(l.trim()));
  if (i < 0) return [];
  const items = [];
  for (const line of lines.slice(i + 1)) {
    if (/^\s*[-*] /.test(line) && !/^\s{2,}[-*] /.test(line)) items.push(line.replace(/^\s*[-*] /, "").trim());
    else if (/^\s+\S/.test(line) && items.length) items[items.length - 1] += " " + line.trim();
    else if (line.trim() === "" && items.length) continue;
    else if (line.trim() === "") continue;
    else break;
  }
  return items;
}
