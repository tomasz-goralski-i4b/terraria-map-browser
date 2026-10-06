namespace Terraria.WorldCodec.Tests;

/// <summary>TileGrid → CWM planes + palette (docs/cwm.md).</summary>
public sealed class CanonicalWorldModelTests
{
    [Fact]
    public void PlaneNames_Always_AreInCanonicalOrder()
    {
        Assert.Equal(
            ["block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags"],
            CanonicalWorldModel.PlaneNames);
    }

    [Theory]
    [InlineData("block", 2)]
    [InlineData("wall", 2)]
    [InlineData("frameX", 2)]
    [InlineData("frameY", 2)]
    [InlineData("paint", 1)]
    [InlineData("wallPaint", 1)]
    [InlineData("liquid", 1)]
    [InlineData("liquidAmount", 1)]
    [InlineData("shape", 1)]
    [InlineData("flags", 2)]
    public void ElementSize_KnownPlane_MatchesCwmType(string plane, int size)
    {
        Assert.Equal(size, CanonicalWorldModel.ElementSize(plane));
    }

    [Fact]
    public void ElementSize_UnknownPlane_ThrowsArgumentException()
    {
        Assert.ThrowsAny<ArgumentException>(() => CanonicalWorldModel.ElementSize("Block"));
    }

    [Fact]
    public void FromTileGrid_SnapshotWorld_KeepsDimensions()
    {
        var model = Convert(SummaryWorld.Snapshot());

        Assert.Equal(SummaryWorld.Width, model.Width);
        Assert.Equal(SummaryWorld.Height, model.Height);
    }

    [Fact]
    public void FromTileGrid_SnapshotWorld_PaletteInOrderOfFirstAppearanceBlockBeforeWall()
    {
        var model = Convert(SummaryWorld.Snapshot());

        ContentRef[] expected =
        [
            new VanillaContentRef(1),
            new VanillaContentRef(2),
            new UnknownContentRef(800),
            new UnknownContentRef(500),
            new VanillaContentRef(4),
        ];
        Assert.Equal(expected, model.Palette);
    }

    [Fact]
    public void FromTileGrid_BlockAndWallWithSameRef_ShareOnePaletteEntry()
    {
        var model = Convert(SummaryWorld.Snapshot());
        var block = model.GetPlane("block").Span;
        var wall = model.GetPlane("wall").Span;

        // (0, 0) has block vanilla 1, (1, 0) has wall vanilla 1: both point at palette index 0.
        Assert.Equal(new byte[] { 0x00, 0x00 }, block.Slice(SummaryWorld.Index(0, 0) * 2, 2).ToArray());
        Assert.Equal(new byte[] { 0x00, 0x00 }, wall.Slice(SummaryWorld.Index(1, 0) * 2, 2).ToArray());
        Assert.Single(model.Palette, entry => entry == new VanillaContentRef(1));
    }

    [Theory]
    [InlineData("block")]
    [InlineData("wall")]
    [InlineData("frameX")]
    [InlineData("frameY")]
    [InlineData("paint")]
    [InlineData("wallPaint")]
    [InlineData("liquid")]
    [InlineData("liquidAmount")]
    [InlineData("shape")]
    [InlineData("flags")]
    public void FromTileGrid_SnapshotWorld_PlaneBytesAreColumnMajorLittleEndian(string plane)
    {
        var model = Convert(SummaryWorld.Snapshot());

        var expected = SummaryWorld.ExpectedSnapshotPlanes()[plane];
        var actual = model.GetPlane(plane).ToArray();

        Assert.Equal(expected.Length, actual.Length);
        var firstDifference = Enumerable.Range(0, expected.Length).FirstOrDefault(i => expected[i] != actual[i], -1);
        Assert.True(firstDifference < 0, $"Plane '{plane}' differs first at byte {firstDifference}.");
    }

    [Fact]
    public void FromTileGrid_SingleEmptyTile_UsesSentinelsAndEmptyPalette()
    {
        var model = Convert(SummaryWorld.Build(1, 1));

        Assert.Empty(model.Palette);
        Assert.Equal(new byte[] { 0xFF, 0xFF }, model.GetPlane("block").ToArray());
        Assert.Equal(new byte[] { 0xFF, 0xFF }, model.GetPlane("wall").ToArray());
        Assert.Equal(new byte[] { 0xFF, 0xFF }, model.GetPlane("frameX").ToArray());
        Assert.Equal(new byte[] { 0xFF, 0xFF }, model.GetPlane("frameY").ToArray());
        foreach (var plane in new[] { "paint", "wallPaint", "liquid", "liquidAmount", "shape" })
        {
            Assert.Equal(new byte[] { 0x00 }, model.GetPlane(plane).ToArray());
        }

        Assert.Equal(new byte[] { 0x00, 0x00 }, model.GetPlane("flags").ToArray());
    }

    [Fact]
    public void GetPlane_UnknownPlane_ThrowsArgumentException()
    {
        var model = Convert(SummaryWorld.Build(1, 1));

        Assert.ThrowsAny<ArgumentException>(() => model.GetPlane("tiles"));
    }

    private static CanonicalWorldModel Convert(byte[] file) =>
        CanonicalWorldModel.FromTileGrid(SyntheticTileWorld.Read(file).Tiles);
}
