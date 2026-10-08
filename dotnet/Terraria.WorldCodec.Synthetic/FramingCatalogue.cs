namespace Terraria.WorldCodec.Synthetic;

public sealed record FramingCase(string Section, string Id, string Title, string[] Pattern,
    Dictionary<char, Tile> Legend, string Expected, int? MapTile = null, int? MapOption = null);

public sealed record UnreachableOption(int Tile, int Option, string Reason);

public sealed record FramingCatalogue(IReadOnlyList<FramingCase> Cases, IReadOnlyList<UnreachableOption> UnreachableOptions)
{
    public static FramingCatalogue Load(string? cataloguePath = null) => throw new NotImplementedException();
}

public sealed record CasePlacement(string Section, string Id, string Title, int X, int Y, int Width, int Height,
    string Expected, int? MapTile, int? MapOption);

public sealed record SectionPlacement(int Number, string Name, int MarkerX, int MarkerY);

public sealed record ClearedStrip(int X, int Y, int Width, int Height);

public sealed record FramingManifest(string GameBuild, string BaseWorldHash, string OutputHash,
    ClearedStrip ClearedStrip, IReadOnlyList<SectionPlacement> Sections,
    IReadOnlyList<CasePlacement> Cases, IReadOnlyList<UnreachableOption> UnreachableOptions);

public static class FramingWorldGenerator
{
    public static FramingManifest Generate(string inputPath, string outputPath, FramingCatalogue? catalogue = null) =>
        throw new NotImplementedException();

    public static FramingManifest Plan(int width, int height, FramingCatalogue catalogue) =>
        throw new NotImplementedException();
}
