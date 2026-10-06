# Terraria Map Studio — plan projektu i eksperymentu Personal Software Factory

## Cel

Zbudować lokalny, instalowalny w przeglądarce edytor światów Terrarii. Użytkownik otwiera własny plik `.wld`, lokalnie wskazuje assety Terrarii i opcjonalne assety modów, edytuje mapę, a następnie zapisuje nową kopię świata.

Projekt jest jednocześnie kontrolowanym eksperymentem Personal Software Factory:

```text
issue → agent → osobny worktree → draft PR → niezależny review → human merge → opcjonalny preview deploy
```

Repozytorium i dane testowe muszą być niezależne od kodu firmowego i firmowego GitLaba. Nie kopiujemy do niego assetów Terrarii, światów graczy ani komercyjnych modów.

## Założenia techniczne

- Monorepo: TypeScript + pnpm.
- Referencyjny parser formatu: .NET.
- Edytor docelowy: TypeScript, PWA, przeglądarka.
- Dane lokalne: SQLite WASM w OPFS.
- Hosting kodu: Cloudflare Pages/Workers.
- Assety gry i modów: lokalne po stronie użytkownika.
- Na start używamy tylko firmowych licencji Claude Code i Codex.
- Inne harnessy testujemy wyłącznie w wydzielonej VM/użytkowniku, bez dostępu do firmowych repozytoriów, sekretów i Dockera.

## Dlaczego .NET przed TypeScriptem

`.wld` jest binarnym, wersjonowanym formatem o wielu sekcjach i kompaktowym zapisie tile’ów. Najpierw powstaje referencyjny codec .NET, ponieważ łatwo porównać jego zachowanie z istniejącym kodem TEdit oraz strukturami tModLoader.

Nie przenosimy aplikacji .NET do TypeScript. Przenosimy:

1. jawnie opisaną specyfikację formatu;
2. niezależny model świata;
3. golden fixtures;
4. testy `read → write → read`;
5. oczekiwane różnice między wersjami formatu.

TypeScript implementuje ten sam kontrakt niezależnie. Dzięki temu parser webowy nie jest ukrytym portem przypadkowego kodu C#.

## Architektura repozytorium

```text
terraria-map-studio/
├── apps/
│   ├── web/                         # PWA: React/Vite + renderer WebGL
│   └── inspector-cli/               # narzędzie TS do inspekcji świata
├── packages/
│   ├── world-model/                 # model domenowy niezależny od formatu
│   ├── world-codec/                 # parser i writer .wld w TS
│   ├── mod-registry/                # registry modów, manifesty i ID mapping
│   ├── asset-index/                 # index lokalnych assetów i atlasów
│   ├── renderer/                    # rendering chunków świata
│   ├── local-store/                 # SQLite WASM/OPFS
│   └── test-fixtures/               # jawnie generowane fixture’y i manifesty
├── dotnet/
│   ├── Terraria.WorldCodec/         # referencyjny parser/writer
│   ├── Terraria.WorldInspector/     # CLI: inspect, diff, export JSON
│   ├── Terraria.ModExporter/        # eksport manifestu moda
│   └── Terraria.WorldCodec.Tests/
├── docs/
│   ├── architecture.md
│   ├── file-format.md
│   ├── compatibility-matrix.md
│   ├── mod-support.md
│   ├── local-storage.md
│   └── agent-workflow.md
├── AGENTS.md
├── CLAUDE.md
├── WORKFLOW.md
└── .github/
    ├── ISSUE_TEMPLATE/
    ├── pull_request_template.md
    └── workflows/ci.yml
```

## Model świata

Model domenowy nie może przechowywać wyłącznie liczbowego `tileId`, ponieważ runtime ID moda zależy od zestawu zainstalowanych modów.

```ts
type ContentRef =
  | { kind: "vanilla"; id: number }
  | {
      kind: "mod";
      mod: string;
      internalName: string;
      runtimeId?: number;
      modVersion?: string;
    }
  | { kind: "unknown"; runtimeId: number };

type Tile = {
  block?: ContentRef;
  wall?: ContentRef;
  frameX?: number;
  frameY?: number;
  paint?: number;
  wires: number;
  actuator: boolean;
  liquid?: { kind: "water" | "lava" | "honey" | "shimmer"; amount: number };
};
```

Przy imporcie zapisujemy runtime ID oraz, gdy dane są dostępne, stabilny identyfikator `mod/internalName`. Przy eksporcie rozwiązujemy identyfikator do aktualnej konfiguracji modów.

## Wsparcie modów

"Obsługa modów" nie jest jednym checkboxem. Każdy feature i każdy mod dostaje poziom kompatybilności.

| Poziom | Znaczenie |
|---|---|
| `Preserve` | Świat z nieznanymi danymi można otworzyć i zapisać bez ich usunięcia. |
| `Validate` | Edytor wykrywa wymagane mody i rozjazd wersji. |
| `Render` | Edytor renderuje statyczne tile’e/walls z dostarczonych assetów. |
| `Edit` | Użytkownik może stawiać i usuwać rozpoznane tile’e/walls. |
| `Gameplay` | Edytor rozumie custom framing, tile entities i logikę moda. |

Zakres MVP:

```text
Vanilla:       Render + Edit
Modded world:  Preserve + Validate
Wybrane mody:  Render
```

`Gameplay` nie jest celem ogólnego MVP. Kod moda może dowolnie definiować zasady działania, framing i dane encji; przeglądarka nie powinna próbować wykonywać skompilowanego kodu moda.

### Mod Export Pack

Zamiast zakładać, że parser `.tmod` uniwersalnie odgadnie semantykę moda, tworzymy format pośredni generowany przez CLI lub companion mod:

```text
mod-export/
├── manifest.json
├── tiles.json
├── walls.json
├── objects.json
└── textures/
```

Manifest zawiera nazwę moda, wersję, mapowanie stabilnych nazw na runtime ID, wymiary sprite’ów, reguły framingu obsługiwane przez edytor i hashe assetów.

## Assety i lokalne działanie

PWA hostowana na Cloudflare nie dostaje automatycznego dostępu do dysku użytkownika. Użytkownik wybiera folder przez File System Access API:

```ts
const terrariaFolder = await window.showDirectoryPicker({
  mode: "read",
  id: "terraria-content",
});
```

Przeglądarka wymaga HTTPS oraz bezpośredniej akcji użytkownika. Aplikacja nie może samodzielnie otworzyć `C:\\Program Files\\...` ani skanować dysku.

Interfejs:

```text
[ Otwórz świat .wld ]
[ Połącz assety Terrarii ]
[ Dodaj Mod Export Pack ]
[ Zapisz kopię świata ]
```

Fallback dla przeglądarek bez wyboru folderu:

```text
- import pliku .wld;
- import ZIP-a z assetami/mod export packiem;
- eksport przez pobranie pliku.
```

Assety Terrarii oraz modów pozostają lokalne. Nie trafiają do repozytorium, D1 ani R2 bez jawnego działania użytkownika.

## PWA i lokalna SQLite

PWA daje ikonę, osobne okno, offline cache i doświadczenie zbliżone do aplikacji desktopowej. Używamy stałej domeny produkcyjnej, np. `mapstudio.example.com`; magazyn przeglądarki jest powiązany z originem, więc Cloudflare preview URL nie jest miejscem do trwałej pracy.

Lokalny model przechowywania:

```text
Przeglądarka
├── SQLite WASM + OPFS
│   ├── registry assetów
│   ├── registry modów
│   ├── historia edycji
│   ├── ostatnio otwarte światy
│   └── undo/redo metadata
└── OPFS files
    ├── cache atlasów tekstur
    ├── wygenerowane sprite mapy
    └── snapshoty świata
```

SQLite trzyma indeks i relacje; PNG, tilesheety i atlas powinny być plikami/blobami w OPFS, nie Base64 w tabelach.

Przykładowe tabele:

```sql
CREATE TABLE assets (
  asset_hash TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  mod_name TEXT,
  mod_version TEXT,
  source_path TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  atlas_path TEXT
);

CREATE TABLE content_registry (
  content_kind TEXT NOT NULL,
  runtime_id INTEGER NOT NULL,
  stable_key TEXT NOT NULL,
  asset_hash TEXT,
  frame_rule TEXT,
  PRIMARY KEY (content_kind, runtime_id)
);

CREATE TABLE worlds (
  world_id TEXT PRIMARY KEY,
  local_file_name TEXT NOT NULL,
  game_version INTEGER NOT NULL,
  mod_set_hash TEXT,
  cached_snapshot_path TEXT
);
```

## Cloudflare

MVP nie potrzebuje backendu:

```text
Cloudflare Pages → statyczny PWA editor
Lokalny browser  → .wld + assety + mod pack + SQLite + cache
```

Po stabilizacji można dodać synchronizację:

```text
Cloudflare D1 → konta, projekty, wersje, metadata
Cloudflare R2 → opcjonalne backupy .wld, eksporty, manifesty
```

D1 nie służy do przechowywania assetów. R2 służy do obiektów binarnych, D1 do metadanych.

## Milestone’y

### M0 — foundation

**Cel:** agent-friendly repo i powtarzalna praca nad PR-ami.

- Monorepo, pnpm, .NET solution i CI.
- `AGENTS.md`, `CLAUDE.md`, `WORKFLOW.md`, opis architektury.
- GitHub Issues/Project jako źródło stanu.
- PR template z sekcjami: zakres, testy, kompatybilność, ryzyko.
- Cezar z natywnie zalogowanym Codexem i Claude Code.

**Done:** testowy issue przechodzi przez worktree, draft PR, CI i review.

### M1 — .NET world inspector

**Cel:** zrozumienie formatu bez UI.

- Rozpoznanie wersji `.wld`.
- Odczyt metadanych świata i wymiarów.
- Odczyt tile sections do modelu domenowego.
- CLI `inspect`, `export-json`, `diff`.
- Fixture’y: jawnie wygenerowane małe vanilla worlds.

**Done:** `inspect` raportuje świat, a JSON ma stabilny snapshot testowy.

### M2 — round-trip bezpieczeństwa

**Cel:** nie psuć świata bez zmian użytkownika.

- Writer `.wld` w .NET.
- Test `load → save → load` porównujący semantycznie wszystkie pola.
- Backup przed każdą operacją zapisu.
- Test otwarcia zapisanego świata w ustalonej wersji Terrarii.

**Done:** świat po round-trip otwiera się w grze i ma identyczny model semantyczny.

### M3 — TypeScript codec

**Cel:** niezależny codec TS zgodny z referencją .NET.

- Parser TS dla fixture’ów M1/M2.
- Wspólny `world-model`.
- Porównanie JSON eksportowanego z .NET i TS.
- Writer TS dla ograniczonego vanilla subsetu.

**Done:** parsery .NET i TS mają identyczny wynik dla corpus testowego.

### M4 — browser viewer

**Cel:** otworzyć świat lokalnie w PWA.

- PWA z offline cache.
- Import `.wld` przez file picker.
- Pan, zoom, layer switch i tile inspector.
- Chunk renderer, początkowo `128 × 128` tile’i.
- Lokalny import folderu assetów lub ZIP-a.

**Done:** użytkownik otwiera mały vanilla świat i płynnie go ogląda.

### M5 — vanilla editor

**Cel:** pierwsza użyteczna edycja.

- Pędzel pojedynczego tile’a i zaznaczenie prostokątne.
- Undo/redo.
- Zmiana wybranych vanilla tile’ów/walls.
- Eksport nowej kopii `.wld`.

**Done:** użytkownik zmienia obszar świata, zapisuje kopię i otwiera ją w Terrarii.

### M6 — mod safety

**Cel:** bezpiecznie nie niszczyć danych modded world.

- Rejestr wymaganych modów i wersji.
- `unknown` content reference.
- Zachowanie nierozpoznanych ID przy odczycie/zapisie.
- UI z ostrzeżeniem "brakuje asset packa" oraz placeholderem.

**Done:** modded world można otworzyć i zapisać bez utraty nierozpoznanych danych.

### M7 — Mod Export Pack

**Cel:** renderować jeden kontrolowany mod.

- Definicja manifestu.
- .NET CLI lub companion mod generujący manifest.
- Import manifestu i tekstur w webie.
- Render jednego statycznego custom tile’a.

**Done:** testowy modded tile jest widoczny w przeglądarce i zachowuje się po eksporcie świata.

### M8 — preview deploy i sync (opcjonalne)

**Cel:** udostępnić aplikację bez wysyłania game assets.

- Cloudflare Pages.
- Stała domena PWA.
- Opcjonalnie konto, D1 metadata, R2 backupy własnych eksportów.
- Brak automatycznego uploadu assetów Terrarii/modów.

**Done:** aplikacja działa z Cloudflare, zachowując model local-first.

## Kolejność prac

```text
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8
```

Nie zaczynamy od UI ani modów. Najpierw powstaje zaufany codec, potem viewer, potem edycja, a obsługa modów jest rozszerzeniem kontraktu kompatybilności.

## Delegowanie agentom

### Role

| Rola | Odpowiedzialność | Domyślny runtime |
|---|---|---|
| Implementer codec | parser, writer, testy binarne | Codex albo Claude Code |
| Fixture/documentation engineer | fixture’y, opis formatu, test vectors | drugi provider |
| Web implementer | PWA, renderer, UX | Codex albo Claude Code |
| Reviewer | świeży review diffu oraz testów | provider inny niż implementer |
| Human integrator | decyzje zakresu, merge, test w grze | człowiek |

### Reguły delegowania

1. Jeden agent jest właścicielem jednego obszaru plików w danym czasie.
2. Codec i zapis binarny nie są zmieniane równolegle przez dwa workery.
3. Każdy task działa w osobnym worktree.
4. Implementer zawsze kończy draft PR-em.
5. Reviewer nie zatwierdza własnego kodu.
6. Reviewer na starcie tylko raportuje; poprawki wykonuje implementer przez task `Rework`.
7. Human merge dopiero po zielonym CI i niezależnym review.

### Routing providerów

```text
Codex implementuje → Claude reviewuje
Claude implementuje → Codex reviewuje
```

Przy szczególnie ryzykownej zmianie formatu reviewer dostaje świeży worktree na branchu PR i uruchamia:

```text
- testy codec;
- round-trip corpus;
- semantic diff;
- ręczny test otwarcia świata w docelowej wersji gry.
```

## GitHub Project jako control plane

Statusy:

```text
Todo → Agent Ready → In Progress → PR Ready → Agent Review
→ Human Review → Done

                         ↘ Rework ↗
```

Issue jest jednostką pracy. Nie utrzymujemy stanu sprintu tylko w pamięci agenta.

Minimalne labels:

```text
area:codec
area:web
area:mods
area:infra
agent:codex
agent:claude
compat:vanilla
compat:mod-preserve
compat:mod-render
priority:high
```

## Szablon issue

```md
## Cel
Jedno zdanie opisujące efekt dla użytkownika.

## Zakres
- ...

## Poza zakresem
- ...

## Ownership
- Pliki/moduły, które może zmienić agent.

## Compatibility impact
- Vanilla: None / Render / Edit
- Modded worlds: None / Preserve / Validate / Render / Edit

## Kryteria akceptacji
- ...

## Proof
- Fixture:
- Test command:
- Manual test:

## Definition of Done
- [ ] Testy przechodzą
- [ ] Dokumentacja zaktualizowana
- [ ] Draft PR utworzony
- [ ] Niezależny review ukończony
```

## Szablon instrukcji dla implementera

```md
Pracujesz nad issue #<id> w przypisanym worktree.

1. Przeczytaj issue, AGENTS.md i odpowiednie docs/.
2. Nie rozszerzaj zakresu bez opisania tego w PR.
3. Zmieniaj wyłącznie pliki zgodne z sekcją Ownership.
4. Dodaj test, gdy zmieniasz zachowanie parsera, writer’a albo renderer’a.
5. Uruchom komendy z sekcji Proof.
6. Utwórz draft PR z opisem: zmiany, testy, compatibility impact, ryzyka.
7. Nie merge’uj PR-a.
```

## Szablon instrukcji dla reviewera

```md
Reviewuj PR #<id> w świeżym worktree.

Sprawdź:
- zgodność z issue i brak rozszerzenia zakresu;
- regresje formatu i round-trip;
- jakość fixture’ów;
- obsługę nieznanych modded IDs;
- pokrycie testami;
- czy opis kompatybilności jest zgodny z kodem.

Zakończ jednym z: APPROVE, REQUEST_CHANGES, BLOCKED.
Nie zmieniaj kodu, chyba że issue explicite zleca review + fix.
```

## Cezar, Multica i Symphony

### Cezar — start eksperymentu

Najlepszy pierwszy runner dla projektu:

- uruchamia natywnie zalogowane Claude Code i Codex;
- daje osobny Git worktree na task;
- utrzymuje lokalny stan w `.ai/cezar/`;
- wspiera workflow i draft PR;
- nie wymaga od razu dodatkowego backendu.

### Multica — później jako wspólne biuro agentów

Ma sens, gdy pojawi się potrzeba:

- współdzielonego boardu;
- agenta daemona;
- historii pracy i komentarzy;
- wielu runtime’ów oraz wielu osób.

Nie jest pierwszym krokiem, bo wymaga cięższej infrastruktury niż POC.

### Symphony — wzorzec docelowy

Stosujemy ideę Symphony:

```text
Każdy aktywny ticket ma izolowany workspace i agenta,
który działa aż do workflow-defined handoff.
```

Nie musimy od razu używać referencyjnej implementacji Symphony. GitHub Project + Cezar mogą realizować ten sam wzorzec dla początkowego POC.

## Minimalne CI

```text
pnpm lint
pnpm test
pnpm build
dotnet test
```

Po M2 dochodzi:

```text
dotnet run --project dotnet/Terraria.WorldInspector -- roundtrip fixtures/
pnpm --filter @studio/world-codec test:compatibility
```

Po M5 dochodzi test end-to-end importu świata, edycji i eksportu kopii.

## Metryki eksperymentu Personal Software Factory

Mierzymy dla każdego issue:

- czas `Agent Ready → draft PR`;
- liczbę interwencji człowieka;
- wynik pierwszego CI;
- liczbę cykli review/rework;
- wynik ręcznego testu w grze;
- wykorzystany provider;
- przyczynę niepowodzenia, jeśli wystąpiła.

Po tygodniu porównujemy nie "który agent jest lepszy", lecz:

```text
- które typy zadań są delegowalne;
- gdzie brakuje dokumentacji w repo;
- jakie testy dają agentom najwięcej samodzielności;
- jakie bramki trzeba zostawić człowiekowi;
- czy Cezar wystarcza, czy potrzebny jest board/daemon Multica.
```

## Źródła referencyjne

- TEdit: https://github.com/TEdit/Terraria-Map-Editor
- tModLoader: https://github.com/tModLoader/tModLoader
- Cezar: https://github.com/open-mercato/cezar
- Multica: https://github.com/multica-ai/multica
- OpenAI Symphony: https://github.com/openai/symphony
- File System Access API: https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
- OPFS: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- SQLite WASM persistence: https://www.sqlite.org/wasm/doc/trunk/persistence.md
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare R2: https://developers.cloudflare.com/r2/
