// Tworzy issue z pliku backlogu wygenerowanego przez planner (domyślnie .tdd/backlog.json).
// LLM proponuje, skrypt tworzy — walidacja kształtu, kolejności zależności i duplikatów.
// Exit: 0 OK, 1 zły plik (planner może poprawić), 2 błąd GitHuba.
import { readFileSync } from "node:fs";
import { gh, ghJson } from "./gh.mjs";

const file = process.argv[2] ?? ".tdd/backlog.json";
// "human" = praca, której agent nie zrobi (np. wygenerowanie świata w grze); promoter jej nie rusza.
const FLOWS = ["tdd", "foundation", "spike", "human"];
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
  fail(`nie mogę wczytać ${file}: ${e.message}`);
}
// UTF-8 przeczytany jako Windows-1252 (PowerShell 5.1 Get-Content/Set-Content bez -Encoding) daje "Ä…", "â€”", "Ĺ‚".
const mojibake = raw.match(/Ã.|Ä.|Å.|Ĺ.|â€./u);
if (mojibake) {
  fail(`plik ma zepsute kodowanie (np. "${mojibake[0]}"). Zapisz .tdd/backlog.json jako UTF-8 narzędziem do edycji plików ` +
    "(apply_patch/Write), nie przez PowerShell Set-Content/Out-File; czytaj pliki przez Get-Content -Encoding UTF8.");
}
if (!backlog || typeof backlog.milestone !== "string" || !Array.isArray(backlog.issues) || backlog.issues.length === 0) {
  fail('oczekiwany kształt: {"milestone": "M1", "issues": [...]}');
}

const seen = new Set();
for (const [i, it] of backlog.issues.entries()) {
  const where = `issues[${i}] (${it?.key ?? "?"})`;
  if (!it.key || !/^[a-z0-9-]+$/.test(it.key)) fail(`${where}: key musi być kebab-case`);
  if (seen.has(it.key)) fail(`${where}: zduplikowany key`);
  if (!it.title || it.title.length > 120) fail(`${where}: title wymagany, max 120 znaków`);
  if (!FLOWS.includes(it.flow)) fail(`${where}: flow ∈ ${FLOWS.join("|")}`);
  if (it.flow !== "human" && !RUNNERS.includes(it.runner)) fail(`${where}: runner ∈ ${RUNNERS.join("|")}`);
  if (!it.area || !/^[a-z]+$/.test(it.area)) fail(`${where}: area wymagane (np. codec, model, fixtures, docs, infra)`);
  if (!it.body || !it.body.includes("## Kryteria akceptacji")) fail(`${where}: body musi zawierać sekcję "## Kryteria akceptacji"`);
  for (const dep of it.blockedBy ?? []) {
    if (!seen.has(dep)) fail(`${where}: blockedBy "${dep}" musi wskazywać issue WCZEŚNIEJ na liście`);
  }
  seen.add(it.key);
}

let existing;
try {
  existing = ghJson(["issue", "list", "--state", "all", "--limit", "500", "--json", "number,title"]);
} catch {
  console.log("INFRA: gh issue list nie działa");
  process.exit(2);
}
const byTitle = new Map(existing.map((x) => [x.title, x.number]));
const numbers = new Map();

for (const it of backlog.issues) {
  const title = `[${backlog.milestone}] ${it.title}`;
  if (byTitle.has(title)) {
    numbers.set(it.key, byTitle.get(title));
    console.log(`skip (istnieje): #${byTitle.get(title)} ${title}`);
    continue;
  }
  const deps = (it.blockedBy ?? []).map((k) => `#${numbers.get(k)}`);
  const body = `${deps.length ? `Blocked by: ${deps.join(", ")}\n\n` : ""}${it.body.trim()}\n\n<!-- backlog-key: ${it.key} -->\n`;
  const labels = it.flow === "human"
    ? ["human", `area:${it.area}`]
    : ["backlog", `flow:${it.flow}`, `agent:${it.runner}`, `area:${it.area}`];
  try {
    gh(["label", "create", `area:${it.area}`, "--color", "fbca04"]);
  } catch {
    // label już istnieje
  }
  let url;
  try {
    url = gh(["issue", "create", "--title", title, "--body-file", "-", ...labels.flatMap((l) => ["--label", l])], { input: body });
  } catch {
    console.log(`INFRA: nie udało się utworzyć "${title}"`);
    process.exit(2);
  }
  const n = Number(url.split("/").pop());
  numbers.set(it.key, n);
  console.log(`created: #${n} ${title}  [${labels.join(", ")}]${deps.length ? `  blocked by ${deps.join(", ")}` : ""}`);
}
console.log(`BACKLOG: OK — ${backlog.issues.length} pozycji. Odblokowanie: bash scripts/backlog/promote.sh (albo Actions → promote).`);
