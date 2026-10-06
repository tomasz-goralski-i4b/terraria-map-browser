using System.Buffers.Binary;

namespace Terraria.WorldCodec;

/// <summary>
/// Canonical World Model v1 (docs/cwm.md): one little-endian plane per tile field, column-major
/// (index = <c>x * height + y</c>), plus a <see cref="ContentRef"/> palette shared by blocks and walls.
/// </summary>
public sealed class CanonicalWorldModel
{
    private const ushort AbsentContent = 0xFFFF;

    private static readonly int[] ElementSizes = [2, 2, 2, 2, 1, 1, 1, 1, 1, 2];

    private readonly byte[][] planes;

    private CanonicalWorldModel(int width, int height, IReadOnlyList<ContentRef> palette, byte[][] planes)
    {
        Width = width;
        Height = height;
        Palette = palette;
        this.planes = planes;
    }

    /// <summary>Plane names in their canonical order.</summary>
    public static IReadOnlyList<string> PlaneNames { get; } =
        ["block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags"];

    public int Width { get; }

    public int Height { get; }

    /// <summary>Distinct content in order of first appearance in a column-major scan (block before wall).</summary>
    public IReadOnlyList<ContentRef> Palette { get; }

    /// <summary>Bytes of one element of the named plane (1 or 2).</summary>
    /// <exception cref="ArgumentException">The name is not one of <see cref="PlaneNames"/>.</exception>
    public static int ElementSize(string plane) => ElementSizes[PlaneIndex(plane)];

    /// <summary>The whole plane as little-endian bytes, column-major.</summary>
    /// <exception cref="ArgumentException">The name is not one of <see cref="PlaneNames"/>.</exception>
    public ReadOnlyMemory<byte> GetPlane(string plane) => planes[PlaneIndex(plane)];

    public static CanonicalWorldModel FromTileGrid(TileGrid tiles)
    {
        ArgumentNullException.ThrowIfNull(tiles);

        var count = checked(tiles.Width * tiles.Height);
        var block = new byte[count * 2];
        var wall = new byte[count * 2];
        var frameX = new byte[count * 2];
        var frameY = new byte[count * 2];
        var paint = new byte[count];
        var wallPaint = new byte[count];
        var liquid = new byte[count];
        var liquidAmount = new byte[count];
        var shape = new byte[count];
        var flags = new byte[count * 2];

        var palette = new List<ContentRef>();
        var indices = new Dictionary<ContentRef, ushort>();

        ushort Index(ContentRef? content)
        {
            if (content is null)
            {
                return AbsentContent;
            }

            if (!indices.TryGetValue(content, out var index))
            {
                index = checked((ushort)palette.Count);
                indices.Add(content, index);
                palette.Add(content);
            }

            return index;
        }

        var i = 0;
        for (var x = 0; x < tiles.Width; x++)
        {
            for (var y = 0; y < tiles.Height; y++, i++)
            {
                var tile = tiles[x, y];
                BinaryPrimitives.WriteUInt16LittleEndian(block.AsSpan(i * 2), Index(tile.Block));
                BinaryPrimitives.WriteUInt16LittleEndian(wall.AsSpan(i * 2), Index(tile.Wall));
                BinaryPrimitives.WriteInt16LittleEndian(frameX.AsSpan(i * 2), tile.FrameX ?? -1);
                BinaryPrimitives.WriteInt16LittleEndian(frameY.AsSpan(i * 2), tile.FrameY ?? -1);
                paint[i] = tile.Paint ?? 0;
                wallPaint[i] = tile.WallPaint ?? 0;
                if (tile.Liquid is { } tileLiquid)
                {
                    liquid[i] = (byte)(tileLiquid.Kind switch
                    {
                        LiquidKind.Water => 1,
                        LiquidKind.Lava => 2,
                        LiquidKind.Honey => 3,
                        _ => 4,
                    });
                    liquidAmount[i] = tileLiquid.Amount;
                }

                shape[i] = (byte)tile.Shape;
                BinaryPrimitives.WriteUInt16LittleEndian(flags.AsSpan(i * 2), Flags(tile));
            }
        }

        return new CanonicalWorldModel(
            tiles.Width,
            tiles.Height,
            palette,
            [block, wall, frameX, frameY, paint, wallPaint, liquid, liquidAmount, shape, flags]);
    }

    private static ushort Flags(Tile tile)
    {
        // Bits 0-3 are the wire colours, in TileWires order.
        var flags = (int)tile.Wires & 0xF;
        flags |= tile.Actuator ? 1 << 4 : 0;
        flags |= tile.Inactive ? 1 << 5 : 0;
        flags |= tile.InvisibleBlock ? 1 << 6 : 0;
        flags |= tile.InvisibleWall ? 1 << 7 : 0;
        flags |= tile.FullBrightBlock ? 1 << 8 : 0;
        flags |= tile.FullBrightWall ? 1 << 9 : 0;
        return (ushort)flags;
    }

    private static int PlaneIndex(string plane)
    {
        for (var i = 0; i < PlaneNames.Count; i++)
        {
            if (string.Equals(PlaneNames[i], plane, StringComparison.Ordinal))
            {
                return i;
            }
        }

        throw new ArgumentException($"Unknown plane '{plane}'.", nameof(plane));
    }
}
