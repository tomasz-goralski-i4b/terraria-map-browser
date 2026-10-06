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

    private readonly byte[] window = new byte[WindowSize];
    private long windowStart;
    private int windowLength;
    private long position = section.Start;
    private long recordStart;
    private int recordX;
    private int recordY;

    public TileGrid Read(int width, int height)
    {
        var tiles = new Tile[checked(width * height)];
        for (var x = 0; x < width; x++)
        {
            var y = 0;
            while (y < height)
            {
                recordStart = position;
                recordX = x;
                recordY = y;
                var (tile, run) = ReadRecord();
                if (run < 0)
                {
                    throw Error("negative run");
                }

                if (y + run > height - 1)
                {
                    throw Error("run crosses column end");
                }

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

    private (Tile Tile, int Run) ReadRecord()
    {
        var flags1 = Byte();
        var flags2 = 0;
        var flags3 = 0;
        var flags4 = 0;
        if ((flags1 & 0x01) != 0)
        {
            flags2 = Byte();
            if ((flags2 & 0x01) != 0)
            {
                flags3 = Byte();
                if ((flags3 & 0x01) != 0)
                {
                    flags4 = Byte();
                }
            }
        }

        var hasBlock = (flags1 & 0x02) != 0;
        var hasWall = (flags1 & 0x04) != 0;
        var liquidKind = (flags1 >> 3) & 0x03;
        var wideId = (flags1 & 0x20) != 0;
        var runWidth = flags1 >> 6;
        var shape = (flags2 >> 4) & 0x07;
        var hasPaint = (flags3 & 0x08) != 0;
        var hasWallPaint = (flags3 & 0x10) != 0;
        var hasWallHigh = (flags3 & 0x40) != 0;
        var shimmer = (flags3 & 0x80) != 0;

        if ((flags2 & 0x80) != 0 || (flags4 & 0xE1) != 0)
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

        if ((!hasBlock && (wideId || shape != 0 || hasPaint)) || (!hasWall && (hasWallPaint || hasWallHigh)))
        {
            throw Error("flag without owner");
        }

        if (shimmer && liquidKind != 1)
        {
            throw Error("shimmer without water-kind liquid");
        }

        ContentRef? block = null;
        short? frameX = null;
        short? frameY = null;
        byte? paint = null;
        if (hasBlock)
        {
            int id = wideId ? BinaryPrimitives.ReadUInt16LittleEndian(Take(sizeof(ushort))) : Byte();
            if (id >= frameImportant.Count)
            {
                throw Error("no frame-important entry");
            }

            block = id <= MaxVanillaBlock ? new VanillaContentRef(id) : new UnknownContentRef(id);
            if (frameImportant[id])
            {
                frameX = BinaryPrimitives.ReadInt16LittleEndian(Take(sizeof(short)));
                frameY = BinaryPrimitives.ReadInt16LittleEndian(Take(sizeof(short)));
            }

            if (hasPaint)
            {
                paint = Byte();
            }
        }

        int wallId = hasWall ? Byte() : 0;
        byte? wallPaint = hasWallPaint ? Byte() : null;
        TileLiquid? liquid = null;
        if (liquidKind != 0)
        {
            var kind = liquidKind switch
            {
                1 => shimmer ? LiquidKind.Shimmer : LiquidKind.Water,
                2 => LiquidKind.Lava,
                _ => LiquidKind.Honey,
            };
            liquid = new TileLiquid(kind, Byte());
        }

        if (hasWallHigh)
        {
            wallId += Byte() << 8;
        }

        ContentRef? wall = null;
        if (hasWall)
        {
            if (wallId == 0)
            {
                throw Error("wall id 0");
            }

            wall = wallId <= MaxVanillaWall ? new VanillaContentRef(wallId) : new UnknownContentRef(wallId);
        }

        int run = runWidth switch
        {
            1 => Byte(),
            2 => BinaryPrimitives.ReadInt16LittleEndian(Take(sizeof(short))),
            _ => 0,
        };

        var wires = TileWires.None;
        wires |= (flags2 & 0x02) != 0 ? TileWires.Red : TileWires.None;
        wires |= (flags2 & 0x04) != 0 ? TileWires.Blue : TileWires.None;
        wires |= (flags2 & 0x08) != 0 ? TileWires.Green : TileWires.None;
        wires |= (flags3 & 0x20) != 0 ? TileWires.Yellow : TileWires.None;

        var tile = new Tile
        {
            Block = block,
            Wall = wall,
            FrameX = frameX,
            FrameY = frameY,
            Paint = paint,
            WallPaint = wallPaint,
            Wires = wires,
            Actuator = (flags3 & 0x02) != 0,
            Liquid = liquid,
            Shape = (BlockShape)shape,
            Inactive = (flags3 & 0x04) != 0,
            InvisibleBlock = (flags4 & 0x02) != 0,
            InvisibleWall = (flags4 & 0x04) != 0,
            FullBrightBlock = (flags4 & 0x08) != 0,
            FullBrightWall = (flags4 & 0x10) != 0,
        };
        return (tile, run);
    }

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
