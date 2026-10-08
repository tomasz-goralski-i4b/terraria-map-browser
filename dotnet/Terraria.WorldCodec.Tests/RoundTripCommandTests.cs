using System.Globalization;
using Terraria.WorldInspector;

namespace Terraria.WorldCodec.Tests;

/// <summary>Issue #41: <c>roundtrip</c> writes a validated copy to a new path and never replaces a file (docs/round-trip.md).</summary>
public sealed class RoundTripCommandTests
{
    private static byte[] World() => WorldWriterTests.Build(2, 4, TileAssert.Hex("42 01 03 40 03"));

    private static string[] Names(string directory) =>
        [.. Directory.GetFileSystemEntries(directory).Select(entry => Path.GetFileName(entry)).Order(StringComparer.Ordinal)];

    private static (int Code, string Output, string Error) Run(RoundTripHooks? hooks, params string[] arguments)
    {
        using var output = new StringWriter(CultureInfo.InvariantCulture);
        using var error = new StringWriter(CultureInfo.InvariantCulture);
        var code = RoundTripCommand.Run(["roundtrip", .. arguments], output, error, hooks);
        return (code, output.ToString(), error.ToString());
    }

    [Fact]
    public void Run_NewOutputPath_WritesReloadableCopyAndLeavesInputUntouched()
    {
        using var directory = new TemporaryDirectory();
        var bytes = World();
        var input = directory.Write("in.wld", bytes);
        var target = Path.Combine(directory.Path, "out.wld");

        var (code, output, error) = Run(null, input, target);

        Assert.Equal(0, code);
        Assert.Empty(error);
        Assert.Equal(target, output.Trim());
        Assert.Equal(bytes, File.ReadAllBytes(input));
        using var copy = File.OpenRead(target);
        var reloaded = WorldReader.Read(copy);
        Assert.Equal(SyntheticTileWorld.Read(bytes).Metadata, reloaded.Metadata);
        Assert.Equal(["in.wld", "out.wld"], Names(directory.Path));
    }

    [Fact]
    public void Run_UnchangedWorld_WritesByteIdenticalCopy()
    {
        using var directory = new TemporaryDirectory();
        var bytes = World();
        var input = directory.Write("in.wld", bytes);
        var target = Path.Combine(directory.Path, "out.wld");

        Assert.Equal(0, Run(null, input, target).Code);

        Assert.Equal(bytes, File.ReadAllBytes(target));
    }

    [Fact]
    public void Run_ExistingOutput_ReturnsTwoAndKeepsBothFiles()
    {
        using var directory = new TemporaryDirectory();
        var bytes = World();
        var input = directory.Write("in.wld", bytes);
        var existing = directory.Write("out.wld", [1, 2, 3]);

        var (code, output, error) = Run(null, input, existing);

        Assert.Equal(2, code);
        Assert.Empty(output);
        Assert.NotEmpty(error);
        Assert.Equal([1, 2, 3], File.ReadAllBytes(existing));
        Assert.Equal(bytes, File.ReadAllBytes(input));
        Assert.Equal(["in.wld", "out.wld"], Names(directory.Path));
    }

    [Fact]
    public void Run_OutputIsTheInput_ReturnsTwoAndWritesNothing()
    {
        using var directory = new TemporaryDirectory();
        var bytes = World();
        var input = directory.Write("in.wld", bytes);

        var (code, _, error) = Run(null, input, input);

        Assert.Equal(2, code);
        Assert.NotEmpty(error);
        Assert.Equal(bytes, File.ReadAllBytes(input));
        Assert.Equal(["in.wld"], Names(directory.Path));
    }

    [Fact]
    public void Run_OutputSpelledWithDotDot_ReturnsTwoAndWritesNothing()
    {
        using var directory = new TemporaryDirectory();
        var bytes = World();
        var input = directory.Write("in.wld", bytes);
        Directory.CreateDirectory(Path.Combine(directory.Path, "sub"));
        var alias = Path.Combine(directory.Path, "sub", "..", "in.wld");

        var (code, _, _) = Run(null, input, alias);

        Assert.Equal(2, code);
        Assert.Equal(bytes, File.ReadAllBytes(input));
        Assert.Equal(["in.wld", "sub"], Names(directory.Path));
    }

    [Fact]
    public void Run_OutputDiffersFromInputOnlyByCaseOnWindows_ReturnsTwo()
    {
        Assert.SkipUnless(OperatingSystem.IsWindows(), "Case-insensitive file names only on Windows.");
        using var directory = new TemporaryDirectory();
        var input = directory.Write("in.wld", World());

        var (code, _, _) = Run(null, input, Path.Combine(directory.Path, "IN.WLD"));

        Assert.Equal(2, code);
        Assert.Equal(["in.wld"], Names(directory.Path));
    }

    [Fact]
    public void Run_OutputIsSymlinkToInput_ReturnsTwoAndKeepsInput()
    {
        using var directory = new TemporaryDirectory();
        var bytes = World();
        var input = directory.Write("in.wld", bytes);
        var link = Path.Combine(directory.Path, "link.wld");
        try
        {
            File.CreateSymbolicLink(link, input);
        }
        catch (Exception exception) when (exception is UnauthorizedAccessException or IOException or PlatformNotSupportedException)
        {
            Assert.Skip("Symbolic links cannot be created here.");
        }

        var (code, _, _) = Run(null, input, link);

        Assert.Equal(2, code);
        Assert.Equal(bytes, File.ReadAllBytes(input));
        Assert.Equal(["in.wld", "link.wld"], Names(directory.Path));
    }

    [Theory]
    [InlineData("after-stage")]
    [InlineData("before-move")]
    public void Run_FailureAfterStaging_LeavesNoOutputNoStagedFileAndReturnsOne(string failAt)
    {
        using var directory = new TemporaryDirectory();
        var bytes = World();
        var input = directory.Write("in.wld", bytes);
        var staged = new List<string>();
        var hooks = new RoundTripHooks
        {
            AfterStage = failAt == "after-stage" ? Fail : null,
            BeforeMove = failAt == "before-move" ? Fail : null,
        };

        var (code, output, error) = Run(hooks, input, Path.Combine(directory.Path, "out.wld"));

        Assert.Equal(1, code);
        Assert.Empty(output);
        Assert.Single(error.TrimEnd().Split('\n'));
        Assert.Equal(bytes, File.ReadAllBytes(input));
        Assert.Equal(["in.wld"], Names(directory.Path));
        Assert.Single(staged);
        Assert.Equal(Path.GetFullPath(directory.Path), Path.GetDirectoryName(Path.GetFullPath(staged[0])));

        void Fail(string path)
        {
            staged.Add(path);
            Assert.True(File.Exists(path), "The staged file must exist when the hook runs.");
            throw new IOException("injected failure");
        }
    }

    [Theory]
    [InlineData("footer")]
    [InlineData("opaque-section")]
    public void Run_StagedCopyCorruptedWithoutThrowing_ReturnsOneAndPublishesNothing(string corrupt)
    {
        using var directory = new TemporaryDirectory();
        var bytes = World();
        var input = directory.Write("in.wld", bytes);
        var table = WorldReader.ReadForSave(new MemoryStream(bytes)).Table;
        var boundaries = new[]
        {
            table.Chests, table.Signs, table.NpcsAndMobs, table.TileEntities,
            table.WeightedPressurePlates, table.TownManager, table.Bestiary, table.CreativePowers,
        };
        var offset = corrupt == "footer" ? table.Footer.Start : boundaries.First(boundary => boundary.End > boundary.Start).Start;
        var staged = new List<string>();
        var hooks = new RoundTripHooks
        {
            AfterStage = path =>
            {
                staged.Add(path);
                var copy = File.ReadAllBytes(path);
                copy[offset] ^= 0xFF;
                File.WriteAllBytes(path, copy);
            },
        };

        var (code, output, error) = Run(hooks, input, Path.Combine(directory.Path, "out.wld"));

        Assert.Equal(1, code);
        Assert.Empty(output);
        Assert.Single(error.TrimEnd().Split('\n'));
        Assert.Equal(bytes, File.ReadAllBytes(input));
        Assert.Equal(["in.wld"], Names(directory.Path));
        Assert.Single(staged);
    }

    [Fact]
    public void Run_OutputNameContainingNewlineWithMissingInput_WritesExactlyOneStderrLine()
    {
        Assert.SkipWhen(OperatingSystem.IsWindows(), "Windows file names cannot contain a newline.");
        using var directory = new TemporaryDirectory();

        var (code, output, error) = Run(null, Path.Combine(directory.Path, "none.wld"), Path.Combine(directory.Path, "out\nname.wld"));

        Assert.Equal(1, code);
        Assert.Empty(output);
        Assert.Single(error.TrimEnd().Split('\n'));
        Assert.Empty(Names(directory.Path));
    }

    [Fact]
    public void Run_InputIsNotAWorld_ReturnsOneWithOneLineDiagnosticAndWritesNothing()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.Write("in.wld", [1, 2, 3, 4]);

        var (code, output, error) = Run(null, input, Path.Combine(directory.Path, "out.wld"));

        Assert.Equal(1, code);
        Assert.Empty(output);
        Assert.Single(error.TrimEnd().Split('\n'));
        Assert.Equal(["in.wld"], Names(directory.Path));
    }

    [Fact]
    public void Run_MissingInput_ReturnsOneAndWritesNothing()
    {
        using var directory = new TemporaryDirectory();

        var (code, _, error) = Run(null, Path.Combine(directory.Path, "none.wld"), Path.Combine(directory.Path, "out.wld"));

        Assert.Equal(1, code);
        Assert.Single(error.TrimEnd().Split('\n'));
        Assert.Empty(Names(directory.Path));
    }

    [Theory]
    [InlineData]
    [InlineData("a.wld")]
    [InlineData("a.wld", "b.wld", "c.wld")]
    public void Run_WrongArgumentCount_ReturnsTwoWithUsage(params string[] arguments)
    {
        var (code, output, error) = Run(null, arguments);

        Assert.Equal(2, code);
        Assert.Empty(output);
        Assert.Contains("roundtrip <input.wld> <output.wld>", error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Cli_RoundTrip_PrintsOutputPathAndWritesTheCopy()
    {
        using var directory = new TemporaryDirectory();
        var bytes = World();
        var input = directory.Write("in.wld", bytes);
        var target = Path.Combine(directory.Path, "out.wld");

        var result = await InspectorProcess.RunAsync(directory.Path, "roundtrip", input, target);

        Assert.Equal(0, result.ExitCode);
        Assert.Empty(result.Error);
        Assert.Equal(target, result.OutputText.Trim());
        Assert.Equal(bytes, File.ReadAllBytes(target));
    }

    [Fact]
    public async Task Cli_RoundTripToExistingFile_ReturnsTwo()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.Write("in.wld", World());
        var existing = directory.Write("out.wld", [9]);

        var result = await InspectorProcess.RunAsync(directory.Path, "roundtrip", input, existing);

        Assert.Equal(2, result.ExitCode);
        Assert.Equal([9], File.ReadAllBytes(existing));
    }
}
