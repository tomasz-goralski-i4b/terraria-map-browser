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
$gameDirectory = [IO.Path]::GetDirectoryName($assemblyPath)
$script:gameAssembly = $null
$script:resolving = $false

# Dependencies come from the installation itself: its directory or the game assembly's embedded DLL resources.
$resolver = [ResolveEventHandler] {
    param($sender, $request)
    if ($script:resolving) { return $null }
    $script:resolving = $true
    try {
        $name = ([Reflection.AssemblyName]$request.Name).Name
        $dependency = Join-Path $gameDirectory ($name + '.dll')
        if (Test-Path -LiteralPath $dependency) { return [Reflection.Assembly]::LoadFrom($dependency) }
        if ($null -eq $script:gameAssembly) { return $null }
        foreach ($resource in $script:gameAssembly.GetManifestResourceNames()) {
            if ($resource -eq ($name + '.dll') -or $resource.EndsWith('.' + $name + '.dll', [StringComparison]::OrdinalIgnoreCase)) {
                $stream = $script:gameAssembly.GetManifestResourceStream($resource)
                $buffer = New-Object IO.MemoryStream
                try {
                    $stream.CopyTo($buffer)
                    return [Reflection.Assembly]::Load($buffer.ToArray())
                } finally { $stream.Dispose(); $buffer.Dispose() }
            }
        }
        return $null
    } finally { $script:resolving = $false }
}
[AppDomain]::CurrentDomain.add_AssemblyResolve($resolver)
$flags = [Reflection.BindingFlags]'Static,Public,NonPublic'

function Read-Field([Type]$Type, [string]$Name) {
    $field = $Type.GetField($Name, $flags)
    if ($null -eq $field) { throw "Unsupported map palette contract: missing $Name." }
    $value = $field.GetValue($null)
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

function Format-Colour([int]$Colour) { return '0x{0:x6}' -f $Colour }

function Format-Table([string]$Name, [Array]$Entries) {
    $lines = New-Object 'Collections.Generic.List[string]'
    $lines.Add("  ${Name}: [")
    for ($id = 0; $id -lt $Entries.Length; $id++) {
        $colours = @($Entries[$id] | ForEach-Object { Format-Colour $_ }) -join ', '
        $lines.Add("    [$colours], // $id")
    }
    $lines.Add('  ],')
    return $lines
}

try {
    $script:gameAssembly = [Reflection.Assembly]::LoadFrom($assemblyPath)
    # Main's static initializer expects the launcher's save root. This process never opens or saves a world.
    $program = $script:gameAssembly.GetType('Terraria.Program', $false)
    if ($null -ne $program) {
        $savePath = $program.GetField('SavePath', $flags)
        if ($null -ne $savePath -and $null -eq $savePath.GetValue($null)) { $savePath.SetValue($null, [IO.Path]::GetTempPath()) }
    }
    $map = $script:gameAssembly.GetType('Terraria.Map.MapHelper', $true)
    $initialize = $map.GetMethod('Initialize', $flags, $null, [Type[]]@(), $null)
    if ($null -eq $initialize) { throw 'Unsupported map palette contract: missing Initialize().' }
    $null = $initialize.Invoke($null, @())

    $colours = Read-Field $map 'colorLookup'
    $tiles = Read-Options (Read-Field $map 'tileLookup') (Read-Field $map 'tileOptionCounts') $colours
    $walls = Read-Options (Read-Field $map 'wallLookup') (Read-Field $map 'wallOptionCounts') $colours
    # Water, lava, honey and shimmer follow each other in the colour table.
    $liquidStart = [int](Read-Field $map 'liquidPosition')
    if ($liquidStart -le 0 -or $liquidStart + 4 -gt $colours.Length) { throw 'Unsupported map palette liquid lookup range.' }
    $liquids = @(0..3 | ForEach-Object { Format-Colour (Read-Colour ($colours.GetValue($liquidStart + $_))) }) -join ', '

    $version = $script:gameAssembly.GetName().Version.ToString()
    $main = $script:gameAssembly.GetType('Terraria.Main', $false)
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
    $lines.Add("  liquids: [$liquids],")
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
} finally {
    [AppDomain]::CurrentDomain.remove_AssemblyResolve($resolver)
}
