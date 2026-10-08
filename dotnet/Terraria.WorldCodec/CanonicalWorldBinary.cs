using System.Buffers.Binary;
using System.Text.Json;

namespace Terraria.WorldCodec;

/// <summary>Writes the deterministic CWM v1 binary framing specified in docs/cwm.md.</summary>
public static class CanonicalWorldBinary
{
    /// <summary>Writes a world using the requested CWM schema version, leaving the output stream open.</summary>
    public static void Write(World world, Stream output, int schemaVersion = 1)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(output);
        if (schemaVersion != 1)
        {
            throw new ArgumentOutOfRangeException(nameof(schemaVersion), schemaVersion, "Only CWM schema version 1 is supported.");
        }

        var model = CanonicalWorldModel.FromTileGrid(world.Tiles);
        using var header = new MemoryStream();
        using (var writer = new Utf8JsonWriter(header))
        {
            writer.WriteStartObject();
            writer.WriteNumber("schemaVersion", schemaVersion);
            writer.WriteNumber("formatVersion", world.Header.Version);
            CanonicalWorldJson.WriteMetadata(writer, world.Metadata, binaryStrings: true);
            writer.WriteStartObject("dimensions");
            writer.WriteNumber("width", model.Width);
            writer.WriteNumber("height", model.Height);
            writer.WriteEndObject();
            writer.WriteStartArray("palette");
            foreach (var content in model.Palette)
            {
                CanonicalWorldJson.WriteContent(writer, content, binaryStrings: true);
            }

            writer.WriteEndArray();
            writer.WriteEndObject();
        }

        Span<byte> prefix = stackalloc byte[12];
        "CWM\0"u8.CopyTo(prefix);
        BinaryPrimitives.WriteUInt32LittleEndian(prefix[4..], (uint)schemaVersion);
        BinaryPrimitives.WriteUInt32LittleEndian(prefix[8..], checked((uint)header.Length));
        output.Write(prefix);
        header.Position = 0;
        header.CopyTo(output);
        foreach (var plane in CanonicalWorldModel.PlaneNames)
        {
            output.Write(model.GetPlane(plane).Span);
        }
    }
}
