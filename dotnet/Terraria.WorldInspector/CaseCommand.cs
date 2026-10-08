using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>Prints one observation pattern without taking a runtime dependency on synthetic tooling.</summary>
internal static class CaseCommand
{
    internal static int Run(string[] arguments, TextWriter output, TextWriter error)
    {
        if (arguments is not ["case", _, _, _] and not ["case", _, _, _, "--allow-changed-world"])
        {
            error.WriteLine("Usage: Terraria.WorldInspector case <world.wld> <manifest.json> <case-id> [--allow-changed-world]");
            return 2;
        }

        try
        {
            using var manifest = JsonDocument.Parse(File.ReadAllBytes(arguments[2]));
            var matches = manifest.RootElement.GetProperty("cases").EnumerateArray()
                .Where(entry => entry.GetProperty("id").GetString() == arguments[3]).ToArray();
            if (matches.Length != 1)
            {
                error.WriteLine("The manifest must contain exactly one case with this ID.");
                return 2;
            }

            var bytes = File.ReadAllBytes(arguments[1]);
            var changed = Convert.ToHexStringLower(SHA256.HashData(bytes)) != manifest.RootElement.GetProperty("outputHash").GetString();
            if (changed && arguments.Length != 5)
            {
                throw new InvalidDataException("The world hash does not match the manifest; inspect the originally generated copy.");
            }

            using var stream = new MemoryStream(bytes);
            var world = WorldReader.Read(stream);
            var entry = matches[0];
            var x = entry.GetProperty("x").GetInt32();
            var y = entry.GetProperty("y").GetInt32();
            var width = entry.GetProperty("width").GetInt32();
            var height = entry.GetProperty("height").GetInt32();
            if (x < 0 || y < 0 || width is <= 0 or > 256 || height is <= 0 or > 256
                || (long)x + width > world.Tiles.Width || (long)y + height > world.Tiles.Height)
            {
                throw new InvalidDataException("The manifest case is outside the world or too large.");
            }

            output.WriteLine(string.Create(CultureInfo.InvariantCulture,
                $"{entry.GetProperty("section").GetString()} / {arguments[3]}: {entry.GetProperty("title").GetString()} at ({x},{y}), {width}x{height}"));
            output.WriteLine($"Expected: {entry.GetProperty("expected").GetString()}");
            if (changed)
            {
                output.WriteLine("World hash differs from the generated manifest; reporting the explicitly selected observation copy.");
            }
            for (var row = y; row < y + height; row++)
            {
                for (var column = x; column < x + width; column++)
                {
                    var tile = world.Tiles[column, row];
                    output.WriteLine(string.Create(CultureInfo.InvariantCulture,
                        $"({column},{row}) block={Content(tile.Block)} wall={Content(tile.Wall)} shape={(int)tile.Shape} frameX={Frame(tile.FrameX)} frameY={Frame(tile.FrameY)}"));
                }
            }

            return 0;
        }
        catch (Exception exception) when (exception is IOException or InvalidDataException or UnauthorizedAccessException or JsonException
            or KeyNotFoundException or InvalidOperationException or FormatException or OverflowException
            or ArgumentException or WorldFormatException)
        {
            error.WriteLine($"Could not inspect the manifest case: {exception.Message}".ReplaceLineEndings(" "));
            return 1;
        }
    }

    private static string Content(ContentRef? content) => content switch
    {
        VanillaContentRef vanilla => vanilla.Id.ToString(CultureInfo.InvariantCulture),
        UnknownContentRef unknown => $"unknown:{unknown.RuntimeId.ToString(CultureInfo.InvariantCulture)}",
        ModContentRef mod => $"{mod.Mod}/{mod.InternalName}",
        _ => "air",
    };

    private static string Frame(short? frame) => frame?.ToString(CultureInfo.InvariantCulture) ?? "absent";
}
