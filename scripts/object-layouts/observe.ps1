# Observes how a local Terraria installation lays out multi-tile objects on their sprite sheets (#202):
#   ./scripts/object-layouts/observe.ps1 -TerrariaAssembly '<Terraria directory>/TerrariaServer.exe' -OutputPath local-renders/object-layouts.json
# Black-box observation (ADR 0003, object layouts addendum): per frame-important tile type, the game's placement data
# is read by reflection, every style an item places is placed with the game's own WorldGen.PlaceObject into a
# synthetic cavity, and the frames it writes are recorded. No game code is read. The output is game-derived and stays
# local; export.mjs turns it into the generated table the model reads.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TerrariaAssembly,
    [Parameter(Mandatory = $true)][string]$OutputPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Same 32-bit host requirement as scripts/framing/observe.ps1.
if ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitProcess) {
    $hostPath = Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    if (Test-Path -LiteralPath $hostPath) {
        & $hostPath -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -TerrariaAssembly $TerrariaAssembly -OutputPath $OutputPath
        if (-not (Test-Path -LiteralPath $OutputPath)) { throw 'Object layout observation failed in the 32-bit .NET Framework host.' }
        return
    }
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;

public static class ObjectLayoutObserver {
    const BindingFlags Static = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
    const BindingFlags Instance = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
    // The synthetic world: stone everywhere with a background wall, and a cavity of exactly the object's size, so
    // every anchor (floor, ceiling, sides, wall) the object may need is there. Objects that stand on furniture
    // (bottles, candles, books) are retried on a table (14), then on a platform (19), as the floor.
    const int Size = 64, Left = 24, Top = 24;
    // Styles placed per type when no item names its style count, and the most placed per type.
    const int MinStyles = 3, MaxStyles = 400;
    static Assembly game;
    static string directory;
    static Type mainType, tileType, objectData;
    static FieldInfo typeField, wallField, frameXField, frameYField;
    static MethodInfo setActive, isActive, getTileData, placeObject;
    static Array world;

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
        FieldInfo field = type.GetField(name, Static | Instance);
        if (field == null) throw new InvalidOperationException("Unsupported observation contract: " + type.Name + "." + name + ".");
        return field;
    }
    static MethodInfo Method(Type type, string name, params Type[] parameters) {
        MethodInfo method = type.GetMethod(name, Static | Instance, null, parameters, null);
        if (method == null) throw new InvalidOperationException("Unsupported observation contract: " + type.Name + "." + name + ".");
        return method;
    }
    static object Property(object target, string name) {
        PropertyInfo property = target.GetType().GetProperty(name, Instance);
        if (property == null) throw new InvalidOperationException("Unsupported observation contract: TileObjectData." + name + ".");
        return property.GetValue(target, null);
    }
    static int Int(object target, string name) { return Convert.ToInt32(Property(target, name), CultureInfo.InvariantCulture); }
    static int PointPart(object point, string name) { return Convert.ToInt32(Field(point.GetType(), name).GetValue(point), CultureInfo.InvariantCulture); }

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
        typeField = Field(tileType, "type");
        wallField = Field(tileType, "wall");
        frameXField = Field(tileType, "frameX");
        frameYField = Field(tileType, "frameY");
        setActive = Method(tileType, "active", typeof(bool));
        isActive = Method(tileType, "active");
        objectData = game.GetType("Terraria.ObjectData.TileObjectData", true);
        getTileData = Method(objectData, "GetTileData", typeof(int), typeof(int), typeof(int));
        Type worldGen = game.GetType("Terraria.WorldGen", true);
        placeObject = Method(worldGen, "PlaceObject", typeof(int), typeof(int), typeof(int), typeof(bool), typeof(int), typeof(int), typeof(int), typeof(int));
        Field(mainType, "maxTilesX").SetValue(null, Size);
        Field(mainType, "maxTilesY").SetValue(null, Size);
        world = Array.CreateInstance(tileType, Size, Size);
        Field(mainType, "tile").SetValue(null, world);
        FieldInfo worldMap = Field(mainType, "Map");
        worldMap.SetValue(null, Activator.CreateInstance(worldMap.FieldType, Size, Size));
    }

    // Per tile type, the styles items place: the highest placeStyle + 1 (a synthetic local player is needed for the
    // cosmetic item defaults).
    static Dictionary<int, int> ItemStyleCounts() {
        Array players = (Array)Field(mainType, "player").GetValue(null);
        players.SetValue(Activator.CreateInstance(game.GetType("Terraria.Player", true)), 0);
        Field(mainType, "myPlayer").SetValue(null, 0);
        Type item = game.GetType("Terraria.Item", true);
        MethodInfo defaults = Method(item, "SetDefaults", typeof(int), game.GetType("Terraria.GameContent.Items.ItemVariant", true));
        FieldInfo createTile = Field(item, "createTile"), placeStyle = Field(item, "placeStyle");
        int count = Convert.ToInt32(Field(game.GetType("Terraria.ID.ItemID", true), "Count").GetValue(null), CultureInfo.InvariantCulture);
        var styles = new Dictionary<int, int>();
        for (int id = 1; id < count; id++) {
            object entry = Activator.CreateInstance(item);
            defaults.Invoke(entry, new object[] { id, null });
            int tile = Convert.ToInt32(createTile.GetValue(entry), CultureInfo.InvariantCulture);
            if (tile < 0) continue;
            int style = Convert.ToInt32(placeStyle.GetValue(entry), CultureInfo.InvariantCulture) + 1;
            int known;
            if (!styles.TryGetValue(tile, out known) || known < style) styles[tile] = style;
        }
        return styles;
    }

    // The geometry of one style's placement data, as JSON: what the exporter turns into a layout.
    static string Layout(object data) {
        object origin = Property(data, "Origin");
        int[] heights = (int[])Property(data, "CoordinateHeights");
        return string.Format(CultureInfo.InvariantCulture,
            "{{\"width\":{0},\"height\":{1},\"origin\":[{2},{3}],\"horizontal\":{4},\"wrap\":{5},\"multiplier\":{6},\"lineSkip\":{7},\"fullWidth\":{8},\"fullHeight\":{9},\"coordinateWidth\":{10},\"padding\":{11},\"heights\":[{12}]}}",
            Int(data, "Width"), Int(data, "Height"), PointPart(origin, "X"), PointPart(origin, "Y"),
            (bool)Property(data, "StyleHorizontal") ? "true" : "false", Int(data, "StyleWrapLimit"), Int(data, "StyleMultiplier"),
            Int(data, "StyleLineSkip"), Int(data, "CoordinateFullWidth"), Int(data, "CoordinateFullHeight"),
            Int(data, "CoordinateWidth"), Int(data, "CoordinatePadding"), string.Join(",", Array.ConvertAll(heights, h => h.ToString(CultureInfo.InvariantCulture))));
    }

    static readonly int[] Floors = { 1, 14, 19 };

    static object NewTile(int type) {
        object tile = Activator.CreateInstance(tileType);
        if (type >= 0) { typeField.SetValue(tile, Convert.ChangeType(type, typeField.FieldType)); setActive.Invoke(tile, new object[] { true }); }
        wallField.SetValue(tile, Convert.ChangeType(4, wallField.FieldType));
        return tile;
    }

    // Places one style into a cavity of the object's size and returns the frames written there: [dx, dy, frameX,
    // frameY] per tile of the type, relative to the cavity's top-left; null when the game refuses or fails to place it
    // on every floor.
    static string Place(int type, int style, int width, int height, int originX, int originY) {
        foreach (int floor in Floors) {
            if (TryPlace(type, style, width, height, originX, originY, floor)) return Written(type, width, height);
        }
        return null;
    }

    static bool TryPlace(int type, int style, int width, int height, int originX, int originY, int floor) {
        for (int x = 0; x < Size; x++) for (int y = 0; y < Size; y++) {
            bool cavity = x >= Left && x < Left + width && y >= Top && y < Top + height;
            bool underneath = x >= Left && x < Left + width && y == Top + height;
            world.SetValue(NewTile(cavity ? -1 : underneath ? floor : 1), x, y);
        }
        try {
            return (bool)placeObject.Invoke(null, new object[] { Left + originX, Top + originY, type, true, style, 0, 0, -1 });
        } catch (TargetInvocationException) { return false; }
    }

    static string Written(int type, int width, int height) {
        var tiles = new StringBuilder("[");
        for (int y = Top - 1; y <= Top + height; y++) for (int x = Left - 1; x <= Left + width; x++) {
            object tile = world.GetValue(x, y);
            if (!(bool)isActive.Invoke(tile, null) || Convert.ToInt32(typeField.GetValue(tile), CultureInfo.InvariantCulture) != type) continue;
            tiles.Append(tiles.Length > 1 ? "," : "").AppendFormat(CultureInfo.InvariantCulture, "[{0},{1},{2},{3}]",
                x - Left, y - Top, frameXField.GetValue(tile), frameYField.GetValue(tile));
        }
        return tiles.Append("]").ToString();
    }

    public static string Observe(string path) {
        Initialize(path);
        Dictionary<int, int> itemStyles = ItemStyleCounts();
        bool[] important = (bool[])Field(mainType, "tileFrameImportant").GetValue(null);
        int count = Convert.ToInt32(Field(game.GetType("Terraria.ID.TileID", true), "Count").GetValue(null), CultureInfo.InvariantCulture);
        var json = new StringBuilder("{\"gameVersion\":\"");
        json.Append(Convert.ToString(Field(mainType, "versionNumber").GetValue(null), CultureInfo.InvariantCulture)).Append("\",\"tileCount\":").Append(count).Append(",\"types\":[");
        bool first = true;
        for (int type = 0; type < count; type++) {
            if (!important[type]) continue;
            object data = getTileData.Invoke(null, new object[] { type, 0, 0 });
            json.Append(first ? "" : ",").Append("{\"type\":").Append(type);
            first = false;
            if (data == null) { json.Append(",\"layout\":null}"); continue; }
            int itemStyleCount;
            bool fromItems = itemStyles.TryGetValue(type, out itemStyleCount);
            int styles = Math.Min(MaxStyles, Math.Max(MinStyles, fromItems ? itemStyleCount : 0));
            string layout = Layout(data);
            json.Append(",\"layout\":").Append(layout).Append(",\"itemStyles\":").Append(fromItems ? itemStyleCount : 0).Append(",\"styles\":[");
            for (int style = 0; style < styles; style++) {
                object own = getTileData.Invoke(null, new object[] { type, style, 0 });
                string ownLayout = own == null ? null : Layout(own);
                string tiles = own == null ? null : Place(type, style, Int(own, "Width"), Int(own, "Height"), PointPart(Property(own, "Origin"), "X"), PointPart(Property(own, "Origin"), "Y"));
                json.Append(style == 0 ? "" : ",").Append("{\"style\":").Append(style)
                    .Append(",\"sameLayout\":").Append(ownLayout == layout ? "true" : "false")
                    .Append(",\"tiles\":").Append(tiles ?? "null").Append("}");
            }
            json.Append("]}");
        }
        return json.Append("],\"complete\":true}").ToString();
    }
}
'@

try {
    $assemblyPath = (Resolve-Path -LiteralPath $TerrariaAssembly).Path
    $json = [ObjectLayoutObserver]::Observe($assemblyPath)
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json, (New-Object Text.UTF8Encoding($false)))
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    # The 32-bit host forwards only the first line of an error: the stack goes next to the output.
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath + '.error.txt'), $cause.ToString())
    throw ('Object layout observation failed: ' + $cause.GetType().Name + ': ' + $cause.Message)
}
[Environment]::Exit(0)
