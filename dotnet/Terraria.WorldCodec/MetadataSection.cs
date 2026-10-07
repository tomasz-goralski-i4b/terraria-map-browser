namespace Terraria.WorldCodec;

/// <summary>Field walk of the metadata section for format 326 (docs/file-format.md, "World metadata").</summary>
internal static class MetadataSection
{
    /// <summary>Consumes every field of the section; unread bytes are an error.</summary>
    public static WorldMetadata Read(MetadataSectionReader r, WorldSectionTable table)
    {
        // Rows 1-12 (format 326: every row except 58 is present).
        var name = r.String("name", MetadataSectionReader.MaxNameOrSeedBytes);
        var seed = r.String("seed", MetadataSectionReader.MaxNameOrSeedBytes);
        r.Skip(sizeof(ulong), "worldGenVersion");
        var guidHex = Convert.ToHexStringLower(r.Bytes(16, "guid"));
        var worldId = r.Int32("worldId");
        r.Int32s(4);
        var height = ReadDimension(r, "height", WorldReader.MaxWorldHeight);
        var widthStart = r.AbsolutePosition;
        var width = ReadDimension(r, "width", WorldReader.MaxWorldWidth);
        if ((long)width * height > WorldReader.MaxWorldTileCount)
        {
            throw MetadataSectionReader.Error(widthStart, "width · height exceeds the implementation limit", "width");
        }

        if (width > table.Tiles.End - table.Tiles.Start)
        {
            throw MetadataSectionReader.Error(widthStart, "every column needs at least one byte of the tile section", "width");
        }

        var gameMode = (WorldGameMode)r.Int32("gameMode");

        // Rows 13-21.
        r.Bools(9);
        r.Skip(2 * sizeof(long));
        r.Skip(sizeof(byte));
        r.Int32s(17 + 2);
        r.Skip(3 * sizeof(double));
        r.Bool();
        r.Int32s(1);
        r.Bools(2);
        r.Int32s(2);

        // Row 22.
        var evil = r.Bool("crimson") ? WorldEvil.Crimson : WorldEvil.Corruption;

        // Rows 23-31.
        r.Bools(10 + 1 + 7);
        r.Bools(2);
        r.Skip(sizeof(byte));
        r.Int32s(1);
        r.Bools(1 + 1);
        r.Int32s(3);
        r.Skip(2 * sizeof(double));
        r.Skip(sizeof(byte));
        r.Bool();
        r.Int32s(1);
        r.Skip(sizeof(float));
        r.Int32s(3);
        r.Skip(8);
        r.Int32s(1);
        r.Skip(sizeof(short) + sizeof(float));

        // Row 32: angler finishers (each String is at least its 1-byte prefix).
        var anglerFinishers = r.Count(sizeof(int), 1, "anglerFinishers");
        for (var index = 0; index < anglerFinishers; index++)
        {
            r.String("anglerFinishers", MetadataSectionReader.MaxOtherStringBytes);
        }

        // Rows 33-35.
        r.Bool();
        r.Int32s(1);
        r.Bools(3);
        r.Int32s(2);
        r.Int32s(r.Count(sizeof(short), sizeof(int), "killCounts"));
        var banners = r.Count(sizeof(short), sizeof(ushort), "claimableBanners");
        r.Skip(banners * sizeof(ushort));

        // Rows 36-39.
        r.Bools(1 + 9 + 9);
        r.Bools(2);
        r.Int32s(1);
        r.Int32s(r.Count(sizeof(int), sizeof(int), "partyingNpcs"));

        // Rows 40-44.
        r.Bool();
        r.Int32s(1);
        r.Skip(2 * sizeof(float));
        r.Bools(4);
        r.Skip(5);
        r.Bool();
        r.Int32s(1);
        r.Bools(3);

        // Row 45.
        r.Int32s(r.Count(sizeof(int), sizeof(int), "treeTopVariations"));

        // Rows 46-54 (row 54 physically after row 53).
        r.Bools(2);
        r.Int32s(4);
        r.Bools(3);
        r.Bools(12);
        r.Bools(9);
        r.Bool();
        r.Skip(sizeof(byte));
        r.Bools(2);
        r.Bools(2);
        r.Int32s(2);

        // Row 55: team spawns, (x Int16, y Int16) each.
        r.Bool();
        var teamSpawns = r.Count(sizeof(byte), 2 * sizeof(short), "teamSpawns");
        r.Skip(teamSpawns * 2 * sizeof(short));

        // Rows 56-57; row 58 is absent for 326; row 59.
        r.Bools(1 + 2);
        r.String("worldGenManifest", MetadataSectionReader.MaxOtherStringBytes);

        if (r.Remaining != 0)
        {
            throw MetadataSectionReader.Error(r.AbsolutePosition, "unread bytes");
        }

        return new WorldMetadata(name, seed, guidHex, worldId, width, height, gameMode, evil);
    }

    internal static int ReadDimension(MetadataSectionReader reader, string field, int max)
    {
        var start = reader.AbsolutePosition;
        var value = reader.Int32(field);
        if (value <= 0)
        {
            throw MetadataSectionReader.Error(start, "must be positive", field);
        }

        if (value > max)
        {
            throw MetadataSectionReader.Error(start, "exceeds the implementation limit", field);
        }

        return value;
    }
}
