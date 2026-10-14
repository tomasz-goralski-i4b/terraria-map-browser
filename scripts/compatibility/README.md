# Independent codec compatibility

After `bash scripts/build.sh`, run:

```bash
node scripts/compatibility/cwm.mjs
node scripts/compatibility/writer.mjs
node scripts/compatibility/writer.mjs --corruption-probe
```

The always-run `cwm-compatibility` CI job runs all three commands. The first compares reader exports;
the second requires every manifest fixture to pass these writer checks:

- The unchanged TS save equals the independently written .NET `roundtrip` output byte for byte.
- .NET reads the unchanged TS save and exports exactly the TS CWM captured before saving.
- TS toggles the red wire at `(129,128)` (clamped for smaller worlds), captures the edited CWM before
  saving, and .NET reads the edited save to exactly that CWM.
- The .NET edited CWM differs from the original only by that wire bit at the chosen coordinate.

The wire edit leaves the first-appearance palette unchanged, so complete CWM byte comparisons prove
the scope without normalizing away other changes. Expected CWM files are never obtained by rereading
TS output. The .NET process receives only `.wld` inputs; neither runtime codec calls the other.
The harness imports the existing built TS API, without changing any TS codec source.

The corruption probe flips one byte inside the first unchanged tile payload and succeeds only when the
normal world-byte comparator rejects it with the fixture name and exact first differing byte offset.
An unsupported format, missing output, process failure, or an unexpectedly passing comparison fails
the probe. This is an automated negative control, not a skipped or allowed-failure job.

Writer artifacts use fresh ignored `.tdd/cwm-writer-*` directories. `report.txt` contains bounded fixture,
coordinate and byte-offset diagnostics; failure uploads include reports only, never world grids or assets.
Both differential commands accept `<fixture-directory> <new-artifact-directory>`; selected artifacts must
be inside `.tdd` or the system temporary directory, and existing directories are rejected. Sources and
goldens remain untouched. Any absent expected output fails immediately rather than skipping a fixture.

The current manifest supplies five generated format-326 worlds, supported by both implementations.
This proof does not imply .NET support for other TS-admitted formats, or cover modded worlds, metadata
edits, entity edits, or in-game loading. New manifest formats must be independently supported by .NET;
the job fails until that support exists. Branch protection must select `cwm-compatibility` as a required
check (repository settings, not workflow YAML).

Contracts: [CWM binary framing](../../docs/cwm.md),
[writer layout evidence](../../docs/file-format/writer.md#evidence-original-vs-candidate-layout).
