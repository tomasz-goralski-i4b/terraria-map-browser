// Promoter: deterministyczny "manager" backlogu. Bez LLM.
// Nadaje agent:ready issue z labelem `backlog`, gdy:
//   - wszystkie "Blocked by: #N" są zamknięte,
//   - w tym samym area nie ma nic w locie (agent:ready / status:pr-ready) — jeden właściciel obszaru,
//   - globalnie w locie < MAX_ACTIVE (domyślnie 2 = maxParallel Cezara).
// Kolejność: rosnący numer issue (planner tworzy je w kolejności realizacji).
import { gh, ghJson, LABELS, blockedBy, labelNames, areaOf } from "./gh.mjs";

const MAX_ACTIVE = Number(process.env.MAX_ACTIVE ?? 2);
const DRY = process.argv.includes("--dry-run");

const open = ghJson(["issue", "list", "--state", "open", "--limit", "500", "--json", "number,title,body,labels"]);
const openNumbers = new Set(open.map((i) => i.number));
const inFlight = open.filter((i) => labelNames(i).some((n) => n === LABELS.ready || n === LABELS.prReady));
const busyAreas = new Set(inFlight.map(areaOf));
let active = inFlight.length;

console.log(`w locie: ${active}/${MAX_ACTIVE}${inFlight.length ? " — " + inFlight.map((i) => `#${i.number} ${areaOf(i)}`).join(", ") : ""}`);

const candidates = open
  .filter((i) => labelNames(i).includes(LABELS.backlog))
  .sort((a, b) => a.number - b.number);

for (const issue of candidates) {
  if (active >= MAX_ACTIVE) break;
  const area = areaOf(issue);
  const blockers = blockedBy(issue.body).filter((n) => openNumbers.has(n));
  if (blockers.length) {
    console.log(`  #${issue.number} czeka na ${blockers.map((n) => "#" + n).join(", ")}`);
    continue;
  }
  if (busyAreas.has(area)) {
    console.log(`  #${issue.number} czeka — ${area} zajęte`);
    continue;
  }
  console.log(`→ promuję #${issue.number} ${issue.title}${DRY ? " (dry-run)" : ""}`);
  if (!DRY) gh(["issue", "edit", String(issue.number), "--remove-label", LABELS.backlog, "--add-label", LABELS.ready]);
  busyAreas.add(area);
  active++;
}
