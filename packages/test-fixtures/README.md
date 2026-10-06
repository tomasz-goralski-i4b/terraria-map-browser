# test-fixtures

Jawnie wygenerowane, małe światy vanilla używane przez testy codeców (.NET i TS).

Zasady:
- Tylko światy wygenerowane specjalnie na potrzeby testów — nigdy światy graczy ani pliki z modów.
- Każdy plik `worlds/*.wld` ma wpis w `worlds/manifest.json`: wersja gry, wersja formatu, rozmiar, seed,
  tryb (classic/expert/journey), evil (corruption/crimson), kto i kiedy wygenerował, czy był modyfikowany w grze.
- Preferuj fixture'y syntetyczne budowane w kodzie testu (bajty nagłówka/sekcji) — prawdziwe światy
  służą do testów kompatybilności i round-trip.
