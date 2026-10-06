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

        if (!SupportedVersions.Contains(header.Version))
        {
            throw new WorldFormatException(
                WorldFormatError.UnsupportedVersion,
                0,
                string.Create(CultureInfo.InvariantCulture, $"format version {header.Version} is not supported"));
        }

        if (header.SectionCount != ExpectedSectionCount)
        {
            throw new WorldFormatException(
                WorldFormatError.MalformedSectionTable,
                SectionCountOffset,
                string.Create(CultureInfo.InvariantCulture, $"expected {ExpectedSectionCount} sections, found {header.SectionCount}"));
        }

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
                (index == 0 ? pointer != headerEnd : pointer <= pointers[index - 1]))
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
        if (!SupportedVersions.Contains(version))
        {
            throw new WorldFormatException(
                WorldFormatError.UnsupportedVersion,
                0,
                string.Create(CultureInfo.InvariantCulture, $"format version {version} is not supported"));
        }

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
        if (sectionCount != ExpectedSectionCount)
        {
            throw new WorldFormatException(
                WorldFormatError.MalformedSectionTable,
                SectionCountOffset,
                string.Create(CultureInfo.InvariantCulture, $"expected {ExpectedSectionCount} sections, found {sectionCount}"));
        }

        return new WorldFileHeader(
            version,
            signature,
            fileType,
            BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(RevisionOffset)),
            BinaryPrimitives.ReadUInt64LittleEndian(bytes.AsSpan(FlagsOffset)),
            sectionCount);
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
