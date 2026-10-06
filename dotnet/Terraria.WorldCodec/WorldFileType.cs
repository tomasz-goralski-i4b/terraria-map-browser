namespace Terraria.WorldCodec;

/// <summary>File-type byte at offset 11 of a Re-Logic file header (docs/file-format.md).</summary>
public enum WorldFileType : byte
{
    None = 0,
    Map = 1,
    World = 2,
    Player = 3,
}
