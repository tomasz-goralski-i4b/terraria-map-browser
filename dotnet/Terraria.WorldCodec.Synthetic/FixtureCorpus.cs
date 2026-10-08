using System.Security.Cryptography;
using System.Text.Json;

namespace Terraria.WorldCodec.Synthetic;

/// <summary>Only repository corpus entries with matching provenance may be used as generator inputs.</summary>
internal static class FixtureCorpus
{
    internal static string WorldsDirectory()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "packages", "test-fixtures", "worlds");
            if (File.Exists(Path.Combine(candidate, "manifest.json")))
            {
                return candidate;
            }
        }

        throw new DirectoryNotFoundException("Run the generator from a build inside the fixture repository.");
    }

    internal static (byte[] Bytes, string GameBuild) Read(string path)
    {
        using var manifest = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(WorldsDirectory(), "manifest.json")));
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        foreach (var entry in manifest.RootElement.GetProperty("worlds").EnumerateArray())
        {
            var candidate = Path.Combine(WorldsDirectory(), entry.GetProperty("file").GetString()!);
            if (!string.Equals(Path.GetFullPath(path), Path.GetFullPath(candidate), comparison))
            {
                continue;
            }

            if (new FileInfo(path).LinkTarget is not null || entry.GetProperty("mods").GetArrayLength() != 0
                || entry.GetProperty("formatVersion").GetInt32() != 326)
            {
                throw new InvalidDataException("The base world must be an unchanged generated vanilla corpus entry.");
            }

            var bytes = File.ReadAllBytes(path);
            if (entry.GetProperty("sha256").GetString() != Hash(bytes))
            {
                throw new InvalidDataException("The base world must be an unchanged generated vanilla corpus entry.");
            }

            return (bytes, entry.GetProperty("gameVersion").GetString()!);
        }

        throw new InvalidDataException("The base world must be in packages/test-fixtures/worlds; player worlds are not inputs.");
    }

    internal static IReadOnlyList<bool> FrameImportant()
    {
        using var stream = File.OpenRead(Path.Combine(WorldsDirectory(), "SJCO1.wld"));
        return WorldReader.ReadSectionTable(stream, WorldReader.ReadHeader(stream)).FrameImportant;
    }

    internal static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
}
