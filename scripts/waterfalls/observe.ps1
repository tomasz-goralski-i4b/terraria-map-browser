# Observes where a local Terraria installation starts waterfalls (docs/assets.md, "Waterfalls"):
#   ./scripts/waterfalls/observe.ps1 -TerrariaAssembly '<Terraria directory>/TerrariaServer.exe' -CasesPath cases.json -OutputPath local-renders/waterfalls.json
# Black-box observation (ADR 0003, waterfall addendum): each case's tiles are placed in a synthetic world and the
# game's own source finder (WaterfallManager.FindWaterfalls, over a "screen" covering the world) is asked for the
# sources it finds; only those are recorded, with the manager's numeric limits. No game code is read. The output is
# game-derived and stays local.
#
# cases.json: [[[dx, dy, "code"], ...], ...]: tiles around (32, 32), the rest air. Codes: "#" stone, "h" half block,
# "s1"–"s4" the game's slopes 1–4, "p" a platform, "W<n>", "L<n>", "Y<n>", "S<n>" water, lava, honey, shimmer of
# amount n.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TerrariaAssembly,
    [Parameter(Mandatory = $true)][string]$CasesPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Same 32-bit host requirement as scripts/framing/observe.ps1.
if ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitProcess) {
    $hostPath = Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    if (Test-Path -LiteralPath $hostPath) {
        & $hostPath -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -TerrariaAssembly $TerrariaAssembly -CasesPath $CasesPath -OutputPath $OutputPath
        if (-not (Test-Path -LiteralPath $OutputPath)) { throw 'Waterfall observation failed in the 32-bit .NET Framework host.' }
        return
    }
}

Add-Type -TypeDefinition @'
using System;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;

public static class WaterfallObserver {
    const BindingFlags All = BindingFlags.Static | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
    const int Size = 64;
    static Assembly game;
    static string directory;
    static Type mainType, tileType;
    static Array world;
    static object manager;

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

    static FieldInfo Field(Type type, string name) {
        FieldInfo field = type.GetField(name, All);
        if (field == null) throw new InvalidOperationException("Unsupported observation contract: " + type.Name + "." + name + ".");
        return field;
    }

    static MethodInfo Method(Type type, string name, params Type[] parameters) {
        MethodInfo method = type.GetMethod(name, All, null, parameters, null);
        if (method == null) throw new InvalidOperationException("Unsupported observation contract: " + type.Name + "." + name + ".");
        return method;
    }

    static void Initialize(string path) {
        directory = Path.GetDirectoryName(path);
        AppDomain.CurrentDomain.AssemblyResolve += Resolve;
        game = Assembly.LoadFrom(path);
        Type program = game.GetType("Terraria.Program", true);
        if (Field(program, "SavePath").GetValue(null) == null) Field(program, "SavePath").SetValue(null, Path.GetTempPath());
        mainType = game.GetType("Terraria.Main", true);
        Field(mainType, "dedServ").SetValue(null, true);
        FieldInfo random = Field(mainType, "rand");
        if (random.GetValue(null) == null) random.SetValue(null, Activator.CreateInstance(random.FieldType));
        foreach (string step in new[] { "Initialize_TileAndNPCData1", "Initialize_TileAndNPCData2", "SetupTileMerge" }) Method(mainType, step).Invoke(null, null);
        object instance = Activator.CreateInstance(mainType);
        try { Method(mainType, "Initialize").Invoke(instance, null); } catch (TargetInvocationException) { }
        tileType = game.GetType("Terraria.Tile", true);
        Field(mainType, "maxTilesX").SetValue(null, Size);
        Field(mainType, "maxTilesY").SetValue(null, Size);
        world = Array.CreateInstance(tileType, Size, Size);
        Field(mainType, "tile").SetValue(null, world);
        manager = Activator.CreateInstance(game.GetType("Terraria.WaterfallManager", true));
        FieldInfo position = Field(mainType, "screenPosition");
        object corner = Activator.CreateInstance(position.FieldType);
        corner.GetType().GetField("X").SetValue(corner, 16f * 8);
        corner.GetType().GetField("Y").SetValue(corner, 16f * 8);
        position.SetValue(null, corner);
        Field(mainType, "screenWidth").SetValue(null, 16 * (Size - 16));
        Field(mainType, "screenHeight").SetValue(null, 16 * (Size - 16));
        Field(mainType, "offScreenRange").SetValue(null, 0);
    }

    static void Clear() {
        for (int x = 0; x < Size; x++) for (int y = 0; y < Size; y++) world.SetValue(Activator.CreateInstance(tileType), x, y);
    }

    static void Put(int x, int y, string code) {
        object tile = Activator.CreateInstance(tileType);
        char kind = code[0];
        if (kind == '#' || kind == 'h' || kind == 's' || kind == 'p') {
            Field(tileType, "type").SetValue(tile, (ushort)(kind == 'p' ? 19 : 1));
            Method(tileType, "active", typeof(bool)).Invoke(tile, new object[] { true });
            if (kind == 'h') Method(tileType, "halfBrick", typeof(bool)).Invoke(tile, new object[] { true });
            if (kind == 's') Method(tileType, "slope", typeof(byte)).Invoke(tile, new object[] { byte.Parse(code.Substring(1), CultureInfo.InvariantCulture) });
        } else {
            int liquid = "WLYS".IndexOf(kind);
            if (liquid < 0) throw new InvalidOperationException("Unknown tile code " + code + ".");
            Field(tileType, "liquid").SetValue(tile, byte.Parse(code.Substring(1), CultureInfo.InvariantCulture));
            Method(tileType, "liquidType", typeof(int)).Invoke(tile, new object[] { liquid });
        }
        world.SetValue(tile, x, y);
    }

    static string Sources() {
        Method(manager.GetType(), "FindWaterfalls", typeof(bool)).Invoke(manager, new object[] { true });
        int count = (int)Field(manager.GetType(), "currentMax").GetValue(manager);
        Array found = (Array)Field(manager.GetType(), "waterfalls").GetValue(manager);
        var json = new StringBuilder("[");
        for (int i = 0; i < count; i++) {
            object data = found.GetValue(i);
            Type type = data.GetType();
            json.Append(i == 0 ? "" : ",").AppendFormat(CultureInfo.InvariantCulture, "[{0},{1},{2}]",
                (int)type.GetField("x").GetValue(data) - 32, (int)type.GetField("y").GetValue(data) - 32, type.GetField("type").GetValue(data));
        }
        return json.Append("]").ToString();
    }

    public static string Run(string path, string casesJson) {
        Initialize(path);
        var json = new StringBuilder("{\"constants\":{");
        string[] names = { "maxLength", "minWet", "waterfallDist" };
        for (int i = 0; i < names.Length; i++) {
            json.Append(i == 0 ? "" : ",").Append('"').Append(names[i]).Append("\":").Append(Field(manager.GetType(), names[i]).GetValue(manager));
        }
        json.Append("},\"cases\":[");
        // One case per top-level array element: its tiles are [dx, dy, "code"] triples.
        MatchCollection cases = Regex.Matches(casesJson, @"\[((?:\s*\[\s*-?\d+\s*,\s*-?\d+\s*,\s*""[^""]*""\s*\]\s*,?)*)\s*\]");
        int index = 0;
        foreach (Match match in cases) {
            Clear();
            foreach (Match tile in Regex.Matches(match.Groups[1].Value, @"\[\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*""([^""]*)""\s*\]")) {
                Put(32 + int.Parse(tile.Groups[1].Value, CultureInfo.InvariantCulture), 32 + int.Parse(tile.Groups[2].Value, CultureInfo.InvariantCulture), tile.Groups[3].Value);
            }
            json.Append(index++ == 0 ? "" : ",").Append(Sources());
        }
        return json.Append("]}").ToString();
    }
}
'@

try {
    $result = [WaterfallObserver]::Run((Resolve-Path -LiteralPath $TerrariaAssembly).Path, [IO.File]::ReadAllText((Resolve-Path -LiteralPath $CasesPath).Path))
    $directory = Split-Path -Parent $OutputPath
    if ($directory -and -not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory | Out-Null }
    [IO.File]::WriteAllText($OutputPath, $result, (New-Object Text.UTF8Encoding($false)))
} catch {
    [IO.File]::WriteAllText("$OutputPath.error.txt", ($_ | Out-String), (New-Object Text.UTF8Encoding($false)))
    throw
}
