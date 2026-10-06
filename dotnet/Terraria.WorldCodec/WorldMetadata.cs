namespace Terraria.WorldCodec;

/// <summary>Game mode (docs/file-format.md, metadata row 12). Undefined values are kept as read.</summary>
public enum WorldGameMode
{
    Classic = 0,
    Expert = 1,
    Master = 2,
    Journey = 3,
}

/// <summary>World evil biome (docs/file-format.md, metadata row 22).</summary>
public enum WorldEvil
{
    Corruption,
    Crimson,
}

/// <summary>Exposed world metadata (docs/file-format.md, "World metadata"). Historical fields may be absent.</summary>
/// <param name="Name">World name, exactly as decoded from UTF-8.</param>
/// <param name="Seed">Seed text; absent before format 179.</param>
/// <param name="GuidHex">World GUID as 32 lower-case hex digits in file byte order; absent before format 181.</param>
/// <param name="WorldId">World id.</param>
/// <param name="Width">Width in tiles.</param>
/// <param name="Height">Height in tiles.</param>
/// <param name="GameMode">Game mode; absent before format 112.</param>
/// <param name="Evil">Evil biome.</param>
public sealed record WorldMetadata(
    string Name,
    string? Seed,
    string? GuidHex,
    int WorldId,
    int Width,
    int Height,
    WorldGameMode? GameMode,
    WorldEvil Evil);
