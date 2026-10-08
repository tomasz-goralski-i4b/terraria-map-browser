namespace Terraria.WorldCodec.Tests;

/// <summary>
/// Test-only comparison of an original and a reloaded world for the round-trip proof (#44; docs/file-format/writer.md,
/// "Evidence: original vs candidate layout"). It compares the semantic model field by field and every byte the model
/// does not expose, so a hash match alone is never the evidence.
/// </summary>
internal static class RoundTripEvidence
{
    /// <summary>The bytes of a corpus fixture; a missing fixture is an error, never a skip.</summary>
    /// <exception cref="FileNotFoundException">The fixture file does not exist.</exception>
    public static byte[] LoadFixture(string file) => throw new NotImplementedException();

    /// <summary>
    /// Every difference between <paramref name="original"/> and <paramref name="reloaded"/>, empty when equal. Each line starts
    /// with the part that differs: <c>Header</c>, <c>Metadata</c> (modeled fields), <c>Tile (x,y)</c>, or a byte section name
    /// (<c>FileHeader</c>, <c>Metadata</c>, the names of sections 3-10 in <see cref="WorldSectionTable"/>, <c>Footer</c>),
    /// followed by <c>: relative offset N</c> (offset of the first differing byte inside that section) or <c>: length</c>
    /// for size differences.
    /// </summary>
    public static IReadOnlyList<string> Differences(WorldEnvelope original, WorldEnvelope reloaded) =>
        throw new NotImplementedException();
}
