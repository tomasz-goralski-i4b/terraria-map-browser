using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit.Sdk;

namespace Terraria.WorldCodec.Tests;

[CollectionDefinition("Shared contract working directory", DisableParallelization = true)]
public sealed class SharedContractWorkingDirectoryTests;

[Collection("Shared contract working directory")]
public sealed class SharedContractVectorTests
{
    private static readonly string[] VectorFiles = ["tiles.vectors.json", "runs.vectors.json", "metadata.vectors.json"];

    private static string VectorDirectory => Path.Combine(AppContext.BaseDirectory, "contracts", "vectors");

    public static IEnumerable<object[]> Cases()
    {
        foreach (var fileName in VectorFiles)
        {
            using var document = ReadFixture(fileName);
            foreach (var vector in document.RootElement.GetProperty("vectors").EnumerateArray())
            {
                var index = 0;
                foreach (var vectorCase in vector.GetProperty("cases").EnumerateArray())
                {
                    yield return [fileName, vector.GetProperty("id").GetString()!, index++, vector.GetRawText(), vectorCase.GetRawText()];
                }
            }
        }
    }

    public static IEnumerable<object[]> InvalidDocuments()
    {
        using var mutations = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(VectorDirectory, "malformed", "mutations.json")));
        foreach (var mutation in mutations.RootElement.GetProperty("cases").EnumerateArray())
        {
            if (mutation.GetProperty("schema").GetString() != "vector.v1")
            {
                continue;
            }

            var fileName = mutation.GetProperty("file").GetString()!;
            using var fixture = ReadFixture(fileName);
            var document = JsonNode.Parse(fixture.RootElement.GetRawText())!;
            var path = mutation.GetProperty("path").EnumerateArray().ToArray();
            var parent = document;
            foreach (var segment in path[..^1])
            {
                parent = segment.ValueKind == JsonValueKind.Number
                    ? parent[segment.GetInt32()]!
                    : parent[segment.GetString()!]!;
            }

            var last = path[^1];
            if (last.ValueKind == JsonValueKind.Number)
            {
                parent[last.GetInt32()] = JsonNode.Parse(mutation.GetProperty("value").GetRawText());
            }
            else if (mutation.GetProperty("op").GetString() == "delete")
            {
                parent.AsObject().Remove(last.GetString()!);
            }
            else
            {
                parent[last.GetString()!] = JsonNode.Parse(mutation.GetProperty("value").GetRawText());
            }

            var semantic = mutation.TryGetProperty("validation", out var validation) && validation.GetString() == "semantic";
            yield return [mutation.GetProperty("name").GetString()!, fileName, document.ToJsonString(), semantic];
        }
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Decode_SharedVectorCase_MatchesEveryExpectedField(
        string fileName, string vectorId, int caseIndex, string vectorJson, string caseJson)
    {
        using var document = ReadFixture(fileName);
        SharedContractVectorHarness.ValidateDocument(document.RootElement, fileName);
        using var vector = JsonDocument.Parse(vectorJson);
        using var vectorCase = JsonDocument.Parse(caseJson);
        var actual = SharedContractVectorHarness.Decode(vector.RootElement, vectorCase.RootElement);

        AssertOutcome(vectorId + "/" + caseIndex.ToString(CultureInfo.InvariantCulture), vectorCase.RootElement, actual);
    }

    [Fact]
    public void LoadAll_PublishedFiles_ReturnsEveryVectorAndVariant()
    {
        var documents = SharedContractVectorHarness.LoadAll(VectorDirectory);
        Assert.Equal(3, documents.Count);
        var actualIds = documents.SelectMany(document => document.GetProperty("vectors").EnumerateArray())
            .Select(vector => vector.GetProperty("id").GetString()!).Order(StringComparer.Ordinal).ToArray();
        var expectedIds = Enumerable.Range(1, 17).Select(number => "T" + number.ToString(CultureInfo.InvariantCulture))
            .Concat(Enumerable.Range(1, 10).Select(number => "R" + number.ToString(CultureInfo.InvariantCulture)))
            .Concat(Enumerable.Range(1, 5).Select(number => "M" + number.ToString(CultureInfo.InvariantCulture)))
            .Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(expectedIds, actualIds);
        Assert.Equal(Cases().Count(), documents.Sum(document => document.GetProperty("vectors").EnumerateArray()
            .Sum(vector => vector.GetProperty("cases").GetArrayLength())));
    }

    [Theory]
    [MemberData(nameof(InvalidDocuments))]
    public void ValidateDocument_MalformedSharedMutation_FailsExplicitly(string mutationName, string fileName, string json, bool semantic)
    {
        using var document = JsonDocument.Parse(json);
        var structuralErrors = JsonSchemaSubset.Load("vector.v1.schema.json").Validate(document.RootElement);
        if (semantic)
        {
            Assert.Empty(structuralErrors);
        }
        else
        {
            Assert.NotEmpty(structuralErrors);
        }

        var exception = Assert.Throws<InvalidDataException>(() =>
            SharedContractVectorHarness.ValidateDocument(document.RootElement, fileName));
        Assert.True(exception.Message.Contains(fileName, StringComparison.Ordinal), mutationName + ": missing file diagnostic");
        Assert.Contains("$", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Decode_UnknownEntryPoint_FailsExplicitly()
    {
        using var document = ReadFixture("tiles.vectors.json");
        var vector = JsonNode.Parse(document.RootElement.GetProperty("vectors")[0].GetRawText())!;
        vector["entry"] = "FILE";
        using var changed = JsonDocument.Parse(vector.ToJsonString());

        var exception = Assert.Throws<InvalidDataException>(() =>
            SharedContractVectorHarness.Decode(changed.RootElement, changed.RootElement.GetProperty("cases")[0]));
        Assert.Contains("T1", exception.Message, StringComparison.Ordinal);
        Assert.Contains("entry", exception.Message, StringComparison.Ordinal);
        Assert.Contains("FILE", exception.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("tiles.vectors.json")]
    [InlineData("runs.vectors.json")]
    [InlineData("metadata.vectors.json")]
    public void LoadAll_MissingRequiredFile_FailsWithFileName(string missingFile)
    {
        var directory = Directory.CreateTempSubdirectory("terraria-contract-vectors-");
        try
        {
            foreach (var fileName in VectorFiles.Where(fileName => fileName != missingFile))
            {
                File.Copy(Path.Combine(VectorDirectory, fileName), Path.Combine(directory.FullName, fileName));
            }

            var exception = Assert.Throws<FileNotFoundException>(() => SharedContractVectorHarness.LoadAll(directory.FullName));
            Assert.Equal(Path.Combine(directory.FullName, missingFile), exception.FileName);
        }
        finally
        {
            directory.Delete(recursive: true);
        }
    }

    [Theory]
    [InlineData("tiles.vectors.json", "T4", "result.tile.block.id", 257)]
    [InlineData("runs.vectors.json", "R9", "error.offset", 101)]
    public void Decode_MismatchedExpectation_DiagnosticNamesVectorAndField(string fileName, string vectorId, string field, int value)
    {
        using var document = ReadFixture(fileName);
        var vector = document.RootElement.GetProperty("vectors").EnumerateArray()
            .Single(vector => vector.GetProperty("id").GetString() == vectorId);
        var vectorCase = vector.GetProperty("cases")[0];
        var actual = SharedContractVectorHarness.Decode(vector, vectorCase);
        var changed = JsonNode.Parse(vectorCase.GetRawText())!;
        var segments = field.Split('.');
        var parent = changed;
        foreach (var segment in segments[..^1])
        {
            parent = parent[segment]!;
        }

        parent[segments[^1]] = value;
        using var expectation = JsonDocument.Parse(changed.ToJsonString());
        var exception = Assert.ThrowsAny<XunitException>(() => AssertOutcome(vectorId, expectation.RootElement, actual));
        Assert.Contains(vectorId, exception.Message, StringComparison.Ordinal);
        Assert.Contains(field, exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void LoadAll_AlternateWorkingDirectory_LoadsAndExecutesAllCases()
    {
        var originalDirectory = Directory.GetCurrentDirectory();
        try
        {
            Directory.SetCurrentDirectory(Path.GetTempPath());
            var documents = SharedContractVectorHarness.LoadAll(VectorDirectory);
            Assert.Equal(3, documents.Count);
            foreach (var vector in documents.SelectMany(document => document.GetProperty("vectors").EnumerateArray()))
            {
                foreach (var vectorCase in vector.GetProperty("cases").EnumerateArray())
                {
                    AssertOutcome(vector.GetProperty("id").GetString()!, vectorCase, SharedContractVectorHarness.Decode(vector, vectorCase));
                }
            }
        }
        finally
        {
            Directory.SetCurrentDirectory(originalDirectory);
        }
    }

    private static JsonDocument ReadFixture(string fileName) => JsonDocument.Parse(File.ReadAllBytes(Path.Combine(VectorDirectory, fileName)));

    private static void AssertOutcome(string vectorId, JsonElement vectorCase, JsonElement actual)
    {
        var outcome = vectorCase.TryGetProperty("result", out var result) ? "result" : "error";
        var expected = outcome == "result" ? result : vectorCase.GetProperty("error");
        Assert.True(actual.ValueKind == JsonValueKind.Object && actual.TryGetProperty(outcome, out _), vectorId + ": " + outcome + " missing");
        AssertFields(vectorId, outcome, expected, actual.GetProperty(outcome));
    }

    private static void AssertFields(string vectorId, string path, JsonElement expected, JsonElement actual)
    {
        Assert.True(expected.ValueKind == actual.ValueKind, vectorId + ": " + path + " kind differs");
        if (expected.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in expected.EnumerateObject())
            {
                var field = path + "." + property.Name;
                Assert.True(actual.TryGetProperty(property.Name, out var value), vectorId + ": " + field + " missing");
                AssertFields(vectorId, field, property.Value, value);
            }
        }
        else if (expected.ValueKind == JsonValueKind.Array)
        {
            Assert.True(expected.GetArrayLength() == actual.GetArrayLength(), vectorId + ": " + path + " length differs");
            for (var index = 0; index < expected.GetArrayLength(); index++)
            {
                AssertFields(vectorId, path + "[" + index.ToString(CultureInfo.InvariantCulture) + "]", expected[index], actual[index]);
            }
        }
        else
        {
            Assert.True(JsonElement.DeepEquals(expected, actual), vectorId + ": " + path + " expected " + expected.GetRawText() + ", got " + actual.GetRawText());
        }
    }
}
