using System.Reflection;
using System.Runtime.CompilerServices;
using static Terraria.WorldCodec.Tests.TileAssert;

namespace Terraria.WorldCodec.Tests;

/// <summary><see cref="WorldReader.Read"/> as a whole: header, metadata, skipped sections and model immutability.</summary>
public class WorldReaderWorldTests
{
    private static readonly byte[] TwoByFourTiles = Hex("42 01 03  00  48 ff 02");

    [Fact]
    public void Read_SyntheticWorld_ReturnsHeaderAndMetadataOfTheFile()
    {
        var (file, _) = SyntheticTileWorld.Build(2, 4, TwoByFourTiles);
        using var stream = new MemoryStream(file);
        var header = WorldReader.ReadHeader(stream);
        var metadata = WorldReader.ReadMetadata(stream, header, WorldReader.ReadSectionTable(stream, header));

        var world = SyntheticTileWorld.Read(file);

        Assert.Equal(header, world.Header);
        Assert.Equal(metadata, world.Metadata);
        Assert.Equal(metadata.Width, world.Tiles.Width);
        Assert.Equal(metadata.Height, world.Tiles.Height);
    }

    [Fact]
    public void Read_SyntheticWorld_ReportsEverySectionAfterTilesAsSkipped()
    {
        var (file, _) = SyntheticTileWorld.Build(2, 4, TwoByFourTiles);
        using var stream = new MemoryStream(file);
        var table = WorldReader.ReadSectionTable(stream, WorldReader.ReadHeader(stream));
        SkippedSection[] expected =
        [
            new(nameof(WorldSectionTable.Chests), table.Chests),
            new(nameof(WorldSectionTable.Signs), table.Signs),
            new(nameof(WorldSectionTable.NpcsAndMobs), table.NpcsAndMobs),
            new(nameof(WorldSectionTable.TileEntities), table.TileEntities),
            new(nameof(WorldSectionTable.WeightedPressurePlates), table.WeightedPressurePlates),
            new(nameof(WorldSectionTable.TownManager), table.TownManager),
            new(nameof(WorldSectionTable.Bestiary), table.Bestiary),
            new(nameof(WorldSectionTable.CreativePowers), table.CreativePowers),
            new(nameof(WorldSectionTable.Footer), table.Footer),
        ];

        var world = SyntheticTileWorld.Read(file);

        Assert.Equal(expected, world.SkippedSections);
    }

    [Fact]
    public void Read_RunLengthRepeatedTiles_AreEqualValues()
    {
        var world = SyntheticTileWorld.Read(SyntheticTileWorld.Build(2, 4, TwoByFourTiles).File);

        var first = world.Tiles[0, 0];
        Assert.All(Enumerable.Range(1, 3), y => Assert.Equal(first, world.Tiles[0, y]));
    }

    public static TheoryData<string> ModelTypeNames() =>
    [
        nameof(Tile),
        nameof(TileLiquid),
        nameof(TileGrid),
        nameof(ContentRef),
        nameof(VanillaContentRef),
        nameof(ModContentRef),
        nameof(UnknownContentRef),
        nameof(World),
        nameof(SkippedSection),
    ];

    /// <summary>Tiles repeated by a run may be shared, so no model type may expose mutable state.</summary>
    [Theory]
    [MemberData(nameof(ModelTypeNames))]
    public void ModelType_PublicSurface_IsImmutable(string typeName)
    {
        var type = typeof(World).Assembly.GetType($"{typeof(World).Namespace}.{typeName}", throwOnError: true)!;

        Assert.Empty(type.GetFields(BindingFlags.Public | BindingFlags.Instance));
        Assert.All(
            type.GetProperties(BindingFlags.Public | BindingFlags.Instance),
            property => Assert.False(IsPubliclyMutable(property), $"{typeName}.{property.Name} has a public setter"));
    }

    private static bool IsPubliclyMutable(PropertyInfo property) =>
        property.SetMethod is { IsPublic: true } setter
        && !setter.ReturnParameter.GetRequiredCustomModifiers().Contains(typeof(IsExternalInit));
}
