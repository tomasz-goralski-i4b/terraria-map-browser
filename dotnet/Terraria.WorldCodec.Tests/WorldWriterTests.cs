using System.Buffers.Binary;
using System.Text;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// <see cref="WorldWriter"/> (docs/file-format/writer.md, "Layout produced", "Header rules", "Metadata, sections 3–10 and
/// the footer", "Evidence: original vs candidate layout"): pointers are regenerated from the emitted lengths, every
/// other section is copied verbatim and moves with the tile section.
/// </summary>
public class WorldWriterTests
{
    private const string Name = "Synthetic";
    private const int WorldId = 1743427911;
    private const int HeaderPointerTable = 26;
    private const int SectionCount = 11;

    // Four equal stone records and four empty records, all noncanonical.
    private static readonly byte[] ShrinkingTiles = Hex("02 01 02 01 02 01 02 01  00 00 00 00");
    private static readonly byte[] ShrinkingTilesCanonical = Hex("42 01 03  40 03");

    // Food platter (520) with a run of 1 is split by the writer (W-T7.3): 8 bytes become 14.
    private static readonly byte[] GrowingTiles = Hex("62 08 02 00 00 00 00 01");
    private static readonly byte[] GrowingTilesCanonical = Hex("22 08 02 00 00 00 00  22 08 02 00 00 00 00");

    public static TheoryData<string> CorpusWorlds() => ["SCCO1.wld", "SCCR2.wld", "SECR1.wld", "SJCO1.wld", "SMCO1.wld"];

    [Theory]
    [MemberData(nameof(CorpusWorlds))]
    public void Write_UnchangedCorpusWorld_IsByteIdenticalToTheSource(string file)
    {
        var source = File.ReadAllBytes(WorldPath(file));

        var written = Write(ReadForSave(source));

        Assert.True(source.AsSpan().SequenceEqual(written), $"{file}: output differs from the source");
    }

    [Fact]
    public void Write_CanonicalSyntheticWorld_IsByteIdenticalToTheSource()
    {
        var file = Build(2, 4, ShrinkingTilesCanonical);

        Assert.Equal(file, Write(ReadForSave(file)));
    }

    [Fact]
    public void Write_ShrinkingTileSection_RegeneratesPointersAndRelocatesTheOpaqueSpans()
    {
        var source = Build(2, 4, ShrinkingTiles);
        var expected = Build(2, 4, ShrinkingTilesCanonical);

        var written = Write(ReadForSave(source));

        Assert.Equal(expected, written);
        Assert.Equal(Pointers(source).Skip(2).Select(pointer => pointer - 5), Pointers(written).Skip(2));
        Assert.Equal(Pointers(source).Take(2), Pointers(written).Take(2));
    }

    [Fact]
    public void Write_GrowingTileSection_RegeneratesPointersAndRelocatesTheOpaqueSpans()
    {
        var source = Build(1, 2, GrowingTiles, frameImportant: [520]);
        var expected = Build(1, 2, GrowingTilesCanonical, frameImportant: [520]);

        var written = Write(ReadForSave(source));

        Assert.Equal(expected, written);
        Assert.Equal(Pointers(source).Skip(2).Select(pointer => pointer + 6), Pointers(written).Skip(2));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Write_RelocatedWorld_MetadataSectionsAndFooterMatchTheInputByteForByte(bool growing)
    {
        var source = growing ? Build(1, 2, GrowingTiles, frameImportant: [520]) : Build(2, 4, ShrinkingTiles);
        var before = ReadForSave(source);

        var after = ReadForSave(Write(before));

        Assert.NotEqual(before.Table.Footer.Start, after.Table.Footer.Start);
        Assert.Equal(before.MetadataBytes.ToArray(), after.MetadataBytes.ToArray());
        Assert.Equal(before.FileHeaderBytes.Length, after.FileHeaderBytes.Length);
        Assert.Equal(before.FooterBytes.ToArray(), after.FooterBytes.ToArray());
        Assert.Equal(before.OpaqueSections.Select(section => section.Name), after.OpaqueSections.Select(section => section.Name));
        for (var index = 0; index < before.OpaqueSections.Count; index++)
        {
            Assert.Equal(before.OpaqueSections[index].Bytes.ToArray(), after.OpaqueSections[index].Bytes.ToArray());
        }
    }

    [Fact]
    public void Write_WorldWithConsumedOnlyMetadataFields_KeepsEveryMetadataByte()
    {
        var metadata = new SyntheticMetadata { KillCounts = [3, 1, 4], Manifest = "{\"passes\":[\"Terrain\",\"Dunes\"]}" };
        var source = Build(2, 4, ShrinkingTiles, metadata: metadata);

        var written = Write(ReadForSave(source));

        Assert.Equal(metadata.Build().Bytes, ReadForSave(written).MetadataBytes.ToArray());
    }

    [Fact]
    public void Write_ReservedHeaderFlagsAndRevision_AreCopiedAsRead()
    {
        const uint Revision = 0xFFFF_FFFE;
        const ulong Flags = 0xA5A5_0000_0000_0001;
        var source = Build(2, 4, ShrinkingTiles, revision: Revision, flags: Flags);

        var written = Write(ReadForSave(source));

        Assert.Equal(Revision, BinaryPrimitives.ReadUInt32LittleEndian(written.AsSpan(12)));
        Assert.Equal(Flags, BinaryPrimitives.ReadUInt64LittleEndian(written.AsSpan(16)));
        var header = ReadForSave(written).World.Header;
        Assert.Equal(Revision, header.Revision);
        Assert.Equal(Flags, header.Flags);
    }

    [Fact]
    public void Write_FixedHeaderFields_AreVersionSignatureFileTypeAndSectionCount()
    {
        var written = Write(ReadForSave(Build(2, 4, ShrinkingTiles)));

        Assert.Equal(Hex("46 01 00 00").Concat(Encoding.ASCII.GetBytes("relogic")).Append((byte)2), written.Take(12));
        Assert.Equal(Hex("0b 00"), written.Skip(24).Take(2));
    }

    [Fact]
    public void Write_FrameImportantBitsIncludingUnusedHighBits_AreCopiedVerbatim()
    {
        // k = 10 uses 2 bytes; bits 10..15 of the second byte are unused and set here.
        var source = Build(2, 4, ShrinkingTiles, frameCount: 10, frameImportant: [4, 5]);
        source[73] |= 0xFC;

        var written = Write(ReadForSave(source));

        Assert.Equal(source.Take(HeaderPointerTable).ToArray(), written.Take(HeaderPointerTable).ToArray());
        Assert.Equal(source.Skip(70).Take(4).ToArray(), written.Skip(70).Take(4).ToArray());
        Assert.Equal(Pointers(source)[0], Pointers(written)[0]);
    }

    [Fact]
    public void Write_FrameImportantSetOfTheFile_DecidesWhichBlocksCarryFrames()
    {
        // Block 4 is frame-important in this file only; a per-version table would write no frames for it.
        var source = Build(1, 1, Hex("02 04 05 00 06 00"), frameImportant: [4]);

        var written = Write(ReadForSave(source));

        Assert.Equal(source, written);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Write_ThenRead_ReturnsIdenticalMetadataAndEveryTileField(bool growing)
    {
        var source = growing ? Build(1, 2, GrowingTiles, frameImportant: [520]) : Build(2, 4, ShrinkingTiles);
        var before = ReadForSave(source).World;

        var after = ReadForSave(Write(ReadForSave(source))).World;

        Assert.Equal(before.Header, after.Header);
        Assert.Equal(before.Metadata, after.Metadata);
        Assert.Equal(before.Tiles.Width, after.Tiles.Width);
        Assert.Equal(before.Tiles.Height, after.Tiles.Height);
        for (var x = 0; x < before.Tiles.Width; x++)
        {
            for (var y = 0; y < before.Tiles.Height; y++)
            {
                Assert.Equal(before.Tiles[x, y], after.Tiles[x, y]);
            }
        }
    }

    [Theory]
    [MemberData(nameof(CorpusWorlds))]
    public void Write_CorpusWorld_ReloadsToTheSameTablesMetadataAndTiles(string file)
    {
        var first = ReadForSave(File.ReadAllBytes(WorldPath(file)));

        var second = ReadForSave(Write(first));

        Assert.Equal(first.World.Metadata, second.World.Metadata);
        Assert.Equal(first.Table, second.Table);
        for (var x = 0; x < first.World.Tiles.Width; x += 17)
        {
            for (var y = 0; y < first.World.Tiles.Height; y++)
            {
                Assert.Equal(first.World.Tiles[x, y], second.World.Tiles[x, y]);
            }
        }
    }

    [Fact]
    public void Write_UnsupportedVersionInEnvelope_ThrowsUnsupportedWriteAndWritesNothing()
    {
        var envelope = ReadForSave(Build(2, 4, ShrinkingTilesCanonical));

        AssertRejected(envelope with { World = envelope.World with { Header = envelope.World.Header with { Version = 316 } } });
    }

    [Fact]
    public void Write_FileHeaderBytesWithAnotherVersion_ThrowsUnsupportedWriteAndWritesNothing()
    {
        var envelope = ReadForSave(Build(2, 4, ShrinkingTilesCanonical));
        var header = envelope.FileHeaderBytes.ToArray();
        header[0] = 0x45;

        AssertRejected(envelope with { FileHeaderBytes = header });
    }

    [Fact]
    public void Write_MissingOpaqueSection_ThrowsUnsupportedWriteAndWritesNothing()
    {
        var envelope = ReadForSave(Build(2, 4, ShrinkingTilesCanonical));

        AssertRejected(envelope with { OpaqueSections = envelope.OpaqueSections.Take(7).ToArray() });
    }

    [Fact]
    public void Write_OpaqueSectionsOutOfOrder_ThrowsUnsupportedWriteAndWritesNothing()
    {
        var envelope = ReadForSave(Build(2, 4, ShrinkingTilesCanonical));

        AssertRejected(envelope with { OpaqueSections = envelope.OpaqueSections.Reverse().ToArray() });
    }

    [Fact]
    public void Write_MetadataBytesContradictingTheSectionTable_ThrowsUnsupportedWriteAndWritesNothing()
    {
        var envelope = ReadForSave(Build(2, 4, ShrinkingTilesCanonical));

        AssertRejected(envelope with { MetadataBytes = envelope.MetadataBytes[..^1] });
    }

    [Fact]
    public void Write_FooterNameDifferingFromMetadata_ThrowsInconsistentFooterAndWritesNothing()
    {
        var envelope = ReadForSave(Build(2, 4, ShrinkingTilesCanonical));
        using var output = new MemoryStream();

        var error = Assert.Throws<WorldFormatException>(() => WorldWriter.Write(envelope with { FooterBytes = Footer("Synthetid", WorldId) }, output));

        Assert.Equal(WorldFormatError.InconsistentFooter, error.Error);
        Assert.Equal(0, output.Length);
    }

    [Fact]
    public void Write_FrameImportantBitsNotMatchingTheEnvelopeTable_ThrowsUnsupportedWriteAndWritesNothing()
    {
        var envelope = ReadForSave(Build(2, 4, ShrinkingTilesCanonical, frameCount: 10, frameImportant: [4, 5]));
        var header = envelope.FileHeaderBytes.ToArray();
        header[72] = 0;

        AssertRejected(envelope with { FileHeaderBytes = header });
    }

    [Fact]
    public void ComputePointers_RegeneratesAllElevenPointersFromTheEmittedLengths()
    {
        long[] opaque = [10, 20, 30, 40, 50, 60, 70, 80];

        var pointers = WorldWriter.ComputePointers(100, 200, 300, opaque, 11);

        Assert.Equal([100, 300, 600, 610, 630, 660, 700, 750, 810, 880, 960], pointers);
    }

    [Fact]
    public void ComputePointers_FileOfExactlyInt32MaxLength_IsAccepted()
    {
        long[] opaque = [1, 1, 1, 1, 1, 1, 1, 1];

        var pointers = WorldWriter.ComputePointers(100, 100, int.MaxValue - 214, opaque, 6);

        Assert.Equal(int.MaxValue - 6, pointers[10]);
    }

    [Fact]
    public void ComputePointers_FileReaching2GiB_ThrowsFileTooLarge()
    {
        long[] opaque = [1, 1, 1, 1, 1, 1, 1, 1];

        var error = Assert.Throws<WorldWriteException>(() => WorldWriter.ComputePointers(100, 100, int.MaxValue - 213, opaque, 6));

        Assert.Equal("file too large", error.Reason);
    }

    [Fact]
    public void ComputePointers_SingleSectionAbove2GiB_ThrowsFileTooLarge()
    {
        long[] opaque = [1, 1, 1, 1, 1, 1, 1, 1];

        var error = Assert.Throws<WorldWriteException>(() => WorldWriter.ComputePointers(100, 100, 1L << 40, opaque, 6));

        Assert.Equal("file too large", error.Reason);
    }

    private static void AssertRejected(WorldEnvelope envelope)
    {
        using var output = new MemoryStream();

        Assert.Throws<WorldWriteException>(() => WorldWriter.Write(envelope, output));

        Assert.Equal(0, output.Length);
    }

    private static byte[] Write(WorldEnvelope envelope)
    {
        using var output = new MemoryStream();
        WorldWriter.Write(envelope, output);
        return output.ToArray();
    }

    private static WorldEnvelope ReadForSave(byte[] file)
    {
        using var stream = new MemoryStream(file);
        return WorldReader.ReadForSave(stream);
    }

    private static int[] Pointers(byte[] file) =>
        Enumerable.Range(0, SectionCount).Select(index => BinaryPrimitives.ReadInt32LittleEndian(file.AsSpan(HeaderPointerTable + (4 * index)))).ToArray();

    private static byte[] Hex(string hex) => Convert.FromHexString(hex.Replace(" ", string.Empty, StringComparison.Ordinal));

    // Sections 3–10 modelled on the real structures; distinct sentinel bytes so a misplaced span is visible.
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

    /// <summary>A complete synthetic world: the given tile bytes, sentinel sections 3–10 and a valid footer.</summary>
    private static byte[] Build(
        int width,
        int height,
        byte[] tiles,
        uint revision = 1,
        ulong flags = 0,
        short frameCount = SyntheticTileWorld.DefaultFrameCount,
        int[]? frameImportant = null,
        SyntheticMetadata? metadata = null)
    {
        var (template, _) = SyntheticTileWorld.Build(
            width,
            height,
            tiles,
            frameCount: frameCount,
            frameImportant: frameImportant,
            metadataSource: metadata ?? new SyntheticMetadata { Width = width, Height = height });
        var pointers = Pointers(template);
        using var output = new MemoryStream();
        output.Write(template, 0, pointers[2]);
        var sections = SentinelSections();
        for (var index = 0; index < sections.Length; index++)
        {
            output.Write(sections[index]);
            pointers[3 + index] = (int)output.Position;
        }

        output.Write(Footer(Name, WorldId));
        var file = output.ToArray();
        for (var index = 3; index < SectionCount; index++)
        {
            BinaryPrimitives.WriteInt32LittleEndian(file.AsSpan(HeaderPointerTable + (4 * index)), pointers[index]);
        }

        BinaryPrimitives.WriteUInt32LittleEndian(file.AsSpan(12), revision);
        BinaryPrimitives.WriteUInt64LittleEndian(file.AsSpan(16), flags);
        return file;
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
}
