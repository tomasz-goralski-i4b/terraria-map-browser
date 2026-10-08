using System.Globalization;

namespace Terraria.WorldCodec;

/// <summary>Read-only grid of tiles; <c>x</c> = column (0 = left), <c>y</c> = row (0 = top).</summary>
public sealed class TileGrid
{
    // Column-major, like the file: all of column 0, then column 1, …
    private readonly Tile[] tiles;

    internal TileGrid(int width, int height, Tile[] tiles)
    {
        Width = width;
        Height = height;
        this.tiles = tiles;
    }

    public int Width { get; }

    public int Height { get; }

    /// <exception cref="ArgumentOutOfRangeException">The coordinates are outside the grid.</exception>
    public Tile this[int x, int y]
    {
        get
        {
            if ((uint)x >= (uint)Width)
            {
                throw new ArgumentOutOfRangeException(nameof(x), x, string.Create(CultureInfo.InvariantCulture, $"x must be in 0..{Width - 1}"));
            }

            if ((uint)y >= (uint)Height)
            {
                throw new ArgumentOutOfRangeException(nameof(y), y, string.Create(CultureInfo.InvariantCulture, $"y must be in 0..{Height - 1}"));
            }

            return tiles[(x * Height) + y];
        }
    }
}

/// <summary>A section omitted from the v1 tile/metadata summary; its boundary also identifies opaque save bytes.</summary>
/// <param name="Name">Section name, as the property name in <see cref="WorldSectionTable"/>.</param>
/// <param name="Boundary">Position from the section table.</param>
public sealed record SkippedSection(string Name, WorldSectionBoundary Boundary);

/// <summary>A read-only world with tiles and independently decoded entity sections.</summary>
public sealed record World(
    WorldFileHeader Header,
    WorldMetadata Metadata,
    TileGrid Tiles,
    IReadOnlyList<SkippedSection> SkippedSections)
{
    /// <summary>Independent read-only entity results; legacy summary section boundaries remain unchanged.</summary>
    public IReadOnlyList<WorldEntitySection> Entities { get; init; } = [];
}
