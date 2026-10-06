using System.Text.Json;
using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>Compares summaries first, requesting semantic tiles only in differing chunks.</summary>
public static class WorldDiff
{
    /// <summary>
    /// Writes deterministic differences and returns the CLI exit code. Chunk readers return
    /// semantic tiles in column-major order for the requested rectangle.
    /// </summary>
    public static int Write(
        JsonElement leftSummary,
        JsonElement rightSummary,
        Func<TileRegion, IReadOnlyList<Tile>> readLeftChunk,
        Func<TileRegion, IReadOnlyList<Tile>> readRightChunk,
        TextWriter output,
        int maximum = 100) => throw new NotImplementedException();
}
