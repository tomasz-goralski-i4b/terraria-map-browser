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
export CEZ_REVIEW_GATE=1   # udany run ze zmianami czeka na Accept / Send back / Draft PR
```
Nie zaznaczaj "Autonomous" w New Task — autonomiczne runy pomijają review gate.

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
