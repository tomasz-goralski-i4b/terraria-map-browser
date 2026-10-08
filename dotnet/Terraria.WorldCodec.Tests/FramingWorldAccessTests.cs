using Terraria.WorldCodec.Synthetic;

namespace Terraria.WorldCodec.Tests;

public sealed class FramingWorldAccessTests
{
    [Fact]
    public void Generate_WorldPickerNameAndSpawn_MakeCasesAccessibleWithoutFlight()
    {
        using var directory = new TemporaryDirectory();
        var input = VanillaCorpusTests.WorldPath("SJCO1.wld");
        var target = Path.Combine(directory.Path, "tms-framing-tests-158.wld");
        var manifest = FramingWorldGenerator.Generate(input, target);
        using var output = File.OpenRead(target);
        var generated = WorldReader.ReadForSave(output);
        using var original = File.OpenRead(input);
        var source = WorldReader.ReadForSave(original);
        Assert.Equal("TMS Framing Tests #158 v3 Frozen", generated.World.Metadata.Name);
        Assert.True(manifest.TimeFrozen);
        Assert.NotEqual(source.World.Metadata.WorldId, generated.World.Metadata.WorldId);
        Assert.NotEqual(source.World.Metadata.GuidHex, generated.World.Metadata.GuidHex);
        // Read documented format-326 metadata fields independently of the generator.
        using var metadata = new BinaryReader(new MemoryStream(generated.MetadataBytes.ToArray()));
        metadata.ReadString();
        metadata.ReadString();
        metadata.BaseStream.Position += 8 + 16 + 4 + 16 + 8 + 4 + 9 + 16 + 1 + (17 * 4);
        var spawnX = metadata.ReadInt32();
        var spawnY = metadata.ReadInt32();
        var strip = manifest.ClearedStrip;
        Assert.InRange(spawnX, strip.X + 1, strip.X + strip.Width - 2);
        Assert.Equal(strip.Y + strip.Height, spawnY);
        Assert.Equal(new VanillaContentRef(1), generated.World.Tiles[spawnX, spawnY].Block);
        for (var x = strip.X; x < strip.X + strip.Width; x++)
        {
            for (var y = spawnY - 3; y < spawnY; y++)
            {
                Assert.Null(generated.World.Tiles[x, y].Block);
            }
        }

        // Every default observation fits in view above the continuous walking floor.
        Assert.All(manifest.Cases, entry => Assert.InRange(spawnY - entry.Y, 3, 30));
        Assert.Equal(source.World.Metadata.GameMode, generated.World.Metadata.GameMode);
        var powers = Assert.IsType<CreativePowersSection>(Assert.Single(generated.World.Entities,
            section => section.Section == "CreativePowers").Data);
        Assert.True(Assert.Single(powers.Entries, power => power.PowerId == 0).BooleanValue);
        Assert.Equal(source.OpaqueSections.Select(section => section.Name), generated.OpaqueSections.Select(section => section.Name));
        for (var section = 0; section < source.OpaqueSections.Count; section++)
        {
            if (source.OpaqueSections[section].Name == "CreativePowers")
            {
                var originalPowers = Assert.IsType<CreativePowersSection>(Assert.Single(source.World.Entities,
                    entry => entry.Section == "CreativePowers").Data);
                Assert.Equal(originalPowers.Entries.Select(power => power.PowerId == 0
                    ? power with { BooleanValue = true } : power), powers.Entries);
            }
            else
            {
                Assert.True(source.OpaqueSections[section].Bytes.Span.SequenceEqual(generated.OpaqueSections[section].Bytes.Span));
            }
        }
    }
}
