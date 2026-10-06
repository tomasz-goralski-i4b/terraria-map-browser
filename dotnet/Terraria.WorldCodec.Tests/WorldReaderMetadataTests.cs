namespace Terraria.WorldCodec.Tests;

/// <summary>
/// World metadata contract from docs/file-format.md ("World metadata", vectors M1–M5).
/// All inputs are synthetic bytes built by <see cref="SyntheticMetadata"/>; no game worlds are used.
/// </summary>
public class WorldReaderMetadataTests
{
    private const string MetadataSection = "Metadata";

    private static WorldMetadata Read(byte[] file)
    {
        using var stream = new MemoryStream(file);
        var header = WorldReader.ReadHeader(stream);
        var table = WorldReader.ReadSectionTable(stream, header);
        return WorldReader.ReadMetadata(stream, header, table);
    }

    private static WorldMetadata Read(SyntheticMetadata metadata, int tileLength = 2) =>
        Read(SyntheticWorld.Build(metadata.Build().Bytes, tileLength));

    private static WorldFormatException ReadExpectingError(byte[] file) =>
        Assert.Throws<WorldFormatException>(() => Read(file));

    private static void AssertMetadataError(WorldFormatException error, long offset, string? field)
    {
        Assert.Equal(WorldFormatError.MalformedMetadata, error.Error);
        Assert.Equal(MetadataSection, error.Section);
        Assert.Equal(offset, error.Offset);
        if (field is not null)
        {
            Assert.Equal(field, error.Field);
        }
    }

    private static int FieldOffset(SyntheticMetadata metadata, string field) =>
        SyntheticWorld.MetadataStart + metadata.Build().Offsets[field];

    [Fact]
    public void ReadMetadata_SupportedLayout_ReturnsEveryExposedField()
    {
        var metadata = new SyntheticMetadata { Name = "SCCR1", WorldId = 1743427911, Width = 2, Height = 4 };

        var result = Read(metadata);

        Assert.Equal(
            new WorldMetadata(
                "SCCR1",
                "948580918",
                "87e466e7853c3f48b75abc85e36d4b86",
                1743427911,
                2,
                4,
                WorldGameMode.Classic,
                WorldEvil.Corruption),
            result);
    }

    public static TheoryData<string, string> UnicodeNamesAndSeeds() => new()
    {
        { "Wörld ⛏ 世界 🌍", "🌍 not the bees" },
        { string.Empty, string.Empty },
        { new string('ż', 200), "05162020" },
        { "tab\tand\u0000nul", "seed with spaces" },
    };

    [Theory]
    [MemberData(nameof(UnicodeNamesAndSeeds))]
    public void ReadMetadata_UnicodeNameAndSeed_ReturnsExactStrings(string name, string seed)
    {
        var result = Read(new SyntheticMetadata { Name = name, Seed = seed });

        Assert.Equal(name, result.Name);
        Assert.Equal(seed, result.Seed);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(int.MaxValue)]
    [InlineData(int.MinValue)]
    public void ReadMetadata_WorldId_ReturnsValueAsRead(int worldId)
    {
        var result = Read(new SyntheticMetadata { WorldId = worldId });

        Assert.Equal(worldId, result.WorldId);
    }

    [Fact]
    public void ReadMetadata_Guid_ReturnsLowerCaseHexInFileByteOrder()
    {
        var guid = Convert.FromHexString("00112233445566778899AABBCCDDEEFF");

        var result = Read(new SyntheticMetadata { Guid = guid });

        Assert.Equal("00112233445566778899aabbccddeeff", result.GuidHex);
    }

    [Theory]
    [InlineData(0, WorldGameMode.Classic)]
    [InlineData(1, WorldGameMode.Expert)]
    [InlineData(2, WorldGameMode.Master)]
    [InlineData(3, WorldGameMode.Journey)]
    [InlineData(7, (WorldGameMode)7)]
    [InlineData(-1, (WorldGameMode)(-1))]
    public void ReadMetadata_GameMode_ReturnsKnownModesAndKeepsUnknownRaw(int raw, WorldGameMode expected)
    {
        var result = Read(new SyntheticMetadata { GameMode = raw });

        Assert.Equal(expected, result.GameMode);
    }

    [Theory]
    [InlineData(0, WorldEvil.Corruption)]
    [InlineData(1, WorldEvil.Crimson)]
    public void ReadMetadata_CrimsonFlag_ReturnsEvil(byte crimson, WorldEvil expected)
    {
        var result = Read(new SyntheticMetadata { Crimson = crimson, GameMode = 0 });

        Assert.Equal(expected, result.Evil);
        Assert.Equal(WorldGameMode.Classic, result.GameMode);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(0xFF)]
    public void ReadMetadata_InvalidCrimsonBoolean_ThrowsMalformedMetadataAtField(byte crimson)
    {
        var metadata = new SyntheticMetadata { Crimson = crimson };

        var error = ReadExpectingError(SyntheticWorld.Build(metadata.Build().Bytes, 2));

        AssertMetadataError(error, FieldOffset(metadata, "crimson"), "crimson");
    }

    [Fact]
    public void ReadMetadata_InvalidConsumedBoolean_ThrowsMalformedMetadataAtField()
    {
        var metadata = new SyntheticMetadata { DayTime = 2 };

        var error = ReadExpectingError(SyntheticWorld.Build(metadata.Build().Bytes, 2));

        AssertMetadataError(error, FieldOffset(metadata, "dayTime"), field: null);
    }

    [Theory]
    [InlineData(4, 2)]
    [InlineData(1, 1)]
    [InlineData(1200, 4200)]
    public void ReadMetadata_DimensionsVectorM1_ReadsHeightBeforeWidth(int height, int width)
    {
        var result = Read(new SyntheticMetadata { Height = height, Width = width }, tileLength: width);

        Assert.Equal(height, result.Height);
        Assert.Equal(width, result.Width);
    }

    [Theory]
    [InlineData(65_536, 4_096)]
    [InlineData(4_096, 65_536)]
    [InlineData(16_384, 16_384)]
    public void ReadMetadata_HighestLegalDimensions_PassValidation(int width, int height)
    {
        Assert.Equal(WorldReader.MaxWorldTileCount, (long)width * height);

        var result = Read(new SyntheticMetadata { Width = width, Height = height }, tileLength: width);

        Assert.Equal(width, result.Width);
        Assert.Equal(height, result.Height);
    }

    [Theory]
    [InlineData(2, 0, "height")]
    [InlineData(2, -1, "height")]
    [InlineData(2, int.MinValue, "height")]
    [InlineData(0, 4, "width")]
    [InlineData(-1, 4, "width")]
    [InlineData(int.MinValue, 4, "width")]
    [InlineData(65_537, 4, "width")]
    [InlineData(2, 65_537, "height")]
    [InlineData(int.MaxValue, 4, "width")]
    [InlineData(2, int.MaxValue, "height")]
    [InlineData(65_536, 65_536, "width")]
    [InlineData(32_768, 8_193, "width")]
    [InlineData(16_385, 16_384, "width")]
    [InlineData(16_384, 16_385, "width")]
    public void ReadMetadata_IllegalDimensions_RejectsBeforeAllocation(int width, int height, string field)
    {
        var metadata = new SyntheticMetadata { Width = width, Height = height };
        var file = SyntheticWorld.Build(metadata.Build().Bytes, tileLength: Math.Clamp(width, 2, 65_536));
        using var stream = new MemoryStream(file);
        var header = WorldReader.ReadHeader(stream);
        var table = WorldReader.ReadSectionTable(stream, header);

        var before = GC.GetAllocatedBytesForCurrentThread();
        var error = Assert.Throws<WorldFormatException>(() => WorldReader.ReadMetadata(stream, header, table));
        var allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        AssertMetadataError(error, FieldOffset(metadata, field), field);
        Assert.InRange(allocated, 0, 1 << 20);
    }

    [Theory]
    [InlineData(2, 0, "height")]
    [InlineData(2, 65_537, "height")]
    [InlineData(65_537, 4, "width")]
    [InlineData(65_536, 65_536, "width")]
    public void ReadMetadata_LargeSectionWithIllegalDimensions_RejectsBeforeReadingSection(int width, int height, string field)
    {
        // Review regression: a 256 MiB declared section must not be buffered before the dimensions are checked.
        const int DeclaredMetadataLength = 256 << 20;
        var metadata = new SyntheticMetadata { Width = width, Height = height };
        using var stream = VirtualWorldStream.WithMetadataSection(metadata.Build().Bytes, DeclaredMetadataLength);
        var header = WorldReader.ReadHeader(stream);
        var table = WorldReader.ReadSectionTable(stream, header);
        Assert.Equal(DeclaredMetadataLength, table.Metadata.End - table.Metadata.Start);
        var readBefore = stream.BytesRead;

        var before = GC.GetAllocatedBytesForCurrentThread();
        var error = Assert.Throws<WorldFormatException>(() => WorldReader.ReadMetadata(stream, header, table));
        var allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        AssertMetadataError(error, FieldOffset(metadata, field), field);
        Assert.InRange(allocated, 0, 1 << 20);
        Assert.InRange(stream.BytesRead - readBefore, 0, 64 << 10);
    }

    [Fact]
    public void ReadMetadata_WidthBeyondTileSectionLength_ThrowsAtWidth()
    {
        var metadata = new SyntheticMetadata { Width = 10, Height = 4 };

        var error = ReadExpectingError(SyntheticWorld.Build(metadata.Build().Bytes, tileLength: 9));

        AssertMetadataError(error, FieldOffset(metadata, "width"), "width");
    }

    [Fact]
    public void ReadMetadata_RichLists_StopsExactlyAtTileSection()
    {
        var metadata = new SyntheticMetadata
        {
            AnglerFinishers = ["Ålice", "Bob", new string('x', 300)],
            KillCounts = [.. Enumerable.Range(1, 293)],
            ClaimableBanners = [.. Enumerable.Range(0, 289).Select(i => (ushort)(i * 7))],
            PartyingNpcs = [17, 18, 19],
            TreeTopVariations = [.. Enumerable.Range(0, 13)],
            TeamSpawns = [(10, 20), (-1, short.MaxValue)],
            Manifest = new string('{', 9491),
        };
        var file = SyntheticWorld.Build(metadata.Build().Bytes, tileLength: 2);
        using var stream = new MemoryStream(file);
        var header = WorldReader.ReadHeader(stream);
        var table = WorldReader.ReadSectionTable(stream, header);

        var result = WorldReader.ReadMetadata(stream, header, table);

        Assert.Equal(table.Tiles.Start, stream.Position);
        Assert.Equal(table.Metadata.End, stream.Position);
        Assert.Equal("Synthetic", result.Name);
        Assert.Equal(2, result.Width);
    }

    public static TheoryData<string, int> TruncatedFields() => new()
    {
        { "name", 0 },
        { "name", 1 },
        { "seed", 0 },
        { "seed", 3 },
        { "worldGenVersion", 7 },
        { "guid", 15 },
        { "worldId", 0 },
        { "worldId", 3 },
        { "height", 2 },
        { "width", 1 },
        { "gameMode", 3 },
        { "crimson", 0 },
        { "anglerFinishers", 2 },
        { "killCounts", 1 },
        { "worldGenManifest", 0 },
        { "worldGenManifest", 1 },
    };

    [Theory]
    [MemberData(nameof(TruncatedFields))]
    public void ReadMetadata_SectionEndsInsideField_ThrowsAtFieldWithSectionName(string field, int bytesOfField)
    {
        var metadata = new SyntheticMetadata();
        var (bytes, offsets) = metadata.Build();
        var cut = bytes.AsSpan(0, offsets[field] + bytesOfField).ToArray();

        var error = ReadExpectingError(SyntheticWorld.Build(cut, tileLength: 64));

        AssertMetadataError(error, SyntheticWorld.MetadataStart + offsets[field], field);
    }

    [Fact]
    public void ReadMetadata_UnreadBytesBeforeTileSection_ThrowsAtEndOfManifest()
    {
        var (bytes, _) = new SyntheticMetadata().Build();

        var error = ReadExpectingError(SyntheticWorld.Build([.. bytes, 0x00], tileLength: 2));

        AssertMetadataError(error, SyntheticWorld.MetadataStart + bytes.Length, field: null);
    }

    [Theory]
    [InlineData("ffffffff0f")]
    [InlineData("ffffffff7f")]
    [InlineData("8080808080")]
    [InlineData("8080808001")]
    public void ReadMetadata_InvalidNameLengthPrefix_ThrowsAtName(string prefixHex)
    {
        var metadata = new SyntheticMetadata { RawName = Convert.FromHexString(prefixHex) };

        var error = ReadExpectingError(SyntheticWorld.Build(metadata.Build().Bytes, tileLength: 2));

        AssertMetadataError(error, SyntheticWorld.MetadataStart, "name");
    }

    [Theory]
    [InlineData("02c328")]
    [InlineData("01ff")]
    [InlineData("03eda080")]
    public void ReadMetadata_InvalidUtf8Name_ThrowsAtName(string rawHex)
    {
        var metadata = new SyntheticMetadata { RawName = Convert.FromHexString(rawHex) };

        var error = ReadExpectingError(SyntheticWorld.Build(metadata.Build().Bytes, tileLength: 2));

        AssertMetadataError(error, SyntheticWorld.MetadataStart, "name");
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(int.MaxValue)]
    public void ReadMetadata_AnglerFinisherCountOutsideSection_RejectsBeforeAllocation(int count)
    {
        AssertListCountRejected(new SyntheticMetadata { AnglerFinisherCount = count }, "anglerFinishers");
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(short.MaxValue)]
    public void ReadMetadata_KillCountCountOutsideSection_RejectsBeforeAllocation(short count)
    {
        AssertListCountRejected(new SyntheticMetadata { KillCountCount = count }, "killCounts");
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(int.MaxValue)]
    public void ReadMetadata_TreeTopVariationCountOutsideSection_RejectsBeforeAllocation(int count)
    {
        AssertListCountRejected(new SyntheticMetadata { TreeTopVariationCount = count }, "treeTopVariations");
    }

    private static void AssertListCountRejected(SyntheticMetadata metadata, string field)
    {
        var file = SyntheticWorld.Build(metadata.Build().Bytes, tileLength: 2);
        using var stream = new MemoryStream(file);
        var header = WorldReader.ReadHeader(stream);
        var table = WorldReader.ReadSectionTable(stream, header);

        var before = GC.GetAllocatedBytesForCurrentThread();
        var error = Assert.Throws<WorldFormatException>(() => WorldReader.ReadMetadata(stream, header, table));
        var allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        AssertMetadataError(error, FieldOffset(metadata, field), field);
        Assert.InRange(allocated, 0, 1 << 20);
    }
}
