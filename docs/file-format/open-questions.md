# `.wld` format — Open questions

Part of the format specification; index and conventions: [../file-format.md](../file-format.md).

## Open questions
1. Are formats 315–325 identical to 326 in the file header and section table? (Very likely, per T2's comment;
   needs one fixture per version.)
2. Should the codec warn when `k` differs from the tile count expected for the version (754 for 326)? TEdit
   treats tile ids ≥ `k` as frame-important. *Partly answered by the tile contract:* ids ≥ `k` are an error
   (vector T14); whether `k ≠ 754` itself deserves a warning is still open.
3. Header flags bits other than bit 0: always zero in F; does the game ever set them? (For saving it no longer
   matters: the writer keeps all 64 bits, W-H2.)
4. Is `pointer[n-1] + 6 ≤ L` too lax? A stricter bound needs the world name, which belongs to the metadata
   contract.
5. ~~**Fixture manifest error:**~~ **Resolved:** the file was renamed `SCCR1.wld` → `SCCO1.wld` and the
   manifest now says `corruption` (bytes untouched, in-game name still `SCCR1`; `renamedFrom` + `note` in the
   manifest). `scripts/check-fixtures.mjs` now compares name, seed, dimensions, mode and evil with the file.
   Original finding: `SCCR1` was declared `"evil": "crimson"` in `manifest.json`, but its metadata
   crimson flag is false and its tiles contain 26 348 corruption tiles (ids 23, 25, 112) and no crimson tiles
   (199, 203, 234). The world is a corruption world; either the manifest entry or the world-generation choice
   was wrong. `SECR1` (crimson) and the two corruption worlds are consistent. Consequence: M1 had **no
   classic-mode crimson fixture** and no test that distinguishes `evil` from `mode` (fixed: `SCCR2.wld` and
   the manifest↔file check in `scripts/check-fixtures.mjs`).
6. Strict end-of-metadata (`pointer[1]` reached exactly): fine for 326; when a newer format appends fields,
   should the reader keep unread bytes opaquely (TEdit's approach) instead of failing?
7. Should the metadata pixel bounds (rows 6–9) be required to equal `16 · width` / `16 · height`? True in F,
   no source states it as a rule.
8. Are the "dangling flag" and "reserved bit" rejections too strict for worlds written by third-party
   editors? None occur in F; a corpus of TEdit-saved worlds would tell.
9. The game's own handling of a run crossing the column end, a negative Int16 run or run width 3 is unknown
   (only TEdit's behaviour is visible). M1 rejects all three.
10. W-T7.3 (no runs for 520 and 423) and TEdit's refusal to save block 127 come from TEdit only; F has none of
    these tiles. A fixture with food platters, logic sensors and an ice-rod block, saved by 1.4.5.8, would show
    what the game does. Splitting such runs is safe either way (every reader accepts `run = 0`).
11. The writer emits two things the game never wrote in F: a liquid of amount 0 and paint 31 on a block. Both
    are valid records for our reader, but whether 1.4.5.8 loads them unchanged is not checked; the in-game check
    in round-trip.md covers only the fixtures, which contain neither.
12. Revision policy for **edited** saves (M5+): +1 per save like the game, or keep it? W-H1 only fixes the
    unchanged case.
13. Footer trailing bytes are rejected (TEdit ignores them). None in F; a corpus of worlds saved by other tools
    would tell whether this is too strict.
14. The .NET `Tile` view (and the `export-json` region output) still shows a present paint byte 0 as `paint: 0`
    while CWM treats it as "no paint". Should the reader normalize it to absent, so that every view agrees with
    the writer? Until then, round-trip tests compare paint 0 and absent as equal. This refines #39's "paint
    presence" criterion: a non-zero paint keeps its presence; a present 0 is normalized.
15. Entity layouts without corpus evidence: every fixture has empty signs, mobs, tile entities, pressure plates,
    room assignments, shimmered NPCs and bestiary ([entities.md](entities.md), "Corpus evidence"). Their record
    layouts rest on TEdit only. A world saved by 1.4.5.8 with signs (incl. a grave marker and an announcement
    box), every tile-entity kind, a weighted pressure plate, assigned housing, a shimmered NPC and bestiary
    progress would confirm them, show whether sign and entity positions are top-left tiles, which tile id a
    weighted pressure plate has, what adds a town-manager room, and the bestiary key format.
16. NPC extra-bits byte (section 5): F only has `01`. Is any other bit ever set by the game, and what follows
    it? *Decided for the decoders (#165):* any bit other than bit 0 is an error (vector E24) until a source or
    fixture shows one; whether the game ever sets one is still open.
17. Creative powers (section 10): an id outside 0, 5, 8–14 has no known value size. *Decided for the decoders
    (#165):* the section fails as unreadable rather than guessing (vector E22). Do non-Journey worlds ever
    store anything but the six default entries seen in F?
18. Entity layouts below 326: the gates 294, 307, 308 and 315 come from TEdit (T29/T32/T34) and are tested on
    synthetic vectors only. The decoders accept tile-entity kinds 0–10 and the same creative-power ids in every
    readable format, although kinds 8–10 belong to tiles above the 1.4.4 tile range (698, 723, 724 > 692). A
    1.4.4 world (format 279) with chests, a display doll and town NPCs would confirm the older layout.
