using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Terraria.WorldCodec.Synthetic;

/// <summary>Changes only documented format-326 identity and spawn fields in disposable copies.</summary>
internal static class ObservationWorldMetadata
{
    private static WorldMetadata Identity(WorldEnvelope source, FramingManifest manifest)
    {
        // Stable across output paths and repeated generation, distinct from the base's
        // identity so Terraria's world and map caches cannot confuse the two worlds.
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(
            manifest.WorldName + FixtureCorpus.Hash(source.MetadataBytes.ToArray()) + JsonSerializer.Serialize(manifest)));
        var worldId = BinaryPrimitives.ReadInt32LittleEndian(hash.AsSpan(16)) & int.MaxValue;
        if (worldId == source.World.Metadata.WorldId)
        {
            worldId ^= 1;
        }

        var guid = Convert.ToHexStringLower(hash.AsSpan(0, 16));
        if (guid == source.World.Metadata.GuidHex)
        {
            hash[0] ^= 1;
            guid = Convert.ToHexStringLower(hash.AsSpan(0, 16));
        }

        return source.World.Metadata with { Name = manifest.WorldName, WorldId = worldId, GuidHex = guid };
    }

    internal static WorldEnvelope Apply(WorldEnvelope source, FramingManifest manifest)
    {
        if (source.World.Header.Version != 326 || manifest.Spawn is not { } spawn)
        {
            throw new InvalidDataException("Observation identity and spawn editing requires format 326 and a planned spawn.");
        }

        var identity = Identity(source, manifest);
        using var input = new BinaryReader(new MemoryStream(source.MetadataBytes.ToArray()), Encoding.UTF8);
        input.ReadString();
        var afterName = checked((int)input.BaseStream.Position);
        input.ReadString();
        input.BaseStream.Position += sizeof(ulong);
        var guidOffset = checked((int)input.BaseStream.Position);
        // docs/file-format/metadata.md rows 4-17: GUID, id, bounds, dimensions,
        // mode, nine seed flags, two dates, moon type and seventeen style integers.
        var spawnOffset = guidOffset + 16 + 4 + 16 + 8 + 4 + 9 + 16 + 1 + (17 * 4);
        var tail = source.MetadataBytes[afterName..].ToArray();
        Convert.FromHexString(identity.GuidHex!).CopyTo(tail, guidOffset - afterName);
        BinaryPrimitives.WriteInt32LittleEndian(tail.AsSpan(guidOffset - afterName + 16), identity.WorldId);
        BinaryPrimitives.WriteInt32LittleEndian(tail.AsSpan(spawnOffset - afterName), spawn.X);
        BinaryPrimitives.WriteInt32LittleEndian(tail.AsSpan(spawnOffset - afterName + 4), spawn.Y);
        using var metadata = new MemoryStream();
        using (var writer = new BinaryWriter(metadata, Encoding.UTF8, leaveOpen: true))
        {
            writer.Write(identity.Name);
            writer.Write(tail);
        }

        using var footer = new MemoryStream();
        using (var writer = new BinaryWriter(footer, Encoding.UTF8, leaveOpen: true))
        {
            writer.Write(true);
            writer.Write(identity.Name);
            writer.Write(identity.WorldId);
        }

        // Rebase the source envelope's boundaries after the longer name. WorldWriter
        // still performs all validation, tile encoding and final pointer regeneration.
        long[] lengths = [source.FileHeaderBytes.Length, metadata.Length,
            source.Table.Tiles.End - source.Table.Tiles.Start,
            .. source.OpaqueSections.Select(section => (long)section.Bytes.Length), footer.Length];
        var boundaries = new WorldSectionBoundary[lengths.Length];
        long position = 0;
        for (var index = 0; index < lengths.Length; index++)
        {
            boundaries[index] = new WorldSectionBoundary(position, position + lengths[index]);
            position += lengths[index];
        }

        var header = source.FileHeaderBytes.ToArray();
        for (var index = 1; index < boundaries.Length; index++)
        {
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(26 + ((index - 1) * 4)), checked((int)boundaries[index].Start));
        }

        return source with
        {
            World = source.World with { Metadata = identity },
            FileHeaderBytes = header,
            MetadataBytes = metadata.ToArray(),
            FooterBytes = footer.ToArray(),
            Table = new WorldSectionTable(boundaries[0], boundaries[1], boundaries[2], boundaries[3], boundaries[4],
                boundaries[5], boundaries[6], boundaries[7], boundaries[8], boundaries[9], boundaries[10], boundaries[11],
                source.Table.FrameImportant),
        };
    }
}
