using System.Buffers.Binary;
using System.Text;

namespace Terraria.WorldCodec;

/// <summary>
/// Cursor over the bytes of the metadata section (docs/file-format.md, "Primitive types").
/// Every read is bounded by the section end; errors carry the absolute offset of the field start.
/// </summary>
internal sealed class MetadataSectionReader(byte[] section, long sectionStart)
{
    private const string SectionName = "Metadata";
    private const int MaxLengthPrefixBytes = 5;

    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    private int position;

    public int Remaining => section.Length - position;

    public long AbsolutePosition => sectionStart + position;

    public static WorldFormatException Error(long offset, string reason, string? field = null) =>
        new(WorldFormatError.MalformedMetadata, offset, reason, SectionName, field);

    public void Skip(int length, string? field = null) => Take(length, field);

    public void Int32s(int count) => Skip(count * sizeof(int));

    public byte UInt8(string? field = null) => Take(sizeof(byte), field)[0];

    public short Int16(string? field = null) => BinaryPrimitives.ReadInt16LittleEndian(Take(sizeof(short), field));

    public int Int32(string? field = null) => BinaryPrimitives.ReadInt32LittleEndian(Take(sizeof(int), field));

    public ReadOnlySpan<byte> Bytes(int length, string? field = null) => Take(length, field);

    /// <summary>Strict Bool: only <c>00</c> and <c>01</c> are accepted.</summary>
    public bool Bool(string? field = null)
    {
        var start = AbsolutePosition;
        return UInt8(field) switch
        {
            0 => false,
            1 => true,
            _ => throw Error(start, "invalid boolean", field),
        };
    }

    public void Bools(int count)
    {
        for (var index = 0; index < count; index++)
        {
            Bool();
        }
    }

    /// <summary>LEB128 length prefix followed by strict UTF-8.</summary>
    public string String(string? field = null)
    {
        var start = AbsolutePosition;
        uint length = 0;
        for (var index = 0; ; index++)
        {
            if (index == MaxLengthPrefixBytes)
            {
                throw Error(start, "string length prefix longer than 5 bytes", field);
            }

            if (Remaining == 0)
            {
                throw Error(start, "overruns section", field);
            }

            var current = section[position++];
            if (index == MaxLengthPrefixBytes - 1 && (current & 0x80) == 0 && current > 0x0F)
            {
                throw Error(start, "string length prefix exceeds 32 bits", field);
            }

            length |= (uint)(current & 0x7F) << (7 * index);
            if ((current & 0x80) == 0)
            {
                break;
            }
        }

        if (length > int.MaxValue || length > Remaining)
        {
            throw Error(start, "string length overruns section", field);
        }

        try
        {
            return StrictUtf8.GetString(Take((int)length, field));
        }
        catch (DecoderFallbackException)
        {
            throw Error(start, "invalid UTF-8", field);
        }
    }

    /// <summary>
    /// Reads a list count of <paramref name="countSize"/> bytes and checks, before the list is read, that it is
    /// non-negative and that <paramref name="minElementSize"/>-byte elements fit in the section.
    /// </summary>
    public int Count(int countSize, int minElementSize, string field)
    {
        var countStart = AbsolutePosition;
        long count = countSize switch
        {
            sizeof(byte) => UInt8(field),
            sizeof(short) => Int16(field),
            _ => Int32(field),
        };
        if (count < 0 || count * minElementSize > Remaining)
        {
            throw Error(countStart, "list count is negative or does not fit in the section", field);
        }

        return (int)count;
    }

    private ReadOnlySpan<byte> Take(int length, string? field)
    {
        if (length > Remaining)
        {
            throw Error(AbsolutePosition, "overruns section", field);
        }

        var span = section.AsSpan(position, length);
        position += length;
        return span;
    }
}
