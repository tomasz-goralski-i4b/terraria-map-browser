using System.Buffers.Binary;

namespace Terraria.WorldCodec;

/// <summary>
/// Encodes the tile section (docs/file-format/writer.md, "Tile encoding"): column by column, greedy runs that never
/// cross a column. Two tiles are equal exactly when their run-less records are byte-identical, so the record encoding
/// doubles as the equality test.
/// </summary>
internal static class TileSectionWriter
{
    private const int MaxRun = short.MaxValue;
    private const int MaxByteRun = byte.MaxValue;
    private const int MaxId = ushort.MaxValue;
    private const int FoodPlatter = 520;
    private const int LogicSensor = 423;

    // Longest record: 4 flag bytes, block id (2), frames (4), paint, wall, wall paint, liquid, wall high, run (2).
    private const int MaxRecordLength = 20;

    private const int Flags1HasBlock = 0x02;
    private const int Flags1HasWall = 0x04;
    private const int Flags1LiquidKindShift = 3;
    private const int Flags1WideBlockId = 0x20;
    private const int Flags1RunWidthShift = 6;

    private const int Flags2RedWire = 0x02;
    private const int Flags2BlueWire = 0x04;
    private const int Flags2GreenWire = 0x08;
    private const int Flags2ShapeShift = 4;

    private const int Flags3Actuator = 0x02;
    private const int Flags3Inactive = 0x04;
    private const int Flags3BlockPaint = 0x08;
    private const int Flags3WallPaint = 0x10;
    private const int Flags3YellowWire = 0x20;
    private const int Flags3WallHigh = 0x40;
    private const int Flags3Shimmer = 0x80;

    private const int Flags4InvisibleBlock = 0x02;
    private const int Flags4InvisibleWall = 0x04;
    private const int Flags4FullBrightBlock = 0x08;
    private const int Flags4FullBrightWall = 0x10;

    /// <summary>The tile section bytes for <paramref name="tiles"/>.</summary>
    /// <param name="tiles">The grid to encode.</param>
    /// <param name="frameImportant">The file's frame-important bits (W-H3), indexed by block id.</param>
    /// <exception cref="TileEncodingException">A tile cannot be encoded; nothing is returned.</exception>
    public static byte[] Write(TileGrid tiles, IReadOnlyList<bool> frameImportant)
    {
        ArgumentNullException.ThrowIfNull(tiles);
        ArgumentNullException.ThrowIfNull(frameImportant);

        using var output = new MemoryStream();
        var current = new byte[MaxRecordLength];
        var next = new byte[MaxRecordLength];
        for (var x = 0; x < tiles.Width; x++)
        {
            var y = 0;
            while (y < tiles.Height)
            {
                var length = EncodeTile(tiles[x, y], x, y, frameImportant, current, out var runnable);
                var run = 0;
                while (runnable && run < MaxRun && y + run + 1 < tiles.Height)
                {
                    var nextLength = EncodeTile(tiles[x, y + run + 1], x, y + run + 1, frameImportant, next, out _);
                    if (!current.AsSpan(0, length).SequenceEqual(next.AsSpan(0, nextLength)))
                    {
                        break;
                    }

                    run++;
                }

                WriteRecord(output, current.AsSpan(0, length), run);
                y += run + 1;
            }
        }

        return output.ToArray();
    }

    private static void WriteRecord(MemoryStream output, ReadOnlySpan<byte> record, int run)
    {
        var runWidth = run == 0 ? 0 : run <= MaxByteRun ? 1 : 2;
        output.WriteByte((byte)(record[0] | (runWidth << Flags1RunWidthShift)));
        output.Write(record[1..]);
        if (runWidth == 1)
        {
            output.WriteByte((byte)run);
        }
        else if (runWidth == 2)
        {
            Span<byte> count = stackalloc byte[sizeof(short)];
            BinaryPrimitives.WriteInt16LittleEndian(count, (short)run);
            output.Write(count);
        }
    }

    /// <summary>Encodes one tile without its run counter; <paramref name="runnable"/> is false for blocks that never join a run.</summary>
    private static int EncodeTile(Tile tile, int x, int y, IReadOnlyList<bool> frameImportant, Span<byte> dest, out bool runnable)
    {
        var blockId = BlockId(tile.Block, x, y);
        var wallId = WallId(tile.Wall, x, y);
        var hasBlock = blockId >= 0;
        var hasWall = wallId > 0;
        runnable = blockId is not (FoodPlatter or LogicSensor);

        var shape = (int)tile.Shape;
        var liquid = tile.Liquid;
        if (shape is < 0 or > (int)BlockShape.SlopeBottomLeft)
        {
            throw Fail(x, y, "undefined block shape");
        }

        if (((int)tile.Wires & ~0xF) != 0)
        {
            throw Fail(x, y, "undefined wire bit");
        }

        if (liquid is not null && (uint)liquid.Kind > (uint)LiquidKind.Shimmer)
        {
            throw Fail(x, y, "undefined liquid kind");
        }

        // Preserve residual vanilla shapes independently of block presence, as the reader does.
        if (!hasBlock && (tile.Paint is not null
            || tile.FrameX is not null || tile.FrameY is not null))
        {
            throw Fail(x, y, "block flag without a block");
        }

        if (!hasWall && tile.WallPaint is not null)
        {
            throw Fail(x, y, "wall flag without a wall");
        }

        // Paint 0 means "no paint" (docs/cwm.md), so the byte is dropped (writer.md, "Noncanonical input on save").
        var paint = tile.Paint is > 0 ? tile.Paint : null;
        var wallPaint = tile.WallPaint is > 0 ? tile.WallPaint : null;

        var hasFrames = false;
        if (hasBlock)
        {
            if (blockId >= frameImportant.Count)
            {
                throw Fail(x, y, "block id has no frame-important entry");
            }

            hasFrames = frameImportant[blockId];
            if (hasFrames != (tile.FrameX is not null) || hasFrames != (tile.FrameY is not null))
            {
                throw Fail(x, y, hasFrames ? "frame-important block without frames" : "frames on a block that has none");
            }
        }

        var flags1 = (hasBlock ? Flags1HasBlock : 0) | (hasWall ? Flags1HasWall : 0) | (blockId > byte.MaxValue ? Flags1WideBlockId : 0);
        var flags2 = shape << Flags2ShapeShift;
        flags2 |= tile.Wires.HasFlag(TileWires.Red) ? Flags2RedWire : 0;
        flags2 |= tile.Wires.HasFlag(TileWires.Blue) ? Flags2BlueWire : 0;
        flags2 |= tile.Wires.HasFlag(TileWires.Green) ? Flags2GreenWire : 0;
        var flags3 = (tile.Actuator ? Flags3Actuator : 0) | (tile.Inactive ? Flags3Inactive : 0)
            | (paint is not null ? Flags3BlockPaint : 0) | (wallPaint is not null ? Flags3WallPaint : 0)
            | (tile.Wires.HasFlag(TileWires.Yellow) ? Flags3YellowWire : 0) | (wallId > byte.MaxValue ? Flags3WallHigh : 0);
        var flags4 = (tile.InvisibleBlock ? Flags4InvisibleBlock : 0) | (tile.InvisibleWall ? Flags4InvisibleWall : 0)
            | (tile.FullBrightBlock ? Flags4FullBrightBlock : 0) | (tile.FullBrightWall ? Flags4FullBrightWall : 0);
        if (liquid is not null)
        {
            var kind = liquid.Kind switch
            {
                LiquidKind.Water or LiquidKind.Shimmer => 1,
                LiquidKind.Lava => 2,
                _ => 3,
            };
            flags1 |= kind << Flags1LiquidKindShift;
            flags3 |= liquid.Kind == LiquidKind.Shimmer ? Flags3Shimmer : 0;
        }

        // Flag byte i+1 exists iff it or a later flag byte carries data (W-T1); the "more" bit is bit 0 of each.
        var flags = new[] { flags1, flags2, flags3, flags4 };
        var count = flags4 != 0 ? 4 : flags3 != 0 ? 3 : flags2 != 0 ? 2 : 1;
        for (var i = 0; i < count; i++)
        {
            dest[i] = (byte)(flags[i] | (i + 1 < count ? 0x01 : 0));
        }

        var length = count;
        if (hasBlock)
        {
            dest[length++] = (byte)blockId;
            if (blockId > byte.MaxValue)
            {
                dest[length++] = (byte)(blockId >> 8);
            }

            if (hasFrames)
            {
                BinaryPrimitives.WriteInt16LittleEndian(dest[length..], tile.FrameX!.Value);
                BinaryPrimitives.WriteInt16LittleEndian(dest[(length + sizeof(short))..], tile.FrameY!.Value);
                length += 2 * sizeof(short);
            }

            if (paint is not null)
            {
                dest[length++] = paint.Value;
            }
        }

        if (hasWall)
        {
            dest[length++] = (byte)wallId;
            if (wallPaint is not null)
            {
                dest[length++] = wallPaint.Value;
            }
        }

        if (liquid is not null)
        {
            dest[length++] = liquid.Amount;
        }

        if (wallId > byte.MaxValue)
        {
            dest[length++] = (byte)(wallId >> 8);
        }

        return length;
    }

    private static int BlockId(ContentRef? block, int x, int y) => block switch
    {
        null => -1,
        VanillaContentRef { Id: >= 0 and <= MaxId } vanilla => vanilla.Id,
        UnknownContentRef { RuntimeId: >= 0 and <= MaxId } unknown => unknown.RuntimeId,
        _ => throw Fail(x, y, "block cannot be encoded"),
    };

    private static int WallId(ContentRef? wall, int x, int y) => wall switch
    {
        null => 0,
        VanillaContentRef { Id: > 0 and <= MaxId } vanilla => vanilla.Id,
        UnknownContentRef { RuntimeId: > 0 and <= MaxId } unknown => unknown.RuntimeId,
        _ => throw Fail(x, y, "wall cannot be encoded"),
    };

    private static TileEncodingException Fail(int x, int y, string reason) => new(x, y, reason);
}
