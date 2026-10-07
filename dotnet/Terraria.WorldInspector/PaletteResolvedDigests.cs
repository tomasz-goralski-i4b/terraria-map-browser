using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>
/// Block and wall chunk digests computed over palette indices translated to one shared, content-ordered palette,
/// so equal chunks of two worlds whose palettes differ (order or entries) still have equal digests.
/// </summary>
public sealed class PaletteResolvedDigests
{
    private PaletteResolvedDigests()
    {
    }

    /// <summary>Digest of the block and wall planes of <paramref name="region"/> in the left world.</summary>
    public string Left(TileRegion region) => throw new NotImplementedException();

    /// <summary>Digest of the block and wall planes of <paramref name="region"/> in the right world.</summary>
    public string Right(TileRegion region) => throw new NotImplementedException();

    public static PaletteResolvedDigests For(World left, World right) => throw new NotImplementedException();
}
