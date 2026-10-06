namespace Terraria.WorldCodec;

/// <summary>A world file violates the format contract.</summary>
public sealed class WorldFormatException : Exception
{
    public WorldFormatException(WorldFormatError error, long offset, string reason)
        : base($"{error} at offset {offset}: {reason}")
    {
        Error = error;
        Offset = offset;
        Reason = reason;
    }

    /// <summary>An error inside a named section, optionally pinned to one field of it.</summary>
    public WorldFormatException(WorldFormatError error, long offset, string reason, string section, string? field)
        : this(error, offset, reason) => throw new NotImplementedException();

    /// <summary>Name of the section (as in <see cref="WorldSectionTable"/>) that holds the offending bytes, if any.</summary>
    public string? Section { get; }

    /// <summary>Contract name of the offending field (docs/file-format.md), if any.</summary>
    public string? Field { get; }

    /// <summary>Error category.</summary>
    public WorldFormatError Error { get; }

    /// <summary>Byte offset, relative to where reading started, of the offending field or of the end of data.</summary>
    public long Offset { get; }

    /// <summary>Human-readable diagnostic.</summary>
    public string Reason { get; }
}
