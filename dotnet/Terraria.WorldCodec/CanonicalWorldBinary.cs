namespace Terraria.WorldCodec;

/// <summary>Writes the deterministic CWM v1 binary framing specified in docs/cwm.md.</summary>
public static class CanonicalWorldBinary
{
    /// <summary>Writes a world using the requested CWM schema version, leaving the output stream open.</summary>
    public static void Write(World world, Stream output, int schemaVersion = 1) =>
        throw new NotImplementedException();
}
