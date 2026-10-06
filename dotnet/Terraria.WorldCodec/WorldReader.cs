using System.Buffers.Binary;
using System.Collections.Frozen;
using System.Globalization;
using System.Text;

namespace Terraria.WorldCodec;

/// <summary>Reads <c>.wld</c> files according to docs/file-format.md.</summary>
public static class WorldReader
{
    private const int VersionLength = 4;
    private const int HeaderLength = 26;
    private const int SignatureOffset = 4;
    private const int SignatureLength = 7;
    private const int FileTypeOffset = 11;
    private const int RevisionOffset = 12;
    private const int FlagsOffset = 16;
    private const int SectionCountOffset = 24;
    private const short ExpectedSectionCount = 11;
    private const string ExpectedSignature = "relogic";
    private const string ChineseBuildSignature = "xindong";

    /// <summary>The explicit set of format versions accepted in M1.</summary>
    public static IReadOnlySet<int> SupportedVersions { get; } = new[] { 326 }.ToFrozenSet();

    /// <summary>Implementation safety limit for <see cref="WorldMetadata.Width"/> (docs/file-format.md, "Dimensions").</summary>
    public const int MaxWorldWidth = 65_536;

    /// <summary>Implementation safety limit for <see cref="WorldMetadata.Height"/>.</summary>
    public const int MaxWorldHeight = 65_536;

    /// <summary>Implementation safety limit for width · height.</summary>
    public const long MaxWorldTileCount = 1L << 28;

    /// <summary>Reads world metadata (section 1) after <see cref="ReadSectionTable"/>.</summary>
    /// <remarks>Consumes every field of the section and leaves the stream at the start of the tile section.</remarks>
    /// <exception cref="WorldFormatException">The metadata is malformed, overruns or underruns its section.</exception>
    public static WorldMetadata ReadMetadata(Stream stream, WorldFileHeader header, WorldSectionTable table)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentNullException.ThrowIfNull(header);
        ArgumentNullException.ThrowIfNull(table);
        ValidateVersion(header.Version);

        // The section table guarantees the section lies inside a file smaller than 2 GiB.
        var section = new byte[table.Metadata.End - table.Metadata.Start];
        stream.Position = table.Metadata.Start;
        stream.ReadExactly(section);
        var r = new MetadataSectionReader(section, table.Metadata.Start);

        // Rows 1-12 (format 326: every row except 58 is present).
        var name = r.String("name");
        var seed = r.String("seed");
        r.Skip(sizeof(ulong), "worldGenVersion");
        var guidHex = Convert.ToHexStringLower(r.Bytes(16, "guid"));
        var worldId = r.Int32("worldId");
        r.Int32s(4);
        var height = ReadDimension(r, "height", MaxWorldHeight);
        var widthStart = r.AbsolutePosition;
        var width = ReadDimension(r, "width", MaxWorldWidth);
        if ((long)width * height > MaxWorldTileCount)
        {
            throw MetadataSectionReader.Error(widthStart, "width · height exceeds the implementation limit", "width");
        }

        if (width > table.Tiles.End - table.Tiles.Start)
        {
            throw MetadataSectionReader.Error(widthStart, "every column needs at least one byte of the tile section", "width");
        }

        var gameMode = (WorldGameMode)r.Int32("gameMode");

        // Rows 13-21.
        r.Bools(9);
        r.Skip(2 * sizeof(long));
        r.Skip(sizeof(byte));
        r.Int32s(17 + 2);
        r.Skip(3 * sizeof(double));
        r.Bool();
        r.Int32s(1);
        r.Bools(2);
        r.Int32s(2);

        // Row 22.
        var evil = r.Bool("crimson") ? WorldEvil.Crimson : WorldEvil.Corruption;

        // Rows 23-31.
        r.Bools(10 + 1 + 7);
        r.Bools(2);
        r.Skip(sizeof(byte));
        r.Int32s(1);
        r.Bools(1 + 1);
        r.Int32s(3);
        r.Skip(2 * sizeof(double));
        r.Skip(sizeof(byte));
        r.Bool();
        r.Int32s(1);
        r.Skip(sizeof(float));
        r.Int32s(3);
        r.Skip(8);
        r.Int32s(1);
        r.Skip(sizeof(short) + sizeof(float));

        // Row 32: angler finishers (each String is at least its 1-byte prefix).
        var anglerFinishers = r.Count(sizeof(int), 1, "anglerFinishers");
        for (var index = 0; index < anglerFinishers; index++)
        {
            r.String("anglerFinishers");
        }

        // Rows 33-35.
        r.Bool();
        r.Int32s(1);
        r.Bools(3);
        r.Int32s(2);
        r.Int32s(r.Count(sizeof(short), sizeof(int), "killCounts"));
        var banners = r.Count(sizeof(short), sizeof(ushort), "claimableBanners");
        r.Skip(banners * sizeof(ushort));

        // Rows 36-39.
        r.Bools(1 + 9 + 9);
        r.Bools(2);
        r.Int32s(1);
        r.Int32s(r.Count(sizeof(int), sizeof(int), "partyingNpcs"));

        // Rows 40-44.
        r.Bool();
        r.Int32s(1);
        r.Skip(2 * sizeof(float));
        r.Bools(4);
        r.Skip(5);
        r.Bool();
        r.Int32s(1);
        r.Bools(3);

        // Row 45.
        r.Int32s(r.Count(sizeof(int), sizeof(int), "treeTopVariations"));

        // Rows 46-54 (row 54 physically after row 53).
        r.Bools(2);
        r.Int32s(4);
        r.Bools(3);
        r.Bools(12);
        r.Bools(9);
        r.Bool();
        r.Skip(sizeof(byte));
        r.Bools(2);
        r.Bools(2);
        r.Int32s(2);

        // Row 55: team spawns, (x Int16, y Int16) each.
        r.Bool();
        var teamSpawns = r.Count(sizeof(byte), 2 * sizeof(short), "teamSpawns");
        r.Skip(teamSpawns * 2 * sizeof(short));

        // Rows 56-57; row 58 is absent for 326; row 59.
        r.Bools(1 + 2);
        r.String("worldGenManifest");

        if (r.Remaining != 0)
        {
            throw MetadataSectionReader.Error(r.AbsolutePosition, "unread bytes");
        }

        return new WorldMetadata(name, seed, guidHex, worldId, width, height, gameMode, evil);
    }

    private static int ReadDimension(MetadataSectionReader reader, string field, int max)
    {
        var start = reader.AbsolutePosition;
        var value = reader.Int32(field);
        if (value <= 0)
        {
            throw MetadataSectionReader.Error(start, "must be positive", field);
        }

        if (value > max)
        {
            throw MetadataSectionReader.Error(start, "exceeds the implementation limit", field);
        }

        return value;
    }

    /// <summary>Reads section boundaries and frame-important bits after <see cref="ReadHeader"/>.</summary>
    /// <remarks>Requires a seekable stream; leaves it at the start of world metadata without reading payload.</remarks>
    public static WorldSectionTable ReadSectionTable(Stream stream, WorldFileHeader header)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentNullException.ThrowIfNull(header);
        if (!stream.CanSeek)
        {
            throw new ArgumentException("Reading the section table requires a seekable stream.", nameof(stream));
        }

        ValidateVersion(header.Version);
        ValidateSectionCount(header.SectionCount);

        var fileLength = stream.Length;
        if (fileLength > int.MaxValue)
        {
            throw new WorldFormatException(WorldFormatError.MalformedSectionTable, HeaderLength, "file must be smaller than 2 GiB");
        }

        const int PointerBytesLength = ExpectedSectionCount * sizeof(int);
        const int FrameCountOffset = HeaderLength + PointerBytesLength;
        const int PackedBitsOffset = FrameCountOffset + sizeof(short);
        Span<byte> pointerBytes = stackalloc byte[PointerBytesLength];
        ReadExactly(stream, pointerBytes, HeaderLength);
        Span<byte> countBytes = stackalloc byte[sizeof(short)];
        ReadExactly(stream, countBytes, FrameCountOffset);
        var frameCount = BinaryPrimitives.ReadInt16LittleEndian(countBytes);
        if (frameCount < 0)
        {
            throw new WorldFormatException(WorldFormatError.MalformedSectionTable, FrameCountOffset, "negative frame-important count");
        }

        // Int16 limits the packed table to 4096 bytes, independently of section pointers.
        var packedBits = new byte[(frameCount + 7) / 8];
        ReadExactly(stream, packedBits, PackedBitsOffset);
        var headerEnd = PackedBitsOffset + packedBits.Length;
        Span<int> pointers = stackalloc int[ExpectedSectionCount];
        for (var index = 0; index < pointers.Length; index++)
        {
            var pointer = BinaryPrimitives.ReadInt32LittleEndian(pointerBytes[(index * sizeof(int))..]);
            if (pointer < headerEnd || pointer > fileLength ||
                (index == 0 ? pointer != headerEnd : pointer < pointers[index - 1] ||
                    (index > 1 && pointer == pointers[index - 1])))
            {
                throw new WorldFormatException(
                    WorldFormatError.MalformedSectionTable,
                    HeaderLength + (index * sizeof(int)),
                    "section pointer must match the header end or increase within the file bounds");
            }

            pointers[index] = pointer;
        }

        if ((long)pointers[^1] + 6 > fileLength)
        {
            throw new WorldFormatException(
                WorldFormatError.MalformedSectionTable,
                HeaderLength + PointerBytesLength - sizeof(int),
                "footer requires at least six bytes");
        }

        var frameImportant = new bool[frameCount];
        for (var tileId = 0; tileId < frameImportant.Length; tileId++)
        {
            frameImportant[tileId] = (packedBits[tileId / 8] & (1 << (tileId % 8))) != 0;
        }

        return new WorldSectionTable(
            new WorldSectionBoundary(0, pointers[0]),
            new WorldSectionBoundary(pointers[0], pointers[1]),
            new WorldSectionBoundary(pointers[1], pointers[2]),
            new WorldSectionBoundary(pointers[2], pointers[3]),
            new WorldSectionBoundary(pointers[3], pointers[4]),
            new WorldSectionBoundary(pointers[4], pointers[5]),
            new WorldSectionBoundary(pointers[5], pointers[6]),
            new WorldSectionBoundary(pointers[6], pointers[7]),
            new WorldSectionBoundary(pointers[7], pointers[8]),
            new WorldSectionBoundary(pointers[8], pointers[9]),
            new WorldSectionBoundary(pointers[9], pointers[10]),
            new WorldSectionBoundary(pointers[10], fileLength),
            frameImportant);
    }

    /// <summary>
    /// Reads and validates the file header and leaves <paramref name="stream"/> at the start of the section table.
    /// </summary>
    /// <exception cref="WorldFormatException">The header is truncated, unsupported or not a world.</exception>
    public static WorldFileHeader ReadHeader(Stream stream)
    {
        ArgumentNullException.ThrowIfNull(stream);

        // Check order (docs/file-format.md): steps 1-6.
        var bytes = new byte[HeaderLength];
        ReadExactly(stream, bytes.AsSpan(0, VersionLength), 0);

        var version = BinaryPrimitives.ReadInt32LittleEndian(bytes);
        ValidateVersion(version);

        ReadExactly(stream, bytes.AsSpan(VersionLength), VersionLength);

        var signature = Encoding.ASCII.GetString(bytes, SignatureOffset, SignatureLength);
        if (signature != ExpectedSignature)
        {
            var reason = signature == ChineseBuildSignature ? "unsupported variant" : "invalid signature";
            throw new WorldFormatException(WorldFormatError.NotAWorld, SignatureOffset, reason);
        }

        var fileType = (WorldFileType)bytes[FileTypeOffset];
        if (fileType != WorldFileType.World)
        {
            throw new WorldFormatException(
                WorldFormatError.NotAWorld,
                FileTypeOffset,
                string.Create(CultureInfo.InvariantCulture, $"file type {(byte)fileType} is not a world"));
        }

        var sectionCount = BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(SectionCountOffset));
        ValidateSectionCount(sectionCount);

        return new WorldFileHeader(
            version,
            signature,
            fileType,
            BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(RevisionOffset)),
            BinaryPrimitives.ReadUInt64LittleEndian(bytes.AsSpan(FlagsOffset)),
            sectionCount);
    }

    private static void ValidateVersion(int version)
    {
        if (!SupportedVersions.Contains(version))
        {
            throw new WorldFormatException(
                WorldFormatError.UnsupportedVersion,
                0,
                string.Create(CultureInfo.InvariantCulture, $"format version {version} is not supported"));
        }
    }

    private static void ValidateSectionCount(short sectionCount)
    {
        if (sectionCount != ExpectedSectionCount)
        {
            throw new WorldFormatException(
                WorldFormatError.MalformedSectionTable,
                SectionCountOffset,
                string.Create(CultureInfo.InvariantCulture, $"expected {ExpectedSectionCount} sections, found {sectionCount}"));
        }
    }

    /// <summary>Fills <paramref name="buffer"/>; on end of data throws <c>Truncated</c> at the end-of-data offset.</summary>
    private static void ReadExactly(Stream stream, Span<byte> buffer, int startOffset)
    {
        var total = stream.ReadAtLeast(buffer, buffer.Length, throwOnEndOfStream: false);
        if (total < buffer.Length)
        {
            throw new WorldFormatException(
                WorldFormatError.Truncated,
                startOffset + total,
                string.Create(CultureInfo.InvariantCulture, $"file ends after {startOffset + total} bytes of the {HeaderLength}-byte header"));
        }
    }
}
