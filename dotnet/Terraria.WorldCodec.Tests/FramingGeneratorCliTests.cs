using System.Diagnostics;

namespace Terraria.WorldCodec.Tests;

public sealed class FramingGeneratorCliTests
{
    [Fact]
    public void Generate_LockedPlayerWorld_RejectsThePathWithoutReadingIt()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.Write("Journey-building-world.wld", File.ReadAllBytes(VanillaCorpusTests.WorldPath("SJCO1.wld")));
        using var locked = new FileStream(input, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        Assert.Throws<InvalidDataException>(() => Terraria.WorldCodec.Synthetic.FramingWorldGenerator.Generate(input,
            Path.Combine(directory.Path, "framing-observations.wld")));
        Assert.Single(Directory.GetFiles(directory.Path));
    }

    [Fact]
    public async Task Generate_NonCorpusInput_ReturnsOneLineDiagnosticWithoutAStackTrace()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.Write("Journey-building-world.wld", File.ReadAllBytes(VanillaCorpusTests.WorldPath("SJCO1.wld")));
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
        {
            WorkingDirectory = directory.Path,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "Terraria.WorldCodec.Synthetic.dll"));
        start.ArgumentList.Add("generate");
        start.ArgumentList.Add(input);
        start.ArgumentList.Add(Path.Combine(directory.Path, "framing-observations.wld"));
        using var process = Process.Start(start)!;
        var output = process.StandardOutput.ReadToEndAsync(TestContext.Current.CancellationToken);
        var error = process.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        await process.WaitForExitAsync(timeout.Token);
        Assert.Equal(1, process.ExitCode);
        Assert.Empty(await output);
        Assert.Single((await error).TrimEnd().Split('\n'));
        Assert.Contains("player worlds are not inputs", await error, StringComparison.Ordinal);
        Assert.Single(Directory.GetFiles(directory.Path));
    }
}
