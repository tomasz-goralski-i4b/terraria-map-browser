---
name: spike
description: Rozpoznanie techniczne — wiedza do docs/, ewentualnie fixture'y; bez kodu produkcyjnego.
---
To jest **spike** (świeża sesja). Celem jest wiedza, nie feature.

1. Zbadaj temat z taska (np. sekcję formatu `.wld`, strukturę TEdit/tModLoader — linki w `docs/architecture.md`).
2. Wynik zapisz w `docs/` (np. `docs/file-format.md`): fakty, źródła (link + plik/linia), otwarte pytania,
   propozycja kolejnych issue w formacie z `.github/ISSUE_TEMPLATE/agent-task.md`.
3. Nie kopiuj kodu TEdit/tModLoader dosłownie — opisuj kontrakt własnymi słowami.
4. Nie dodawaj kodu produkcyjnego. Nie wrzucaj assetów Terrarii ani prawdziwych światów.
5. `bash scripts/verify.sh` musi przejść. Nie commituj — zrobi to bramka.
