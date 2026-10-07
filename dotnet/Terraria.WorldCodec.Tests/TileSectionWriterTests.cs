using static Terraria.WorldCodec.Tests.TileAssert;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// Format-326 tile encoder (docs/file-format/writer.md, "Tile encoding", "Noncanonical input on save", "Writer vectors").
/// Real frame-important set of the vectors: 4, 5, 520 and 423 (1, 255 and 256 are not); <c>k = 754</c>.
/// </summary>
public class TileSectionWriterTests
{
    private const int FrameCount = 754;

    private static readonly int[] FrameImportantIds = [4, 5, 520, 423];

    private static readonly VanillaContentRef Stone = new(1);

    private static readonly Tile StoneTile = new() { Block = Stone };

    private static readonly Tile Empty = new();

    public static TheoryData<string, int, int, string> WriterVectors() => new()
    {
        { "W1", 1, 1, "02 ff" },
        { "W2", 1, 1, "22 00 01" },
        { "W3", 1, 1, "04 ff" },
        { "W4", 1, 1, "05 01 40 00 01" },
        { "W5", 1, 1, "00" },
        { "W6", 1, 2, "42 01 01" },
        { "W7", 1, 256, "40 ff" },
        { "W8", 1, 257, "80 00 01" },
        { "W9", 1, 32768, "80 ff 7f" },
        { "W10", 1, 32769, "80 ff 7f 00" },
        { "W11", 2, 4, "42 01 03 42 01 03" },
        { "W12", 1, 2, "22 08 02 00 00 00 00 22 08 02 00 00 00 00" },
        { "W13", 1, 3, "22 a7 01 12 00 00 00 22 a7 01 12 00 00 00 22 a7 01 12 00 00 00" },
        { "W14", 1, 1, "10 00" },
        { "W15", 1, 1, "02 01" },
        { "W16", 1, 1, "03 01 08 01 1f" },
    };

    public static TheoryData<string, string, string> NoncanonicalSources() => new()
    {
        { "2-byte id <= 255", "22 ff 00", "02 ff" },
        { "UInt8 run 0", "42 01 00", "02 01" },
        { "empty optional flag byte", "03 00 01", "02 01" },
        { "block paint 0", "03 01 08 01 00", "02 01" },
        { "wall paint 0", "05 01 10 04 00", "04 04" },
        { "shimmer 0 kept", "09 01 80 00", "09 01 80 00" },
        { "water 0 kept", "08 00", "08 00" },
        { "paint 31 kept", "03 01 08 01 1f", "03 01 08 01 1f" },
    };

    public static TheoryData<string> Worlds() => new() { "SCCO1.wld", "SCCR2.wld", "SECR1.wld", "SJCO1.wld", "SMCO1.wld" };

    public static TheoryData<string, Tile> FieldTiles() => new()
    {
        { "block and wall refs", new Tile { Block = new VanillaContentRef(0), Wall = new VanillaContentRef(1) } },
        { "highest vanilla block and wall", new Tile { Block = new VanillaContentRef(753), Wall = new VanillaContentRef(366) } },
        { "unknown wall", new Tile { Wall = new UnknownContentRef(367) } },
        { "block 255", new Tile { Block = new VanillaContentRef(255) } },
        { "block 256", new Tile { Block = new VanillaContentRef(256) } },
        { "wall 255", new Tile { Wall = new VanillaContentRef(255) } },
        { "wall 300", new Tile { Wall = new VanillaContentRef(300) } },
        { "frames min", new Tile { Block = new VanillaContentRef(5), FrameX = short.MinValue, FrameY = short.MinValue } },
        { "frames max", new Tile { Block = new VanillaContentRef(5), FrameX = short.MaxValue, FrameY = short.MaxValue } },
        { "frames with paint", new Tile { Block = new VanillaContentRef(4), FrameX = 16, FrameY = 32, Paint = 5 } },
        { "paint 255", new Tile { Block = Stone, Paint = 255 } },
        { "paint 1", new Tile { Block = Stone, Paint = 1 } },
        { "wall paint 255", new Tile { Wall = new VanillaContentRef(7), WallPaint = 255 } },
        { "wall paint with high wall", new Tile { Wall = new VanillaContentRef(300), WallPaint = 3 } },
        { "red wire", new Tile { Wires = TileWires.Red } },
        { "blue wire", new Tile { Wires = TileWires.Blue } },
        { "green wire", new Tile { Wires = TileWires.Green } },
        { "yellow wire", new Tile { Wires = TileWires.Yellow } },
        { "all wires", new Tile { Wires = TileWires.Red | TileWires.Blue | TileWires.Green | TileWires.Yellow } },
        { "actuator without block", new Tile { Actuator = true } },
        { "inactive block", new Tile { Block = Stone, Inactive = true } },
        { "half block", new Tile { Block = Stone, Shape = BlockShape.Half } },
        { "slope top right", new Tile { Block = Stone, Shape = BlockShape.SlopeTopRight } },
        { "slope bottom left", new Tile { Block = Stone, Shape = BlockShape.SlopeBottomLeft } },
        { "invisible block", new Tile { Block = Stone, InvisibleBlock = true } },
        { "invisible wall", new Tile { Wall = new VanillaContentRef(7), InvisibleWall = true } },
        { "full-bright block", new Tile { Block = Stone, FullBrightBlock = true } },
        { "full-bright wall", new Tile { Wall = new VanillaContentRef(7), FullBrightWall = true } },
        { "water 0", new Tile { Liquid = new TileLiquid(LiquidKind.Water, 0) } },
        { "water 255", new Tile { Liquid = new TileLiquid(LiquidKind.Water, 255) } },
        { "lava 0", new Tile { Liquid = new TileLiquid(LiquidKind.Lava, 0) } },
        { "honey 128", new Tile { Liquid = new TileLiquid(LiquidKind.Honey, 128) } },
        { "shimmer 0", new Tile { Liquid = new TileLiquid(LiquidKind.Shimmer, 0) } },
        { "shimmer 200", new Tile { Liquid = new TileLiquid(LiquidKind.Shimmer, 200) } },
        {
            "everything at once",
            new Tile
            {
                Block = new VanillaContentRef(5),
                Wall = new VanillaContentRef(300),
                FrameX = -32768,
                FrameY = 32767,
                Paint = 255,
                WallPaint = 255,
                Wires = TileWires.Red | TileWires.Yellow,
                Actuator = true,
                Inactive = true,
                Shape = BlockShape.SlopeTopLeft,
                InvisibleBlock = true,
                InvisibleWall = true,
                FullBrightBlock = true,
                FullBrightWall = true,
                Liquid = new TileLiquid(LiquidKind.Shimmer, 77),
            }
        },
    };

    public static TheoryData<string, Tile> UnencodableTiles() => new()
    {
        { "block id at k", new Tile { Block = new UnknownContentRef(FrameCount) } },
        { "block id above 65535", new Tile { Block = new UnknownContentRef(65536) } },
        { "wall id above 65535", new Tile { Wall = new UnknownContentRef(65536) } },
        { "negative block id", new Tile { Block = new UnknownContentRef(-1) } },
        { "wall id 0", new Tile { Wall = new VanillaContentRef(0) } },
        { "mod block", new Tile { Block = new ModContentRef("Mod", "Thing", 900, null) } },
        { "mod wall", new Tile { Wall = new ModContentRef("Mod", "Wall", 400, null) } },
        { "frame-important block without frames", new Tile { Block = new VanillaContentRef(4) } },
        { "frame-important block with one frame", new Tile { Block = new VanillaContentRef(4), FrameX = 0 } },
        { "plain block with frames", new Tile { Block = Stone, FrameX = 0, FrameY = 0 } },
        { "frames without block", new Tile { FrameX = 0, FrameY = 0 } },
        { "paint without block", new Tile { Paint = 3 } },
        { "wall paint without wall", new Tile { WallPaint = 3 } },
        { "shape without block", new Tile { Shape = BlockShape.Half } },
        { "shape out of range", new Tile { Block = Stone, Shape = (BlockShape)6 } },
        { "undefined wire bit", new Tile { Wires = (TileWires)16 } },
        { "undefined liquid kind", new Tile { Liquid = new TileLiquid((LiquidKind)9, 1) } },
    };

    [Theory]
    [MemberData(nameof(WriterVectors))]
    public void Write_WriterVector_GivesTheSpecifiedBytes(string vector, int width, int height, string expected)
    {
        var grid = Grid(width, height, (_, _) => VectorTile(vector));

        var bytes = TileSectionWriter.Write(grid, FrameImportant());

        Assert.Equal(Hex(expected), bytes);
    }

    [Theory]
    [MemberData(nameof(NoncanonicalSources))]
    public void Write_AcceptedNoncanonicalRecord_GivesContractBytesWithTheSameSemantics(string name, string source, string expected)
    {
        var decoded = Decode(Hex(source), 1, 1).Tiles[0, 0];

        var bytes = TileSectionWriter.Write(Grid(1, 1, (_, _) => decoded), FrameImportant());

        Assert.True(Hex(expected).AsSpan().SequenceEqual(bytes), name);
        Assert.Equal(Normalize(decoded), Normalize(Decode(bytes, 1, 1).Tiles[0, 0]));
    }

    [Fact]
    public void Write_EqualNeighboursStoredSeparately_AreMergedIntoOneRun()
    {
        var decoded = Decode(Hex("02 01 02 01"), 1, 2);

        Assert.Equal(Hex("42 01 01"), TileSectionWriter.Write(decoded.Tiles, FrameImportant()));
    }

    [Fact]
    public void Write_RunOfFoodPlatterInSource_IsSplitIntoSeparateRecords()
    {
        var decoded = Decode(Hex("62 08 02 00 00 00 00 01"), 1, 2);

        Assert.Equal(Hex("22 08 02 00 00 00 00 22 08 02 00 00 00 00"), TileSectionWriter.Write(decoded.Tiles, FrameImportant()));
    }

    [Theory]
    [MemberData(nameof(FieldTiles))]
    public void Write_ThenRead_PreservesEveryTileField(string name, Tile tile)
    {
        var grid = Grid(2, 3, (x, y) => x == 1 && y == 1 ? tile : Empty);

        var bytes = TileSectionWriter.Write(grid, FrameImportant());
        var read = Decode(bytes, 2, 3).Tiles;

        Assert.True(tile == read[1, 1], name);
        Assert.Equal(Empty, read[0, 0]);
        Assert.Equal(Empty, read[1, 2]);
    }

    [Fact]
    public void Write_Paint0_IsReadBackAsNoPaint()
    {
        var bytes = TileSectionWriter.Write(Grid(1, 1, (_, _) => new Tile { Block = Stone, Paint = 0 }), FrameImportant());

        Assert.Equal(Hex("02 01"), bytes);
        Assert.Null(Decode(bytes, 1, 1).Tiles[0, 0].Paint);
    }

    [Theory]
    [InlineData(255, "02 ff")]
    [InlineData(256, "22 00 01")]
    [InlineData(300, "22 2c 01")]
    public void Write_BlockIdBoundary_UsesTheRightWidthAndFlag(int id, string expected)
    {
        var tile = new Tile { Block = new VanillaContentRef(id) };

        Assert.Equal(Hex(expected), TileSectionWriter.Write(Grid(1, 1, (_, _) => tile), FrameImportant(1024)));
    }

    [Fact]
    public void Write_HighestEncodableBlockId_UsesTwoBytes()
    {
        var tile = new Tile { Block = new UnknownContentRef(65535) };

        Assert.Equal(Hex("22 ff ff"), TileSectionWriter.Write(Grid(1, 1, (_, _) => tile), FrameImportant(65536)));
    }

    [Theory]
    [InlineData(255, "04 ff")]
    [InlineData(256, "05 01 40 00 01")]
    [InlineData(300, "05 01 40 2c 01")]
    [InlineData(65535, "05 01 40 ff ff")]
    public void Write_WallIdBoundary_PutsTheHighByteAfterTheLowByte(int id, string expected)
    {
        var tile = new Tile { Wall = id <= 366 ? new VanillaContentRef(id) : new UnknownContentRef(id) };

        Assert.Equal(Hex(expected), TileSectionWriter.Write(Grid(1, 1, (_, _) => tile), FrameImportant()));
    }

    [Fact]
    public void Write_WallWithLiquidAndPaint_PutsTheHighByteAfterTheLiquidAmount()
    {
        var tile = new Tile { Wall = new VanillaContentRef(300), WallPaint = 9, Liquid = new TileLiquid(LiquidKind.Water, 5) };

        Assert.Equal(Hex("0d 01 50 2c 09 05 01"), TileSectionWriter.Write(Grid(1, 1, (_, _) => tile), FrameImportant()));
    }

    [Fact]
    public void Write_FrameImportantBlock_EmitsFramesAfterTheIdAndBeforePaint()
    {
        var tile = new Tile { Block = new VanillaContentRef(4), FrameX = 16, FrameY = 32, Paint = 5 };

        Assert.Equal(Hex("03 01 08 04 10 00 20 00 05"), TileSectionWriter.Write(Grid(1, 1, (_, _) => tile), FrameImportant()));
    }

    [Fact]
    public void Write_FrameExtremes_AreWrittenAsSignedInt16()
    {
        var tile = new Tile { Block = new VanillaContentRef(5), FrameX = short.MinValue, FrameY = short.MaxValue };

        Assert.Equal(Hex("02 05 00 80 ff 7f"), TileSectionWriter.Write(Grid(1, 1, (_, _) => tile), FrameImportant()));
    }

    [Fact]
    public void Write_PaintExtremes_UseThePaintFlag()
    {
        var tile = new Tile { Block = Stone, Paint = 255 };

        Assert.Equal(Hex("03 01 08 01 ff"), TileSectionWriter.Write(Grid(1, 1, (_, _) => tile), FrameImportant()));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(255)]
    [InlineData(256)]
    [InlineData(32767)]
    public void Write_RunOfEveryWidth_RoundTripsAndUsesTheSpecifiedCounter(int run)
    {
        var height = run + 1;
        var grid = Grid(1, height, (_, _) => StoneTile);

        var bytes = TileSectionWriter.Write(grid, FrameImportant());

        var expected = run switch
        {
            0 => "02 01",
            <= 255 => $"42 01 {run:x2}",
            _ => $"82 01 {run & 0xff:x2} {run >> 8:x2}",
        };
        Assert.Equal(Hex(expected), bytes);
        Assert.Equal(Enumerable.Repeat(StoneTile, height), Column(Decode(bytes, 1, height).Tiles, 0, height));
    }

    [Fact]
    public void Write_ColumnLongerThanTheLargestRun_SplitsLegalRunsAndRestartsWithTheSameTile()
    {
        const int Height = 32768 + 6;

        var bytes = TileSectionWriter.Write(Grid(1, Height, (_, _) => StoneTile), FrameImportant());

        Assert.Equal(Hex("82 01 ff 7f 42 01 05"), bytes);
        Assert.Equal(Enumerable.Repeat(StoneTile, Height), Column(Decode(bytes, 1, Height).Tiles, 0, Height));
    }

    [Fact]
    public void Write_IdenticalAdjacentColumns_NeverShareARun()
    {
        var bytes = TileSectionWriter.Write(Grid(3, 2, (_, _) => StoneTile), FrameImportant());

        Assert.Equal(Hex("42 01 01 42 01 01 42 01 01"), bytes);
    }

    [Fact]
    public void Write_MixedColumns_RoundTrip()
    {
        var other = new Tile { Block = new VanillaContentRef(2), Paint = 4 };
        var grid = Grid(2, 5, (x, y) => (x + y) % 3 == 0 ? Empty : y < 3 ? StoneTile : other);

        var read = Decode(TileSectionWriter.Write(grid, FrameImportant()), 2, 5).Tiles;

        for (var x = 0; x < 2; x++)
        {
            for (var y = 0; y < 5; y++)
            {
                Assert.Equal(grid[x, y], read[x, y]);
            }
        }
    }

    [Fact]
    public void Write_FoodPlatterAndLogicSensor_NeverJoinARunButNeighboursStillDo()
    {
        var platter = new Tile { Block = new VanillaContentRef(520), FrameX = 0, FrameY = 0 };
        var grid = Grid(1, 4, (_, y) => y < 2 ? platter : StoneTile);

        var bytes = TileSectionWriter.Write(grid, FrameImportant());

        Assert.Equal(Hex("22 08 02 00 00 00 00 22 08 02 00 00 00 00 42 01 01"), bytes);
    }

    [Fact]
    public void Write_OptionalFlagByte_IsOmittedOnlyWhenNoLaterByteCarriesData()
    {
        var yellow = new Tile { Wires = TileWires.Yellow };
        var red = new Tile { Wires = TileWires.Red };
        var actuator = new Tile { Actuator = true };
        var bright = new Tile { FullBrightWall = true };

        Assert.Equal(Hex("01 01 20"), TileSectionWriter.Write(Grid(1, 1, (_, _) => yellow), FrameImportant()));
        Assert.Equal(Hex("01 02"), TileSectionWriter.Write(Grid(1, 1, (_, _) => red), FrameImportant()));
        Assert.Equal(Hex("01 01 02"), TileSectionWriter.Write(Grid(1, 1, (_, _) => actuator), FrameImportant()));
        Assert.Equal(Hex("01 01 01 10"), TileSectionWriter.Write(Grid(1, 1, (_, _) => bright), FrameImportant()));
    }

    [Fact]
    public void Write_IlluminantPaint31_IsNotTurnedIntoFullBrightFlags()
    {
        var tile = new Tile { Block = Stone, Paint = 31 };

        var read = Decode(TileSectionWriter.Write(Grid(1, 1, (_, _) => tile), FrameImportant()), 1, 1).Tiles[0, 0];

        Assert.Equal((byte)31, read.Paint);
        Assert.False(read.FullBrightBlock);
    }

    [Theory]
    [MemberData(nameof(UnencodableTiles))]
    public void Write_UnencodableTile_FailsWithItsCoordinates(string name, Tile tile)
    {
        var grid = Grid(3, 4, (x, y) => x == 2 && y == 3 ? tile : StoneTile);

        var error = Assert.Throws<TileEncodingException>(() => TileSectionWriter.Write(grid, FrameImportant()));

        Assert.True(error.X == 2 && error.Y == 3, name);
        Assert.False(string.IsNullOrWhiteSpace(error.Reason));
    }

    [Fact]
    public void Write_FrameImportantTableMissingTheBlockId_FailsBeforeReturningASection()
    {
        var shortTable = new bool[10];

        var error = Assert.Throws<TileEncodingException>(
            () => TileSectionWriter.Write(Grid(1, 1, (_, _) => new Tile { Block = new VanillaContentRef(11) }), shortTable));

        Assert.Equal((0, 0), (error.X, error.Y));
    }

    [Fact]
    public void Write_FrameImportanceComesFromTheTableNotFromTheBlockId()
    {
        var table = FrameImportant();
        table[1] = true;

        Assert.Equal(
            Hex("02 01 07 00 08 00"),
            TileSectionWriter.Write(Grid(1, 1, (_, _) => new Tile { Block = Stone, FrameX = 7, FrameY = 8 }), table));
        Assert.Throws<TileEncodingException>(() => TileSectionWriter.Write(Grid(1, 1, (_, _) => StoneTile), table));
    }

    [Fact]
    public void Write_SameGridTwice_GivesTheSameBytes()
    {
        var grid = Grid(4, 6, (x, y) => (x * y) % 2 == 0 ? StoneTile : new Tile { Wall = new VanillaContentRef(x + 1) });

        Assert.Equal(TileSectionWriter.Write(grid, FrameImportant()), TileSectionWriter.Write(grid, FrameImportant()));
    }

    [Theory]
    [MemberData(nameof(Worlds))]
    public void Write_UnchangedVanillaWorld_ReproducesTheSourceTileSectionByteForByte(string file)
    {
        var bytes = File.ReadAllBytes(Path.Combine(FixturesDirectory(), "worlds", file));
        using var stream = new MemoryStream(bytes);
        var envelope = WorldReader.ReadForSave(stream);
        var tiles = envelope.Table.Tiles;
        var source = bytes.AsSpan((int)tiles.Start, (int)(tiles.End - tiles.Start)).ToArray();

        var written = TileSectionWriter.Write(envelope.World.Tiles, envelope.Table.FrameImportant);

        Assert.Equal(source.Length, written.Length);
        Assert.True(source.AsSpan().SequenceEqual(written), "tile section differs from the source");
    }

    private static Tile VectorTile(string vector) => vector switch
    {
        "W1" => new Tile { Block = new VanillaContentRef(255) },
        "W2" => new Tile { Block = new VanillaContentRef(256) },
        "W3" => new Tile { Wall = new VanillaContentRef(255) },
        "W4" => new Tile { Wall = new VanillaContentRef(256) },
        "W5" or "W7" or "W8" or "W9" or "W10" => Empty,
        "W6" or "W11" => StoneTile,
        "W12" => new Tile { Block = new VanillaContentRef(520), FrameX = 0, FrameY = 0 },
        "W13" => new Tile { Block = new VanillaContentRef(423), FrameX = 18, FrameY = 0 },
        "W14" => new Tile { Liquid = new TileLiquid(LiquidKind.Lava, 0) },
        "W15" => new Tile { Block = Stone, Paint = 0 },
        "W16" => new Tile { Block = Stone, Paint = 31 },
        _ => throw new ArgumentOutOfRangeException(nameof(vector), vector, null),
    };

    private static bool[] FrameImportant(int count = FrameCount)
    {
        var table = new bool[count];
        foreach (var id in FrameImportantIds)
        {
            table[id] = true;
        }

        return table;
    }

    private static TileGrid Grid(int width, int height, Func<int, int, Tile> tile)
    {
        var tiles = new Tile[width * height];
        for (var x = 0; x < width; x++)
        {
            for (var y = 0; y < height; y++)
            {
                tiles[(x * height) + y] = tile(x, y);
            }
        }

        return new TileGrid(width, height, tiles);
    }

    private static IEnumerable<Tile> Column(TileGrid grid, int x, int height) =>
        Enumerable.Range(0, height).Select(y => grid[x, y]);

    private static World Decode(byte[] tileSection, int width, int height) =>
        SyntheticTileWorld.Read(SyntheticTileWorld.Build(width, height, tileSection, frameImportant: FrameImportantIds).File);

    /// <summary>Paint 0 and an absent paint byte are the same semantic value (writer.md).</summary>
    private static Tile Normalize(Tile tile) => tile with
    {
        Paint = tile.Paint == 0 ? null : tile.Paint,
        WallPaint = tile.WallPaint == 0 ? null : tile.WallPaint,
    };

    private static string FixturesDirectory()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "packages", "test-fixtures");
            if (File.Exists(Path.Combine(candidate, "worlds", "manifest.json")))
            {
                return candidate;
            }
        }

        throw new DirectoryNotFoundException("packages/test-fixtures/worlds/manifest.json not found above the test assembly.");
    }
}
