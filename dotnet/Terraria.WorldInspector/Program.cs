using System.Globalization;
using System.Text;
using Terraria.WorldCodec;

Console.OutputEncoding = Encoding.UTF8;

if (args.Length != 2 || args[0] != "inspect")
{
    Console.Error.WriteLine("Usage: Terraria.WorldInspector inspect <file.wld>");
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
