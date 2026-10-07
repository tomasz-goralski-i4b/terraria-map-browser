using System.Buffers.Binary;
using System.Text;

namespace Terraria.WorldCodec;

/// <summary>
/// Writes a format 326 world read by <see cref="WorldReader.ReadForSave"/> (docs/file-format/writer.md, "Layout
/// produced"): preserved envelope bytes, re-encoded tiles and regenerated section pointers.
/// </summary>
public static class WorldWriter
{
    private const string Signature = "relogic";
    private const int SignatureOffset = 4;
    private const int FileTypeOffset = 11;
    private const int RevisionOffset = 12;
    private const int FlagsOffset = 16;
    private const int SectionCountOffset = 24;
    private const int PointerTableOffset = 26;
    private const int FrameCountOffset = PointerTableOffset + (SectionCount * sizeof(int));
    private const short SectionCount = 11;

    private static readonly string[] OpaqueSectionNames =
    [
        nameof(WorldSectionTable.Chests),
        nameof(WorldSectionTable.Signs),
        nameof(WorldSectionTable.NpcsAndMobs),
        nameof(WorldSectionTable.TileEntities),
        nameof(WorldSectionTable.WeightedPressurePlates),
        nameof(WorldSectionTable.TownManager),
        nameof(WorldSectionTable.Bestiary),
        nameof(WorldSectionTable.CreativePowers),
    ];

    /// <summary>Writes <paramref name="envelope"/> as one complete world file.</summary>
    /// <remarks>Nothing is written to <paramref name="output"/> unless the whole file could be built.</remarks>
    /// <exception cref="WorldWriteException">The envelope is unsupported, contradicts itself or the file would reach 2 GiB.</exception>
    /// <exception cref="WorldFormatException">The envelope footer is inconsistent with its metadata.</exception>
    /// <exception cref="TileEncodingException">A tile cannot be encoded.</exception>
    public static void Write(WorldEnvelope envelope, Stream output)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        ArgumentNullException.ThrowIfNull(output);

        var header = envelope.World.Header;
        ValidateEnvelope(envelope);
        WorldReader.ValidateFooter(envelope.FooterBytes.Span, envelope.Table.Footer.Start, envelope.World.Metadata);

        var tiles = TileSectionWriter.Write(envelope.World.Tiles, envelope.Table.FrameImportant);
        var pointers = ComputePointers(
            envelope.FileHeaderBytes.Length,
            envelope.MetadataBytes.Length,
            tiles.Length,
            envelope.OpaqueSections.Select(section => (long)section.Bytes.Length).ToArray(),
            envelope.FooterBytes.Length);

        var fileHeader = envelope.FileHeaderBytes.ToArray();
        BinaryPrimitives.WriteInt32LittleEndian(fileHeader, header.Version);
        Encoding.ASCII.GetBytes(Signature).CopyTo(fileHeader, SignatureOffset);
        fileHeader[FileTypeOffset] = (byte)WorldFileType.World;
        BinaryPrimitives.WriteUInt32LittleEndian(fileHeader.AsSpan(RevisionOffset), header.Revision);
        BinaryPrimitives.WriteUInt64LittleEndian(fileHeader.AsSpan(FlagsOffset), header.Flags);
        BinaryPrimitives.WriteInt16LittleEndian(fileHeader.AsSpan(SectionCountOffset), SectionCount);
        for (var index = 0; index < pointers.Length; index++)
        {
            BinaryPrimitives.WriteInt32LittleEndian(fileHeader.AsSpan(PointerTableOffset + (index * sizeof(int))), pointers[index]);
        }

        // Built completely in memory (the bound is 2 GiB, W-S3) so a failure never leaves a partial file in the stream.
        using var file = new MemoryStream(pointers[^1] + envelope.FooterBytes.Length);
        file.Write(fileHeader);
        file.Write(envelope.MetadataBytes.Span);
        file.Write(tiles);
        foreach (var section in envelope.OpaqueSections)
        {
            file.Write(section.Bytes.Span);
        }

        file.Write(envelope.FooterBytes.Span);
        output.Write(file.GetBuffer().AsSpan(0, (int)file.Length));
    }

    private static void ValidateEnvelope(WorldEnvelope envelope)
    {
        var header = envelope.World.Header;
        var table = envelope.Table;
        var bytes = envelope.FileHeaderBytes.Span;
        if (!WorldReader.SupportedVersions.Contains(header.Version))
        {
            throw new WorldWriteException($"format version {header.Version} is not supported");
        }

        if (bytes.Length < FrameCountOffset + sizeof(short)
            || BinaryPrimitives.ReadInt32LittleEndian(bytes) != header.Version)
        {
            throw new WorldWriteException("file header bytes contradict the header");
        }

        // The reader accepts only these fixed values, so anything else did not come from a supported source file.
        if (header.Signature != Signature
            || header.FileType != WorldFileType.World
            || header.SectionCount != SectionCount
            || !bytes.Slice(SignatureOffset, Signature.Length).SequenceEqual(Encoding.ASCII.GetBytes(Signature))
            || bytes[FileTypeOffset] != (byte)WorldFileType.World
            || BinaryPrimitives.ReadInt16LittleEndian(bytes[SectionCountOffset..]) != SectionCount)
        {
            throw new WorldWriteException("fixed header fields are not those of a supported world");
        }

        // Revision and every flag bit (reserved ones included) are copied as read; header editing is not a save.
        if (BinaryPrimitives.ReadUInt32LittleEndian(bytes[RevisionOffset..]) != header.Revision
            || BinaryPrimitives.ReadUInt64LittleEndian(bytes[FlagsOffset..]) != header.Flags)
        {
            throw new WorldWriteException("file header bytes contradict the header revision or flags");
        }

        var frameImportant = table.FrameImportant;
        if (BinaryPrimitives.ReadInt16LittleEndian(bytes[FrameCountOffset..]) != frameImportant.Count
            || bytes.Length != FrameCountOffset + sizeof(short) + ((frameImportant.Count + 7) / 8))
        {
            throw new WorldWriteException("frame-important bits contradict the section table");
        }

        for (var id = 0; id < frameImportant.Count; id++)
        {
            var bit = (bytes[FrameCountOffset + sizeof(short) + (id / 8)] & (1 << (id % 8))) != 0;
            if (bit != frameImportant[id])
            {
                throw new WorldWriteException("frame-important bits contradict the section table");
            }
        }

        if (envelope.MetadataBytes.Length != table.Metadata.End - table.Metadata.Start
            || table.Metadata.Start != bytes.Length)
        {
            throw new WorldWriteException("metadata bytes contradict the section table");
        }

        if (envelope.OpaqueSections.Count != OpaqueSectionNames.Length
            || !envelope.OpaqueSections.Select(section => section.Name).SequenceEqual(OpaqueSectionNames))
        {
            throw new WorldWriteException("sections 3-10 are missing or out of order");
        }

        WorldSectionBoundary[] sourceBoundaries =
        [
            table.Chests,
            table.Signs,
            table.NpcsAndMobs,
            table.TileEntities,
            table.WeightedPressurePlates,
            table.TownManager,
            table.Bestiary,
            table.CreativePowers,
        ];
        for (var index = 0; index < sourceBoundaries.Length; index++)
        {
            var boundary = sourceBoundaries[index];
            if (envelope.OpaqueSections[index].Bytes.Length != boundary.End - boundary.Start
                || boundary.End <= boundary.Start)
            {
                throw new WorldWriteException($"section {OpaqueSectionNames[index]} contradicts its source boundary");
            }
        }

        ValidateSourceLayout(envelope);
        ValidateMetadataAgainstModel(envelope);
    }

    // The source sections must tile the file without gaps or overlaps, and the preserved pointer table must name
    // exactly their starts: W-S2 relocates every section by the same delta relative to that layout.
    private static void ValidateSourceLayout(WorldEnvelope envelope)
    {
        var table = envelope.Table;
        WorldSectionBoundary[] sections =
        [
            table.FileHeader,
            table.Metadata,
            table.Tiles,
            table.Chests,
            table.Signs,
            table.NpcsAndMobs,
            table.TileEntities,
            table.WeightedPressurePlates,
            table.TownManager,
            table.Bestiary,
            table.CreativePowers,
            table.Footer,
        ];
        if (table.FileHeader.Start != 0
            || table.FileHeader.End != envelope.FileHeaderBytes.Length
            || table.Tiles.End <= table.Tiles.Start
            || table.Footer.End - table.Footer.Start != envelope.FooterBytes.Length)
        {
            throw new WorldWriteException("source layout contradicts the envelope bytes");
        }

        var bytes = envelope.FileHeaderBytes.Span;
        for (var index = 1; index < sections.Length; index++)
        {
            var pointer = BinaryPrimitives.ReadInt32LittleEndian(bytes[(PointerTableOffset + ((index - 1) * sizeof(int)))..]);
            if (sections[index].Start != sections[index - 1].End || sections[index].Start != pointer)
            {
                throw new WorldWriteException("source layout contradicts the preserved section pointers");
            }
        }
    }

    // The preserved metadata bytes are what gets written, so the model fields must still say the same thing.
    private static void ValidateMetadataAgainstModel(WorldEnvelope envelope)
    {
        var world = envelope.World;
        WorldMetadata preserved;
        try
        {
            using var stream = new MemoryStream();
            stream.Write(envelope.FileHeaderBytes.Span);
            stream.Write(envelope.MetadataBytes.Span);
            preserved = WorldReader.ReadMetadata(stream, world.Header, envelope.Table);
        }
        catch (WorldFormatException exception)
        {
            throw new WorldWriteException($"metadata bytes are malformed: {exception.Message}");
        }

        if (preserved != world.Metadata
            || world.Tiles.Width != preserved.Width
            || world.Tiles.Height != preserved.Height)
        {
            throw new WorldWriteException("metadata or tile grid contradict the preserved metadata bytes");
        }
    }

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
        long footerLength)
    {
        ArgumentNullException.ThrowIfNull(opaqueLengths);

        long[] lengths = [headerLength, metadataLength, tileLength, .. opaqueLengths];
        var pointers = new int[lengths.Length];
        long position = 0;
        for (var index = 0; index < lengths.Length; index++)
        {
            // Lengths are non-negative and each is below 2^63 / 11 for any real buffer; the bound is checked per step.
            position += lengths[index];
            if (position + footerLength > int.MaxValue)
            {
                throw new WorldWriteException("file too large");
            }

            pointers[index] = (int)position;
        }

        return pointers;
    }
}
