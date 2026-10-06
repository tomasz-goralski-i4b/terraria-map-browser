namespace Terraria.WorldCodec;

/// <summary>Read-only grid of tiles; <c>x</c> = column (0 = left), <c>y</c> = row (0 = top).</summary>
public sealed class TileGrid
{
    public int Width => throw new NotImplementedException();

    public int Height => throw new NotImplementedException();

    /// <exception cref="ArgumentOutOfRangeException">The coordinates are outside the grid.</exception>
    public Tile this[int x, int y] => throw new NotImplementedException();
}

/// <summary>A section the reader did not parse; only its position is known.</summary>
/// <param name="Name">Section name, as the property name in <see cref="WorldSectionTable"/>.</param>
/// <param name="Boundary">Position from the section table.</param>
public sealed record SkippedSection(string Name, WorldSectionBoundary Boundary);

/// <summary>A world read in M1: header, metadata and tiles; later sections are reported as skipped.</summary>
public sealed record World(
    WorldFileHeader Header,
    WorldMetadata Metadata,
    TileGrid Tiles,
    IReadOnlyList<SkippedSection> SkippedSections);
