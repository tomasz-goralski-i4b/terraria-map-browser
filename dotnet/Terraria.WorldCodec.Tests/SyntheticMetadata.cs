using System.Buffers.Binary;
using System.Text;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// Builds format-326 world metadata (docs/file-format.md, "World metadata", rows 1–59) from scratch.
/// Every consumed field gets a distinct, non-zero value so that a reader that skips or reorders fields drifts.
/// </summary>
internal sealed class SyntheticMetadata
{
    /// <summary>GUID bytes in file order, from the SCCO1 row of docs/file-format.md.</summary>
    public static readonly byte[] DefaultGuid = Convert.FromHexString("87e466e7853c3f48b75abc85e36d4b86");

    public string Name { get; init; } = "Synthetic";

    /// <summary>Raw bytes (length prefix included) written instead of <see cref="Name"/>.</summary>
    public byte[]? RawName { get; init; }

    public string Seed { get; init; } = "948580918";

    public byte[] Guid { get; init; } = DefaultGuid;

    public int WorldId { get; init; } = 1743427911;

    public int Width { get; init; } = 2;

    public int Height { get; init; } = 4;

    public int GameMode { get; init; }

    public byte DayTime { get; init; } = 1;

    public byte Crimson { get; init; }

    public string[] AnglerFinishers { get; init; } = [];

    public int? AnglerFinisherCount { get; init; }

    public int[] KillCounts { get; init; } = [];

    public short? KillCountCount { get; init; }

    public ushort[] ClaimableBanners { get; init; } = [];

    public int[] PartyingNpcs { get; init; } = [];

    public int[] TreeTopVariations { get; init; } = [];

    public int? TreeTopVariationCount { get; init; }

    public (short X, short Y)[] TeamSpawns { get; init; } = [];

    public string Manifest { get; init; } = "{\"passes\":[]}";

    /// <summary>Metadata bytes and the offset of each named field relative to the start of the section.</summary>
    public (byte[] Bytes, IReadOnlyDictionary<string, int> Offsets) Build()
    {
        using var buffer = new MemoryStream();
        using var w = new BinaryWriter(buffer, new UTF8Encoding(false), leaveOpen: true);
        var offsets = new Dictionary<string, int>();
        void Mark(string field)
        {
            w.Flush();
            offsets[field] = (int)buffer.Position;
        }

        var counter = 0;
        void Bools(int count)
        {
            for (var i = 0; i < count; i++)
            {
                w.Write((byte)(counter++ % 2));
            }
        }

        void Int32s(int count)
        {
            for (var i = 0; i < count; i++)
            {
                w.Write(0x0101_0000 + counter++);
            }
        }

        void Bytes(int count)
        {
            for (var i = 0; i < count; i++)
            {
                w.Write((byte)(0x40 + (counter++ % 64)));
            }
        }

        // Rows 1-12.
        Mark("name");
        if (RawName is null)
        {
            w.Write(Name);
        }
        else
        {
            w.Write(RawName);
        }

        Mark("seed");
        w.Write(Seed);
        Mark("worldGenVersion");
        w.Write(0x0000_0146_0000_0001UL);
        Mark("guid");
        w.Write(Guid);
        Mark("worldId");
        w.Write(WorldId);
        Mark("bounds");
        w.Write(0);
        w.Write(unchecked(16 * Width));
        w.Write(0);
        w.Write(unchecked(16 * Height));
        Mark("height");
        w.Write(Height);
        Mark("width");
        w.Write(Width);
        Mark("gameMode");
        w.Write(GameMode);

        // Rows 13-21.
        Bools(9);
        w.Write(638_000_000_000_000_000L);
        w.Write(638_000_000_100_000_000L);
        Bytes(1);
        Int32s(17);
        Int32s(2);
        w.Write(300.0);
        w.Write(420.5);
        w.Write(13_500.25);
        Mark("dayTime");
        w.Write(DayTime);
        Int32s(1);
        Bools(2);
        Int32s(2);

        // Row 22.
        Mark("crimson");
        w.Write(Crimson);

        // Rows 23-31.
        Bools(10 + 1 + 7);
        Bools(2);
        Bytes(1);
        Int32s(1);
        Bools(1);
        Bools(1);
        Int32s(3);
        w.Write(-1.5);
        w.Write(2.25);
        Bytes(1);
        Bools(1);
        Int32s(1);
        w.Write(0.75f);
        Int32s(3);
        Bytes(8);
        Int32s(1);
        w.Write((short)0x0123);
        w.Write(-0.5f);

        // Row 32.
        Mark("anglerFinishers");
        w.Write(AnglerFinisherCount ?? AnglerFinishers.Length);
        foreach (var finisher in AnglerFinishers)
        {
            w.Write(finisher);
        }

        // Row 33.
        Bools(1);
        Int32s(1);
        Bools(3);
        Int32s(2);

        // Row 34-35.
        Mark("killCounts");
        w.Write(KillCountCount ?? (short)KillCounts.Length);
        foreach (var kills in KillCounts)
        {
            w.Write(kills);
        }

        Mark("claimableBanners");
        w.Write((short)ClaimableBanners.Length);
        foreach (var banner in ClaimableBanners)
        {
            w.Write(banner);
        }

        // Rows 36-39.
        Bools(1 + 9 + 9);
        Bools(2);
        Int32s(1);
        Mark("partyingNpcs");
        w.Write(PartyingNpcs.Length);
        foreach (var npc in PartyingNpcs)
        {
            w.Write(npc);
        }

        // Rows 40-44.
        Bools(1);
        Int32s(1);
        w.Write(0.125f);
        w.Write(0.25f);
        Bools(4);
        Bytes(5);
        Bools(1);
        Int32s(1);
        Bools(3);

        // Row 45.
        Mark("treeTopVariations");
        w.Write(TreeTopVariationCount ?? TreeTopVariations.Length);
        foreach (var variation in TreeTopVariations)
        {
            w.Write(variation);
        }

        // Rows 46-54.
        Bools(2);
        Int32s(4);
        Bools(3);
        Bools(12);
        Bools(9);
        Bools(1);
        Bytes(1);
        Bools(2);
        Bools(2);
        Int32s(2);

        // Row 55.
        Bools(1);
        Mark("teamSpawns");
        w.Write((byte)TeamSpawns.Length);
        foreach (var (x, y) in TeamSpawns)
        {
            w.Write(x);
            w.Write(y);
        }

        // Rows 56-57; row 58 is absent for 326.
        Bools(1);
        Bools(2);

        // Row 59.
        Mark("worldGenManifest");
        w.Write(Manifest);
        w.Flush();
        return (buffer.ToArray(), offsets);
    }
}

/// <summary>Wraps metadata and tile bytes in a valid header, section table and footer.</summary>
internal static class SyntheticWorld
{
    /// <summary>End of the file header for <c>k = 10</c> (vector A) and so the start of metadata.</summary>
    public const int MetadataStart = 74;

    public static byte[] Build(byte[] metadata, int tileLength)
    {
        const int OtherSectionLength = 2;
        const int FooterLength = 6;
        var pointers = new int[11];
        pointers[0] = MetadataStart;
        pointers[1] = pointers[0] + metadata.Length;
        pointers[2] = pointers[1] + tileLength;
        for (var index = 3; index < pointers.Length; index++)
        {
            pointers[index] = pointers[index - 1] + OtherSectionLength;
        }

        var bytes = new byte[pointers[^1] + FooterLength];
        BinaryPrimitives.WriteInt32LittleEndian(bytes, 326);
        Encoding.ASCII.GetBytes("relogic").CopyTo(bytes, 4);
        bytes[11] = 2;
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(12), 1);
        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(24), 11);
        for (var index = 0; index < pointers.Length; index++)
        {
            BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(26 + (4 * index)), pointers[index]);
        }

        BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(70), 10);
        bytes[72] = 0x38;
        bytes[73] = 0x02;
        metadata.CopyTo(bytes, MetadataStart);

        // Tile bytes that would decode as anything but metadata padding.
        bytes.AsSpan(pointers[1], tileLength).Fill(0xA5);
        return bytes;
    }
}
