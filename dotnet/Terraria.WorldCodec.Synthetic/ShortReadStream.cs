namespace Terraria.WorldCodec.Synthetic;

/// <summary>
/// A read-only seekable stream over a byte array. With <c>shortReads</c>, every read returns at most 1–7 bytes
/// (cycling), as a network or pipe-backed stream may. Records the highest file offset any read returned.
/// </summary>
public sealed class ShortReadStream(byte[] bytes, bool shortReads) : Stream
{
    /// <summary>One past the highest file offset returned by any read; 0 before the first read.</summary>
    public long HighestReadEnd => throw new NotImplementedException();

    public override bool CanRead => true;

    public override bool CanSeek => true;

    public override bool CanWrite => false;

    public override long Length => bytes.Length;

    public override long Position
    {
        get => throw new NotImplementedException();
        set => throw new NotImplementedException();
    }

    public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));

    public override int Read(Span<byte> buffer) => throw new NotImplementedException($"short reads: {shortReads}");

    public override long Seek(long offset, SeekOrigin origin) => throw new NotImplementedException();

    public override void Flush()
    {
    }

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
