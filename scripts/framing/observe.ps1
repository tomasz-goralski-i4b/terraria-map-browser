# Observes how a local Terraria installation frames blocks, for the opt-in framing conformance (observe.test.mjs):
#   ./scripts/framing/observe.ps1 -TerrariaAssembly '<Terraria directory>/TerrariaServer.exe' -CasesPath cases.json -OutputPath out.json
# Black-box observation (ADR 0003): synthetic tiles are placed in a synthetic world, the game's own framing function
# (WorldGen.TileFrame) is called on them, and only the frames it writes are recorded. No game code is read. The output
# is game-derived and never committed. cases.json comes from export-cases.mjs (the generated observation world).
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TerrariaAssembly,
    [string]$CasesPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    # Observe (default): the report and conformance input. Database: every self-framed type against every other.
    # Check: frames the samples in CasesPath ([centre, other or -1, code, variant] per line of a JSON array) and writes
    # their cells, to compare a committed database with the installed game.
    [ValidateSet('Observe', 'Database', 'Check')][string]$Mode = 'Observe',
    # Database mode in parallel: this process handles the block types whose index mod Shards is Shard; shard 0 also
    # observes walls and shaped corners. export-database.mjs merges the shards.
    [int]$Shard = 0,
    [int]$Shards = 1
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Same 32-bit host requirement as scripts/map-palette/export.ps1.
if ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitProcess) {
    $hostPath = Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    if (Test-Path -LiteralPath $hostPath) {
        $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
            '-TerrariaAssembly', $TerrariaAssembly, '-OutputPath', $OutputPath, '-Mode', $Mode, '-Shard', $Shard, '-Shards', $Shards)
        if ($CasesPath) { $arguments += @('-CasesPath', $CasesPath) }
        & $hostPath @arguments
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

    // --- Walls -------------------------------------------------------------------------------------------------------

    static MethodInfo wallFrame, setWallFrameNumber, getWallFrameX, getWallFrameY;
    static FieldInfo wallField;

    static void PutWall(int x, int y, int wall, int block) {
        object tile = Activator.CreateInstance(tileType);
        if (wall > 0) wallField.SetValue(tile, (ushort)wall);
        if (block >= 0) { typeField.SetValue(tile, (ushort)block); setActive.Invoke(tile, new object[] { true }); }
        world.SetValue(tile, x, y);
    }

    /**
     * The variant-0 wall cell (36-pixel cells, as a cell index) of a wall `wall` at (px, py) in neighbourhood `code`
     * (digits 0 no wall, 1 the same wall, 2 `other`; order NW, N, NE, W, E, SW, S, SE).
     */
    static int WallCellOf(int wall, int other, int code, int px, int py) {
        ClearRect(px - 2, py - 2, 5, 5);
        PutWall(px, py, wall, -1);
        int rest = code;
        for (int k = 0; k < 8; k++) {
            int digit = rest % 3;
            rest /= 3;
            if (digit != 0) PutWall(px + Around[k][0], py + Around[k][1], digit == 1 ? wall : other, -1);
        }
        setWallFrameNumber.Invoke(world.GetValue(px, py), new object[] { (byte)0 });
        wallFrame.Invoke(null, new object[] { px, py, false });
        object tile = world.GetValue(px, py);
        return CellIndex(Convert.ToInt32(getWallFrameX.Invoke(tile, null)) / 36, Convert.ToInt32(getWallFrameY.Invoke(tile, null)) / 36);
    }

    /**
     * Every wall type: its table over all 6 561 neighbourhoods at one position (another wall as `other`), the cells of
     * the interior neighbourhoods (all four sides the same wall: 81 corner codes) at 24 positions, whether the variant
     * changes the interior, and which block types beside a wall count as a neighbour. Each distinct table is stored once.
     */
    static void Walls(StringBuilder json, Func<string, int> intern, int wallCount, int typeCount) {
        int[] sideCodes = new int[81];
        for (int i = 0; i < 81; i++) {
            int rest = i, code = 0, scale = 1;
            int[] digits = { 0, 1, 0, 1, 1, 0, 1, 0 };
            int[] cornerSlots = { 0, 2, 5, 7 };
            for (int k = 0; k < 4; k++) { digits[cornerSlots[k]] = rest % 3; rest /= 3; }
            foreach (int d in digits) { code += d * scale; scale *= 3; }
            sideCodes[i] = code;
        }
        Clear();
        json.Append("[");
        bool first = true;
        for (int wall = 1; wall < wallCount; wall++) {
            int other = wall == 1 ? 4 : 1;
            var table = new StringBuilder(6561);
            for (int code = 0; code < 6561; code++) table.Append((char)WallCellOf(wall, other, code, 30, 30));
            var positions = new StringBuilder();
            // 12 × 12 positions from (36, 36): x = 36 + a, y = 36 + b, so a = x mod 12 and b = y mod 12, which covers
            // every period up to 12 in both directions.
            for (int py = 0; py < 12; py++) for (int px = 0; px < 12; px++) {
                for (int i = 0; i < 81; i++) positions.Append((char)WallCellOf(wall, other, sideCodes[i], 36 + px, 36 + py));
            }
            // The variant: the plain interior with variant 1 against variant 0, at the first position.
            ClearRect(28, 28, 5, 5);
            for (int x = 29; x <= 31; x++) for (int y = 29; y <= 31; y++) PutWall(x, y, wall, -1);
            setWallFrameNumber.Invoke(world.GetValue(30, 30), new object[] { (byte)1 });
            wallFrame.Invoke(null, new object[] { 30, 30, false });
            object tile = world.GetValue(30, 30);
            int v1 = CellIndex(Convert.ToInt32(getWallFrameX.Invoke(tile, null)) / 36, Convert.ToInt32(getWallFrameY.Invoke(tile, null)) / 36);
            int v0 = WallCellOf(wall, other, CodeOf(1, 1, 1, 1, 1, 1, 1, 1), 30, 30);
            // Variant map: every v0 cell of the table, framed again with variant 1 and 2 where it first appeared.
            var firstSeen = new Dictionary<int, int>();
            string text = table.ToString();
            for (int code = 0; code < 6561; code++) if (!firstSeen.ContainsKey(text[code])) firstSeen[text[code]] = code;
            var variants = new StringBuilder();
            foreach (var entry in firstSeen) {
                int[] cells = new int[3];
                for (int variant = 1; variant <= 2; variant++) {
                    WallCellOf(wall, other, entry.Value, 30, 30);
                    setWallFrameNumber.Invoke(world.GetValue(30, 30), new object[] { (byte)variant });
                    wallFrame.Invoke(null, new object[] { 30, 30, false });
                    object framed = world.GetValue(30, 30);
                    cells[variant] = CellIndex(Convert.ToInt32(getWallFrameX.Invoke(framed, null)) / 36, Convert.ToInt32(getWallFrameY.Invoke(framed, null)) / 36);
                }
                variants.Append(variants.Length == 0 ? "" : ",").AppendFormat("[{0},{1},{2}]", entry.Key, cells[1], cells[2]);
            }
            json.Append(first ? "" : ",").AppendFormat("{{\"id\":{0},\"table\":{1},\"interiorByPosition\":{2},\"variantChangesInterior\":{3},\"variants\":[{4}]}}",
                wall, intern(text), intern(positions.ToString()), v0 == v1 ? "false" : "true", variants.ToString());
            first = false;
            if (wall % 25 == 0) Console.Error.WriteLine("walls " + wall + "/" + (wallCount - 1));
        }
        json.Append("],\"wallNeighbourBlocks\":[");
        // Block types that count as a neighbour of wall 1: a lone wall with the block E of it (no wall there).
        int alone = WallCellOf(1, 4, 0, 30, 30);
        first = true;
        for (int block = 0; block < typeCount; block++) {
            ClearRect(28, 28, 5, 5);
            PutWall(30, 30, 1, -1);
            PutWall(31, 30, 0, block);
            setWallFrameNumber.Invoke(world.GetValue(30, 30), new object[] { (byte)0 });
            wallFrame.Invoke(null, new object[] { 30, 30, false });
            object tile = world.GetValue(30, 30);
            int cell = CellIndex(Convert.ToInt32(getWallFrameX.Invoke(tile, null)) / 36, Convert.ToInt32(getWallFrameY.Invoke(tile, null)) / 36);
            if (cell == alone) continue;
            json.Append(first ? "" : ",").Append(block);
            first = false;
        }
        json.Append("]");
    }

    // --- Check samples against the game ----------------------------------------------------------------------------

    /** Frames each sample `[centre, other, code, variant]` (other −1: none) and returns `[column, row]` per sample. */
    public static string Check(string path, string samplesJson) {
        Initialize(path);
        // The same block types and falling types as the database run.
        BlockTypes(((Array)Field(mainType, "tileSolid").GetValue(null)).Length);
        var json = new StringBuilder("{\"gameVersion\":\"");
        json.Append(Convert.ToString(Field(mainType, "versionNumber").GetValue(null), CultureInfo.InvariantCulture)).Append("\",\"cells\":[");
        int at = 0, count = 0;
        Clear();
        while ((at = samplesJson.IndexOf('[', at + 1)) >= 0) {
            int close = samplesJson.IndexOf(']', at);
            string[] parts = samplesJson.Substring(at + 1, close - at - 1).Split(',');
            if (parts.Length != 4) { at = close; continue; }
            int centre = int.Parse(parts[0], CultureInfo.InvariantCulture), other = int.Parse(parts[1], CultureInfo.InvariantCulture);
            int code = int.Parse(parts[2], CultureInfo.InvariantCulture), variant = int.Parse(parts[3], CultureInfo.InvariantCulture);
            int cell = CellAt(centre, other, code, 10, 10, variant);
            json.Append(count == 0 ? "" : ",").AppendFormat("[{0},{1}]", cellList[cell] / 64, cellList[cell] % 64);
            count++;
            at = close;
        }
        return json.Append("],\"complete\":true}").ToString();
    }

    // --- The framing database ---------------------------------------------------------------------------------------

    /**
     * Every type whose 3 × 3 centre takes an interior look (row 1) in five trials out of five: the self-framed blocks,
     * grass and moss included. Types whose frame is random (vines and other non-blocks) fail some trial, so the list is
     * the same in every process and every shard.
     */
    static List<int> BlockTypes(int typeCount) {
        var types = new List<int>();
        Clear();
        int interior = CodeOf(1, 1, 1, 1, 1, 1, 1, 1);
        Func<int, bool> isBlock = id => {
            for (int trial = 0; trial < 5; trial++) {
                CellOf(id, -1, interior, 0, null);
                if (FrameY(10, 10) != 18 || TypeAt(10, 10) != id || !IsActive(10, 10)) return false;
            }
            return true;
        };
        for (int id = 0; id < typeCount; id++) {
            if (isBlock(id)) { types.Add(id); continue; }
            // A block that only frames as one when standing on a floor falls without support.
            falling.Add(id);
            if (isBlock(id)) types.Add(id);
            else falling.Remove(id);
        }
        ClearRect(8, 8, 5, 5);
        return types;
    }

    static Dictionary<int, int> cellIndex = new Dictionary<int, int>();
    static List<int> cellList = new List<int>();

    /** Index of a cell (column, row) in the database's cell list. */
    static int CellIndex(int column, int row) {
        int cell = column * 64 + row, index;
        if (!cellIndex.TryGetValue(cell, out index)) { index = cellList.Count; cellIndex[cell] = index; cellList.Add(cell); }
        return index;
    }

    /** When set, CellOf frames the 3 × 3 twice in reading order (the reference), else neighbours first, then the centre. */
    static bool referenceFraming;

    /** Where CellOf places the centre, and the variant the centre is framed with (neighbours always use 0). */
    static int centreX = 10, centreY = 10, centreVariant = 0;

    /** Frames the eight neighbours of (cx, cy) once with variant 0, then the centre with `centreVariant`. */
    static void FrameNeighboursThenCentre(int cx, int cy) {
        for (int k = 0; k < 8; k++) {
            int x = cx + Around[k][0], y = cy + Around[k][1];
            if (TypeAt(x, y) == 0 && !IsActive(x, y)) continue;
            setFrameNumber.Invoke(world.GetValue(x, y), new object[] { (byte)0 });
            tileFrame.Invoke(null, new object[] { x, y, false, true });
        }
        setFrameNumber.Invoke(world.GetValue(cx, cy), new object[] { (byte)centreVariant });
        tileFrame.Invoke(null, new object[] { cx, cy, false, true });
    }

    static MethodInfo getActive;
    static bool IsActive(int x, int y) { return (bool)getActive.Invoke(world.GetValue(x, y), null); }

    /**
     * The variant-0 cell (as a cell index) of a centre of `centre` with shape `centreShape` in neighbourhood `code`
     * (digits 0 air, 1 the centre's type, 2 `other`; neighbour order NW, N, NE, W, E, SW, S, SE), each neighbour with
     * its shape from `shapes` (null: all full).
     */
    static int CellOf(int centre, int other, int code, int centreShape, int[] shapes) {
        // The game keeps some state between frames: for a few sand-type neighbourhoods the first frame after other
        // tiles differs from every repeat (0.07 % of samples). Framing the neighbourhood twice and keeping the second
        // result records the steady state, which does not depend on what was framed before.
        PlaceAndFrame(centre, other, code, centreShape, shapes);
        return PlaceAndFrame(centre, other, code, centreShape, shapes);
    }

    /** Block types that fall without support (sand and the like); found by BlockTypes. */
    static readonly HashSet<int> falling = new HashSet<int>();

    /** The cell index recorded when the game moves a tile of the placed neighbourhood (a falling block fell). */
    static int Unstable { get { return CellIndex(63, 63); } }

    static int PlaceAndFrame(int centre, int other, int code, int centreShape, int[] shapes) {
        int cx = centreX, cy = centreY;
        ClearRect(cx - 2, cy - 2, 5, 5);
        Put(cx, cy, centre, centreShape);
        int rest = code;
        var placed = new int[9];
        placed[4] = centre;
        int[] slot = { 0, 1, 2, 3, 5, 6, 7, 8 };
        for (int k = 0; k < 8; k++) {
            int digit = rest % 3;
            rest /= 3;
            int shape = shapes == null ? 0 : shapes[k];
            int type = digit == 1 ? centre : digit == 2 ? other : -1;
            if (type >= 0) Put(cx + Around[k][0], cy + Around[k][1], type, shape);
            placed[slot[k]] = type;
        }
        // Falling types stand on a stone floor below the bottom row, as they do in a world; the floor is outside the
        // centre's 3 × 3, so the centre's neighbourhood is the one placed.
        if (falling.Contains(centre) || (other >= 0 && falling.Contains(other))) {
            for (int x = cx - 1; x <= cx + 1; x++) if (placed[6 + (x - cx + 1)] >= 0) Put(x, cy + 2, 1, 0);
        }
        if (referenceFraming) FrameRegion(cx - 1, cy - 1, 3, 3, 0);
        else FrameNeighboursThenCentre(cx, cy);
        // A neighbourhood the game changed (a tile fell or moved) has no frame of its own.
        for (int i = 0; i < 9; i++) {
            int x = cx + i % 3 - 1, y = cy + i / 3 - 1;
            bool present = IsActive(x, y);
            if (placed[i] >= 0 ? !present || TypeAt(x, y) != placed[i] : present) return Unstable;
        }
        return CellIndex(FrameX(cx, cy) / 18, FrameY(cx, cy) / 18);
    }

    /** All 6 561 neighbourhoods of `centre` with `other` (−1: the other digit stays air), one char per cell index. */
    static string Table(int centre, int other) {
        var table = new StringBuilder(6561);
        for (int code = 0; code < 6561; code++) table.Append((char)CellOf(centre, other, code, 0, null));
        return table.ToString();
    }

    /** Table() with the centre at (x, y). */
    static string TableAt(int centre, int other, int x, int y) {
        centreX = x; centreY = y;
        try { return Table(centre, other); } finally { centreX = 10; centreY = 10; }
    }

    /** One cell with the centre at (x, y) and framed with `variant`. */
    static int CellAt(int centre, int other, int code, int x, int y, int variant) {
        centreX = x; centreY = y; centreVariant = variant;
        try { return CellOf(centre, other, code, 0, null); } finally { centreX = 10; centreY = 10; centreVariant = 0; }
    }

    /** `code` with every digit `from` replaced by `to`. */
    static int Replace(int code, int from, int to) {
        int result = 0, scale = 1;
        for (int k = 0; k < 8; k++) { int digit = code % 3; code /= 3; result += (digit == from ? to : digit) * scale; scale *= 3; }
        return result;
    }

    static int CodeOf(params int[] digits) {
        int code = 0, scale = 1;
        foreach (int digit in digits) { code += digit * scale; scale *= 3; }
        return code;
    }

    /**
     * Shaped corners: a full centre whose four sides are its own type with a whole face toward it (every such shape),
     * and whose corners are air or the centre's type (or `other`, when given) in every shape. Returns one char per
     * combination: sides (4^4, N E S W, index into the whole-face shapes of that side) × corners (k^4, NW NE SE SW).
     */
    static string ShapedCorners(int centre, int other) {
        // Shapes whose face toward the centre is whole, per side N, E, S, W (cut faces in docs/assets.md).
        int[][] whole = { new[] { 0, 1, 2, 3 }, new[] { 0, 1, 2, 4 }, new[] { 0, 4, 5 }, new[] { 0, 1, 3, 5 } };
        // Corner options: air, then the centre's type in shapes 0–5, then `other` in shapes 0–5.
        int options = other >= 0 ? 13 : 7;
        int[] sideSlot = { 1, 4, 6, 3 };
        int[] cornerSlot = { 0, 2, 7, 5 };
        var result = new StringBuilder();
        int[] shapes = new int[8];
        int[] digits = new int[8];
        int sideCombos = whole[0].Length * whole[1].Length * whole[2].Length * whole[3].Length;
        int cornerCombos = options * options * options * options;
        for (int s = 0; s < sideCombos; s++) {
            int rest = s;
            for (int k = 0; k < 4; k++) {
                int choice = rest % whole[k].Length;
                rest /= whole[k].Length;
                digits[sideSlot[k]] = 1;
                shapes[sideSlot[k]] = whole[k][choice];
            }
            for (int c = 0; c < cornerCombos; c++) {
                int cornerRest = c;
                for (int k = 0; k < 4; k++) {
                    int option = cornerRest % options;
                    cornerRest /= options;
                    digits[cornerSlot[k]] = option == 0 ? 0 : option <= 6 ? 1 : 2;
                    shapes[cornerSlot[k]] = option == 0 ? 0 : (option - 1) % 6;
                }
                result.Append((char)CellOf(centre, other, CodeOf(digits), 0, shapes));
            }
        }
        return result.ToString();
    }

    static void AppendTable(StringBuilder json, string table) {
        // Cell indices as printable chars from '0' (48); indices stay well below the quote and backslash only if the
        // cell list is short, so both are escaped.
        var line = new StringBuilder(table.Length);
        foreach (char c in table) {
            char printable = (char)(c + 48);
            if (printable == '"' || printable == '\\') line.Append('\\');
            line.Append(printable);
        }
        json.Append('"').Append(line.ToString()).Append('"');
    }

    /**
     * For every self-framed type t and every other self-framed type u: whether t treats u like air (`x`), like itself
     * (`o`), or by a table of its own. Each distinct table over all 6 561 neighbourhoods is stored once. Pairs are
     * grouped by their cells in 16 probe neighbourhoods; the first member's full table is computed, and a second
     * member's full table must equal it. One `x` and one `o` member of each type are verified in full as well.
     */
    public static string Database(string path, int shard, int shards) {
        Initialize(path);
        int typeCount = ((Array)Field(mainType, "tileSolid").GetValue(null)).Length;
        List<int> types = BlockTypes(typeCount);
        // The fast framing must give the reference framing's tables, or nothing below can be trusted.
        foreach (int[] pair in new[] { new[] { 0, 1 }, new[] { 1, 0 }, new[] { 2, 0 }, new[] { 179, 1 } }) {
            referenceFraming = true;
            string reference = Table(pair[0], pair[1]);
            referenceFraming = false;
            if (Table(pair[0], pair[1]) != reference) throw new InvalidOperationException("Fast framing differs from the reference for " + pair[0] + " with " + pair[1] + ".");
        }
        Console.Error.WriteLine(types.Count + " self-framed block types; fast framing equals the reference.");
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var pool = new Dictionary<string, int>();
        var tables = new List<string>();
        Func<string, int> intern = table => {
            int at;
            if (!pool.TryGetValue(table, out at)) { at = tables.Count; pool[table] = at; tables.Add(table); }
            return at;
        };
        var probes = new List<int> {
            CodeOf(2, 2, 2, 2, 2, 2, 2, 2), CodeOf(1, 2, 1, 2, 2, 1, 2, 1), CodeOf(2, 1, 2, 1, 1, 2, 1, 2),
            CodeOf(0, 0, 0, 0, 2, 0, 0, 0), CodeOf(0, 2, 0, 0, 0, 0, 0, 0), CodeOf(1, 1, 1, 1, 2, 1, 1, 1),
            CodeOf(1, 1, 1, 1, 1, 1, 2, 1), CodeOf(1, 1, 2, 1, 1, 1, 1, 1), CodeOf(1, 1, 1, 1, 1, 2, 1, 1),
            CodeOf(0, 1, 0, 2, 2, 0, 1, 0), CodeOf(0, 2, 0, 1, 1, 0, 0, 0),
        };
        var samples = new List<int>();
        uint sampleSeed = 98765;
        while (samples.Count < 200) {
            sampleSeed = sampleSeed * 1103515245 + 12345;
            int code = (int)((sampleSeed >> 8) % 6561);
            if (Replace(code, 2, 0) != code) samples.Add(code);
        }
        uint seed = 12345;
        while (probes.Count < 64) {
            seed = seed * 1103515245 + 12345;
            int code = (int)((seed >> 8) % 6561);
            if (Replace(code, 2, 0) != code) probes.Add(code);
        }
        var json = new StringBuilder("{\"gameVersion\":\"");
        json.Append(Convert.ToString(Field(mainType, "versionNumber").GetValue(null), CultureInfo.InvariantCulture)).Append("\",\"types\":[");
        int verified = 0, failures = 0;
        var failureList = new StringBuilder();
        Clear();
        bool firstType = true;
        for (int ti = 0; ti < types.Count; ti++) {
            if (ti % shards != shard) continue;
            int t = types[ti];
            string alone = Table(t, -1);
            var xSig = new StringBuilder();
            var oSig = new StringBuilder();
            foreach (int code in probes) { xSig.Append(alone[Replace(code, 2, 0)]); oSig.Append(alone[Replace(code, 2, 1)]); }
            string xKey = xSig.ToString(), oKey = oSig.ToString();
            var groups = new Dictionary<string, List<int>>();
            var asSelf = new List<int>();
            var asAir = new List<int>();
            foreach (int u in types) {
                if (u == t) continue;
                var sig = new StringBuilder();
                foreach (int code in probes) sig.Append((char)CellOf(t, u, code, 0, null));
                string key = sig.ToString();
                if (key == xKey) asAir.Add(u);
                else if (key == oKey) asSelf.Add(u);
                else {
                    List<int> list;
                    if (!groups.TryGetValue(key, out list)) { list = new List<int>(); groups[key] = list; }
                    list.Add(u);
                }
            }
            // Every `x` and `o` member is checked on further codes; one of each in full.
            Func<int, int, bool> verifyMapped = (u, digit) => {
                string table = Table(t, u);
                for (int code = 0; code < 6561; code++) if (table[code] != alone[Replace(code, 2, digit)]) return false;
                return true;
            };
            Func<int, int, bool> sampleMapped = (u, digit) => {
                foreach (int code in samples) if ((char)CellOf(t, u, code, 0, null) != alone[Replace(code, 2, digit)]) return false;
                return true;
            };
            foreach (int u in asAir) { verified++; if (!sampleMapped(u, 0)) { failures++; failureList.Append(t + "x" + u + " "); } }
            foreach (int u in asSelf) { verified++; if (!sampleMapped(u, 1)) { failures++; failureList.Append(t + "o" + u + " "); } }
            if (asAir.Count > 0 && !verifyMapped(asAir[asAir.Count / 2], 0)) { failures++; failureList.Append(t + "X" + asAir[asAir.Count / 2] + " "); }
            if (asSelf.Count > 0 && !verifyMapped(asSelf[asSelf.Count / 2], 1)) { failures++; failureList.Append(t + "O" + asSelf[asSelf.Count / 2] + " "); }
            json.Append(firstType ? "" : ",").AppendFormat("{{\"id\":{0},\"alone\":{1},\"self\":[{2}],\"tables\":[", t, intern(alone), string.Join(",", asSelf));
            firstType = false;
            // Every type in a probe group gets its full table; the stored groups are by table, not by probes.
            var byTable = new Dictionary<int, List<int>>();
            var order = new List<int>();
            foreach (var group in groups) {
                foreach (int u in group.Value) {
                    verified++;
                    int at = intern(Table(t, u));
                    List<int> members;
                    if (!byTable.TryGetValue(at, out members)) { members = new List<int>(); byTable[at] = members; order.Add(at); }
                    members.Add(u);
                }
            }
            bool firstGroup = true;
            foreach (int at in order) {
                json.Append(firstGroup ? "" : ",").AppendFormat("{{\"table\":{0},\"others\":[{1}]}}", at, string.Join(",", byTable[at]));
                firstGroup = false;
            }
            json.Append("]");
            // Variant map: every v0 cell of t's tables, framed again as variant 1 and 2 in the neighbourhood that first
            // gave it (with the other type of that table).
            var firstSeen = new Dictionary<int, int[]>();
            Action<string, int> collect = (table, other) => {
                for (int code = 0; code < 6561; code++) if (!firstSeen.ContainsKey(table[code])) firstSeen[table[code]] = new[] { other, code };
            };
            collect(alone, -1);
            foreach (int at in order) collect(tables[at], byTable[at][0]);
            json.Append(",\"variants\":[");
            bool firstVariant = true;
            foreach (var entry in firstSeen) {
                int v1 = CellAt(t, entry.Value[0], entry.Value[1], 10, 10, 1);
                int v2 = CellAt(t, entry.Value[0], entry.Value[1], 10, 10, 2);
                json.Append(firstVariant ? "" : ",").AppendFormat("[{0},{1},{2}]", entry.Key, v1, v2);
                firstVariant = false;
            }
            json.Append("]");
            // Position: the interior and 20 sampled neighbourhoods at 24 positions (x mod 6, y mod 4). A type whose cells
            // move with the position gets its alone table at all 24 (centre at (12 + a, 12 + b), so a = x mod 6, b = y mod 4).
            bool byPosition = false;
            for (int b = 0; b < 4 && !byPosition; b++) for (int a = 0; a < 6 && !byPosition; a++) {
                if (CellAt(t, -1, CodeOf(1, 1, 1, 1, 1, 1, 1, 1), 12 + a, 12 + b, 0) != CellAt(t, -1, CodeOf(1, 1, 1, 1, 1, 1, 1, 1), 12, 12, 0)) byPosition = true;
                for (int k = 0; k < 20 && !byPosition; k++) {
                    int code = samples[k];
                    if (CellAt(t, -1, code, 12 + a, 12 + b, 0) != CellAt(t, -1, code, 12, 12, 0)) byPosition = true;
                }
            }
            if (byPosition) {
                json.Append(",\"byPosition\":[");
                for (int b = 0; b < 4; b++) for (int a = 0; a < 6; a++) {
                    json.Append(a == 0 && b == 0 ? "" : ",").Append(intern(TableAt(t, -1, 12 + a, 12 + b)));
                }
                json.Append("]");
                int interior = CodeOf(1, 1, 1, 1, 1, 1, 1, 1);
                json.AppendFormat(",\"variantIgnoredByPosition\":{0}", CellAt(t, -1, interior, 12, 12, 1) == CellAt(t, -1, interior, 12, 12, 0) ? "true" : "false");
            }
            json.Append("}");
            double seconds = clock.Elapsed.TotalSeconds;
            int done = ti / shards + 1, total = (types.Count - shard + shards - 1) / shards;
            Console.Error.WriteLine(string.Format(CultureInfo.InvariantCulture, "shard {5}: blocks {0}/{1} (type {2}): {3:F0} s, about {4:F0} s left",
                done, total, t, seconds, seconds / done * (total - done), shard));
        }
        json.AppendFormat("],\"shard\":{0},\"shards\":{1},\"blockTypes\":[{2}]", shard, shards, string.Join(",", types));
        if (shard != 0) {
            json.Append(",\"cells\":[");
            for (int i = 0; i < cellList.Count; i++) json.Append(i == 0 ? "" : ",").AppendFormat("[{0},{1}]", cellList[i] / 64, cellList[i] % 64);
            json.Append("],\"tables\":[");
            for (int i = 0; i < tables.Count; i++) { if (i > 0) json.Append(","); AppendTable(json, tables[i]); }
            json.AppendFormat("],\"verified\":{0},\"failures\":{1},\"failureList\":\"{2}\",\"complete\":true}}", verified, failures, failureList.ToString().Trim());
            return json.ToString();
        }
        json.Append(",\"shapedCorners\":{\"dirt\":");
        AppendTable(json, ShapedCorners(0, -1));
        json.Append(",\"stoneWithDirt\":");
        AppendTable(json, ShapedCorners(1, 0));
        Type framing = game.GetType("Terraria.Framing", true);
        wallFrame = Method(framing, "WallFrame", typeof(int), typeof(int), typeof(bool));
        wallField = Field(tileType, "wall");
        setWallFrameNumber = Method(tileType, "wallFrameNumber", typeof(byte));
        getWallFrameX = Method(tileType, "wallFrameX");
        getWallFrameY = Method(tileType, "wallFrameY");
        int wallCount = Convert.ToInt32(Field(game.GetType("Terraria.ID.WallID", true), "Count").GetValue(null));
        Console.Error.WriteLine("shaped corners done; walls next");
        json.Append("},\"walls\":");
        Walls(json, intern, wallCount, typeCount);
        json.Append(",\"cells\":[");
        for (int i = 0; i < cellList.Count; i++) json.Append(i == 0 ? "" : ",").AppendFormat("[{0},{1}]", cellList[i] / 64, cellList[i] % 64);
        json.Append("],\"tables\":[");
        for (int i = 0; i < tables.Count; i++) { if (i > 0) json.Append(","); AppendTable(json, tables[i]); }
        json.AppendFormat("],\"verified\":{0},\"failures\":{1},\"failureList\":\"{2}\",\"complete\":true}}", verified, failures, failureList.ToString().Trim());
        return json.ToString();
    }

    // --- Entry point ----------------------------------------------------------------------------------------------

    static Type mainType;

    /** Loads the game, initializes its tile data and the synthetic world, and checks the sentinels. */
    static void Initialize(string path) {
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
        getActive = Method(tileType, "active");
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
        mainType = main;
    }

    public static string Observe(string path, string casesJson, int[][] pairs) {
        Initialize(path);
        Type main = mainType;
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
    $assemblyPath = (Resolve-Path -LiteralPath $TerrariaAssembly).Path
    if ($Mode -eq 'Check') {
        if (-not $CasesPath) { throw 'CasesPath (the samples) is required in Check mode.' }
        $json = [FramingObserver]::Check($assemblyPath, [IO.File]::ReadAllText((Resolve-Path -LiteralPath $CasesPath).Path))
    } elseif ($Mode -eq 'Database') {
        $json = [FramingObserver]::Database($assemblyPath, $Shard, $Shards)
    } else {
        if (-not $CasesPath) { throw 'CasesPath is required in Observe mode.' }
        $cases = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $CasesPath).Path)
        [int[][]]$pairArray = $pairs | ForEach-Object { , [int[]]$_ }
        $json = [FramingObserver]::Observe($assemblyPath, $cases, $pairArray)
    }
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json, (New-Object Text.UTF8Encoding($false)))
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    throw ('Framing observation failed: ' + $cause.GetType().Name + ': ' + $cause.Message)
}
# End the host at once: the game's background thread must not decide the exit code.
[Environment]::Exit(0)
