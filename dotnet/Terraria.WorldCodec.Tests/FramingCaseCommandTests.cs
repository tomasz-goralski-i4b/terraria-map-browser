using System.Security.Cryptography;
using System.Text.Json;

namespace Terraria.WorldCodec.Tests;

public sealed class FramingCaseCommandTests
{
    [Fact]
    public async Task Case_SavedObservationWorld_RequiresExplicitChangedWorldFlag()
    {
        using var directory = new TemporaryDirectory();
        var generated = WorldWriterTests.Build(2, 4, TileAssert.Hex("42 01 03 40 03"));
        var saved = WorldWriterTests.Build(2, 4, TileAssert.Hex("42 01 02 00 40 03"));
        var worldPath = directory.Write("stone-column-after-observation.wld", saved);
        var manifestPath = directory.Write("stone-column.wld.manifest.json", JsonSerializer.SerializeToUtf8Bytes(new
        {
            outputHash = Convert.ToHexStringLower(SHA256.HashData(generated)),
            cases = new[] { new { id = "Stone-column", section = "Blocks", title = "Stone column", x = 0, y = 0, width = 2, height = 4, expected = "to observe" } },
        }));

        Assert.Equal(1, (await InspectorProcess.RunAsync(directory.Path, "case", worldPath, manifestPath, "Stone-column")).ExitCode);
        var result = await InspectorProcess.RunAsync(directory.Path, "case", worldPath, manifestPath, "Stone-column", "--allow-changed-world");
        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        Assert.Contains("hash differs", result.OutputText, StringComparison.Ordinal);
        Assert.Contains("(0,3) block=air", result.OutputText, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(-1, 0, 2, 4)]
    [InlineData(0, 0, 3, 4)]
    [InlineData(0, 0, 2, 0)]
    [InlineData(0, int.MaxValue, 2, 4)]
    public async Task Case_InvalidManifestCoordinates_ReturnsDiagnosticWithEmptyOutput(int x, int y, int width, int height)
    {
        using var directory = new TemporaryDirectory();
        var bytes = WorldWriterTests.Build(2, 4, TileAssert.Hex("42 01 03 40 03"));
        var worldPath = directory.Write("stone-column.wld", bytes);
        var manifestPath = directory.Write("stone-column.wld.manifest.json", JsonSerializer.SerializeToUtf8Bytes(new
        {
            outputHash = Convert.ToHexStringLower(SHA256.HashData(bytes)),
            cases = new[] { new { id = "Stone-column", section = "Blocks", title = "Stone column", x, y, width, height, expected = "to observe" } },
        }));

        var result = await InspectorProcess.RunAsync(directory.Path, "case", worldPath, manifestPath, "Stone-column");
        Assert.Equal(1, result.ExitCode);
        Assert.Empty(result.Output);
        Assert.Single(result.Error.TrimEnd().Split('\n'));
    }
}
