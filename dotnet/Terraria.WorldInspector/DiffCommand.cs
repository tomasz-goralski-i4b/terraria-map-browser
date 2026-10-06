using System.Globalization;
using System.Text.Json;
using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

internal static class DiffCommand
{
    internal static int Run(string[] arguments, TextWriter output, TextWriter error)
    {
        var maximum = 100;
        if (arguments is not ["diff", _, _] and not ["diff", _, _, "--max", _]
            || (arguments.Length == 5
                && (!int.TryParse(arguments[4], NumberStyles.None, CultureInfo.InvariantCulture, out maximum) || maximum < 0)))
        {
            error.WriteLine("Usage: Terraria.WorldInspector diff <left.wld> <right.wld> [--max n]");
            return 2;
        }

        var left = Read(arguments[1], "left", error);
        if (left is null)
        {
            return 1;
        }

        var right = Read(arguments[2], "right", error);
        if (right is null)
        {
            return 1;
        }

        using var leftSummary = Summary(left);
        using var rightSummary = Summary(right);
        return WorldDiff.Write(leftSummary.RootElement, rightSummary.RootElement,
            region => ReadChunk(left, region), region => ReadChunk(right, region), output, maximum);
    }

    private static World? Read(string path, string side, TextWriter error)
    {
        try
        {
            using var stream = File.OpenRead(path);
            return WorldReader.Read(stream);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException
            or WorldFormatException or ArgumentException or NotSupportedException)
        {
            error.WriteLine($"Could not read {side} world '{path}': {exception.Message}");
            return null;
        }
    }

    private static JsonDocument Summary(World world)
    {
        using var stream = new MemoryStream();
        WorldSummaryJson.Write(world, stream);
        stream.Position = 0;
        return JsonDocument.Parse(stream);
    }

    private static Tile[] ReadChunk(World world, TileRegion region)
    {
        var tiles = new Tile[region.Width * region.Height];
        for (var x = 0; x < region.Width; x++)
        {
            for (var y = 0; y < region.Height; y++)
            {
                tiles[(x * region.Height) + y] = world.Tiles[region.X + x, region.Y + y];
            }
        }

        return tiles;
    }
}
