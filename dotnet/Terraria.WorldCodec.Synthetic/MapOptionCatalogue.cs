using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Terraria.WorldCodec.Synthetic;

/// <summary>Projects the shipped observation rules into data cases; layout knows nothing about tile options.</summary>
internal static partial class MapOptionCatalogue
{
    private static readonly int[] SelectedTiles = [178, 82, 83, 84, 28, 21];

    internal static FramingCatalogue Read(string source)
    {
        var frameImportant = FixtureCorpus.FrameImportant();
        var cases = new List<FramingCase>();
        var unreachable = new List<UnreachableOption>();
        var rulesText = source.Split("tileOptions: {", StringSplitOptions.None)[1].Split("  },", StringSplitOptions.None)[0];
        var rules = RuleRegex().Matches(rulesText).ToDictionary(match => Number(match.Groups[1].Value));
        var colours = ColourRegex().Matches(source.Split("  walls:", StringSplitOptions.None)[0])
            .ToDictionary(match => Number(match.Groups[2].Value), match => match.Groups[1].Value.Split(',').Length);
        foreach (var id in SelectedTiles)
        {
            var rule = rules[id];
            var ranges = JsonSerializer.Deserialize<int[][]>(rule.Groups[3].Value)!;
            // Enumerate the storage domain, including option 0 only if a frame really selects it.
            var frames = new Dictionary<int, short>();
            for (var frame = 0; frame <= short.MaxValue; frame++)
            {
                var option = ranges.FirstOrDefault(range => frame >= range[0] && frame <= range[1])?[2] ?? 0;
                frames.TryAdd(option, (short)frame);
            }

            for (var option = 0; option < colours[id]; option++)
            {
                if (!frames.TryGetValue(option, out var frame))
                {
                    unreachable.Add(new UnreachableOption(id, option, "no observed frame selects it"));
                    continue;
                }

                var tile = new Tile
                {
                    Block = new VanillaContentRef(id),
                    FrameX = rule.Groups[2].Value == "frameX" ? frame : (short)0,
                    FrameY = rule.Groups[2].Value == "frameY" ? frame : (short)0,
                };
                cases.Add(Case($"Map-block-{id}-option-{option}", $"Tile {id}, map option {option}", tile, id, option,
                    $"map option {option} selected by {rule.Groups[2].Value}={frame}"));
            }
        }

        foreach (var layer in new[] { "block", "wall" })
        {
            var line = source.Split('\n').Single(line => line.Contains($"// {layer} IDs whose option depends", StringComparison.Ordinal));
            foreach (Match match in FallbackRegex().Matches(line))
            {
                var id = Number(match.Groups[1].Value);
                var tile = new Tile
                {
                    Block = layer == "block" ? new VanillaContentRef(id) : null,
                    Wall = layer == "wall" ? new VanillaContentRef(id) : null,
                    FrameX = layer == "block" && frameImportant[id] ? (short)0 : null,
                    FrameY = layer == "block" && frameImportant[id] ? (short)0 : null,
                };
                cases.Add(Case($"Map-{layer}-{id}-fallback", $"{layer} {id}: option 0 fallback", tile,
                    layer == "block" ? id : null, 0, $"viewer map option 0; game depends on {match.Groups[2].Value}; to observe"));
            }
        }

        return new FramingCatalogue(cases, unreachable);
    }

    private static FramingCase Case(string id, string title, Tile tile, int? mapTile, int option, string expected) =>
        new("Map options", id, title, ["#"], new() { ['#'] = tile }, expected, mapTile, option);

    private static int Number(string value) => int.Parse(value, CultureInfo.InvariantCulture);

    [GeneratedRegex("(\\d+): \\{ axis: \"(frameX|frameY)\", ranges: (\\[.*\\]) \\}")]
    private static partial Regex RuleRegex();
    [GeneratedRegex("\\[(0x[0-9a-f]+(?:, 0x[0-9a-f]+)*)\\], // (\\d+)")]
    private static partial Regex ColourRegex();
    [GeneratedRegex("(\\d+) \\(([^)]+)\\)")]
    private static partial Regex FallbackRegex();
}
