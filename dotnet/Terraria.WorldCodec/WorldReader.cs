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
    private static readonly UTF8Encoding FooterUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    /// <summary>The explicit set of format versions accepted in M1.</summary>
    public static IReadOnlySet<int> SupportedVersions { get; } = new[] { 326 }.ToFrozenSet();

    /// <summary>Implementation safety limit for <see cref="WorldMetadata.Width"/> (docs/file-format.md, "Dimensions").</summary>
    public const int MaxWorldWidth = 65_536;

    /// <summary>Implementation safety limit for <see cref="WorldMetadata.Height"/>.</summary>
    public const int MaxWorldHeight = 65_536;

    /// <summary>Implementation safety limit for width · height.</summary>
    public const long MaxWorldTileCount = 1L << 28;

    /// <summary>Reads the header, metadata, tiles and independent read-only entity sections (docs/file-format.md).</summary>
    /// <remarks>Requires a readable, seekable stream.</remarks>
    /// <exception cref="ArgumentException">The stream is not readable or seekable.</exception>
    /// <exception cref="WorldFormatException">The file violates the format contract.</exception>
    public static World Read(Stream stream) => ReadWorld(stream).World;

    private static (World World, WorldSectionTable Table) ReadWorld(Stream stream)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ValidateStreamCapabilities(stream);

        var header = ReadHeader(stream);
        var table = ReadSectionTable(stream, header);
        var metadata = ReadMetadata(stream, header, table);
        var tiles = new TileSectionReader(stream, table.Tiles, table.FrameImportant).Read(metadata.Width, metadata.Height);
        stream.Position = table.Tiles.End;
        SkippedSection[] skipped =
        [
            new(nameof(WorldSectionTable.Chests), table.Chests),
            new(nameof(WorldSectionTable.Signs), table.Signs),
            new(nameof(WorldSectionTable.NpcsAndMobs), table.NpcsAndMobs),
            new(nameof(WorldSectionTable.TileEntities), table.TileEntities),
            new(nameof(WorldSectionTable.WeightedPressurePlates), table.WeightedPressurePlates),
            new(nameof(WorldSectionTable.TownManager), table.TownManager),
            new(nameof(WorldSectionTable.Bestiary), table.Bestiary),
            new(nameof(WorldSectionTable.CreativePowers), table.CreativePowers),
            new(nameof(WorldSectionTable.Footer), table.Footer),
        ];
        var entities = EntitySectionReader.ReadAll(stream, table);
        stream.Position = table.Tiles.End;
        return (new World(header, metadata, tiles, skipped) { Entities = entities }, table);
    }

    /// <summary>Reads a world for saving: <see cref="Read"/> plus every unmodelled source byte (docs/file-format/writer.md).</summary>
    /// <remarks>Requires a readable, seekable stream; the result does not reference it.</remarks>
    /// <exception cref="ArgumentException">The stream is not readable or seekable.</exception>
    /// <exception cref="WorldFormatException">The file violates the format contract, including the footer.</exception>
    public static WorldEnvelope ReadForSave(Stream stream)
    {
        var (world, table) = ReadWorld(stream);
        var footer = ReadSlice(stream, table.Footer);
        ValidateFooter(footer, table.Footer.Start, world.Metadata);

        // Sections 3-10 are the skipped sections minus the trailing footer entry.
        var opaque = new List<OpaqueSection>(world.SkippedSections.Count - 1);
        foreach (var skipped in world.SkippedSections)
        {
            if (skipped.Name != nameof(WorldSectionTable.Footer))
            {
                opaque.Add(new OpaqueSection(skipped.Name, ReadSlice(stream, skipped.Boundary)));
            }
        }

        return new WorldEnvelope
        {
            World = world,
            Table = table,
            FileHeaderBytes = ReadSlice(stream, table.FileHeader),
            MetadataBytes = ReadSlice(stream, table.Metadata),
            OpaqueSections = opaque,
            FooterBytes = footer,
        };
    }

    private static byte[] ReadSlice(Stream stream, WorldSectionBoundary section)
    {
        // Sections lie within a file shorter than 2 GiB (checked by ReadSectionTable).
        var bytes = new byte[checked((int)(section.End - section.Start))];
        stream.Position = section.Start;
        stream.ReadExactly(bytes);
        return bytes;
    }

    /// <summary>Footer checks in the order of docs/file-format/writer.md, "Footer (M2)".</summary>
    internal static void ValidateFooter(ReadOnlySpan<byte> footer, long start, WorldMetadata metadata)
    {
        const int MarkerAndIdLength = 1 + sizeof(int);
        var idEnd = footer.Length - sizeof(int);
        var namePrefix = start + 1;

        // Step 1: the length prefix and name must fit before the last four bytes.
        if (footer.Length < MarkerAndIdLength + 1)
        {
            throw new WorldFormatException(WorldFormatError.MalformedFooter, namePrefix, "truncated");
        }

        var prefixLength = 0;
        long nameLength = 0;
        var prefixValid = false;
        while (prefixLength < 5 && 1 + prefixLength < idEnd)
        {
            var current = footer[1 + prefixLength];
            nameLength |= (long)(current & 0x7F) << (7 * prefixLength);
            prefixLength++;
            if ((current & 0x80) == 0)
            {
                prefixValid = prefixLength < 5 || current <= 0x07;
                break;
            }
        }

        // A prefix still open at the end of the name area, or a name longer than the area, is truncation.
        if (!prefixValid && prefixLength < 5)
        {
            throw new WorldFormatException(WorldFormatError.MalformedFooter, namePrefix, "truncated");
        }

        if (prefixValid && 1 + prefixLength + nameLength > idEnd)
        {
            throw new WorldFormatException(WorldFormatError.MalformedFooter, namePrefix, "truncated");
        }

        // Step 2.
        if (footer[0] != 1)
        {
            throw new WorldFormatException(WorldFormatError.MalformedFooter, start, "invalid marker");
        }

        // Step 3.
        if (!prefixValid)
        {
            throw new WorldFormatException(WorldFormatError.MalformedFooter, namePrefix, "invalid name");
        }

        var nameBytes = footer.Slice(1 + prefixLength, (int)nameLength);
        try
        {
            _ = FooterUtf8.GetString(nameBytes);
        }
        catch (DecoderFallbackException)
        {
            throw new WorldFormatException(WorldFormatError.MalformedFooter, namePrefix, "invalid name");
        }

        // Steps 4-5.
        var nameEnd = 1 + prefixLength + (int)nameLength;
        if (!nameBytes.SequenceEqual(FooterUtf8.GetBytes(metadata.Name)))
        {
            throw new WorldFormatException(WorldFormatError.InconsistentFooter, namePrefix, "name differs from the metadata", nameof(WorldSectionTable.Footer), "name");
        }

        var idOffset = start + nameEnd;
        if (BinaryPrimitives.ReadInt32LittleEndian(footer[nameEnd..]) != metadata.WorldId)
        {
            throw new WorldFormatException(WorldFormatError.InconsistentFooter, idOffset, "world id differs from the metadata", nameof(WorldSectionTable.Footer), "worldId");
        }

        // Step 6.
        if (footer.Length > nameEnd + sizeof(int))
        {
            throw new WorldFormatException(WorldFormatError.MalformedFooter, idOffset + sizeof(int), "trailing bytes");
        }
    }

    /// <summary>Reads world metadata (section 1) after <see cref="ReadSectionTable"/>.</summary>
    /// <remarks>Requires a readable, seekable stream. Consumes every field of the section and leaves the stream at the start of the tile section.</remarks>
    /// <exception cref="ArgumentException">The stream is not readable or seekable.</exception>
    /// <exception cref="WorldFormatException">The metadata is malformed, overruns or underruns its section.</exception>
    public static WorldMetadata ReadMetadata(Stream stream, WorldFileHeader header, WorldSectionTable table)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentNullException.ThrowIfNull(header);
        ArgumentNullException.ThrowIfNull(table);
        ValidateStreamCapabilities(stream);
        ValidateVersion(header.Version);

        // No section-sized buffer: a hostile table can declare almost 2 GiB of metadata.
        var metadata = MetadataSection.Read(new MetadataSectionReader(stream, table.Metadata), table);
        stream.Position = table.Metadata.End;
        return metadata;
    }

    /// <summary>Reads section boundaries and frame-important bits after <see cref="ReadHeader"/>.</summary>
    /// <remarks>Requires a readable, seekable stream positioned at byte 26; leaves it at the start of world metadata without reading payload.</remarks>
    /// <exception cref="ArgumentException">The stream is not readable or seekable, or is not positioned at byte 26.</exception>
    public static WorldSectionTable ReadSectionTable(Stream stream, WorldFileHeader header)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentNullException.ThrowIfNull(header);
        ValidateStreamCapabilities(stream);
        if (stream.Position != HeaderLength)
        {
            throw new ArgumentException("Reading the section table requires a stream positioned at byte 26.", nameof(stream));
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
            var ordered = index switch
            {
                0 => pointer == headerEnd,

                // An empty metadata section passes here; ReadMetadata reports it as MalformedMetadata.
                1 => pointer >= pointers[0],
                _ => pointer > pointers[index - 1],
            };
            if (pointer < headerEnd || pointer > fileLength || !ordered)
            {
                throw new WorldFormatException(
                    WorldFormatError.MalformedSectionTable,
                    HeaderLength + (index * sizeof(int)),
                    pointer > fileLength ? "beyond end of file" : index switch
                    {
                        0 => "section pointer must match the header end",
                        1 => "section pointer is before metadata start",
                        _ => "not greater than previous",
                    });
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

    private static void ValidateStreamCapabilities(Stream stream)
    {
        if (!stream.CanRead || !stream.CanSeek)
        {
            throw new ArgumentException("Reading the world requires a readable, seekable stream.", nameof(stream));
        }
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
