using System.Buffers.Binary;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Terraria.WorldInspector;

namespace Terraria.WorldCodec.Tests;

/// <summary>Issue #11: public diff CLI plus observable summary-first chunk comparison.</summary>
public sealed class DiffCommandTests
{
    [Fact]
    public async Task Diff_DifferentLegalRle_ReportsNoDifferencesAndPreservesInputs()
    {
        var left = SyntheticTileWorld.Build(2, 4, TileAssert.Hex("42 01 03 40 03")).File;
        var right = SyntheticTileWorld.Build(2, 4, TileAssert.Hex("02 01 02 01 02 01 02 01 00 00 00 00")).File;
        Assert.NotEqual(left, right);
        var result = await RunPairAsync(left, right);
        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        Assert.Equal("No differences.", result.OutputText.Trim());
    }

    public static TheoryData<string, string, string> TileChanges() => new()
    {
        { "block", "40 02 07 18 01 02 40 7c", "{\"kind\":\"vanilla\",\"id\":2} -> {\"kind\":\"vanilla\",\"id\":1}" },
        { "wall", "40 02 07 18 02 01 40 7c", "{\"kind\":\"vanilla\",\"id\":2} -> {\"kind\":\"vanilla\",\"id\":1}" },
        { "liquid.kind", "40 02 17 18 02 02 ff 40 7c", "null -> \"lava\"" },
    };

    [Theory]
    [MemberData(nameof(TileChanges))]
    public async Task Diff_NameAndOneTileChanged_ReportsExactValuesInOrder(string field, string column, string values)
    {
        var left = Snapshot("Forest Observatory");
        var right = Snapshot("Crimson Observatory", new Dictionary<int, string> { [2] = column });
        var first = await RunPairAsync(left, right);
        var second = await RunPairAsync(left, right);
        Assert.Equal(3, first.ExitCode);
        Assert.Empty(first.Error);
        Assert.Equal(first.Output, second.Output);
        var lines = Lines(first.OutputText);
        Assert.Equal("metadata.name: \"Forest Observatory\" -> \"Crimson Observatory\"", lines[0]);
        Assert.Contains($"tiles[2,3].{field}: {values}", lines);
    }

    [Theory]
    [InlineData("40 7d 58 ff 01 10 ff", "liquid.kind", "\"honey\" -> \"lava\"")]
    [InlineData("40 7d 58 ff 01 18 80", "liquid.amount", "255 -> 128")]
    public async Task Diff_SingleLiquidFieldChanged_ReportsOnlyThatField(string column, string field, string values)
    {
        var result = await RunPairAsync(SummaryWorld.Snapshot(), SummaryWorld.SnapshotWith(new Dictionary<int, string> { [64] = column }));
        Assert.Equal(3, result.ExitCode);
        Assert.Empty(result.Error);
        Assert.Equal([$"tiles[64,128].{field}: {values}"], TileLines(result.OutputText));
    }

    [Theory]
    [InlineData(2, "40 02 07 18 01 02 40 7c", 0, 0, 128, 128, "tiles[2,3].block: {\"kind\":\"vanilla\",\"id\":2} -> {\"kind\":\"vanilla\",\"id\":1}")]
    [InlineData(2, "40 02 07 18 02 01 40 7c", 0, 0, 128, 128, "tiles[2,3].wall: {\"kind\":\"vanilla\",\"id\":2} -> {\"kind\":\"vanilla\",\"id\":1}")]
    [InlineData(64, "40 7d 58 ff 01 10 ff", 0, 128, 128, 1, "tiles[64,128].liquid.kind: \"honey\" -> \"lava\"")]
    [InlineData(64, "40 7d 58 ff 01 18 80", 0, 128, 128, 1, "tiles[64,128].liquid.amount: 255 -> 128")]
    [InlineData(129, "40 7f 0b 03 0b 0a 04 12 00 2c 00 09 c8", 128, 128, 2, 1, "tiles[129,128].paint: 3 -> 9")]
    public void Write_NameAndOneTileChanged_ReadsOnlyDifferingChunkOnEachSide(
        int column, string hex, int x, int y, int width, int height, string expected)
    {
        var left = SyntheticTileWorld.Read(Snapshot("Forest Observatory"));
        var right = SyntheticTileWorld.Read(Snapshot("Crimson Observatory", new Dictionary<int, string> { [column] = hex }));
        using var leftSummary = Summary(left);
        using var rightSummary = Summary(right);
        using var output = new StringWriter(CultureInfo.InvariantCulture);
        var leftRequests = new List<TileRegion>();
        var rightRequests = new List<TileRegion>();
        var code = WorldDiff.Write(leftSummary.RootElement, rightSummary.RootElement,
            region => ReadChunk(left, region, leftRequests), region => ReadChunk(right, region, rightRequests), output);
        Assert.Equal(3, code);
        Assert.Equal([new TileRegion(x, y, width, height)], leftRequests);
        Assert.Equal(leftRequests, rightRequests);
        Assert.Equal("metadata.name: \"Forest Observatory\" -> \"Crimson Observatory\"", Lines(output.ToString())[0]);
        Assert.Equal([expected], TileLines(output.ToString()));
    }

    [Fact]
    public void Write_EqualDigests_NeverRequestsTiles()
    {
        var world = SyntheticTileWorld.Read(SummaryWorld.Snapshot());
        using var summary = Summary(world);
        using var output = new StringWriter(CultureInfo.InvariantCulture);
        var code = WorldDiff.Write(summary.RootElement, summary.RootElement,
            _ => throw new InvalidOperationException("Equal left chunk must not be decoded."),
            _ => throw new InvalidOperationException("Equal right chunk must not be decoded."), output);
        Assert.Equal(0, code);
        Assert.Equal("No differences.", output.ToString().Trim());
    }

    [Fact]
    public void Write_OnlyMetadataChanged_DoesNotDecodeChunks()
    {
        using var left = Summary(SyntheticTileWorld.Read(Snapshot("Forest Observatory")));
        using var right = Summary(SyntheticTileWorld.Read(Snapshot("Crimson Observatory")));
        using var output = new StringWriter(CultureInfo.InvariantCulture);
        var code = WorldDiff.Write(left.RootElement, right.RootElement,
            _ => throw new InvalidOperationException("Metadata-only diff must not decode left tiles."),
            _ => throw new InvalidOperationException("Metadata-only diff must not decode right tiles."), output);
        Assert.Equal(3, code);
        Assert.Equal(["metadata.name: \"Forest Observatory\" -> \"Crimson Observatory\""], Lines(output.ToString()));
    }

    [Fact]
    public void Write_PalettePermutationWithRemappedDigests_ReportsNoSemanticDifferences()
    {
        var world = SyntheticTileWorld.Read(SummaryWorld.Snapshot());
        using var left = Summary(world);
        var remapped = JsonNode.Parse(left.RootElement.GetRawText())!.AsObject();
        var palette = remapped["palette"]!.AsArray();
        var entries = palette.Select(entry => entry!.DeepClone()).Reverse().ToArray();
        palette.Clear();
        foreach (var entry in entries)
        {
            palette.Add(entry);
        }

        var planes = SummaryWorld.ExpectedSnapshotPlanes().ToDictionary(pair => pair.Key, pair => pair.Value.ToArray());
        foreach (var name in new[] { "block", "wall" })
        {
            var plane = planes[name];
            for (var offset = 0; offset < plane.Length; offset += 2)
            {
                var index = BinaryPrimitives.ReadUInt16LittleEndian(plane.AsSpan(offset));
                if (index != ushort.MaxValue)
                {
                    BinaryPrimitives.WriteUInt16LittleEndian(plane.AsSpan(offset), checked((ushort)(palette.Count - 1 - index)));
                }
            }
        }

        var digests = SummaryWorld.Digests(planes, SummaryWorld.Width, SummaryWorld.Height);
        foreach (var chunk in remapped["chunks"]!["digests"]!.AsArray())
        {
            foreach (var name in new[] { "block", "wall" })
            {
                chunk![name] = digests[$"{chunk["x"]},{chunk["y"]}/{name}"];
            }
        }

        using var right = JsonDocument.Parse(remapped.ToJsonString());
        using var output = new StringWriter(CultureInfo.InvariantCulture);
        var code = WorldDiff.Write(left.RootElement, right.RootElement,
            region => ReadChunk(world, region, []), region => ReadChunk(world, region, []), output);
        Assert.Equal(0, code);
        Assert.Equal("No differences.", output.ToString().Trim());
    }

    [Fact]
    public void Write_EqualIndexDigestsWithDifferentPalette_ReportsResolvedContentChanges()
    {
        var leftWorld = SyntheticTileWorld.Read(SummaryWorld.Build(1, 1, new Dictionary<int, string> { [0] = "02 01" }));
        var rightWorld = SyntheticTileWorld.Read(SummaryWorld.Build(1, 1, new Dictionary<int, string> { [0] = "02 02" }));
        using var left = Summary(leftWorld);
        using var right = Summary(rightWorld);
        Assert.True(JsonElement.DeepEquals(left.RootElement.GetProperty("chunks"), right.RootElement.GetProperty("chunks")));
        using var output = new StringWriter(CultureInfo.InvariantCulture);
        var requests = new List<TileRegion>();
        var code = WorldDiff.Write(left.RootElement, right.RootElement,
            region => ReadChunk(leftWorld, region, requests), region => ReadChunk(rightWorld, region, requests), output);
        Assert.Equal(3, code);
        Assert.Equal([new TileRegion(0, 0, 1, 1), new TileRegion(0, 0, 1, 1)], requests);
        Assert.Equal(["tiles[0,0].block: {\"kind\":\"vanilla\",\"id\":1} -> {\"kind\":\"vanilla\",\"id\":2}"], TileLines(output.ToString()));
        Assert.Contains("palette", Lines(output.ToString())[0], StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Diff_DifferentDimensions_ReportsOneSidedPositionsAndOverlap(bool reverse)
    {
        var narrow = SummaryWorld.Build(2, 3, new Dictionary<int, string> { [1] = "02 01 40 01" });
        var wide = SummaryWorld.Build(3, 2, new Dictionary<int, string> { [1] = "02 02 00" });
        var result = await RunPairAsync(reverse ? wide : narrow, reverse ? narrow : wide);
        Assert.Equal(3, result.ExitCode);
        Assert.Empty(result.Error);
        var lines = Lines(result.OutputText);
        Assert.Equal(reverse ? "dimensions.width: 3 -> 2" : "dimensions.width: 2 -> 3", lines[0]);
        Assert.Equal(reverse ? "dimensions.height: 2 -> 3" : "dimensions.height: 3 -> 2", lines[1]);
        var tiles = TileLines(result.OutputText);
        var narrowPresence = reverse ? "absent -> right-only" : "left-only -> absent";
        var widePresence = reverse ? "left-only -> absent" : "absent -> right-only";
        Assert.Equal(
        [
            $"tiles[0,2].presence: {narrowPresence}",
            reverse
                ? "tiles[1,0].block: {\"kind\":\"vanilla\",\"id\":2} -> {\"kind\":\"vanilla\",\"id\":1}"
                : "tiles[1,0].block: {\"kind\":\"vanilla\",\"id\":1} -> {\"kind\":\"vanilla\",\"id\":2}",
            $"tiles[1,2].presence: {narrowPresence}",
            $"tiles[2,0].presence: {widePresence}",
            $"tiles[2,1].presence: {widePresence}",
        ], tiles);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Diff_CrossedDimensionsAcrossChunks_ReportsDimensionsAndAllOneSidedPositions(bool reverse)
    {
        var wide = SummaryWorld.Build(129, 1);
        var tall = SummaryWorld.Build(1, 129);
        var result = await RunPairAsync(reverse ? tall : wide, reverse ? wide : tall, "--max", "256");
        Assert.Equal(3, result.ExitCode);
        Assert.Empty(result.Error);
        var tallPresence = reverse ? "left-only -> absent" : "absent -> right-only";
        var widePresence = reverse ? "absent -> right-only" : "left-only -> absent";
        var expected = new List<string>
        {
            reverse ? "dimensions.width: 1 -> 129" : "dimensions.width: 129 -> 1",
            reverse ? "dimensions.height: 129 -> 1" : "dimensions.height: 1 -> 129",
        };
        for (var y = 1; y <= 128; y++)
        {
            expected.Add($"tiles[0,{y}].presence: {tallPresence}");
        }

        for (var x = 1; x <= 128; x++)
        {
            expected.Add($"tiles[{x},0].presence: {widePresence}");
        }

        Assert.Equal(expected, Lines(result.OutputText));
    }

    [Fact]
    public async Task Diff_MultipleChunks_OrdersTilesGloballyByXThenY()
    {
        var right = SummaryWorld.Build(130, 129, new Dictionary<int, string>
        {
            [0] = "40 7f 08 ff", [1] = "08 ff 40 7f", [128] = "40 7f 08 ff",
        });
        var result = await RunPairAsync(SummaryWorld.Build(130, 129), right);
        Assert.Equal(3, result.ExitCode);
        Assert.Equal(
        [
            "tiles[0,128].liquid.kind: null -> \"water\"", "tiles[0,128].liquid.amount: null -> 255",
            "tiles[1,0].liquid.kind: null -> \"water\"", "tiles[1,0].liquid.amount: null -> 255",
            "tiles[128,128].liquid.kind: null -> \"water\"", "tiles[128,128].liquid.amount: null -> 255",
        ], TileLines(result.OutputText));
    }

    [Fact]
    public async Task Diff_MetadataDimensionsAndPaletteChanged_ReportsSummaryBeforeTiles()
    {
        var left = SummaryWorld.Build(1, 1, new Dictionary<int, string> { [0] = "02 01" },
            new SyntheticMetadata { Name = "Forest Observatory", Width = 1, Height = 1 });
        var right = SummaryWorld.Build(2, 1, new Dictionary<int, string> { [0] = "02 02" },
            new SyntheticMetadata { Name = "Crimson Observatory", Width = 2, Height = 1 });
        var result = await RunPairAsync(left, right);
        Assert.Equal(3, result.ExitCode);
        Assert.Empty(result.Error);
        var lines = Lines(result.OutputText);
        Assert.Equal("metadata.name: \"Forest Observatory\" -> \"Crimson Observatory\"", lines[0]);
        Assert.Equal("dimensions.width: 1 -> 2", lines[1]);
        var tileStart = Array.FindIndex(lines, line => line.StartsWith("tiles[", StringComparison.Ordinal));
        Assert.True(tileStart > 2, "Palette notes must precede tiles.");
        var notes = string.Join('\n', lines[2..tileStart]);
        Assert.Contains("palette", notes, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("{\"kind\":\"vanilla\",\"id\":1}", notes, StringComparison.Ordinal);
        Assert.Contains("{\"kind\":\"vanilla\",\"id\":2}", notes, StringComparison.Ordinal);
        Assert.Equal(
        [
            "tiles[0,0].block: {\"kind\":\"vanilla\",\"id\":1} -> {\"kind\":\"vanilla\",\"id\":2}",
            "tiles[1,0].presence: absent -> right-only",
        ], TileLines(result.OutputText));
    }

    [Fact]
    public async Task Diff_MaximumInsideOneTile_CountsOmittedFieldDifferences()
    {
        var result = await RunPairAsync(SummaryWorld.Build(1, 1),
            SummaryWorld.Build(1, 1, new Dictionary<int, string> { [0] = "08 ff" }), "--max", "1");
        Assert.Equal(3, result.ExitCode);
        Assert.Empty(result.Error);
        Assert.Equal(
        [
            "tiles[0,0].liquid.kind: null -> \"water\"",
            "Omitted tile differences: 1",
        ], Lines(result.OutputText));
    }

    [Theory]
    [InlineData(null, 100, 29)]
    [InlineData("2", 2, 127)]
    [InlineData("0", 0, 129)]
    [InlineData("129", 129, 0)]
    public async Task Diff_Maximum_CapsTileFieldsAndReportsOmittedCount(string? maximum, int reported, int omitted)
    {
        var left = Snapshot("Forest Observatory");
        var right = Snapshot("Crimson Observatory", new Dictionary<int, string> { [3] = "42 01 80" });
        var result = await RunPairAsync(left, right, maximum is null ? [] : ["--max", maximum]);
        Assert.Equal(3, result.ExitCode);
        Assert.Empty(result.Error);
        Assert.Equal("metadata.name: \"Forest Observatory\" -> \"Crimson Observatory\"", Lines(result.OutputText)[0]);
        var tiles = TileLines(result.OutputText);
        Assert.Equal(reported, tiles.Length);
        Assert.Equal(Enumerable.Range(0, reported).Select(y => $"tiles[3,{y}].block: null -> {{\"kind\":\"vanilla\",\"id\":1}}"), tiles);
        if (omitted > 0)
        {
            Assert.Equal($"Omitted tile differences: {omitted}", Lines(result.OutputText)[^1]);
        }
        else
        {
            Assert.DoesNotContain("Omitted", result.OutputText, StringComparison.Ordinal);
        }
    }

    public static TheoryData<string[]> InvalidArguments() => new()
    {
        { ["diff"] }, { ["diff", "Forest.wld"] }, { ["diff", "Forest.wld", "Crimson.wld", "Meadow.wld"] },
        { ["diff", "Forest.wld", "Crimson.wld", "--max"] },
        { ["diff", "Forest.wld", "Crimson.wld", "--max", "many"] },
        { ["diff", "Forest.wld", "Crimson.wld", "--max", "-1"] },
        { ["diff", "Forest.wld", "Crimson.wld", "--max", "2147483648"] },
        { ["diff", "Forest.wld", "Crimson.wld", "--region", "0,0,1,1"] },
    };

    [Theory]
    [MemberData(nameof(InvalidArguments))]
    public async Task Diff_InvalidArguments_ReturnsUsageErrorBeforeReading(string[] arguments)
    {
        using var directory = new TemporaryDirectory();
        var result = await InspectorProcess.RunAsync(directory.Path, arguments);
        Assert.Equal(2, result.ExitCode);
        Assert.Empty(result.Output);
        Assert.NotEmpty(result.Error);
    }

    [Theory]
    [InlineData(false, "missing")]
    [InlineData(true, "missing")]
    [InlineData(false, "truncated")]
    [InlineData(true, "truncated")]
    [InlineData(false, "unsupported")]
    [InlineData(true, "unsupported")]
    public async Task Diff_ReadFailureOnEitherSide_ReturnsReadErrorAndPreservesExistingFiles(bool failLeft, string failure)
    {
        using var directory = new TemporaryDirectory();
        var valid = SummaryWorld.Snapshot();
        var invalid = failure == "truncated" ? valid[..30] : valid.ToArray();
        if (failure == "unsupported")
        {
            BinaryPrimitives.WriteInt32LittleEndian(invalid, 9999);
        }

        var validPath = directory.Write("Forest Observatory.wld", valid);
        var invalidPath = Path.Combine(directory.Path, "Unreadable Observatory.wld");
        if (failure != "missing")
        {
            File.WriteAllBytes(invalidPath, invalid);
        }

        var result = await InspectorProcess.RunAsync(directory.Path, "diff", failLeft ? invalidPath : validPath, failLeft ? validPath : invalidPath);
        Assert.Equal(1, result.ExitCode);
        Assert.Empty(result.Output);
        Assert.Contains(invalidPath, result.Error, StringComparison.Ordinal);
        Assert.Equal(valid, File.ReadAllBytes(validPath));
        if (failure != "missing")
        {
            Assert.Equal(invalid, File.ReadAllBytes(invalidPath));
        }
        else
        {
            Assert.False(File.Exists(invalidPath));
        }
    }

    [Fact]
    public async Task Diff_SkippedContentChanged_ReportsNoDifferences()
    {
        var left = SummaryWorld.Snapshot();
        var right = left.ToArray();
        var chestStart = BinaryPrimitives.ReadInt32LittleEndian(right.AsSpan(34));
        right[chestStart] ^= 0xFF;
        var result = await RunPairAsync(left, right);
        Assert.Equal(0, result.ExitCode);
        Assert.Equal("No differences.", result.OutputText.Trim());
    }

    [Fact]
    public async Task Diff_SkippedSectionLengthChanged_ReportsSectionSummaryDifference()
    {
        var left = SummaryWorld.Snapshot();
        var chestEnd = BinaryPrimitives.ReadInt32LittleEndian(left.AsSpan(38));
        var right = new byte[left.Length + 1];
        left.AsSpan(0, chestEnd).CopyTo(right);
        right[chestEnd] = 0xA5;
        left.AsSpan(chestEnd).CopyTo(right.AsSpan(chestEnd + 1));
        for (var pointer = 3; pointer < 11; pointer++)
        {
            var offset = 26 + (pointer * 4);
            BinaryPrimitives.WriteInt32LittleEndian(right.AsSpan(offset), BinaryPrimitives.ReadInt32LittleEndian(left.AsSpan(offset)) + 1);
        }

        var result = await RunPairAsync(left, right);
        Assert.Equal(3, result.ExitCode);
        Assert.Empty(result.Error);
        Assert.Equal(["skippedSections.chests.length: 2 -> 3"], Lines(result.OutputText));
    }

    private static byte[] Snapshot(string name, IReadOnlyDictionary<int, string>? replacements = null)
    {
        var columns = new Dictionary<int, string>(SummaryWorld.SnapshotColumns);
        foreach (var (x, hex) in replacements ?? new Dictionary<int, string>())
        {
            columns[x] = hex;
        }

        return SummaryWorld.Build(130, 129, columns, new SyntheticMetadata { Name = name, Width = 130, Height = 129 });
    }

    private static async Task<RawCommandResult> RunPairAsync(byte[] left, byte[] right, params string[] options)
    {
        // Fail early if a hand-written record is invalid, rather than hiding a fixture defect behind CLI RED.
        _ = SyntheticTileWorld.Read(left);
        _ = SyntheticTileWorld.Read(right);
        using var directory = new TemporaryDirectory();
        var leftPath = directory.Write("Forest Observatory.wld", left);
        var rightPath = directory.Write("Crimson Observatory.wld", right);
        var result = await InspectorProcess.RunAsync(directory.Path, ["diff", leftPath, rightPath, .. options]);
        Assert.Equal(left, File.ReadAllBytes(leftPath));
        Assert.Equal(right, File.ReadAllBytes(rightPath));
        return result;
    }

    private static JsonDocument Summary(World world)
    {
        using var stream = new MemoryStream();
        WorldSummaryJson.Write(world, stream);
        return JsonDocument.Parse(stream.ToArray());
    }

    private static Tile[] ReadChunk(World world, TileRegion region, List<TileRegion> requests)
    {
        requests.Add(region);
        return Enumerable.Range(region.X, region.Width)
            .SelectMany(x => Enumerable.Range(region.Y, region.Height).Select(y => world.Tiles[x, y])).ToArray();
    }

    private static string[] Lines(string text) => text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);

    private static string[] TileLines(string text) => Lines(text).Where(line => line.StartsWith("tiles[", StringComparison.Ordinal)).ToArray();
}
