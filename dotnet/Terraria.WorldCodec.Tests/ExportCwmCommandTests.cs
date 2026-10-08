using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Terraria.WorldInspector;

namespace Terraria.WorldCodec.Tests;

/// <summary>Shipped export-cwm CLI, source preservation and atomic publication.</summary>
public sealed class ExportCwmCommandTests
{
    [Fact]
    public void Run_EnglishAndPolishCulturesWithDifferentPaths_WritesIdenticalFiles()
    {
        using var directory = new TemporaryDirectory();
        var bytes = SummaryWorld.Snapshot(new SyntheticMetadata
        {
            Width = SummaryWorld.Width, Height = SummaryWorld.Height, Name = "Forêt 海岸",
        });
        var previous = CultureInfo.CurrentCulture;
        var previousUi = CultureInfo.CurrentUICulture;
        var exports = new List<byte[]>();
        try
        {
            foreach (var culture in new[] { "en-US", "pl-PL" })
            {
                CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
                CultureInfo.CurrentUICulture = CultureInfo.GetCultureInfo(culture);
                var input = directory.Write($"Forest Observatory-{culture}.wld", bytes);
                var target = Path.ChangeExtension(input, ".cwm");
                using var output = new StringWriter(CultureInfo.InvariantCulture);
                using var error = new StringWriter(CultureInfo.InvariantCulture);

                var code = InspectorCommand.Run(["export-cwm", input, target], output, error,
                    path => SyntheticTileWorld.Read(File.ReadAllBytes(path)));

                Assert.Equal(0, code);
                Assert.Empty(error.ToString());
                exports.Add(File.ReadAllBytes(target));
                Assert.Equal(bytes, File.ReadAllBytes(input));
            }
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
            CultureInfo.CurrentUICulture = previousUi;
        }

        Assert.Equal(exports[0], exports[1]);
        Assert.Equal(CanonicalWorldBinaryTests.WriteUnder("en-US", SyntheticTileWorld.Read(bytes)), exports[0]);
    }

    [Fact]
    public async Task ExportCwm_DifferentSourcePaths_WritesIdenticalSerializerBytes()
    {
        using var directory = new TemporaryDirectory();
        var bytes = SummaryWorld.Build(2, 4, new Dictionary<int, string>
        {
            [0] = "02 01 04 01 02 04 ee ff d4 ff 00",
            [1] = "22 20 03 04 02 00 00",
        }, new SyntheticMetadata { Width = 2, Height = 4, Name = "Forêt 海岸" });
        var left = directory.Write("Forest Observatory.wld", bytes);
        var right = directory.Write("Crimson Coast.wld", bytes);
        var first = Path.Combine(directory.Path, "Forest.cwm");
        var second = Path.Combine(directory.Path, "Coast.cwm");

        var firstResult = await InspectorProcess.RunAsync(directory.Path, "export-cwm", left, first);
        var secondResult = await InspectorProcess.RunAsync(directory.Path, "export-cwm", right, second);

        Assert.Equal(0, firstResult.ExitCode);
        Assert.Equal(0, secondResult.ExitCode);
        Assert.Empty(firstResult.Error);
        Assert.Empty(secondResult.Error);
        var expected = CanonicalWorldBinaryTests.WriteUnder("en-US", SyntheticTileWorld.Read(bytes));
        Assert.Equal(expected, File.ReadAllBytes(first));
        Assert.Equal(expected, File.ReadAllBytes(second));
        Assert.Equal(expected, CanonicalWorldBinaryTests.WriteUnder("pl-PL", SyntheticTileWorld.Read(bytes)));
        Assert.Equal(bytes, File.ReadAllBytes(left));
        Assert.Equal(bytes, File.ReadAllBytes(right));
        Assert.Equal(4, Directory.GetFiles(directory.Path).Length);
    }

    public static TheoryData<string[]> InvalidArguments() =>
    [
        new[] { "export-cwm" },
        new[] { "export-cwm", "Forest Observatory.wld" },
        new[] { "export-cwm", "Forest Observatory.wld", "Forest.cwm", "--region", "0,0,2,4" },
    ];

    [Theory]
    [MemberData(nameof(InvalidArguments))]
    public async Task ExportCwm_InvalidArguments_ReturnsTwoWithUsage(string[] arguments)
    {
        using var directory = new TemporaryDirectory();

        var result = await InspectorProcess.RunAsync(directory.Path, arguments);

        Assert.Equal(2, result.ExitCode);
        Assert.Empty(result.Output);
        Assert.Contains("usage", result.Error, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("export-cwm", result.Error, StringComparison.Ordinal);
        Assert.Empty(Directory.GetFileSystemEntries(directory.Path));
    }

    [Fact]
    public async Task ExportCwm_OutputAliasesInput_ReturnsTwoAndPreservesSource()
    {
        using var directory = new TemporaryDirectory();
        var bytes = SummaryWorld.Build(2, 4);
        var input = directory.Write("Forest Observatory.wld", bytes);
        var alias = Path.Combine(directory.Path, ".", "Forest Observatory.wld");

        var result = await InspectorProcess.RunAsync(directory.Path, "export-cwm", input, alias);

        Assert.Equal(2, result.ExitCode);
        Assert.NotEmpty(result.Error);
        Assert.Equal(bytes, File.ReadAllBytes(input));
        Assert.Single(Directory.GetFiles(directory.Path));
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("truncated")]
    [InlineData("unsupported")]
    [InlineData("output-directory")]
    public async Task ExportCwm_FormatOrIoFailure_ReturnsOneWithoutCompletedOutput(string failure)
    {
        using var directory = new TemporaryDirectory();
        var bytes = failure == "truncated" ? new byte[] { 0x46, 0x01 } : SummaryWorld.Build(2, 4);
        if (failure == "unsupported")
        {
            BinaryPrimitives.WriteInt32LittleEndian(bytes, 327);
        }

        var input = failure == "missing"
            ? Path.Combine(directory.Path, "Missing Forest.wld")
            : directory.Write("Forest Observatory.wld", bytes);
        var target = failure == "output-directory" ? directory.Path : Path.Combine(directory.Path, "Forest.cwm");
        var entries = Directory.GetFileSystemEntries(directory.Path);

        var result = await InspectorProcess.RunAsync(directory.Path, "export-cwm", input, target);

        Assert.Equal(1, result.ExitCode);
        Assert.Empty(result.Output);
        Assert.NotEmpty(result.Error);
        Assert.Equal(entries, Directory.GetFileSystemEntries(directory.Path));
        Assert.False(File.Exists(target));
        if (failure != "missing")
        {
            Assert.Equal(bytes, File.ReadAllBytes(input));
        }
    }

    [Fact]
    public void Run_SerializerFailsAfterWriting_RemovesPartialOutputAndStaging()
    {
        using var directory = new TemporaryDirectory();
        var bytes = SummaryWorld.Build(2, 4);
        var input = directory.Write("Forest Observatory.wld", bytes);
        var target = Path.Combine(directory.Path, "Forest.cwm");
        var entries = Directory.GetFiles(directory.Path).Order(StringComparer.Ordinal).ToArray();
        var writes = 0;
        void WriteWorld(World world, Stream output)
        {
            Assert.Equal(2, world.Tiles.Width);
            writes++;
            output.Write("CWM\0"u8);
            throw new IOException("The CWM output device became unavailable.");
        }

        using var output = new StringWriter(CultureInfo.InvariantCulture);
        using var error = new StringWriter(CultureInfo.InvariantCulture);
        var code = ExportCwmCommand.Run(["export-cwm", input, target], output, error,
            path => SyntheticTileWorld.Read(File.ReadAllBytes(path)), WriteWorld);

        Assert.Equal(1, writes);
        Assert.Equal(1, code);
        Assert.Empty(output.ToString());
        Assert.NotEmpty(error.ToString());
        Assert.Equal(entries, Directory.GetFiles(directory.Path).Order(StringComparer.Ordinal).ToArray());
        Assert.Equal(bytes, File.ReadAllBytes(input));
        Assert.False(File.Exists(target));
    }

    [Fact]
    public async Task ExportCwm_TruncatedInputAndExistingDestination_PreservesBothFiles()
    {
        using var directory = new TemporaryDirectory();
        byte[] bytes = [0x46, 0x01];
        var input = directory.Write("Truncated Forest.wld", bytes);
        var previous = CanonicalWorldBinaryTests.ExpectedBytes();
        var target = directory.Write("Forest.cwm", previous);

        var result = await InspectorProcess.RunAsync(directory.Path, "export-cwm", input, target);

        Assert.Equal(1, result.ExitCode);
        Assert.NotEmpty(result.Error);
        Assert.Equal(bytes, File.ReadAllBytes(input));
        Assert.Equal(previous, File.ReadAllBytes(target));
        Assert.Equal(2, Directory.GetFiles(directory.Path).Length);
    }

    public static TheoryData<string> ManifestWorlds()
    {
        using var manifest = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(FixturesDirectory(), "manifest.json")));
        var cases = new TheoryData<string>();
        foreach (var world in manifest.RootElement.GetProperty("worlds").EnumerateArray())
        {
            cases.Add(world.GetProperty("file").GetString()!);
        }

        return cases;
    }

    [Theory]
    [MemberData(nameof(ManifestWorlds))]
    public async Task ExportCwm_ManifestWorld_WritesCompletePlanesAndPreservesInput(string file)
    {
        using var directory = new TemporaryDirectory();
        var input = Path.Combine(FixturesDirectory(), file);
        var before = SHA256.HashData(File.ReadAllBytes(input));
        var target = Path.Combine(directory.Path, Path.ChangeExtension(file, ".cwm"));

        var result = await InspectorProcess.RunAsync(directory.Path, "export-cwm", input, target);

        Assert.Equal(before, SHA256.HashData(File.ReadAllBytes(input)));
        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        using var exported = File.OpenRead(target);
        var prefix = new byte[12];
        exported.ReadExactly(prefix);
        Assert.Equal("CWM\0"u8.ToArray(), prefix[..4]);
        Assert.Equal(1u, BinaryPrimitives.ReadUInt32LittleEndian(prefix.AsSpan(4)));
        var headerLength = BinaryPrimitives.ReadUInt32LittleEndian(prefix.AsSpan(8));
        var headerBytes = new byte[checked((int)headerLength)];
        exported.ReadExactly(headerBytes);
        using var header = JsonDocument.Parse(headerBytes);
        var dimensions = header.RootElement.GetProperty("dimensions");
        var cellCount = (long)dimensions.GetProperty("width").GetInt32() * dimensions.GetProperty("height").GetInt32();
        Assert.Equal(12L + headerLength + (15 * cellCount), exported.Length);
        Assert.Equal(1, header.RootElement.GetProperty("schemaVersion").GetInt32());
        Assert.Equal(326, header.RootElement.GetProperty("formatVersion").GetInt32());
        Assert.Single(Directory.GetFiles(directory.Path));
    }

    private static string FixturesDirectory()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "packages", "test-fixtures", "worlds");
            if (File.Exists(Path.Combine(candidate, "manifest.json")))
            {
                return candidate;
            }
        }

        throw new DirectoryNotFoundException("packages/test-fixtures/worlds/manifest.json not found above the test assembly.");
    }
}
