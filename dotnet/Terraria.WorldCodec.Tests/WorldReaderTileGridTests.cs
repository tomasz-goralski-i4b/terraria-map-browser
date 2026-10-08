using Terraria.WorldCodec.Synthetic;
using static Terraria.WorldCodec.Tests.TileAssert;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// Tile order, run-length encoding and section bounds (docs/file-format.md, "Order and coordinates",
/// "Rules and limits", vectors R1–R10). All worlds are synthetic.
/// </summary>
public class WorldReaderTileGridTests
{
    private static readonly Tile Empty = new();
    private static readonly Tile Stone = new() { Block = new VanillaContentRef(1) };
    private static readonly Tile Water255 = new() { Liquid = new TileLiquid(LiquidKind.Water, 255) };

    private static TileGrid ReadGrid(int width, int height, string bytes) =>
        SyntheticTileWorld.Read(SyntheticTileWorld.Build(width, height, Hex(bytes)).File).Tiles;

    private static void AssertColumn(TileGrid grid, int x, params Tile[] expected)
    {
        Assert.Equal(expected.Length, grid.Height);
        for (var y = 0; y < expected.Length; y++)
        {
            Assert.Equal(expected[y], grid[x, y]);
        }
    }

    [Fact]
    public void Read_TwoByThreeGrid_ReturnsTilesColumnByColumn()
    {
        // Column 0: stone, empty, wall 5. Column 1: water 16, block 2, block 3.
        var grid = ReadGrid(2, 3, "02 01  00  04 05  08 10  02 02  02 03");

        Assert.Equal(2, grid.Width);
        Assert.Equal(3, grid.Height);
        AssertColumn(grid, 0, Stone, Empty, new Tile { Wall = new VanillaContentRef(5) });
        AssertColumn(
            grid,
            1,
            new Tile { Liquid = new TileLiquid(LiquidKind.Water, 16) },
            new Tile { Block = new VanillaContentRef(2) },
            new Tile { Block = new VanillaContentRef(3) });
    }

    [Theory]
    [InlineData(-1, 0)]
    [InlineData(2, 0)]
    [InlineData(0, -1)]
    [InlineData(0, 3)]
    public void Read_CoordinatesOutsideGrid_IndexerThrows(int x, int y)
    {
        var grid = ReadGrid(2, 3, "40 02  40 02");

        Assert.Throws<ArgumentOutOfRangeException>(() => grid[x, y]);
    }

    [Fact]
    public void Read_UInt8RunOfZero_ReturnsOneTile()
    {
        var grid = ReadGrid(2, 4, "42 01 00  00  00  00  40 03");

        AssertColumn(grid, 0, Stone, Empty, Empty, Empty);
        AssertColumn(grid, 1, Empty, Empty, Empty, Empty);
    }

    [Fact]
    public void Read_UInt8RunOfOne_RepeatsTileOnce()
    {
        var grid = ReadGrid(2, 4, "42 01 01  00  00  40 03");

        AssertColumn(grid, 0, Stone, Stone, Empty, Empty);
    }

    [Fact]
    public void Read_RunEndingTheColumn_FillsColumnAndNextColumnStartsAtTop()
    {
        var grid = ReadGrid(2, 4, "42 01 03  00  48 ff 02");

        AssertColumn(grid, 0, Stone, Stone, Stone, Stone);
        AssertColumn(grid, 1, Empty, Water255, Water255, Water255);
    }

    [Fact]
    public void Read_NonCanonicalInt16Run_SameAsUInt8Run()
    {
        var grid = ReadGrid(2, 4, "82 01 03 00  00  48 ff 02");

        AssertColumn(grid, 0, Stone, Stone, Stone, Stone);
        AssertColumn(grid, 1, Empty, Water255, Water255, Water255);
    }

    [Fact]
    public void Read_UInt8RunOf255_FillsColumn()
    {
        var grid = ReadGrid(1, 256, "42 01 ff");

        Assert.All(Enumerable.Range(0, 256), y => Assert.Equal(Stone, grid[0, y]));
    }

    [Fact]
    public void Read_Int16RunAbove255_FillsColumn()
    {
        var grid = ReadGrid(1, 300, "82 01 2b 01");

        Assert.All(Enumerable.Range(0, 300), y => Assert.Equal(Stone, grid[0, y]));
    }

    [Fact]
    public void Read_RunOfRichRecord_RepeatsEveryField()
    {
        var expected = new Tile
        {
            Block = new VanillaContentRef(1),
            Shape = BlockShape.Half,
            Paint = 13,
            Wall = new VanillaContentRef(4),
            WallPaint = 2,
            Wires = TileWires.Red | TileWires.Yellow,
            Actuator = true,
        };

        var grid = ReadGrid(1, 4, "47 13 3a 01 0d 04 02 03");

        AssertColumn(grid, 0, expected, expected, expected, expected);
    }

    [Fact]
    public void Read_RunOfFramedLiquidRecord_RepeatsEveryField()
    {
        // Block 4 (frame-important) with frames, honey 200, Int16 run 2.
        var expected = new Tile
        {
            Block = new VanillaContentRef(4),
            FrameX = 18,
            FrameY = 36,
            Liquid = new TileLiquid(LiquidKind.Honey, 200),
        };

        var grid = ReadGrid(1, 3, "9a 04 12 00 24 00 c8 02 00");

        AssertColumn(grid, 0, expected, expected, expected);
    }

    [Theory]
    [InlineData("42 01 04", 0, 0, 0)]
    [InlineData("82 01 04 00", 0, 0, 0)]
    [InlineData("00 00 00 42 01 01", 0, 3, 3)]
    [InlineData("40 03  42 01 04", 1, 0, 2)]
    public void Read_RunCrossingColumnEnd_ThrowsMalformedTiles(string bytes, int x, int y, int recordOffset)
    {
        var (file, tileStart) = SyntheticTileWorld.Build(2, 4, Hex(bytes));

        var error = ReadExpectingError(file);

        Error(error, x, y, tileStart + recordOffset, "run crosses column end");
    }

    [Fact]
    public void Read_NegativeInt16Run_ThrowsMalformedTiles()
    {
        var (file, tileStart) = SyntheticTileWorld.Build(2, 4, Hex("82 01 ff ff"));

        Error(ReadExpectingError(file), 0, 0, tileStart, "negative run");
    }

    [Fact]
    public void Read_ReservedRunWidth_ThrowsMalformedTiles()
    {
        var (file, tileStart) = SyntheticTileWorld.Build(2, 4, Hex("c2 01 01 00"));

        Error(ReadExpectingError(file), 0, 0, tileStart, "reserved run width");
    }

    [Theory]
    [InlineData("07 13 3a 01", 0, 0, 0)]
    [InlineData("82 01 03", 0, 0, 0)]
    [InlineData("42 01 03  00  48 ff", 1, 1, 4)]
    [InlineData("42 01 03", 1, 0, 3)]
    public void Read_SectionEndsInsideRecord_ThrowsTruncatedRecord(string bytes, int x, int y, int recordOffset)
    {
        var (file, tileStart) = SyntheticTileWorld.Build(2, 4, Hex(bytes));

        Error(ReadExpectingError(file), x, y, tileStart + recordOffset, "truncated record");
    }

    [Fact]
    public void Read_RecordContinuingPastSectionEnd_ThrowsTruncatedRecord()
    {
        // R3, but pointer[2] is placed before its last two bytes; they lie in the next section.
        var (file, tileStart) = SyntheticTileWorld.Build(2, 4, Hex("42 01 03  00  48 ff 02"), tileSectionLength: 5);

        Error(ReadExpectingError(file), 1, 1, tileStart + 4, "truncated record");
    }

    [Fact]
    public void Read_UnreadBytesBeforeSectionEnd_ThrowsMalformedTiles()
    {
        var (file, tileStart) = SyntheticTileWorld.Build(2, 4, Hex("42 01 03  00  48 ff 02  00"));

        var error = ReadExpectingError(file);

        Assert.Equal(WorldFormatError.MalformedTiles, error.Error);
        Assert.Equal(TilesSection, error.Section);
        Assert.Equal(tileStart + 7, error.Offset);
        Assert.Equal("section not fully consumed", error.Reason);
    }

    public static TheoryData<CrossingField, bool> WindowCrossings()
    {
        var cases = new TheoryData<CrossingField, bool>();
        foreach (var field in Enum.GetValues<CrossingField>())
        {
            cases.Add(field, false);
            cases.Add(field, true);
        }

        return cases;
    }

    [Theory]
    [MemberData(nameof(WindowCrossings))]
    public void Read_FieldAcrossReadWindowBoundary_DecodesExactTiles(CrossingField field, bool shortReads)
    {
        var section = WindowBoundaryTileSection.Build(field);
        Assert.True(section.Bytes.Length > WindowBoundaryTileSection.Window);
        var (file, tileStart) = SyntheticTileWorld.Build(section.Width, WindowBoundaryTileSection.Height, section.Bytes);
        using var stream = new ShortReadStream(file, shortReads);

        var world = WorldReader.Read(stream);
        var grid = world.Tiles;

        Assert.Equal(section.Width, grid.Width);
        Assert.Equal(WindowBoundaryTileSection.Height, grid.Height);
        for (var x = 0; x < section.Width; x++)
        {
            for (var y = 0; y < grid.Height; y++)
            {
                Assert.Equal(section.Columns[x], grid[x, y]);
            }
        }

        Assert.Equal(tileStart + section.Bytes.Length, stream.Position);
        // A successful world read now walks entity sections too, but never consumes the footer.
        Assert.Equal(8, world.Entities.Count);
        Assert.All(world.Entities, entity => Assert.NotNull(entity.Error));
        Assert.InRange(stream.HighestReadEnd, tileStart + section.Bytes.Length, world.Entities[^1].Boundary.End);
    }

    [Theory]
    [MemberData(nameof(WindowCrossings))]
    public void ReadTiles_FieldAcrossReadWindowBoundary_NeverReadsPastTilePointer(CrossingField field, bool shortReads)
    {
        var section = WindowBoundaryTileSection.Build(field);
        var (file, tileStart) = SyntheticTileWorld.Build(section.Width, WindowBoundaryTileSection.Height, section.Bytes);
        var tiles = new WorldSectionBoundary(tileStart, tileStart + section.Bytes.Length);
        var frameImportant = Enumerable.Range(0, SyntheticTileWorld.DefaultFrameCount)
            .Select(id => SyntheticTileWorld.DefaultFrameImportant.Contains(id))
            .ToArray();
        using var stream = new ShortReadStream(file, shortReads);

        var grid = new TileSectionReader(stream, tiles, frameImportant).Read(section.Width, WindowBoundaryTileSection.Height);

        Assert.Equal(section.Columns[^1], grid[section.Width - 1, WindowBoundaryTileSection.Height - 1]);
        Assert.InRange(stream.HighestReadEnd, tileStart + 1, tiles.End);
    }

    [Theory]
    [MemberData(nameof(WindowCrossings))]
    public void Read_CrossingFieldCutAtSectionEnd_ThrowsTruncatedRecordWithoutReadingChests(CrossingField field, bool shortReads)
    {
        // pointer[2] falls between the two bytes of the crossing field; its second byte and the rest of the tiles
        // spill into the chest section, where a reader that ignores pointer[2] would still find them.
        var section = WindowBoundaryTileSection.Build(field);
        var (file, tileStart) = SyntheticTileWorld.Build(
            section.Width,
            WindowBoundaryTileSection.Height,
            section.Bytes,
            tileSectionLength: WindowBoundaryTileSection.Window);
        var chestsStart = tileStart + WindowBoundaryTileSection.Window;
        using var stream = new ShortReadStream(file, shortReads);

        var error = Assert.Throws<WorldFormatException>(() => WorldReader.Read(stream));

        Error(error, section.CrossingColumn, 0, tileStart + section.CrossingRecordOffset, "truncated record");
        Assert.InRange(stream.HighestReadEnd, 0, chestsStart);
    }
}
