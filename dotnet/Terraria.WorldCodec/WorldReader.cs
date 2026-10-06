namespace Terraria.WorldCodec;

/// <summary>Reads <c>.wld</c> files according to docs/file-format.md.</summary>
public static class WorldReader
{
    /// <summary>The explicit set of format versions accepted in M1.</summary>
    public static IReadOnlySet<int> SupportedVersions => throw new NotImplementedException();

    /// <summary>
    /// Reads and validates the file header and leaves <paramref name="stream"/> at the start of the section table.
    /// </summary>
    /// <exception cref="WorldFormatException">The header is truncated, unsupported or not a world.</exception>
    public static WorldFileHeader ReadHeader(Stream stream) => throw new NotImplementedException();
}
