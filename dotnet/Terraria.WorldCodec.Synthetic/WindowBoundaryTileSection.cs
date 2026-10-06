namespace Terraria.WorldCodec.Synthetic;

/// <summary>The multi-byte field that straddles the refill boundary.</summary>
public enum CrossingField
{
    /// <summary>UInt16 block id of a framed torch written with the wide-id flag (non-canonical, docs T17).</summary>
    WideBlockId,

    /// <summary>Int16 frame X of a framed torch.</summary>
    FrameX,

    /// <summary>Int16 frame Y of a framed torch.</summary>
    FrameY,

    /// <summary>Int16 repeat counter of a water record.</summary>
    Int16Run,
}

/// <summary>
/// Builds a synthetic tile section longer than one 4096-byte read window from stone, framed torch and water columns
/// (height <see cref="Height"/>), placing one multi-byte field so its first byte is the last byte of the first
/// window and its second byte the first byte of the next (section offsets 4095 and 4096).
/// </summary>
public sealed class WindowBoundaryTileSection
{
    public const int Height = 16;

    public const int Window = 4096;

    /// <summary>Tile-section bytes.</summary>
    public byte[] Bytes => throw new NotImplementedException();

    /// <summary>The single tile every column repeats; the grid width is its length.</summary>
    public Tile[] Columns => throw new NotImplementedException();

    /// <summary>Column whose (only) record holds the crossing field; that record starts at y = 0.</summary>
    public int CrossingColumn => throw new NotImplementedException();

    /// <summary>Section-relative offset of the record holding the crossing field.</summary>
    public int CrossingRecordOffset => throw new NotImplementedException();

    public int Width => Columns.Length;

    public static WindowBoundaryTileSection Build(CrossingField field) => throw new NotImplementedException();
}
