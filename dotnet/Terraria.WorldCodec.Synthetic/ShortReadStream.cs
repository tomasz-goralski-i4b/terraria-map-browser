namespace Terraria.WorldCodec.Synthetic;

/// <summary>
/// A read-only seekable stream over a byte array. With <c>shortReads</c>, every read returns at most 1–7 bytes
/// (cycling), as a network or pipe-backed stream may. Records the highest file offset any read returned.
/// </summary>
public sealed class ShortReadStream(byte[] bytes, bool shortReads) : Stream
{
    private const int MaxChunk = 7;
    private long position;
    private int nextChunk = 1;

    /// <summary>One past the highest file offset returned by any read; 0 before the first read.</summary>
    public long HighestReadEnd { get; private set; }

    public override bool CanRead => true;

    public override bool CanSeek => true;

    public override bool CanWrite => false;

    public override long Length => bytes.Length;

    public override long Position
    {
        get => position;
        set => position = value;
    }

    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

    public override int Read(Span<byte> buffer)
    {
        var count = (int)Math.Min(buffer.Length, Math.Max(0, bytes.Length - position));
        if (shortReads && buffer.Length > 0)
        {
            count = Math.Min(count, nextChunk);
            nextChunk = (nextChunk % MaxChunk) + 1;
        }

        bytes.AsSpan((int)position, count).CopyTo(buffer);
        position += count;
        HighestReadEnd = Math.Max(HighestReadEnd, position);
        return count;
    }

    public override long Seek(long offset, SeekOrigin origin)
    {
        position = origin switch
        {
            SeekOrigin.Begin => offset,
            SeekOrigin.Current => position + offset,
            SeekOrigin.End => bytes.Length + offset,
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
