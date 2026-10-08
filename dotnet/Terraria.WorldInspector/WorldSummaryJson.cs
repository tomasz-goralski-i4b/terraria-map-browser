using System.Globalization;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using System.Text.Json;
using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>A rectangle of tiles: top-left corner and size.</summary>
public sealed record TileRegion(int X, int Y, int Width, int Height);

/// <summary>
/// Writes the world summary with chunk digests (contracts/schemas/world-summary.v1.schema.json, docs/cwm.md):
/// UTF-8, LF, fixed property order, one trailing newline, independent of culture and environment.
/// </summary>
public static class WorldSummaryJson
{
    public const int ChunkSize = 128;

    /// <summary>Largest width and height of a <see cref="TileRegion"/>.</summary>
    public const int MaxRegionSize = 256;

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Indented = true,
        IndentCharacter = ' ',
        IndentSize = 2,
        NewLine = "\n",
        // Non-ASCII text is written as UTF-8; the output is JSON for machines, never embedded in HTML.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <exception cref="ArgumentOutOfRangeException">
    /// The region is empty, not fully inside the world, or larger than <see cref="MaxRegionSize"/> in either direction.
    /// </exception>
    public static void Write(World world, Stream output, TileRegion? region = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(output);
        if (region is not null)
        {
            ValidateRegion(region, world.Tiles.Width, world.Tiles.Height);
        }

        var model = CanonicalWorldModel.FromTileGrid(world.Tiles);

        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writer.WriteNumber("schemaVersion", 1);
            writer.WriteNumber("formatVersion", world.Header.Version);
            CanonicalWorldJson.WriteMetadata(writer, world.Metadata);

            writer.WriteStartObject("dimensions");
            writer.WriteNumber("width", model.Width);
            writer.WriteNumber("height", model.Height);
            writer.WriteEndObject();

            writer.WriteStartArray("skippedSections");
            foreach (var section in world.SkippedSections)
            {
                writer.WriteStartObject();
                writer.WriteString("name", string.Concat(char.ToLowerInvariant(section.Name[0]).ToString(), section.Name.AsSpan(1)));
                writer.WriteNumber("start", section.Boundary.Start);
                writer.WriteNumber("end", section.Boundary.End);
                writer.WriteEndObject();
            }

            writer.WriteEndArray();

            writer.WriteStartArray("palette");
            foreach (var content in model.Palette)
            {
                WriteContent(writer, content);
            }

            writer.WriteEndArray();

            WriteChunks(writer, model);

            if (region is not null)
            {
                WriteRegion(writer, world.Tiles, region);
            }

            writer.WriteEndObject();
        }

        buffer.WriteByte((byte)'\n');
        buffer.Position = 0;
        buffer.CopyTo(output);
    }

    private static void ValidateRegion(TileRegion region, int worldWidth, int worldHeight)
    {
        if (region.Width < 1 || region.Height < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(region), "The region must not be empty.");
        }

        if (region.Width > MaxRegionSize || region.Height > MaxRegionSize)
        {
            throw new ArgumentOutOfRangeException(
                nameof(region),
                string.Create(CultureInfo.InvariantCulture, $"The region must not be larger than {MaxRegionSize} × {MaxRegionSize} tiles."));
        }

        if (region.X < 0
            || region.Y < 0
            || (long)region.X + region.Width > worldWidth
            || (long)region.Y + region.Height > worldHeight)
        {
            throw new ArgumentOutOfRangeException(
                nameof(region),
                string.Create(CultureInfo.InvariantCulture, $"The region must lie inside the {worldWidth} × {worldHeight} world."));
        }
    }

    internal static void WriteContent(Utf8JsonWriter writer, ContentRef content) =>
        CanonicalWorldJson.WriteContent(writer, content);

    private static void WriteChunks(Utf8JsonWriter writer, CanonicalWorldModel model)
    {
        writer.WriteStartObject("chunks");
        writer.WriteNumber("size", ChunkSize);
        writer.WriteStartArray("planes");
        foreach (var plane in CanonicalWorldModel.PlaneNames)
        {
            writer.WriteStringValue(plane);
        }

        writer.WriteEndArray();

        writer.WriteStartArray("digests");
        for (var chunkX = 0; chunkX * ChunkSize < model.Width; chunkX++)
        {
            for (var chunkY = 0; chunkY * ChunkSize < model.Height; chunkY++)
            {
                var left = chunkX * ChunkSize;
                var top = chunkY * ChunkSize;
                var width = Math.Min(ChunkSize, model.Width - left);
                var height = Math.Min(ChunkSize, model.Height - top);

                writer.WriteStartObject();
                writer.WriteNumber("x", chunkX);
                writer.WriteNumber("y", chunkY);
                writer.WriteNumber("width", width);
                writer.WriteNumber("height", height);
                foreach (var plane in CanonicalWorldModel.PlaneNames)
                {
                    writer.WriteString(plane, Digest(model, plane, left, top, width, height));
                }

                writer.WriteEndObject();
            }
        }

        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    private static string Digest(CanonicalWorldModel model, string plane, int left, int top, int width, int height)
    {
        var bytes = model.GetPlane(plane).Span;
        var elementSize = CanonicalWorldModel.ElementSize(plane);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        for (var x = left; x < left + width; x++)
        {
            hash.AppendData(bytes.Slice(((x * model.Height) + top) * elementSize, height * elementSize));
        }

        return Convert.ToHexStringLower(hash.GetHashAndReset().AsSpan(0, 8));
    }

    private static void WriteRegion(Utf8JsonWriter writer, TileGrid tiles, TileRegion region)
    {
        writer.WriteStartObject("region");
        writer.WriteNumber("x", region.X);
        writer.WriteNumber("y", region.Y);
        writer.WriteNumber("width", region.Width);
        writer.WriteNumber("height", region.Height);
        writer.WriteStartArray("tiles");
        for (var x = region.X; x < region.X + region.Width; x++)
        {
            for (var y = region.Y; y < region.Y + region.Height; y++)
            {
                WriteTile(writer, x, y, tiles[x, y]);
            }
        }

        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    private static void WriteTile(Utf8JsonWriter writer, int x, int y, Tile tile)
    {
        writer.WriteStartObject();
        writer.WriteNumber("x", x);
        writer.WriteNumber("y", y);
        if (tile.Block is { } block)
        {
            writer.WritePropertyName("block");
            WriteContent(writer, block);
        }

        if (tile.FrameX is { } frameX)
        {
            writer.WriteNumber("frameX", frameX);
        }

        if (tile.FrameY is { } frameY)
        {
            writer.WriteNumber("frameY", frameY);
        }

        if (tile.Paint is { } paint)
        {
            writer.WriteNumber("paint", paint);
        }

        if (tile.Wall is { } wall)
        {
            writer.WritePropertyName("wall");
            WriteContent(writer, wall);
        }

        if (tile.WallPaint is { } wallPaint)
        {
            writer.WriteNumber("wallPaint", wallPaint);
        }

        writer.WriteNumber("wires", (int)tile.Wires);
        writer.WriteBoolean("actuator", tile.Actuator);
        if (tile.Liquid is { } liquid)
        {
            writer.WriteStartObject("liquid");
            writer.WriteString("kind", liquid.Kind switch
            {
                LiquidKind.Water => "water",
                LiquidKind.Lava => "lava",
                LiquidKind.Honey => "honey",
                _ => "shimmer",
            });
            writer.WriteNumber("amount", liquid.Amount);
            writer.WriteEndObject();
        }

        if (tile.Shape != BlockShape.Full)
        {
            writer.WriteString("shape", tile.Shape switch
            {
                BlockShape.Half => "half",
                BlockShape.SlopeTopRight => "slopeTopRight",
                BlockShape.SlopeTopLeft => "slopeTopLeft",
                BlockShape.SlopeBottomRight => "slopeBottomRight",
                _ => "slopeBottomLeft",
            });
        }

        WriteTrue(writer, "inactive", tile.Inactive);
        WriteTrue(writer, "invisibleBlock", tile.InvisibleBlock);
        WriteTrue(writer, "invisibleWall", tile.InvisibleWall);
        WriteTrue(writer, "fullBrightBlock", tile.FullBrightBlock);
        WriteTrue(writer, "fullBrightWall", tile.FullBrightWall);
        writer.WriteEndObject();
    }

    private static void WriteTrue(Utf8JsonWriter writer, string name, bool value)
    {
        if (value)
        {
            writer.WriteBoolean(name, true);
        }
    }
}
