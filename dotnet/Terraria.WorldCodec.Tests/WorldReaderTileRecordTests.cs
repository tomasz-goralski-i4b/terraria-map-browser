using static Terraria.WorldCodec.Tests.TileAssert;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// Additional tile record boundaries and full-world error diagnostics beyond the shared T1–T17 vectors.
/// Each record is the whole tile section of a synthetic 1 × 1 world; no game worlds are used.
/// </summary>
public class WorldReaderTileRecordTests
{
    private static readonly VanillaContentRef Stone = new(1);

    private static readonly Dictionary<string, (string Bytes, Tile Expected)> ValidRecords = new()
    {
        ["highest vanilla block 753"] = ("22 f1 02", new Tile { Block = new VanillaContentRef(753) }),
        ["frames are signed Int16"] = ("02 05 ff ff 00 80", new Tile { Block = new VanillaContentRef(5), FrameX = -1, FrameY = short.MinValue }),
        ["frames come before block paint"] = (
            "03 01 08 04 10 00 20 00 05",
            new Tile { Block = new VanillaContentRef(4), FrameX = 16, FrameY = 32, Paint = 5 }),
        ["paint byte 255 kept"] = ("03 01 08 01 ff", new Tile { Block = Stone, Paint = 255 }),
        ["water 0 kept"] = ("08 00", new Tile { Liquid = new TileLiquid(LiquidKind.Water, 0) }),
        ["lava 255"] = ("10 ff", new Tile { Liquid = new TileLiquid(LiquidKind.Lava, 255) }),
        ["honey 128"] = ("18 80", new Tile { Liquid = new TileLiquid(LiquidKind.Honey, 128) }),
        ["shimmer 0 kept"] = ("09 01 80 00", new Tile { Liquid = new TileLiquid(LiquidKind.Shimmer, 0) }),
        ["wall 255, one byte"] = ("04 ff", new Tile { Wall = new VanillaContentRef(255) }),
        ["wall 256, low byte 0"] = ("05 01 40 00 01", new Tile { Wall = new VanillaContentRef(256) }),
        ["highest vanilla wall 366"] = ("05 01 40 6e 01", new Tile { Wall = new VanillaContentRef(366) }),
        ["wall 367 is unknown"] = ("05 01 40 6f 01", new Tile { Wall = new UnknownContentRef(367) }),
        ["wall paint"] = ("05 01 10 07 1f", new Tile { Wall = new VanillaContentRef(7), WallPaint = 31 }),
        ["invisible wall"] = ("05 01 01 04 07", new Tile { Wall = new VanillaContentRef(7), InvisibleWall = true }),
        ["full-bright block"] = ("03 01 01 08 01", new Tile { Block = Stone, FullBrightBlock = true }),
        ["full-bright wall"] = ("05 01 01 10 07", new Tile { Wall = new VanillaContentRef(7), FullBrightWall = true }),
        ["all coatings"] = (
            "07 01 01 1e 01 07",
            new Tile
            {
                Block = Stone,
                Wall = new VanillaContentRef(7),
                InvisibleBlock = true,
                InvisibleWall = true,
                FullBrightBlock = true,
                FullBrightWall = true,
            }),
        ["inactive block"] = ("03 01 04 01", new Tile { Block = Stone, Inactive = true }),
        ["red wire"] = ("01 02", new Tile { Wires = TileWires.Red }),
        ["blue wire"] = ("01 04", new Tile { Wires = TileWires.Blue }),
        ["green wire"] = ("01 08", new Tile { Wires = TileWires.Green }),
        ["yellow wire"] = ("01 01 20", new Tile { Wires = TileWires.Yellow }),
        ["all wires"] = ("01 0f 20", new Tile { Wires = TileWires.Red | TileWires.Blue | TileWires.Green | TileWires.Yellow }),
        ["actuator without block"] = ("01 01 02", new Tile { Actuator = true }),
        ["half block"] = ("03 10 01", new Tile { Block = Stone, Shape = BlockShape.Half }),
        ["slope top-right"] = ("03 20 01", new Tile { Block = Stone, Shape = BlockShape.SlopeTopRight }),
        ["slope top-left"] = ("03 30 01", new Tile { Block = Stone, Shape = BlockShape.SlopeTopLeft }),
        ["slope bottom-right"] = ("03 40 01", new Tile { Block = Stone, Shape = BlockShape.SlopeBottomRight }),
        ["slope bottom-left"] = ("03 50 01", new Tile { Block = Stone, Shape = BlockShape.SlopeBottomLeft }),
        ["empty flag byte 2 accepted"] = ("01 00", new Tile()),
        ["empty flag byte 3 accepted"] = ("01 01 00", new Tile()),
        ["empty flag byte 4 accepted"] = ("01 01 01 00", new Tile()),
    };

    public static TheoryData<string> ValidRecordNames() => [.. ValidRecords.Keys];

    [Theory]
    [MemberData(nameof(ValidRecordNames))]
    public void Read_ValidRecord_ReturnsTile(string name)
    {
        var (bytes, expected) = ValidRecords[name];

        var tile = SyntheticTileWorld.ReadSingle(Hex(bytes));

        Assert.Equal(expected, tile);
    }

    [Fact]
    public void Read_EmptyRecord_LeavesOptionalPartsAbsent()
    {
        var tile = SyntheticTileWorld.ReadSingle(Hex("00"));

        Assert.Null(tile.Block);
        Assert.Null(tile.Wall);
        Assert.Null(tile.FrameX);
        Assert.Null(tile.FrameY);
        Assert.Null(tile.Paint);
        Assert.Null(tile.WallPaint);
        Assert.Null(tile.Liquid);
        Assert.Equal(TileWires.None, tile.Wires);
        Assert.False(tile.Actuator);
        Assert.Equal(BlockShape.Full, tile.Shape);
    }

    [Fact]
    public void Read_BlockAboveVanillaRange_ReturnsUnknownRuntimeId()
    {
        // k = 800 covers id 760, so the payload size is decidable although the id is not vanilla for 326.
        var tile = SyntheticTileWorld.ReadSingle(Hex("22 f8 02"), frameCount: 800);

        Assert.Equal(new UnknownContentRef(760), tile.Block);
    }

    [Fact]
    public void Read_FrameImportantBits_ComeFromTheFileHeader()
    {
        int[] frameImportant = [9];

        var framed = SyntheticTileWorld.ReadSingle(Hex("02 09 08 00 10 00"), frameCount: 10, frameImportant: frameImportant);
        var unframed = SyntheticTileWorld.ReadSingle(Hex("02 04"), frameCount: 10, frameImportant: frameImportant);

        Assert.Equal(new Tile { Block = new VanillaContentRef(9), FrameX = 8, FrameY = 16 }, framed);
        Assert.Equal(new Tile { Block = new VanillaContentRef(4) }, unframed);
    }

    [Theory]
    [InlineData("22 f2 02", "no frame-important entry")]
    [InlineData("01 01 08", "flag without owner")]
    [InlineData("01 01 10", "flag without owner")]
    [InlineData("01 01 40", "flag without owner")]
    [InlineData("01 10", "flag without owner")]
    [InlineData("20", "flag without owner")]
    [InlineData("11 01 80 ff", null)]
    [InlineData("19 01 80 ff", null)]
    [InlineData("01 01 80", null)]
    [InlineData("03 60 01", null)]
    [InlineData("03 70 01", null)]
    [InlineData("04 00", null)]
    [InlineData("05 01 40 00 00", null)]
    [InlineData("03 80 01", "reserved bit")]
    [InlineData("03 01 01 01 01", "reserved bit")]
    [InlineData("03 01 01 20 01", "reserved bit")]
    [InlineData("03 01 01 80 01", "reserved bit")]
    [InlineData("07 13 3a 01", "truncated record")]
    public void Read_InvalidRecord_ThrowsMalformedTilesAtRecord(string bytes, string? reason)
    {
        var (file, tileStart) = SyntheticTileWorld.Build(1, 1, Hex(bytes));

        var error = ReadExpectingError(file);

        Error(error, 0, 0, tileStart, reason);
    }

    [Fact]
    public void Read_BlockIdNotCoveredByFrameCount_ThrowsMalformedTiles()
    {
        var (file, tileStart) = SyntheticTileWorld.Build(1, 1, Hex("22 00 01"), frameCount: 10, frameImportant: [9]);

        var error = ReadExpectingError(file);

        Error(error, 0, 0, tileStart, "no frame-important entry");
    }
}
