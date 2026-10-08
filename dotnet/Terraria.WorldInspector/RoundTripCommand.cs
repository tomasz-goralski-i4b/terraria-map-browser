using Terraria.WorldCodec;

namespace Terraria.WorldInspector;

/// <summary>Test seams for the failure paths of <see cref="RoundTripCommand"/>; both hooks run with the staged file path.</summary>
internal sealed record RoundTripHooks
{
    /// <summary>Runs right after the staged file has been written, before it is reloaded and compared.</summary>
    public Action<string>? AfterStage { get; init; }

    /// <summary>Runs after validation succeeded, right before the staged file is moved to the output path.</summary>
    public Action<string>? BeforeMove { get; init; }
}

/// <summary><c>roundtrip &lt;input.wld&gt; &lt;output.wld&gt;</c>: writes a validated copy to a new path, never replacing a file (docs/round-trip.md).</summary>
internal static class RoundTripCommand
{
    internal static int Run(string[] arguments, TextWriter output, TextWriter error, RoundTripHooks? hooks = null)
    {
        throw new NotImplementedException();
    }
}
