using System.Buffers.Binary;

namespace Terraria.WorldCodec;

/// <summary>
/// Decodes the tile section (docs/file-format.md, "Tile data"). Every read is bounded by the section end and goes
/// through a small window, so memory follows the records consumed, not the declared section length.
/// </summary>
internal sealed class TileSectionReader(Stream stream, WorldSectionBoundary section, IReadOnlyList<bool> frameImportant)
{
    private const string SectionName = "Tiles";
    private const int WindowSize = 4096;
    private const int MaxVanillaBlock = 753;
    private const int MaxVanillaWall = 366;

    // Flag byte 1 bits
    private const int Flags1HasMoreFlags = 0x01;
    private const int Flags1HasBlock = 0x02;
    private const int Flags1HasWall = 0x04;
    private const int Flags1LiquidKindShift = 3;
    private const int Flags1LiquidKindMask = 0x03;
    private const int Flags1WideBlockId = 0x20;
    private const int Flags1RunWidthShift = 6;
    private const int Flags1RunWidthMask = 0x03;

    // Flag byte 2 bits
    private const int Flags2HasMoreFlags = 0x01;
    private const int Flags2RedWire = 0x02;
    private const int Flags2BlueWire = 0x04;
    private const int Flags2GreenWire = 0x08;
    private const int Flags2ShapeShift = 4;
    private const int Flags2ShapeMask = 0x07;
    private const int Flags2ReservedBits = 0x80;

    // Flag byte 3 bits
    private const int Flags3HasMoreFlags = 0x01;
    private const int Flags3Actuator = 0x02;
    private const int Flags3Inactive = 0x04;
    private const int Flags3BlockPaint = 0x08;
    private const int Flags3WallPaint = 0x10;
    private const int Flags3YellowWire = 0x20;
    private const int Flags3WallHigh = 0x40;
    private const int Flags3Shimmer = 0x80;

    // Flag byte 4 bits
    private const int Flags4ReservedMask = 0xE1;
    private const int Flags4InvisibleBlock = 0x02;
    private const int Flags4InvisibleWall = 0x04;
    private const int Flags4FullBrightBlock = 0x08;
    private const int Flags4FullBrightWall = 0x10;

    private readonly byte[] window = new byte[WindowSize];
    private long windowStart;
    private int windowLength;
    private long position = section.Start;
    private long recordStart;
    private int recordX;
    private int recordY;

    internal long AbsolutePosition => position;

    public TileGrid Read(int width, int height)
    {
        var tiles = new Tile[checked(width * height)];
        for (var x = 0; x < width; x++)
        {
            var y = 0;
            while (y < height)
            {
                var (tile, run) = ReadRecord(x, y, height);
                Array.Fill(tiles, tile, (x * height) + y, run + 1);
                y += run + 1;
            }
        }

        if (position != section.End)
        {
            throw new WorldFormatException(WorldFormatError.MalformedTiles, position, "section not fully consumed", SectionName, null);
        }

        return new TileGrid(width, height, tiles);
    }

    internal (Tile Tile, int Run) ReadRecord(int x, int y, int columnHeight)
    {
        recordStart = position;
        recordX = x;
        recordY = y;
        var (tile, run) = ReadRecord();
        if (run < 0)
        {
            throw Error("negative run");
        }

        if (y + run > columnHeight - 1)
        {
            throw Error("run crosses column end");
        }

        return (tile, run);
    }

    private (Tile Tile, int Run) ReadRecord()
    {
        var flags1 = Byte();
        var flags2 = HasFlag(flags1, Flags1HasMoreFlags) ? Byte() : 0;
        var flags3 = HasFlag(flags2, Flags2HasMoreFlags) ? Byte() : 0;
        var flags4 = HasFlag(flags3, Flags3HasMoreFlags) ? Byte() : 0;

        var hasBlock = HasFlag(flags1, Flags1HasBlock);
        var hasWall = HasFlag(flags1, Flags1HasWall);
        var liquidKind = (flags1 >> Flags1LiquidKindShift) & Flags1LiquidKindMask;
        var wideId = HasFlag(flags1, Flags1WideBlockId);
        var runWidth = (flags1 >> Flags1RunWidthShift) & Flags1RunWidthMask;
        var shape = (flags2 >> Flags2ShapeShift) & Flags2ShapeMask;
        var hasPaint = HasFlag(flags3, Flags3BlockPaint);
        var hasWallPaint = HasFlag(flags3, Flags3WallPaint);
        var hasWallHigh = HasFlag(flags3, Flags3WallHigh);
        var shimmer = HasFlag(flags3, Flags3Shimmer);

        if (HasFlag(flags2, Flags2ReservedBits) || (flags4 & Flags4ReservedMask) != 0)
        {
            throw Error("reserved bit");
        }

        if (runWidth == 3)
        {
            throw Error("reserved run width");
        }

        if (shape > (int)BlockShape.SlopeBottomLeft)
        {
            throw Error("undefined block shape");
        }

        // Our former vanilla validation incorrectly treated residual shape bits as ownerless flags.
        // Vanilla SaveWorldTiles preserves slopes after active(false), even without an active block.
        if ((!hasBlock && (wideId || hasPaint)) || (!hasWall && (hasWallPaint || hasWallHigh)))
        {
            throw Error("flag without owner");
        }

        if (shimmer && liquidKind != 1)
        {
            throw Error("shimmer without water-kind liquid");
        }

        var (block, frameX, frameY, paint) = ReadBlockData(hasBlock, wideId, hasPaint);
        var wallId = hasWall ? Byte() : 0;
        var wallPaint = hasWallPaint ? (byte?)Byte() : null;
        var liquid = ReadLiquidData(liquidKind, shimmer);
        if (hasWallHigh)
        {
            wallId += Byte() << 8;
        }

        var wall = ReadWallData(hasWall, wallId);
        var run = runWidth switch
        {
            1 => Byte(),
            2 => BinaryPrimitives.ReadInt16LittleEndian(Take(sizeof(short))),
            _ => 0,
        };

        var tile = new Tile
        {
            Block = block,
            Wall = wall,
            FrameX = frameX,
            FrameY = frameY,
            Paint = paint,
            WallPaint = wallPaint,
            Wires = ReadWireFlags(flags2, flags3),
            Actuator = HasFlag(flags3, Flags3Actuator),
            Liquid = liquid,
            Shape = (BlockShape)shape,
            Inactive = HasFlag(flags3, Flags3Inactive),
            InvisibleBlock = HasFlag(flags4, Flags4InvisibleBlock),
            InvisibleWall = HasFlag(flags4, Flags4InvisibleWall),
            FullBrightBlock = HasFlag(flags4, Flags4FullBrightBlock),
            FullBrightWall = HasFlag(flags4, Flags4FullBrightWall),
        };
        return (tile, run);
    }

    private (ContentRef? Block, short? FrameX, short? FrameY, byte? Paint) ReadBlockData(bool hasBlock, bool wideId, bool hasPaint)
    {
        if (!hasBlock)
        {
            return (null, null, null, null);
        }

        var id = wideId ? BinaryPrimitives.ReadUInt16LittleEndian(Take(sizeof(ushort))) : Byte();
        if (id >= frameImportant.Count)
        {
            throw Error("no frame-important entry");
        }

        var block = (ContentRef)(id <= MaxVanillaBlock ? new VanillaContentRef(id) : new UnknownContentRef(id));
        short? frameX = null;
        short? frameY = null;
        if (frameImportant[id])
        {
            frameX = BinaryPrimitives.ReadInt16LittleEndian(Take(sizeof(short)));
            frameY = BinaryPrimitives.ReadInt16LittleEndian(Take(sizeof(short)));
        }

        byte? paint = hasPaint ? Byte() : null;
        return (block, frameX, frameY, paint);
    }

    private TileLiquid? ReadLiquidData(int liquidKind, bool shimmer)
    {
        if (liquidKind == 0)
        {
            return null;
        }

        var kind = liquidKind switch
        {
            1 => shimmer ? LiquidKind.Shimmer : LiquidKind.Water,
            2 => LiquidKind.Lava,
            _ => LiquidKind.Honey,
        };
        return new TileLiquid(kind, Byte());
    }

    private ContentRef? ReadWallData(bool hasWall, int wallId)
    {
        if (!hasWall)
        {
            return null;
        }

        if (wallId == 0)
        {
            throw Error("wall id 0");
        }

        return (ContentRef)(wallId <= MaxVanillaWall ? new VanillaContentRef(wallId) : new UnknownContentRef(wallId));
    }

    private static TileWires ReadWireFlags(int flags2, int flags3)
    {
        var wires = TileWires.None;
        if (HasFlag(flags2, Flags2RedWire))
        {
            wires |= TileWires.Red;
        }

        if (HasFlag(flags2, Flags2BlueWire))
        {
            wires |= TileWires.Blue;
        }

        if (HasFlag(flags2, Flags2GreenWire))
        {
            wires |= TileWires.Green;
        }

        if (HasFlag(flags3, Flags3YellowWire))
        {
            wires |= TileWires.Yellow;
        }

        return wires;
    }

    private static bool HasFlag(int flags, int mask) => (flags & mask) != 0;

    private WorldFormatException Error(string reason) =>
        new(WorldFormatError.MalformedTiles, recordStart, reason, SectionName, null) { X = recordX, Y = recordY };

    private byte Byte() => Take(sizeof(byte))[0];

    private ReadOnlySpan<byte> Take(int length)
    {
        // Sections lie inside a file smaller than 2 GiB (section table), so the difference fits in an int.
        if (length > (int)(section.End - position))
        {
            throw Error("truncated record");
        }

        if (position < windowStart || position + length > windowStart + windowLength)
        {
            windowStart = position;
            windowLength = (int)Math.Min(WindowSize, section.End - position);
            stream.Position = windowStart;
            stream.ReadExactly(window, 0, windowLength);
        }

        var span = window.AsSpan((int)(position - windowStart), length);
        position += length;
        return span;
    }
}
