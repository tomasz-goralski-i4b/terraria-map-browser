param([string]$Directory, [string]$Scenario)
$ErrorActionPreference = 'Stop'
$assemblyPath = Join-Path $Directory 'SyntheticTerraria.dll'

# A synthetic assembly with the reflected contract's shape; not Terraria code or colours. Deliberately includes two stone variants.
$source = @'
namespace Terraria {
    public static class Main { public const string versionNumber = "1.4.5.8"; }
}
namespace Terraria.Map {
    public struct PaletteColour {
        public byte R { get; set; }
        public byte G { get; set; }
        public byte B { get; set; }
        public PaletteColour(byte r, byte g, byte b) : this() { R = r; G = g; B = b; }
    }
    public static class MapHelper {
        public static PaletteColour[] colorLookup;
        public static ushort[] tileLookup;
        public static int[] tileOptionCounts;
        public static ushort[] wallLookup;
        public static int[] wallOptionCounts;
        public static ushort liquidPosition;
        public static void Initialize() {
            colorLookup = new [] {
                new PaletteColour(0, 0, 0),
                new PaletteColour(118, 88, 62),
                new PaletteColour(108, 112, 120),
                new PaletteColour(96, 102, 110),
                new PaletteColour(82, 86, 92),
                new PaletteColour(32, 104, 210),
                new PaletteColour(228, 68, 24),
                new PaletteColour(222, 164, 36),
                new PaletteColour(152, 84, 216)
            };
            tileLookup = new ushort[] { 1, 2, 0 };
            tileOptionCounts = new int[] { 1, 2, 0 };
            wallLookup = new ushort[] { 0, 4 };
            wallOptionCounts = new int[] { 0, 1 };
            liquidPosition = 5;
        }
    }
}
'@
if ($Scenario -eq 'invalid-range') { $source = $source.Replace('1, 2, 0', '1, 30, 0') }
if ($Scenario -eq 'missing-member') { $source = $source.Replace('wallOptionCounts', 'wallVariantCounts') }
Add-Type -TypeDefinition $source -OutputAssembly $assemblyPath
& (Join-Path $PSScriptRoot 'export.ps1') -TerrariaAssembly $assemblyPath -OutputPath (Join-Path $Directory 'synthetic-map-palette.ts')
