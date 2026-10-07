using System.Buffers.Binary;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Terraria.WorldInspector;

namespace Terraria.WorldCodec.Tests;

/// <summary>Exercises the shipped CLI entry point, exit codes, streams and read-only filesystem contract.</summary>
public sealed class InspectorCommandTests
{
    [Theory]
    [InlineData("inspect", false, false)]
    [InlineData("inspect", false, true)]
    [InlineData("export-json", false, false)]
    [InlineData("export-json", false, true)]
    [InlineData("diff", false, false)]
    [InlineData("diff", false, true)]
    [InlineData("diff", true, false)]
    [InlineData("diff", true, true)]
    public void Run_UnexpectedReaderException_ReturnsOneInternalErrorLine(
        string command, bool failingRight, bool invalidCast)
    {
        using var directory = new TemporaryDirectory();
        var bytes = SummaryWorld.Build(2, 4, metadata: new SyntheticMetadata { Name = "Forest Observatory" });
        var left = directory.Write("Forest Observatory.wld", bytes);
        var right = directory.Write("Crimson Coast.wld", bytes);
        string[] arguments = command == "diff" ? [command, left, right] : [command, left];
        var reads = 0;
        Terraria.WorldCodec.World ReadWorld(string path)
        {
            reads++;
            if (path == (failingRight ? right : left))
            {
                const string Message = "World summary conversion failed\n   at WorldSummary.Convert()\u001b[31m";
                throw invalidCast ? new InvalidCastException(Message) : new OverflowException(Message);
            }

            return SyntheticTileWorld.Read(bytes);
        }

        using var output = new StringWriter(CultureInfo.InvariantCulture);
        using var error = new StringWriter(CultureInfo.InvariantCulture);
        var exitCode = InspectorCommand.Run(arguments, output, error, ReadWorld);

        Assert.Equal(failingRight ? 2 : 1, reads);
        Assert.Equal(1, exitCode);
        Assert.Empty(output.ToString());
        var diagnostic = Assert.Single(error.ToString().Split('\n', StringSplitOptions.RemoveEmptyEntries));
        Assert.Contains("internal", diagnostic, StringComparison.OrdinalIgnoreCase);
        AssertNoStackTrace(error.ToString());
        Assert.DoesNotContain('\u001b', diagnostic);
        Assert.Equal(bytes, File.ReadAllBytes(left));
        Assert.Equal(bytes, File.ReadAllBytes(right));
    }

    [Theory]
    [InlineData("\n", "\\u000a")]
    [InlineData("\r", "\\u000d")]
    [InlineData("\t", "\\u0009")]
    [InlineData("\u001b", "\\u001b")]
    [InlineData("\u0000", "\\u0000")]
    [InlineData("\u0085", "\\u0085")]
    [InlineData("\u2028", "\\u2028")]
    [InlineData("\u2029", "\\u2029")]
    [InlineData("\u061c", "\\u061c")]
    [InlineData("\u200e", "\\u200e")]
    [InlineData("\u200f", "\\u200f")]
    [InlineData("\u202a", "\\u202a")]
    [InlineData("\u202b", "\\u202b")]
    [InlineData("\u202c", "\\u202c")]
    [InlineData("\u202d", "\\u202d")]
    [InlineData("\u202e", "\\u202e")]
    [InlineData("\u2066", "\\u2066")]
    [InlineData("\u2067", "\\u2067")]
    [InlineData("\u2068", "\\u2068")]
    [InlineData("\u2069", "\\u2069")]
    public async Task Inspect_ControlCharactersInNameAndSeed_ReportsLiteralUnicodeEscapes(string control, string escaped)
    {
        using var directory = new InspectorDirectory();
        var metadata = new SyntheticMetadata { Name = $"Crimson Coast{control}Blocks: 999", Seed = $"94858{control}0918" };
        var bytes = BuildWorld(metadata, "42 01 03 4c 04 ff 01 10 00 00");
        var path = directory.WriteWorld(bytes);

        var result = await RunAsync(directory.Path, "inspect", path);

        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        var lines = result.Output.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(line => line.TrimEnd('\r')).ToArray();
        Assert.Contains($"Name: Crimson Coast{escaped}Blocks: 999", lines, StringComparer.OrdinalIgnoreCase);
        Assert.Contains($"Seed: 94858{escaped}0918", lines, StringComparer.OrdinalIgnoreCase);
        Assert.Equal("Blocks: 4", Assert.Single(lines, line => line.StartsWith("Blocks:", StringComparison.Ordinal)));
        Assert.Equal(12, lines.Length);
        Assert.Equal(bytes, File.ReadAllBytes(path));
    }

    [Fact]
    public async Task Inspect_AllControlCharactersInNameAndSeed_EscapesEveryControl()
    {
        using var directory = new InspectorDirectory();
        var controls = new string(Enumerable.Range(0, 0xa0).Select(value => (char)value).Where(char.IsControl).ToArray());
        var escaped = string.Concat(controls.Select(character => "\\u" + ((int)character).ToString("x4", CultureInfo.InvariantCulture)));
        var metadata = new SyntheticMetadata { Name = "Crimson Coast" + controls, Seed = "948580918" + controls };
        var path = directory.WriteWorld(BuildWorld(metadata, "40 03 40 03"));

        var result = await RunAsync(directory.Path, "inspect", path);

        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        Assert.Contains("Name: Crimson Coast" + escaped, result.Output, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Seed: 948580918" + escaped, result.Output, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(result.Output, character => char.IsControl(character) && character is not '\r' and not '\n');
    }

    [Fact]
    public async Task Inspect_PrintableUnicodeNameAndSeed_KeepsTextReadable()
    {
        using var directory = new InspectorDirectory();
        var metadata = new SyntheticMetadata { Name = "Crimson Éclipse — 海岸 🌊", Seed = "Forêt-海岸-948580918" };
        var path = directory.WriteWorld(BuildWorld(metadata, "40 03 40 03"));

        var result = await RunAsync(directory.Path, "inspect", path);

        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        AssertField(result.Output, "Name", metadata.Name);
        AssertField(result.Output, "Seed", metadata.Seed);
    }

    [Theory]
    [InlineData("inspect", false, false)]
    [InlineData("inspect", false, true)]
    [InlineData("export-json", false, false)]
    [InlineData("export-json", false, true)]
    [InlineData("diff", false, false)]
    [InlineData("diff", false, true)]
    [InlineData("diff", true, false)]
    [InlineData("diff", true, true)]
    public async Task Run_ExpectedReadError_KeepsSpecificDiagnosticAndInputs(
        string command, bool failingRight, bool truncated)
    {
        using var directory = new TemporaryDirectory();
        var bytes = SummaryWorld.Build(2, 4, metadata: new SyntheticMetadata { Name = "Forest Observatory" });
        var valid = directory.Write("Forest Observatory.wld", bytes);
        byte[] incomplete = [0x46, 0x01];
        var failing = truncated ? directory.Write("Truncated Coast.wld", incomplete)
            : System.IO.Path.Combine(directory.Path, "Missing Coast.wld");
        var filesBefore = Directory.GetFiles(directory.Path);
        string[] arguments = command == "diff"
            ? [command, failingRight ? valid : failing, failingRight ? failing : valid]
            : [command, failing];

        var result = await RunAsync(directory.Path, arguments);

        Assert.Equal(1, result.ExitCode);
        Assert.Empty(result.Output);
        Assert.Contains(System.IO.Path.GetFileName(failing), result.Error, StringComparison.Ordinal);
        if (truncated)
        {
            Assert.Contains("Truncated", result.Error, StringComparison.OrdinalIgnoreCase);
            Assert.Equal(incomplete, File.ReadAllBytes(failing));
        }
        else
        {
            Assert.Matches("(?i)(not found|could not find|does not exist|no such file|missing)", result.Error);
        }

        if (command == "diff")
        {
            Assert.Contains(failingRight ? "right" : "left", result.Error, StringComparison.OrdinalIgnoreCase);
        }

        Assert.DoesNotContain("internal", result.Error, StringComparison.OrdinalIgnoreCase);
        AssertNoStackTrace(result.Error);
        Assert.Equal(bytes, File.ReadAllBytes(valid));
        Assert.Equal(filesBefore, Directory.GetFiles(directory.Path));
    }

    [Theory]
    [InlineData("inspect")]
    [InlineData("export-json")]
    [InlineData("diff")]
    public async Task Run_MissingCommandInputs_ReturnsArgumentExitCode(string command)
    {
        using var directory = new InspectorDirectory();
        var result = await RunAsync(directory.Path, command);

        Assert.Equal(2, result.ExitCode);
        Assert.Empty(result.Output);
        Assert.Contains("usage", result.Error, StringComparison.OrdinalIgnoreCase);
        AssertNoStackTrace(result.Error);
    }

    [Fact]
    public async Task Run_ExistingCommands_PreservesInputsAndJsonTextWithDiffExitCode()
    {
        using var directory = new TemporaryDirectory();
        var metadata = new SyntheticMetadata { Name = "Crimson Éclipse\nBlocks: 999\u001b", Seed = "94858\r\t0918" };
        var leftBytes = SummaryWorld.Build(2, 4, metadata: metadata);
        var rightBytes = SummaryWorld.Build(2, 4, metadata: new SyntheticMetadata { Name = "Quiet Meadow" });
        var left = directory.Write("Crimson Coast.wld", leftBytes);
        var right = directory.Write("Quiet Meadow.wld", rightBytes);
        var filesBefore = Directory.GetFiles(directory.Path);

        var inspect = await InspectorProcess.RunAsync(directory.Path, "inspect", left);
        var export = await InspectorProcess.RunAsync(directory.Path, "export-json", left);
        var diff = await InspectorProcess.RunAsync(directory.Path, "diff", left, right);

        Assert.Equal(0, inspect.ExitCode);
        Assert.Empty(inspect.Error);
        Assert.Equal(0, export.ExitCode);
        Assert.Empty(export.Error);
        using var json = JsonDocument.Parse(export.Output);
        Assert.Equal(metadata.Name, json.RootElement.GetProperty("metadata").GetProperty("name").GetString());
        Assert.Equal(metadata.Seed, json.RootElement.GetProperty("metadata").GetProperty("seed").GetString());
        Assert.Equal(3, diff.ExitCode);
        Assert.Empty(diff.Error);
        Assert.NotEmpty(diff.Output);
        Assert.Equal(leftBytes, File.ReadAllBytes(left));
        Assert.Equal(rightBytes, File.ReadAllBytes(right));
        Assert.Equal(filesBefore, Directory.GetFiles(directory.Path));
    }

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

    [Theory]
    [InlineData("inspect", false)]
    [InlineData("export-json", false)]
    [InlineData("diff", false)]
    [InlineData("diff", true)]
    public void Run_PostReadConversionFailure_ReturnsOneInternalErrorLine(string command, bool failingRight)
    {
        var world = SyntheticTileWorld.Read(SummaryWorld.Build(2, 4,
            metadata: new SyntheticMetadata { Name = "Forest Observatory" }));
        var failedWorld = world with { SkippedSections = new UnavailableSkippedSections() };
        const string Left = "Forest Observatory.wld";
        const string Right = "Crimson Coast.wld";
        string[] arguments = command == "diff" ? [command, Left, Right] : [command, Left];
        var reads = 0;
        World ReadWorld(string path)
        {
            reads++;
            return path == (failingRight ? Right : Left) ? failedWorld : world;
        }

        using var output = new StringWriter(CultureInfo.InvariantCulture);
        using var error = new StringWriter(CultureInfo.InvariantCulture);

        var exitCode = InspectorCommand.Run(arguments, output, error, ReadWorld);

        Assert.Equal(command == "diff" ? 2 : 1, reads);
        Assert.Equal(1, exitCode);
        Assert.Empty(output.ToString());
        Assert.Equal("Internal error: could not complete the command." + error.NewLine, error.ToString());
    }

    [Theory]
    [InlineData("inspect")]
    [InlineData("export-json")]
    [InlineData("diff")]
    public void Run_ReaderOutOfMemoryException_PropagatesWithoutDiagnostic(string command)
    {
        const string Left = "Forest Observatory.wld";
        const string Right = "Crimson Coast.wld";
        string[] arguments = command == "diff" ? [command, Left, Right] : [command, Left];
        // Simulate resource exhaustion without exhausting the test runner's actual memory.
#pragma warning disable CA2201 // The runtime exception is deliberately injected to test the CLI fatal-error boundary.
        var failure = new OutOfMemoryException("Could not allocate world tile planes.");
#pragma warning restore CA2201
        using var output = new StringWriter(CultureInfo.InvariantCulture);
        using var error = new StringWriter(CultureInfo.InvariantCulture);

        var thrown = Assert.Throws<OutOfMemoryException>(() =>
            InspectorCommand.Run(arguments, output, error, _ => throw failure));

        Assert.Same(failure, thrown);
        Assert.Empty(output.ToString());
        Assert.Empty(error.ToString());
    }

    // Simulates a decoded world's section collection becoming unavailable during conversion.
    private sealed class UnavailableSkippedSections : IReadOnlyList<SkippedSection>
    {
        public int Count => throw new InvalidOperationException("Skipped-section summary is unavailable.");

        public SkippedSection this[int index] => throw new InvalidOperationException("Skipped-section summary is unavailable.");

        public IEnumerator<SkippedSection> GetEnumerator() =>
            throw new InvalidOperationException("Skipped-section summary is unavailable.");

        System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
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
