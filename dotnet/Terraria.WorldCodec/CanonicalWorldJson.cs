using System.Text.Json;

namespace Terraria.WorldCodec;

/// <summary>Shared metadata and content JSON contract for CWM exports.</summary>
internal static class CanonicalWorldJson
{
    internal static void WriteMetadata(Utf8JsonWriter writer, WorldMetadata metadata)
    {
        writer.WriteStartObject("metadata");
        writer.WriteString("name", metadata.Name);
        writer.WriteString("seed", metadata.Seed);
        writer.WriteString("guid", metadata.GuidHex);
        writer.WriteNumber("worldId", metadata.WorldId);
        if (metadata.GameMode is { } mode)
        {
            writer.WriteNumber("gameMode", (int)mode);
        }
        else
        {
            writer.WriteNull("gameMode");
        }

        writer.WriteString("evil", metadata.Evil == WorldEvil.Crimson ? "crimson" : "corruption");
        writer.WriteEndObject();
    }

    internal static void WriteContent(Utf8JsonWriter writer, ContentRef content)
    {
        writer.WriteStartObject();
        switch (content)
        {
            case VanillaContentRef vanilla:
                writer.WriteString("kind", "vanilla");
                writer.WriteNumber("id", vanilla.Id);
                break;
            case ModContentRef mod:
                writer.WriteString("kind", "mod");
                writer.WriteString("mod", mod.Mod);
                writer.WriteString("internalName", mod.InternalName);
                if (mod.RuntimeId is { } runtimeId)
                {
                    writer.WriteNumber("runtimeId", runtimeId);
                }

                if (mod.ModVersion is { } modVersion)
                {
                    writer.WriteString("modVersion", modVersion);
                }

                break;
            case UnknownContentRef unknown:
                writer.WriteString("kind", "unknown");
                writer.WriteNumber("runtimeId", unknown.RuntimeId);
                break;
            default:
                throw new NotSupportedException($"Unsupported content reference {content.GetType().Name}.");
        }

        writer.WriteEndObject();
    }
}
