# ADR 0003 — Vanilla format profiles (PoC)

- **Status:** Proposed; experimental TS viewer implementation
- **Date:** 2026-10-08
- **Scope:** Independent multi-version vanilla read PoC

## Context

The stable codecs accept only format 326. Terraria releases often share large portions of the binary layout;
duplicating a resolver/reader per number would spread validation and fixes across many nearly identical paths.
Conversely, accepting every integer below the newest known version would infer compatibility without evidence.

## Proposed decision

Separate admission of known released formats from their structural feature profile. A central definition
stores admitted ranges and the thresholds at which fields/variants appear. One section reader follows that
profile and normalizes results into CWM. Truly different legacy layouts may have separate family readers.

The TS prototype admits 269–279, 315–319 and 325–326. Header layout and tile decoding stay shared; metadata
uses the selected field-presence profile. Entity layout differences are described but not decoded. Unknown
gaps/future versions remain errors. Evidence is explicit: real generated-world fixtures for 326, independent
synthetic coverage for additional formats. The reader keeps its existing strict validation.

Read and write capabilities are separate. This prototype does not expand .NET or writer support, downgrade
worlds, interpret mod sidecars or depend on the oversized tModLoader-world PoC. Its additional formats remain
experimental until independent .NET implementation and generated-world differential evidence are available.

## Relationship to ADR 0001

[ADR 0001](0001-dotnet-ts-contract.md) remains in force: no runtime C#↔TS calls and no generated/shared parser
implementation. Format rules and vectors can form a shared contract while each codec independently implements
them. The temporary TS-only admission is documented as PoC scope, not a claim of cross-codec parity.

## Consequences

New releases that reuse a layout need admission/evidence updates rather than another parser. Structural
changes need one feature rule or family variant plus boundary tests. Synthetic fixtures must not import
production profiles, so mistakes in selection are still detectable. Future stable support needs real
fixtures at meaningful structural boundaries; future saving also needs representability/preservation checks.

The detailed matrix, field gates, API, provenance and extension procedure live in
[format compatibility](../file-format/compatibility.md).
