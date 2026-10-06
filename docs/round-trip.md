# Round trip: backup, save and the in-game check (M2)

How a world is saved safely, and how a human confirms that a saved world still works in the game. The byte-level
rules of the writer are in [file-format/writer.md](file-format/writer.md) ("Footer (M2)" and "Writer contract"). Implemented
by #41 (guarded save + `roundtrip` CLI); the in-game check is #45, whose results go to
`docs/round-trip-validation.md` (human-owned).

**No gameplay-safety claim.** Until the in-game check below has passed for every fixture, a saved world is only
*structurally* verified (our reader accepts it and the semantic model is unchanged). Nothing in the code, the
CLI output or the docs may say that a saved world is safe to play before that.

## Terms
- **Input**: the `.wld` that was read. **Destination**: the path being written; it may be the input itself
  (in-place save), an existing other file (replacement) or a new path.
- **S0**: SHA-256 and length of the input bytes as read at load time.
- **Expected backup bytes**: the bytes the destination holds right before the save — the destination's current
  bytes when it exists (in-place or replacement), otherwise the input bytes (new copy). For an in-place save
  this is the input, so its hash must equal S0.
- **Candidate**: the writer's output, held in memory until it is validated.

## Save procedure

Every `.wld` write goes through these steps in this order. A step that fails stops the save with the step id
in the error; the steps before B6 never touch the destination.

| Step | Action | Failure → outcome |
|---|---|---|
| B1 | Read the input fully into memory (the envelope of #38 does not depend on the file staying open); record S0. The input must pass the whole reader, including the footer (W-S5). | read error → nothing written |
| B2 | Resolve input and destination to full paths; if they name the same file (also through a different spelling), this is an in-place save. For an in-place save, re-hash the file on disk: if it no longer equals S0, someone changed it since load. | `SourceChanged` → nothing written |
| B3 | Build the candidate in memory (W-S1 … W-S5, W-T1 … W-T9). Decode it with the reader, including the footer, and compare with the source: the semantic model must be equal, and metadata, sections 3–10 and footer must be byte-equal (W-M1, W-S1, W-S5). Record the candidate's SHA-256 and length. | `UnencodableTile`, `UnsupportedWrite`, `RoundTripMismatch` → nothing written |
| B4 | Write the backup next to the destination as `<destination>.<UTC yyyyMMddTHHmmssfffZ>.tms.bak`, opened in **create-new** mode (an existing file is never overwritten; on a name clash the save fails rather than retry silently). Flush to disk, read it back, compare its SHA-256 and length with the expected backup bytes. | `BackupFailed` → if this save created the backup file, that partial file is deleted; if create-new failed because the name already exists, the existing file is left untouched; nothing written |
| B5 | Write the candidate to `<destination>.tms.tmp` in the destination directory (create-new), flush to disk, read it back, and decode it once more with the reader. Its SHA-256 and length must equal the candidate's (computed in memory in B3); any difference fails the step before B6. | `WriteFailed` → if this save created the temp file, it is deleted; if create-new failed because `<destination>.tms.tmp` already exists (left by an earlier save or owned by another process), that file is left untouched; destination untouched |
| B6 | Replace the destination with the temp file in one rename (same directory, so same volume). | `ReplaceFailed` → destination is either the old bytes or the new ones, never a mix; the error names the backup path |
| B7 | Re-hash the destination; it must equal the candidate hash. Report input, destination and backup paths, S0, backup hash, candidate hash, revision and `pointer[0 … 10]` before and after. | `VerifyFailed` → report it with the backup path for a manual restore |

Rules that apply to every step:
- Backups are never deleted or overwritten by the tool; two saves make two backups.
- Never use the game's own backup name `<world>.wld.bak` — the game rotates it on its own saves.
- Never write into the repository's `packages/test-fixtures/worlds/`: fixtures are immutable; the procedure
  works on copies.
- TEdit, for comparison, writes `<file>.tmp` and then **copies** it over the target with no backup of the old
  file ([file-format/sources-and-versions.md](file-format/sources-and-versions.md), source T27). The steps above add the verified backup and the validation before replace.

### Expected values for the corpus
An unchanged save of a fixture copy is byte-identical to the fixture ([file-format/writer.md](file-format/writer.md), "Evidence: original vs
candidate layout"). So for a new-copy save of `<fixture>.wld` to a fresh path, the backup, the candidate and the
destination must all have the fixture's manifest hash, and the revision stays as listed:

| Fixture | Bytes | Revision | SHA-256 (backup = candidate = destination) |
|---|---|---|---|
| SCCO1 | 2 994 409 | 1 | `31bb924d47b791f22b001111eca095695890196d52bd24dcb9000dd07b3d1d08` |
| SCCR2 | 2 927 112 | 1 | `888b383bebec8ec0ca87595700d79f201ec15a15bee386e93bc48be9bb01dcaa` |
| SECR1 | 3 016 797 | 1 | `54baff6c3ffbe8dc8e22d9c8b186c3398d72339bd0e9546a3ee928c8db4b8429` |
| SJCO1 | 2 825 462 | 1 | `0c67aba1d0cf22ba97d846c9d030a1d5b3a19ec6be72a3d08f9d203dc1a0cc76` |
| SMCO1 | 2 963 151 | 2 | `4aa2290b69278b2c8ea3df7b424592559d43ebff0e35146dcd96562abc544390` |

Any other hash for an unchanged save is a writer bug, not a reason to update this table.

## In-game check (human, pinned Terraria 1.4.5.8)

Only a human can do this; agents prepare the files and record nothing as passed.

**Preparation**
1. Confirm the game build: Terraria **1.4.5.8** (format 326), vanilla, no tModLoader. Record the version shown
   on the title screen.
2. Work in a scratch directory outside the repository. Copy each fixture there; never use a player world.
3. Run the guarded save (B1–B7) from each copy to a new file `TMS-<fixture>.wld`. Record the tool's report: S0,
   backup hash, candidate hash, revision. Each must match the table above; if not, stop — the check fails.
4. Turn off cloud saving for these worlds and copy `TMS-<fixture>.wld` into the game's worlds folder
   (`Documents/My Games/Terraria/Worlds/`). The world list shows the **in-game** name (e.g. `SCCR1` for
   `SCCO1`), so check that no existing world has the same name.

**In the game, per world**
5. Select the world and **Play**. Pass: it loads with no error or "corrupted" message. Record a pass/fail.
6. Compare with the manifest: world name, size, mode and evil (corruption or crimson near spawn / on the map);
   look at the spawn area, some water and lava, and — where the world has them — a chest's contents, a sign,
   the NPCs and (SJCO1) the Journey power menu.
7. Leave with **Save & Exit**. The game rewrites the file (and keeps its own `.wld.bak`).

**After the game**
8. Read the file the game saved with our reader. Pass: it reads without error, the footer is valid, the
   revision is the candidate's revision + 1, and name, dimensions, mode and evil are unchanged.
9. Record per fixture: tool report (step 3), game version (step 1), pass/fail for steps 5, 6 and 8, the writer
   commit and the passing `bash scripts/verify.sh` run. Screenshots with game graphics and any `.wld` stay out
   of git.

**Failure behaviour.** A world that does not load, shows a corruption warning, or differs in step 6 or 8 fails
the check. Keep the backup, the candidate and the game's files, record the exact message, and report it on #45;
M2 is not done, and golden files or expectations are **not** changed to hide it. Until every fixture passes,
the status stays "structurally verified, not game-verified".

**Scope of a pass.** A pass covers unchanged saves of these five worlds in 1.4.5.8 only. It says nothing about
edited worlds, other game versions or modded worlds, and nothing about records the fixtures do not contain (see
[file-format/open-questions.md](file-format/open-questions.md), questions 10 and 11).
