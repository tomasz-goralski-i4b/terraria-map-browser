using System.Reflection;
using System.Runtime.ExceptionServices;
using System.Text.Json;

namespace Terraria.WorldCodec.Tests;

/// <summary>Test-only adapter for the shared REC, SEC and META contract entry points.</summary>
internal static class SharedContractVectorHarness
{
    /// <summary>Loads all three required files from an absolute vector directory and validates both layers.</summary>
    public static IReadOnlyList<JsonElement> LoadAll(string vectorDirectory)
    {
        var documents = new List<JsonElement>();
        foreach (var fileName in new[] { "tiles.vectors.json", "runs.vectors.json", "metadata.vectors.json" })
        {
            var path = Path.GetFullPath(Path.Combine(vectorDirectory, fileName));
            using var document = JsonDocument.Parse(File.ReadAllBytes(path));
            ValidateDocument(document.RootElement, path);
            documents.Add(document.RootElement.Clone());
        }

        return documents;
    }

    /// <summary>Rejects schema violations and semantic inconsistencies with file and field diagnostics.</summary>
    public static void ValidateDocument(JsonElement document, string fileName)
    {
        var errors = JsonSchemaSubset.Load("vector.v1.schema.json").Validate(document);
        if (errors.Count != 0)
        {
            throw new InvalidDataException(fileName + ": " + string.Join("\n", errors));
        }

        var vectorIndex = 0;
        foreach (var vector in document.GetProperty("vectors").EnumerateArray())
        {
            var context = vector.GetProperty("context");
            var entry = vector.GetProperty("entry").GetString();
            var caseIndex = 0;
            foreach (var vectorCase in vector.GetProperty("cases").EnumerateArray())
            {
                var path = $"$.vectors[{vectorIndex}].cases[{caseIndex}]";
                var start = context.GetProperty("baseOffset").GetInt64();
                var end = start + (vectorCase.GetProperty("hex").GetString()!.Length / 2);
                if (vectorCase.TryGetProperty("error", out var error))
                {
                    var offset = error.GetProperty("offset").GetInt64();
                    Require(offset >= start && offset <= end, fileName, path + ".error.offset", "outside supplied input");
                }

                if (entry == "META")
                {
                    var inputEnd = context.GetProperty("inputEnd").GetInt64();
                    var sectionEnd = context.GetProperty("sectionEnd").GetInt64();
                    Require(inputEnd == end, fileName, path + ".context.inputEnd", "does not match supplied bytes");
                    Require(sectionEnd >= inputEnd, fileName, path + ".context.sectionEnd", "before inputEnd");
                    Require(vector.TryGetProperty("provenance", out _) || sectionEnd == inputEnd,
                        fileName, path + ".context.sectionEnd", "synthetic fragment must be complete");
                }

                if (entry == "SEC" && vectorCase.TryGetProperty("result", out var result))
                {
                    var width = context.GetProperty("width").GetInt64();
                    var height = context.GetProperty("height").GetInt64();
                    Require(result.GetProperty("width").GetInt64() == width, fileName, path + ".result.width", "differs from context");
                    Require(result.GetProperty("height").GetInt64() == height, fileName, path + ".result.height", "differs from context");
                    Require(result.GetProperty("tiles").GetArrayLength() == width * height,
                        fileName, path + ".result.tiles", "tile count differs from dimensions");
                }

                caseIndex++;
            }

            vectorIndex++;
        }
    }

    /// <summary>
    /// Decodes the supplied bytes at the declared entry point, returning a normalized result/error envelope.
    /// Results include all contract fields; errors include their absolute offset and any declared details.
    /// No installed game or whole-world fixture is needed.
    /// </summary>
    public static JsonElement Decode(JsonElement vector, JsonElement vectorCase)
    {
        var entry = vector.GetProperty("entry").GetString();
        if (entry is not ("REC" or "SEC" or "META"))
        {
            throw new InvalidDataException($"{vector.GetProperty("id").GetString()}: entry '{entry}' is unknown");
        }

        var context = vector.GetProperty("context");
        var start = context.GetProperty("baseOffset").GetInt64();
        var bytes = Convert.FromHexString(vectorCase.GetProperty("hex").GetString()!);
        using var stream = new MemoryStream();
        stream.Position = start;
        stream.Write(bytes);
        var boundary = new WorldSectionBoundary(start, start + bytes.Length);
        try
        {
            object result = entry == "META"
                ? ReadMetadata(stream, boundary, context)
                : ReadTiles(stream, boundary, context, entry);
            return JsonSerializer.SerializeToElement(new { result });
        }
        catch (WorldFormatException exception)
        {
            var error = new Dictionary<string, object?>
            {
                ["code"] = exception.Error.ToString(),
                ["offset"] = exception.Offset,
                ["reason"] = exception.Reason,
            };
            if (exception.Field is not null)
            {
                error["field"] = exception.Field;
            }

            if (exception.X is not null)
            {
                error["x"] = exception.X;
                error["y"] = exception.Y;
            }

            return JsonSerializer.SerializeToElement(new { error });
        }
    }

    private const BindingFlags Methods = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static;

    // Name and seed cap from docs/file-format/metadata.md, restated here rather than read from the codec.
    private const int MaxNameOrSeedBytes = 4096;

    private static object ReadTiles(Stream stream, WorldSectionBoundary boundary, JsonElement context, string entry)
    {
        var frame = context.GetProperty("frameImportant");
        var flags = new bool[frame.GetProperty("k").GetInt32()];
        foreach (var id in frame.GetProperty("frame").EnumerateArray())
        {
            flags[id.GetInt32()] = true;
        }

        var reader = CreateReader("TileSectionReader", stream, boundary, flags);
        if (entry == "SEC")
        {
            var grid = (TileGrid)Invoke(reader, "Read", context.GetProperty("width").GetInt32(), context.GetProperty("height").GetInt32())!;
            var tiles = new List<object>();
            for (var x = 0; x < grid.Width; x++)
            {
                for (var y = 0; y < grid.Height; y++)
                {
                    tiles.Add(NormalizeTile(grid[x, y]));
                }
            }

            return new { kind = "grid", width = grid.Width, height = grid.Height, tiles };
        }

        var position = context.GetProperty("position");
        var column = position.GetProperty("x").GetInt32();
        var row = position.GetProperty("y").GetInt32();
        var height = context.GetProperty("columnHeight").GetInt32();
        (Tile Tile, int Run) record;
        do
        {
            // GREEN adds this narrow overload: it sets offsets/coordinates and checks run bounds.
            // Reflection keeps frozen tests compilable without changing production in RED.
            record = ((Tile Tile, int Run))Invoke(reader, "ReadRecord", column, row, height)!;
            row += record.Run + 1;
        }
        while ((long)reader.GetType().GetField("position", Methods)!.GetValue(reader)! < boundary.End);

        return new { kind = "record", tile = NormalizeTile(record.Tile), run = record.Run };
    }

    private static Dictionary<string, object?> ReadMetadata(Stream stream, WorldSectionBoundary boundary, JsonElement context)
    {
        // M3 is a prefix: bound reads to inputEnd and stop after gameMode, leaving the absent tail alone.
        var reader = CreateReader("MetadataSectionReader", stream, boundary);
        var result = new Dictionary<string, object?> { ["kind"] = "metadata" };
        var startsAt = context.GetProperty("startsAt").GetString();
        if (startsAt == "bool")
        {
            result["bool"] = Invoke(reader, "Bool", new object?[] { null });
            return result;
        }

        if (startsAt == "name")
        {
            result["name"] = Invoke(reader, "String", "name", MaxNameOrSeedBytes);
            result["seed"] = Invoke(reader, "String", "seed", MaxNameOrSeedBytes);
            Invoke(reader, "Skip", sizeof(ulong), "worldGenVersion");
            var guid = new byte[16];
            for (var index = 0; index < guid.Length; index++)
            {
                guid[index] = (byte)Invoke(reader, "UInt8", "guid")!;
            }

            result["guid"] = Convert.ToHexStringLower(guid);
            result["worldId"] = Invoke(reader, "Int32", "worldId");
            result["bounds"] = new
            {
                left = Invoke(reader, "Int32", "left"),
                right = Invoke(reader, "Int32", "right"),
                top = Invoke(reader, "Int32", "top"),
                bottom = Invoke(reader, "Int32", "bottom"),
            };
        }

        var metadata = CodecType("MetadataSection");
        result["height"] = Invoke(metadata, "ReadDimension", reader, "height", WorldReader.MaxWorldHeight);
        result["width"] = Invoke(metadata, "ReadDimension", reader, "width", WorldReader.MaxWorldWidth);
        if (startsAt == "name")
        {
            result["gameMode"] = Invoke(reader, "Int32", "gameMode");
        }

        return result;
    }

    private static object NormalizeTile(Tile tile) => new
    {
        block = NormalizeContent(tile.Block),
        wall = NormalizeContent(tile.Wall),
        frameX = tile.FrameX,
        frameY = tile.FrameY,
        paint = tile.Paint,
        wallPaint = tile.WallPaint,
        wires = (int)tile.Wires,
        actuator = tile.Actuator,
        liquid = tile.Liquid is null ? null : new { kind = tile.Liquid.Kind.ToString().ToLowerInvariant(), amount = tile.Liquid.Amount },
        shape = tile.Shape switch
        {
            BlockShape.Full => "full",
            BlockShape.Half => "half",
            BlockShape.SlopeTopRight => "slopeTopRight",
            BlockShape.SlopeTopLeft => "slopeTopLeft",
            BlockShape.SlopeBottomRight => "slopeBottomRight",
            BlockShape.SlopeBottomLeft => "slopeBottomLeft",
            _ => throw new InvalidDataException("Unknown decoded shape"),
        },
        inactive = tile.Inactive,
        invisibleBlock = tile.InvisibleBlock,
        invisibleWall = tile.InvisibleWall,
        fullBrightBlock = tile.FullBrightBlock,
        fullBrightWall = tile.FullBrightWall,
    };

    private static object? NormalizeContent(ContentRef? content) => content switch
    {
        null => null,
        VanillaContentRef vanilla => new { kind = "vanilla", id = vanilla.Id },
        UnknownContentRef unknown => new { kind = "unknown", runtimeId = unknown.RuntimeId },
        ModContentRef mod => new { kind = "mod", mod = mod.Mod, internalName = mod.InternalName, runtimeId = mod.RuntimeId, modVersion = mod.ModVersion },
        _ => throw new InvalidDataException("Unknown decoded content reference"),
    };

    private static Type CodecType(string name) => typeof(CodecAssembly).Assembly.GetType("Terraria.WorldCodec." + name, throwOnError: true)!;

    private static object CreateReader(string name, params object[] arguments) =>
        Activator.CreateInstance(CodecType(name), Methods, binder: null, args: arguments, culture: null)!;

    private static object? Invoke(object target, string name, params object?[] arguments)
    {
        var type = target as Type ?? target.GetType();
        var method = type.GetMethods(Methods).SingleOrDefault(candidate => candidate.Name == name && candidate.GetParameters().Length == arguments.Length);
        Assert.True(method is not null, $"Missing codec seam {type.Name}.{name} with {arguments.Length} arguments");
        try
        {
            return method!.Invoke(target is Type ? null : target, arguments);
        }
        catch (TargetInvocationException exception) when (exception.InnerException is not null)
        {
            ExceptionDispatchInfo.Capture(exception.InnerException).Throw();
            throw;
        }
    }

    private static void Require(bool condition, string fileName, string path, string reason)
    {
        if (!condition)
        {
            throw new InvalidDataException(fileName + ": " + path + ": " + reason);
        }
    }
}
