using System.Buffers.Binary;
using System.Text;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// <see cref="WorldReader.ReadForSave"/> (docs/file-format/writer.md, "Footer (M2)" and "Layout produced"):
/// every byte M1 does not model is retained, and the footer is validated against the metadata.
/// </summary>
public class WorldEnvelopeTests
{
    private const string SyntheticName = "Synthetic";
    private const int SyntheticWorldId = 1743427911;

    private static readonly string[] OpaqueNames =
    [
        nameof(WorldSectionTable.Chests),
        nameof(WorldSectionTable.Signs),
        nameof(WorldSectionTable.NpcsAndMobs),
        nameof(WorldSectionTable.TileEntities),
        nameof(WorldSectionTable.WeightedPressurePlates),
        nameof(WorldSectionTable.TownManager),
        nameof(WorldSectionTable.Bestiary),
        nameof(WorldSectionTable.CreativePowers),
    ];

    public static TheoryData<string> CorpusWorlds() => ["SCCO1.wld", "SCCR2.wld", "SECR1.wld", "SJCO1.wld", "SMCO1.wld"];

    [Fact]
    public void ReadForSave_SyntheticWorld_RetainsEveryOpaqueSectionAsSeparateExactSlice()
    {
        var sections = SentinelSections();
        var file = Build(sections, Footer(SyntheticName, SyntheticWorldId));

        var envelope = ReadForSave(file);

        Assert.Equal(OpaqueNames, envelope.OpaqueSections.Select(section => section.Name));
        for (var index = 0; index < sections.Length; index++)
        {
            Assert.Equal(sections[index], envelope.OpaqueSections[index].Bytes.ToArray());
        }
    }

    [Fact]
    public void ReadForSave_SyntheticWorld_RetainsFileHeaderMetadataAndFooterSlices()
    {
        var file = Build(SentinelSections(), Footer(SyntheticName, SyntheticWorldId));
        var table = ReadTable(file);

        var envelope = ReadForSave(file);

        Assert.Equal(table, envelope.Table);
        Assert.Equal(Slice(file, table.FileHeader), envelope.FileHeaderBytes.ToArray());
        Assert.Equal(Slice(file, table.Metadata), envelope.MetadataBytes.ToArray());
        Assert.Equal(Slice(file, table.Footer), envelope.FooterBytes.ToArray());
    }

    [Fact]
    public void ReadForSave_SyntheticWorld_KeepsMetadataBytesOfFieldsM1OnlyConsumes()
    {
        var metadata = new SyntheticMetadata { KillCounts = [3, 1, 4], Manifest = "{\"passes\":[\"Terrain\",\"Dunes\",\"Corruption\"]}" };
        var file = Build(SentinelSections(), Footer(SyntheticName, SyntheticWorldId), metadata);

        var envelope = ReadForSave(file);

        Assert.Equal(metadata.Build().Bytes, envelope.MetadataBytes.ToArray());
    }

    [Fact]
    public void ReadForSave_SyntheticWorld_ReturnsSameWorldAsRead()
    {
        var file = Build(SentinelSections(), Footer(SyntheticName, SyntheticWorldId));

        var envelope = ReadForSave(file);
        var world = SyntheticTileWorld.Read(file);

        Assert.Equal(world.Header, envelope.World.Header);
        Assert.Equal(world.Metadata, envelope.World.Metadata);
        Assert.Equal(world.SkippedSections, envelope.World.SkippedSections);
        Assert.Equal(world.Tiles.Width, envelope.World.Tiles.Width);
        Assert.Equal(world.Tiles.Height, envelope.World.Tiles.Height);
        for (var x = 0; x < world.Tiles.Width; x++)
        {
            for (var y = 0; y < world.Tiles.Height; y++)
            {
                Assert.Equal(world.Tiles[x, y], envelope.World.Tiles[x, y]);
            }
        }
    }

    [Fact]
    public void ReadForSave_ClosedAndMutatedSource_EnvelopeStaysIntact()
    {
        var file = Build(SentinelSections(), Footer(SyntheticName, SyntheticWorldId));
        var expectedSections = SentinelSections();
        var expectedFooter = Footer(SyntheticName, SyntheticWorldId);
        WorldEnvelope envelope;
        using (var stream = new MemoryStream(file))
        {
            envelope = WorldReader.ReadForSave(stream);
        }

        Array.Clear(file);

        Assert.Equal(expectedSections[0], envelope.OpaqueSections[0].Bytes.ToArray());
        Assert.Equal(expectedSections[7], envelope.OpaqueSections[7].Bytes.ToArray());
        Assert.Equal(expectedFooter, envelope.FooterBytes.ToArray());
        Assert.NotEqual(0, envelope.MetadataBytes.Length);
    }

    [Fact]
    public void ReadForSave_FileOnDisk_StaysUsableAfterTheFileIsDeleted()
    {
        var file = Build(SentinelSections(), Footer(SyntheticName, SyntheticWorldId));
        var path = Path.Combine(Path.GetTempPath(), $"envelope-{Guid.NewGuid():N}.wld");
        File.WriteAllBytes(path, file);
        WorldEnvelope envelope;
        using (var stream = File.OpenRead(path))
        {
            envelope = WorldReader.ReadForSave(stream);
        }

        File.Delete(path);

        Assert.Equal(SentinelSections()[3], envelope.OpaqueSections[3].Bytes.ToArray());
        Assert.Equal(Footer(SyntheticName, SyntheticWorldId), envelope.FooterBytes.ToArray());
    }

    [Fact]
    public void ReadForSave_NonSeekableStream_ThrowsArgumentException()
    {
        using var stream = new NonSeekableStream(Build(SentinelSections(), Footer(SyntheticName, SyntheticWorldId)));

        Assert.Throws<ArgumentException>("stream", () => WorldReader.ReadForSave(stream));
    }

    [Fact]
    public void ReadForSave_ValidFooterWithMultiByteName_IsAccepted()
    {
        const string Name = "Wörld ☃";
        var file = Build(SentinelSections(), Footer(Name, SyntheticWorldId), new SyntheticMetadata { Name = Name });

        var envelope = ReadForSave(file);

        Assert.Equal(Footer(Name, SyntheticWorldId), envelope.FooterBytes.ToArray());
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    public void ReadForSave_FooterMarkerNotOne_ThrowsMalformedFooterAtMarker(byte marker)
    {
        var footer = Footer(SyntheticName, SyntheticWorldId);
        footer[0] = marker;
        var file = Build(SentinelSections(), footer);

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        AssertError(error, WorldFormatError.MalformedFooter, FooterStart(file), "invalid marker");
    }

    [Fact]
    public void ReadForSave_FooterNameLengthRunsPastFileEnd_ThrowsTruncatedAtNamePrefix()
    {
        var footer = Footer(SyntheticName, SyntheticWorldId);
        footer[1] = (byte)(footer[1] + 1);
        var file = Build(SentinelSections(), footer);

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        AssertError(error, WorldFormatError.MalformedFooter, FooterStart(file) + 1, "truncated");
    }

    [Fact]
    public void ReadForSave_FooterMissingWorldIdByte_ThrowsTruncatedAtNamePrefix()
    {
        var footer = Footer(SyntheticName, SyntheticWorldId)[..^1];
        var file = Build(SentinelSections(), footer);

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        AssertError(error, WorldFormatError.MalformedFooter, FooterStart(file) + 1, "truncated");
    }

    [Fact]
    public void ReadForSave_FooterNameWithInvalidUtf8_ThrowsInvalidNameAtNamePrefix()
    {
        var footer = Footer(SyntheticName, SyntheticWorldId);
        footer[2] = 0xFF;
        var file = Build(SentinelSections(), footer);

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        AssertError(error, WorldFormatError.MalformedFooter, FooterStart(file) + 1, "invalid name");
    }

    [Fact]
    public void ReadForSave_FooterNameLengthPrefixOverlong_ThrowsInvalidNameAtNamePrefix()
    {
        var footer = Hex("01 ff ff ff ff ff").Concat(new byte[4]).ToArray();
        var file = Build(SentinelSections(), footer);

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        AssertError(error, WorldFormatError.MalformedFooter, FooterStart(file) + 1, "invalid name");
    }

    [Fact]
    public void ReadForSave_FooterNameLengthAboveInt32Max_ThrowsInvalidNameAtNamePrefix()
    {
        // 80 80 80 80 08 encodes 2^31, one above the largest String length.
        var footer = Hex("01 80 80 80 80 08").Concat(new byte[4]).ToArray();
        var file = Build(SentinelSections(), footer);

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        AssertError(error, WorldFormatError.MalformedFooter, FooterStart(file) + 1, "invalid name");
    }

    [Fact]
    public void ReadForSave_FooterNameLengthAboveInt32MaxWithBadMarker_ThrowsInvalidMarkerAtMarker()
    {
        var footer = Hex("00 80 80 80 80 08").Concat(new byte[4]).ToArray();
        var file = Build(SentinelSections(), footer);

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        AssertError(error, WorldFormatError.MalformedFooter, FooterStart(file), "invalid marker");
    }

    [Fact]
    public void ReadForSave_FooterNameDiffersFromMetadata_ThrowsInconsistentFooterNameAtNamePrefix()
    {
        var file = Build(SentinelSections(), Footer("Synthetid", SyntheticWorldId));

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        AssertError(error, WorldFormatError.InconsistentFooter, FooterStart(file) + 1, field: "name");
    }

    [Fact]
    public void ReadForSave_FooterWorldIdDiffersFromMetadata_ThrowsInconsistentFooterWorldIdAtIdOffset()
    {
        var file = Build(SentinelSections(), Footer(SyntheticName, SyntheticWorldId + 1));

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        AssertError(error, WorldFormatError.InconsistentFooter, FooterStart(file) + 2 + SyntheticName.Length, field: "worldId");
    }

    [Fact]
    public void ReadForSave_NameAndWorldIdBothDiffer_NameWins()
    {
        var file = Build(SentinelSections(), Footer("Other", SyntheticWorldId + 1));

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        Assert.Equal(WorldFormatError.InconsistentFooter, error.Error);
        Assert.Equal("name", error.Field);
    }

    [Fact]
    public void ReadForSave_TrailingBytesAfterWorldId_ThrowsMalformedFooterAtFirstTrailingByte()
    {
        var footer = Footer(SyntheticName, SyntheticWorldId).Concat(Hex("00 01")).ToArray();
        var file = Build(SentinelSections(), footer);

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        AssertError(error, WorldFormatError.MalformedFooter, FooterStart(file) + 2 + SyntheticName.Length + 4, "trailing bytes");
    }

    [Fact]
    public void ReadForSave_MarkerAndNameBothWrong_MarkerWins()
    {
        var footer = Footer("Other", SyntheticWorldId);
        footer[0] = 0;
        var file = Build(SentinelSections(), footer);

        var error = Assert.Throws<WorldFormatException>(() => ReadForSave(file));

        Assert.Equal(WorldFormatError.MalformedFooter, error.Error);
        Assert.Equal("invalid marker", error.Reason);
    }

    [Fact]
    public void Read_SyntheticWorldWithInvalidFooter_StillSucceedsAsInM1()
    {
        var file = Build(SentinelSections(), Footer("Other", 1));

        var world = SyntheticTileWorld.Read(file);

        Assert.Equal(nameof(WorldSectionTable.Footer), world.SkippedSections[^1].Name);
    }

    [Theory]
    [MemberData(nameof(CorpusWorlds))]
    public void ReadForSave_CorpusWorld_SlicesMatchTheOriginalSectionBoundaries(string file)
    {
        var bytes = File.ReadAllBytes(WorldPath(file));
        var table = ReadTable(bytes);

        var envelope = ReadForSave(bytes);

        Assert.Equal(table, envelope.Table);
        Assert.Equal(Slice(bytes, table.FileHeader), envelope.FileHeaderBytes.ToArray());
        Assert.Equal(Slice(bytes, table.Metadata), envelope.MetadataBytes.ToArray());
        WorldSectionBoundary[] expected =
        [
            table.Chests, table.Signs, table.NpcsAndMobs, table.TileEntities,
            table.WeightedPressurePlates, table.TownManager, table.Bestiary, table.CreativePowers,
        ];
        Assert.Equal(OpaqueNames, envelope.OpaqueSections.Select(section => section.Name));
        for (var index = 0; index < expected.Length; index++)
        {
            Assert.Equal(Slice(bytes, expected[index]), envelope.OpaqueSections[index].Bytes.ToArray());
        }

        Assert.Equal(Slice(bytes, table.Footer), envelope.FooterBytes.ToArray());
    }

    [Theory]
    [MemberData(nameof(CorpusWorlds))]
    public void ReadForSave_CorpusWorld_RetainedSlicesAndTileSectionCoverTheWholeFile(string file)
    {
        var bytes = File.ReadAllBytes(WorldPath(file));

        var envelope = ReadForSave(bytes);

        var covered = envelope.FileHeaderBytes.Length
            + envelope.MetadataBytes.Length
            + (envelope.Table.Tiles.End - envelope.Table.Tiles.Start)
            + envelope.OpaqueSections.Sum(section => (long)section.Bytes.Length)
            + envelope.FooterBytes.Length;
        Assert.Equal(bytes.LongLength, covered);
    }

    [Theory]
    [MemberData(nameof(CorpusWorlds))]
    public void ReadForSave_CorpusWorld_ModelEqualsPlainRead(string file)
    {
        var bytes = File.ReadAllBytes(WorldPath(file));
        using var stream = new MemoryStream(bytes);
        var world = WorldReader.Read(stream);

        var envelope = ReadForSave(bytes);

        Assert.Equal(world.Header, envelope.World.Header);
        Assert.Equal(world.Metadata, envelope.World.Metadata);
        Assert.Equal(world.SkippedSections, envelope.World.SkippedSections);
        Assert.Equal(world.Tiles.Width, envelope.World.Tiles.Width);
        Assert.Equal(world.Tiles.Height, envelope.World.Tiles.Height);
    }

    [Theory]
    [MemberData(nameof(CorpusWorlds))]
    public void ReadForSave_CorpusWorld_FooterIsMarkerNameAndWorldIdOfTheMetadata(string file)
    {
        var bytes = File.ReadAllBytes(WorldPath(file));

        var envelope = ReadForSave(bytes);

        var footer = envelope.FooterBytes.Span;
        Assert.Equal(11, footer.Length);
        Assert.Equal(1, footer[0]);
        Assert.Equal(envelope.World.Metadata.Name, Encoding.UTF8.GetString(footer.Slice(2, footer[1])));
        Assert.Equal(envelope.World.Metadata.WorldId, BinaryPrimitives.ReadInt32LittleEndian(footer[^4..]));
    }

    // Section payloads modelled on the real structures: counts first, then distinct sentinel bytes.
    private static byte[][] SentinelSections() =>
    [
        Hex("02 00  e0 01 5b 00  c0 e1 00 01 11 22"),
        Hex("00 00"),
        Hex("01 00 00 03 aa bb  fe"),
        Hex("00 00 00 00 01 02 03 04"),
        Hex("00 00 00 00"),
        Hex("01 02 00 00 00 77"),
        Hex("03 00 00 00 de ad be ef"),
        Hex("5a 5a 5a"),
    ];

    private static byte[] Hex(string hex) => Convert.FromHexString(hex.Replace(" ", string.Empty, StringComparison.Ordinal));

    private static byte[] Footer(string name, int worldId)
    {
        var nameBytes = Encoding.UTF8.GetBytes(name);
        var footer = new byte[2 + nameBytes.Length + 4];
        footer[0] = 1;
        footer[1] = (byte)nameBytes.Length;
        nameBytes.CopyTo(footer, 2);
        BinaryPrimitives.WriteInt32LittleEndian(footer.AsSpan(2 + nameBytes.Length), worldId);
        return footer;
    }

    /// <summary>A synthetic 2 × 4 world whose sections 3–10 and footer are the given bytes.</summary>
    private static byte[] Build(byte[][] sections, byte[] footer, SyntheticMetadata? metadata = null)
    {
        var (template, _) = SyntheticTileWorld.Build(2, 4, Hex("42 01 03  00  48 ff 02"), metadataSource: metadata);
        var pointers = new int[11];
        for (var index = 0; index < pointers.Length; index++)
        {
            pointers[index] = BinaryPrimitives.ReadInt32LittleEndian(template.AsSpan(26 + (4 * index)));
        }

        using var output = new MemoryStream();
        output.Write(template, 0, pointers[2]);
        for (var index = 0; index < sections.Length; index++)
        {
            output.Write(sections[index]);
            pointers[3 + index] = (int)output.Position;
        }

        output.Write(footer);
        var file = output.ToArray();
        for (var index = 3; index < pointers.Length; index++)
        {
            BinaryPrimitives.WriteInt32LittleEndian(file.AsSpan(26 + (4 * index)), pointers[index]);
        }

        return file;
    }

    private static int FooterStart(byte[] file) => BinaryPrimitives.ReadInt32LittleEndian(file.AsSpan(26 + (4 * 10)));

    private static WorldEnvelope ReadForSave(byte[] file)
    {
        using var stream = new MemoryStream(file);
        return WorldReader.ReadForSave(stream);
    }

    private static WorldSectionTable ReadTable(byte[] file)
    {
        using var stream = new MemoryStream(file);
        return WorldReader.ReadSectionTable(stream, WorldReader.ReadHeader(stream));
    }

    private static byte[] Slice(byte[] file, WorldSectionBoundary boundary) =>
        file.AsSpan((int)boundary.Start, (int)(boundary.End - boundary.Start)).ToArray();

    private static void AssertError(WorldFormatException error, WorldFormatError kind, long offset, string? reason = null, string? field = null)
    {
        Assert.Equal(kind, error.Error);
        Assert.Equal(offset, error.Offset);
        if (reason is not null)
        {
            Assert.Equal(reason, error.Reason);
        }

        if (field is not null)
        {
            Assert.Equal(field, error.Field);
        }
    }

    private static string WorldPath(string file)
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "packages", "test-fixtures", "worlds", file);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException($"packages/test-fixtures/worlds/{file} not found above the test assembly.");
    }

    private sealed class NonSeekableStream(byte[] bytes) : MemoryStream(bytes)
    {
        public override bool CanSeek => false;
    }
}
