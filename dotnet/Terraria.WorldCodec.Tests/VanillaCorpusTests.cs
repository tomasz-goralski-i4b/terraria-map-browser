using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// Compatibility of the vanilla corpus (<c>packages/test-fixtures/worlds/manifest.json</c>, the independent oracle) with
/// <c>inspect</c> and <c>export-json</c>, plus golden summaries and chunk digests under
/// <c>packages/test-fixtures/snapshots/m1</c>. Golden files are rewritten only when
/// <see cref="RefreshVariable"/> is set to <c>1</c>; a regular run only compares.
/// </summary>
public sealed partial class VanillaCorpusTests
{
    private const string RefreshVariable = "TERRARIA_REFRESH_GOLDEN";
    private const long MaxGoldenBytesPerWorld = 1024 * 1024;

    private static readonly JsonWriterOptions GoldenWriter = new()
    {
        Indented = true,
        IndentCharacter = ' ',
        IndentSize = 2,
        NewLine = "\n",
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static TheoryData<string> Worlds()
    {
        var data = new TheoryData<string>();
        foreach (var entry in Manifest().Select(entry => entry.GetProperty("file").GetString()!))
        {
            data.Add(entry);
        }

        return data;
    }

    [Fact]
    public void Manifest_ListsTheFiveVanillaWorldsOfTheM1Corpus()
    {
        var files = Manifest().Select(entry => entry.GetProperty("file").GetString()).Order(StringComparer.Ordinal);

        Assert.Equal(["SCCO1.wld", "SCCR2.wld", "SECR1.wld", "SJCO1.wld", "SMCO1.wld"], files);
        Assert.All(Manifest(), entry =>
        {
            Assert.Equal("1.4.5.8", entry.GetProperty("gameVersion").GetString());
            Assert.Equal(326, entry.GetProperty("formatVersion").GetInt32());
            Assert.Equal(0, entry.GetProperty("mods").GetArrayLength());
        });
    }

    [Theory]
    [MemberData(nameof(Worlds))]
    public async Task Corpus_World_MatchesManifestInHashSizeVersionNameSeedModeEvilAndDimensions(string file)
    {
        var entry = Entry(file);
        var path = WorldPath(file);
        var bytes = File.ReadAllBytes(path);
        Assert.Equal(entry.GetProperty("bytes").GetInt64(), bytes.LongLength);
        Assert.Equal(entry.GetProperty("sha256").GetString(), Convert.ToHexStringLower(SHA256.HashData(bytes)));

        var result = await InspectorProcess.RunAsync(Path.GetDirectoryName(path)!, "export-json", path);

        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        using var document = JsonDocument.Parse(result.Output);
        var root = document.RootElement;
        var metadata = root.GetProperty("metadata");
        Assert.Equal(entry.GetProperty("formatVersion").GetInt32(), root.GetProperty("formatVersion").GetInt32());
        Assert.Equal(entry.GetProperty("worldName").GetString(), metadata.GetProperty("name").GetString());
        Assert.Equal(entry.GetProperty("seed").GetString(), metadata.GetProperty("seed").GetString());
        Assert.Equal(GameMode(entry.GetProperty("mode").GetString()!), metadata.GetProperty("gameMode").GetInt32());
        Assert.Equal(entry.GetProperty("evil").GetString(), metadata.GetProperty("evil").GetString());
        var dimensions = entry.GetProperty("dimensions");
        Assert.Equal(dimensions.GetProperty("width").GetInt32(), root.GetProperty("dimensions").GetProperty("width").GetInt32());
        Assert.Equal(dimensions.GetProperty("height").GetInt32(), root.GetProperty("dimensions").GetProperty("height").GetInt32());
    }

    [Theory]
    [MemberData(nameof(Worlds))]
    public async Task Inspect_CorpusWorld_ReportsManifestValuesAndExplicitSkippedSections(string file)
    {
        var entry = Entry(file);
        var path = WorldPath(file);

        var result = await InspectorProcess.RunAsync(Path.GetDirectoryName(path)!, "inspect", path);

        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        var dimensions = entry.GetProperty("dimensions");
        Assert.Equal(entry.GetProperty("formatVersion").GetInt32().ToString(CultureInfo.InvariantCulture), Field(result.OutputText, "Version"));
        Assert.Equal(entry.GetProperty("worldName").GetString(), Field(result.OutputText, "Name"));
        Assert.Equal(entry.GetProperty("seed").GetString(), Field(result.OutputText, "Seed"));
        Assert.Equal(Capitalize(entry.GetProperty("mode").GetString()!), Field(result.OutputText, "Mode"));
        Assert.Equal(Capitalize(entry.GetProperty("evil").GetString()!), Field(result.OutputText, "Evil"));
        Assert.Equal(
            string.Create(CultureInfo.InvariantCulture, $"{dimensions.GetProperty("width").GetInt32()}×{dimensions.GetProperty("height").GetInt32()}"),
            Field(result.OutputText, "Dimensions"));
        Assert.Equal(
            "Chests, Signs, NpcsAndMobs, TileEntities, WeightedPressurePlates, TownManager, Bestiary, CreativePowers, Footer",
            Field(result.OutputText, "Skipped sections"));
    }

    [Theory]
    [MemberData(nameof(Worlds))]
    public async Task ExportJson_CorpusWorld_MatchesGoldenSummaryAndChunkDigestsAcrossTwoRuns(string file)
    {
        var path = WorldPath(file);
        var directory = Path.GetDirectoryName(path)!;

        var first = await InspectorProcess.RunAsync(directory, "export-json", path);
        var second = await InspectorProcess.RunAsync(directory, "export-json", path);

        Assert.Equal(0, first.ExitCode);
        Assert.Equal(0, second.ExitCode);
        Assert.Empty(first.Error);
        Assert.Equal(first.Output, second.Output);
        var (meta, chunks) = Split(first.Output);
        var name = Path.GetFileNameWithoutExtension(file);
        var metaPath = Path.Combine(GoldenDirectory(), $"{name}.meta.json");
        var chunksPath = Path.Combine(GoldenDirectory(), $"{name}.chunks.json");

        if (Environment.GetEnvironmentVariable(RefreshVariable) == "1")
        {
            Directory.CreateDirectory(GoldenDirectory());
            File.WriteAllBytes(metaPath, meta);
            File.WriteAllBytes(chunksPath, chunks);
        }

        Assert.True(File.Exists(metaPath), $"Missing golden file {metaPath}; refresh with {RefreshVariable}=1 (see packages/test-fixtures/README.md).");
        Assert.True(File.Exists(chunksPath), $"Missing golden file {chunksPath}; refresh with {RefreshVariable}=1 (see packages/test-fixtures/README.md).");
        Assert.Equal(File.ReadAllBytes(metaPath), meta);
        Assert.Equal(File.ReadAllBytes(chunksPath), chunks);
        Assert.True(
            new FileInfo(metaPath).Length + new FileInfo(chunksPath).Length < MaxGoldenBytesPerWorld,
            $"Golden files of {file} must stay under 1 MB in total.");
    }

    [Fact]
    public void Golden_Files_ExistExactlyForTheManifestWorlds()
    {
        var expected = Manifest()
            .Select(entry => Path.GetFileNameWithoutExtension(entry.GetProperty("file").GetString()!))
            .SelectMany(name => new[] { $"{name}.chunks.json", $"{name}.meta.json" })
            .Order(StringComparer.Ordinal);

        string[] actual = Directory.Exists(GoldenDirectory())
            ? [.. Directory.GetFiles(GoldenDirectory()).Select(path => Path.GetFileName(path)).Order(StringComparer.Ordinal)]
            : [];

        Assert.Equal(expected, actual);
    }

    [Theory]
    [MemberData(nameof(Worlds))]
    public void ReadMetadata_CorpusStrings_RemainAcceptedWithStringCaps(string file)
    {
        using var stream = File.OpenRead(WorldPath(file));
        var header = WorldReader.ReadHeader(stream);
        var table = WorldReader.ReadSectionTable(stream, header);

        var metadata = WorldReader.ReadMetadata(stream, header, table);

        Assert.Equal(Entry(file).GetProperty("worldName").GetString(), metadata.Name);
        Assert.Equal(Entry(file).GetProperty("seed").GetString(), metadata.Seed);
        Assert.Equal(table.Metadata.End, stream.Position);
        if (file == "SCCO1.wld")
        {
            // Independent field offset from docs/file-format.md, row 59.
            stream.Position = 2434;
            using var reader = new BinaryReader(stream, Encoding.UTF8, leaveOpen: true);
            var manifestText = reader.ReadString();
            Assert.Equal(9491, Encoding.UTF8.GetByteCount(manifestText));
            Assert.Equal(table.Metadata.End, stream.Position);
        }
    }

    /// <summary>Splits the summary into everything but <c>chunks</c> and the <c>chunks</c> object (size, planes, digests).</summary>
    private static (byte[] Meta, byte[] Chunks) Split(byte[] summary)
    {
        using var document = JsonDocument.Parse(summary);
        var meta = Serialize(writer =>
        {
            writer.WriteStartObject();
            foreach (var property in document.RootElement.EnumerateObject().Where(property => property.Name != "chunks"))
            {
                property.WriteTo(writer);
            }

            writer.WriteEndObject();
        });
        var chunks = Serialize(writer => document.RootElement.GetProperty("chunks").WriteTo(writer));
        return (meta, chunks);
    }

    private static byte[] Serialize(Action<Utf8JsonWriter> write)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, GoldenWriter))
        {
            write(writer);
        }

        stream.WriteByte((byte)'\n');
        return stream.ToArray();
    }

    private static string Field(string output, string label)
    {
        var match = Regex.Match(output, $@"(?m)^{Regex.Escape(label)}: (?<value>.*?)\r?$");
        Assert.True(match.Success, $"inspect output has no '{label}' line:\n{output}");
        return match.Groups["value"].Value;
    }

    private static int GameMode(string mode) => mode switch
    {
        "classic" => 0,
        "expert" => 1,
        "master" => 2,
        "journey" => 3,
        _ => throw new ArgumentOutOfRangeException(nameof(mode), mode, "Unknown manifest mode."),
    };

    private static string Capitalize(string value) =>
        string.Concat(char.ToUpperInvariant(value[0]).ToString(), value.AsSpan(1));

    private static JsonElement Entry(string file) =>
        Manifest().Single(entry => entry.GetProperty("file").GetString() == file);

    private static List<JsonElement>? manifest;

    private static List<JsonElement> Manifest()
    {
        if (manifest is null)
        {
            var document = JsonDocument.Parse(File.ReadAllText(Path.Combine(FixturesDirectory(), "worlds", "manifest.json"), Encoding.UTF8));
            manifest = document.RootElement.GetProperty("worlds").EnumerateArray().ToList();
        }

        return manifest;
    }

    private static string WorldPath(string file) => Path.Combine(FixturesDirectory(), "worlds", file);

    private static string GoldenDirectory() => Path.Combine(FixturesDirectory(), "snapshots", "m1");

    private static string FixturesDirectory()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "packages", "test-fixtures");
            if (File.Exists(Path.Combine(candidate, "worlds", "manifest.json")))
            {
                return candidate;
            }
        }

        throw new DirectoryNotFoundException("packages/test-fixtures/worlds/manifest.json not found above the test assembly.");
    }
}
