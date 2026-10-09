param([string]$Directory, [string]$Scenario)
$ErrorActionPreference = 'Stop'
$assemblyPath = Join-Path $Directory 'SyntheticTerraria.dll'

# A synthetic assembly with the reflected contract's shape; not Terraria code or colours. Tile 1 has two map
# options; the sky gradient is (0, i, 255) for i = 0…255.
$source = @'
namespace Terraria {
    public static class Main {
        public const string versionNumber = "1.4.5.8";
        public static Player[] player = new Player[256];
        public static int myPlayer = 255;
    }
    public class Player {}
    public static class Lang {
        private static bool initialized;
        public static void InitializeLegacyLocalization() {}
        public static void BuildMapAtlas() { initialized = true; }
        public static string GetMapObjectName(int index) {
            if (!initialized) throw new System.InvalidOperationException("Legend not initialized.");
            if (index == 2) return "Demon Altar";
            if (index == 3) return "Crimson Altar";
            if (index == 5) return "Aether \"Crystal\"\nWall";
            return "";
        }
    }
    public class Item {
        public int createTile = -1;
        public int createWall = -1;
        public byte paint;
        public string Name { get; private set; }
        public void SetDefaults(int id, Terraria.GameContent.Items.ItemVariant variant) {
            if (Main.player[Main.myPlayer] == null) throw new System.InvalidOperationException("Player not initialized.");
            Name = "";
            if (id == 2) { createTile = 0; Name = "Dirt Block"; }
            if (id == 3) { createTile = 1; Name = "Stone Block"; }
            if (id == 10) { paint = 1; Name = "Red Paint"; }
            if (id == 11) { paint = 2; Name = "Blue Paint"; }
            if (id == 26) { createWall = 1; Name = "Stone Wall"; }
            // Two different items for an unmapped tile: neither should become an arbitrary material name.
            if (id == 28 || id == 29) { createTile = 2; Name = id == 28 ? "Grass Seeds" : "Staff of Regrowth"; }
        }
    }
    public static class WorldGen {
        public static Terraria.Map.PaletteColour paintColor(int color) {
            if (color == 1) return new Terraria.Map.PaletteColour(200, 0, 0);
            if (color == 2) return new Terraria.Map.PaletteColour(0, 0, 200);
            return new Terraria.Map.PaletteColour(255, 255, 255);
        }
    }
}
namespace Terraria.ID {
    public static class WallID { public const ushort Count = 2; public const ushort None = 0; public const ushort Stone = 1; }
    public static class TileID { public const ushort Count = 4; public const ushort Dirt = 0; public const ushort DemonAltar = 1; public const ushort Grass = 2; public const ushort Plants = 3; }
    public static class ItemID { public const int Count = 31; }
    public static class PaintID { public const byte None = 0; public const byte RedPaint = 1; public const byte BluePaint = 2; }
}
namespace Terraria.GameContent.Items { public class ItemVariant {} }
namespace Terraria.Localization {
    public class GameCulture { public string Name; }
    public class LanguageManager {
        public static LanguageManager Instance = new LanguageManager();
        public GameCulture ActiveCulture { get; private set; }
        private bool loaded;
        public void SetLanguage(string name) { ActiveCulture = new GameCulture { Name = name }; }
        public void ReloadLanguage(GameCulture culture) { loaded = culture.Name == "en-US"; }
        public string GetTextValue(string key) {
            if (!loaded) throw new System.InvalidOperationException("English localization not loaded.");
            if (key == "LegacyInterface.53") return "Water";
            if (key == "LegacyInterface.56") return "Lava";
            if (key == "LegacyInterface.58") return "Honey";
            if (key == "SlimeNames_Rainbow.Shimmer") return "Shimmer";
            return key;
        }
    }
}
namespace Terraria.Map {
    public struct PaletteColour {
        public byte R { get; set; }
        public byte G { get; set; }
        public byte B { get; set; }
        public PaletteColour(byte r, byte g, byte b) : this() { R = r; G = g; B = b; }
    }
    public static class MapHelper {
        public const int maxSkyGradients = 256;
        public static PaletteColour[] colorLookup;
        public static ushort[] tileLookup;
        public static int[] tileOptionCounts;
        public static ushort[] wallLookup;
        public static int[] wallOptionCounts;
        public static ushort liquidPosition;
        public static ushort skyPosition;
        public static ushort dirtPosition;
        public static ushort rockPosition;
        public static ushort hellPosition;
        public static void Initialize() {
            colorLookup = new PaletteColour[9 + 256 + 3];
            colorLookup[1] = new PaletteColour(118, 88, 62);
            colorLookup[2] = new PaletteColour(108, 112, 120);
            colorLookup[3] = new PaletteColour(96, 102, 110);
            colorLookup[4] = new PaletteColour(82, 86, 92);
            colorLookup[5] = new PaletteColour(32, 104, 210);
            colorLookup[6] = new PaletteColour(228, 68, 24);
            colorLookup[7] = new PaletteColour(222, 164, 36);
            colorLookup[8] = new PaletteColour(152, 84, 216);
            for (int i = 0; i < 256; i++) colorLookup[9 + i] = new PaletteColour(0, (byte)i, 255);
            colorLookup[265] = new PaletteColour(90, 60, 40);
            colorLookup[266] = new PaletteColour(70, 70, 70);
            colorLookup[267] = new PaletteColour(50, 20, 20);
            tileLookup = new ushort[] { 1, 2, 6, 0 };
            tileOptionCounts = new int[] { 1, 2, 1, 0 };
            wallLookup = new ushort[] { 0, 4 };
            wallOptionCounts = new int[] { 0, 2 };
            liquidPosition = 5;
            skyPosition = 9;
            dirtPosition = 265;
            rockPosition = 266;
            hellPosition = 267;
        }
    }
}
'@
if ($Scenario -eq 'invalid-range') { $source = $source.Replace('new int[] { 1, 2, 1, 0 }', 'new int[] { 1, 300, 1, 0 }') }
if ($Scenario -eq 'missing-member') { $source = $source.Replace('wallOptionCounts', 'wallVariantCounts') }
if ($Scenario -eq 'missing-legend') { $source = $source.Replace('GetMapObjectName', 'ReadMapObjectLabel') }
if ($Scenario -eq 'missing-localization') { $source = $source.Replace('return "Lava";', 'return key;') }
if ($Scenario -eq 'item-failure') { $source = $source.Replace('Name = "";', 'if (id == 2) throw new System.InvalidOperationException("Unsupported item contract."); Name = "";') }
if ($Scenario -eq 'missing-symbols') { $source = $source.Replace('class TileID ', 'class BlockIdentifiers ') }
if ($Scenario -eq 'ambiguous-symbols') { $source = $source.Replace('public const ushort Grass = 2;', 'public const ushort Grass = 2; public const ushort MeadowGrass = 2;') }
if ($Scenario -eq 'symbol-casing') { $source = $source.Replace('public const ushort Grass = 2;', 'public const ushort HallowedPlants2 = 2;').Replace('public const ushort Plants = 3;', 'public const ushort UFOAnchor = 3;') }
if ($Scenario -eq 'natural-wall') { $source = $source.Replace('public const ushort None = 0;', 'public const ushort JungleUnsafe = 0;') }
if ($Scenario -eq 'missing-wall-symbols') { $source = $source.Replace('class WallID ', 'class WallIdentifiers ') }
if ($Scenario -eq 'ambiguous-wall-symbols') { $source = $source.Replace('public const ushort None = 0;', 'public const ushort JungleUnsafe = 0; public const ushort FlowerUnsafe = 0;') }
if ($Scenario -eq 'unused-wall-symbol') { $source = $source.Replace('public const ushort None = 0;', 'public const ushort MarbleEchoUnused = 0;') }
Add-Type -TypeDefinition $source -OutputAssembly $assemblyPath
& (Join-Path $PSScriptRoot 'export.ps1') -TerrariaAssembly $assemblyPath -OutputPath (Join-Path $Directory 'synthetic-map-palette.ts') -CoveragePath (Join-Path $Directory 'name-coverage.md')
