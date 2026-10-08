using System.Globalization;
using Terraria.WorldInspector;

namespace Terraria.WorldCodec.Tests;

public sealed class EntityCorpusTests
{
    public static TheoryData<string, int, int, int> Worlds() => new()
    {
        { "SCCO1.wld", 190, 23732, 71 },
        { "SCCR2.wld", 168, 20771, 68 },
        { "SECR1.wld", 176, 21880, 69 },
        { "SJCO1.wld", 169, 21024, 69 },
        { "SMCO1.wld", 172, 21438, 69 },
    };

    [Theory]
    [MemberData(nameof(Worlds))]
    public void Read_Corpus_ReproducesEntityCountsAndSizes(string file, int chests, int chestBytes, int npcBytes)
    {
        using var stream = File.OpenRead(VanillaCorpusTests.WorldPath(file));
        var world = WorldReader.Read(stream);
        Assert.Equal(8, world.Entities.Count);
        Assert.All(world.Entities, section => Assert.Null(section.Error));
        Assert.Equal(chests, Assert.IsType<ChestsSection>(world.Entities[0].Data).Entries.Count);
        Assert.Equal(chestBytes, world.Entities[0].Boundary.End - world.Entities[0].Boundary.Start);
        Assert.Empty(Assert.IsType<SignsSection>(world.Entities[1].Data).Entries);
        var npcs = Assert.IsType<NpcsSection>(world.Entities[2].Data);
        Assert.Equal([37, 22], npcs.TownNpcs.Select(npc => npc.NpcId));
        Assert.Empty(npcs.Mobs);
        Assert.Empty(Assert.IsType<TileEntitiesSection>(world.Entities[3].Data).Entries);
        Assert.Empty(Assert.IsType<PressurePlatesSection>(world.Entities[4].Data).Entries);
        Assert.Empty(Assert.IsType<RoomsSection>(world.Entities[5].Data).Entries);
        Assert.Equal(new BestiarySection(0, 0, 0), world.Entities[6].Data);
        Assert.Equal([0, 8, 9, 10, 12, 13], Assert.IsType<CreativePowersSection>(world.Entities[7].Data).Entries.Select(power => (int)power.PowerId));
        Assert.Equal([chestBytes, 2, npcBytes, 4, 4, 4, 12, 31], world.Entities.Select(section => (int)(section.Boundary.End - section.Boundary.Start)));
        if (file == "SCCO1.wld")
        {
            Assert.Equal(1212, Assert.IsType<ChestsSection>(world.Entities[0].Data).Entries.Sum(chest => chest.Items.Count));
            Assert.Equal((3625, 296), (npcs.TownNpcs[0].HomeX, npcs.TownNpcs[0].HomeY));
            Assert.Equal((2104, 279), (npcs.TownNpcs[1].HomeX, npcs.TownNpcs[1].HomeY));
        }

        using var output = new StringWriter(CultureInfo.InvariantCulture);
        using var errors = new StringWriter(CultureInfo.InvariantCulture);
        Assert.Equal(0, InspectorCommand.Run(["inspect", file], output, errors, _ => world));
        string[] expected =
        [
            $"Chests: {chests} / {chestBytes} B",
            "Signs: 0 / 2 B",
            $"NpcsAndMobs: 2+0 / {npcBytes} B",
            "TileEntities: 0 / 4 B",
            "WeightedPressurePlates: 0 / 4 B",
            "TownManager: 0 / 4 B",
            "Bestiary: 0,0,0 / 12 B",
            "CreativePowers: 6 / 31 B",
        ];
        var lines = output.ToString().Split(Environment.NewLine);
        Assert.All(expected, line => Assert.Single(lines, candidate => candidate == line));
    }

    [Fact]
    public void Inspect_MalformedEntitySection_PrintsUnreadableWithSize()
    {
        var bytes = File.ReadAllBytes(VanillaCorpusTests.WorldPath("SCCO1.wld"));
        using var source = new MemoryStream(bytes);
        var table = WorldReader.ReadForSave(source).Table;
        bytes[(int)table.CreativePowers.Start] = 2;
        using var stream = new MemoryStream(bytes);
        var world = WorldReader.Read(stream);

        using var output = new StringWriter(CultureInfo.InvariantCulture);
        using var errors = new StringWriter(CultureInfo.InvariantCulture);
        Assert.Equal(0, InspectorCommand.Run(["inspect", "SCCO1.wld"], output, errors, _ => world));

        var lines = output.ToString().Split(Environment.NewLine);
        var line = Assert.Single(lines, candidate => candidate.StartsWith("CreativePowers: ", StringComparison.Ordinal));
        Assert.StartsWith("CreativePowers: unreadable (", line, StringComparison.Ordinal);
        Assert.EndsWith(") / 31 B", line, StringComparison.Ordinal);
        Assert.Contains("Chests: 190 / 23732 B", lines);
    }

    [Fact]
    public void ReadForSave_MalformedEntitySection_IsolatesErrorAndPreservesBytes()
    {
        using var source = File.OpenRead(VanillaCorpusTests.WorldPath("SCCO1.wld"));
        var original = WorldReader.ReadForSave(source);
        source.Position = 0;
        using var bytes = new MemoryStream();
        source.CopyTo(bytes);
        var corrupted = bytes.ToArray();
        corrupted[(int)original.Table.CreativePowers.Start] = 2;
        using var stream = new MemoryStream(corrupted);
        var envelope = WorldReader.ReadForSave(stream);
        Assert.NotNull(envelope.World.Entities[7].Error);
        Assert.All(envelope.World.Entities.Take(7), section => Assert.Null(section.Error));
        Assert.Equal(190, Assert.IsType<ChestsSection>(envelope.World.Entities[0].Data).Entries.Count);
        Assert.Equal(original.World.Tiles[320, 180], envelope.World.Tiles[320, 180]);
        Assert.Equal(corrupted.AsSpan((int)original.Table.CreativePowers.Start, 31).ToArray(), envelope.OpaqueSections[7].Bytes.ToArray());
    }
}
