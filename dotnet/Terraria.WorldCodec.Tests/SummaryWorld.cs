using System.Buffers.Binary;
using System.Globalization;
using System.Text;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// Synthetic worlds for the CWM conversion and <c>export-json</c> (docs/cwm.md). The snapshot world is 130 × 129, so
/// it has 2 × 2 chunks with a 2-wide right edge and a 1-high bottom edge. Its tiles (x, y), column hex per column:
/// <list type="bullet">
/// <item>(0, 0) block vanilla 1 → palette 0.</item>
/// <item>(1, 0) wall vanilla 1 → shares palette 0 with the block.</item>
/// <item>(2, 3) block 2 + wall 2 (palette 1), green wire, half block.</item>
/// <item>(64, 126..128) honey 255 — a run across the chunk-row boundary.</item>
/// <item>(127, 0) shimmer 16, nothing else — last column of chunk x 0.</item>
/// <item>(128, 5) unknown block 800 (palette 2), unknown wall 500 (palette 3), wall paint 7, lava 64,
/// slope bottom-left, blue + yellow wire, inactive, invisible wall, full-bright block.</item>
/// <item>(129, 128) torch block 4 (palette 4, frame-important) frame 18/44, paint 3, water 200, red wire,
/// actuator, invisible block, full-bright block — the 2 × 1 corner chunk.</item>
/// </list>
/// Every other tile is empty. <c>k = 1000</c> so ids up to 999 are legal; only 4 and 5 are frame-important.
/// </summary>
internal static class SummaryWorld
{
    public const int Width = 130;
    public const int Height = 129;
    public const short FrameCount = 1000;
    public const string SnapshotFile = "export-json-130x129.json";

    public static IReadOnlyDictionary<int, string> SnapshotColumns { get; } = new Dictionary<int, string>
    {
        [0] = "02 01 40 7f",
        [1] = "04 01 40 7f",
        [2] = "40 02 07 18 02 02 40 7c",
        [64] = "40 7d 58 ff 02",
        [127] = "09 01 80 10 40 7f",
        [128] = "40 04 37 55 75 0c 20 03 f4 07 40 01 40 7a",
        [129] = "40 7f 0b 03 0b 0a 04 12 00 2c 00 03 c8",
    };

    /// <summary>The snapshot world as a <c>.wld</c> file.</summary>
    public static byte[] Snapshot(SyntheticMetadata? metadata = null) => Build(Width, Height, SnapshotColumns, metadata);

    /// <summary>The snapshot world with some columns replaced.</summary>
    public static byte[] SnapshotWith(IReadOnlyDictionary<int, string> replacedColumns)
    {
        var columns = new Dictionary<int, string>(SnapshotColumns);
        foreach (var (x, hex) in replacedColumns)
        {
            columns[x] = hex;
        }

        return Build(Width, Height, columns);
    }

    /// <summary>A world of the given size; columns not listed are empty (one Int16 run per column).</summary>
    public static byte[] Build(int width, int height, IReadOnlyDictionary<int, string>? columns = null, SyntheticMetadata? metadata = null)
    {
        var empty = EmptyColumn(height);
        using var tiles = new MemoryStream();
        for (var x = 0; x < width; x++)
        {
            tiles.Write(columns is not null && columns.TryGetValue(x, out var hex) ? TileAssert.Hex(hex) : empty);
        }

        var source = metadata ?? new SyntheticMetadata { Width = width, Height = height };
        return SyntheticTileWorld.Build(width, height, tiles.ToArray(), frameCount: FrameCount, metadataSource: source).File;
    }

    /// <summary>One empty record repeated over a whole column.</summary>
    public static byte[] EmptyColumn(int height)
    {
        var record = new byte[3];
        record[0] = 0x80;
        BinaryPrimitives.WriteInt16LittleEndian(record.AsSpan(1), checked((short)(height - 1)));
        return record;
    }

    /// <summary>The CWM planes of the snapshot world, built independently of the codec (docs/cwm.md).</summary>
    public static IReadOnlyDictionary<string, byte[]> ExpectedSnapshotPlanes()
    {
        var block = Filled<ushort>(0xFFFF);
        var wall = Filled<ushort>(0xFFFF);
        var frameX = Filled<short>(-1);
        var frameY = Filled<short>(-1);
        var paint = new byte[Width * Height];
        var wallPaint = new byte[Width * Height];
        var liquid = new byte[Width * Height];
        var liquidAmount = new byte[Width * Height];
        var shape = new byte[Width * Height];
        var flags = new ushort[Width * Height];

        block[Index(0, 0)] = 0;
        wall[Index(1, 0)] = 0;

        block[Index(2, 3)] = 1;
        wall[Index(2, 3)] = 1;
        flags[Index(2, 3)] = 4; // green
        shape[Index(2, 3)] = 1; // half

        for (var y = 126; y <= 128; y++)
        {
            liquid[Index(64, y)] = 3; // honey
            liquidAmount[Index(64, y)] = 255;
        }

        liquid[Index(127, 0)] = 4; // shimmer
        liquidAmount[Index(127, 0)] = 16;

        block[Index(128, 5)] = 2;
        wall[Index(128, 5)] = 3;
        wallPaint[Index(128, 5)] = 7;
        liquid[Index(128, 5)] = 2; // lava
        liquidAmount[Index(128, 5)] = 64;
        shape[Index(128, 5)] = 5; // slope bottom-left
        flags[Index(128, 5)] = 2 | 8 | 32 | 128 | 256; // blue, yellow, inactive, invisible wall, full-bright block

        block[Index(129, 128)] = 4;
        frameX[Index(129, 128)] = 18;
        frameY[Index(129, 128)] = 44;
        paint[Index(129, 128)] = 3;
        liquid[Index(129, 128)] = 1; // water
        liquidAmount[Index(129, 128)] = 200;
        flags[Index(129, 128)] = 1 | 16 | 64 | 256; // red, actuator, invisible block, full-bright block

        return new Dictionary<string, byte[]>
        {
            ["block"] = LittleEndian(block),
            ["wall"] = LittleEndian(wall),
            ["frameX"] = LittleEndian(frameX),
            ["frameY"] = LittleEndian(frameY),
            ["paint"] = paint,
            ["wallPaint"] = wallPaint,
            ["liquid"] = liquid,
            ["liquidAmount"] = liquidAmount,
            ["shape"] = shape,
            ["flags"] = LittleEndian(flags),
        };
    }

    /// <summary>
    /// Chunk digests computed from whole planes (docs/cwm.md, "Chunks and digests"), keyed "cx,cy/plane".
    /// </summary>
    public static IReadOnlyDictionary<string, string> Digests(IReadOnlyDictionary<string, byte[]> planes, int width, int height)
    {
        var digests = new Dictionary<string, string>();
        foreach (var (name, bytes) in planes)
        {
            var elementSize = bytes.Length / (width * height);
            for (var cx = 0; cx * 128 < width; cx++)
            {
                for (var cy = 0; cy * 128 < height; cy++)
                {
                    using var chunk = new MemoryStream();
                    for (var x = cx * 128; x < Math.Min(width, (cx + 1) * 128); x++)
                    {
                        var start = ((x * height) + (cy * 128)) * elementSize;
                        var length = (Math.Min(height, (cy + 1) * 128) - (cy * 128)) * elementSize;
                        chunk.Write(bytes, start, length);
                    }

                    var hash = System.Security.Cryptography.SHA256.HashData(chunk.ToArray());
                    digests[string.Create(CultureInfo.InvariantCulture, $"{cx},{cy}/{name}")] =
                        Convert.ToHexStringLower(hash)[..16];
                }
            }
        }

        return digests;
    }

    public static int Index(int x, int y) => (x * Height) + y;

    private static T[] Filled<T>(T value)
    {
        var array = new T[Width * Height];
        Array.Fill(array, value);
        return array;
    }

    private static byte[] LittleEndian(ushort[] values)
    {
        var bytes = new byte[values.Length * 2];
        for (var i = 0; i < values.Length; i++)
        {
            BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(i * 2), values[i]);
        }

        return bytes;
    }

    private static byte[] LittleEndian(short[] values)
    {
        var bytes = new byte[values.Length * 2];
        for (var i = 0; i < values.Length; i++)
        {
            BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(i * 2), values[i]);
        }

        return bytes;
    }

    /// <summary>Text of a UTF-8 document, for assertion messages.</summary>
    public static string Text(byte[] utf8) => Encoding.UTF8.GetString(utf8);
}
