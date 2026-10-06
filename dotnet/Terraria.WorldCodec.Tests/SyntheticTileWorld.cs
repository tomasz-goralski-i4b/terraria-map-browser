using System.Buffers.Binary;
using System.Text;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// Builds a complete format-326 world around hand-written tile-section bytes (docs/file-format.md, "Tile data").
/// Unless overridden: <c>k = 754</c> with only ids 4 and 5 frame-important (1, 255 and 256 are not), as the vectors
/// of docs/file-format.md assume.
/// </summary>
internal static class SyntheticTileWorld
{
    public const short DefaultFrameCount = 754;

    public static readonly int[] DefaultFrameImportant = [4, 5];

    /// <summary>The world file and the absolute offset of the tile section.</summary>
    /// <param name="width">Width in tiles (metadata).</param>
    /// <param name="height">Height in tiles (metadata).</param>
    /// <param name="tiles">Bytes placed at the start of the tile section.</param>
    /// <param name="tileSectionLength">
    /// Declared tile-section length; when shorter than <paramref name="tiles"/>, the remaining bytes spill into the
    /// next section, so a reader that ignores <c>pointer[2]</c> would still find them.
    /// </param>
    /// <param name="frameCount">Frame-important count <c>k</c> in the header.</param>
    /// <param name="frameImportant">Frame-important tile ids, each <c>&lt; k</c>.</param>
    /// <param name="metadataSource">
    /// Metadata to write instead of the defaults; its <c>Width</c>/<c>Height</c> win over
    /// <paramref name="width"/>/<paramref name="height"/>.
    /// </param>
    public static (byte[] File, int TileStart) Build(
        int width,
        int height,
        byte[] tiles,
        int? tileSectionLength = null,
        short frameCount = DefaultFrameCount,
        IReadOnlyCollection<int>? frameImportant = null,
        SyntheticMetadata? metadataSource = null)
    {
        const int OtherSectionLength = 2;
        const int FooterLength = 6;
        var metadata = (metadataSource ?? new SyntheticMetadata { Width = width, Height = height }).Build().Bytes;
        var packedBits = new byte[(frameCount + 7) / 8];
        foreach (var id in frameImportant ?? DefaultFrameImportant)
        {
            packedBits[id / 8] |= (byte)(1 << (id % 8));
        }

        var headerEnd = 72 + packedBits.Length;
        var sectionLength = tileSectionLength ?? tiles.Length;
        var pointers = new int[11];
        pointers[0] = headerEnd;
        pointers[1] = pointers[0] + metadata.Length;
        pointers[2] = pointers[1] + sectionLength;
        pointers[3] = pointers[1] + Math.Max(sectionLength, tiles.Length) + OtherSectionLength;
        for (var index = 4; index < pointers.Length; index++)
        {
            pointers[index] = pointers[index - 1] + OtherSectionLength;
        }

        var bytes = new byte[pointers[^1] + FooterLength];

        // Later sections and the footer: bytes that would decode as anything but padding.
        bytes.AsSpan(pointers[1]).Fill(0xA5);
        BinaryPrimitives.WriteInt32LittleEndian(bytes, 326);
        Encoding.ASCII.GetBytes("relogic").CopyTo(bytes, 4);
        bytes[11] = 2;
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(12), 1);
        BinaryPrimitives.WriteUInt64LittleEndian(bytes.AsSpan(16), 0);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(24), 11);
        for (var index = 0; index < pointers.Length; index++)
        {
            BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(26 + (4 * index)), pointers[index]);
        }

        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(70), frameCount);
        packedBits.CopyTo(bytes, 72);
        metadata.CopyTo(bytes, headerEnd);
        tiles.CopyTo(bytes, pointers[1]);
        return (bytes, pointers[1]);
    }

    public static World Read(byte[] file)
    {
        using var stream = new MemoryStream(file);
        return WorldReader.Read(stream);
    }

    /// <summary>Reads a 1 × 1 world whose tile section is exactly <paramref name="record"/>.</summary>
    public static Tile ReadSingle(byte[] record, short frameCount = DefaultFrameCount, IReadOnlyCollection<int>? frameImportant = null)
    {
        var world = Read(Build(1, 1, record, frameCount: frameCount, frameImportant: frameImportant).File);
        return world.Tiles[0, 0];
    }
}
