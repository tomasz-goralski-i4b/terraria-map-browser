namespace Terraria.WorldCodec;

/// <summary>The fixed part of a <c>.wld</c> file header, up to the section table (docs/file-format.md).</summary>
/// <param name="Version">Format version (not the game version).</param>
/// <param name="Signature">ASCII signature; <c>relogic</c> for every M1-supported version.</param>
/// <param name="FileType">File type; always <see cref="WorldFileType.World"/> for a successfully read header.</param>
/// <param name="Revision">Save counter.</param>
/// <param name="Flags">Raw header flags, kept as read. Bit 0 = favourite.</param>
/// <param name="SectionCount">Number of section pointers that follow the header.</param>
public sealed record WorldFileHeader(
    int Version,
    string Signature,
    WorldFileType FileType,
    uint Revision,
    ulong Flags,
    short SectionCount)
{
    /// <summary>Bit 0 of <see cref="Flags"/>.</summary>
    public bool IsFavorite => (Flags & 1UL) != 0;
}
