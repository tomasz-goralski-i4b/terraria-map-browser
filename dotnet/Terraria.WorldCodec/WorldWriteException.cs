namespace Terraria.WorldCodec;

/// <summary>A world cannot be saved (docs/file-format/writer.md, <c>UnsupportedWrite</c>); nothing valid was written.</summary>
public sealed class WorldWriteException(string reason)
    : Exception($"UnsupportedWrite: {reason}")
{
    /// <summary>Human-readable diagnostic, e.g. <c>file too large</c>.</summary>
    public string Reason { get; } = reason;
}
