# Observes how a local Terraria installation stores and draws minecart tracks, trees and wires (#238, #239, #241):
#   ./scripts/sprite-objects/observe.ps1 -TerrariaAssembly '<Terraria directory>/TerrariaServer.exe' -OutputPath local-renders/sprite-objects.json
# Black-box observation (ADR 0003): the game's own placement, framing and draw-data functions are called on synthetic
# tiles in a synthetic world and only what they return or write is recorded. No game code is read. The output is
# game-derived and stays local; export.mjs turns it into the generated tables the renderer reads.
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
        if (-not (Test-Path -LiteralPath $OutputPath)) { throw 'Sprite object observation failed in the 32-bit .NET Framework host.' }
        return
    }
}

Add-Type -ReferencedAssemblies @('System.Drawing') -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;

public static class SpriteObjectObserver {
    const BindingFlags Static = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
    const BindingFlags Instance = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
    const int Size = 200;
    static Assembly game;
    static string directory;
    static Type mainType, tileType, worldGen, minecart;
    static Array world;
    static MethodInfo setActive, tileFrame;
    static FieldInfo typeField, frameXField, frameYField, wallField;

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

    static MethodInfo Method(Type type, string name, params Type[] parameters) {
        MethodInfo method = type.GetMethod(name, Static | Instance, null, parameters, null);
        if (method == null) throw new InvalidOperationException("Unsupported observation contract: " + type.Name + "." + name + ".");
        return method;
    }

    static MethodInfo MethodNamed(Type type, string name) {
        MethodInfo method = type.GetMethod(name, Static | Instance);
        if (method == null) throw new InvalidOperationException("Unsupported observation contract: " + type.Name + "." + name + ".");
        return method;
    }

    static FieldInfo Field(Type type, string name) {
        FieldInfo field = type.GetField(name, Static | Instance);
        if (field == null) throw new InvalidOperationException("Unsupported observation contract: " + type.Name + "." + name + ".");
        return field;
    }

    static int Constant(Type type, string name) { return Convert.ToInt32(Field(type, name).GetValue(null), CultureInfo.InvariantCulture); }

    // --- The synthetic world -------------------------------------------------------------------------------------

    static void Clear() {
        for (int x = 0; x < Size; x++) for (int y = 0; y < Size; y++) world.SetValue(Activator.CreateInstance(tileType), x, y);
    }

    static object TileAt(int x, int y) { return world.GetValue(x, y); }

    static void Put(int x, int y, int type) {
        object tile = Activator.CreateInstance(tileType);
        typeField.SetValue(tile, (ushort)type);
        setActive.Invoke(tile, new object[] { true });
        world.SetValue(tile, x, y);
    }

    static int FrameX(int x, int y) { return Convert.ToInt32(frameXField.GetValue(TileAt(x, y))); }
    static int FrameY(int x, int y) { return Convert.ToInt32(frameYField.GetValue(TileAt(x, y))); }
    static int TypeAt(int x, int y) { return Convert.ToInt32(typeField.GetValue(TileAt(x, y))); }
    static bool Active(int x, int y) { return (bool)Method(tileType, "active").Invoke(TileAt(x, y), null); }

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
        worldGen = game.GetType("Terraria.WorldGen", true);
        minecart = game.GetType("Terraria.Minecart", true);
        typeField = Field(tileType, "type");
        wallField = Field(tileType, "wall");
        frameXField = Field(tileType, "frameX");
        frameYField = Field(tileType, "frameY");
        setActive = Method(tileType, "active", typeof(bool));
        Field(mainType, "maxTilesX").SetValue(null, Size);
        Field(mainType, "maxTilesY").SetValue(null, Size);
        world = Array.CreateInstance(tileType, Size, Size);
        Field(mainType, "tile").SetValue(null, world);
        FieldInfo worldMap = Field(mainType, "Map");
        worldMap.SetValue(null, Activator.CreateInstance(worldMap.FieldType, Size, Size));
        tileFrame = Method(worldGen, "TileFrame", typeof(int), typeof(int), typeof(bool), typeof(bool));
        Method(minecart, "Initialize").Invoke(null, null);
    }

    // --- Minecart tracks (#239) ------------------------------------------------------------------------------------

    static void Tracks(StringBuilder json) {
        int total = Constant(minecart, "TotalFrames");
        json.Append("{\"totalFrames\":").Append(total);
        foreach (string name in new[] { "LeftDownDecoration", "RightDownDecoration", "BouncyBumperDecoration", "RegularBumperDecoration" }) {
            json.Append(",\"").Append(name).Append("\":").Append(Constant(minecart, name));
        }
        MethodInfo sourceRect = Method(minecart, "GetSourceRect", typeof(int), typeof(int));
        MethodInfo left = Method(minecart, "DrawLeftDecoration", typeof(int));
        MethodInfo right = Method(minecart, "DrawRightDecoration", typeof(int));
        MethodInfo bumper = Method(minecart, "DrawBumper", typeof(int));
        MethodInfo bouncy = Method(minecart, "DrawBouncyBumper", typeof(int));
        // Per piece index: its source rectangle (x, y, w, h) at animation frame 0 and 1, and which extras it draws.
        json.Append(",\"pieces\":[");
        int extra = Math.Max(total, 64);
        for (int piece = 0; piece < extra; piece++) {
            object rect0 = sourceRect.Invoke(null, new object[] { piece, 0 });
            object rect1 = sourceRect.Invoke(null, new object[] { piece, 1 });
            json.Append(piece == 0 ? "" : ",").Append("{\"piece\":").Append(piece)
                .Append(",\"rect\":").Append(Rect(rect0)).Append(",\"rect1\":").Append(Rect(rect1));
            if (piece < total) {
                json.Append(",\"left\":").Append(Bool(left.Invoke(null, new object[] { piece })))
                    .Append(",\"right\":").Append(Bool(right.Invoke(null, new object[] { piece })))
                    .Append(",\"bumper\":").Append(Bool(bumper.Invoke(null, new object[] { piece })))
                    .Append(",\"bouncy\":").Append(Bool(bouncy.Invoke(null, new object[] { piece })));
            }
            json.Append("}");
        }
        json.Append("]");
        // The pieces the tile's frames select: FrontTrack / BackTrack of a tile with given stored frames.
        MethodInfo front = Method(minecart, "FrontTrack", tileType);
        MethodInfo back = Method(minecart, "BackTrack", tileType);
        json.Append(",\"accessors\":[");
        int[][] samples = { new[] { 0, -1 }, new[] { 5, -1 }, new[] { 12, 30 }, new[] { 36, 2 }, new[] { 1, 0 } };
        for (int i = 0; i < samples.Length; i++) {
            object tile = Activator.CreateInstance(tileType);
            frameXField.SetValue(tile, (short)samples[i][0]);
            frameYField.SetValue(tile, (short)samples[i][1]);
            json.Append(i == 0 ? "" : ",").AppendFormat("[{0},{1},{2},{3}]", samples[i][0], samples[i][1],
                Convert.ToInt32(front.Invoke(null, new object[] { tile })), Convert.ToInt32(back.Invoke(null, new object[] { tile })));
        }
        json.Append("]");
        // Placed tracks: lines, slopes and junctions placed with the game's placement and framing, per style.
        json.Append(",\"placed\":[");
        MethodInfo place = Method(worldGen, "PlaceTile", typeof(int), typeof(int), typeof(int), typeof(bool), typeof(bool), typeof(int), typeof(int));
        string[][] layouts = {
            new[] { "###" },
            new[] { "#  ", " # ", "  #" },
            new[] { "  #", " # ", "#  " },
            new[] { "#   ", " ## ", "   #" },
            new[] { "## ", "  #", "   " },
            new[] { "#  #", " ## ", "    " },
            new[] { " # ", "# #", "   " },
            new[] { "#" },
            new[] { "##  ", "  ##" },
            new[] { "  ##", "##  " },
            new[] { "# ", " #", "# " },
            new[] { "#   #", " # # ", "  #  " },
            new[] { "  #  ", " # # ", "#   #" },
            new[] { "#####" },
            new[] { "#    ", " ####" },
            new[] { "#### ", "    #" },
        };
        bool firstLayout = true;
        for (int style = 0; style < 4; style++) {
            foreach (string[] layout in layouts) {
                Clear();
                const int left0 = 50, top0 = 50;
                for (int y = 0; y < layout.Length; y++) for (int x = 0; x < layout[y].Length; x++) {
                    if (layout[y][x] == '#') place.Invoke(null, new object[] { left0 + x, top0 + y, 314, true, true, -1, style });
                }
                json.Append(firstLayout ? "" : ",").Append("{\"style\":").Append(style).Append(",\"layout\":[");
                firstLayout = false;
                for (int y = 0; y < layout.Length; y++) json.Append(y == 0 ? "" : ",").Append("\"").Append(layout[y]).Append("\"");
                json.Append("],\"tiles\":[");
                bool firstTile = true;
                for (int y = 0; y < layout.Length; y++) for (int x = 0; x < layout[y].Length; x++) {
                    if (layout[y][x] != '#') continue;
                    int px = left0 + x, py = top0 + y;
                    json.Append(firstTile ? "" : ",").AppendFormat("[{0},{1},{2},{3},{4}]", x, y, Active(px, py) ? TypeAt(px, py) : -1, FrameX(px, py), FrameY(px, py));
                    firstTile = false;
                }
                json.Append("]}");
            }
        }
        json.Append("]}");
    }

    // --- Trees (#238) ----------------------------------------------------------------------------------------------

    static object tileDrawing;
    static MethodInfo drawData;

    /** The game's own tile draw data of the tile at (x, y): frames, size, top offset and frame shifts it draws with. */
    static string DrawData(int x, int y) {
        object tile = TileAt(x, y);
        ParameterInfo[] parameters = drawData.GetParameters();
        object[] args = new object[parameters.Length];
        args[0] = x; args[1] = y; args[2] = tile; args[3] = (ushort)TypeAt(x, y);
        args[4] = (short)FrameX(x, y); args[5] = (short)FrameY(x, y);
        for (int i = 6; i < args.Length; i++) {
            Type element = parameters[i].ParameterType.GetElementType();
            args[i] = element.IsValueType ? Activator.CreateInstance(element) : null;
        }
        try { drawData.Invoke(tileDrawing, args); } catch (TargetInvocationException error) { return "\"" + error.InnerException.GetType().Name + "\""; }
        return string.Format(CultureInfo.InvariantCulture, "[{0},{1},{2},{3},{4},{5},{6},{7},{8}]",
            args[4], args[5], args[6], args[7], args[8], args[9], args[10], args[11], Convert.ToInt32(args[12]));
    }

    static string Foliage(string method, int x, int y) {
        MethodInfo info = Method(worldGen, method, typeof(int), typeof(int), typeof(int), typeof(int).MakeByRefType(), typeof(int).MakeByRefType(),
            typeof(int).MakeByRefType(), typeof(int).MakeByRefType(), typeof(int).MakeByRefType());
        object[] args = { x, y, 0, 0, 0, 0, 0, 0 };
        bool ok;
        try { ok = (bool)info.Invoke(null, args); } catch (TargetInvocationException error) { return "\"" + error.InnerException.GetType().Name + "\""; }
        // treeFrame, treeStyle, floorY, topTextureFrameWidth, topTextureFrameHeight
        return string.Format(CultureInfo.InvariantCulture, "[{0},{1},{2},{3},{4},{5}]", ok ? 1 : 0, args[3], args[4], args[5], args[6], args[7]);
    }

    static string Call(MethodInfo method, object target, params object[] args) {
        try { return Convert.ToString(method.Invoke(target, args), CultureInfo.InvariantCulture); }
        catch (TargetInvocationException error) { return "\"" + error.InnerException.GetType().Name + "\""; }
    }

    const int Ground = 150;

    /** A strip of `ground` blocks (dirt below) from x = left to right, its surface at row Ground. */
    static void Strip(int left, int right, int ground, int below) {
        for (int x = left; x <= right; x++) {
            Put(x, Ground, ground);
            for (int y = Ground + 1; y < Ground + 4; y++) Put(x, y, below);
        }
    }

    /** Every tile of the trees standing on the strip, with what the game says about each. */
    static void RecordTrees(StringBuilder json, int left, int right) {
        MethodInfo leafy = Method(worldGen, "IsTileALeafyTreeTop", typeof(int), typeof(int));
        MethodInfo branch = Method(worldGen, "IsTileATreeBranch", typeof(int), typeof(int), typeof(int).MakeByRefType());
        MethodInfo treeFrame = Method(worldGen, "GetTreeFrame", tileType);
        Type drawing = tileDrawing.GetType();
        MethodInfo variant = Method(drawing, "GetTreeVariant", typeof(int), typeof(int));
        MethodInfo biome = Method(drawing, "GetTreeBiome", typeof(int), typeof(int), typeof(int), typeof(int));
        MethodInfo palmVariant = Method(drawing, "GetPalmTreeVariant", typeof(int), typeof(int));
        MethodInfo palmBiome = Method(drawing, "GetPalmTreeBiome", typeof(int), typeof(int));
        json.Append("[");
        bool first = true;
        for (int x = left; x <= right; x++) for (int y = 0; y < Ground; y++) {
            if (!Active(x, y)) continue;
            int type = TypeAt(x, y);
            object[] branchArgs = { x, y, 0 };
            bool isBranch = (bool)branch.Invoke(null, branchArgs);
            json.Append(first ? "" : ",").AppendFormat(CultureInfo.InvariantCulture,
                "{{\"x\":{0},\"y\":{1},\"type\":{2},\"frameX\":{3},\"frameY\":{4},\"leafy\":{5},\"branch\":{6},\"toTrunk\":{7},\"treeFrame\":{8}",
                x, y, type, FrameX(x, y), FrameY(x, y), Bool(leafy.Invoke(null, new object[] { x, y })), isBranch ? "true" : "false", branchArgs[2],
                Call(treeFrame, null, TileAt(x, y)));
            json.Append(",\"common\":").Append(Foliage("GetCommonTreeFoliageData", x, y));
            json.Append(",\"gem\":").Append(Foliage("GetGemTreeFoliageData", x, y));
            json.Append(",\"vanity\":").Append(Foliage("GetVanityTreeFoliageData", x, y));
            json.Append(",\"ash\":").Append(Foliage("GetAshTreeFoliageData", x, y));
            json.Append(",\"variant\":").Append(Call(variant, tileDrawing, x, y));
            json.Append(",\"biome\":").Append(Call(biome, tileDrawing, x, y, FrameX(x, y), FrameY(x, y)));
            json.Append(",\"palmVariant\":").Append(Call(palmVariant, tileDrawing, x, y));
            json.Append(",\"palmBiome\":").Append(Call(palmBiome, tileDrawing, x, y));
            json.Append(",\"draw\":").Append(DrawData(x, y)).Append("}");
            first = false;
        }
        json.Append("]");
    }

    static void SetRandom(int seed) {
        Type randomType = game.GetType("Terraria.Utilities.UnifiedRandom", true);
        object random = Activator.CreateInstance(randomType, seed);
        PropertyInfo property = worldGen.GetProperty("genRand", Static);
        MethodInfo setter = property == null ? null : property.GetSetMethod(true);
        if (setter != null) { setter.Invoke(null, new[] { random }); return; }
        foreach (FieldInfo field in worldGen.GetFields(Static)) if (field.FieldType == randomType) field.SetValue(null, random);
    }

    /** Synthetic forest settings: tree-style boundaries, forest styles and tree top variations, as a world stores them. */
    static void ForestSettings(int[] treeX, int[] treeStyle, int[] variations) {
        Field(mainType, "treeX").SetValue(null, treeX);
        Field(mainType, "treeStyle").SetValue(null, treeStyle);
        object tops = Field(worldGen, "TreeTops").GetValue(null);
        using (MemoryStream stream = new MemoryStream()) {
            BinaryWriter writer = new BinaryWriter(stream);
            writer.Write(variations.Length);
            foreach (int value in variations) writer.Write(value);
            writer.Flush();
            stream.Position = 0;
            Method(tops.GetType(), "Load", typeof(BinaryReader), typeof(int)).Invoke(tops, new object[] { new BinaryReader(stream), 279 });
        }
    }

    static void Trees(StringBuilder json) {
        // A single-player world: growing a tree must not try to send it to clients.
        Field(mainType, "netMode").SetValue(null, 0);
        object paint = Activator.CreateInstance(game.GetType("Terraria.GameContent.TilePaintSystemV2", true));
        tileDrawing = Activator.CreateInstance(game.GetType("Terraria.GameContent.Drawing.TileDrawing", true), paint);
        drawData = MethodNamed(tileDrawing.GetType(), "GetTileDrawData");
        MethodInfo grow = Method(worldGen, "GrowTree", typeof(int), typeof(int), typeof(int), typeof(bool));
        MethodInfo growPalm = Method(worldGen, "GrowPalmTree", typeof(int), typeof(int), typeof(int), typeof(bool));
        MethodInfo growType = Method(worldGen, "TryGrowingTreeByType", typeof(int), typeof(int), typeof(int), typeof(int), typeof(bool));
        MethodInfo growShroom = Method(worldGen, "GrowShroom", typeof(int), typeof(int));
        // Ground of every kind of tree: [kind, tree type (0: GrowTree, 1: palm, 2: shroom, else that type), ground, below].
        int[][] grounds = {
            new[] { 0, 2, 0 }, new[] { 0, 23, 0 }, new[] { 0, 60, 59 }, new[] { 0, 109, 0 }, new[] { 0, 147, 147 }, new[] { 0, 199, 0 },
            new[] { 0, 70, 59 }, new[] { 0, 477, 0 }, new[] { 0, 492, 0 }, new[] { 0, 633, 57 }, new[] { 0, 661, 59 }, new[] { 0, 662, 59 },
            new[] { 1, 53, 53 }, new[] { 1, 112, 112 }, new[] { 1, 234, 234 }, new[] { 1, 116, 116 },
            new[] { 2, 70, 59 },
            new[] { 583, 1, 1 }, new[] { 584, 1, 1 }, new[] { 585, 1, 1 }, new[] { 586, 1, 1 }, new[] { 587, 1, 1 }, new[] { 588, 1, 1 }, new[] { 589, 1, 1 },
            new[] { 596, 2, 0 }, new[] { 616, 2, 0 }, new[] { 634, 633, 57 },
        };
        json.Append("{\"forest\":[");
        bool first = true;
        int[][] settings = { new[] { 0, 1, 2, 3 }, new[] { 4, 5, 1, 0 } };
        for (int setting = 0; setting < settings.Length; setting++) {
            int[] variations = new int[13];
            for (int i = 0; i < variations.Length; i++) variations[i] = (i + setting) % 3;
            ForestSettings(new[] { 50, 100, 150 }, settings[setting], variations);
            foreach (int[] ground in grounds) {
                for (int seed = 0; seed < 1; seed++) {
                    Clear();
                    SetRandom(1000 * setting + 17 * seed + ground[1]);
                    Strip(2, Size - 3, ground[1], ground[2]);
                    for (int x = 6; x < Size - 6; x += 7) {
                        if (ground[0] == 0) grow.Invoke(null, new object[] { x, Ground, 0, true });
                        else if (ground[0] == 1) growPalm.Invoke(null, new object[] { x, Ground, 0, true });
                        else if (ground[0] == 2) growShroom.Invoke(null, new object[] { x, Ground });
                        else growType.Invoke(null, new object[] { ground[0], x, Ground - 1, 0, true });
                    }
                    json.Append(first ? "" : ",").AppendFormat("{{\"setting\":{0},\"kind\":{1},\"ground\":{2},\"seed\":{3},\"treeStyle\":[{4}],\"variations\":[{5}],\"tiles\":",
                        setting, ground[0], ground[1], seed, string.Join(",", Array.ConvertAll(settings[setting], v => v.ToString(CultureInfo.InvariantCulture))),
                        string.Join(",", Array.ConvertAll(variations, v => v.ToString(CultureInfo.InvariantCulture))));
                    first = false;
                    RecordTrees(json, 2, Size - 3);
                    json.Append("}");
                }
            }
        }
        json.Append("]}");
    }

    // --- Tree styles on synthetic trees ------------------------------------------------------------------------------

    const int TreeX = 75;

    /**
     * A synthetic tree of `type` standing on `ground` at column x: five plain trunk tiles, a top (22, 198 + 22 variant)
     * and a branch on each side (44 / 66, 198) two tiles below the top.
     */
    static void SyntheticTree(int x, int type, int ground, int variant) {
        for (int column = x - 3; column <= x + 3; column++) {
            Put(column, Ground, ground);
            for (int y = Ground + 1; y < Ground + 3; y++) Put(column, y, ground);
        }
        for (int y = Ground - 5; y < Ground; y++) PutFramed(x, y, type, 0, 0);
        PutFramed(x, Ground - 6, type, 22, 198 + 22 * variant);
        PutFramed(x - 1, Ground - 4, type, 44, 198 + 22 * variant);
        PutFramed(x + 1, Ground - 4, type, 66, 198 + 22 * variant);
    }

    static void PutFramed(int x, int y, int type, int frameX, int frameY) {
        Put(x, y, type);
        frameXField.SetValue(TileAt(x, y), (short)frameX);
        frameYField.SetValue(TileAt(x, y), (short)frameY);
    }

    static int lastTree = -1;

    /** Replaces the previous synthetic tree with one at x (only the tiles around both are touched). */
    static void Tree(int x, int type, int ground, int variant) {
        if (lastTree >= 0) ClearAround(lastTree);
        ClearAround(x);
        lastTree = x;
        SyntheticTree(x, type, ground, variant);
    }

    static void ClearAround(int x) {
        for (int column = x - 4; column <= x + 4; column++) for (int y = Ground - 10; y < Ground + 4; y++) world.SetValue(Activator.CreateInstance(tileType), column, y);
    }

    static int[] FoliageValues(string method, int x, int y, int xoffset) {
        MethodInfo info = Method(worldGen, method, typeof(int), typeof(int), typeof(int), typeof(int).MakeByRefType(), typeof(int).MakeByRefType(),
            typeof(int).MakeByRefType(), typeof(int).MakeByRefType(), typeof(int).MakeByRefType());
        object[] args = { x, y, xoffset, 0, 0, 0, 0, 0 };
        try {
            bool ok = (bool)info.Invoke(null, args);
            return new[] { ok ? 1 : 0, (int)args[3], (int)args[4], (int)args[6], (int)args[7] };
        } catch (TargetInvocationException) { return new[] { -1, 0, 0, 0, 0 }; }
    }

    static string Join(int[] values) { return string.Join(",", Array.ConvertAll(values, v => v.ToString(CultureInfo.InvariantCulture))); }

    /**
     * For every tree family and every block type it can stand on: the tree-top area whose variation the top reads (per
     * forest zone), and for every variation value the style, frame offset and frame size the game's foliage data gives
     * at 30 consecutive columns; the trunk's biome and draw frame shift; the palm biome on that ground.
     */
    static void TreeStyles(StringBuilder json) {
        int tileCount = Constant(game.GetType("Terraria.ID.TileID", true), "Count");
        Type drawing = tileDrawing.GetType();
        MethodInfo biome = Method(drawing, "GetTreeBiome", typeof(int), typeof(int), typeof(int), typeof(int));
        MethodInfo palmBiome = Method(drawing, "GetPalmTreeBiome", typeof(int), typeof(int));
        string[][] families = {
            new[] { "5", "GetCommonTreeFoliageData" },
            new[] { "583", "GetGemTreeFoliageData" }, new[] { "584", "GetGemTreeFoliageData" }, new[] { "585", "GetGemTreeFoliageData" },
            new[] { "586", "GetGemTreeFoliageData" }, new[] { "587", "GetGemTreeFoliageData" }, new[] { "588", "GetGemTreeFoliageData" },
            new[] { "589", "GetGemTreeFoliageData" },
            new[] { "596", "GetVanityTreeFoliageData" }, new[] { "616", "GetVanityTreeFoliageData" }, new[] { "634", "GetAshTreeFoliageData" },
        };
        int[] zoneX = { 25, 75, 125, 175 };
        Clear();
        lastTree = -1;
        json.Append("{\"treeX\":[50,100,150],\"zoneX\":[").Append(Join(zoneX)).Append("],\"families\":[");
        for (int f = 0; f < families.Length; f++) {
            int type = int.Parse(families[f][0], CultureInfo.InvariantCulture);
            string method = families[f][1];
            json.Append(f == 0 ? "" : ",").Append("{\"type\":").Append(type).Append(",\"grounds\":[");
            bool firstGround = true;
            for (int ground = 0; ground < tileCount; ground++) {
                int[] zero = new int[13];
                ForestSettings(new[] { 50, 100, 150 }, new[] { 0, 0, 0, 0 }, zero);
                Tree(TreeX, type, ground, 0);
                if (TypeAt(TreeX, Ground) != ground || !Active(TreeX, Ground)) continue;
                int[] baseline = FoliageValues(method, TreeX, Ground - 6, 0);
                if (baseline[0] != 1) continue;
                json.Append(firstGround ? "" : ",").Append("{\"ground\":").Append(ground);
                firstGround = false;
                json.Append(",\"biome\":").Append(Call(biome, tileDrawing, TreeX, Ground - 2, 0, 0));
                json.Append(",\"palmBiome\":").Append(Call(palmBiome, tileDrawing, TreeX, Ground - 2));
                json.Append(",\"trunkDraw\":").Append(DrawData(TreeX, Ground - 2));
                // The area per zone: the one variation index whose change changes the top.
                json.Append(",\"zones\":[");
                for (int zone = 0; zone < zoneX.Length; zone++) {
                    int x = zoneX[zone];
                    int area = -1;
                    for (int a = 0; a < 13 && area < 0; a++) {
                        foreach (int probe in new[] { 1, 2, 3 }) {
                            int[] variations = new int[13];
                            variations[a] = probe;
                            ForestSettings(new[] { 50, 100, 150 }, new[] { 0, 0, 0, 0 }, variations);
                            Tree(x, type, ground, 0);
                            int[] probed = FoliageValues(method, x, Ground - 6, 0);
                            ForestSettings(new[] { 50, 100, 150 }, new[] { 0, 0, 0, 0 }, zero);
                            int[] still = FoliageValues(method, x, Ground - 6, 0);
                            if (probed[2] != still[2] || probed[1] != still[1]) { area = a; break; }
                        }
                    }
                    json.Append(zone == 0 ? "" : ",").Append(area);
                }
                json.Append("],\"values\":[");
                // Per variation value of the zone-1 area (or none): [ok, frame, style, width, height] at 30 columns.
                int readArea = -1;
                {
                    int x = zoneX[1];
                    for (int a = 0; a < 13 && readArea < 0; a++) {
                        foreach (int probe in new[] { 1, 2, 3 }) {
                            int[] variations = new int[13];
                            variations[a] = probe;
                            ForestSettings(new[] { 50, 100, 150 }, new[] { 0, 0, 0, 0 }, variations);
                            Tree(x, type, ground, 0);
                            int[] probed = FoliageValues(method, x, Ground - 6, 0);
                            if (probed[2] != baseline[2] || probed[1] != baseline[1]) { readArea = a; break; }
                        }
                    }
                }
                int maxValue = readArea < 0 ? 0 : 63;
                for (int value = 0; value <= maxValue; value++) {
                    int[] variations = new int[13];
                    if (readArea >= 0) variations[readArea] = value;
                    ForestSettings(new[] { 50, 100, 150 }, new[] { 0, 0, 0, 0 }, variations);
                    json.Append(value == 0 ? "[" : ",[");
                    for (int k = 0; k < 30; k++) {
                        int x = 60 + k;
                        Tree(x, type, ground, 0);
                        int[] top = FoliageValues(method, x, Ground - 6, 0);
                        json.Append(k == 0 ? "[" : ",[").Append(Join(top)).Append("]");
                    }
                    json.Append("]");
                }
                json.Append("],\"readArea\":").Append(readArea);
                // The branches' foliage at variation 0, called at the branch with its offset to the trunk and without.
                ForestSettings(new[] { 50, 100, 150 }, new[] { 0, 0, 0, 0 }, zero);
                Tree(TreeX, type, ground, 0);
                json.Append(",\"branches\":[[").Append(Join(FoliageValues(method, TreeX - 1, Ground - 4, 0))).Append("],[")
                    .Append(Join(FoliageValues(method, TreeX - 1, Ground - 4, 1))).Append("],[")
                    .Append(Join(FoliageValues(method, TreeX + 1, Ground - 4, 0))).Append("],[")
                    .Append(Join(FoliageValues(method, TreeX + 1, Ground - 4, -1))).Append("]]");
                // The top variant: the frame the top reports for each stored variant.
                json.Append(",\"variants\":[");
                for (int variant = 0; variant < 3; variant++) {
                    Tree(TreeX, type, ground, variant);
                    json.Append(variant == 0 ? "[" : ",[").Append(Join(FoliageValues(method, TreeX, Ground - 6, 0))).Append("]");
                }
                json.Append("]}");
            }
            json.Append("]}");
        }
        json.Append("]}");
    }

    /** The palm's biome row and draw frames on every block type a palm trunk can stand on. */
    static void Palms(StringBuilder json) {
        int tileCount = Constant(game.GetType("Terraria.ID.TileID", true), "Count");
        MethodInfo palmBiome = Method(tileDrawing.GetType(), "GetPalmTreeBiome", typeof(int), typeof(int));
        json.Append("[");
        bool first = true;
        Clear();
        lastTree = -1;
        for (int ground = 0; ground < tileCount; ground++) {
            ClearAround(TreeX);
            for (int column = TreeX - 3; column <= TreeX + 3; column++) Put(column, Ground, ground);
            if (!Active(TreeX, Ground) || TypeAt(TreeX, Ground) != ground) continue;
            PutFramed(TreeX, Ground - 1, 323, 66, 0);
            PutFramed(TreeX, Ground - 2, 323, 22, 4);
            PutFramed(TreeX, Ground - 3, 323, 110, 6);
            string biome = Call(palmBiome, tileDrawing, TreeX, Ground - 2);
            json.Append(first ? "" : ",").AppendFormat("{{\"ground\":{0},\"biome\":{1},\"trunk\":{2},\"top\":{3}}}", ground, biome, DrawData(TreeX, Ground - 2), DrawData(TreeX, Ground - 3));
            first = false;
        }
        json.Append("]");
    }

    static string Bool(object value) { return (bool)value ? "true" : "false"; }

    static string Rect(object rect) {
        Type type = rect.GetType();
        return string.Format(CultureInfo.InvariantCulture, "[{0},{1},{2},{3}]", Field(type, "X").GetValue(rect), Field(type, "Y").GetValue(rect), Field(type, "Width").GetValue(rect), Field(type, "Height").GetValue(rect));
    }

    public static string Observe(string path) {
        Initialize(path);
        var json = new StringBuilder("{\"gameVersion\":\"");
        json.Append(Convert.ToString(Field(mainType, "versionNumber").GetValue(null), CultureInfo.InvariantCulture)).Append("\"");
        json.Append(",\"tracks\":");
        Tracks(json);
        json.Append(",\"trees\":");
        Trees(json);
        json.Append(",\"treeStyles\":");
        TreeStyles(json);
        json.Append(",\"palms\":");
        Palms(json);
        return json.Append(",\"complete\":true}").ToString();
    }
}
'@

try {
    $assemblyPath = (Resolve-Path -LiteralPath $TerrariaAssembly).Path
    $json = [SpriteObjectObserver]::Observe($assemblyPath)
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json, (New-Object Text.UTF8Encoding($false)))
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    # The 32-bit host forwards only the first line of an error: the stack goes next to the output.
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath + '.error.txt'), $cause.ToString())
    throw ('Sprite object observation failed: ' + $cause.GetType().Name + ': ' + $cause.Message)
}
[Environment]::Exit(0)
