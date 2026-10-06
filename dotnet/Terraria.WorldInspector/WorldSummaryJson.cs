using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>A rectangle of tiles: top-left corner and size.</summary>
public sealed record TileRegion(int X, int Y, int Width, int Height);

/// <summary>
/// Writes the world summary with chunk digests (contracts/schemas/world-summary.v1.schema.json, docs/cwm.md):
/// UTF-8, LF, fixed property order, one trailing newline, independent of culture and environment.
/// </summary>
public static class WorldSummaryJson
{
    public const int ChunkSize = 128;

    /// <summary>Largest width and height of a <see cref="TileRegion"/>.</summary>
    public const int MaxRegionSize = 256;

    /// <exception cref="ArgumentOutOfRangeException">
    /// The region is empty, not fully inside the world, or larger than <see cref="MaxRegionSize"/> in either direction.
    /// </exception>
    public static void Write(World world, Stream output, TileRegion? region = null) => throw new NotImplementedException();
}
