namespace Terraria.WorldCodec;

/// <summary>
/// Writes a format 326 world read by <see cref="WorldReader.ReadForSave"/> (docs/file-format/writer.md, "Layout
/// produced"): preserved envelope bytes, re-encoded tiles and regenerated section pointers.
/// </summary>
public static class WorldWriter
{
    /// <summary>Writes <paramref name="envelope"/> as one complete world file.</summary>
    /// <remarks>Nothing is written to <paramref name="output"/> unless the whole file could be built.</remarks>
    /// <exception cref="WorldWriteException">The envelope is unsupported, contradicts itself or the file would reach 2 GiB.</exception>
    /// <exception cref="WorldFormatException">The envelope footer is inconsistent with its metadata.</exception>
    /// <exception cref="TileEncodingException">A tile cannot be encoded.</exception>
    public static void Write(WorldEnvelope envelope, Stream output) => throw new NotImplementedException();

    /// <summary>
    /// The 11 section pointers for the given section output lengths (W-S2): <c>pointer[0]</c> is the header length and
    /// every following pointer adds the length of the section before it.
    /// </summary>
    /// <param name="headerLength">Length of the file header, including the frame-important bits.</param>
    /// <param name="metadataLength">Length of the metadata section.</param>
    /// <param name="tileLength">Length of the re-encoded tile section.</param>
    /// <param name="opaqueLengths">Lengths of sections 3–10, eight entries.</param>
    /// <param name="footerLength">Length of the footer.</param>
    /// <exception cref="WorldWriteException">The file would reach 2<sup>31</sup> bytes (<c>file too large</c>).</exception>
    internal static int[] ComputePointers(
        long headerLength,
        long metadataLength,
        long tileLength,
        IReadOnlyList<long> opaqueLengths,
        long footerLength) => throw new NotImplementedException();
}
