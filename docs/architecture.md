# Terraria Map Studio — project plan and Personal Software Factory experiment

## Goal

Build a local, browser-installable Terraria world editor. The user opens their own `.wld` file, points to Terraria assets and optional mod assets locally, edits the map, and then saves a new copy of the world.

The project is also a controlled Personal Software Factory experiment:

```text
issue → agent → separate worktree → draft PR → independent review → human merge → optional preview deploy
```

The repository and test data must be independent of company code and the company GitLab. We do not copy Terraria assets, player worlds, or commercial mods into it.

## Technical assumptions

- Monorepo: TypeScript + pnpm.
- Reference format parser: .NET.
- Target editor: TypeScript, PWA, browser.
- Local data: SQLite WASM in OPFS.
- Code hosting: Cloudflare Pages/Workers.
- Game and mod assets: local, on the user's side.
- To start, we only use the company Claude Code and Codex licenses.
- Other harnesses are tested only in a dedicated VM/user account, without access to company repositories, secrets, or Docker.

## Why .NET before TypeScript

`.wld` is a binary, versioned format with many sections and a compact tile encoding. The reference .NET codec comes first, because its behavior is easy to compare with existing TEdit code and tModLoader structures.

We do not port the .NET application to TypeScript. We carry over:

1. an explicitly documented format specification;
2. an independent world model;
3. golden fixtures;
4. `read → write → read` tests;
5. expected differences between format versions.

TypeScript implements the same contract independently. This way the web parser is not a hidden port of incidental C# code.

## Repository architecture

```text
terraria-map-studio/
├── apps/
│   ├── web/                         # PWA: React/Vite + renderer WebGL
│   └── inspector-cli/               # TS tool for inspecting worlds
├── packages/
│   ├── world-model/                 # format-independent domain model
│   ├── world-codec/                 # .wld parser and writer in TS
│   ├── mod-registry/                # mod registry, manifests and ID mapping
│   ├── asset-index/                 # index of local assets and atlases
│   ├── renderer/                    # world chunk rendering
│   ├── local-store/                 # SQLite WASM/OPFS
│   └── test-fixtures/               # explicitly generated fixtures and manifests
├── dotnet/
│   ├── Terraria.WorldCodec/         # reference parser/writer
│   ├── Terraria.WorldInspector/     # CLI: inspect, diff, export JSON
│   ├── Terraria.ModExporter/        # mod manifest export
│   ├── Terraria.WorldCodec.Synthetic/  # generated test inputs, never shipped
│   └── Terraria.WorldCodec.Tests/
├── docs/
│   ├── architecture.md
│   ├── file-format.md           # index → file-format/*.md (one file per section family)
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

## World model

The domain model cannot store only a numeric `tileId`, because a mod's runtime ID depends on the set of installed mods.

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

On import we store the runtime ID and, when the data is available, the stable `mod/internalName` identifier. On export we resolve the identifier against the current mod configuration.

> **Storage vs. semantics** ([ADR 0001](adr/0001-dotnet-ts-contract.md)): `ContentRef` and `Tile` above are the
> *semantic* model and the shape of tests and UI views. At runtime a world is stored as the Canonical World Model —
> one typed array per tile field (struct of arrays) plus a `ContentRef` palette — never one object per tile.
> The .NET and TS codecs never talk at runtime; they meet through the contracts in `contracts/`, checked in CI.

## Mod support

"Mod support" is not a single checkbox. Every feature and every mod gets a compatibility level.

| Level | Meaning |
|---|---|
| `Preserve` | A world with unknown data can be opened and saved without removing that data. |
| `Validate` | The editor detects required mods and version mismatches. |
| `Render` | The editor renders static tiles/walls from the provided assets. |
| `Edit` | The user can place and remove recognized tiles/walls. |
| `Gameplay` | The editor understands custom framing, tile entities, and mod logic. |

MVP scope:

```text
Vanilla:       Render + Edit
Modded world:  Preserve + Validate
Selected mods: Render
```

`Gameplay` is not a goal of the general MVP. Mod code can define behavior rules, framing, and entity data arbitrarily; the browser should not attempt to execute compiled mod code.

### Mod Export Pack

Instead of assuming that a `.tmod` parser can universally infer mod semantics, we create an intermediate format generated by a CLI or a companion mod:

```text
mod-export/
├── manifest.json
├── tiles.json
├── walls.json
├── objects.json
└── textures/
```

The manifest contains the mod name, version, mapping of stable names to runtime IDs, sprite dimensions, framing rules supported by the editor, and asset hashes.

## Assets and local operation

A PWA hosted on Cloudflare does not get automatic access to the user's disk. The user selects a folder via the File System Access API:

```ts
const terrariaFolder = await window.showDirectoryPicker({
  mode: "read",
  id: "terraria-content",
});
```

The browser requires HTTPS and a direct user action. The application cannot open `C:\\Program Files\\...` on its own or scan the disk.

Interface:

```text
[ Open .wld world ]
[ Connect Terraria assets ]
[ Add Mod Export Pack ]
[ Save world copy ]
```

Fallback for browsers without folder picking:

```text
- .wld file import;
- ZIP import with assets/mod export pack;
- export via file download.
```

Terraria and mod assets stay local. They do not end up in the repository, D1, or R2 without an explicit user action.

Texture format (XNB/LZX), sprite layout and the asset test strategy: [assets.md](assets.md).

## PWA and local SQLite

A PWA provides an icon, a separate window, offline cache, and an experience close to a desktop application. We use a fixed production domain, e.g. `mapstudio.example.com`; browser storage is tied to the origin, so a Cloudflare preview URL is not a place for persistent work.

Local storage model:

```text
Browser
├── SQLite WASM + OPFS
│   ├── asset registry
│   ├── mod registry
│   ├── edit history
│   ├── recently opened worlds
│   └── undo/redo metadata
└── OPFS files
    ├── texture atlas cache
    ├── generated sprite maps
    └── world snapshots
```

SQLite holds the index and relations; PNGs, tilesheets, and atlases should be files/blobs in OPFS, not Base64 in tables.

Example tables:

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

The MVP does not need a backend:

```text
Cloudflare Pages → static PWA editor
Local browser    → .wld + assets + mod pack + SQLite + cache
```

Once things stabilize, sync can be added:

```text
Cloudflare D1 → accounts, projects, versions, metadata
Cloudflare R2 → optional .wld backups, exports, manifests
```

D1 is not used to store assets. R2 is for binary objects, D1 for metadata.

## Milestones

### M0 — foundation

**Goal:** an agent-friendly repo and repeatable work on PRs.

- Monorepo, pnpm, .NET solution, and CI.
- `AGENTS.md`, `CLAUDE.md`, `WORKFLOW.md`, architecture description.
- GitHub Issues/Project as the source of state.
- PR template with sections: scope, tests, compatibility, risk.
- Cezar with natively logged-in Codex and Claude Code.

**Done:** a test issue goes through worktree, draft PR, CI, and review.

### M1 — .NET world inspector

**Goal:** understand the format without a UI.

- `.wld` version detection.
- Reading world metadata and dimensions.
- Reading tile sections into the domain model.
- CLI `inspect`, `export-json`, `diff`.
- Fixtures: explicitly generated small vanilla worlds.

**Done:** `inspect` reports on the world, and the JSON has a stable test snapshot.

### M2 — round-trip safety

**Goal:** do not corrupt a world absent user changes.

- `.wld` writer in .NET.
- `load → save → load` test that semantically compares all fields.
- Backup before every save operation.
- Test opening the saved world in a pinned Terraria version.

**Done:** a world after round-trip opens in the game and has an identical semantic model.

### M3 — TypeScript codec

**Goal:** an independent TS codec consistent with the .NET reference.

- TS parser for the M1/M2 fixtures.
- Shared `world-model`.
- Comparison of JSON exported from .NET and TS.
- TS writer for a limited vanilla subset.

**Done:** the .NET and TS parsers produce identical results for the test corpus.

### M4 — browser viewer

**Goal:** open a world locally in the PWA.

- PWA with offline cache.
- `.wld` import via file picker.
- Pan, zoom, layer switch, and tile inspector.
- Chunk renderer, initially `128 × 128` tiles.
- Local import of an asset folder or ZIP.

**Done:** the user opens a small vanilla world and views it smoothly.

### M5 — vanilla editor

**Goal:** the first useful editing.

- Single-tile brush and rectangular selection.
- Undo/redo.
- Changing selected vanilla tiles/walls.
- Exporting a new `.wld` copy.

**Done:** the user changes an area of the world, saves a copy, and opens it in Terraria.

### M6 — mod safety

**Goal:** safely avoid destroying modded world data.

- Registry of required mods and versions.
- `unknown` content reference.
- Preserving unrecognized IDs on read/write.
- UI with a "missing asset pack" warning and a placeholder.

**Done:** a modded world can be opened and saved without losing unrecognized data.

### M7 — Mod Export Pack

**Goal:** render one controlled mod.

- Manifest definition.
- .NET CLI or companion mod generating the manifest.
- Manifest and texture import on the web.
- Rendering of one static custom tile.

**Done:** a test modded tile is visible in the browser and is preserved after world export.

### M8 — preview deploy and sync (optional)

**Goal:** make the application available without uploading game assets.

- Cloudflare Pages.
- Fixed PWA domain.
- Optionally an account, D1 metadata, R2 backups of the user's own exports.
- No automatic upload of Terraria/mod assets.

**Done:** the application runs from Cloudflare while keeping the local-first model.

## Order of work

```text
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8
```

We do not start with the UI or mods. First comes a trusted codec, then the viewer, then editing, and mod support is an extension of the compatibility contract.

## Delegating to agents

### Roles

| Role | Responsibility | Default runtime |
|---|---|---|
| Implementer codec | parser, writer, binary tests | Codex or Claude Code |
| Fixture/documentation engineer | fixtures, format description, test vectors | the other provider |
| Web implementer | PWA, renderer, UX | Codex or Claude Code |
| Reviewer | fresh review of the diff and tests | a provider other than the implementer's |
| Human integrator | scope decisions, merge, in-game test | human |

### Delegation rules

1. One agent owns one area of files at a given time.
2. The codec and binary writing are not changed in parallel by two workers.
3. Every task runs in a separate worktree.
4. The implementer always finishes with a draft PR.
5. The reviewer does not approve their own code.
6. Initially the reviewer only reports; fixes are made by the implementer via a `Rework` task.
7. Human merge only after green CI and an independent review.

### Provider routing

```text
Codex implements → Claude reviews
Claude implements → Codex reviews
```

For especially risky format changes, the reviewer gets a fresh worktree on the PR branch and runs:

```text
- codec tests;
- round-trip corpus;
- semantic diff;
- manual test of opening the world in the target game version.
```

## GitHub Project as the control plane

Statuses:

```text
Todo → Agent Ready → In Progress → PR Ready → Agent Review
→ Human Review → Done

                         ↘ Rework ↗
```

The issue is the unit of work. We do not keep sprint state only in the agent's memory.

Minimal labels:

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

## Issue template

```md
## Goal
One sentence describing the outcome for the user.

## Scope
- ...

## Out of scope
- ...

## Ownership
- Files/modules the agent may change.

## Compatibility impact
- Vanilla: None / Render / Edit
- Modded worlds: None / Preserve / Validate / Render / Edit

## Acceptance criteria
- ...

## Proof
- Fixture:
- Test command:
- Manual test:

## Definition of Done
- [ ] Tests pass
- [ ] Documentation updated
- [ ] Draft PR created
- [ ] Independent review completed
```

## Implementer instruction template

```md
You are working on issue #<id> in the assigned worktree.

1. Read the issue, AGENTS.md, and the relevant docs/.
2. Do not expand the scope without describing it in the PR.
3. Change only files consistent with the Ownership section.
4. Add a test when you change the behavior of the parser, writer, or renderer.
5. Run the commands from the Proof section.
6. Create a draft PR describing: changes, tests, compatibility impact, risks.
7. Do not merge the PR.
```

## Reviewer instruction template

```md
Review PR #<id> in a fresh worktree.

Check:
- consistency with the issue and no scope expansion;
- format and round-trip regressions;
- fixture quality;
- handling of unknown modded IDs;
- test coverage;
- whether the compatibility description matches the code.

Finish with one of: APPROVE, REQUEST_CHANGES, BLOCKED.
Do not change code unless the issue explicitly requests review + fix.
```

## Cezar, Multica, and Symphony

### Cezar — starting the experiment

The best first runner for the project:

- runs natively logged-in Claude Code and Codex;
- provides a separate Git worktree per task;
- keeps local state in `.ai/cezar/`;
- supports workflows and draft PRs;
- does not require an additional backend right away.

### Multica — later, as a shared agent office

It makes sense when there is a need for:

- a shared board;
- an agent daemon;
- work history and comments;
- multiple runtimes and multiple people.

It is not the first step, because it requires heavier infrastructure than a POC.

### Symphony — the target pattern

We apply the Symphony idea:

```text
Every active ticket has an isolated workspace and an agent
that runs until a workflow-defined handoff.
```

We do not need to use the Symphony reference implementation right away. GitHub Project + Cezar can implement the same pattern for the initial POC.

## Minimal CI

```text
pnpm lint
pnpm test
pnpm build
dotnet test
```

After M2, add:

```text
dotnet run --project dotnet/Terraria.WorldInspector -- roundtrip fixtures/
pnpm --filter @studio/world-codec test:compatibility
```

After M5, add an end-to-end test of world import, editing, and copy export.

## Personal Software Factory experiment metrics

For each issue we measure:

- time from `Agent Ready → draft PR`;
- number of human interventions;
- first CI result;
- number of review/rework cycles;
- result of the manual in-game test;
- provider used;
- cause of failure, if any.

After a week we compare not "which agent is better", but:

```text
- which task types are delegable;
- where documentation is missing in the repo;
- which tests give agents the most autonomy;
- which gates must be left to a human;
- whether Cezar is enough, or a Multica board/daemon is needed.
```

## Reference sources

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
