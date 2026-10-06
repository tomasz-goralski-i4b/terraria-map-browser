namespace Terraria.WorldCodec.Tests;

internal static class TileAssert
{
    public const string TilesSection = "Tiles";

    /// <summary>Hex digits, spaces allowed for readability.</summary>
    public static byte[] Hex(string hex) => Convert.FromHexString(hex.Replace(" ", string.Empty, StringComparison.Ordinal));

    public static void Error(WorldFormatException error, int x, int y, long offset, string? reason)
    {
        Assert.Equal(WorldFormatError.MalformedTiles, error.Error);
        Assert.Equal(TilesSection, error.Section);
        Assert.Equal(x, error.X);
        Assert.Equal(y, error.Y);
        Assert.Equal(offset, error.Offset);
        if (reason is not null)
        {
            Assert.Equal(reason, error.Reason);
        }
    }

    public static WorldFormatException ReadExpectingError(byte[] file) =>
        Assert.Throws<WorldFormatException>(() => SyntheticTileWorld.Read(file));
}
