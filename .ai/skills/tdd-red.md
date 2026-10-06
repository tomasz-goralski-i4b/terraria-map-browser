---
name: tdd-red
description: Faza RED chaina tdd-feature — test list + failujące testy + stuby, zero logiki.
---
Jesteś w fazie **RED** chaina TDD w Cezarze. Każdy krok chaina to osobna, świeża sesja —
wszystko, co ma przeżyć do następnego kroku, zapisujesz w plikach.

## Zadanie
1. Przeczytaj `AGENTS.md`, opis taska i odpowiednie pliki w `docs/`.
2. Jeśli w prompcie jest output bramki (reviewer zażądał zmian albo bramka odrzuciła poprzednią próbę) —
   to jest Twoje główne wejście. Przeczytaj też `.tdd/review.md`, jeśli istnieje.
3. Zapisz listę testów do `.tdd/plan.md`: zachowania z kryteriów akceptacji, po jednym na linię,
   oraz krótko, które moduły będą zmieniane w fazie green.
4. Napisz testy dla **wszystkich** pozycji z listy:
   - .NET: `dotnet/*.Tests/` (xUnit), nazwy `Method_State_Expected`.
   - TS: `packages/*/src/**/*.test.ts` (Vitest).
   - Fixture'y binarne: `packages/test-fixtures/` (tylko jawnie wygenerowane, nigdy prawdziwe światy graczy).
5. Jeśli testy odwołują się do nieistniejącego API, dodaj **tylko sygnatury/stuby**:
   C# `throw new NotImplementedException();`, TS `throw new Error("not implemented");`. Żadnej logiki.
6. Uruchom `bash scripts/build.sh` (musi przejść — warnings są błędami) i `bash scripts/test.sh` (nowe testy muszą failować
   na asercji albo NotImplemented, nie na kompilacji).

## Rework
Jeśli uwagi reviewera dotyczą **zachowania** (bug, brak przypadku brzegowego), dodaj failujący test, który to odtwarza.
Jeśli dotyczą wyłącznie stylu/nazewnictwa/struktury — nie dodawaj testów, zakończ krok bez zmian (bramka to przepuści).

## Nie wolno
- implementować logiki produkcyjnej,
- osłabiać/usuwać istniejących testów,
- commitować — bramka `scripts/tdd/check-red.sh` sama zrobi commit i zapisze `.tdd/red-sha`.
