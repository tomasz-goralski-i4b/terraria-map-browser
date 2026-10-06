namespace Terraria.WorldCodec;

/// <summary>
/// Canonical World Model v1 (docs/cwm.md): one little-endian plane per tile field, column-major
/// (index = <c>x * height + y</c>), plus a <see cref="ContentRef"/> palette shared by blocks and walls.
/// </summary>
public sealed class CanonicalWorldModel
{
    /// <summary>Plane names in their canonical order.</summary>
    public static IReadOnlyList<string> PlaneNames { get; } =
        ["block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags"];

    private CanonicalWorldModel()
    {
    }

    public int Width => throw new NotImplementedException();

    public int Height => throw new NotImplementedException();

    /// <summary>Distinct content in order of first appearance in a column-major scan (block before wall).</summary>
    public IReadOnlyList<ContentRef> Palette => throw new NotImplementedException();

    /// <summary>Bytes of one element of the named plane (1 or 2).</summary>
    /// <exception cref="ArgumentException">The name is not one of <see cref="PlaneNames"/>.</exception>
    public static int ElementSize(string plane) => throw new NotImplementedException();

    /// <summary>The whole plane as little-endian bytes, column-major.</summary>
    /// <exception cref="ArgumentException">The name is not one of <see cref="PlaneNames"/>.</exception>
    public ReadOnlyMemory<byte> GetPlane(string plane) => throw new NotImplementedException();

    public static CanonicalWorldModel FromTileGrid(TileGrid tiles) => throw new NotImplementedException();
}
