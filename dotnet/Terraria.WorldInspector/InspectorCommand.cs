using System.Globalization;
using System.Text;
using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>The common command entry point, with a reader seam for deterministic failure tests.</summary>
internal static class InspectorCommand
{
    internal static int Run(string[] arguments, TextWriter output, TextWriter error, Func<string, World> readWorld)
    {
        // Keep command output private until every read and conversion has succeeded.
        using var report = new StringWriter(CultureInfo.InvariantCulture);
        int exitCode;
        try
        {
            exitCode = RunCore(arguments, report, error, readWorld);
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            // Bound ordinary failures without hiding fatal resource exhaustion.
            // The CLI boundary must not expose unexpected exception messages or stack traces.
            error.WriteLine("Internal error: could not complete the command.");
            return 1;
        }

        output.Write(report.ToString());
        return exitCode;
    }

    internal static World? Read(string path, string description, TextWriter error, Func<string, World> readWorld)
    {
        try
        {
            return readWorld(path);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException
            or WorldFormatException or ArgumentException or NotSupportedException)
        {
            error.WriteLine($"Could not {description} '{path}': {exception.Message}");
            return null;
        }
    }

    private static int RunCore(string[] arguments, TextWriter output, TextWriter error, Func<string, World> readWorld)
    {
        if (arguments.Length > 0 && arguments[0] == "diff")
        {
            return DiffCommand.Run(arguments, output, error, readWorld);
        }

        const string Usage = "Usage: Terraria.WorldInspector inspect <file.wld>\n"
            + "       Terraria.WorldInspector export-json <file.wld> [--region x,y,w,h]\n"
            + "       Terraria.WorldInspector diff <left.wld> <right.wld> [--max n]";

        var exporting = arguments is ["export-json", _] or ["export-json", _, "--region", _];
        if (!exporting && arguments is not ["inspect", _])
        {
            error.WriteLine(Usage);
            return 2;
        }

        TileRegion? region = null;
        if (arguments.Length == 4 && !TryParseRegion(arguments[3], out region))
        {
            error.WriteLine($"Invalid --region '{arguments[3]}': expected x,y,w,h as integers.");
            return 2;
        }

        var world = Read(arguments[1], "inspect", error, readWorld);
        if (world is null)
        {
            return 1;
        }

        if (exporting)
        {
            // Buffer the whole document so that a failure leaves stdout empty.
            using var document = new MemoryStream();
            try
            {
                WorldSummaryJson.Write(world, document, region);
            }
            catch (ArgumentOutOfRangeException exception)
            {
                error.WriteLine($"Invalid --region: {exception.Message}");
                return 2;
            }

            output.Write(Encoding.UTF8.GetString(document.ToArray()));
            return 0;
        }

        WriteInspection(world, output);
        return 0;
    }

    private static void WriteInspection(World world, TextWriter output)
    {
        var blocks = 0;
        var walls = 0;
        var liquids = 0;
        for (var x = 0; x < world.Tiles.Width; x++)
        {
            for (var y = 0; y < world.Tiles.Height; y++)
            {
                var tile = world.Tiles[x, y];
                if (tile.Block is not null)
                {
                    blocks++;
                }

                if (tile.Wall is not null)
                {
                    walls++;
                }

                if (tile.Liquid is not null)
                {
                    liquids++;
                }
            }
        }

        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Version: {world.Header.Version}"));
        output.WriteLine($"Name: {EscapeControls(world.Metadata.Name)}");
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"World ID: {world.Metadata.WorldId}"));
        if (world.Metadata.Seed is { } seed)
        {
            output.WriteLine($"Seed: {EscapeControls(seed)}");
        }

        if (world.Metadata.GameMode is { } mode)
        {
            output.WriteLine($"Mode: {mode}");
        }

        output.WriteLine($"Evil: {world.Metadata.Evil}");
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Dimensions: {world.Tiles.Width}×{world.Tiles.Height}"));
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Tiles: {(long)world.Tiles.Width * world.Tiles.Height}"));
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Blocks: {blocks}"));
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Walls: {walls}"));
        output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Liquids: {liquids}"));
        output.WriteLine($"Skipped sections: {string.Join(", ", world.SkippedSections.Select(section => section.Name))}");
    }

    private static string EscapeControls(string text)
    {
        var escaped = new StringBuilder(text.Length);
        foreach (var character in text)
        {
            if (char.IsControl(character)
                || char.GetUnicodeCategory(character) is UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator
                || character is '\u061c' or '\u200e' or '\u200f'
                    or (>= '\u202a' and <= '\u202e') or (>= '\u2066' and <= '\u2069'))
            {
                escaped.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
            }
            else
            {
                escaped.Append(character);
            }
        }

        return escaped.ToString();
    }

    private static bool TryParseRegion(string text, out TileRegion? region)
    {
        region = null;
        var parts = text.Split(',');
        if (parts.Length != 4)
        {
            return false;
        }

        var values = new int[4];
        for (var i = 0; i < values.Length; i++)
        {
            if (!int.TryParse(parts[i], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out values[i]))
            {
                return false;
            }
        }

        region = new TileRegion(values[0], values[1], values[2], values[3]);
        return true;
    }
}
