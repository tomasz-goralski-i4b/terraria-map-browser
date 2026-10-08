namespace Terraria.WorldCodec;

/// <summary>Decoded sections are independent; an unreadable section retains its diagnostic and boundary.</summary>
public sealed record WorldEntitySection(string Section, WorldSectionBoundary Boundary, EntitySectionData? Data, WorldFormatException? Error);

public abstract record EntitySectionData;

public sealed record EntityItem(int Slot, int ItemId, int Stack, byte Prefix);

public sealed record WorldChest(int X, int Y, string Name, int SlotCount, IReadOnlyList<EntityItem> Items);

public sealed record WorldSign(int X, int Y, string Text);

public sealed record WorldTownNpc(int NpcId, string DisplayName, float X, float Y, bool Homeless, int HomeX, int HomeY);

public sealed record WorldMob(int NpcId, float X, float Y);

/// <summary>Item, dye and misc slots remain separate; consumed-only payloads are deliberately omitted.</summary>
public sealed record WorldTileEntity(byte Kind, int EntityId, short X, short Y,
    IReadOnlyList<EntityItem> Items, IReadOnlyList<EntityItem> Dyes, IReadOnlyList<EntityItem> Misc, short? AnchorItemId);

public sealed record WorldPressurePlate(int X, int Y);

public sealed record WorldRoom(int NpcId, int X, int Y);

public sealed record WorldCreativePower(short PowerId, bool? BooleanValue, float? SliderValue);

public sealed record ChestsSection(IReadOnlyList<WorldChest> Entries) : EntitySectionData;

public sealed record SignsSection(IReadOnlyList<WorldSign> Entries) : EntitySectionData;

public sealed record NpcsSection(IReadOnlyList<WorldTownNpc> TownNpcs, IReadOnlyList<WorldMob> Mobs) : EntitySectionData;

public sealed record TileEntitiesSection(IReadOnlyList<WorldTileEntity> Entries) : EntitySectionData;

public sealed record PressurePlatesSection(IReadOnlyList<WorldPressurePlate> Entries) : EntitySectionData;

public sealed record RoomsSection(IReadOnlyList<WorldRoom> Entries) : EntitySectionData;

public sealed record BestiarySection(int KillCount, int SeenCount, int ChattedCount) : EntitySectionData;

public sealed record CreativePowersSection(IReadOnlyList<WorldCreativePower> Entries) : EntitySectionData;
