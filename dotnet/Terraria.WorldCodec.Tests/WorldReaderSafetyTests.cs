using System.Buffers.Binary;
using System.Text;

namespace Terraria.WorldCodec.Tests;

/// <summary>Issue #35: reject unsafe inputs before reading string payloads or allocating their buffers.</summary>
public sealed class WorldReaderSafetyTests
{
    [Theory]
    [InlineData(25)]
    [InlineData(27)]
    public void ReadSectionTable_InvalidPosition_ThrowsWithoutConsumingBytes(int position)
    {
        var file = SyntheticWorld.Build(new SyntheticMetadata { Name = "SCCR1" }.Build().Bytes, 2);
        using var stream = new RecordingStream(file);
        var header = WorldReader.ReadHeader(stream);
        stream.Position = position;
        var bytesBefore = stream.BytesRead;

        var error = Assert.Throws<ArgumentException>(() => WorldReader.ReadSectionTable(stream, header));

        Assert.Equal("stream", error.ParamName);
        Assert.Equal(bytesBefore, stream.BytesRead);
        Assert.Equal(position, stream.Position);
    }

    [Theory]
    [InlineData("ReadSectionTable", false, true)]
    [InlineData("ReadMetadata", false, true)]
    [InlineData("ReadMetadata", true, false)]
    [InlineData("Read", false, true)]
    [InlineData("Read", true, false)]
    public void Read_UnsupportedStreamCapabilities_ThrowsBeforeReadingOrSeeking(string method, bool readable, bool seekable)
    {
        var file = SyntheticWorld.Build(new SyntheticMetadata { Name = "SCCR1" }.Build().Bytes, 2);
        using var setup = new MemoryStream(file);
        var header = WorldReader.ReadHeader(setup);
        var table = WorldReader.ReadSectionTable(setup, header);
        using var stream = new RecordingStream(file, readable, seekable);
        if (seekable)
        {
            stream.Position = method == "ReadSectionTable" ? 26 : table.Metadata.Start;
        }

        var seeksBefore = stream.SeekAttempts;
        var error = Assert.Throws<ArgumentException>(() =>
        {
            switch (method)
            {
                case "ReadSectionTable":
                    WorldReader.ReadSectionTable(stream, header);
                    break;
                case "ReadMetadata":
                    WorldReader.ReadMetadata(stream, header, table);
                    break;
                case "Read":
                    WorldReader.Read(stream);
                    break;
                default:
                    throw new ArgumentOutOfRangeException(nameof(method));
            }
        });

        Assert.Equal("stream", error.ParamName);
        Assert.Equal(0, stream.ReadAttempts);
        Assert.Equal(seeksBefore, stream.SeekAttempts);
    }

    public static TheoryData<string, int> StringCaps() => new()
    {
        { "name", 4096 },
        { "seed", 4096 },
        { "anglerFinishers", 1048576 },
        { "worldGenManifest", 1048576 },
    };

    [Theory]
    [MemberData(nameof(StringCaps))]
    public void ReadMetadata_StringAtUtf8Cap_AcceptsAndStopsAtTiles(string field, int cap)
    {
        var value = SizedValue(field, cap);
        Assert.Equal(cap, Encoding.UTF8.GetByteCount(value));
        Assert.True(value.Length < cap);
        var (file, _, _) = WithString(field, Encode(value));
        using var stream = new RecordingStream(file);
        var header = WorldReader.ReadHeader(stream);
        var table = WorldReader.ReadSectionTable(stream, header);

        var metadata = WorldReader.ReadMetadata(stream, header, table);

        Assert.Equal(table.Tiles.Start, stream.Position);
        Assert.Equal(field == "name" ? value : "SCCR1", metadata.Name);
        Assert.Equal(field == "seed" ? value : "948580918", metadata.Seed);
    }

    [Theory]
    [MemberData(nameof(StringCaps))]
    public void ReadMetadata_StringOneByteOverUtf8Cap_RejectsAtPrefixBeforePayload(string field, int cap)
    {
        var value = SizedValue(field, cap + 1);
        Assert.Equal(cap + 1, Encoding.UTF8.GetByteCount(value));
        // The character count is below the byte cap: counting UTF-16 characters would accept this input.
        Assert.True(value.Length < cap);
        var (file, prefixOffset, payloadOffset) = WithString(field, Encode(value));
        using var stream = new RecordingStream(file) { PayloadStart = payloadOffset, PayloadEnd = payloadOffset + cap + 1 };
        var header = WorldReader.ReadHeader(stream);
        var table = WorldReader.ReadSectionTable(stream, header);

        var before = GC.GetAllocatedBytesForCurrentThread();
        var error = Assert.Throws<WorldFormatException>(() => WorldReader.ReadMetadata(stream, header, table));
        var allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        AssertMetadataError(error, prefixOffset, field);
        Assert.Equal(0, stream.PayloadBytesRead);
        Assert.InRange(allocated, 0, 64 << 10);
    }

    public static TheoryData<string, string> InvalidPrefixes()
    {
        var cases = new TheoryData<string, string>();
        foreach (var field in new[] { "name", "seed", "anglerFinishers", "worldGenManifest" })
        {
            foreach (var prefix in new[] { "8080808080", "ffffffff10", "ffffffff0f", "8080808008" })
            {
                cases.Add(field, prefix);
            }
        }

        return cases;
    }

    [Theory]
    [MemberData(nameof(InvalidPrefixes))]
    public void ReadMetadata_InvalidFiveBytePrefix_RejectsBeforePayload(string field, string prefixHex)
    {
        var prefix = Convert.FromHexString(prefixHex);
        var payload = Encoding.UTF8.GetBytes("SCCR1 generation passes");
        var (file, prefixOffset, _) = WithString(field, [.. prefix, .. payload]);
        var payloadOffset = prefixOffset + prefix.Length;
        using var stream = new RecordingStream(file) { PayloadStart = payloadOffset, PayloadEnd = payloadOffset + payload.Length };
        var header = WorldReader.ReadHeader(stream);
        var table = WorldReader.ReadSectionTable(stream, header);

        var before = GC.GetAllocatedBytesForCurrentThread();
        var error = Assert.Throws<WorldFormatException>(() => WorldReader.ReadMetadata(stream, header, table));
        var allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        AssertMetadataError(error, prefixOffset, field);
        Assert.Equal(0, stream.PayloadBytesRead);
        Assert.InRange(allocated, 0, 64 << 10);
    }

    [Theory]
    [MemberData(nameof(StringCaps))]
    public void ReadMetadata_StringCrossingMetadataEnd_RejectsAtPrefixBeforePayload(string field, int cap)
    {
        Assert.True(cap >= 5);
        var (complete, prefixOffset, _) = WithString(field, [5, (byte)'S', (byte)'C']);
        var cut = complete.AsSpan(SyntheticWorld.MetadataStart, prefixOffset - SyntheticWorld.MetadataStart + 3).ToArray();
        var file = SyntheticWorld.Build(cut, 64);
        using var stream = new RecordingStream(file) { PayloadStart = prefixOffset + 1, PayloadEnd = file.Length };
        var header = WorldReader.ReadHeader(stream);
        var table = WorldReader.ReadSectionTable(stream, header);
        Assert.Equal(prefixOffset + 3, table.Metadata.End);

        var error = Assert.Throws<WorldFormatException>(() => WorldReader.ReadMetadata(stream, header, table));

        AssertMetadataError(error, prefixOffset, field);
        Assert.Equal(0, stream.PayloadBytesRead);
    }

    [Fact]
    public void ReadMetadata_EmptySection_RejectsNameWithoutReadingTiles()
    {
        var file = SyntheticWorld.Build([], 64);
        using var stream = new RecordingStream(file) { PayloadStart = SyntheticWorld.MetadataStart, PayloadEnd = file.Length };
        var header = WorldReader.ReadHeader(stream);
        var table = WorldReader.ReadSectionTable(stream, header);
        Assert.Equal(table.Metadata.Start, table.Metadata.End);

        var error = Assert.Throws<WorldFormatException>(() => WorldReader.ReadMetadata(stream, header, table));

        AssertMetadataError(error, SyntheticWorld.MetadataStart, "name");
        Assert.Equal(0, stream.PayloadBytesRead);
    }

    [Theory]
    [InlineData(1, int.MaxValue, "beyond end of file")]
    [InlineData(10, int.MaxValue, "beyond end of file")]
    [InlineData(3, -1, "not greater than previous")]
    [InlineData(3, 0, "not greater than previous")]
    public void ReadSectionTable_InvalidPointer_DistinguishesBoundsFromOrdering(int index, int displacement, string reason)
    {
        var file = SyntheticWorld.Build(new SyntheticMetadata { Name = "SCCR1" }.Build().Bytes, 2);
        var previous = BinaryPrimitives.ReadInt32LittleEndian(file.AsSpan(26 + ((index - 1) * 4)));
        var pointer = displacement == int.MaxValue ? int.MaxValue : previous + displacement;
        BinaryPrimitives.WriteInt32LittleEndian(file.AsSpan(26 + (index * 4)), pointer);
        using var stream = new RecordingStream(file);
        var header = WorldReader.ReadHeader(stream);

        var error = Assert.Throws<WorldFormatException>(() => WorldReader.ReadSectionTable(stream, header));

        Assert.Equal(WorldFormatError.MalformedSectionTable, error.Error);
        Assert.Equal(26 + (index * 4), error.Offset);
        Assert.Equal(reason, error.Reason);
        Assert.Equal(SyntheticWorld.MetadataStart, stream.BytesRead);
        Assert.Equal(0, stream.SeekAttempts);
    }

    [Theory]
    [InlineData(0, 1, "section pointer must match the header end")]
    [InlineData(1, -1, "section pointer is before metadata start")]
    public void ReadSectionTable_InvalidLeadingPointer_ReportsItsOwnReason(int index, int displacement, string reason)
    {
        var file = SyntheticWorld.Build(new SyntheticMetadata { Name = "SCCR1" }.Build().Bytes, 2);
        var headerEnd = BinaryPrimitives.ReadInt32LittleEndian(file.AsSpan(26));
        BinaryPrimitives.WriteInt32LittleEndian(file.AsSpan(26 + (index * 4)), headerEnd + displacement);
        using var stream = new RecordingStream(file);
        var header = WorldReader.ReadHeader(stream);

        var error = Assert.Throws<WorldFormatException>(() => WorldReader.ReadSectionTable(stream, header));

        Assert.Equal(WorldFormatError.MalformedSectionTable, error.Error);
        Assert.Equal(26 + (index * 4), error.Offset);
        Assert.Equal(reason, error.Reason);
    }

    private static void AssertMetadataError(WorldFormatException error, long offset, string field)
    {
        Assert.Equal(WorldFormatError.MalformedMetadata, error.Error);
        Assert.Equal("Metadata", error.Section);
        Assert.Equal(field, error.Field);
        Assert.Equal(offset, error.Offset);
    }

    private static string SizedValue(string field, int byteLength)
    {
        var segment = field switch
        {
            "name" => "Świat Corruption 🌍 ",
            "seed" => "not the bees 🌍 ",
            "anglerFinishers" => "Angler Świat 🌍 ",
            "worldGenManifest" => "{\"passes\":[\"Świat 🌍\"]}",
            _ => throw new ArgumentOutOfRangeException(nameof(field)),
        };
        var segmentBytes = Encoding.UTF8.GetByteCount(segment);
        return string.Concat(Enumerable.Repeat(segment, byteLength / segmentBytes)) + new string(' ', byteLength % segmentBytes);
    }

    private static byte[] Encode(string value)
    {
        using var stream = new MemoryStream();
        using var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true);
        writer.Write(value);
        writer.Flush();
        return stream.ToArray();
    }

    private static (byte[] File, int PrefixOffset, int PayloadOffset) WithString(string field, byte[] encoded)
    {
        var (bytes, offsets) = new SyntheticMetadata { Name = "SCCR1", AnglerFinishers = ["Marina"] }.Build();
        var offset = offsets[field] + (field == "anglerFinishers" ? sizeof(int) : 0);
        using var stream = new MemoryStream(bytes);
        stream.Position = offset;
        using var reader = new BinaryReader(stream, Encoding.UTF8, leaveOpen: true);
        reader.ReadString();
        var end = (int)stream.Position;
        byte[] replaced = [.. bytes.AsSpan(0, offset), .. encoded, .. bytes.AsSpan(end)];
        var prefixLength = 0;
        while (prefixLength < encoded.Length && (encoded[prefixLength++] & 0x80) != 0)
        {
        }

        var absoluteOffset = SyntheticWorld.MetadataStart + offset;
        return (SyntheticWorld.Build(replaced, 2), absoluteOffset, absoluteOffset + prefixLength);
    }

    /// <summary>Records actual payload reads, including read-ahead, and attempts to use unsupported capabilities.</summary>
    private sealed class RecordingStream(byte[] bytes, bool readable = true, bool seekable = true) : Stream
    {
        private readonly MemoryStream inner = new(bytes);

        public long BytesRead { get; private set; }

        public long PayloadBytesRead { get; private set; }

        public int ReadAttempts { get; private set; }

        public int SeekAttempts { get; private set; }

        public long PayloadStart { get; init; } = long.MaxValue;

        public long PayloadEnd { get; init; } = long.MaxValue;

        public override bool CanRead => readable;

        public override bool CanSeek => seekable;

        public override bool CanWrite => false;

        public override long Length => seekable ? inner.Length : throw new NotSupportedException();

        public override long Position
        {
            get => seekable ? inner.Position : throw new NotSupportedException();
            set
            {
                SeekAttempts++;
                if (!seekable)
                {
                    throw new NotSupportedException();
                }

                inner.Position = value;
            }
        }

        public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

        public override int Read(Span<byte> buffer)
        {
            ReadAttempts++;
            if (!readable)
            {
                throw new NotSupportedException();
            }

            var start = inner.Position;
            var count = inner.Read(buffer);
            BytesRead += count;
            PayloadBytesRead += Math.Max(0, Math.Min(start + count, PayloadEnd) - Math.Max(start, PayloadStart));
            return count;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            SeekAttempts++;
            return seekable ? inner.Seek(offset, origin) : throw new NotSupportedException();
        }

        public override void Flush()
        {
        }

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                inner.Dispose();
            }

            base.Dispose(disposing);
        }
    }
}
