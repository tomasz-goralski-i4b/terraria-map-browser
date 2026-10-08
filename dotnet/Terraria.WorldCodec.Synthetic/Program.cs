using Terraria.WorldCodec.Synthetic;

if (args is not ["generate", _, _] and not ["generate", _, _, "--catalogue", _])
{
    Console.Error.WriteLine("Usage: Terraria.WorldCodec.Synthetic generate <corpus-base.wld> <new-output.wld> [--catalogue <cases.json>]");
    return 2;
}

try
{
    var catalogue = FramingCatalogue.Load(args.Length == 5 ? args[4] : null);
    var manifest = FramingWorldGenerator.Generate(args[1], args[2], catalogue);
    Console.WriteLine(Path.GetFullPath(args[2]));
    Console.WriteLine(Path.GetFullPath(args[2]) + ".manifest.json");
    Console.WriteLine($"{manifest.Sections.Count} sections, {manifest.Cases.Count} cases, {manifest.UnreachableOptions.Count} unreachable options.");
    return 0;
}
catch (Exception exception) when (exception is IOException or InvalidDataException or UnauthorizedAccessException or ArgumentException
    or System.Text.Json.JsonException or Terraria.WorldCodec.WorldFormatException
    or Terraria.WorldCodec.WorldWriteException or Terraria.WorldCodec.TileEncodingException)
{
    Console.Error.WriteLine($"Could not generate the observation world: {exception.Message}".ReplaceLineEndings(" "));
    return 1;
}
