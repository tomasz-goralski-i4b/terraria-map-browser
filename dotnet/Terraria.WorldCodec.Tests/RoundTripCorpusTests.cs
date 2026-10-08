using System.Security.Cryptography;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// Issue #44: load → save → load of every manifest world loses nothing — neither the semantic model nor any byte the model
/// does not expose (docs/round-trip.md, docs/file-format/writer.md "Evidence: original vs candidate layout").
/// </summary>
public sealed class RoundTripCorpusTests
{
    private const string Tiles = "42 01 03 40 03";

    public static TheoryData<string> Worlds() => VanillaCorpusTests.Worlds();

    private static WorldEnvelope Load(byte[] file)
    {
        using var stream = new MemoryStream(file);
        return WorldReader.ReadForSave(stream);
    }

    private static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    private static byte[] Synthetic(string tiles = Tiles, SyntheticMetadata? metadata = null) =>
        WorldWriterTests.Build(2, 4, TileAssert.Hex(tiles), metadata: metadata);

    private static ReadOnlyMemory<byte> Flip(ReadOnlyMemory<byte> bytes, int offset)
    {
        var copy = bytes.ToArray();
        copy[offset] ^= 0xff;
        return copy;
    }

    private static WorldEnvelope WithSection(WorldEnvelope envelope, string name, int offset) =>
        envelope with
        {
            OpaqueSections = [.. envelope.OpaqueSections.Select(section =>
                section.Name == name ? section with { Bytes = Flip(section.Bytes, offset) } : section)],
        };

    [Theory]
    [MemberData(nameof(Worlds))]
    public async Task RoundTrip_CorpusWorld_LosesNothingSemanticallyNorInPreservedBytes(string file)
    {
        var source = RoundTripEvidence.LoadFixture(file);
        var sourcePath = VanillaCorpusTests.WorldPath(file);
        using var directory = new TemporaryDirectory();
        var saved = Path.Combine(directory.Path, file);

        var result = await InspectorProcess.RunAsync(directory.Path, "roundtrip", sourcePath, saved);

        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        var reloaded = File.ReadAllBytes(saved);
        var differences = RoundTripEvidence.Differences(Load(source), Load(reloaded));
        Assert.True(differences.Count == 0, $"{file}: {string.Join("; ", differences.Take(10))}");
        Assert.Equal(source.Length, reloaded.Length);
        Assert.Equal(Hash(source), Hash(File.ReadAllBytes(sourcePath)));
    }

    [Theory]
    [MemberData(nameof(Worlds))]
    public async Task RoundTrip_CorpusWorld_DiffSummariesDigestsAndCwmFilesMatchTheOriginal(string file)
    {
        var sourcePath = VanillaCorpusTests.WorldPath(file);
        var source = RoundTripEvidence.LoadFixture(file);
        using var directory = new TemporaryDirectory();
        var saved = Path.Combine(directory.Path, file);
        Assert.Equal(0, (await InspectorProcess.RunAsync(directory.Path, "roundtrip", sourcePath, saved)).ExitCode);
        Assert.Empty(RoundTripEvidence.Differences(Load(source), Load(File.ReadAllBytes(saved))));

        var diff = await InspectorProcess.RunAsync(directory.Path, "diff", sourcePath, saved);
        var original = await InspectorProcess.RunAsync(directory.Path, "export-json", sourcePath);
        var reloaded = await InspectorProcess.RunAsync(directory.Path, "export-json", saved);
        var originalCwm = Path.Combine(directory.Path, "original.cwm");
        var reloadedCwm = Path.Combine(directory.Path, "reloaded.cwm");
        var cwmOriginal = await InspectorProcess.RunAsync(directory.Path, "export-cwm", sourcePath, originalCwm);
        var cwmReloaded = await InspectorProcess.RunAsync(directory.Path, "export-cwm", saved, reloadedCwm);

        Assert.Equal(0, diff.ExitCode);
        Assert.Equal(0, original.ExitCode);
        Assert.Equal(0, reloaded.ExitCode);
        Assert.Equal(original.Output, reloaded.Output);
        var (meta, chunks) = VanillaCorpusTests.Split(reloaded.Output);
        var name = Path.GetFileNameWithoutExtension(file);
        Assert.Equal(File.ReadAllBytes(Path.Combine(VanillaCorpusTests.GoldenDirectory(), $"{name}.meta.json")), meta);
        Assert.Equal(File.ReadAllBytes(Path.Combine(VanillaCorpusTests.GoldenDirectory(), $"{name}.chunks.json")), chunks);
        Assert.Equal(0, cwmOriginal.ExitCode);
        Assert.Equal(0, cwmReloaded.ExitCode);
        Assert.Equal(File.ReadAllBytes(originalCwm), File.ReadAllBytes(reloadedCwm));
    }

    [Theory]
    [MemberData(nameof(Worlds))]
    public async Task RoundTrip_CorpusWorldSavedTwice_IsEquivalentToTheFirstSave(string file)
    {
        var sourcePath = VanillaCorpusTests.WorldPath(file);
        using var directory = new TemporaryDirectory();
        var first = Path.Combine(directory.Path, "first.wld");
        var second = Path.Combine(directory.Path, "second.wld");
        Assert.Equal(0, (await InspectorProcess.RunAsync(directory.Path, "roundtrip", sourcePath, first)).ExitCode);
        Assert.Equal(0, (await InspectorProcess.RunAsync(directory.Path, "roundtrip", first, second)).ExitCode);

        var differences = RoundTripEvidence.Differences(Load(File.ReadAllBytes(first)), Load(File.ReadAllBytes(second)));

        Assert.Empty(differences);
        Assert.Equal(RoundTripEvidence.LoadFixture(file), File.ReadAllBytes(second));
    }

    [Fact]
    public void LoadFixture_MissingFile_FailsInsteadOfSkipping()
    {
        Assert.Throws<FileNotFoundException>(() => RoundTripEvidence.LoadFixture("MISSING9.wld"));
    }

    [Theory]
    [MemberData(nameof(Worlds))]
    public void LoadFixture_ManifestEntry_ReturnsTheFixtureBytes(string file)
    {
        Assert.NotEmpty(RoundTripEvidence.LoadFixture(file));
    }

    [Fact]
    public void Differences_IdenticalWorlds_ReturnsNone()
    {
        var file = Synthetic();

        Assert.Empty(RoundTripEvidence.Differences(Load(file), Load(file)));
    }

    [Fact]
    public void Differences_ChangedTile_NamesTheTile()
    {
        var original = Load(Synthetic());
        var changed = Load(Synthetic("42 02 03 40 03"));

        var differences = RoundTripEvidence.Differences(original, changed);

        Assert.Contains(differences, line => line.StartsWith("Tile (0,0)", StringComparison.Ordinal));
    }

    [Fact]
    public void Differences_ChangedModeledMetadataField_IsReported()
    {
        var original = Load(Synthetic());
        var changed = Load(Synthetic(metadata: new SyntheticMetadata { Seed = "123456789" }));

        Assert.Contains(RoundTripEvidence.Differences(original, changed),
            line => line.StartsWith("Metadata", StringComparison.Ordinal));
    }

    [Fact]
    public void Differences_ChangedConsumedMetadataByte_NamesMetadataAndRelativeOffset()
    {
        var original = Load(Synthetic());
        var last = original.MetadataBytes.Length - 1;
        var changed = original with { MetadataBytes = Flip(original.MetadataBytes, last) };

        Assert.Contains($"Metadata: relative offset {last}", RoundTripEvidence.Differences(original, changed));
    }

    [Fact]
    public void Differences_ChangedFileHeaderByte_NamesFileHeaderAndRelativeOffset()
    {
        var original = Load(Synthetic());
        var changed = original with { FileHeaderBytes = Flip(original.FileHeaderBytes, 5) };

        Assert.Contains("FileHeader: relative offset 5", RoundTripEvidence.Differences(original, changed));
    }

    [Theory]
    [InlineData("Chests", 2)]
    [InlineData("Signs", 1)]
    [InlineData("NpcsAndMobs", 4)]
    [InlineData("TileEntities", 5)]
    [InlineData("WeightedPressurePlates", 3)]
    [InlineData("TownManager", 5)]
    [InlineData("Bestiary", 7)]
    [InlineData("CreativePowers", 1)]
    public void Differences_ChangedOpaqueSectionByte_NamesTheSectionAndRelativeOffset(string section, int offset)
    {
        var original = Load(Synthetic());
        var changed = WithSection(original, section, offset);

        var differences = RoundTripEvidence.Differences(original, changed);

        Assert.Equal([$"{section}: relative offset {offset}"], differences);
    }

    [Fact]
    public void Differences_ChangedFooterByte_NamesFooterAndRelativeOffset()
    {
        var original = Load(Synthetic());
        var changed = original with { FooterBytes = Flip(original.FooterBytes, 2) };

        Assert.Contains("Footer: relative offset 2", RoundTripEvidence.Differences(original, changed));
    }

    [Fact]
    public void Differences_ShorterOpaqueSection_ReportsALengthDifference()
    {
        var original = Load(Synthetic());
        var changed = original with
        {
            OpaqueSections = [.. original.OpaqueSections.Select(section =>
                section.Name == "Signs" ? section with { Bytes = section.Bytes[..1] } : section)],
        };

        Assert.Contains(RoundTripEvidence.Differences(original, changed),
            line => line.StartsWith("Signs: length", StringComparison.Ordinal));
    }
}
