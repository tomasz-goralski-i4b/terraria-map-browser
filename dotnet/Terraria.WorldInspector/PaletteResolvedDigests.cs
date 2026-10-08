using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>
/// Block and wall chunk digests computed over palette indices translated to one shared, content-ordered palette,
/// so equal chunks of two worlds whose palettes differ (order or entries) still have equal digests.
/// </summary>
public sealed class PaletteResolvedDigests
{
    /// <summary>Resolved value of an absent block/wall; never a shared palette index.</summary>
    private const uint Absent = uint.MaxValue;

    // Built on first use: a diff of two worlds with the same palette never needs it.
    private readonly Lazy<(Side Left, Side Right)> sides;

    private PaletteResolvedDigests(World left, World right) => sides = new(() => Build(left, right));

    /// <summary>Digest of the block and wall planes of <paramref name="region"/> in the left world.</summary>
    public string Left(TileRegion region) => sides.Value.Left.Digest(region);

    /// <summary>Digest of the block and wall planes of <paramref name="region"/> in the right world.</summary>
    public string Right(TileRegion region) => sides.Value.Right.Digest(region);

    public static PaletteResolvedDigests For(World left, World right)
    {
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);
        return new PaletteResolvedDigests(left, right);
    }

    private static (Side Left, Side Right) Build(World left, World right)
    {
        var leftModel = CanonicalWorldModel.FromTileGrid(left.Tiles);
        var rightModel = CanonicalWorldModel.FromTileGrid(right.Tiles);

        // The shared palette: every content of either side, ordered by its summary JSON so both sides agree.
        // Indices are 32-bit: the union of two valid palettes can exceed what a CWM Uint16 index (with 0xFFFF as
        // "absent") can hold, and a shared index must never equal the absence value.
        var shared = leftModel.Palette.Concat(rightModel.Palette).Select(Key).Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal).Select((key, index) => (key, index))
            .ToDictionary(entry => entry.key, entry => (uint)entry.index, StringComparer.Ordinal);
        return (new Side(leftModel, shared), new Side(rightModel, shared));
    }

    private static string Key(ContentRef content)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            CanonicalWorldJson.WriteContent(writer, content);
        }

        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    private sealed class Side(CanonicalWorldModel model, Dictionary<string, uint> shared)
    {
        private readonly uint[] toShared = model.Palette.Select(content => shared[Key(content)]).ToArray();

        public string Digest(TileRegion region)
        {
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            Span<byte> element = stackalloc byte[sizeof(uint)];
            foreach (var plane in new[] { "block", "wall" })
            {
                var bytes = model.GetPlane(plane).Span;
                for (var x = region.X; x < region.X + region.Width; x++)
                {
                    for (var y = region.Y; y < region.Y + region.Height; y++)
                    {
                        var index = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(((x * model.Height) + y) * sizeof(ushort))..]);
                        BinaryPrimitives.WriteUInt32LittleEndian(element, index == ushort.MaxValue ? Absent : toShared[index]);
                        hash.AppendData(element);
                    }
                }
            }

            return Convert.ToHexStringLower(hash.GetHashAndReset().AsSpan(0, 8));
        }
    }
}
