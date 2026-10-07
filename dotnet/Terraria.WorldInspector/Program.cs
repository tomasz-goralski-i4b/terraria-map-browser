using System.Text;
using Terraria.WorldCodec;
using Terraria.WorldInspector;

Console.OutputEncoding = Encoding.UTF8;
return InspectorCommand.Run(args, Console.Out, Console.Error, ReadWorld);

static World ReadWorld(string path)
{
    using var stream = File.OpenRead(path);
    return WorldReader.Read(stream);
}
