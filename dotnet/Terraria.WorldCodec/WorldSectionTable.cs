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
    IReadOnlyList<bool> FrameImportant);
