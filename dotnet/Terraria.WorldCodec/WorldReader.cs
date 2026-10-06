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
        throw new NotImplementedException();
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
