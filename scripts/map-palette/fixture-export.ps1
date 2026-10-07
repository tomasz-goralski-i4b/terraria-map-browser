param([string]$Directory, [string]$Scenario)
$ErrorActionPreference = 'Stop'
$assemblyPath = Join-Path $Directory 'SyntheticTerraria.dll'

# A synthetic assembly with the reflected contract's shape; not Terraria code or colours. Tile 1 has two map
# options; the sky gradient is (0, i, 255) for i = 0…255.
$source = @'
namespace Terraria {
    public static class Main { public const string versionNumber = "1.4.5.8"; }
    public static class WorldGen {
        public static Terraria.Map.PaletteColour paintColor(int color) {
            if (color == 1) return new Terraria.Map.PaletteColour(200, 0, 0);
            if (color == 2) return new Terraria.Map.PaletteColour(0, 0, 200);
            return new Terraria.Map.PaletteColour(255, 255, 255);
        }
    }
}
namespace Terraria.ID {
    public static class PaintID { public const byte None = 0; public const byte RedPaint = 1; public const byte BluePaint = 2; }
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
            tileLookup = new ushort[] { 1, 2, 0 };
            tileOptionCounts = new int[] { 1, 2, 0 };
            wallLookup = new ushort[] { 0, 4 };
            wallOptionCounts = new int[] { 0, 1 };
            liquidPosition = 5;
            skyPosition = 9;
            dirtPosition = 265;
            rockPosition = 266;
            hellPosition = 267;
        }
    }
}
'@
if ($Scenario -eq 'invalid-range') { $source = $source.Replace('new int[] { 1, 2, 0 }', 'new int[] { 1, 300, 0 }') }
if ($Scenario -eq 'missing-member') { $source = $source.Replace('wallOptionCounts', 'wallVariantCounts') }
Add-Type -TypeDefinition $source -OutputAssembly $assemblyPath
& (Join-Path $PSScriptRoot 'export.ps1') -TerrariaAssembly $assemblyPath -OutputPath (Join-Path $Directory 'synthetic-map-palette.ts')
