using System.Globalization;
using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>Test seams for the failure paths of <see cref="RoundTripCommand"/>; both hooks run with the staged file path.</summary>
internal sealed record RoundTripHooks
{
    /// <summary>Runs right after the staged file has been written, before it is reloaded and compared.</summary>
    public Action<string>? AfterStage { get; init; }

    /// <summary>Runs after validation succeeded, right before the staged file is moved to the output path.</summary>
    public Action<string>? BeforeMove { get; init; }
}

/// <summary><c>roundtrip &lt;input.wld&gt; &lt;output.wld&gt;</c>: writes a validated copy to a new path, never replacing a file (docs/round-trip.md).</summary>
internal static class RoundTripCommand
{
    private const string Usage = "Usage: Terraria.WorldInspector roundtrip <input.wld> <output.wld>";

    internal static int Run(string[] arguments, TextWriter output, TextWriter error, RoundTripHooks? hooks = null)
    {
        if (arguments is not ["roundtrip", _, _])
        {
            error.WriteLine(Usage);
            return 2;
        }

        var target = Path.GetFullPath(arguments[2]);

        // An existing entry (file, directory or any symbolic link, even a dangling one) covers every spelling of the
        // input: aliases, case differences, "..", and links all resolve to an entry that exists.
        if (File.Exists(target) || Directory.Exists(target) || new FileInfo(target).LinkTarget is not null)
        {
            error.WriteLine($"Refusing to write '{target}': the output path already exists (or is the input); roundtrip never overwrites a file.");
            return 2;
        }

        string? staged = null;
        try
        {
            WorldEnvelope envelope;
            using (var source = File.OpenRead(arguments[1]))
            {
                envelope = WorldReader.ReadForSave(source);
            }

            staged = Path.Combine(
                Path.GetDirectoryName(target) ?? ".",
                string.Create(CultureInfo.InvariantCulture, $"{Path.GetFileName(target)}.{Guid.NewGuid():N}.tms.tmp"));
            using (var stream = new FileStream(staged, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                WorldWriter.Write(envelope, stream);
                stream.Flush(flushToDisk: true);
            }

            hooks?.AfterStage?.Invoke(staged);
            Validate(staged, envelope.World);
            hooks?.BeforeMove?.Invoke(staged);

            // No overwrite: a file that appeared meanwhile makes the move fail and the staged file is removed.
            File.Move(staged, target, overwrite: false);
            staged = null;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or WorldFormatException
            or WorldWriteException or TileEncodingException or InvalidDataException or ArgumentException or NotSupportedException)
        {
            error.WriteLine($"Could not write round-tripped copy '{target}': {OneLine(exception.Message)}");
            return 1;
        }
        finally
        {
            if (staged is not null)
            {
                TryDelete(staged);
            }
        }

        output.WriteLine(target);
        return 0;
    }

    private static void Validate(string staged, World source)
    {
        World copy;
        using (var stream = File.OpenRead(staged))
        {
            copy = WorldReader.Read(stream);
        }

        if (copy.Header != source.Header || copy.Metadata != source.Metadata
            || copy.Tiles.Width != source.Tiles.Width || copy.Tiles.Height != source.Tiles.Height)
        {
            throw new InvalidDataException("the staged copy does not reload to the same world");
        }

        for (var x = 0; x < source.Tiles.Width; x++)
        {
            for (var y = 0; y < source.Tiles.Height; y++)
            {
                if (!Equals(copy.Tiles[x, y], source.Tiles[x, y]))
                {
                    throw new InvalidDataException($"the staged copy differs at tile ({x}, {y})");
                }
            }
        }
    }

    private static string OneLine(string message) => message.ReplaceLineEndings(" ");

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Best effort: the original failure is what gets reported.
        }
    }
}
