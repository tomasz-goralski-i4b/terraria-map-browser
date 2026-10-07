using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>The common command entry point, with a reader seam for deterministic failure tests.</summary>
internal static class InspectorCommand
{
    internal static int Run(string[] arguments, TextWriter output, TextWriter error, Func<string, World> readWorld)
    {
        throw new NotImplementedException();
    }
}
