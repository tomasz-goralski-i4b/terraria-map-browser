using System.Globalization;
using System.Text;
using System.Text.Json;
using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>Compares summaries first, requesting semantic tiles only in differing chunks.</summary>
public static class WorldDiff
{
    /// <summary>
    /// Writes deterministic differences and returns the CLI exit code. Chunk readers return
    /// semantic tiles in column-major order for the requested rectangle.
    /// </summary>
    public static int Write(
        JsonElement leftSummary,
        JsonElement rightSummary,
        Func<TileRegion, IReadOnlyList<Tile>> readLeftChunk,
        Func<TileRegion, IReadOnlyList<Tile>> readRightChunk,
        TextWriter output,
        int maximum = 100,
        PaletteResolvedDigests? resolved = null)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(maximum);
        ArgumentNullException.ThrowIfNull(readLeftChunk);
        ArgumentNullException.ThrowIfNull(readRightChunk);
        ArgumentNullException.ThrowIfNull(output);
        var different = false;
        void Report(string path, string before, string after)
        {
            different = true;
            output.WriteLine($"{path}: {before} -> {after}");
        }

        foreach (var group in new[] { "metadata", "dimensions" })
        {
            foreach (var property in leftSummary.GetProperty(group).EnumerateObject())
            {
                var right = rightSummary.GetProperty(group).GetProperty(property.Name);
                if (!JsonElement.DeepEquals(property.Value, right))
                {
                    Report($"{group}.{property.Name}", Compact(property.Value), Compact(right));
                }
            }
        }

        var leftSections = SectionLengths(leftSummary);
        var rightSections = SectionLengths(rightSummary);
        foreach (var name in leftSections.Keys.Union(rightSections.Keys).Order(StringComparer.Ordinal))
        {
            var before = leftSections.TryGetValue(name, out var leftLength) ? (int?)leftLength : null;
            var after = rightSections.TryGetValue(name, out var rightLength) ? (int?)rightLength : null;
            if (before != after)
            {
                Report($"skippedSections.{name}.length", JsonSerializer.Serialize(before), JsonSerializer.Serialize(after));
            }
        }

        var leftPalette = leftSummary.GetProperty("palette");
        var rightPalette = rightSummary.GetProperty("palette");
        var leftContent = leftPalette.EnumerateArray().Select(Compact).ToHashSet(StringComparer.Ordinal);
        var rightContent = rightPalette.EnumerateArray().Select(Compact).ToHashSet(StringComparer.Ordinal);
        foreach (var content in leftContent.Except(rightContent).Order(StringComparer.Ordinal))
        {
            Report("palette", content, "absent");
        }

        foreach (var content in rightContent.Except(leftContent).Order(StringComparer.Ordinal))
        {
            Report("palette", "absent", content);
        }

        // Index digests are comparable only when the palette has the same index-to-content mapping.
        var samePalette = JsonElement.DeepEquals(leftPalette, rightPalette);
        var leftChunks = Chunks(leftSummary);
        var rightChunks = Chunks(rightSummary);
        var width = Math.Max(Dimension(leftSummary, "width"), Dimension(rightSummary, "width"));
        var height = Math.Max(Dimension(leftSummary, "height"), Dimension(rightSummary, "height"));
        long tileDifferences = 0;
        void TileDifference<T>(int x, int y, string field, T before, T after)
        {
            if (EqualityComparer<T>.Default.Equals(before, after))
            {
                return;
            }

            different = true;
            if (tileDifferences++ < maximum)
            {
                output.WriteLine(string.Create(CultureInfo.InvariantCulture,
                    $"tiles[{x},{y}].{field}: {Value(before)} -> {Value(after)}"));
            }
        }

        for (var stripe = 0; stripe < width; stripe += WorldSummaryJson.ChunkSize)
        {
            var candidates = new List<ChunkPair>();
            for (var top = 0; top < height; top += WorldSummaryJson.ChunkSize)
            {
                var key = (stripe / WorldSummaryJson.ChunkSize, top / WorldSummaryJson.ChunkSize);
                var hasLeft = leftChunks.TryGetValue(key, out var left);
                var hasRight = rightChunks.TryGetValue(key, out var right);
                if (!hasLeft && !hasRight)
                {
                    continue;
                }

                if (hasLeft && hasRight && samePalette && JsonElement.DeepEquals(left, right))
                {
                    continue;
                }

                var leftRegion = hasLeft ? Region(left) : null;
                var rightRegion = hasRight ? Region(right) : null;
                candidates.Add(new ChunkPair(leftRegion, rightRegion,
                    leftRegion is null ? [] : readLeftChunk(leftRegion),
                    rightRegion is null ? [] : readRightChunk(rightRegion)));
            }

            // Keep one chunk column in memory so output stays globally ordered by x, then y.
            for (var x = stripe; x < Math.Min(stripe + WorldSummaryJson.ChunkSize, width); x++)
            {
                foreach (var pair in candidates)
                {
                    var top = (pair.LeftRegion ?? pair.RightRegion)!.Y;
                    var bottom = top + Math.Max(pair.LeftRegion?.Height ?? 0, pair.RightRegion?.Height ?? 0);
                    for (var y = top; y < bottom; y++)
                    {
                        var left = TileAt(pair.LeftRegion, pair.LeftTiles, x, y);
                        var right = TileAt(pair.RightRegion, pair.RightTiles, x, y);
                        if (left is null || right is null)
                        {
                            if (left is not null || right is not null)
                            {
                                different = true;
                                if (tileDifferences++ < maximum)
                                {
                                    output.WriteLine(string.Create(CultureInfo.InvariantCulture,
                                        $"tiles[{x},{y}].presence: {(left is null ? "absent -> right-only" : "left-only -> absent")}"));
                                }
                            }

                            continue;
                        }

                        TileDifference(x, y, "block", left.Block, right.Block);
                        TileDifference(x, y, "wall", left.Wall, right.Wall);
                        TileDifference(x, y, "frameX", left.FrameX, right.FrameX);
                        TileDifference(x, y, "frameY", left.FrameY, right.FrameY);
                        TileDifference(x, y, "paint", left.Paint, right.Paint);
                        TileDifference(x, y, "wallPaint", left.WallPaint, right.WallPaint);
                        TileDifference(x, y, "wires", (int)left.Wires, (int)right.Wires);
                        TileDifference(x, y, "actuator", left.Actuator, right.Actuator);
                        TileDifference(x, y, "liquid.kind", left.Liquid?.Kind, right.Liquid?.Kind);
                        TileDifference(x, y, "liquid.amount", left.Liquid?.Amount, right.Liquid?.Amount);
                        TileDifference(x, y, "shape", left.Shape, right.Shape);
                        TileDifference(x, y, "inactive", left.Inactive, right.Inactive);
                        TileDifference(x, y, "invisibleBlock", left.InvisibleBlock, right.InvisibleBlock);
                        TileDifference(x, y, "invisibleWall", left.InvisibleWall, right.InvisibleWall);
                        TileDifference(x, y, "fullBrightBlock", left.FullBrightBlock, right.FullBrightBlock);
                        TileDifference(x, y, "fullBrightWall", left.FullBrightWall, right.FullBrightWall);
                    }
                }
            }
        }

        if (tileDifferences > maximum)
        {
            output.WriteLine(string.Create(CultureInfo.InvariantCulture, $"Omitted tile differences: {tileDifferences - maximum}"));
        }

        if (!different)
        {
            output.WriteLine("No differences.");
        }

        return different ? 3 : 0;
    }

    private static int Dimension(JsonElement summary, string name) => summary.GetProperty("dimensions").GetProperty(name).GetInt32();

    private static Dictionary<string, int> SectionLengths(JsonElement summary) => summary.GetProperty("skippedSections")
        .EnumerateArray().ToDictionary(section => section.GetProperty("name").GetString()!,
            section => section.GetProperty("end").GetInt32() - section.GetProperty("start").GetInt32(), StringComparer.Ordinal);

    private static Dictionary<(int X, int Y), JsonElement> Chunks(JsonElement summary) => summary.GetProperty("chunks")
        .GetProperty("digests").EnumerateArray().ToDictionary(chunk => (chunk.GetProperty("x").GetInt32(), chunk.GetProperty("y").GetInt32()));

    private static TileRegion Region(JsonElement chunk) => new(
        chunk.GetProperty("x").GetInt32() * WorldSummaryJson.ChunkSize,
        chunk.GetProperty("y").GetInt32() * WorldSummaryJson.ChunkSize,
        chunk.GetProperty("width").GetInt32(), chunk.GetProperty("height").GetInt32());

    private static Tile? TileAt(TileRegion? region, IReadOnlyList<Tile> tiles, int x, int y) =>
        region is null || x >= region.X + region.Width || y >= region.Y + region.Height
            ? null : tiles[((x - region.X) * region.Height) + y - region.Y];

    private static string Compact(JsonElement element) => JsonSerializer.Serialize(element);

    private static string Value<T>(T value)
    {
        if (value is ContentRef content)
        {
            using var buffer = new MemoryStream();
            using (var writer = new Utf8JsonWriter(buffer))
            {
                WorldSummaryJson.WriteContent(writer, content);
            }

            return Encoding.UTF8.GetString(buffer.ToArray());
        }

        return value is Enum enumeration
            ? JsonSerializer.Serialize(JsonNamingPolicy.CamelCase.ConvertName(enumeration.ToString()))
            : JsonSerializer.Serialize(value);
    }

    private sealed record ChunkPair(TileRegion? LeftRegion, TileRegion? RightRegion,
        IReadOnlyList<Tile> LeftTiles, IReadOnlyList<Tile> RightTiles);
}
