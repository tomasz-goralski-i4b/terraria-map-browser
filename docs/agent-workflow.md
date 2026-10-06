# Workflow agentów (Cezar)

## Uruchomienie Cezara — WAŻNE na Windows

Cezar odpala kroki `command` przez `bash -lc`. W zwykłym PowerShell/cmd pierwszy w PATH jest
`C:\Windows\System32\bash.exe`, czyli **WSL**, bez naszego toolchainu. Dlatego:

**Uruchamiaj Cezara z Git Bash**, w katalogu repo:

```bash
cd /d/REPOS/AI/terraria-map-studio
npx cezar-run
```

Jeśli bramka i tak trafi do WSL, `scripts/lib.sh` zakończy ją kodem 2 z komunikatem `INFRA: ... WSL`.

Zalecane zmienne (np. w `~/.bashrc` albo przed `npx`):
```bash
export CEZ_DISPATCH=0      # agent w chainie nie odpala własnych pod-tasków (te nie mają bramek TDD)
```
Każdy chain kończy się krokiem `open-pr` (push + draft PR), więc review gate Cezara nie jest potrzebny,
a runy z automations mogą być `autonomous`.

## Flow backlogu: planner → promoter → automations → Ty

```
1. plan-backlog (Cezar, ręcznie)   "Rozpisz M1"  → .tdd/backlog.json → bramka tworzy issue [backlog]
2. promoter (GitHub Action / ręcznie)            → issue bez otwartych blokerów, wolne area → [agent:ready]
3. automation Cezara (poll co 2 min)             → task z workflow wg labeli flow:* / agent:*  (autonomous)
4. chain                                          → red → green → refactor → review → open-pr
                                                   → draft PR "Closes #N", issue → [status:pr-ready]
5. Ty                                             → review PR na GitHubie, CI zielone → merge
6. issue zamknięte → Action `promote`             → odblokowuje kolejne → wraca do 3
```

| Label | Kto nadaje | Znaczenie |
|---|---|---|
| `backlog` | planner (create-issues) | zaplanowane, czeka |
| `agent:ready` | promoter | automation startuje task |
| `status:pr-ready` | `open-pr.sh` | PR czeka na Ciebie |
| `human` | planner | Twoja praca (np. fixture z gry); zamknij issue, gdy zrobione — odblokuje zależne |
| `flow:tdd|foundation|spike` + `agent:claude|codex` | planner | wybór workflow i implementera |
| `area:*` | planner | promoter puszcza jedno issue naraz na area |

Reguły promotera (`scripts/backlog/promote.mjs`): kolejność wg numeru issue, wszystkie `Blocked by: #N` zamknięte,
area wolne, globalnie w locie < `MAX_ACTIVE` (2 = `maxParallel` Cezara).

Automations (`.ai/cezar/automation-defs/*.json`) słuchają `issue.labeled` = `agent:ready`, tylko dla issue
autorstwa właściciela repo (repo jest publiczne). Instalacja (cockpit musi działać dla tego repo):
```bash
bash scripts/backlog/install-automations.sh
```
Tworzą się **wstrzymane**; włączasz w UI → Automations. Włączenie ustawia baseline "od teraz" —
labele nadane wcześniej nie zostaną podjęte (wtedy zdejmij i nadaj `agent:ready` ponownie).

### Gdy coś pójdzie nie tak
- Task w Cezarze `failed` (wyczerpane retry, BLOCKED, INFRA) → issue zostaje na `agent:ready`, area jest zajęte.
  Przeczytaj log, popraw issue/kod, potem: zdejmij `agent:ready` i nadaj ponownie (automation odpali nowy task),
  albo daj `backlog` i odpal promotera.
- Uwagi do PR → Continue na tasku w Cezarze z komentarzem albo popraw ręcznie na branchu PR.
- Zły plan → zamknij/edytuj issue na GitHubie; `create-issues` pomija tytuły, które już istnieją.

## Chain `tdd-feature`

```
red ─► check-red ─► green ─► check-green ─► refactor ─► check-refactor ─► review ─► check-review ─► review gate ─► draft PR
 ▲        │           ▲          │             ▲             │                          │
 └─retry──┘           └──retry───┘             └───retry─────┘                          │
 ▲                                                                                      │
 └────────────────────── REQUEST_CHANGES (uwagi trafiają do prompta) ───────────────────┘
```

| Krok | Kto | Co robi | Bramka sprawdza |
|---|---|---|---|
| red | implementer | `.tdd/plan.md`, testy, stuby | są zmiany w testach, build OK, testy FAILUJĄ → commit `test: red`, `.tdd/red-sha` |
| green | implementer | minimalna implementacja | testy niezmienione od `red-sha`, `verify.sh` OK → commit, `.tdd/green-sha` |
| refactor | implementer | porządki, docs | jw. |
| review | drugi provider | `.tdd/review.md` z werdyktem | reviewer nic nie zmienił; APPROVE=0, REQUEST_CHANGES=1 (rework), BLOCKED=3 (stop) |

Rework wraca do `red`: błąd zachowania → najpierw failujący test; uwagi stylistyczne → red bez testów (bramka przepuszcza).

## Kody wyjścia bramek
| Kod | Znaczenie | Cezar |
|---|---|---|
| 0 | OK | następny krok |
| 1 | praca zła, agent może poprawić | `retry` (z outputem w prompcie), do `max` |
| 2 | infrastruktura (brak narzędzia, WSL) | stop — bez marnowania prób agenta (`retryOn: [1]`) |
| 3 | decyzja człowieka (BLOCKED, reviewer edytował kod) | stop |

## Fakty o Cezarze, na których to stoi
- Każdy krok agenta to **nowa sesja** — dlatego handoff przez `.tdd/` i skille każą czytać pliki.
- Krok to albo `prompt`/`skill`, albo `command` — nie oba.
- `retry` cofa do wskazanego kroku i wykonuje ponownie wszystko po nim; `max` liczony per bramka.
- Codex ignoruje `allowedTools` — zakaz edycji przez reviewera egzekwuje `check-review.sh`, nie uprawnienia.

## Metryki eksperymentu (per issue, ręcznie w PR)
czas Agent Ready → draft PR · interwencje człowieka · wynik 1. CI · cykle rework · provider · przyczyna porażki.
