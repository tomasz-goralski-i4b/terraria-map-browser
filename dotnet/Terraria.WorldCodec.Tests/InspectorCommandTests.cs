using System.Buffers.Binary;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Terraria.WorldCodec.Tests;

/// <summary>Exercises the shipped CLI entry point, exit codes, streams and read-only filesystem contract.</summary>
public sealed class InspectorCommandTests
{
    [Theory]
    [InlineData("Forest Observatory", "948580918", 1743427911, 0, 0, "Classic", "Corruption")]
    [InlineData("Crimson Éclipse", "620104273", 620104273, 2, 1, "Master", "Crimson")]
    public async Task Inspect_SyntheticWorld_ReportsReadMetadataAndExpandedCounters(
        string name, string seed, int worldId, int gameMode, byte crimson, string mode, string evil)
    {
        using var directory = new InspectorDirectory();
        var metadata = new SyntheticMetadata
        {
            Name = name, Seed = seed, WorldId = worldId, GameMode = gameMode, Crimson = crimson,
        };
        // Column 0: stone ×4. Column 1: wall+water ×2, zero-amount lava, empty.
        var path = directory.WriteWorld(BuildWorld(metadata, "42 01 03 4c 04 ff 01 10 00 00"));
        var world = SyntheticTileWorld.Read(File.ReadAllBytes(path));
        Assert.Equal(name, world.Metadata.Name);
        var decodedTiles = Enumerable.Range(0, 2)
            .SelectMany(x => Enumerable.Range(0, 4).Select(y => world.Tiles[x, y])).ToArray();
        Assert.Equal(4, decodedTiles.Count(tile => tile.Block is not null));
        Assert.Equal(2, decodedTiles.Count(tile => tile.Wall is not null));
        Assert.Equal(3, decodedTiles.Count(tile => tile.Liquid is not null));

        var result = await RunAsync(directory.Path, "inspect", path);

        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        AssertField(result.Output, "Version", "326");
        AssertField(result.Output, "Name", name);
        AssertField(result.Output, "World[ _]?ID", worldId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        AssertField(result.Output, "Seed", seed);
        AssertField(result.Output, "(?:Game[ _]?)?Mode", mode);
        AssertField(result.Output, "Evil", evil);
        Assert.Matches(@"(?im)^\s*Dimensions\s*:\s*2\s*[×x]\s*4\s*$", result.Output);
        AssertCounters(result.Output, 8, 4, 2, 3);
        AssertSkippedSections(result.Output);
    }

    [Fact]
    public async Task Inspect_EmptyTileWorld_ReportsZeroContentCounters()
    {
        using var directory = new InspectorDirectory();
        var metadata = new SyntheticMetadata { Name = "Quiet Meadow", Width = 3, Height = 2 };
        var path = directory.WriteWorld(BuildWorld(metadata, "40 01 40 01 40 01"));
        var world = SyntheticTileWorld.Read(File.ReadAllBytes(path));
        Assert.Equal(3, world.Tiles.Width);
        Assert.Equal(2, world.Tiles.Height);

        var result = await RunAsync(directory.Path, "inspect", path);

        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        Assert.Matches(@"(?im)^\s*Dimensions\s*:\s*3\s*[×x]\s*2\s*$", result.Output);
        AssertCounters(result.Output, 6, 0, 0, 0);
    }

    public static TheoryData<string[]> InvalidArguments() =>
    [
        Array.Empty<string>(),
        new[] { "inspect" },
        new[] { "inspect", "Forest Observatory.wld", "Crimson Eclipse.wld" },
        new[] { "survey", "Forest Observatory.wld" },
    ];

    [Theory]
    [MemberData(nameof(InvalidArguments))]
    public async Task Inspect_InvalidArguments_ReturnsUsageOnStderr(string[] arguments)
    {
        using var directory = new InspectorDirectory();

        var result = await RunAsync(directory.Path, arguments);

        Assert.Equal(2, result.ExitCode);
        Assert.Empty(result.Output);
        Assert.Contains("usage", result.Error, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("inspect", result.Error, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(".wld", result.Error, StringComparison.OrdinalIgnoreCase);
        AssertNoStackTrace(result.Error);
    }

    [Fact]
    public async Task Inspect_MissingFile_ReturnsReadableIoErrorWithoutReport()
    {
        using var directory = new InspectorDirectory();
        var path = System.IO.Path.Combine(directory.Path, "Missing Forest.wld");

        var result = await RunAsync(directory.Path, "inspect", path);

        Assert.Equal(1, result.ExitCode);
        Assert.Empty(result.Output);
        Assert.Contains("Missing Forest.wld", result.Error, StringComparison.Ordinal);
        Assert.Matches("(?i)(not found|could not find|does not exist|no such file|missing)", result.Error);
        AssertNoStackTrace(result.Error);
        Assert.Empty(Directory.GetFiles(directory.Path));
    }

    [Theory]
    [InlineData("truncated", "Truncated")]
    [InlineData("unsupported", "Unsupported")]
    [InlineData("metadata", "height")]
    [InlineData("tiles", "tiles")]
    public async Task Inspect_InvalidWorld_ReturnsReadableFormatErrorWithoutReport(string corruption, string diagnostic)
    {
        using var directory = new InspectorDirectory();
        var path = directory.WriteWorld(BuildInvalidWorld(corruption));

        var result = await RunAsync(directory.Path, "inspect", path);

        Assert.Equal(1, result.ExitCode);
        Assert.Empty(result.Output);
        Assert.Contains(diagnostic, result.Error, StringComparison.OrdinalIgnoreCase);
        AssertNoStackTrace(result.Error);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Inspect_SuccessOrFormatFailure_PreservesInputHashAndCreatesNoFiles(bool malformedTiles)
    {
        using var directory = new InspectorDirectory();
        var bytes = malformedTiles
            ? BuildInvalidWorld("tiles")
            : BuildWorld(new SyntheticMetadata { Name = "Forest Observatory" }, "42 01 03 00 48 ff 02");
        var path = directory.WriteWorld(bytes);
        var hashBefore = SHA256.HashData(File.ReadAllBytes(path));
        var filesBefore = Directory.GetFiles(directory.Path, "*", SearchOption.AllDirectories);

        var result = await RunAsync(directory.Path, "inspect", path);

        Assert.Equal(hashBefore, SHA256.HashData(File.ReadAllBytes(path)));
        Assert.Equal(filesBefore, Directory.GetFiles(directory.Path, "*", SearchOption.AllDirectories));
        Assert.Equal(malformedTiles ? 1 : 0, result.ExitCode);
    }

    private static byte[] BuildWorld(SyntheticMetadata metadata, string tileHex)
    {
        var tiles = TileAssert.Hex(tileHex);
        var metadataBytes = metadata.Build().Bytes;
        var bytes = SyntheticWorld.Build(metadataBytes, tiles.Length);
        tiles.CopyTo(bytes, SyntheticWorld.MetadataStart + metadataBytes.Length);
        return bytes;
    }

    private static byte[] BuildInvalidWorld(string corruption)
    {
        if (corruption == "truncated")
        {
            return [0x46, 0x01];
        }

        var metadata = new SyntheticMetadata { Name = "Forest Observatory", Height = corruption == "metadata" ? 0 : 4 };
        var bytes = BuildWorld(metadata, corruption == "tiles" ? "42 01 04" : "42 01 03 00 48 ff 02");
        if (corruption == "unsupported")
        {
            BinaryPrimitives.WriteInt32LittleEndian(bytes, 327);
        }

        return bytes;
    }

    private static void AssertCounters(string report, int tiles, int blocks, int walls, int liquids)
    {
        AssertField(report, "Tiles", tiles.ToString(System.Globalization.CultureInfo.InvariantCulture));
        AssertField(report, "Blocks", blocks.ToString(System.Globalization.CultureInfo.InvariantCulture));
        AssertField(report, "Walls", walls.ToString(System.Globalization.CultureInfo.InvariantCulture));
        AssertField(report, "Liquids", liquids.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    private static void AssertField(string report, string labelPattern, string value) =>
        Assert.Matches($@"(?im)^\s*{labelPattern}\s*:\s*{Regex.Escape(value)}\s*$", report);

    private static void AssertSkippedSections(string report)
    {
        var skipped = Regex.Match(report, @"(?is)Skipped\s+sections\s*:(.*)");
        Assert.True(skipped.Success, "The report must identify sections as skipped.");
        string[] names =
        [
            "Chests", "Signs", "NpcsAndMobs", "TileEntities", "WeightedPressurePlates",
            "TownManager", "Bestiary", "CreativePowers", "Footer",
        ];
        Assert.All(names, name => Assert.Contains(name, skipped.Groups[1].Value, StringComparison.OrdinalIgnoreCase));
    }

    private static void AssertNoStackTrace(string error)
    {
        Assert.False(string.IsNullOrWhiteSpace(error));
        Assert.DoesNotContain("Unhandled exception", error, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotMatch(@"(?m)^\s+at\s+", error);
        Assert.DoesNotMatch(@"(?i)\.cs:line\s+\d+", error);
    }

    private static async Task<CommandResult> RunAsync(string workingDirectory, params string[] arguments)
    {
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
        {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add(System.IO.Path.Combine(AppContext.BaseDirectory, "Terraria.WorldInspector.dll"));
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }

        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not launch the inspector.");
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw;
        }

        return new CommandResult(process.ExitCode, await output, await error);
    }

    private sealed record CommandResult(int ExitCode, string Output, string Error);

    private sealed class InspectorDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"terraria-inspector-{Guid.NewGuid():N}");

        public InspectorDirectory() => Directory.CreateDirectory(Path);

        public string WriteWorld(byte[] bytes)
        {
            var path = System.IO.Path.Combine(Path, "Forest Observatory.wld");
            File.WriteAllBytes(path, bytes);
            return path;
        }

        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
