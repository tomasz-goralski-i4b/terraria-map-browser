using System.Globalization;
using System.Text;
using Terraria.WorldCodec;
using Terraria.WorldInspector;

Console.OutputEncoding = Encoding.UTF8;

const string Usage = "Usage: Terraria.WorldInspector inspect <file.wld>\n"
    + "       Terraria.WorldInspector export-json <file.wld> [--region x,y,w,h]";

var exporting = args is ["export-json", _] or ["export-json", _, "--region", _];
if (!exporting && args is not ["inspect", _])
{
    Console.Error.WriteLine(Usage);
    return 2;
}

TileRegion? region = null;
if (args.Length == 4 && !TryParseRegion(args[3], out region))
{
    Console.Error.WriteLine($"Invalid --region '{args[3]}': expected x,y,w,h as integers.");
    return 2;
}

World world;
try
{
    using var stream = File.OpenRead(args[1]);
    world = WorldReader.Read(stream);
}
catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or WorldFormatException or ArgumentException or NotSupportedException)
{
    Console.Error.WriteLine($"Could not inspect '{args[1]}': {exception.Message}");
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
        Console.Error.WriteLine($"Invalid --region: {exception.Message}");
        return 2;
    }

    using var stdout = Console.OpenStandardOutput();
    document.Position = 0;
    document.CopyTo(stdout);
    return 0;
}

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

Console.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Version: {world.Header.Version}"));
Console.WriteLine($"Name: {world.Metadata.Name}");
Console.WriteLine(string.Create(CultureInfo.InvariantCulture, $"World ID: {world.Metadata.WorldId}"));
if (world.Metadata.Seed is { } seed)
{
    Console.WriteLine($"Seed: {seed}");
}

if (world.Metadata.GameMode is { } mode)
{
    Console.WriteLine($"Mode: {mode}");
}

Console.WriteLine($"Evil: {world.Metadata.Evil}");
Console.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Dimensions: {world.Tiles.Width}×{world.Tiles.Height}"));
Console.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Tiles: {(long)world.Tiles.Width * world.Tiles.Height}"));
Console.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Blocks: {blocks}"));
Console.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Walls: {walls}"));
Console.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Liquids: {liquids}"));
Console.WriteLine($"Skipped sections: {string.Join(", ", world.SkippedSections.Select(section => section.Name))}");
return 0;

static bool TryParseRegion(string text, out TileRegion? region)
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
