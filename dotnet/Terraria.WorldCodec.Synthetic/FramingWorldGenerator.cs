using System.Runtime.CompilerServices;
using System.Text.Json;

namespace Terraria.WorldCodec.Synthetic;

/// <summary>Builds a disposable observation terrace using the reference world writer.</summary>
public static class FramingWorldGenerator
{
    private const int AirGap = 2;
    private static readonly Tile Air = new();
    private static readonly Tile Floor = new() { Block = new VanillaContentRef(1) };
    private static readonly Tile Marker = new() { Block = new VanillaContentRef(38) };
    private static readonly JsonSerializerOptions ManifestJson = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };

    public static FramingManifest Generate(string inputPath, string outputPath, FramingCatalogue? catalogue = null)
    {
        var target = Path.GetFullPath(outputPath);
        var manifestPath = target + ".manifest.json";
        RequireNewPath(target);
        RequireNewPath(manifestPath);
        var (bytes, gameBuild) = FixtureCorpus.Read(inputPath);
        catalogue ??= FramingCatalogue.Load();
        using var source = new MemoryStream(bytes);
        var envelope = WorldReader.ReadForSave(source);
        var manifest = Plan(envelope.World.Tiles.Width, envelope.World.Tiles.Height, catalogue);
        RequireNoEntities(envelope.World, manifest.ClearedStrip);
        var tiles = Stamp(envelope.World.Tiles, catalogue, manifest);
        var candidate = envelope with { World = envelope.World with { Tiles = tiles } };
        using var written = new MemoryStream();
        WorldWriter.Write(candidate, written);
        var outputBytes = written.ToArray();
        // Check every tile before publishing. Envelope sections are preserved by WorldWriter.
        written.Position = 0;
        var reloaded = WorldReader.ReadForSave(written);
        for (var x = 0; x < tiles.Width; x++)
        {
            for (var y = 0; y < tiles.Height; y++)
            {
                if (tiles[x, y] != reloaded.World.Tiles[x, y])
                {
                    throw new InvalidDataException($"The generated world changed tile ({x}, {y}) on read-back.");
                }
            }
        }

        manifest = manifest with { GameBuild = gameBuild, BaseWorldHash = FixtureCorpus.Hash(bytes), OutputHash = FixtureCorpus.Hash(outputBytes) };
        var manifestBytes = JsonSerializer.SerializeToUtf8Bytes(manifest, ManifestJson);
        Publish(target, outputBytes, manifestPath, manifestBytes);
        return manifest;
    }

    public static FramingManifest Plan(int width, int height, FramingCatalogue catalogue)
    {
        ArgumentNullException.ThrowIfNull(catalogue);
        Validate(catalogue);
        var sections = new List<SectionPlacement>();
        var placements = new List<CasePlacement>();
        var sectionX = 0;
        var terraceHeight = 0;
        foreach (var section in catalogue.Cases.GroupBy(entry => entry.Section, StringComparer.Ordinal))
        {
            var contentWidth = Math.Max(30, section.Max(entry => entry.Pattern[0].Length));
            var rowX = 0;
            var rowY = AirGap;
            var rowHeight = 0;
            var number = sections.Count + 1;
            sections.Add(new SectionPlacement(number, section.Key, sectionX + AirGap, AirGap));
            foreach (var entry in section)
            {
                var caseWidth = entry.Pattern[0].Length;
                if (rowX + caseWidth > contentWidth)
                {
                    rowX = 0;
                    rowY += rowHeight + AirGap;
                    rowHeight = 0;
                }

                placements.Add(new CasePlacement(entry.Section, entry.Id, entry.Title,
                    sectionX + 5 + rowX, rowY, caseWidth, entry.Pattern.Length, entry.Expected, entry.MapTile, entry.MapOption));
                rowX += caseWidth + AirGap;
                rowHeight = Math.Max(rowHeight, entry.Pattern.Length);
            }

            terraceHeight = Math.Max(terraceHeight, Math.Max(rowY + rowHeight + AirGap, number + 3 + AirGap));
            sectionX += contentWidth + 7;
        }

        var startX = (width - sectionX) / 2;
        var startY = height / 8;
        if (width <= 0 || height <= 0 || startX < AirGap || startY < AirGap || startY + terraceHeight + 1 >= height)
        {
            throw new InvalidDataException("The framing catalogue does not fit inside this world.");
        }

        return new FramingManifest("1.4.5.8", string.Empty, string.Empty,
            new ClearedStrip(startX, startY, sectionX, terraceHeight),
            sections.Select(entry => entry with { MarkerX = entry.MarkerX + startX, MarkerY = entry.MarkerY + startY }).ToArray(),
            placements.Select(entry => entry with { X = entry.X + startX, Y = entry.Y + startY }).ToArray(), catalogue.UnreachableOptions);
    }

    private static void Validate(FramingCatalogue catalogue)
    {
        if (catalogue.Cases.Count == 0 || catalogue.Cases.Select(entry => entry.Id).Distinct(StringComparer.Ordinal).Count() != catalogue.Cases.Count)
        {
            throw new InvalidDataException("The catalogue must contain cases with unique IDs.");
        }

        foreach (var entry in catalogue.Cases)
        {
            if (string.IsNullOrWhiteSpace(entry.Section) || string.IsNullOrWhiteSpace(entry.Id)
                || string.IsNullOrWhiteSpace(entry.Title) || string.IsNullOrWhiteSpace(entry.Expected)
                || entry.Pattern.Length is 0 or > 256 || entry.Pattern[0].Length is 0 or > 256
                || entry.Pattern.Any(row => row.Length != entry.Pattern[0].Length || row.Any(ch => !entry.Legend.ContainsKey(ch))))
            {
                throw new InvalidDataException($"Case '{entry.Id}' has an invalid pattern, legend or description.");
            }
        }
    }

    private static TileGrid Stamp(TileGrid source, FramingCatalogue catalogue, FramingManifest manifest)
    {
        // The codec writer accepts an immutable TileGrid. Reuse its immutable references;
        // only catalogue cells are new values, never a separate object for every world tile.
        var cells = new Tile[checked(source.Width * source.Height)];
        for (var x = 0; x < source.Width; x++)
        {
            for (var y = 0; y < source.Height; y++)
            {
                cells[(x * source.Height) + y] = source[x, y];
            }
        }

        void Set(int x, int y, Tile tile) => cells[(x * source.Height) + y] = tile;
        var strip = manifest.ClearedStrip;
        for (var x = strip.X; x < strip.X + strip.Width; x++)
        {
            for (var y = strip.Y; y < strip.Y + strip.Height; y++)
            {
                Set(x, y, Air);
            }

            Set(x, strip.Y + strip.Height, Floor);
        }

        foreach (var section in manifest.Sections)
        {
            // Same marker material, with a different height to number sections on screen.
            for (var offset = 0; offset < section.Number + 1; offset++)
            {
                Set(section.MarkerX, section.MarkerY + offset, Marker);
            }
        }

        var byId = catalogue.Cases.ToDictionary(entry => entry.Id, StringComparer.Ordinal);
        foreach (var position in manifest.Cases)
        {
            var entry = byId[position.Id];
            for (var y = 0; y < position.Height; y++)
            {
                for (var x = 0; x < position.Width; x++)
                {
                    Set(position.X + x, position.Y + y, entry.Legend[entry.Pattern[y][x]]);
                }
            }
        }

        return CreateTileGrid(source.Width, source.Height, cells);
    }

    // Test-only bridge to the existing immutable grid. Keeps codec APIs and the binary
    // writer unchanged; there is no independent tile encoder or reflection over game code.
    [UnsafeAccessor(UnsafeAccessorKind.Constructor)]
    private static extern TileGrid CreateTileGrid(int width, int height, Tile[] tiles);

    private static void RequireNoEntities(World world, ClearedStrip strip)
    {
        bool Inside(int x, int y) => x >= strip.X - 2 && x <= strip.X + strip.Width + 2
            && y >= strip.Y - 2 && y <= strip.Y + strip.Height + 2;
        foreach (var section in world.Entities)
        {
            var overlaps = section.Data switch
            {
                ChestsSection chests => chests.Entries.Any(entry => Inside(entry.X, entry.Y)),
                SignsSection signs => signs.Entries.Any(entry => Inside(entry.X, entry.Y)),
                TileEntitiesSection entities => entities.Entries.Any(entry => Inside(entry.X, entry.Y)),
                PressurePlatesSection plates => plates.Entries.Any(entry => Inside(entry.X, entry.Y)),
                RoomsSection rooms => rooms.Entries.Any(entry => Inside(entry.X, entry.Y)),
                NpcsSection npcs => npcs.TownNpcs.Any(entry => Inside(entry.HomeX, entry.HomeY) || Inside((int)(entry.X / 16), (int)(entry.Y / 16)))
                    || npcs.Mobs.Any(entry => Inside((int)(entry.X / 16), (int)(entry.Y / 16))),
                _ => false,
            };
            if (section.Error is not null || overlaps)
            {
                throw new InvalidDataException("The cleared strip would affect a preserved entity section; choose another corpus base.");
            }
        }
    }

    private static void RequireNewPath(string path)
    {
        if (File.Exists(path) || Directory.Exists(path) || new FileInfo(path).LinkTarget is not null)
        {
            throw new IOException($"Output already exists: {path}");
        }
    }

    private static void Publish(string target, byte[] world, string manifestPath, byte[] manifest)
    {
        var stagedWorld = target + $".{Guid.NewGuid():N}.tmp";
        var stagedManifest = manifestPath + $".{Guid.NewGuid():N}.tmp";
        var publishedWorld = false;
        try
        {
            WriteNew(stagedWorld, world);
            WriteNew(stagedManifest, manifest);
            File.Move(stagedWorld, target, overwrite: false);
            publishedWorld = true;
            File.Move(stagedManifest, manifestPath, overwrite: false);
        }
        catch
        {
            if (publishedWorld)
            {
                File.Delete(target);
            }

            throw;
        }
        finally
        {
            File.Delete(stagedWorld);
            File.Delete(stagedManifest);
        }
    }

    private static void WriteNew(string path, byte[] bytes)
    {
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
        stream.Write(bytes);
        stream.Flush(flushToDisk: true);
    }
}
