namespace Terraria.WorldCodec;

/// <summary>
/// Encodes the tile section (docs/file-format/writer.md, "Tile encoding"): column by column, greedy runs that never
/// cross a column.
/// </summary>
internal static class TileSectionWriter
{
    /// <summary>The tile section bytes for <paramref name="tiles"/>.</summary>
    /// <param name="tiles">The grid to encode.</param>
    /// <param name="frameImportant">The file's frame-important bits (W-H3), indexed by block id.</param>
    /// <exception cref="TileEncodingException">A tile cannot be encoded; nothing is returned.</exception>
    public static byte[] Write(TileGrid tiles, IReadOnlyList<bool> frameImportant)
    {
        throw new NotImplementedException();
    }
}
