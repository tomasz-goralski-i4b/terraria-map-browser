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

    // --- Map options chosen by frame ---------------------------------------------------------------------------
    // Frames sampled along each axis: the multiples of 18 (the usual 16 + 2 spacing) and of 22 (trees), up to 2000.
    static readonly int[] Frames = BuildFrames(2000);
    static int[] BuildFrames(int limit) {
        var set = new SortedSet<int>();
        for (int frame = 0; frame <= limit; frame += 18) set.Add(frame);
        for (int frame = 0; frame <= limit; frame += 22) set.Add(frame);
        return new List<int>(set).ToArray();
    }

    static Array world;
    static Type tileClass;
    static MethodInfo setActive;
    static MethodInfo createTile;
    static FieldInfo mapTileType;

    static void SetMember(object target, string name, object value) {
        const BindingFlags instance = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        FieldInfo field = target.GetType().GetField(name, instance);
        if (field != null) { field.SetValue(target, Convert.ChangeType(value, field.FieldType)); return; }
        PropertyInfo property = target.GetType().GetProperty(name, instance);
        if (property == null) throw new InvalidOperationException("Unsupported map observation contract: Tile." + name + ".");
        property.SetValue(target, Convert.ChangeType(value, property.PropertyType), null);
    }

    static object NewTile(bool wall, int id, int frameX, int frameY) {
        object tile = Activator.CreateInstance(tileClass);
        if (wall) { SetMember(tile, "wall", id); }
        else { SetMember(tile, "type", id); setActive.Invoke(tile, new object[] { true }); }
        SetMember(tile, "frameX", frameX);
        SetMember(tile, "frameY", frameY);
        return tile;
    }

    // The map option the game picks for one tile: its map colour index minus the content's first option.
    static int OptionAt(bool wall, int id, int start, int frameX, int frameY, int x, int y, bool neighbours) {
        int[][] around = { new[] { -1, 0 }, new[] { 1, 0 }, new[] { 0, -1 }, new[] { 0, 1 } };
        if (neighbours) foreach (int[] d in around) world.SetValue(NewTile(wall, id, 0, 0), x + d[0], y + d[1]);
        world.SetValue(NewTile(wall, id, frameX, frameY), x, y);
        object mapTile = createTile.Invoke(null, new object[] { x, y, (byte)255, 0 });
        int option = Convert.ToInt32(mapTileType.GetValue(mapTile)) - start;
        foreach (int[] d in around) world.SetValue(Activator.CreateInstance(tileClass), x + d[0], y + d[1]);
        world.SetValue(Activator.CreateInstance(tileClass), x, y);
        return option;
    }

    // One multi-option content: the option for every frame pair, whether it depends on anything but the frame,
    // and, when it does not, a compact rule from the frame on one axis to the option.
    static void ObserveFrames(StringBuilder json, Array colors, bool wall, int id, int start, int count) {
        int[] xs = Frames, ys = Array.FindAll(Frames, frame => frame <= 800);
        int[,] option = new int[xs.Length, ys.Length];
        bool more = false;
        // What the option depends on besides one frame coordinate, for content that is listed instead of ruled.
        string reason = null;
        for (int i = 0; i < xs.Length; i++) for (int j = 0; j < ys.Length; j++) {
            option[i, j] = OptionAt(wall, id, start, xs[i], ys[j], 100, 150, false);
            if (option[i, j] < 0 || option[i, j] >= count) { more = true; reason = "colour outside its own options"; }
        }
        // Position and neighbours: re-sample the axes and a coarse grid elsewhere and next to same-kind tiles.
        for (int i = 0; i < xs.Length && !more; i++) for (int j = 0; j < ys.Length && !more; j++) {
            if (xs[i] != 0 && ys[j] != 0 && (xs[i] > 360 || ys[j] > 360 || xs[i] % 18 != 0 || ys[j] % 18 != 0)) continue;
            if (OptionAt(wall, id, start, xs[i], ys[j], 101, 151, false) != option[i, j]) { more = true; reason = "position"; }
            else if (OptionAt(wall, id, start, xs[i], ys[j], 57, 90, true) != option[i, j]) { more = true; reason = "neighbours"; }
        }
        string axis = null;
        int[] byFrame = null;
        if (!more) {
            // The option must be one function of a single frame coordinate over the whole grid.
            int[] byX = new int[xs.Length], byY = new int[ys.Length];
            bool xOnly = true, yOnly = true;
            for (int i = 0; i < xs.Length; i++) { byX[i] = option[i, 0]; for (int j = 0; j < ys.Length; j++) if (option[i, j] != byX[i]) xOnly = false; }
            for (int j = 0; j < ys.Length; j++) { byY[j] = option[0, j]; for (int i = 0; i < xs.Length; i++) if (option[i, j] != byY[j]) yOnly = false; }
            if (xOnly) { axis = "frameX"; byFrame = byX; }
            else if (yOnly) { axis = "frameY"; byFrame = byY; }
            else { more = true; reason = "both frame coordinates"; }
        }
        json.AppendFormat("{{\"layer\":\"{0}\",\"id\":{1},\"dependsOnMore\":{2},\"dependsOn\":{3},\"rule\":",
            wall ? "wall" : "block", id, more ? "true" : "false", reason == null ? "null" : "\"" + reason + "\"");
        if (more) json.Append("null");
        else {
            int[] frames = axis == "frameX" ? xs : ys;
            json.Append("{\"axis\":\"").Append(axis).Append("\",\"ranges\":[");
            bool first = true;
            for (int k = 0; k < frames.Length; ) {
                int end = k;
                while (end + 1 < frames.Length && byFrame[end + 1] == byFrame[k]) end++;
                if (byFrame[k] != 0) {
                    int to = end + 1 < frames.Length ? frames[end + 1] - 1 : frames[end];
                    json.Append(first ? "" : ",").AppendFormat("[{0},{1},{2}]", frames[k], to, byFrame[k]);
                    first = false;
                }
                k = end + 1;
            }
            json.Append("]}");
        }
        json.Append(",\"samples\":[");
        bool firstSample = true;
        for (int i = 0; i < xs.Length; i++) for (int j = 0; j < ys.Length; j++) {
            // The axes and a coarse grid are enough to compare with the renderer.
            if (!(xs[i] == 0 || ys[j] == 0 || (xs[i] <= 180 && ys[j] <= 180 && xs[i] % 18 == 0 && ys[j] % 18 == 0))) continue;
            int sampled = option[i, j];
            if (sampled < 0 || sampled >= count) continue;
            json.Append(firstSample ? "" : ",").AppendFormat("{{\"frameX\":{0},\"frameY\":{1},\"color\":{2}}}", xs[i], ys[j], Hex(colors.GetValue(start + sampled)));
            firstSample = false;
        }
        json.Append("]}");
    }

    static void ObserveAllFrames(StringBuilder json, Type main, Type map, Array colors) {
        const int width = 200, height = 300;
        Set(main, "maxTilesX", width);
        Set(main, "maxTilesY", height);
        Set(main, "worldSurface", 100.0);
        Set(main, "rockLayer", 200.0);
        world = Array.CreateInstance(tileClass, width, height);
        for (int x = 0; x < width; x++) for (int y = 0; y < height; y++) world.SetValue(Activator.CreateInstance(tileClass), x, y);
        Set(main, "tile", world);
        FieldInfo worldMap = main.GetField("Map", Static);
        worldMap.SetValue(null, Activator.CreateInstance(worldMap.FieldType, width, height));
        bool firstContent = true;
        foreach (bool wall in new[] { false, true }) {
            Array lookup = (Array)Field(map, wall ? "wallLookup" : "tileLookup");
            Array counts = (Array)Field(map, wall ? "wallOptionCounts" : "tileOptionCounts");
            for (int id = 0; id < lookup.Length; id++) {
                int count = Convert.ToInt32(counts.GetValue(id));
                if (count < 2) continue;
                json.Append(firstContent ? "" : ",");
                firstContent = false;
                ObserveFrames(json, colors, wall, id, Convert.ToInt32(lookup.GetValue(id)), count);
            }
        }
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
        tileClass = tileType;
        setActive = tileType.GetMethod("active", new Type[] { typeof(bool) });
        if (setActive == null) throw new InvalidOperationException("Unsupported map observation contract: Tile.active(bool).");
        createTile = createMapTile;
        mapTileType = typeField;
        json.Append("],\"frames\":[");
        ObserveAllFrames(json, main, map, colors);
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
