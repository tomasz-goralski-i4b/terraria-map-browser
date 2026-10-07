# Regenerates the shipped Terraria map palette (ADR 0002) from a local game installation:
#   ./scripts/map-palette/export.ps1 -TerrariaAssembly 'C:/Program Files (x86)/Steam/steamapps/common/Terraria/TerrariaServer.exe'
# Reads the game's map colour tables at runtime through reflection (no decompiled code, nothing copied from other
# tools) and writes them as a TypeScript module. Run it after a game update and commit the regenerated module.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TerrariaAssembly,
    # Defaults to the shipped module, packages/renderer/src/palette/terraria-map-palette.generated.ts.
    [string]$OutputPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Windows PowerShell leaves $PSScriptRoot empty in parameter defaults, so the default is resolved here.
if (-not $OutputPath) {
    $OutputPath = Join-Path (Split-Path -Parent $PSCommandPath) '../../packages/renderer/src/palette/terraria-map-palette.generated.ts'
}

# The Windows game assembly targets the 32-bit XNA runtime, so it only loads in a 32-bit .NET Framework host.
if ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitProcess) {
    $hostPath = Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    if (Test-Path -LiteralPath $hostPath) {
        & $hostPath -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -TerrariaAssembly $TerrariaAssembly -OutputPath $OutputPath
        if ($LASTEXITCODE -ne 0) { throw 'Map palette export failed in the 32-bit .NET Framework host.' }
        return
    }
}

$assemblyPath = (Resolve-Path -LiteralPath $TerrariaAssembly).Path
$output = [IO.Path]::GetFullPath($OutputPath)

# Dependencies come from the installation itself: its directory or the game assembly's embedded DLL resources.
# The resolver is C#, not a PowerShell script block: the game may resolve assemblies on threads without a
# PowerShell runspace, where a script-block handler intermittently overflows the stack.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Reflection;

public static class MapPaletteGameHost {
    private static Assembly game;
    private static string directory;

    public static Assembly Load(string path) {
        directory = Path.GetDirectoryName(path);
        AppDomain.CurrentDomain.AssemblyResolve += Resolve;
        game = Assembly.LoadFrom(path);
        return game;
    }

    private static Assembly Resolve(object sender, ResolveEventArgs request) {
        string name = new AssemblyName(request.Name).Name;
        string file = Path.Combine(directory, name + ".dll");
        if (File.Exists(file)) return Assembly.LoadFrom(file);
        if (game == null) return null;
        foreach (string resource in game.GetManifestResourceNames()) {
            if (resource == name + ".dll" || resource.EndsWith("." + name + ".dll", StringComparison.OrdinalIgnoreCase)) {
                using (Stream stream = game.GetManifestResourceStream(resource))
                using (MemoryStream buffer = new MemoryStream()) {
                    stream.CopyTo(buffer);
                    return Assembly.Load(buffer.ToArray());
                }
            }
        }
        return null;
    }
}
'@
$flags = [Reflection.BindingFlags]'Static,Public,NonPublic'

function Read-Field([Type]$Type, [string]$Name) {
    $field = $Type.GetField($Name, $flags)
    if ($null -eq $field) { throw "Unsupported map palette contract: missing $Name." }
    $value = if ($field.IsLiteral) { $field.GetRawConstantValue() } else { $field.GetValue($null) }
    if ($null -eq $value) { throw "Map palette field $Name was not initialized." }
    return ,$value
}

# A game colour as 0xRRGGBB.
function Read-Colour($Colour) {
    $rgb = 0
    foreach ($channel in @('R', 'G', 'B')) {
        $property = $Colour.GetType().GetProperty($channel)
        if ($null -eq $property) { throw "Unsupported map palette colour contract: missing $channel." }
        $value = [Convert]::ToInt32($property.GetValue($Colour, $null))
        if ($value -lt 0 -or $value -gt 255) { throw 'Map palette colour channel is out of range.' }
        $rgb = ($rgb -shl 8) -bor $value
    }
    return $rgb
}

# Per content ID, the colours of all its map options: lookup[id] is the first option's index in the colour table.
function Read-Options([Array]$Lookup, [Array]$Counts, [Array]$Colours) {
    if ($Lookup.Length -ne $Counts.Length -or $Lookup.Length -eq 0 -or $Lookup.Length -gt 65535) {
        throw 'Unsupported map palette lookup dimensions.'
    }
    $entries = New-Object 'Collections.Generic.List[object]'
    for ($id = 0; $id -lt $Lookup.Length; $id++) {
        $start = [int]$Lookup.GetValue($id)
        $count = [int]$Counts.GetValue($id)
        if ($count -lt 0 -or $count -gt 256 -or $start -lt 0 -or ($count -gt 0 -and ($start -eq 0 -or $start + $count -gt $Colours.Length))) {
            throw "Unsupported map palette lookup range at content ID $id."
        }
        $options = New-Object 'Collections.Generic.List[int]'
        for ($option = 0; $option -lt $count; $option++) { $options.Add((Read-Colour ($Colours.GetValue($start + $option)))) }
        $entries.Add($options.ToArray())
    }
    return ,$entries.ToArray()
}

# `count` consecutive colours of the colour table, starting at the index stored in the field `position`.
function Read-Range([Type]$Map, [Array]$Colours, [string]$Position, [int]$Count) {
    $start = [int](Read-Field $Map $Position)
    if ($start -le 0 -or $start + $Count -gt $Colours.Length) { throw "Unsupported map palette range at $Position." }
    return ,@(0..($Count - 1) | ForEach-Object { Read-Colour ($Colours.GetValue($start + $_)) })
}

function Format-Colour([int]$Colour) { return '0x{0:x6}' -f $Colour }

function Format-List([Array]$Colours) { return (@($Colours | ForEach-Object { Format-Colour $_ }) -join ', ') }

function Format-Table([string]$Name, [Array]$Entries) {
    $lines = New-Object 'Collections.Generic.List[string]'
    $lines.Add("  ${Name}: [")
    for ($id = 0; $id -lt $Entries.Length; $id++) { $lines.Add("    [$(Format-List $Entries[$id])], // $id") }
    $lines.Add('  ],')
    return $lines
}

try {
    $game = [MapPaletteGameHost]::Load($assemblyPath)
    # Main's static initializer expects the launcher's save root. This process never opens or saves a world.
    $program = $game.GetType('Terraria.Program', $false)
    if ($null -ne $program) {
        $savePath = $program.GetField('SavePath', $flags)
        if ($null -ne $savePath -and $null -eq $savePath.GetValue($null)) { $savePath.SetValue($null, [IO.Path]::GetTempPath()) }
    }
    $map = $game.GetType('Terraria.Map.MapHelper', $true)
    $initialize = $map.GetMethod('Initialize', $flags, $null, [Type[]]@(), $null)
    if ($null -eq $initialize) { throw 'Unsupported map palette contract: missing Initialize().' }
    $null = $initialize.Invoke($null, @())

    $colours = Read-Field $map 'colorLookup'
    $tiles = Read-Options (Read-Field $map 'tileLookup') (Read-Field $map 'tileOptionCounts') $colours
    $walls = Read-Options (Read-Field $map 'wallLookup') (Read-Field $map 'wallOptionCounts') $colours
    # Water, lava, honey and shimmer follow each other in the colour table.
    $liquids = Read-Range $map $colours 'liquidPosition' 4
    # The sky is a gradient from the top of the world down to the surface; the dirt and rock layers and the
    # underworld each have one colour (the first entry of their range; the game draws empty space only with it).
    $sky = Read-Range $map $colours 'skyPosition' ([int](Read-Field $map 'maxSkyGradients'))
    $dirt = (Read-Range $map $colours 'dirtPosition' 1)[0]
    $rock = (Read-Range $map $colours 'rockPosition' 1)[0]
    $hell = (Read-Range $map $colours 'hellPosition' 1)[0]
    if ($sky.Length -ne 256) { throw "Unsupported map palette contract: $($sky.Length) sky colours instead of 256." }

    # Paint colours, indexed by paint ID (0 = unpainted).
    $paintIds = $game.GetType('Terraria.ID.PaintID', $true).GetFields($flags) | Where-Object { $_.IsLiteral } |
        ForEach-Object { [int]$_.GetRawConstantValue() }
    $paintCount = ($paintIds | Measure-Object -Maximum).Maximum + 1
    if ($paintCount -lt 2 -or $paintCount -gt 256) { throw 'Unsupported map palette contract: paint ID range.' }
    $paintColour = $game.GetType('Terraria.WorldGen', $true).GetMethod('paintColor', $flags, $null, [Type[]]@([int]), $null)
    if ($null -eq $paintColour) { throw 'Unsupported map palette contract: missing paintColor(int).' }
    $paints = @(0..($paintCount - 1) | ForEach-Object { Read-Colour ($paintColour.Invoke($null, @([int]$_))) })

    $version = $game.GetName().Version.ToString()
    $main = $game.GetType('Terraria.Main', $false)
    if ($null -ne $main) {
        $versionField = $main.GetField('versionNumber', $flags)
        if ($null -ne $versionField -and $versionField.IsLiteral) { $version = [string]$versionField.GetRawConstantValue() }
    }
    $version = $version.TrimStart('v')
    if ($version -notmatch '^[0-9A-Za-z.\-]+$') { throw "Unexpected game version '$version'." }

    $lines = New-Object 'Collections.Generic.List[string]'
    $lines.Add("// Generated by scripts/map-palette/export.ps1 from Terraria $version. Do not edit; re-run the exporter (ADR 0002).")
    $lines.Add('// Map colours as 0xRRGGBB per vanilla content ID, one per map option; an empty list means no map colour.')
    $lines.Add('import type { MapPalette } from "./map-palette.js";')
    $lines.Add('')
    $lines.Add('export const terrariaMapPalette: MapPalette = {')
    $lines.Add("  gameVersion: `"$version`",")
    $lines.AddRange([string[]](Format-Table 'tiles' $tiles))
    $lines.AddRange([string[]](Format-Table 'walls' $walls))
    $lines.Add("  liquids: [$(Format-List $liquids)],")
    $lines.Add('  background: {')
    $lines.Add('    sky: [')
    for ($row = 0; $row -lt $sky.Length; $row += 8) { $lines.Add("      $(Format-List $sky[$row..([Math]::Min($row + 7, $sky.Length - 1))]),") }
    $lines.Add('    ],')
    $lines.Add("    dirt: $(Format-Colour $dirt),")
    $lines.Add("    rock: $(Format-Colour $rock),")
    $lines.Add("    hell: $(Format-Colour $hell),")
    $lines.Add('  },')
    $lines.Add('  paints: [')
    for ($id = 0; $id -lt $paints.Length; $id++) { $lines.Add("    $(Format-Colour $paints[$id]), // $id") }
    $lines.Add('  ],')
    $lines.Add('};')
    # Everything was read and validated before the output is touched.
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output))
    [IO.File]::WriteAllText($output, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
    Write-Host "Exported the map palette of Terraria $version to $output"
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    Write-Verbose $cause.ToString()
    throw ('Map palette export failed: ' + $cause.GetType().Name + ': ' + $cause.Message)
}
