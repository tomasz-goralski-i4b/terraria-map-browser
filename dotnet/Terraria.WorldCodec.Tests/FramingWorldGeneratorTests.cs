using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Terraria.WorldCodec.Synthetic;

namespace Terraria.WorldCodec.Tests;

public sealed partial class FramingWorldGeneratorTests
{
    [Fact]
    public void Layout_DefaultCatalogue_UsesCompactSeparatedRows()
    {
        var plan = FramingWorldGenerator.Plan(4200, 1200, FramingCatalogue.Load());
        Assert.InRange(plan.ClearedStrip.Width, 1, 400);
        Assert.InRange(plan.ClearedStrip.Height, 1, 30);
        Assert.True(plan.Cases.Where(entry => entry.Section == "Map options").Select(entry => entry.Y).Distinct().Count() > 1);
        Assert.True(plan.Cases.Where(entry => entry.Section == "Blocks").Select(entry => entry.Y).Distinct().Count() > 1);
        AssertClearance(plan);
    }

    [Fact]
    public void Catalogue_AdditionalObservations_CoverCoralstoneCornerPriorityAndShapedNeighbours()
    {
        var catalogue = FramingCatalogue.Load();
        Assert.Contains(catalogue.Cases, entry => entry.Id == "Coralstone-dirt-pocket" && entry.Legend['#'].Block == new VanillaContentRef(315));
        Assert.Contains(catalogue.Cases, entry => entry.Id == "Corner-stone-four-holes");
        Assert.Contains(catalogue.Cases, entry => entry.Id == "Moss-three-stone-sides");
        for (var shape = 1; shape <= 5; shape++)
        {
            foreach (var side in new[] { "north", "east", "south", "west" })
            {
                var entry = Assert.Single(catalogue.Cases, entry => entry.Id == $"Neighbour-shape{shape}-{side}");
                Assert.Equal((BlockShape)shape, entry.Legend['s'].Shape);
                Assert.Equal(BlockShape.Full, entry.Legend['#'].Shape);
            }
        }
    }

    [Fact]
    public void Catalogue_CoversTheDocumentedFramingObservations()
    {
        var catalogue = FramingCatalogue.Load();
        var ids = catalogue.Cases.Select(entry => entry.Id).ToArray();
        Assert.Equal(ids.Length, ids.Distinct(StringComparer.Ordinal).Count());
        for (var example = 1; example <= 19; example++)
        {
            var suffixes = example is 8 or 14 or 16 ? new[] { "a", "b" } : new[] { "" };
            foreach (var suffix in suffixes)
            {
                Assert.Contains($"B{example}{suffix}", ids);
            }
        }

        for (var shape = 1; shape <= 5; shape++)
        {
            var entry = Assert.Single(catalogue.Cases, entry => entry.Id == $"H3-shape{shape}");
            Assert.Equal((BlockShape)shape, entry.Legend['#'].Shape);
        }

        for (var grass = 1; grass <= 9; grass++)
        {
            Assert.Contains($"G{grass}", ids);
        }

        Assert.Contains("G9-stone", ids);
        Assert.Equal(4, catalogue.Cases.Count(entry => entry.Section == "Diagonal hole"));
        Assert.Equal(7, catalogue.Cases.Count(entry => entry.Section == "Moss"));
        Assert.Equal(3, catalogue.Cases.Count(entry => entry.Section == "Ores"));
        Assert.Equal(32, catalogue.Cases.Count(entry => entry.Section == "Rim fallback"));
        Assert.Equal(2, catalogue.Cases.Count(entry => entry.Section == "Jungle grass"));
        Assert.All(catalogue.Cases.Where(entry => entry.Section == "Large frame"), entry =>
        {
            Assert.Equal(8, entry.Pattern.Length);
            Assert.All(entry.Pattern, row => Assert.Equal(6, row.Length));
        });
        Assert.All(catalogue.Cases, entry => Assert.False(string.IsNullOrWhiteSpace(entry.Expected)));
    }

    [Fact]
    public void MapCases_CoverExactlyTheOptionsReachableInTheGeneratedRules()
    {
        var source = File.ReadAllText(PalettePath());
        var catalogue = FramingCatalogue.Load();
        var rules = source.Split("tileOptions: {", StringSplitOptions.None)[1].Split("  },", StringSplitOptions.None)[0];
        // Independent oracle reads the current generated source, not a second hand-maintained option list.
        foreach (var tile in new[] { 178, 82, 83, 84, 28, 21 })
        {
            var rule = RuleRegex().Matches(rules).Single(match => int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) == tile);
            var axis = rule.Groups[2].Value;
            var ranges = JsonSerializer.Deserialize<int[][]>(rule.Groups[3].Value)!;
            var reachable = Enumerable.Range(0, short.MaxValue + 1).Select(frame => Option(ranges, frame)).ToHashSet();
            var cases = catalogue.Cases.Where(entry => entry.MapTile == tile).ToArray();
            Assert.Equal(reachable.Order(), cases.Select(entry => entry.MapOption!.Value).Order());
            Assert.All(cases, entry =>
            {
                Assert.Equal(["#"], entry.Pattern);
                var cell = entry.Legend['#'];
                Assert.Equal(entry.MapOption, Option(ranges, axis == "frameX" ? cell.FrameX!.Value : cell.FrameY!.Value));
            });

            var colours = ColourRegex().Matches(source.Split("  walls:", StringSplitOptions.None)[0]).Single(match => int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture) == tile);
            var count = colours.Groups[1].Value.Split(',').Length;
            var unreachable = Enumerable.Range(0, count).Where(option => !reachable.Contains(option));
            Assert.Equal(unreachable, catalogue.UnreachableOptions.Where(entry => entry.Tile == tile).Select(entry => entry.Option));
        }

        Assert.All(catalogue.UnreachableOptions, entry => Assert.Equal("no observed frame selects it", entry.Reason));
        var fallbackLine = source.Split('\n').Single(line => line.Contains("// block IDs whose option depends", StringComparison.Ordinal));
        var fallbackIds = FallbackRegex().Matches(fallbackLine).Select(match => int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture));
        foreach (var tile in fallbackIds)
        {
            var entry = Assert.Single(catalogue.Cases, entry => entry.Id == $"Map-block-{tile}-fallback");
            Assert.Equal(0, entry.MapOption);
            Assert.Equal(new VanillaContentRef(tile), entry.Legend['#'].Block);
        }

        var wall = Assert.Single(catalogue.Cases, entry => entry.Id == "Map-wall-27-fallback");
        Assert.Equal(new VanillaContentRef(27), wall.Legend['#'].Wall);
    }

    [Fact]
    public void Layout_AnExtraCatalogueEntryCreatesANewSectionWithoutLayoutChanges()
    {
        var original = FramingCatalogue.Load();
        var pearlstone = new FramingCase("Pearlstone observation", "Pearlstone-pocket", "Pearlstone inside stone",
            ["sss", "s#s", "sss"], new() { ['s'] = new() { Block = new VanillaContentRef(1) }, ['#'] = new() { Block = new VanillaContentRef(117) } },
            "to observe");
        var catalogue = original with { Cases = [.. original.Cases, pearlstone] };
        var plan = FramingWorldGenerator.Plan(4200, 1200, catalogue);
        Assert.Equal(catalogue.Cases.Count, plan.Cases.Count);
        Assert.Equal("Pearlstone observation", plan.Sections[^1].Name);
        Assert.Single(plan.Cases, entry => entry.Id == pearlstone.Id);
        AssertClearance(plan);
    }

    [Fact]
    public async Task Generate_CorpusBase_ProducesDeterministicReloadableWorldAndInspectableManifest()
    {
        using var directory = new TemporaryDirectory();
        var input = VanillaCorpusTests.WorldPath("SJCO1.wld");
        var originalHash = Hash(File.ReadAllBytes(input));
        var catalogue = FramingCatalogue.Load();
        var target = Path.Combine(directory.Path, "framing-observations.wld");
        var manifest = FramingWorldGenerator.Generate(input, target);
        var written = File.ReadAllBytes(target);
        Assert.Equal("1.4.5.8", manifest.GameBuild);
        Assert.Equal(originalHash, manifest.BaseWorldHash);
        Assert.Equal(Hash(written), manifest.OutputHash);
        Assert.Equal(originalHash, Hash(File.ReadAllBytes(input)));
        Assert.Equal(catalogue.UnreachableOptions, manifest.UnreachableOptions);
        Assert.Equal(catalogue.Cases.Select(entry => entry.Id), manifest.Cases.Select(entry => entry.Id));
        AssertClearance(manifest);

        using var stream = new MemoryStream(written);
        var envelope = WorldReader.ReadForSave(stream);
        foreach (var entry in catalogue.Cases)
        {
            var position = Assert.Single(manifest.Cases, position => position.Id == entry.Id);
            Assert.Equal(entry.Expected, position.Expected);
            for (var y = 0; y < position.Height; y++)
            {
                for (var x = 0; x < position.Width; x++)
                {
                    Assert.Equal(entry.Legend[entry.Pattern[y][x]], envelope.World.Tiles[position.X + x, position.Y + y]);
                }
            }

            for (var x = position.X - 2; x < position.X + position.Width + 2; x++)
            {
                Assert.Equal(new Tile(), envelope.World.Tiles[x, position.Y - 1]);
                Assert.Equal(new Tile(), envelope.World.Tiles[x, position.Y - 2]);
            }
        }

        foreach (var section in manifest.Sections)
        {
            Assert.Equal(new VanillaContentRef(38), envelope.World.Tiles[section.MarkerX, section.MarkerY].Block);
        }

        using var saved = new MemoryStream();
        WorldWriter.Write(envelope, saved);
        saved.Position = 0;
        var reloaded = WorldReader.Read(saved);
        var before = CanonicalWorldModel.FromTileGrid(envelope.World.Tiles);
        var after = CanonicalWorldModel.FromTileGrid(reloaded.Tiles);
        Assert.Equal(before.Palette, after.Palette);
        foreach (var plane in CanonicalWorldModel.PlaneNames)
        {
            Assert.True(before.GetPlane(plane).Span.SequenceEqual(after.GetPlane(plane).Span), plane);
        }

        var second = Path.Combine(directory.Path, "framing-observations-repeat.wld");
        FramingWorldGenerator.Generate(input, second);
        Assert.Equal(written, File.ReadAllBytes(second));
        Assert.Equal(File.ReadAllBytes(target + ".manifest.json"), File.ReadAllBytes(second + ".manifest.json"));

        var inspection = await InspectorProcess.RunAsync(directory.Path, "case", target, target + ".manifest.json", "B14a");
        Assert.Equal(0, inspection.ExitCode);
        Assert.Empty(inspection.Error);
        Assert.Contains("B14a", inspection.OutputText, StringComparison.Ordinal);
        Assert.Contains("shape=0", inspection.OutputText, StringComparison.Ordinal);
        Assert.Contains("block=1", inspection.OutputText, StringComparison.Ordinal);
        Assert.Contains("frameX=", (await InspectorProcess.RunAsync(directory.Path, "case", target, target + ".manifest.json", "Map-block-178-option-1")).OutputText, StringComparison.Ordinal);
        Assert.Equal(2, (await InspectorProcess.RunAsync(directory.Path, "case", target, target + ".manifest.json", "B20")).ExitCode);
        Assert.Equal(1, (await InspectorProcess.RunAsync(directory.Path, "case", input, target + ".manifest.json", "B14a")).ExitCode);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Generate_ExistingWorldOrManifest_RefusesWithoutChangingFiles(bool manifestExists)
    {
        using var directory = new TemporaryDirectory();
        var target = Path.Combine(directory.Path, "framing-observations.wld");
        var existing = manifestExists ? target + ".manifest.json" : target;
        var bytes = System.Text.Encoding.UTF8.GetBytes("Retain the previous framing observations.");
        File.WriteAllBytes(existing, bytes);
        Assert.Throws<IOException>(() => FramingWorldGenerator.Generate(VanillaCorpusTests.WorldPath("SJCO1.wld"), target));
        Assert.Equal(bytes, File.ReadAllBytes(existing));
        Assert.Single(Directory.GetFiles(directory.Path));
    }

    [Fact]
    public void Generate_CopyOutsideTheCorpus_RefusesPlayerWorldInput()
    {
        using var directory = new TemporaryDirectory();
        var input = directory.Write("Journey-building-world.wld", File.ReadAllBytes(VanillaCorpusTests.WorldPath("SJCO1.wld")));
        Assert.Throws<InvalidDataException>(() => FramingWorldGenerator.Generate(input, Path.Combine(directory.Path, "framing-observations.wld")));
        Assert.Single(Directory.GetFiles(directory.Path));
    }

    [Fact]
    public void Layout_DuplicateIdsOrOversizedPatterns_AreRejectedBeforeWriting()
    {
        var catalogue = FramingCatalogue.Load();
        Assert.Throws<InvalidDataException>(() => FramingWorldGenerator.Plan(4200, 1200, catalogue with { Cases = [.. catalogue.Cases, catalogue.Cases[0]] }));
        Assert.Throws<InvalidDataException>(() => FramingWorldGenerator.Plan(12, 12, catalogue));
    }

    private static void AssertClearance(FramingManifest manifest)
    {
        var strip = manifest.ClearedStrip;
        foreach (var entry in manifest.Cases)
        {
            Assert.True(entry.X >= strip.X + 2 && entry.Y >= strip.Y + 2);
            Assert.True(entry.X + entry.Width + 2 <= strip.X + strip.Width);
            Assert.True(entry.Y + entry.Height + 2 <= strip.Y + strip.Height);
            foreach (var other in manifest.Cases.Where(other => other.Id != entry.Id))
            {
                Assert.True(entry.X + entry.Width + 2 <= other.X || other.X + other.Width + 2 <= entry.X
                    || entry.Y + entry.Height + 2 <= other.Y || other.Y + other.Height + 2 <= entry.Y,
                    $"{entry.Id} too close to {other.Id}");
            }
        }
    }

    private static int Option(int[][] ranges, int frame) => ranges.FirstOrDefault(range => frame >= range[0] && frame <= range[1])?[2] ?? 0;
    private static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    private static string PalettePath() => Path.GetFullPath(Path.Combine(Path.GetDirectoryName(VanillaCorpusTests.WorldPath("SJCO1.wld"))!, "..", "..", "..", "packages", "renderer", "src", "palette", "terraria-map-palette.generated.ts"));

    [GeneratedRegex("(\\d+): \\{ axis: \"(frameX|frameY)\", ranges: (\\[.*\\]) \\}")]
    private static partial Regex RuleRegex();
    [GeneratedRegex("\\[(0x[0-9a-f]+(?:, 0x[0-9a-f]+)*)\\], // (\\d+)")]
    private static partial Regex ColourRegex();
    [GeneratedRegex("(\\d+) \\(")]
    private static partial Regex FallbackRegex();
}
