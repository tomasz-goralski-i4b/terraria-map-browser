namespace Terraria.WorldCodec;

/// <summary>Why a world file was rejected (docs/file-format.md, "Check order").</summary>
public enum WorldFormatError
{
    Truncated,
    UnsupportedVersion,
    NotAWorld,
    MalformedSectionTable,
    MalformedMetadata,
}
