namespace Terraria.WorldCodec;

/// <summary>Wire colours of a tile (docs/file-format.md, "Model mapping").</summary>
[Flags]
public enum TileWires
{
    None = 0,
    Red = 1,
    Blue = 2,
    Green = 4,
    Yellow = 8,
}

/// <summary>Block shape (flag byte 2, bits 4–6).</summary>
public enum BlockShape
{
    Full = 0,
    Half = 1,
    SlopeTopRight = 2,
    SlopeTopLeft = 3,
    SlopeBottomRight = 4,
    SlopeBottomLeft = 5,
}

/// <summary>Liquid kind; shimmer is liquid kind 1 with flag byte 3, bit 7.</summary>
public enum LiquidKind
{
    Water,
    Lava,
    Honey,
    Shimmer,
}

/// <summary>Liquid in a tile; an amount of 0 is kept as read.</summary>
public sealed record TileLiquid(LiquidKind Kind, byte Amount);

/// <summary>
/// One decoded tile (docs/file-format.md, "Model mapping"). Immutable: tiles repeated by run-length encoding may be
/// shared. Absent parts are <c>null</c>, never a default value.
/// </summary>
public sealed record Tile
{
    public ContentRef? Block { get; init; }

    public ContentRef? Wall { get; init; }

    public short? FrameX { get; init; }

    public short? FrameY { get; init; }

    /// <summary>Block paint byte, kept as read.</summary>
    public byte? Paint { get; init; }

    /// <summary>Wall paint byte, kept as read.</summary>
    public byte? WallPaint { get; init; }

    public TileWires Wires { get; init; }

    public bool Actuator { get; init; }

    public TileLiquid? Liquid { get; init; }

    public BlockShape Shape { get; init; }

    /// <summary>The block is switched off by an actuator.</summary>
    public bool Inactive { get; init; }

    public bool InvisibleBlock { get; init; }

    public bool InvisibleWall { get; init; }

    public bool FullBrightBlock { get; init; }

    public bool FullBrightWall { get; init; }
}
