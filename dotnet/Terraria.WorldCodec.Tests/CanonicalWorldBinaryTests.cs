using System.Buffers.Binary;
using System.Globalization;
using System.Text;

namespace Terraria.WorldCodec.Tests;

/// <summary>Independent byte oracle for the CWM v1 framing and plane layout.</summary>
public sealed class CanonicalWorldBinaryTests
{
    [Fact]
    public void Write_TwoByFourWorld_WritesExactHeaderPaletteAndPlanes()
    {
        using var output = new MemoryStream();

        CanonicalWorldBinary.Write(ExampleWorld(), output);

        Assert.True(output.CanWrite);
        Assert.Equal(ExpectedBytes(), output.ToArray());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(-1)]
    public void Write_IncompatibleSchemaVersion_RejectsBeforeWriting(int schemaVersion)
    {
        using var output = new MemoryStream();

        Assert.Throws<ArgumentOutOfRangeException>(() =>
            CanonicalWorldBinary.Write(ExampleWorld(), output, schemaVersion));

        Assert.Empty(output.ToArray());
    }

    [Fact]
    public void Write_EnglishAndPolishCultures_WritesIdenticalBytes()
    {
        Assert.Equal(ExpectedBytes(), WriteUnder("en-US", ExampleWorld()));
        Assert.Equal(ExpectedBytes(), WriteUnder("pl-PL", ExampleWorld()));
    }

    internal static byte[] WriteUnder(string culture, World world)
    {
        var previous = CultureInfo.CurrentCulture;
        var previousUi = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(culture);
            using var output = new MemoryStream();
            CanonicalWorldBinary.Write(world, output);
            return output.ToArray();
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
            CultureInfo.CurrentUICulture = previousUi;
        }
    }

    private static World ExampleWorld()
    {
        var source = SyntheticTileWorld.Read(SummaryWorld.Build(2, 4));
        var tiles = new TileGrid(2, 4,
        [
            new Tile { Block = new VanillaContentRef(1), Wall = new VanillaContentRef(1) },
            new Tile
            {
                Block = new VanillaContentRef(4), Wall = new UnknownContentRef(500),
                FrameX = short.MinValue, FrameY = short.MaxValue, Paint = 255, WallPaint = 7,
                Liquid = new TileLiquid(LiquidKind.Water, 0), Shape = BlockShape.Half,
                Wires = TileWires.Red | TileWires.Blue | TileWires.Green | TileWires.Yellow,
                Actuator = true, Inactive = true, InvisibleBlock = true, InvisibleWall = true,
                FullBrightBlock = true, FullBrightWall = true,
            },
            new Tile
            {
                Block = new UnknownContentRef(800), Wall = new VanillaContentRef(1),
                FrameX = -18, FrameY = -44, Liquid = new TileLiquid(LiquidKind.Lava, 64),
                Shape = BlockShape.SlopeTopRight, Wires = TileWires.Blue,
            },
            new Tile { Liquid = new TileLiquid(LiquidKind.Honey, 255) },
            new Tile
            {
                Block = new VanillaContentRef(1), Wall = new VanillaContentRef(2),
                FrameX = 18, FrameY = 44, Paint = 3, Liquid = new TileLiquid(LiquidKind.Shimmer, 16),
                Shape = BlockShape.SlopeTopLeft, Wires = TileWires.Green,
            },
            new Tile { Block = new VanillaContentRef(2), Shape = BlockShape.SlopeBottomRight, Wires = TileWires.Yellow },
            new Tile { Shape = BlockShape.SlopeBottomLeft, Actuator = true },
            new Tile { Inactive = true },
        ]);
        return source with
        {
            Tiles = tiles,
            Metadata = new WorldMetadata("Forêt 海岸", "948580918", "00112233445566778899aabbccddeeff", 948580918,
                2, 4, WorldGameMode.Expert, WorldEvil.Corruption),
        };
    }

    internal static byte[] ExpectedBytes()
    {
        const string Header = """
            {"schemaVersion":1,"formatVersion":326,"metadata":{"name":"Forêt 海岸","seed":"948580918","guid":"00112233445566778899aabbccddeeff","worldId":948580918,"gameMode":1,"evil":"corruption"},"dimensions":{"width":2,"height":4},"palette":[{"kind":"vanilla","id":1},{"kind":"vanilla","id":4},{"kind":"unknown","runtimeId":500},{"kind":"unknown","runtimeId":800},{"kind":"vanilla","id":2}]}
            """;
        var header = Encoding.UTF8.GetBytes(Header);
        var prefix = new byte[12];
        "CWM\0"u8.CopyTo(prefix);
        BinaryPrimitives.WriteUInt32LittleEndian(prefix.AsSpan(4), 1);
        BinaryPrimitives.WriteUInt32LittleEndian(prefix.AsSpan(8), checked((uint)header.Length));
        // Each line is one plane. Values were derived directly from the eight coordinates above.
        var payload = TileAssert.Hex("""
            00 00 01 00 03 00 ff ff 00 00 04 00 ff ff ff ff
            00 00 02 00 00 00 ff ff 04 00 ff ff ff ff ff ff
            ff ff 00 80 ee ff ff ff 12 00 ff ff ff ff ff ff
            ff ff ff 7f d4 ff ff ff 2c 00 ff ff ff ff ff ff
            00 ff 00 00 03 00 00 00
            00 07 00 00 00 00 00 00
            00 01 02 03 04 00 00 00
            00 00 40 ff 10 00 00 00
            00 01 02 00 03 04 05 00
            00 00 ff 03 02 00 00 00 04 00 08 00 10 00 20 00
            """.Replace("\r", string.Empty, StringComparison.Ordinal).Replace("\n", string.Empty, StringComparison.Ordinal));
        Assert.Equal(120, payload.Length);
        return [.. prefix, .. header, .. payload];
    }
}
