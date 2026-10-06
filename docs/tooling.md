# Tooling

Toolchain decisions and the reasons behind them. Change a version here in the same PR that changes it in the build.

## .NET

| What | Choice | Where |
|---|---|---|
| SDK | .NET 10 (`10.0.100`, `rollForward: latestFeature`) | `global.json` |
| Target framework | `net10.0` | every `.csproj` |
| Solution | `dotnet/TerrariaMapStudio.slnx` (XML solution format) | `scripts/lib.sh` `SLN` |
| Package versions | Central Package Management | `dotnet/Directory.Packages.props` |
| Restores | `packages.lock.json` per project, locked mode in CI | `dotnet/Directory.Build.props`, `scripts/build.sh` |
| Test framework | xUnit v3 `xunit.v3` 4.0.1 | `dotnet/Directory.Packages.props` |
| Test runner | Microsoft.Testing.Platform 2.4.0 (transitive via `xunit.v3.mtp-v2`) | `global.json` `test.runner` |

### Why

- **`.slnx`** — the XML solution format has no GUIDs and no per-configuration platform matrix, so it is a few
  lines long and merges cleanly when parallel agents add projects. Created with `dotnet sln migrate`; the
  `x64`/`x86` platform entries it generated were dropped because every project builds as `Any CPU`.
- **Central Package Management** — one place to bump a version, no drift between projects. `.csproj` files
  carry `<PackageReference Include="…" />` without `Version=`. `CentralPackageTransitivePinningEnabled` lets a
  `PackageVersion` entry also pin a transitive dependency (e.g. for a security fix).
- **Lock files** — `RestorePackagesWithLockFile` writes `packages.lock.json` next to each project; they are
  committed. When `CI=true` (GitHub Actions sets it), `scripts/build.sh` runs `dotnet restore --locked-mode`
  and `Directory.Build.props` sets `RestoreLockedMode`, so CI fails instead of silently resolving something
  different from what was reviewed. Locally, a restore updates the lock file — commit it with the change.
- **`ContinuousIntegrationBuild`** — set when `CI=true`: normalises source paths in PDBs so CI builds are
  reproducible. Together with `Deterministic` it makes CI output independent of the checkout path.
- **xUnit v3 on Microsoft.Testing.Platform** — xUnit v3 test projects are self-hosting executables
  (`OutputType=Exe`); 4.x runs on MTP v2. This replaces `xunit` 2.x, `xunit.runner.visualstudio` and
  `Microsoft.NET.Test.Sdk` (VSTest), which are no longer needed. The .NET 10 SDK only runs MTP projects through
  `dotnet test` in its native MTP mode, enabled by `"test": { "runner": "Microsoft.Testing.Platform" }` in
  `global.json`; the command is therefore `dotnet test --solution <slnx>` (see `scripts/test.sh`).
- **No coverage collector** — `coverlet.collector` was a VSTest data collector and nothing consumed its output.
  It was removed with VSTest; add an MTP coverage extension (e.g. `Microsoft.Testing.Extensions.CodeCoverage`)
  when coverage is actually reported somewhere.
- **Quality rules unchanged** — `TreatWarningsAsErrors`, `Nullable`, `AnalysisLevel=latest-recommended` and
  `EnforceCodeStyleInBuild` stay as they were (`dotnet/Directory.Build.props`).

### Updating a package

1. Change the `Version` in `dotnet/Directory.Packages.props`.
2. `dotnet restore dotnet/TerrariaMapStudio.slnx` — refreshes the `packages.lock.json` files.
3. Update the table above, commit props + lock files together, `bash scripts/verify.sh`.
