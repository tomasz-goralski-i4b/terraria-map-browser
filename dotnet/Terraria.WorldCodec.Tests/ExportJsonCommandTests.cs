using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Terraria.WorldInspector;

namespace Terraria.WorldCodec.Tests;

/// <summary><c>export-json</c>: world summary + chunk digests (docs/cwm.md, contracts/schemas/world-summary.v1.schema.json).</summary>
public sealed class ExportJsonCommandTests
{
    private const string Command = "export-json";
    private const string WorldFileName = "Forest Observatory.wld";

    private static readonly string[] Planes =
        ["block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags"];

    [Fact]
    public async Task ExportJson_SnapshotWorld_MatchesApprovedSnapshot()
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, SummaryWorld.Snapshot());

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path);

        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        Assert.Equal(SummaryWorld.Text(ApprovedSnapshot()), result.OutputText);
        Assert.Equal(ApprovedSnapshot(), result.Output);
    }

    [Fact]
    public async Task ExportJson_SnapshotWorld_ValidatesAgainstSchemaWithEverySummaryPart()
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, SummaryWorld.Snapshot());

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path);

        Assert.Equal(0, result.ExitCode);
        Schema().AssertValid(result.Output);
        using var document = JsonDocument.Parse(result.Output);
        var root = document.RootElement;
        Assert.Equal(
            ["schemaVersion", "formatVersion", "metadata", "dimensions", "skippedSections", "palette", "chunks"],
            root.EnumerateObject().Select(property => property.Name));
        Assert.Equal(1, root.GetProperty("schemaVersion").GetInt32());
        Assert.Equal(326, root.GetProperty("formatVersion").GetInt32());
        var metadata = root.GetProperty("metadata");
        Assert.Equal("Synthetic", metadata.GetProperty("name").GetString());
        Assert.Equal("948580918", metadata.GetProperty("seed").GetString());
        Assert.Equal("87e466e7853c3f48b75abc85e36d4b86", metadata.GetProperty("guid").GetString());
        Assert.Equal(1743427911, metadata.GetProperty("worldId").GetInt32());
        Assert.Equal(0, metadata.GetProperty("gameMode").GetInt32());
        Assert.Equal("corruption", metadata.GetProperty("evil").GetString());
        Assert.Equal(SummaryWorld.Width, root.GetProperty("dimensions").GetProperty("width").GetInt32());
        Assert.Equal(SummaryWorld.Height, root.GetProperty("dimensions").GetProperty("height").GetInt32());
        Assert.Equal(
            ["chests", "signs", "npcsAndMobs", "tileEntities", "weightedPressurePlates", "townManager", "bestiary", "creativePowers", "footer"],
            root.GetProperty("skippedSections").EnumerateArray().Select(section => section.GetProperty("name").GetString()));
        Assert.Equal(5, root.GetProperty("palette").GetArrayLength());
        Assert.Equal(Planes, root.GetProperty("chunks").GetProperty("planes").EnumerateArray().Select(plane => plane.GetString()));
    }

    [Fact]
    public async Task ExportJson_SnapshotWorld_ChunksOrderedByXThenYWithSmallerEdgeChunks()
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, SummaryWorld.Snapshot());

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path);

        Assert.Equal(0, result.ExitCode);
        using var document = JsonDocument.Parse(result.Output);
        var chunks = document.RootElement.GetProperty("chunks");
        Assert.Equal(128, chunks.GetProperty("size").GetInt32());
        var layout = chunks.GetProperty("digests").EnumerateArray()
            .Select(chunk => string.Create(
                CultureInfo.InvariantCulture,
                $"{chunk.GetProperty("x").GetInt32()},{chunk.GetProperty("y").GetInt32()} {chunk.GetProperty("width").GetInt32()}x{chunk.GetProperty("height").GetInt32()}"));
        Assert.Equal(["0,0 128x128", "0,1 128x1", "1,0 2x128", "1,1 2x1"], layout);
    }

    [Fact]
    public async Task ExportJson_SnapshotWorld_DigestsAreTruncatedSha256OfChunkPlaneBytes()
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, SummaryWorld.Snapshot());
        var expected = SummaryWorld.Digests(SummaryWorld.ExpectedSnapshotPlanes(), SummaryWorld.Width, SummaryWorld.Height);

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path);

        Assert.Equal(0, result.ExitCode);
        Assert.Equal(expected.OrderBy(pair => pair.Key, StringComparer.Ordinal), DigestsOf(result.Output).OrderBy(pair => pair.Key, StringComparer.Ordinal));
    }

    [Fact]
    public async Task ExportJson_SameBytesTwice_IsByteIdenticalAndFreeOfPaths()
    {
        using var first = new TemporaryDirectory();
        using var second = new TemporaryDirectory();
        var bytes = SummaryWorld.Snapshot();
        var firstPath = first.Write(WorldFileName, bytes);
        var secondPath = second.Write("Copy of Meadow.wld", bytes);

        var firstResult = await InspectorProcess.RunAsync(first.Path, Command, firstPath);
        var secondResult = await InspectorProcess.RunAsync(second.Path, Command, secondPath);

        Assert.Equal(0, firstResult.ExitCode);
        Assert.Equal(0, secondResult.ExitCode);
        Assert.Equal(firstResult.Output, secondResult.Output);
        var text = firstResult.OutputText;
        Assert.DoesNotContain("Forest Observatory", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(Path.GetFileName(first.Path), text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(Path.GetFileName(second.Path), text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ExportJson_SnapshotWorld_IsUtf8WithLfAndOneTrailingNewline()
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, SummaryWorld.Snapshot());

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path);

        Assert.Equal(0, result.ExitCode);
        Assert.NotEmpty(result.Output);
        Assert.Equal((byte)'{', result.Output[0]);
        Assert.DoesNotContain((byte)'\r', result.Output);
        Assert.EndsWith("}\n", result.OutputText, StringComparison.Ordinal);
        Assert.False(result.OutputText.EndsWith("\n\n", StringComparison.Ordinal), "Exactly one trailing newline.");
    }

    [Fact]
    public async Task ExportJson_NonAsciiMetadata_IsWrittenAsUtf8NotEscaped()
    {
        using var directory = new TemporaryDirectory();
        var metadata = new SyntheticMetadata
        {
            Name = "Crimson Éclipse", Seed = "620104273", WorldId = 620104273, GameMode = 2, Crimson = 1, Width = 3, Height = 2,
        };
        var path = directory.Write(WorldFileName, SummaryWorld.Build(3, 2, metadata: metadata));

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path);

        Assert.Equal(0, result.ExitCode);
        Assert.Contains("\"Crimson Éclipse\"", result.OutputText, StringComparison.Ordinal);
        Schema().AssertValid(result.Output);
        using var document = JsonDocument.Parse(result.Output);
        var parsed = document.RootElement.GetProperty("metadata");
        Assert.Equal(2, parsed.GetProperty("gameMode").GetInt32());
        Assert.Equal("crimson", parsed.GetProperty("evil").GetString());
        Assert.Empty(document.RootElement.GetProperty("palette").EnumerateArray());
        Assert.Single(document.RootElement.GetProperty("chunks").GetProperty("digests").EnumerateArray());
    }

    [Fact]
    public void Write_UnderPlPlAndEnUs_IsByteIdenticalToApprovedSnapshot()
    {
        var world = SyntheticTileWorld.Read(SummaryWorld.Snapshot());

        var polish = WriteUnder("pl-PL", world);
        var english = WriteUnder("en-US", world);

        Assert.Equal(polish, english);
        Assert.Equal(SummaryWorld.Text(ApprovedSnapshot()), SummaryWorld.Text(polish));
    }

    public static TheoryData<string, int, string, string, string> OneTileChanges() => new()
    {
        // Name, column, new column hex, chunk and plane whose digest must change.
        { "wall removed at (2, 3)", 2, "40 02 03 18 02 40 7c", "0,0", "wall" },
        { "paint 3 → 9 at (129, 128)", 129, "40 7f 0b 03 0b 0a 04 12 00 2c 00 09 c8", "1,1", "paint" },
        { "honey → lava at (64, 128)", 64, "40 7d 58 ff 01 10 ff", "0,1", "liquid" },
    };

    [Theory]
    [MemberData(nameof(OneTileChanges))]
    public void Write_OneTileChanged_ChangesExactlyOneChunkDigestPerAffectedPlane(
        string change, int column, string columnHex, string chunk, string plane)
    {
        var before = WriteToBytes(SyntheticTileWorld.Read(SummaryWorld.Snapshot()));
        var after = WriteToBytes(SyntheticTileWorld.Read(SummaryWorld.SnapshotWith(new Dictionary<int, string> { [column] = columnHex })));

        var beforeDigests = DigestsOf(before);
        var afterDigests = DigestsOf(after);
        Assert.Equal(beforeDigests.Keys.Order(StringComparer.Ordinal), afterDigests.Keys.Order(StringComparer.Ordinal));
        var changed = beforeDigests.Keys.Where(key => beforeDigests[key] != afterDigests[key]).Order(StringComparer.Ordinal);
        Assert.True(changed.SequenceEqual([$"{chunk}/{plane}"]), $"{change}: changed digests {string.Join(", ", changed)}");
        using var beforeDocument = JsonDocument.Parse(before);
        using var afterDocument = JsonDocument.Parse(after);
        Assert.True(JsonElement.DeepEquals(beforeDocument.RootElement.GetProperty("palette"), afterDocument.RootElement.GetProperty("palette")));
    }

    [Fact]
    public async Task ExportJson_Region_ReturnsSemanticTilesInXThenYOrder()
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, SummaryWorld.Snapshot());

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path, "--region", "127,0,3,6");

        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        Schema().AssertValid(result.Output);
        var root = JsonNode.Parse(result.Output)!.AsObject();
        var region = root["region"]!.AsObject();
        Assert.Equal(
            """{"x":127,"y":0,"width":3,"height":6}""",
            new JsonObject(region.Where(pair => pair.Key != "tiles").Select(pair => KeyValuePair.Create(pair.Key, pair.Value?.DeepClone()))).ToJsonString());
        var tiles = region["tiles"]!.AsArray();
        Assert.Equal(
            Enumerable.Range(127, 3).SelectMany(x => Enumerable.Range(0, 6).Select(y => $"{x},{y}")),
            tiles.Select(tile => $"{tile!["x"]},{tile["y"]}"));
        Assert.Equal("""{"x":127,"y":0,"wires":0,"actuator":false,"liquid":{"kind":"shimmer","amount":16}}""", tiles[0]!.ToJsonString());
        Assert.Equal("""{"x":127,"y":1,"wires":0,"actuator":false}""", tiles[1]!.ToJsonString());
        Assert.Equal(
            """{"x":128,"y":5,"block":{"kind":"unknown","runtimeId":800},"wall":{"kind":"unknown","runtimeId":500},"wallPaint":7,"wires":10,"actuator":false,"liquid":{"kind":"lava","amount":64},"shape":"slopeBottomLeft","inactive":true,"invisibleWall":true,"fullBrightBlock":true}""",
            tiles[11]!.ToJsonString());

        // The summary part is the same as without --region.
        root.Remove("region");
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(ApprovedSnapshot()), root), "The summary must not change with --region.");
        Assert.Equal(
            ["schemaVersion", "formatVersion", "metadata", "dimensions", "skippedSections", "palette", "chunks", "region"],
            JsonNode.Parse(result.Output)!.AsObject().Select(pair => pair.Key));
    }

    [Fact]
    public async Task ExportJson_RegionOfOneTile_ReportsEveryPresentField()
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, SummaryWorld.Snapshot());

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path, "--region", "129,128,1,1");

        Assert.Equal(0, result.ExitCode);
        Schema().AssertValid(result.Output);
        var tiles = JsonNode.Parse(result.Output)!["region"]!["tiles"]!.AsArray();
        Assert.Equal(
            """[{"x":129,"y":128,"block":{"kind":"vanilla","id":4},"frameX":18,"frameY":44,"paint":3,"wires":1,"actuator":true,"liquid":{"kind":"water","amount":200},"invisibleBlock":true,"fullBrightBlock":true}]""",
            tiles.ToJsonString());
    }

    [Fact]
    public async Task ExportJson_RegionOfBlockAndWall_ReportsBothRefsAndShape()
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, SummaryWorld.Snapshot());

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path, "--region", "2,3,1,1");

        Assert.Equal(0, result.ExitCode);
        var tiles = JsonNode.Parse(result.Output)!["region"]!["tiles"]!.AsArray();
        Assert.Equal(
            """[{"x":2,"y":3,"block":{"kind":"vanilla","id":2},"wall":{"kind":"vanilla","id":2},"wires":4,"actuator":false,"shape":"half"}]""",
            tiles.ToJsonString());
    }

    [Fact]
    public async Task ExportJson_RegionOfMaximumSize_ReturnsAllTiles()
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, SummaryWorld.Build(300, 300));

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path, "--region", "44,44,256,256");

        Assert.Equal(0, result.ExitCode);
        Schema().AssertValid(result.Output);
        var tiles = JsonNode.Parse(result.Output)!["region"]!["tiles"]!.AsArray();
        Assert.Equal(256 * 256, tiles.Count);
        Assert.Equal("""{"x":299,"y":299,"wires":0,"actuator":false}""", tiles[^1]!.ToJsonString());
    }

    [Theory]
    // Not fully inside the 130 × 129 world, or empty.
    [InlineData(130, 129, "129,0,2,1")]
    [InlineData(130, 129, "0,128,1,2")]
    [InlineData(130, 129, "130,0,1,1")]
    [InlineData(130, 129, "0,129,1,1")]
    [InlineData(130, 129, "-1,0,1,1")]
    [InlineData(130, 129, "0,-1,1,1")]
    [InlineData(130, 129, "0,0,0,1")]
    [InlineData(130, 129, "0,0,1,0")]
    [InlineData(130, 129, "0,0,1,-1")]
    // Inside a 300 × 300 world but larger than 256 × 256.
    [InlineData(300, 300, "0,0,257,1")]
    [InlineData(300, 300, "0,0,1,257")]
    [InlineData(300, 300, "0,0,300,300")]
    // Malformed.
    [InlineData(130, 129, "1,2,3")]
    [InlineData(130, 129, "1,2,3,4,5")]
    [InlineData(130, 129, "a,b,c,d")]
    [InlineData(130, 129, "1.5,0,1,1")]
    [InlineData(130, 129, "0, 0, 1, 1")]
    [InlineData(130, 129, "")]
    [InlineData(130, 129, "99999999999,0,1,1")]
    public async Task ExportJson_InvalidRegion_ReturnsArgumentErrorAndLeavesWorldUnchanged(int width, int height, string region)
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, width == SummaryWorld.Width ? SummaryWorld.Snapshot() : SummaryWorld.Build(width, height));
        var hashBefore = SHA256.HashData(File.ReadAllBytes(path));
        var filesBefore = Directory.GetFiles(directory.Path, "*", SearchOption.AllDirectories);

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path, "--region", region);

        Assert.Equal(2, result.ExitCode);
        Assert.Empty(result.Output);
        AssertReadableError(result.Error);
        Assert.Equal(hashBefore, SHA256.HashData(File.ReadAllBytes(path)));
        Assert.Equal(filesBefore, Directory.GetFiles(directory.Path, "*", SearchOption.AllDirectories));
    }

    public static TheoryData<string[]> InvalidArguments() =>
    [
        new[] { Command },
        new[] { Command, "Forest Observatory.wld", "Crimson Eclipse.wld" },
        new[] { Command, "Forest Observatory.wld", "--region" },
        new[] { Command, "Forest Observatory.wld", "--zoom", "0,0,1,1" },
        new[] { Command, "Forest Observatory.wld", "--region", "0,0,1,1", "--region", "0,0,1,1" },
        new[] { Command, "Forest Observatory.wld", "--region", "0,0,1,1", "extra" },
    ];

    [Theory]
    [MemberData(nameof(InvalidArguments))]
    public async Task ExportJson_InvalidArguments_ReturnsUsageBeforeReadingTheFile(string[] arguments)
    {
        using var directory = new TemporaryDirectory();

        // The file does not exist: an argument error must win over the I/O error (exit 2, not 1).
        var result = await InspectorProcess.RunAsync(directory.Path, arguments);

        Assert.Equal(2, result.ExitCode);
        Assert.Empty(result.Output);
        AssertReadableError(result.Error);
        Assert.Contains("usage", result.Error, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(Command, result.Error, StringComparison.Ordinal);
        Assert.Contains("--region", result.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ExportJson_MissingFile_ReturnsIoErrorWithEmptyStdout()
    {
        using var directory = new TemporaryDirectory();
        var path = Path.Combine(directory.Path, "Missing Forest.wld");

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path);

        Assert.Equal(1, result.ExitCode);
        Assert.Empty(result.Output);
        Assert.Contains("Missing Forest.wld", result.Error, StringComparison.Ordinal);
        AssertReadableError(result.Error);
        Assert.Empty(Directory.GetFiles(directory.Path));
    }

    [Theory]
    [InlineData("truncated", false)]
    [InlineData("tiles", false)]
    [InlineData("tiles", true)]
    public async Task ExportJson_InvalidWorld_ReturnsFormatErrorWithEmptyStdoutAndUnchangedFile(string corruption, bool withRegion)
    {
        using var directory = new TemporaryDirectory();
        byte[] bytes = corruption == "truncated"
            ? [0x46, 0x01]
            : SummaryWorld.SnapshotWith(new Dictionary<int, string> { [0] = "02 01 40 80" }); // run crosses column end
        var path = directory.Write(WorldFileName, bytes);
        var hashBefore = SHA256.HashData(File.ReadAllBytes(path));
        var filesBefore = Directory.GetFiles(directory.Path, "*", SearchOption.AllDirectories);
        string[] arguments = withRegion ? [Command, path, "--region", "0,0,1,1"] : [Command, path];

        var result = await InspectorProcess.RunAsync(directory.Path, arguments);

        Assert.Equal(1, result.ExitCode);
        Assert.Empty(result.Output);
        AssertReadableError(result.Error);
        Assert.Equal(hashBefore, SHA256.HashData(File.ReadAllBytes(path)));
        Assert.Equal(filesBefore, Directory.GetFiles(directory.Path, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task ExportJson_Success_LeavesWorldUnchangedAndCreatesNoFiles()
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, SummaryWorld.Snapshot());
        var hashBefore = SHA256.HashData(File.ReadAllBytes(path));
        var filesBefore = Directory.GetFiles(directory.Path, "*", SearchOption.AllDirectories);

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path, "--region", "0,0,2,2");

        Assert.Equal(0, result.ExitCode);
        Assert.Equal(hashBefore, SHA256.HashData(File.ReadAllBytes(path)));
        Assert.Equal(filesBefore, Directory.GetFiles(directory.Path, "*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task ExportJson_SmallWorld_OutputIsUnderOneMegabyte()
    {
        using var directory = new TemporaryDirectory();
        var path = directory.Write(WorldFileName, SummaryWorld.Build(4200, 1200));

        var result = await InspectorProcess.RunAsync(directory.Path, Command, path);

        Assert.Equal(0, result.ExitCode);
        Assert.InRange(result.Output.Length, 1, 1024 * 1024 - 1);
        Schema().AssertValid(result.Output);
        using var document = JsonDocument.Parse(result.Output);
        Assert.Equal(33 * 10, document.RootElement.GetProperty("chunks").GetProperty("digests").GetArrayLength());
    }

    [Fact]
    public void SchemaValidator_InvalidSummaries_AreRejected()
    {
        var schema = Schema();
        var valid = JsonNode.Parse(ApprovedSnapshot())!;
        using (var document = JsonDocument.Parse(valid.ToJsonString()))
        {
            Assert.Empty(schema.Validate(document.RootElement));
        }

        var missing = valid.DeepClone().AsObject();
        missing.Remove("palette");
        var badDigest = valid.DeepClone();
        badDigest["chunks"]!["digests"]![0]!["block"] = "0123456789ABCDEF";
        var extra = valid.DeepClone().AsObject();
        extra.Add("generatedAt", "2026-10-06");
        foreach (var invalid in new JsonNode[] { missing, badDigest, extra })
        {
            using var document = JsonDocument.Parse(invalid.ToJsonString());
            Assert.NotEmpty(schema.Validate(document.RootElement));
        }
    }

    private static JsonSchemaSubset Schema() => JsonSchemaSubset.Load("world-summary.v1.schema.json");

    private static byte[] ApprovedSnapshot() =>
        File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "Snapshots", SummaryWorld.SnapshotFile));

    private static byte[] WriteToBytes(World world)
    {
        using var output = new MemoryStream();
        WorldSummaryJson.Write(world, output);
        return output.ToArray();
    }

    private static byte[] WriteUnder(string culture, World world)
    {
        var (current, currentUi) = (CultureInfo.CurrentCulture, CultureInfo.CurrentUICulture);
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
            CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(culture);
            return WriteToBytes(world);
        }
        finally
        {
            (CultureInfo.CurrentCulture, CultureInfo.CurrentUICulture) = (current, currentUi);
        }
    }

    /// <summary>Digests of an export keyed "cx,cy/plane".</summary>
    private static Dictionary<string, string> DigestsOf(byte[] json)
    {
        using var document = JsonDocument.Parse(json);
        var digests = new Dictionary<string, string>();
        foreach (var chunk in document.RootElement.GetProperty("chunks").GetProperty("digests").EnumerateArray())
        {
            var key = string.Create(CultureInfo.InvariantCulture, $"{chunk.GetProperty("x").GetInt32()},{chunk.GetProperty("y").GetInt32()}");
            foreach (var plane in Planes)
            {
                digests[$"{key}/{plane}"] = chunk.GetProperty(plane).GetString()!;
            }
        }

        return digests;
    }

    private static void AssertReadableError(string error)
    {
        Assert.False(string.IsNullOrWhiteSpace(error));
        Assert.DoesNotContain("Unhandled exception", error, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotMatch(@"(?m)^\s+at\s+", error);
        Assert.DoesNotMatch(@"(?i)\.cs:line\s+\d+", error);
        Assert.DoesNotContain("NotImplementedException", error, StringComparison.Ordinal);
    }
}
