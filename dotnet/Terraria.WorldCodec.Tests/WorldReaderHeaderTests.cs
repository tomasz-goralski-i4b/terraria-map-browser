using System.Buffers.Binary;
using System.Text;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// File header contract from docs/file-format.md ("File header", "Check order").
/// All inputs are synthetic bytes built here; no game worlds are used.
/// </summary>
public class WorldReaderHeaderTests
{
    private const int HeaderLength = 26;

    // Vector A from docs/file-format.md: header and section table of a synthetic 326 world.
    private static readonly byte[] VectorA = Convert.FromHexString(
        "4601000072656c6f67696302010000000000000000000000" +
        "0b004a000000640000007800" +
        "00007c0000007e0000008200" +
        "0000860000008a0000008e00" +
        "00009a000000b40000000a003802");

    private static byte[] BuildHeader(
        int version = 326,
        string signature = "relogic",
        byte fileType = 2,
        uint revision = 1,
        ulong flags = 0,
        short sectionCount = 11,
        int trailingBytes = 0)
    {
        var bytes = new byte[HeaderLength + trailingBytes];
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(0), version);
        Encoding.ASCII.GetBytes(signature).CopyTo(bytes, 4);
        bytes[11] = fileType;
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(12), revision);
        BinaryPrimitives.WriteUInt64LittleEndian(bytes.AsSpan(16), flags);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(24), sectionCount);
        for (var i = 0; i < trailingBytes; i++)
        {
            bytes[HeaderLength + i] = (byte)(0xA0 + i);
        }

        return bytes;
    }

    private static WorldFormatException ReadExpectingError(byte[] bytes) =>
        Assert.Throws<WorldFormatException>(() => WorldReader.ReadHeader(new MemoryStream(bytes)));

    [Fact]
    public void ReadHeader_ValidHeader_ReturnsAllFields()
    {
        var bytes = BuildHeader(revision: 0xDEADBEEF, flags: 0, trailingBytes: 8);

        var header = WorldReader.ReadHeader(new MemoryStream(bytes));

        Assert.Equal(326, header.Version);
        Assert.Equal("relogic", header.Signature);
        Assert.Equal(WorldFileType.World, header.FileType);
        Assert.Equal(0xDEADBEEFu, header.Revision);
        Assert.Equal(0UL, header.Flags);
        Assert.False(header.IsFavorite);
        Assert.Equal((short)11, header.SectionCount);
    }

    [Fact]
    public void ReadHeader_FavouriteFlag_IsFavoriteTrueAndRawFlagsPreserved()
    {
        const ulong flags = 0x8000_0000_0000_0001UL;
        var header = WorldReader.ReadHeader(new MemoryStream(BuildHeader(flags: flags)));

        Assert.True(header.IsFavorite);
        Assert.Equal(flags, header.Flags);
    }

    [Fact]
    public void ReadHeader_ValidHeader_LeavesStreamAtSectionTable()
    {
        var bytes = BuildHeader(trailingBytes: 16);
        var stream = new MemoryStream(bytes);

        WorldReader.ReadHeader(stream);

        Assert.Equal(HeaderLength, stream.Position);
        Assert.Equal(0xA0, stream.ReadByte());
    }

    [Fact]
    public void ReadHeader_ValidHeader_ReadsNoBytesBeyondHeader()
    {
        var stream = new TrackingStream(BuildHeader(trailingBytes: 64), seekable: false);

        WorldReader.ReadHeader(stream);

        Assert.Equal(HeaderLength, stream.BytesRead);
    }

    [Fact]
    public void ReadHeader_ContractVectorA_ReturnsDocumentedFields()
    {
        var stream = new MemoryStream(VectorA);

        var header = WorldReader.ReadHeader(stream);

        Assert.Equal(new WorldFileHeader(326, "relogic", WorldFileType.World, 1, 0, 11), header);
        Assert.Equal(0x1A, stream.Position);
    }

    [Fact]
    public void SupportedVersions_IsExactlyFormat326()
    {
        Assert.Equal([326], WorldReader.SupportedVersions.Order());
    }

    [Fact]
    public void ReadHeader_FirstAndLastSupportedVersion_Accepted()
    {
        var first = WorldReader.SupportedVersions.Min();
        var last = WorldReader.SupportedVersions.Max();

        Assert.Equal(first, WorldReader.ReadHeader(new MemoryStream(BuildHeader(version: first))).Version);
        Assert.Equal(last, WorldReader.ReadHeader(new MemoryStream(BuildHeader(version: last))).Version);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(38)]
    [InlineData(139)]
    [InlineData(279)]
    [InlineData(315)]
    [InlineData(325)]
    [InlineData(327)]
    [InlineData(int.MaxValue)]
    [InlineData(-1)]
    public void ReadHeader_UnsupportedVersion_ThrowsWithVersionNumberAtOffset0(int version)
    {
        var ex = ReadExpectingError(BuildHeader(version: version));

        Assert.Equal(WorldFormatError.UnsupportedVersion, ex.Error);
        Assert.Equal(0, ex.Offset);
        Assert.Contains(version.ToString(System.Globalization.CultureInfo.InvariantCulture), ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ReadHeader_UnsupportedVersion_ReadsNothingAfterVersion()
    {
        var stream = new TrackingStream(BuildHeader(version: 279, trailingBytes: 64), seekable: false);

        Assert.Throws<WorldFormatException>(() => WorldReader.ReadHeader(stream));

        Assert.True(stream.BytesRead <= 4, $"read {stream.BytesRead} bytes");
    }

    [Fact]
    public void ReadHeader_UnsupportedVersionWithGarbageAfter_ReportsUnsupportedVersion()
    {
        // Contract vector E: the version is checked before the signature.
        var bytes = BuildHeader(version: 327, signature: "garbage", fileType: 9, sectionCount: 3);

        var ex = ReadExpectingError(bytes);

        Assert.Equal(WorldFormatError.UnsupportedVersion, ex.Error);
        Assert.Contains("327", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ReadHeader_LegacyLayoutWithoutSignature_RejectedAsUnsupportedVersion()
    {
        // Versions < 140 have no signature (the pointer table follows the version); M1 does not support them.
        var bytes = new byte[HeaderLength];
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(0), 102);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(4), 10);
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(6), 64);

        var ex = ReadExpectingError(bytes);

        Assert.Equal(WorldFormatError.UnsupportedVersion, ex.Error);
        Assert.Contains("102", ex.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("xindong")]
    [InlineData("Relogic")]
    [InlineData("relogix")]
    [InlineData("\0\0\0\0\0\0\0")]
    public void ReadHeader_InvalidSignature_ThrowsNotAWorldAtOffset4(string signature)
    {
        var ex = ReadExpectingError(BuildHeader(signature: signature));

        Assert.Equal(WorldFormatError.NotAWorld, ex.Error);
        Assert.Equal(4, ex.Offset);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(3)]
    [InlineData(255)]
    public void ReadHeader_FileTypeNotWorld_ThrowsNotAWorldAtOffset11(byte fileType)
    {
        var ex = ReadExpectingError(BuildHeader(fileType: fileType));

        Assert.Equal(WorldFormatError.NotAWorld, ex.Error);
        Assert.Equal(11, ex.Offset);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(10)]
    [InlineData(12)]
    [InlineData(-1)]
    public void ReadHeader_SectionCountNot11_ThrowsMalformedSectionTableAtOffset24(short sectionCount)
    {
        var ex = ReadExpectingError(BuildHeader(sectionCount: sectionCount));

        Assert.Equal(WorldFormatError.MalformedSectionTable, ex.Error);
        Assert.Equal(24, ex.Offset);
    }

    public static TheoryData<int> TruncatedLengths()
    {
        var data = new TheoryData<int>();
        for (var length = 0; length < HeaderLength; length++)
        {
            data.Add(length);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(TruncatedLengths))]
    public void ReadHeader_TruncatedInAnyField_ThrowsTruncatedAtEndOfData(int length)
    {
        var bytes = BuildHeader().AsSpan(0, length).ToArray();

        var ex = ReadExpectingError(bytes);

        Assert.Equal(WorldFormatError.Truncated, ex.Error);
        Assert.Equal(length, ex.Offset);
    }

    [Theory]
    [MemberData(nameof(TruncatedLengths))]
    public void ReadHeader_TruncatedNonSeekableStream_ThrowsTruncated(int length)
    {
        var stream = new TrackingStream(BuildHeader().AsSpan(0, length).ToArray(), seekable: false);

        var ex = Assert.Throws<WorldFormatException>(() => WorldReader.ReadHeader(stream));

        Assert.Equal(WorldFormatError.Truncated, ex.Error);
        Assert.Equal(length, ex.Offset);
    }

    [Fact]
    public void ReadHeader_TruncatedWithGarbageSignature_ReportsTruncatedNotNotAWorld()
    {
        // Check order: "fewer than 26 bytes" (step 3) comes before the signature check (step 4).
        var bytes = BuildHeader(signature: "garbage").AsSpan(0, 20).ToArray();

        var ex = ReadExpectingError(bytes);

        Assert.Equal(WorldFormatError.Truncated, ex.Error);
    }

    [Fact]
    public void ReadHeader_NonSeekableStream_ReturnsHeader()
    {
        var stream = new TrackingStream(BuildHeader(trailingBytes: 4), seekable: false);

        var header = WorldReader.ReadHeader(stream);

        Assert.Equal(326, header.Version);
    }

    [Fact]
    public void ReadHeader_StreamNotAtStart_OffsetsRelativeToStartPosition()
    {
        var prefix = new byte[] { 0xFF, 0xFF, 0xFF };
        var bytes = prefix.Concat(BuildHeader(fileType: 3)).ToArray();
        var stream = new MemoryStream(bytes) { Position = prefix.Length };

        var ex = Assert.Throws<WorldFormatException>(() => WorldReader.ReadHeader(stream));

        Assert.Equal(WorldFormatError.NotAWorld, ex.Error);
        Assert.Equal(11, ex.Offset);
    }

    [Fact]
    public void ReadHeader_NullStream_ThrowsArgumentNullException()
    {
        Assert.Throws<ArgumentNullException>(() => WorldReader.ReadHeader(null!));
    }

    /// <summary>Stream over a byte array that counts consumed bytes and can hide its seekability.</summary>
    private sealed class TrackingStream(byte[] data, bool seekable) : Stream
    {
        private readonly MemoryStream _inner = new(data);

        public long BytesRead { get; private set; }

        public override bool CanRead => true;

        public override bool CanSeek => seekable;

        public override bool CanWrite => false;

        public override long Length => seekable ? _inner.Length : throw new NotSupportedException();

        public override long Position
        {
            get => seekable ? _inner.Position : throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

        public override int Read(Span<byte> buffer)
        {
            // Hand out at most 3 bytes per call to exercise short reads.
            var read = _inner.Read(buffer[..Math.Min(buffer.Length, 3)]);
            BytesRead += read;
            return read;
        }

        public override void Flush()
        {
        }

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
