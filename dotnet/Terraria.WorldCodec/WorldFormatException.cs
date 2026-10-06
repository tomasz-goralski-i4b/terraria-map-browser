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

    /// <summary>Error category.</summary>
    public WorldFormatError Error { get; }

    /// <summary>Byte offset, relative to where reading started, of the offending field or of the end of data.</summary>
    public long Offset { get; }

    /// <summary>Human-readable diagnostic.</summary>
    public string Reason { get; }
}
