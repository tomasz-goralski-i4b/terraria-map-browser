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

    private const int TrailingColumns = 6;

    private static readonly Tile Stone = new() { Block = new VanillaContentRef(1) };
    private static readonly Tile Water = new() { Liquid = new TileLiquid(LiquidKind.Water, 255) };
    private static readonly Tile Torch = new() { Block = new VanillaContentRef(4), FrameX = 66, FrameY = 22 };

    private WindowBoundaryTileSection(byte[] bytes, Tile[] columns, int crossingColumn, int crossingRecordOffset)
    {
        Bytes = bytes;
        Columns = columns;
        CrossingColumn = crossingColumn;
        CrossingRecordOffset = crossingRecordOffset;
    }

    /// <summary>Tile-section bytes.</summary>
    public byte[] Bytes { get; }

    /// <summary>The single tile every column repeats; the grid width is its length.</summary>
    public Tile[] Columns { get; }

    /// <summary>Column whose (only) record holds the crossing field; that record starts at y = 0.</summary>
    public int CrossingColumn { get; }

    /// <summary>Section-relative offset of the record holding the crossing field.</summary>
    public int CrossingRecordOffset { get; }

    public int Width => Columns.Length;

    public static WindowBoundaryTileSection Build(CrossingField field)
    {
        var (record, tile, fieldOffset) = field switch
        {
            CrossingField.WideBlockId => (Hex("62 04 00 42 00 16 00 0f"), Torch, 1),
            CrossingField.FrameX => (Hex("42 04 42 00 16 00 0f"), Torch, 2),
            CrossingField.FrameY => (Hex("42 04 42 00 16 00 0f"), Torch, 4),
            CrossingField.Int16Run => (Hex("88 ff 0f 00"), Water, 2),
            _ => throw new ArgumentOutOfRangeException(nameof(field)),
        };

        // Whole columns before the crossing record: 3-byte stone columns plus 0–2 four-byte water columns
        // (Int16 run) so that the prefix length is exact.
        var recordOffset = Window - 1 - fieldOffset;
        var waterColumns = recordOffset % 3;
        var stoneColumns = (recordOffset - (4 * waterColumns)) / 3;
        var bytes = new List<byte>();
        var columns = new List<Tile>();
        for (var index = 0; index < waterColumns + stoneColumns; index++)
        {
            var water = index < waterColumns;
            bytes.AddRange(water ? Hex("88 ff 0f 00") : Hex("42 01 0f"));
            columns.Add(water ? Water : Stone);
        }

        if (bytes.Count != recordOffset)
        {
            throw new InvalidOperationException($"prefix is {bytes.Count} bytes, expected {recordOffset}");
        }

        var crossingColumn = columns.Count;
        bytes.AddRange(record);
        columns.Add(tile);
        for (var index = 0; index < TrailingColumns; index++)
        {
            var (trailing, trailingTile) = (index % 3) switch
            {
                0 => (Hex("48 ff 0f"), Water),
                1 => (Hex("42 04 42 00 16 00 0f"), Torch),
                _ => (Hex("42 01 0f"), Stone),
            };
            bytes.AddRange(trailing);
            columns.Add(trailingTile);
        }

        return new WindowBoundaryTileSection([.. bytes], [.. columns], crossingColumn, recordOffset);
    }

    /// <summary>Hex digits, spaces allowed for readability.</summary>
    private static byte[] Hex(string hex) => Convert.FromHexString(hex.Replace(" ", string.Empty, StringComparison.Ordinal));
}
