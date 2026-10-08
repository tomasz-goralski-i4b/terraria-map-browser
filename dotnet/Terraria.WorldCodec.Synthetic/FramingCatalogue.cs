using System.Reflection;
using System.Text.Json;

namespace Terraria.WorldCodec.Synthetic;

public sealed record FramingCase(string Section, string Id, string Title, string[] Pattern,
    Dictionary<char, Tile> Legend, string Expected, int? MapTile = null, int? MapOption = null);

public sealed record UnreachableOption(int Tile, int Option, string Reason);

public sealed record FramingCatalogue(IReadOnlyList<FramingCase> Cases, IReadOnlyList<UnreachableOption> UnreachableOptions)
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public static FramingCatalogue Load(string? cataloguePath = null)
    {
        using var stream = cataloguePath is null
            ? Assembly.GetExecutingAssembly().GetManifestResourceStream("Terraria.WorldCodec.Synthetic.framing-cases.json")!
            : File.OpenRead(cataloguePath);
        var data = JsonSerializer.Deserialize<CatalogueEntry[]>(stream, JsonOptions)
            ?? throw new InvalidDataException("The framing catalogue is empty.");
        var cases = data.Select(entry => new FramingCase(entry.Section, entry.Id, entry.Title, entry.Pattern,
            entry.Legend.ToDictionary(pair => pair.Key, pair => pair.Value.ToTile()), entry.Expected)).ToList();
        cases.AddRange(AdditionalFramingCases.Create());
        using var paletteStream = Assembly.GetExecutingAssembly().GetManifestResourceStream("FramingMapPalette")!;
        using var reader = new StreamReader(paletteStream);
        var map = MapOptionCatalogue.Read(reader.ReadToEnd());
        cases.AddRange(map.Cases);
        return new FramingCatalogue(cases.GroupBy(entry => entry.Section, StringComparer.Ordinal)
            .SelectMany(section => section).ToArray(), map.UnreachableOptions);
    }

    private sealed record CatalogueEntry(string Section, string Id, string Title, string[] Pattern,
        Dictionary<char, CatalogueTile> Legend, string Expected);

    private sealed record CatalogueTile(int? Block, int? Wall, BlockShape Shape, short? FrameX, short? FrameY)
    {
        public Tile ToTile() => new()
        {
            Block = Block is { } block ? new VanillaContentRef(block) : null,
            Wall = Wall is { } wall ? new VanillaContentRef(wall) : null,
            Shape = Shape,
            FrameX = FrameX,
            FrameY = FrameY,
        };
    }
}

public sealed record CasePlacement(string Section, string Id, string Title, int X, int Y, int Width, int Height,
    string Expected, int? MapTile, int? MapOption);

public sealed record SectionPlacement(int Number, string Name, int MarkerX, int MarkerY);

public sealed record ClearedStrip(int X, int Y, int Width, int Height);

public sealed record ObservationSpawn(int X, int Y);

public sealed record FramingManifest(string GameBuild, string BaseWorldHash, string OutputHash,
    ClearedStrip ClearedStrip, IReadOnlyList<SectionPlacement> Sections,
    IReadOnlyList<CasePlacement> Cases, IReadOnlyList<UnreachableOption> UnreachableOptions)
{
    public string WorldName { get; init; } = "TMS Framing Tests #158 v3 Frozen";

    public bool TimeFrozen { get; init; } = true;

    public ObservationSpawn? Spawn { get; init; }
}
