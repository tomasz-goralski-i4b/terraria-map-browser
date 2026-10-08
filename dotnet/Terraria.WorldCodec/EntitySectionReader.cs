namespace Terraria.WorldCodec;

/// <summary>Independent read-only decoder for format 326 entity sections (docs/file-format/entities.md).</summary>
public static class EntitySectionReader
{
    public static IReadOnlyList<WorldEntitySection> ReadAll(Stream stream, WorldSectionTable table) =>
        throw new NotImplementedException();

    public static EntitySectionData Read(Stream stream, string section, WorldSectionBoundary boundary) =>
        throw new NotImplementedException();
}
