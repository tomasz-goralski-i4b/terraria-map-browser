namespace Terraria.WorldCodec;

/// <summary>Reference to a block or wall type (docs/architecture.md, "World model").</summary>
public abstract record ContentRef;

/// <summary>A vanilla type, identified by its id for the format version.</summary>
public sealed record VanillaContentRef(int Id) : ContentRef;

/// <summary>A mod type, identified by mod and internal name; the runtime id depends on the loaded mods.</summary>
public sealed record ModContentRef(string Mod, string InternalName, int? RuntimeId, string? ModVersion) : ContentRef;

/// <summary>A type outside the vanilla range whose origin is not known; only the runtime id is kept.</summary>
public sealed record UnknownContentRef(int RuntimeId) : ContentRef;
