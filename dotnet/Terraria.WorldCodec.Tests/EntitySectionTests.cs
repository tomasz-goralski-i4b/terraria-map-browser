using System.Text.Json;
using System.Text.Json.Nodes;

namespace Terraria.WorldCodec.Tests;

public sealed class EntitySectionTests
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static IEnumerable<object[]> Vectors()
    {
        using var document = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "contracts", "vectors", "entities.vectors.json")));
        foreach (var vector in document.RootElement.GetProperty("vectors").EnumerateArray())
        {
            yield return [vector.GetProperty("id").GetString()!, vector.GetRawText()];
        }
    }

    [Theory]
    [MemberData(nameof(Vectors))]
    public void Read_SharedEntityVector_MatchesEveryField(string id, string json)
    {
        using var document = JsonDocument.Parse(json);
        var vector = document.RootElement;
        var bytes = Convert.FromHexString(vector.GetProperty("hex").GetString()!);
        var start = vector.GetProperty("start").GetInt32();
        using var stream = new MemoryStream(new byte[start].Concat(bytes).ToArray());
        var boundary = new WorldSectionBoundary(start, vector.GetProperty("end").GetInt32());
        var section = vector.GetProperty("section").GetString()!;
        var version = vector.TryGetProperty("version", out var versionProperty) ? versionProperty.GetInt32() : 326;
        if (vector.TryGetProperty("error", out var expectedError))
        {
            var error = Assert.Throws<WorldFormatException>(() => EntitySectionReader.Read(stream, section, boundary, version));
            Assert.Equal("MalformedSection", error.Error.ToString());
            Assert.Equal(section, error.Section);
            Assert.Equal(expectedError.GetProperty("field").GetString(), error.Field);
            Assert.Equal(expectedError.GetProperty("offset").GetInt64(), error.Offset);
            Assert.Equal(expectedError.GetProperty("reason").GetString(), error.Reason);
        }
        else
        {
            var actual = EntitySectionReader.Read(stream, section, boundary, version);
            var actualJson = JsonSerializer.SerializeToNode(actual, actual.GetType(), JsonOptions);
            Assert.True(JsonNode.DeepEquals(JsonNode.Parse(vector.GetProperty("result").GetRawText()), actualJson), $"{id}: {actualJson}");
        }
    }

    [Theory]
    [InlineData(268)]
    [InlineData(300)]
    [InlineData(311)]
    [InlineData(327)]
    public void Read_FormatWithoutKnownEntityLayout_IsUnsupported(int version)
    {
        using var stream = new MemoryStream([0, 0]);
        var error = Assert.Throws<WorldFormatException>(() => EntitySectionReader.Read(stream, "Signs", new WorldSectionBoundary(0, 2), version));
        Assert.Equal(WorldFormatError.UnsupportedVersion, error.Error);
        Assert.Equal($"format version {version} is not supported", error.Reason);
    }
}
