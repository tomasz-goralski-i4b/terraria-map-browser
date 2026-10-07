namespace Terraria.WorldCodec;

/// <summary>A tile cannot be written in format 326 (docs/file-format/writer.md, <c>UnencodableTile</c>).</summary>
public sealed class TileEncodingException(int x, int y, string reason)
    : Exception($"UnencodableTile at ({x}, {y}): {reason}")
{
    /// <summary>Column of the offending tile.</summary>
    public int X { get; } = x;

    /// <summary>Row of the offending tile.</summary>
    public int Y { get; } = y;

    /// <summary>Human-readable diagnostic.</summary>
    public string Reason { get; } = reason;
}
