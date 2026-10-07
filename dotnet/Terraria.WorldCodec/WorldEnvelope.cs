namespace Terraria.WorldCodec;

/// <summary>Bytes of one section that M1/M2 does not interpret, kept exactly as read.</summary>
/// <param name="Name">Section name, as the property name in <see cref="WorldSectionTable"/>.</param>
/// <param name="Bytes">The exact bytes of the section.</param>
public sealed record OpaqueSection(string Name, ReadOnlyMemory<byte> Bytes);

/// <summary>
/// A world read for saving (docs/file-format/writer.md, "Layout produced"): the M1 model plus every source byte
/// the model does not carry, owned by the envelope so it stays valid after the input stream is closed.
/// </summary>
public sealed record WorldEnvelope
{
    /// <summary>The M1 world: header, metadata and tiles.</summary>
    public required World World { get; init; }

    /// <summary>Section boundaries of the source file.</summary>
    public required WorldSectionTable Table { get; init; }

    /// <summary>Source bytes <c>0 … pointer[0]</c>: file header, pointer table, frame-important count and bits.</summary>
    public required ReadOnlyMemory<byte> FileHeaderBytes { get; init; }

    /// <summary>Source bytes <c>pointer[0] … pointer[1]</c>, including every field M1 only consumes.</summary>
    public required ReadOnlyMemory<byte> MetadataBytes { get; init; }

    /// <summary>Sections 3–10 in file order (chests … creative powers), one entry per section.</summary>
    public required IReadOnlyList<OpaqueSection> OpaqueSections { get; init; }

    /// <summary>Source bytes <c>pointer[10] … L</c>, validated against the metadata.</summary>
    public required ReadOnlyMemory<byte> FooterBytes { get; init; }
}
