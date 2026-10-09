# Observes how a local Terraria installation frames blocks, for the opt-in framing conformance (observe.test.mjs):
#   ./scripts/framing/observe.ps1 -TerrariaAssembly '<Terraria directory>/TerrariaServer.exe' -CasesPath cases.json -OutputPath out.json
# Black-box observation (ADR 0003): synthetic tiles are placed in a synthetic world, the game's own framing function
# (WorldGen.TileFrame) is called on them, and only the frames it writes are recorded. No game code is read. The output
# is game-derived and never committed. cases.json comes from export-cases.mjs (the generated observation world).
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TerrariaAssembly,
    [Parameter(Mandatory = $true)][string]$CasesPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Same 32-bit host requirement as scripts/map-palette/export.ps1.
if ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitProcess) {
    $hostPath = Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    if (Test-Path -LiteralPath $hostPath) {
        & $hostPath -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -TerrariaAssembly $TerrariaAssembly -CasesPath $CasesPath -OutputPath $OutputPath
        # The game's initialization leaves a background thread that can end the host with a non-zero code after the
        # output is written; the output file and its completion marker are what count.
        if (-not (Test-Path -LiteralPath $OutputPath)) { throw 'Framing observation failed in the 32-bit .NET Framework host.' }
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

public static class FramingObserver {
    const BindingFlags Static = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
    const BindingFlags Instance = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
    const int Size = 160;
    static Assembly game;
    static string directory;
    static Type tileType;
    static Array world;
    static MethodInfo setActive, tileFrame, setFrameNumber, getFrameNumber, setHalf, setSlope;
    static FieldInfo typeField, frameXField, frameYField;

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
        if (method == null) throw new InvalidOperationException("Unsupported framing observation contract: " + type.Name + "." + name + ".");
        return method;
    }

    static FieldInfo Field(Type type, string name) {
        FieldInfo field = type.GetField(name, Static | Instance);
        if (field == null) throw new InvalidOperationException("Unsupported framing observation contract: " + type.Name + "." + name + ".");
        return field;
    }

    // --- The synthetic world -------------------------------------------------------------------------------------

    static void Clear() { ClearRect(0, 0, Size, Size); }

    /** Empties a rectangle; framing only ever touches the tiles placed and their neighbours. */
    static void ClearRect(int left, int top, int width, int height) {
        for (int x = left; x < left + width; x++) for (int y = top; y < top + height; y++) world.SetValue(Activator.CreateInstance(tileType), x, y);
    }

    /** A block of `type` (-1: none) with shape 0 full, 1 half, 2–5 slopes 1–4 (the .wld / CWM shape code). */
    static void Put(int x, int y, int type, int shape) {
        object tile = Activator.CreateInstance(tileType);
        if (type >= 0) {
            typeField.SetValue(tile, (ushort)type);
            setActive.Invoke(tile, new object[] { true });
            if (shape == 1) setHalf.Invoke(tile, new object[] { true });
            else if (shape >= 2) setSlope.Invoke(tile, new object[] { (byte)(shape - 1) });
        }
        world.SetValue(tile, x, y);
    }

    static int FrameX(int x, int y) { return Convert.ToInt32(frameXField.GetValue(world.GetValue(x, y))); }
    static int FrameY(int x, int y) { return Convert.ToInt32(frameYField.GetValue(world.GetValue(x, y))); }
    static int TypeAt(int x, int y) { return Convert.ToInt32(typeField.GetValue(world.GetValue(x, y))); }

    /** Frames the rectangle twice in reading order, every tile with variant `variant` (frameNumber, no reset). */
    static void FrameRegion(int left, int top, int width, int height, int variant) {
        for (int pass = 0; pass < 2; pass++)
            for (int y = top; y < top + height; y++)
                for (int x = left; x < left + width; x++) {
                    object tile = world.GetValue(x, y);
                    setFrameNumber.Invoke(tile, new object[] { (byte)variant });
                    tileFrame.Invoke(null, new object[] { x, y, false, true });
                }
    }

    // --- Variants (O1) -------------------------------------------------------------------------------------------

    static void Variants(StringBuilder json) {
        Clear();
        for (int x = 9; x <= 11; x++) for (int y = 9; y <= 11; y++) Put(x, y, 0, 0);
        json.Append("{\"resetSamples\":[");
        // Reframing with reset, as the game does when it frames a tile without a remembered variant.
        for (int i = 0; i < 90; i++) {
            tileFrame.Invoke(null, new object[] { 10, 10, true, true });
            json.Append(i == 0 ? "" : ",").Append(FrameX(10, 10) / 18 - 1);
        }
        json.Append("],\"keptSamples\":[");
        // Reframing without reset keeps the variant the tile remembers.
        for (int i = 0; i < 30; i++) {
            tileFrame.Invoke(null, new object[] { 10, 10, false, true });
            json.Append(i == 0 ? "" : ",").Append(FrameX(10, 10) / 18 - 1);
        }
        json.Append("]}");
    }

    // --- Catalogue cases --------------------------------------------------------------------------------------

    static void Cases(StringBuilder json, List<object[]> cases) {
        bool firstCase = true;
        foreach (object[] entry in cases) {
            string id = (string)entry[0];
            int width = (int)entry[1], height = (int)entry[2];
            int[] types = (int[])entry[3], shapes = (int[])entry[4];
            const int left = 20, top = 20;
            json.Append(firstCase ? "" : ",").Append("{\"id\":\"").Append(id).Append("\",\"variants\":[");
            firstCase = false;
            for (int variant = 0; variant < 3; variant++) {
                Clear();
                for (int i = 0; i < types.Length; i++) Put(left + i % width, top + i / width, types[i], shapes[i]);
                FrameRegion(left, top, width, height, variant);
                json.Append(variant == 0 ? "[" : ",[");
                for (int i = 0; i < types.Length; i++) {
                    int x = left + i % width, y = top + i / width;
                    bool present = types[i] >= 0;
                    json.Append(i == 0 ? "" : ",");
                    if (!present) json.Append("null");
                    else json.AppendFormat("[{0},{1},{2}]", FrameX(x, y), FrameY(x, y), TypeAt(x, y));
                }
                json.Append("]");
            }
            json.Append("]}");
        }
    }

    // --- Every neighbourhood of a centre and one other type -----------------------------------------------------

    // Neighbour order NW, N, NE, W, E, SW, S, SE; digit 0 = air, 1 = the centre's type, 2 = the other type.
    static readonly int[][] Around = {
        new[] { -1, -1 }, new[] { 0, -1 }, new[] { 1, -1 }, new[] { -1, 0 }, new[] { 1, 0 }, new[] { -1, 1 }, new[] { 0, 1 }, new[] { 1, 1 },
    };

    static void Neighbourhoods(StringBuilder json, int centre, int other) {
        json.AppendFormat("{{\"centre\":{0},\"other\":{1},\"cells\":\"", centre, other);
        const int cx = 10, cy = 10;
        int total = 6561;
        Clear();
        for (int code = 0; code < total; code++) {
            ClearRect(cx - 2, cy - 2, 5, 5);
            Put(cx, cy, centre, 0);
            int rest = code;
            for (int k = 0; k < 8; k++) {
                int digit = rest % 3;
                rest /= 3;
                if (digit != 0) Put(cx + Around[k][0], cy + Around[k][1], digit == 1 ? centre : other, 0);
            }
            FrameRegion(cx - 1, cy - 1, 3, 3, 0);
            // A cell per code: column, row (of variant 0) and a mark when framing changed the centre's type.
            json.Append(code == 0 ? "" : ";").Append(FrameX(cx, cy) / 18).Append(",").Append(FrameY(cx, cy) / 18);
            if (TypeAt(cx, cy) != centre) json.Append(",t").Append(TypeAt(cx, cy));
        }
        json.Append("\"}");
    }

    // --- Shapes (O5) ----------------------------------------------------------------------------------------------

    /**
     * A dirt centre of every shape (0 full, 1 half, 2–5 slopes) with its four side neighbours each air (digit 0) or
     * dirt of shape digit − 1, corners full dirt. Code = centre shape × 2401 + Σ side digit × 7^k, sides N, E, S, W.
     */
    static void Shapes(StringBuilder json) {
        int[][] sides = { new[] { 0, -1 }, new[] { 1, 0 }, new[] { 0, 1 }, new[] { -1, 0 } };
        int[][] corners = { new[] { -1, -1 }, new[] { 1, -1 }, new[] { 1, 1 }, new[] { -1, 1 } };
        const int cx = 10, cy = 10;
        json.Append("{\"centre\":0,\"cells\":\"");
        Clear();
        for (int code = 0; code < 6 * 2401; code++) {
            ClearRect(cx - 2, cy - 2, 5, 5);
            Put(cx, cy, 0, code / 2401);
            foreach (int[] corner in corners) Put(cx + corner[0], cy + corner[1], 0, 0);
            int rest = code % 2401;
            for (int k = 0; k < 4; k++) {
                int digit = rest % 7;
                rest /= 7;
                if (digit != 0) Put(cx + sides[k][0], cy + sides[k][1], 0, digit - 1);
            }
            FrameRegion(cx - 1, cy - 1, 3, 3, 0);
            json.Append(code == 0 ? "" : ";").Append(FrameX(cx, cy) / 18).Append(",").Append(FrameY(cx, cy) / 18);
        }
        json.Append("\"}");
    }

    // --- Large-frame patterns (O4), found by behaviour ------------------------------------------------------------

    /**
     * Every block whose interior depends on its position: for each type, a slab framed with variant 0 at two origins.
     * An ordinary block gives the same interior cell everywhere; a large-frame block spreads cells over a pattern. Only
     * types whose 3 × 3 centre takes an interior look (row 1) are considered, which leaves furniture and other
     * frame-important content out.
     */
    static void LargeFrames(StringBuilder json, int typeCount) {
        const int slab = 14;
        int[][] origins = { new[] { 24, 24 }, new[] { 31, 29 } };
        bool first = true;
        Clear();
        for (int id = 0; id < typeCount; id++) {
            ClearRect(8, 8, 5, 5);
            for (int x = 9; x <= 11; x++) for (int y = 9; y <= 11; y++) Put(x, y, id, 0);
            FrameRegion(9, 9, 3, 3, 0);
            bool block = FrameY(10, 10) == 18 && TypeAt(10, 10) == id;
            ClearRect(8, 8, 5, 5);
            if (!block) continue;
            var grids = new int[origins.Length][];
            bool varies = false;
            for (int o = 0; o < origins.Length; o++) {
                int left = origins[o][0], top = origins[o][1];
                ClearRect(left - 2, top - 2, slab + 4, slab + 4);
                for (int x = left; x < left + slab; x++) for (int y = top; y < top + slab; y++) Put(x, y, id, 0);
                FrameRegion(left, top, slab, slab, 0);
                grids[o] = new int[slab * slab * 2];
                for (int y = 0; y < slab; y++) for (int x = 0; x < slab; x++) {
                    grids[o][(y * slab + x) * 2] = FrameX(left + x, top + y) / 18;
                    grids[o][(y * slab + x) * 2 + 1] = FrameY(left + x, top + y) / 18;
                    bool inside = x > 0 && y > 0 && x < slab - 1 && y < slab - 1;
                    if (inside && (grids[o][(y * slab + x) * 2] != 1 || grids[o][(y * slab + x) * 2 + 1] != 1)) varies = true;
                }
                ClearRect(left - 2, top - 2, slab + 4, slab + 4);
            }
            if (!varies) continue;
            // Whether the pattern ignores the tile's remembered variant: the first slab again, framed with variant 1.
            bool ignoresVariant = true;
            {
                int left = origins[0][0], top = origins[0][1];
                ClearRect(left - 2, top - 2, slab + 4, slab + 4);
                for (int x = left; x < left + slab; x++) for (int y = top; y < top + slab; y++) Put(x, y, id, 0);
                FrameRegion(left, top, slab, slab, 1);
                for (int y = 0; y < slab; y++) for (int x = 0; x < slab; x++) {
                    if (FrameX(left + x, top + y) / 18 != grids[0][(y * slab + x) * 2] || FrameY(left + x, top + y) / 18 != grids[0][(y * slab + x) * 2 + 1]) ignoresVariant = false;
                }
                ClearRect(left - 2, top - 2, slab + 4, slab + 4);
            }
            json.Append(first ? "" : ",").AppendFormat("{{\"id\":{0},\"slab\":{1},\"ignoresVariant\":{2},\"origins\":[", id, slab, ignoresVariant ? "true" : "false");
            first = false;
            for (int o = 0; o < origins.Length; o++) {
                json.Append(o == 0 ? "" : ",").AppendFormat("{{\"left\":{0},\"top\":{1},\"cells\":[", origins[o][0], origins[o][1]);
                for (int k = 0; k < grids[o].Length; k++) json.Append(k == 0 ? "" : ",").Append(grids[o][k]);
                json.Append("]}");
            }
            json.Append("]}");
        }
    }

    // --- Entry point ----------------------------------------------------------------------------------------------

    public static string Observe(string path, string casesJson, int[][] pairs) {
        directory = Path.GetDirectoryName(path);
        AppDomain.CurrentDomain.AssemblyResolve += Resolve;
        game = Assembly.LoadFrom(path);
        Type program = game.GetType("Terraria.Program", true);
        if (Field(program, "SavePath").GetValue(null) == null) Field(program, "SavePath").SetValue(null, Path.GetTempPath());
        Type main = game.GetType("Terraria.Main", true);
        Field(main, "dedServ").SetValue(null, true);
        // The dedicated server's own initialization fills the tile properties framing reads. It stops at the
        // bestiary, which a headless host cannot build; everything framing needs is set before that point, and the
        // sentinel below proves it.
        // The tile data initialization animates critter cages with the game's shared random generator, which only the
        // client creates; give it one so the whole initialization runs.
        FieldInfo random = Field(main, "rand");
        if (random.GetValue(null) == null) random.SetValue(null, Activator.CreateInstance(random.FieldType));
        foreach (string step in new[] { "Initialize_TileAndNPCData1", "Initialize_TileAndNPCData2", "SetupTileMerge" }) Method(main, step).Invoke(null, null);
        object instance = Activator.CreateInstance(main);
        try { Method(main, "Initialize").Invoke(instance, null); } catch (TargetInvocationException) { }
        tileType = game.GetType("Terraria.Tile", true);
        typeField = Field(tileType, "type");
        frameXField = Field(tileType, "frameX");
        frameYField = Field(tileType, "frameY");
        setActive = Method(tileType, "active", typeof(bool));
        setFrameNumber = Method(tileType, "frameNumber", typeof(byte));
        getFrameNumber = Method(tileType, "frameNumber");
        setHalf = Method(tileType, "halfBrick", typeof(bool));
        setSlope = Method(tileType, "slope", typeof(byte));
        Field(main, "maxTilesX").SetValue(null, Size);
        Field(main, "maxTilesY").SetValue(null, Size);
        world = Array.CreateInstance(tileType, Size, Size);
        Field(main, "tile").SetValue(null, world);
        FieldInfo worldMap = Field(main, "Map");
        worldMap.SetValue(null, Activator.CreateInstance(worldMap.FieldType, Size, Size));
        tileFrame = Method(game.GetType("Terraria.WorldGen", true), "TileFrame", typeof(int), typeof(int), typeof(bool), typeof(bool));

        // Sentinel: the centre of a 3 × 3 dirt block takes the plain interior (1, 1) at variant 0. Anything else means
        // the game's tile properties were not initialized, and every result would be meaningless. Properties such as
        // the stone family are not read from fields (their names say nothing reliable in a headless host); they show
        // in the observed behaviour.
        Clear();
        for (int x = 9; x <= 11; x++) for (int y = 9; y <= 11; y++) Put(x, y, 0, 0);
        FrameRegion(9, 9, 3, 3, 0);
        if (FrameX(10, 10) != 18 || FrameY(10, 10) != 18) {
            throw new InvalidOperationException("Framing is not initialized: a dirt interior framed at (" + FrameX(10, 10) + ", " + FrameY(10, 10) + ").");
        }
        // Second sentinel, for the merge data the rest of the initialization sets: stone with dirt to its east
        // (worked example 9) draws a dirt rim, from row 5 down; without that data it stays in rows 0–4.
        Clear();
        for (int x = 9; x <= 11; x++) for (int y = 9; y <= 11; y++) Put(x, y, 1, 0);
        Put(11, 10, 0, 0);
        FrameRegion(9, 9, 3, 3, 0);
        if (FrameY(10, 10) < 90) throw new InvalidOperationException("Framing merge data is not initialized: stone beside dirt framed at row " + FrameY(10, 10) / 18 + ".");

        List<object[]> cases = ParseCases(casesJson);
        var json = new StringBuilder("{\"gameVersion\":\"");
        json.Append(Convert.ToString(Field(main, "versionNumber").GetValue(null), CultureInfo.InvariantCulture)).Append("\",\"variants\":");
        Variants(json);
        json.Append(",\"cases\":[");
        Cases(json, cases);
        json.Append("],\"neighbourhoods\":[");
        for (int i = 0; i < pairs.Length; i++) {
            if (i > 0) json.Append(",");
            Neighbourhoods(json, pairs[i][0], pairs[i][1]);
        }
        json.Append("],\"shapes\":");
        Shapes(json);
        json.Append(",\"largeFrames\":[");
        LargeFrames(json, ((Array)Field(main, "tileSolid").GetValue(null)).Length);
        return json.Append("],\"complete\":true}").ToString();
    }

    // A minimal reader for export-cases.mjs output: id, width, height and the type and shape of each tile.
    static List<object[]> ParseCases(string text) {
        var result = new List<object[]>();
        int at = 0;
        while ((at = text.IndexOf("\"id\":\"", at, StringComparison.Ordinal)) >= 0) {
            at += 6;
            int end = text.IndexOf('"', at);
            string id = text.Substring(at, end - at);
            int width = NumberAfter(text, "\"width\":", end), height = NumberAfter(text, "\"height\":", end);
            int tilesStart = text.IndexOf("\"tiles\":[", end, StringComparison.Ordinal) + 9;
            int[] types = new int[width * height], shapes = new int[width * height];
            int position = tilesStart;
            for (int i = 0; i < types.Length; i++) {
                position = text.IndexOf('[', position) + 1;
                int close = text.IndexOf(']', position);
                string[] parts = text.Substring(position, close - position).Split(',');
                types[i] = int.Parse(parts[0], CultureInfo.InvariantCulture);
                shapes[i] = int.Parse(parts[1], CultureInfo.InvariantCulture);
                position = close + 1;
            }
            result.Add(new object[] { id, width, height, types, shapes });
            at = position;
        }
        return result;
    }

    static int NumberAfter(string text, string key, int from) {
        int at = text.IndexOf(key, from, StringComparison.Ordinal) + key.Length;
        int end = at;
        while (end < text.Length && (char.IsDigit(text[end]) || text[end] == '-')) end++;
        return int.Parse(text.Substring(at, end - at), CultureInfo.InvariantCulture);
    }
}
'@

# Centre and other type of every exhaustively observed neighbourhood: dirt/stone, ores, ash/hellstone, coralstone,
# green moss, grass on dirt and the jungle grasses on mud and dirt.
$pairs = @(
    @(0, 1), @(1, 0), @(0, 7), @(7, 0), @(7, 1), @(7, 6), @(57, 58), @(58, 57),
    @(315, 0), @(315, 1), @(179, 1), @(179, 0), @(2, 0), @(60, 59), @(661, 59), @(661, 0), @(662, 59)
)

try {
    $cases = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $CasesPath).Path)
    [int[][]]$pairArray = $pairs | ForEach-Object { , [int[]]$_ }
    $json = [FramingObserver]::Observe((Resolve-Path -LiteralPath $TerrariaAssembly).Path, $cases, $pairArray)
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json, (New-Object Text.UTF8Encoding($false)))
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    throw ('Framing observation failed: ' + $cause.GetType().Name + ': ' + $cause.Message)
}
# End the host at once: the game's background thread must not decide the exit code.
[Environment]::Exit(0)
