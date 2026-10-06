using System.Diagnostics;
using System.Text;

namespace Terraria.WorldCodec.Tests;

/// <summary>Runs the shipped inspector and keeps stdout as raw bytes (encoding, BOM and line endings are part of the contract).</summary>
internal static class InspectorProcess
{
    public static async Task<RawCommandResult> RunAsync(string workingDirectory, params string[] arguments)
    {
        var start = new ProcessStartInfo(Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet")
        {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "Terraria.WorldInspector.dll"));
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }

        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not launch the inspector.");
        using var output = new MemoryStream();
        var copy = process.StandardOutput.BaseStream.CopyToAsync(output);
        var error = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            process.Kill(entireProcessTree: true);
            throw;
        }

        await copy;
        return new RawCommandResult(process.ExitCode, output.ToArray(), await error);
    }
}

internal sealed record RawCommandResult(int ExitCode, byte[] Output, string Error)
{
    public string OutputText => Encoding.UTF8.GetString(Output);
}

/// <summary>A temporary directory for one test; deleted with everything in it.</summary>
internal sealed class TemporaryDirectory : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"terraria-export-{Guid.NewGuid():N}");

    public TemporaryDirectory() => Directory.CreateDirectory(Path);

    public string Write(string fileName, byte[] bytes)
    {
        var path = System.IO.Path.Combine(Path, fileName);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    public void Dispose() => Directory.Delete(Path, recursive: true);
}
