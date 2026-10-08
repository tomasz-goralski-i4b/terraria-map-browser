using System.Text;
using System.Text.Json;

namespace Terraria.WorldCodec;

/// <summary>Shared metadata and content JSON contract for CWM exports.</summary>
internal static class CanonicalWorldJson
{
    internal static void WriteMetadata(Utf8JsonWriter writer, WorldMetadata metadata, bool binaryStrings = false)
    {
        writer.WriteStartObject("metadata");
        WriteString(writer, "name", metadata.Name, binaryStrings);
        WriteString(writer, "seed", metadata.Seed, binaryStrings);
        WriteString(writer, "guid", metadata.GuidHex, binaryStrings);
        writer.WriteNumber("worldId", metadata.WorldId);
        if (metadata.GameMode is { } mode)
        {
            writer.WriteNumber("gameMode", (int)mode);
        }
        else
        {
            writer.WriteNull("gameMode");
        }

        WriteString(writer, "evil", metadata.Evil == WorldEvil.Crimson ? "crimson" : "corruption", binaryStrings);
        writer.WriteEndObject();
    }

    internal static void WriteContent(Utf8JsonWriter writer, ContentRef content, bool binaryStrings = false)
    {
        writer.WriteStartObject();
        switch (content)
        {
            case VanillaContentRef vanilla:
                WriteString(writer, "kind", "vanilla", binaryStrings);
                writer.WriteNumber("id", vanilla.Id);
                break;
            case ModContentRef mod:
                WriteString(writer, "kind", "mod", binaryStrings);
                WriteString(writer, "mod", mod.Mod, binaryStrings);
                WriteString(writer, "internalName", mod.InternalName, binaryStrings);
                if (mod.RuntimeId is { } runtimeId)
                {
                    writer.WriteNumber("runtimeId", runtimeId);
                }

                if (mod.ModVersion is { } modVersion)
                {
                    WriteString(writer, "modVersion", modVersion, binaryStrings);
                }

                break;
            case UnknownContentRef unknown:
                WriteString(writer, "kind", "unknown", binaryStrings);
                writer.WriteNumber("runtimeId", unknown.RuntimeId);
                break;
            default:
                throw new NotSupportedException($"Unsupported content reference {content.GetType().Name}.");
        }

        writer.WriteEndObject();
    }

    private static void WriteString(Utf8JsonWriter writer, string property, string? value, bool binaryStrings)
    {
        if (!binaryStrings || value is null)
        {
            writer.WriteString(property, value);
            return;
        }

        var escaped = new StringBuilder(value.Length + 2);
        escaped.Append('"');
        // EnumerateRunes replaces each unpaired UTF-16 surrogate with U+FFFD.
        foreach (var rune in value.EnumerateRunes())
        {
            var escape = rune.Value switch
            {
                '"' => "\\\"",
                '\\' => "\\\\",
                '\b' => "\\b",
                '\t' => "\\t",
                '\n' => "\\n",
                '\f' => "\\f",
                '\r' => "\\r",
                _ => null,
            };
            if (escape is not null)
            {
                escaped.Append(escape);
            }
            else if (rune.Value < 0x20)
            {
                const string Hex = "0123456789abcdef";
                escaped.Append("\\u00").Append(Hex[rune.Value >> 4]).Append(Hex[rune.Value & 0xf]);
            }
            else
            {
                escaped.Append(rune.ToString());
            }
        }

        escaped.Append('"');
        writer.WritePropertyName(property);
        // This complete JSON string follows CWM's escaping contract independently of runtime encoder allow-lists.
        writer.WriteRawValue(Encoding.UTF8.GetBytes(escaped.ToString()), skipInputValidation: true);
    }
}
