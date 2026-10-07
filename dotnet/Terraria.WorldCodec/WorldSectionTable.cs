namespace Terraria.WorldCodec;

/// <summary>Absolute start and exclusive end offsets of a world section.</summary>
public sealed record WorldSectionBoundary(long Start, long End);

/// <summary>Named section boundaries and tile frame flags for a validated world table.</summary>
public sealed record WorldSectionTable(
    WorldSectionBoundary FileHeader,
    WorldSectionBoundary Metadata,
    WorldSectionBoundary Tiles,
    WorldSectionBoundary Chests,
    WorldSectionBoundary Signs,
    WorldSectionBoundary NpcsAndMobs,
    WorldSectionBoundary TileEntities,
    WorldSectionBoundary WeightedPressurePlates,
    WorldSectionBoundary TownManager,
    WorldSectionBoundary Bestiary,
    WorldSectionBoundary CreativePowers,
    WorldSectionBoundary Footer,
    IReadOnlyList<bool> FrameImportant)
{
    /// <summary>Value equality: boundaries and the frame-important flags, element by element.</summary>
    public bool Equals(WorldSectionTable? other) =>
        other is not null
        && FileHeader == other.FileHeader
        && Metadata == other.Metadata
        && Tiles == other.Tiles
        && Chests == other.Chests
        && Signs == other.Signs
        && NpcsAndMobs == other.NpcsAndMobs
        && TileEntities == other.TileEntities
        && WeightedPressurePlates == other.WeightedPressurePlates
        && TownManager == other.TownManager
        && Bestiary == other.Bestiary
        && CreativePowers == other.CreativePowers
        && Footer == other.Footer
        && FrameImportant.SequenceEqual(other.FrameImportant);

    public override int GetHashCode() =>
        HashCode.Combine(FileHeader, Metadata, Tiles, Chests, Signs, NpcsAndMobs, TileEntities, FrameImportant.Count);
}
