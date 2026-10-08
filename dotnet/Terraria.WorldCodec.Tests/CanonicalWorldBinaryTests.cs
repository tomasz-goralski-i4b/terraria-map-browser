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

    [Fact]
    public void Write_ModReferencesWithAndWithoutOptionalFields_WritesExactHeaderBytes()
    {
        var source = ExampleWorld();
        var world = source with
        {
            Tiles = new TileGrid(2, 4,
            [
                new Tile { Block = new ModContentRef("CalamityMod", "AstralStone", 900, "2.0.4.6") },
                new Tile { Wall = new ModContentRef("CalamityMod", "AstralDirtWall", null, null) },
                new Tile { Block = new ModContentRef("CalamityMod", "Navystone", 901, null) },
                new Tile { Wall = new ModContentRef("CalamityMod", "EutrophicSandWall", null, "2.0.4.6") },
                new Tile(), new Tile(), new Tile(), new Tile(),
            ]),
        };
        const string ExpectedHeader = """
            {"schemaVersion":1,"formatVersion":326,"metadata":{"name":"Forêt 海岸","seed":"948580918","guid":"00112233445566778899aabbccddeeff","worldId":948580918,"gameMode":1,"evil":"corruption"},"dimensions":{"width":2,"height":4},"palette":[{"kind":"mod","mod":"CalamityMod","internalName":"AstralStone","runtimeId":900,"modVersion":"2.0.4.6"},{"kind":"mod","mod":"CalamityMod","internalName":"AstralDirtWall"},{"kind":"mod","mod":"CalamityMod","internalName":"Navystone","runtimeId":901},{"kind":"mod","mod":"CalamityMod","internalName":"EutrophicSandWall","modVersion":"2.0.4.6"}]}
            """;
        var expectedHeader = Encoding.UTF8.GetBytes(ExpectedHeader);
        using var output = new MemoryStream();

        CanonicalWorldBinary.Write(world, output);

        var exported = output.ToArray();
        Assert.Equal((uint)expectedHeader.Length, BinaryPrimitives.ReadUInt32LittleEndian(exported.AsSpan(8, 4)));
        Assert.Equal(expectedHeader, exported.AsSpan(12, expectedHeader.Length).ToArray());
        Assert.Equal(12 + expectedHeader.Length + (15 * 2 * 4), exported.Length);
    }

    [Fact]
    public void Write_UnicodeAndControlMetadata_WritesExactUtf8AndJsonEscapes()
    {
        const string Name = "Forêt 😀\uFEFF\u2028\u2029\u007F \"海岸\"\\\b\t\n\f\r";
        const string Seed = "948580918\0\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u000B\u000E\u000F" +
            "\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001A\u001B\u001C\u001D\u001E\u001F";
        const string EscapedName = "Forêt 😀\uFEFF\u2028\u2029\u007F \\\"海岸\\\"\\\\\\b\\t\\n\\f\\r";
        const string EscapedSeed = """
            948580918\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u000b\u000e\u000f\u0010\u0011\u0012\u0013\u0014\u0015\u0016\u0017\u0018\u0019\u001a\u001b\u001c\u001d\u001e\u001f
            """;
        var source = ExampleWorld();
        var world = source with { Metadata = source.Metadata with { Name = Name, Seed = Seed } };
        using var output = new MemoryStream();

        CanonicalWorldBinary.Write(world, output);

        Assert.Equal(ExpectedBytes(EscapedName, EscapedSeed), output.ToArray());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Write_LoneSurrogateMetadata_WritesUtf8ReplacementCharacter(bool highSurrogateInName)
    {
        // Construct invalid UTF-16 at runtime: attribute metadata cannot preserve lone surrogates.
        var name = highSurrogateInName ? "Forêt \uD83D 海岸" : "Forêt \uDE00 海岸";
        var seed = highSurrogateInName ? "948580918\uDE00" : "948580918\uD83D";
        var source = ExampleWorld();
        var world = source with { Metadata = source.Metadata with { Name = name, Seed = seed } };
        using var output = new MemoryStream();

        CanonicalWorldBinary.Write(world, output);

        Assert.Equal(ExpectedBytes("Forêt � 海岸", "948580918�"), output.ToArray());
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

    internal static byte[] ExpectedBytes(string escapedName = "Forêt 海岸", string escapedSeed = "948580918")
    {
        const string Header = """
            {"schemaVersion":1,"formatVersion":326,"metadata":{"name":"Forêt 海岸","seed":"948580918","guid":"00112233445566778899aabbccddeeff","worldId":948580918,"gameMode":1,"evil":"corruption"},"dimensions":{"width":2,"height":4},"palette":[{"kind":"vanilla","id":1},{"kind":"vanilla","id":4},{"kind":"unknown","runtimeId":500},{"kind":"unknown","runtimeId":800},{"kind":"vanilla","id":2}]}
            """;
        var header = Encoding.UTF8.GetBytes(Header
            .Replace("Forêt 海岸", escapedName, StringComparison.Ordinal)
            .Replace("\"seed\":\"948580918\"", "\"seed\":\"" + escapedSeed + "\"", StringComparison.Ordinal));
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
