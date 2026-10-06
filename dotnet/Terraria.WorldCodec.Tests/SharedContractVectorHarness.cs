using System.Text.Json;

namespace Terraria.WorldCodec.Tests;

/// <summary>Test-only adapter for the shared REC, SEC and META contract entry points.</summary>
internal static class SharedContractVectorHarness
{
    /// <summary>Loads all three required files from an absolute vector directory and validates both layers.</summary>
    public static IReadOnlyList<JsonElement> LoadAll(string vectorDirectory) => throw new NotImplementedException();

    /// <summary>Rejects schema violations and semantic inconsistencies with file and field diagnostics.</summary>
    public static void ValidateDocument(JsonElement document, string fileName) => throw new NotImplementedException();

    /// <summary>
    /// Decodes the supplied bytes at the declared entry point, returning a normalized result/error envelope.
    /// Results include all contract fields; errors include their absolute offset and any declared details.
    /// No installed game or whole-world fixture is needed.
    /// </summary>
    public static JsonElement Decode(JsonElement vector, JsonElement vectorCase) => throw new NotImplementedException();
}
