using System.Buffers.Binary;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// A read-only seekable world whose metadata section is padded to a large declared length without backing memory:
/// bytes past the real metadata prefix read as zeros. Counts how many bytes the reader actually consumed.
/// </summary>
internal sealed class VirtualWorldStream : Stream
{
    private const int PointerTableOffset = 26;
    private readonly byte[] prefix;
    private readonly long length;
    private long position;

    private VirtualWorldStream(byte[] prefix, long length)
    {
        this.prefix = prefix;
        this.length = length;
    }

    /// <summary>Total bytes returned by <see cref="Read(byte[], int, int)"/> and its span overload.</summary>
    public long BytesRead { get; private set; }

    /// <summary>
    /// Builds a world whose metadata section is <paramref name="metadataLength"/> bytes long; only
    /// <paramref name="metadata"/> is real, the rest of the section (and every later section) is zero padding.
    /// </summary>
    public static VirtualWorldStream WithMetadataSection(byte[] metadata, int metadataLength)
    {
        var file = SyntheticWorld.Build(metadata, tileLength: 2);
        var shift = metadataLength - metadata.Length;
        for (var index = 1; index < 11; index++)
        {
            var slot = file.AsSpan(PointerTableOffset + (4 * index));
            BinaryPrimitives.WriteInt32LittleEndian(slot, BinaryPrimitives.ReadInt32LittleEndian(slot) + shift);
        }

        var prefix = file.AsSpan(0, SyntheticWorld.MetadataStart + metadata.Length).ToArray();
        return new VirtualWorldStream(prefix, (long)file.Length + shift);
    }

    public override bool CanRead => true;

    public override bool CanSeek => true;

    public override bool CanWrite => false;

    public override long Length => length;

    public override long Position
    {
        get => position;
        set => position = value;
    }

    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

    public override int Read(Span<byte> buffer)
    {
        var count = (int)Math.Min(buffer.Length, Math.Max(0, length - position));
        var target = buffer[..count];
        target.Clear();
        if (position < prefix.Length)
        {
            var real = (int)Math.Min(count, prefix.Length - position);
            prefix.AsSpan((int)position, real).CopyTo(target);
        }

        position += count;
        BytesRead += count;
        return count;
    }

    public override long Seek(long offset, SeekOrigin origin)
    {
        position = origin switch
        {
            SeekOrigin.Begin => offset,
            SeekOrigin.Current => position + offset,
            SeekOrigin.End => length + offset,
            _ => throw new ArgumentOutOfRangeException(nameof(origin)),
        };
        return position;
    }

    public override void Flush()
    {
    }

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
