using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>The export-cwm command; the writer seam permits deterministic partial-write failure tests.</summary>
internal static class ExportCwmCommand
{
    internal static int Run(string[] arguments, TextWriter output, TextWriter error,
        Func<string, World> readWorld, Action<World, Stream>? writeWorld = null) =>
        throw new NotImplementedException();
}
