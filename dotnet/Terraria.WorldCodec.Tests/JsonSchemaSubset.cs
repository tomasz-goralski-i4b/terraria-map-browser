using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Terraria.WorldCodec.Tests;

/// <summary>
/// A JSON Schema (draft 2020-12) validator for the keywords the contracts use, so the tests need no package.
/// Any other keyword makes validation fail loudly instead of being ignored.
/// </summary>
internal sealed class JsonSchemaSubset
{
    private static readonly HashSet<string> Annotations = ["$schema", "$id", "title", "description", "$defs"];

    private readonly JsonElement root;

    private JsonSchemaSubset(JsonElement root) => this.root = root;

    /// <summary>Loads a schema from <c>contracts/schemas</c> as copied next to the test assembly.</summary>
    public static JsonSchemaSubset Load(string fileName)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "contracts", "schemas", fileName);
        using var document = JsonDocument.Parse(File.ReadAllBytes(path));
        return new JsonSchemaSubset(document.RootElement.Clone());
    }

    /// <summary>Validation errors as "path: message"; empty when the instance is valid.</summary>
    public IReadOnlyList<string> Validate(JsonElement instance)
    {
        var errors = new List<string>();
        Validate(root, instance, "$", errors);
        return errors;
    }

    /// <summary>Fails the test with every error.</summary>
    public void AssertValid(byte[] utf8Json)
    {
        using var document = JsonDocument.Parse(utf8Json);
        var errors = Validate(document.RootElement);
        Assert.True(errors.Count == 0, "Schema violations:\n" + string.Join("\n", errors.Take(20)));
    }

    private void Validate(JsonElement schema, JsonElement instance, string path, List<string> errors)
    {
        foreach (var keyword in schema.EnumerateObject())
        {
            var value = keyword.Value;
            switch (keyword.Name)
            {
                case var name when Annotations.Contains(name):
                    break;
                case "$ref":
                    Validate(Resolve(value.GetString()!), instance, path, errors);
                    break;
                case "type":
                    var types = value.ValueKind == JsonValueKind.Array
                        ? value.EnumerateArray().Select(type => type.GetString()!).ToArray()
                        : [value.GetString()!];
                    if (!types.Any(type => HasType(instance, type)))
                    {
                        errors.Add($"{path}: expected type {string.Join("|", types)}, got {instance.ValueKind}");
                    }

                    break;
                case "const":
                    if (!JsonElement.DeepEquals(value, instance))
                    {
                        errors.Add($"{path}: expected {value.GetRawText()}");
                    }

                    break;
                case "enum":
                    if (!value.EnumerateArray().Any(option => JsonElement.DeepEquals(option, instance)))
                    {
                        errors.Add($"{path}: {instance.GetRawText()} is not one of {value.GetRawText()}");
                    }

                    break;
                case "pattern":
                    if (instance.ValueKind == JsonValueKind.String &&
                        !Regex.IsMatch(instance.GetString()!, value.GetString()!, RegexOptions.None, TimeSpan.FromSeconds(1)))
                    {
                        errors.Add($"{path}: '{instance.GetString()}' does not match {value.GetString()}");
                    }

                    break;
                case "minimum":
                    if (instance.ValueKind == JsonValueKind.Number && instance.GetDecimal() < value.GetDecimal())
                    {
                        errors.Add($"{path}: {instance.GetRawText()} < {value.GetRawText()}");
                    }

                    break;
                case "maximum":
                    if (instance.ValueKind == JsonValueKind.Number && instance.GetDecimal() > value.GetDecimal())
                    {
                        errors.Add($"{path}: {instance.GetRawText()} > {value.GetRawText()}");
                    }

                    break;
                case "minItems":
                    if (instance.ValueKind == JsonValueKind.Array && instance.GetArrayLength() < value.GetInt32())
                    {
                        errors.Add($"{path}: fewer than {value.GetInt32()} items");
                    }

                    break;
                case "maxItems":
                    if (instance.ValueKind == JsonValueKind.Array && instance.GetArrayLength() > value.GetInt32())
                    {
                        errors.Add($"{path}: more than {value.GetInt32()} items");
                    }

                    break;
                case "items":
                    if (instance.ValueKind == JsonValueKind.Array)
                    {
                        var index = 0;
                        foreach (var item in instance.EnumerateArray())
                        {
                            Validate(value, item, string.Create(CultureInfo.InvariantCulture, $"{path}[{index++}]"), errors);
                        }
                    }

                    break;
                case "required":
                    if (instance.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var property in value.EnumerateArray().Select(property => property.GetString()!))
                        {
                            if (!instance.TryGetProperty(property, out _))
                            {
                                errors.Add($"{path}: missing '{property}'");
                            }
                        }
                    }

                    break;
                case "properties":
                    if (instance.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var property in instance.EnumerateObject())
                        {
                            if (value.TryGetProperty(property.Name, out var propertySchema))
                            {
                                Validate(propertySchema, property.Value, $"{path}.{property.Name}", errors);
                            }
                        }
                    }

                    break;
                case "additionalProperties":
                    if (value.ValueKind != JsonValueKind.False)
                    {
                        throw new NotSupportedException("Only 'additionalProperties: false' is supported.");
                    }

                    if (instance.ValueKind == JsonValueKind.Object)
                    {
                        var known = schema.TryGetProperty("properties", out var properties) ? properties : default;
                        foreach (var property in instance.EnumerateObject())
                        {
                            if (known.ValueKind != JsonValueKind.Object || !known.TryGetProperty(property.Name, out _))
                            {
                                errors.Add($"{path}: unexpected property '{property.Name}'");
                            }
                        }
                    }

                    break;
                case "oneOf":
                    var matches = value.EnumerateArray().Count(option =>
                    {
                        var optionErrors = new List<string>();
                        Validate(option, instance, path, optionErrors);
                        return optionErrors.Count == 0;
                    });
                    if (matches != 1)
                    {
                        errors.Add($"{path}: matches {matches} of the oneOf alternatives instead of exactly one");
                    }

                    break;
                default:
                    throw new NotSupportedException($"JSON Schema keyword '{keyword.Name}' is not supported by the test validator.");
            }
        }
    }

    private JsonElement Resolve(string reference)
    {
        const string Prefix = "#/$defs/";
        if (!reference.StartsWith(Prefix, StringComparison.Ordinal))
        {
            throw new NotSupportedException($"Only local '{Prefix}…' references are supported, not '{reference}'.");
        }

        return root.GetProperty("$defs").GetProperty(reference[Prefix.Length..]);
    }

    private static bool HasType(JsonElement instance, string type) => type switch
    {
        "object" => instance.ValueKind == JsonValueKind.Object,
        "array" => instance.ValueKind == JsonValueKind.Array,
        "string" => instance.ValueKind == JsonValueKind.String,
        "boolean" => instance.ValueKind is JsonValueKind.True or JsonValueKind.False,
        "null" => instance.ValueKind == JsonValueKind.Null,
        "number" => instance.ValueKind == JsonValueKind.Number,
        "integer" => instance.ValueKind == JsonValueKind.Number && instance.TryGetInt64(out _),
        _ => throw new NotSupportedException($"JSON Schema type '{type}' is not supported."),
    };
}
