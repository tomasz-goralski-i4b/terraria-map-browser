namespace Terraria.WorldCodec.Tests;

public class SmokeTests
{
    [Fact]
    public void CodecAssembly_IsLoadable()
    {
        Assert.Equal("Terraria.WorldCodec", typeof(CodecAssembly).Assembly.GetName().Name);
    }
}
