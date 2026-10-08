# ADR 0003 — Vanilla format profiles

- **Status:** Proposed (2026-10-08)
- **Affects:** `packages/world-codec` (TS reader), `docs/file-format/compatibility.md`; the .NET codec only through
  the residual-shape correction

## Context

The stable codecs accepted only format 326. Terraria releases often share large portions of the binary layout;
duplicating a resolver/reader per number would spread validation and fixes across many nearly identical paths.
Conversely, accepting every integer below the newest known version would infer compatibility without evidence.

Two prototypes explored this: a format-279-only reader for an oversized tModLoader world, and a general
profile resolver. This ADR keeps the resolver and drops the 279-only special cases.

## Decision

Separate admission of known released formats from their structural feature profile. A central definition
stores admitted ranges and the thresholds at which fields/variants appear. One section reader follows that
profile and normalizes results into CWM. Truly different legacy layouts may later get separate family readers.

The TS reader admits 269–279, 315–319 and 325–326. Header layout and tile decoding stay shared; metadata
uses the selected field-presence profile. Entity layout differences are described but not decoded. Unknown
gaps/future versions remain errors. Evidence is explicit per profile: generated-world fixtures for 326,
independent synthetic coverage for the other formats (plus an opt-in local check against real worlds that is
never part of CI).

The reader retains structural validation, correcting the former rejection of defined residual shapes without
active blocks: vanilla's writer can emit them. This correction applies to every admitted version and to the
format-326 .NET reader/writer; see the [observation](../file-format/tiles.md#residual-shapes-are-vanilla-data).
It is not a mod- or version-specific exception.

Read and write capabilities are separate. This decision does not expand .NET or writer version support,
downgrade worlds or interpret mod sidecars. Additional formats remain experimental until an independent .NET
implementation and generated-world differential evidence are available.

## Relationship to ADR 0001

[ADR 0001](0001-dotnet-ts-contract.md) remains in force: no runtime C#↔TS calls and no generated/shared parser
implementation. Format rules and vectors can form a shared contract while each codec independently implements
them. The TS-only admission is documented as viewer scope, not a claim of cross-codec parity.

## Consequences

New releases that reuse a layout need admission/evidence updates rather than another parser. Structural
changes need one feature rule or family variant plus boundary tests. Synthetic fixtures must not import
production profiles, so mistakes in selection are still detectable. Future stable support needs real
fixtures at meaningful structural boundaries; future saving also needs representability/preservation checks.

The detailed matrix, field gates, API, provenance and extension procedure live in
[format compatibility](../file-format/compatibility.md).
