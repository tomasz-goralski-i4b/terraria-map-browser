using System.Collections.Frozen;
using System.Collections.ObjectModel;
using System.Globalization;

namespace Terraria.WorldCodec;

/// <summary>
/// Independent read-only decoder for entity sections (docs/file-format/entities.md) in the layout of each released
/// format whose tiles the codecs can read (docs/file-format/compatibility.md, "Other sections and older families").
/// </summary>
public static class EntitySectionReader
{
    /// <summary>Formats with a known entity layout: 269–279, 315–319, 325–326.</summary>
    public static IReadOnlySet<int> SupportedVersions { get; } =
        Enumerable.Range(269, 11).Concat(Enumerable.Range(315, 5)).Concat([325, 326]).ToFrozenSet();

    /// <summary>Entity layout gates (format of the change): 294, 307, 308, 315.</summary>
    private readonly record struct Layout(bool PerChestSlotCounts, bool DisplayDollPose, bool DisplayDollExtraSlots, bool NpcHomelessDespawn)
    {
        public static Layout For(int version) => SupportedVersions.Contains(version)
            ? new Layout(version >= 294, version >= 307, version >= 308, version >= 315)
            : throw new WorldFormatException(
                WorldFormatError.UnsupportedVersion,
                0,
                string.Create(CultureInfo.InvariantCulture, $"format version {version} has no known entity layout"));
    }

    public static IReadOnlyList<WorldEntitySection> ReadAll(Stream stream, WorldSectionTable table, int version = 326)
    {
        ArgumentNullException.ThrowIfNull(table);
        (string Name, WorldSectionBoundary Boundary)[] sections =
        [
            (nameof(table.Chests), table.Chests), (nameof(table.Signs), table.Signs),
            (nameof(table.NpcsAndMobs), table.NpcsAndMobs), (nameof(table.TileEntities), table.TileEntities),
            (nameof(table.WeightedPressurePlates), table.WeightedPressurePlates), (nameof(table.TownManager), table.TownManager),
            (nameof(table.Bestiary), table.Bestiary), (nameof(table.CreativePowers), table.CreativePowers),
        ];
        return Array.AsReadOnly(sections.Select(section =>
        {
            try
            {
                return new WorldEntitySection(section.Name, section.Boundary, Read(stream, section.Name, section.Boundary, version), null);
            }
            catch (WorldFormatException error) when (error.Error == WorldFormatError.MalformedSection)
            {
                return new WorldEntitySection(section.Name, section.Boundary, null, error);
            }
        }).ToArray());
    }

    public static EntitySectionData Read(Stream stream, string section, WorldSectionBoundary boundary, int version = 326)
    {
        ArgumentNullException.ThrowIfNull(stream);
        ArgumentNullException.ThrowIfNull(boundary);
        if (!stream.CanRead || !stream.CanSeek)
        {
            throw new ArgumentException("Entity decoding requires a readable, seekable stream.", nameof(stream));
        }

        if (boundary.Start < 0 || boundary.End < boundary.Start || boundary.End > stream.Length)
        {
            throw new ArgumentOutOfRangeException(nameof(boundary));
        }

        var layout = Layout.For(version);

        var reader = new MetadataSectionReader(stream, boundary, section, WorldFormatError.MalformedSection);
        EntitySectionData data = section switch
        {
            "Chests" => new ChestsSection(Chests(reader, layout)),
            "Signs" => new SignsSection(Records(reader, 2, 9, () => Sign(reader))),
            "NpcsAndMobs" => Npcs(reader, layout),
            "TileEntities" => new TileEntitiesSection(Records(reader, 4, 9, () => TileEntity(reader, section, layout))),
            "WeightedPressurePlates" => new PressurePlatesSection(Records(reader, 4, 8, () => new WorldPressurePlate(reader.Int32("x"), reader.Int32("y")))),
            "TownManager" => new RoomsSection(Records(reader, 4, 12, () => new WorldRoom(reader.Int32("npcId"), reader.Int32("x"), reader.Int32("y")))),
            "Bestiary" => Bestiary(reader),
            "CreativePowers" => Powers(reader, section),
            _ => throw new ArgumentException("Unknown entity section.", nameof(section)),
        };
        if (reader.Remaining != 0)
        {
            throw Error(section, reader.AbsolutePosition, "end", "section does not end at its pointer");
        }

        return data;
    }

    private const string CountReason = "list count is negative or does not fit in the section";

    private static WorldFormatException Error(string section, long offset, string field, string reason) =>
        new(WorldFormatError.MalformedSection, offset, reason, section, field);

    private static ReadOnlyCollection<T> Records<T>(MetadataSectionReader reader, int size, int minimum, Func<T> read)
    {
        var count = reader.Count(size, minimum, "count");
        var entries = new T[count];
        for (var index = 0; index < count; index++)
        {
            entries[index] = read();
        }

        return Array.AsReadOnly(entries);
    }

    private static ReadOnlyCollection<WorldChest> Chests(MetadataSectionReader reader, Layout layout)
    {
        if (layout.PerChestSlotCounts)
        {
            return Records(reader, 2, 13, () => Chest(reader, null));
        }

        // Before format 294 one Int16 slot count follows the chest count and applies to every chest.
        var start = reader.AbsolutePosition;
        var count = reader.Int16("count");
        if (count < 0)
        {
            throw Error("Chests", start, "count", CountReason);
        }

        var slotCount = reader.Count(2, 2, "slotCount");
        if (count * (9L + (2L * slotCount)) > reader.Remaining)
        {
            throw Error("Chests", start, "count", CountReason);
        }

        var entries = new WorldChest[count];
        for (var index = 0; index < count; index++)
        {
            entries[index] = Chest(reader, slotCount);
        }

        return Array.AsReadOnly(entries);
    }

    private static WorldChest Chest(MetadataSectionReader reader, int? sharedSlotCount)
    {
        var x = reader.Int32("x");
        var y = reader.Int32("y");
        var name = reader.String("name", MetadataSectionReader.MaxOtherStringBytes);
        var count = sharedSlotCount ?? reader.Count(4, 2, "slotCount");
        var items = new List<EntityItem>();
        for (var slot = 0; slot < count; slot++)
        {
            var offset = reader.AbsolutePosition;
            var stack = reader.Int16("stack");
            if (stack < 0)
            {
                throw Error("Chests", offset, "stack", "negative stack");
            }

            if (stack > 0)
            {
                items.Add(new EntityItem(slot, reader.Int32("itemId"), stack, reader.UInt8("prefix")));
            }
        }

        return new WorldChest(x, y, name, count, items.AsReadOnly());
    }

    private static WorldSign Sign(MetadataSectionReader reader)
    {
        var text = reader.String("text", MetadataSectionReader.MaxOtherStringBytes);
        return new WorldSign(reader.Int32("x"), reader.Int32("y"), text);
    }

    private static NpcsSection Npcs(MetadataSectionReader reader, Layout layout)
    {
        var shimmered = reader.Count(4, 4, "shimmeredCount");
        for (var index = 0; index < shimmered; index++)
        {
            reader.Int32("shimmeredNpcId");
        }

        var town = new List<WorldTownNpc>();
        while (reader.Bool("more"))
        {
            var id = reader.Int32("npcId");
            var name = reader.String("displayName", MetadataSectionReader.MaxOtherStringBytes);
            var x = reader.Single("x");
            var y = reader.Single("y");
            var homeless = reader.Bool("homeless");
            var homeX = reader.Int32("homeX");
            var homeY = reader.Int32("homeY");
            var offset = reader.AbsolutePosition;
            var bits = reader.UInt8("extraBits");
            if ((bits & ~1) != 0)
            {
                throw Error("NpcsAndMobs", offset, "extraBits", "unknown NPC extra bits");
            }

            if ((bits & 1) != 0)
            {
                reader.Int32("variationIndex");
            }

            if (layout.NpcHomelessDespawn)
            {
                reader.Bool("homelessDespawn");
            }

            town.Add(new WorldTownNpc(id, name, x, y, homeless, homeX, homeY));
        }

        var mobs = new List<WorldMob>();
        while (reader.Bool("more"))
        {
            mobs.Add(new WorldMob(reader.Int32("npcId"), reader.Single("x"), reader.Single("y")));
        }

        return new NpcsSection(town.AsReadOnly(), mobs.AsReadOnly());
    }

    private static EntityItem Item(MetadataSectionReader reader, int slot)
    {
        var id = reader.Int16("itemId");
        var prefix = reader.UInt8("prefix");
        // Tile-entity stacks are retained as read; the specification only rejects negative chest stacks.
        return new EntityItem(slot, id, reader.Int16("stack"), prefix);
    }

    private static WorldTileEntity TileEntity(MetadataSectionReader reader, string section, Layout layout)
    {
        var offset = reader.AbsolutePosition;
        var kind = reader.UInt8("kind");
        if (kind > 10)
        {
            throw Error(section, offset, "kind", "unknown tile entity kind");
        }

        var id = reader.Int32("entityId");
        var x = reader.Int16("x");
        var y = reader.Int16("y");
        var items = new List<EntityItem>();
        var dyes = new List<EntityItem>();
        var misc = new List<EntityItem>();
        short? anchor = null;
        switch (kind)
        {
            case 0:
                reader.Int16("npcSlot");
                break;
            case 1:
            case 4:
            case 6:
            case 8:
                items.Add(Item(reader, 0));
                break;
            case 2:
                reader.UInt8("checkKind");
                reader.Bool("on");
                break;
            case 3:
                var itemBits = reader.UInt8("itemPresence");
                var dyeBits = reader.UInt8("dyePresence");
                if (layout.DisplayDollPose)
                {
                    reader.UInt8("pose");
                }

                var extra = layout.DisplayDollExtraSlots ? reader.UInt8("extraPresence") : 0;
                PresentItems(reader, items, itemBits | ((extra & 2) << 7), 9);
                PresentItems(reader, dyes, dyeBits | ((extra & 4) << 6), 9);
                PresentItems(reader, misc, extra & 1, 1);
                break;
            case 5:
                var presence = reader.UInt8("presence");
                PresentItems(reader, items, presence & 3, 2);
                PresentItems(reader, dyes, (presence >> 2) & 3, 2);
                break;
            case 9:
            case 10:
                anchor = reader.Int16("anchorItemId");
                break;
        }

        return new WorldTileEntity(kind, id, x, y, items.AsReadOnly(), dyes.AsReadOnly(), misc.AsReadOnly(), anchor);
    }

    private static void PresentItems(MetadataSectionReader reader, List<EntityItem> items, int bits, int slots)
    {
        for (var slot = 0; slot < slots; slot++)
        {
            if ((bits & (1 << slot)) != 0)
            {
                items.Add(Item(reader, slot));
            }
        }
    }

    private static BestiarySection Bestiary(MetadataSectionReader reader)
    {
        var kills = reader.Count(4, 5, "killCount");
        for (var index = 0; index < kills; index++)
        {
            reader.String("npcKey", MetadataSectionReader.MaxOtherStringBytes);
            reader.Int32("kills");
        }

        var seen = Keys(reader, "seenCount");
        var chatted = Keys(reader, "chattedCount");
        return new BestiarySection(kills, seen, chatted);
    }

    private static int Keys(MetadataSectionReader reader, string field)
    {
        var count = reader.Count(4, 1, field);
        for (var index = 0; index < count; index++)
        {
            reader.String("npcKey", MetadataSectionReader.MaxOtherStringBytes);
        }

        return count;
    }

    private static CreativePowersSection Powers(MetadataSectionReader reader, string section)
    {
        var powers = new List<WorldCreativePower>();
        while (reader.Bool("more"))
        {
            var offset = reader.AbsolutePosition;
            var id = reader.Int16("powerId");
            powers.Add(id switch
            {
                0 or 5 or 9 or 10 or 11 or 13 => new WorldCreativePower(id, reader.Bool("value"), null),
                8 or 12 or 14 => new WorldCreativePower(id, null, reader.Single("value")),
                _ => throw Error(section, offset, "powerId", "unknown creative power"),
            });
        }

        return new CreativePowersSection(powers.AsReadOnly());
    }
}
