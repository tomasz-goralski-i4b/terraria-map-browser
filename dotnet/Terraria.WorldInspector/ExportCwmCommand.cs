using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>The export-cwm command; the writer seam permits deterministic partial-write failure tests.</summary>
internal static class ExportCwmCommand
{
    internal static int Run(string[] arguments, TextWriter output, TextWriter error,
        Func<string, World> readWorld, Action<World, Stream>? writeWorld = null)
    {
        if (arguments is not ["export-cwm", _, _])
        {
            error.WriteLine("Usage: Terraria.WorldInspector export-cwm <input.wld> <output.cwm>");
            return 2;
        }

        string input;
        string target;
        try
        {
            input = Path.GetFullPath(arguments[1]);
            target = Path.GetFullPath(arguments[2]);
        }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException)
        {
            error.WriteLine($"Invalid export path: {exception.Message}".ReplaceLineEndings(" "));
            return 2;
        }

        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (string.Equals(input, target, comparison))
        {
            error.WriteLine("The CWM output must not be the input world.");
            return 2;
        }

        string? staged = null;
        try
        {
            var world = InspectorCommand.Read(input, "export CWM from", error, readWorld);
            if (world is null)
            {
                return 1;
            }

            if (File.Exists(target) || new FileInfo(target).LinkTarget is not null)
            {
                error.WriteLine("The CWM output path already exists (or aliases the input); choose a new file.");
                return 2;
            }

            staged = Path.Combine(Path.GetDirectoryName(target) ?? ".", $"{Path.GetFileName(target)}.{Guid.NewGuid():N}.tms.tmp");
            using (var stream = new FileStream(staged, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                if (writeWorld is null)
                {
                    CanonicalWorldBinary.Write(world, stream);
                }
                else
                {
                    writeWorld(world, stream);
                }

                stream.Flush(flushToDisk: true);
            }

            // Publish only complete files; refusing replacements also preserves sources reached through links.
            File.Move(staged, target, overwrite: false);
            staged = null;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException
            or WorldFormatException or ArgumentException or NotSupportedException)
        {
            error.WriteLine($"Could not export CWM to '{target}': {exception.Message}".ReplaceLineEndings(" "));
            return 1;
        }
        finally
        {
            if (staged is not null)
            {
                try
                {
                    File.Delete(staged);
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    // Preserve the export diagnostic if the output device also prevents cleanup.
                }
            }
        }

        output.WriteLine(target);
        return 0;
    }
}
