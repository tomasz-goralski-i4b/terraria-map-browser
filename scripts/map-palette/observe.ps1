# Samples how a local Terraria installation colours its map, for the opt-in conformance test (observe.test.mjs):
#   ./scripts/map-palette/observe.ps1 -TerrariaAssembly '<Terraria directory>/TerrariaServer.exe' -OutputPath out.json
# Black-box observation (ADR 0002): the game's own map functions are called on synthetic input and only their
# results are recorded. No game code is read. The output is game-derived and never committed.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TerrariaAssembly,
    [Parameter(Mandatory = $true)][string]$OutputPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Same 32-bit host requirement as export.ps1.
if ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitProcess) {
    $hostPath = Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    if (Test-Path -LiteralPath $hostPath) {
        & $hostPath -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -TerrariaAssembly $TerrariaAssembly -OutputPath $OutputPath
        if ($LASTEXITCODE -ne 0) { throw 'Map observation failed in the 32-bit .NET Framework host.' }
        return
    }
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;

public static class MapObserver {
    const BindingFlags Static = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
    static Assembly game;
    static string directory;

    static Assembly Resolve(object sender, ResolveEventArgs request) {
        string name = new AssemblyName(request.Name).Name;
        string file = Path.Combine(directory, name + ".dll");
        if (File.Exists(file)) return Assembly.LoadFrom(file);
        if (game == null) return null;
        foreach (string resource in game.GetManifestResourceNames()) {
            if (resource == name + ".dll" || resource.EndsWith("." + name + ".dll", StringComparison.OrdinalIgnoreCase)) {
                using (Stream stream = game.GetManifestResourceStream(resource))
                using (MemoryStream buffer = new MemoryStream()) { stream.CopyTo(buffer); return Assembly.Load(buffer.ToArray()); }
            }
        }
        return null;
    }

    static object Field(Type type, string name) { return type.GetField(name, Static).GetValue(null); }
    static void Set(Type type, string name, object value) { type.GetField(name, Static).SetValue(null, value); }
    static string Hex(object color) {
        Type type = color.GetType();
        Func<string, int> channel = c => Convert.ToInt32(type.GetProperty(c).GetValue(color, null));
        return string.Format("\"{0:x2}{1:x2}{2:x2}\"", channel("R"), channel("G"), channel("B"));
    }

    public static string Observe(string path) {
        directory = Path.GetDirectoryName(path);
        AppDomain.CurrentDomain.AssemblyResolve += Resolve;
        game = Assembly.LoadFrom(path);
        Type program = game.GetType("Terraria.Program");
        if (program.GetField("SavePath", Static).GetValue(null) == null) Set(program, "SavePath", Path.GetTempPath());
        Type map = game.GetType("Terraria.Map.MapHelper", true);
        map.GetMethod("Initialize", Static, null, Type.EmptyTypes, null).Invoke(null, null);
        Array colors = (Array)Field(map, "colorLookup");
        Type main = game.GetType("Terraria.Main", true);
        Type tileType = game.GetType("Terraria.Tile", true);
        Type mapTile = game.GetType("Terraria.Map.MapTile", true);
        MethodInfo createMapTile = map.GetMethod("CreateMapTile", Static);
        MethodInfo create = mapTile.GetMethod("Create", Static);
        MethodInfo mapColor = map.GetMethod("GetMapTileXnaColor", Static);
        FieldInfo typeField = mapTile.GetField("Type");
        // Wide enough for whatever neighbourhood the game inspects around the sampled column.
        const int width = 200;
        var json = new StringBuilder("{\"levels\":[");

        // Empty space down whole columns of synthetic worlds with fractional layer levels.
        double[][] worlds = { new double[] { 1500, 300.6, 500.4 }, new double[] { 2400, 550.9999, 850.0001 } };
        for (int w = 0; w < worlds.Length; w++) {
            int height = (int)worlds[w][0];
            Set(main, "maxTilesX", width);
            Set(main, "maxTilesY", height);
            Set(main, "worldSurface", worlds[w][1]);
            Set(main, "rockLayer", worlds[w][2]);
            Array tiles = Array.CreateInstance(tileType, width, height);
            for (int x = 0; x < width; x++) for (int y = 0; y < height; y++) tiles.SetValue(Activator.CreateInstance(tileType), x, y);
            Set(main, "tile", tiles);
            FieldInfo worldMap = main.GetField("Map", Static);
            worldMap.SetValue(null, Activator.CreateInstance(worldMap.FieldType, width, height));
            json.AppendFormat(System.Globalization.CultureInfo.InvariantCulture,
                "{0}{{\"height\":{1},\"surface\":{2:R},\"rock\":{3:R},\"rows\":[", w == 0 ? "" : ",", height, worlds[w][1], worlds[w][2]);
            for (int y = 0; y < height; y++) {
                object tile = createMapTile.Invoke(null, new object[] { width / 2, y, (byte)255, 0 });
                json.Append(y == 0 ? "" : ",").Append(Hex(colors.GetValue(Convert.ToInt32(typeField.GetValue(tile)))));
            }
            json.Append("]}");
        }

        // Every tile and wall map colour under every paint.
        int wallStart = Convert.ToInt32(Field(map, "wallPosition"));
        int wallEnd = Convert.ToInt32(Field(map, "liquidPosition"));
        int paintCount = 0;
        foreach (FieldInfo paint in game.GetType("Terraria.ID.PaintID", true).GetFields(Static))
            if (paint.IsLiteral) paintCount = Math.Max(paintCount, Convert.ToInt32(paint.GetRawConstantValue()) + 1);
        json.Append("],\"paints\":[");
        for (int index = 1; index < wallEnd; index++) {
            json.AppendFormat("{0}{{\"layer\":\"{1}\",\"base\":{2},\"painted\":[", index == 1 ? "" : ",",
                index < wallStart ? "block" : "wall", Hex(colors.GetValue(index)));
            for (int paint = 0; paint < paintCount; paint++) {
                object tile = create.Invoke(null, new object[] { (ushort)index, (byte)255, (byte)paint });
                json.Append(paint == 0 ? "" : ",").Append(Hex(mapColor.Invoke(null, new object[] { tile, width / 2, 4 })));
            }
            json.Append("]}");
        }
        return json.Append("]}").ToString();
    }
}
'@

try {
    $json = [MapObserver]::Observe((Resolve-Path -LiteralPath $TerrariaAssembly).Path)
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json, (New-Object Text.UTF8Encoding($false)))
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    throw ('Map observation failed: ' + $cause.GetType().Name + ': ' + $cause.Message)
}
