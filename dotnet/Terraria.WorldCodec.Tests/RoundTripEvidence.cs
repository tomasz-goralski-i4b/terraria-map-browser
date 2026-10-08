using System.Globalization;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// Test-only comparison of an original and a reloaded world for the round-trip proof (#44; docs/file-format/writer.md,
/// "Evidence: original vs candidate layout"). It compares the semantic model field by field and every byte the model
/// does not expose, so a hash match alone is never the evidence.
/// </summary>
internal static class RoundTripEvidence
{
    private const int MaxTileDifferences = 20;

    /// <summary>The bytes of a corpus fixture; a missing fixture is an error, never a skip.</summary>
    /// <exception cref="FileNotFoundException">The fixture file does not exist.</exception>
    public static byte[] LoadFixture(string file) => File.ReadAllBytes(VanillaCorpusTests.WorldPath(file));

    /// <summary>
    /// Every difference between <paramref name="original"/> and <paramref name="reloaded"/>, empty when equal. Each line starts
    /// with the part that differs: <c>Header</c>, <c>Metadata</c> (modeled fields), <c>Tile (x,y)</c>, or a byte section name
    /// (<c>FileHeader</c>, <c>Metadata</c>, the names of sections 3-10 in <see cref="WorldSectionTable"/>, <c>Footer</c>),
    /// followed by <c>: relative offset N</c> (offset of the first differing byte inside that section) or <c>: length</c>
    /// for size differences.
    /// </summary>
    public static IReadOnlyList<string> Differences(WorldEnvelope original, WorldEnvelope reloaded)
    {
        var differences = new List<string>();

        if (original.World.Header != reloaded.World.Header)
        {
            differences.Add($"Header: {original.World.Header} != {reloaded.World.Header}");
        }

        if (original.World.Metadata != reloaded.World.Metadata)
        {
            differences.Add($"Metadata (modeled): {original.World.Metadata} != {reloaded.World.Metadata}");
        }

        AddTileDifferences(differences, original.World.Tiles, reloaded.World.Tiles);

        AddByteDifference(differences, "FileHeader", original.FileHeaderBytes, reloaded.FileHeaderBytes);
        AddByteDifference(differences, "Metadata", original.MetadataBytes, reloaded.MetadataBytes);

        var names = original.OpaqueSections.Select(section => section.Name)
            .Union(reloaded.OpaqueSections.Select(section => section.Name));
        foreach (var name in names)
        {
            var left = original.OpaqueSections.FirstOrDefault(section => section.Name == name);
            var right = reloaded.OpaqueSections.FirstOrDefault(section => section.Name == name);
            if (left is null || right is null)
            {
                differences.Add($"{name}: missing");
                continue;
            }

            AddByteDifference(differences, name, left.Bytes, right.Bytes);
        }

        AddByteDifference(differences, "Footer", original.FooterBytes, reloaded.FooterBytes);
        return differences;
    }

    private static void AddTileDifferences(List<string> differences, TileGrid original, TileGrid reloaded)
    {
        if (original.Width != reloaded.Width || original.Height != reloaded.Height)
        {
            differences.Add(string.Create(CultureInfo.InvariantCulture,
                $"Tile: dimensions {original.Width}x{original.Height} != {reloaded.Width}x{reloaded.Height}"));
            return;
        }

        var count = 0;
        for (var x = 0; x < original.Width; x++)
        {
            for (var y = 0; y < original.Height; y++)
            {
                if (original[x, y] == reloaded[x, y])
                {
                    continue;
                }

                differences.Add(string.Create(CultureInfo.InvariantCulture, $"Tile ({x},{y}): {original[x, y]} != {reloaded[x, y]}"));
                if (++count >= MaxTileDifferences)
                {
                    return;
                }
            }
        }
    }

    private static void AddByteDifference(List<string> differences, string name, ReadOnlyMemory<byte> original, ReadOnlyMemory<byte> reloaded)
    {
        if (original.Length != reloaded.Length)
        {
            differences.Add(string.Create(CultureInfo.InvariantCulture, $"{name}: length {original.Length} != {reloaded.Length}"));
            return;
        }

        var offset = original.Span.CommonPrefixLength(reloaded.Span);
        if (offset < original.Length)
        {
            differences.Add(string.Create(CultureInfo.InvariantCulture, $"{name}: relative offset {offset}"));
        }
    }
}
