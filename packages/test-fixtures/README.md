# test-fixtures

Explicitly generated, small vanilla worlds used by the codec tests (.NET and TS).

Rules:
- Only worlds generated specifically for tests — never player worlds or files from mods.
- Every `worlds/*.wld` file has an entry in `worlds/manifest.json`: game version, format version, size, seed,
  mode (classic/expert/journey), evil (corruption/crimson), who generated it and when, whether it was modified in game.
- Prefer synthetic fixtures built in test code (header/section bytes) — real worlds are for
  compatibility and round-trip tests.
