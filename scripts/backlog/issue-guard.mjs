// Issue guard (GitHub Action on issues opened/reopened/labeled/edited): the repo is public, so anyone can open
// an issue — and an issue template may attach labels even for outsiders. An issue whose author is not in
// .ai/cezar/trusted-authors.json must never carry a pipeline label (backlog, agent:*, flow:*, status:*):
// the guard removes such labels and explains once. Defense in depth next to the Cezar automation `authors`
// filter and the promoter's own author check.
//
// Usage: node scripts/backlog/issue-guard.mjs [issue-number]   (in Actions the number comes from the event)
import { readFileSync } from "node:fs";
import { gh, ghJson, isTrusted, PIPELINE_LABEL } from "./gh.mjs";

let number = Number(process.argv[2]);
if (!number && process.env.GITHUB_EVENT_PATH) {
  number = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).issue?.number;
}
if (!number) {
  console.log("usage: issue-guard.mjs <issue-number>");
  process.exit(2);
}

const issue = ghJson(["issue", "view", String(number), "--json", "number,author,labels,comments"]);
if (isTrusted(issue)) {
  console.log(`#${number}: author ${issue.author.login} is trusted — nothing to do`);
  process.exit(0);
}
const blocked = issue.labels.map((l) => l.name).filter((n) => PIPELINE_LABEL.test(n));
if (!blocked.length) {
  console.log(`#${number}: untrusted author ${issue.author?.login}, no pipeline labels — fine`);
  process.exit(0);
}
gh(["issue", "edit", String(number), ...blocked.flatMap((l) => ["--remove-label", l])]);
console.log(`#${number}: removed ${blocked.join(", ")} (untrusted author ${issue.author?.login})`);
const marker = "<!-- issue-guard -->";
if (!issue.comments.some((c) => (c.body ?? "").includes(marker))) {
  gh(["issue", "comment", String(number), "--body-file", "-"], {
    input: `Thanks for the issue! Only maintainers can queue work for the automated agents, so the pipeline labels (${blocked.map((l) => `\`${l}\``).join(", ")}) were removed. A maintainer will triage it.\n\n${marker}\n`,
  });
}
