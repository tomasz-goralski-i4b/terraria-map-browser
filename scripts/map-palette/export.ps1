# Regenerates the shipped Terraria map palette (ADR 0002) from a local game installation:
#   ./scripts/map-palette/export.ps1 -TerrariaAssembly 'C:/Program Files (x86)/Steam/steamapps/common/Terraria/TerrariaServer.exe'
# Reads the game's map colours and English names at runtime through reflection (no decompiled code, nothing copied
# from other tools) and writes them as a TypeScript module. Re-run after a game update and commit the module.
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

function Require-Method([Type]$Type, [string]$Name, [Type[]]$Parameters, [Reflection.BindingFlags]$Bindings = $flags) {
    $method = $Type.GetMethod($Name, $Bindings, $null, $Parameters, $null)
    if ($null -eq $method) { throw "Unsupported map palette contract: missing $($Type.Name).$Name." }
    return $method
}

# Use the game's own loader for its embedded English localization, including copy commands and name caches.
function Initialize-English([Reflection.Assembly]$Game) {
    $manager = $Game.GetType('Terraria.Localization.LanguageManager', $true)
    $instance = Read-Field $manager 'Instance'
    $bindings = [Reflection.BindingFlags]'Instance,Public,NonPublic'
    $set = Require-Method $manager 'SetLanguage' ([Type[]]@([string])) $bindings
    $null = $set.Invoke($instance, @('en-US'))
    $active = $manager.GetProperty('ActiveCulture', $bindings)
    if ($null -eq $active) { throw 'Unsupported map palette contract: missing ActiveCulture.' }
    $culture = $active.GetValue($instance, $null)
    $reload = Require-Method $manager 'ReloadLanguage' ([Type[]]@($culture.GetType())) $bindings
    $null = $reload.Invoke($instance, @($culture))
    $lang = $Game.GetType('Terraria.Lang', $true)
    $initialize = Require-Method $lang 'InitializeLegacyLocalization' ([Type[]]@())
    $null = $initialize.Invoke($null, @())
    return @{ lang = $lang; instance = $instance; getText = (Require-Method $manager 'GetTextValue' ([Type[]]@([string])) $bindings) }
}

# Reverse the game's placement metadata, retaining a name only if all items placing that ID agree.
# A synthetic local player is needed for cosmetic item defaults; no player files, graphics or worlds are loaded.
function Read-ItemContentNames([Reflection.Assembly]$Game) {
    $main = $Game.GetType('Terraria.Main', $true)
    $playerField = $main.GetField('player', $flags)
    $local = $main.GetField('myPlayer', $flags)
    if ($null -eq $playerField -or $null -eq $local) { throw 'Unsupported map palette contract: player state.' }
    # Read the actual array directly: PowerShell pipeline enumeration would produce a copy.
    $players = $playerField.GetValue($null)
    $players.SetValue([Activator]::CreateInstance($Game.GetType('Terraria.Player', $true)), 0)
    $local.SetValue($null, 0)
    $itemType = $Game.GetType('Terraria.Item', $true)
    $variant = $Game.GetType('Terraria.GameContent.Items.ItemVariant', $true)
    $defaults = Require-Method $itemType 'SetDefaults' ([Type[]]@([int], $variant)) ([Reflection.BindingFlags]'Instance,Public,NonPublic')
    $count = [int](Read-Field ($Game.GetType('Terraria.ID.ItemID', $true)) 'Count')
    if ($count -lt 1 -or $count -gt 65535) { throw 'Unsupported map palette contract: item count.' }
    $candidates = @{ tiles = @{}; walls = @{}; paints = @{} }
    for ($id = 1; $id -lt $count; $id++) {
        $item = [Activator]::CreateInstance($itemType)
        $null = $defaults.Invoke($item, @([int]$id, $null))
        foreach ($layer in @('tiles', 'walls', 'paints')) {
            $content = switch ($layer) { 'tiles' { [int]$item.createTile } 'walls' { [int]$item.createWall } 'paints' { [int]$item.paint } }
            if ($content -lt 0 -or ($layer -eq 'paints' -and $content -eq 0)) { continue }
            $name = [string]$item.Name
            if ([string]::IsNullOrWhiteSpace($name)) { throw "Unsupported map palette contract: unnamed placement item $id." }
            if (-not $candidates[$layer].ContainsKey($content)) { $candidates[$layer][$content] = @{} }
            $candidates[$layer][$content][$name] = $true
        }
    }
    $names = @{ tiles = @{}; walls = @{}; paints = @{} }
    foreach ($layer in @('tiles', 'walls', 'paints')) {
        foreach ($id in $candidates[$layer].Keys) {
            if ($candidates[$layer][$id].Count -eq 1) { $names[$layer][$id] = [string]@($candidates[$layer][$id].Keys)[0] }
        }
    }
    return $names
}

function Read-Names([Array]$Lookup, [Array]$Counts, [Reflection.MethodInfo]$GetName, [hashtable]$PlacementNames) {
    $entries = New-Object 'Collections.Generic.List[object]'
    for ($id = 0; $id -lt $Lookup.Length; $id++) {
        $options = New-Object 'Collections.Generic.List[string]'
        for ($option = 0; $option -lt [int]$Counts[$id]; $option++) {
            $name = [string]$GetName.Invoke($null, @([int]($Lookup[$id] + $option)))
            if (-not $name -and $PlacementNames.ContainsKey($id)) { $name = $PlacementNames[$id] }
            $options.Add($name)
        }
        $entries.Add($options.ToArray())
    }
    return ,$entries.ToArray()
}

function Format-NameTable([string]$Name, [Array]$Entries) {
    $lines = New-Object 'Collections.Generic.List[string]'
    $lines.Add("  ${Name}: [")
    for ($id = 0; $id -lt $Entries.Length; $id++) {
        $options = @($Entries[$id] | ForEach-Object { ConvertTo-Json -InputObject ([string]$_) -Compress }) -join ', '
        $lines.Add("    [$options], // $id")
    }
    $lines.Add('  ],')
    return ,$lines
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

# Per multi-option content, the frame -> option rule the game applies, from observe.ps1 (ADR 0002: observed, never
# read). Returns the rules by layer plus the IDs whose option depends on more than the frame (they keep option 0).
# An assembly without Terraria.Tile and CreateMapTile (a synthetic fixture) has nothing to observe.
function Read-FrameRules([Reflection.Assembly]$Game, [Type]$Map, [string]$AssemblyPath) {
    $rules = @{ block = @{}; wall = @{} }
    $more = @{ block = @(); wall = @() }
    if ($null -eq $Game.GetType('Terraria.Tile', $false) -or $null -eq $Map.GetMethod('CreateMapTile', $flags)) {
        return @{ rules = $rules; more = $more }
    }
    $observed = Join-Path ([IO.Path]::GetTempPath()) ('terraria-map-observation-' + [Guid]::NewGuid().ToString('N') + '.json')
    try {
        $hostPath = (Get-Process -Id $PID).Path
        & $hostPath -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'observe.ps1') -TerrariaAssembly $AssemblyPath -OutputPath $observed
        if ($LASTEXITCODE -ne 0) { throw 'The map observation failed.' }
        $frames = (Get-Content -LiteralPath $observed -Raw -Encoding UTF8 | ConvertFrom-Json).frames
    } finally {
        Remove-Item -LiteralPath $observed -ErrorAction SilentlyContinue
    }
    foreach ($content in $frames) {
        if ($content.dependsOnMore) { $more[$content.layer] += "$([int]$content.id) ($($content.dependsOn))"; continue }
        $rules[$content.layer][[int]$content.id] = $content.rule
    }
    return @{ rules = $rules; more = $more }
}

# `name: { id: { axis, ranges }, ... },` for the IDs that have a rule, in ID order.
function Format-Rules([string]$Name, [hashtable]$Rules) {
    $lines = New-Object 'Collections.Generic.List[string]'
    if ($Rules.Count -eq 0) { return ,$lines }
    $lines.Add("  ${Name}: {")
    foreach ($id in ($Rules.Keys | Sort-Object)) {
        $ranges = @($Rules[$id].ranges | ForEach-Object { "[$($_[0]), $($_[1]), $($_[2])]" }) -join ', '
        $lines.Add("    ${id}: { axis: `"$($Rules[$id].axis)`", ranges: [$ranges] },")
    }
    $lines.Add('  },')
    return ,$lines
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

    $english = Initialize-English $game
    $atlas = Require-Method $english.lang 'BuildMapAtlas' ([Type[]]@())
    $null = $atlas.Invoke($null, @())
    $getName = Require-Method $english.lang 'GetMapObjectName' ([Type[]]@([int]))

    $colours = Read-Field $map 'colorLookup'
    $tiles = Read-Options (Read-Field $map 'tileLookup') (Read-Field $map 'tileOptionCounts') $colours
    $walls = Read-Options (Read-Field $map 'wallLookup') (Read-Field $map 'wallOptionCounts') $colours
    $placementNames = Read-ItemContentNames $game
    $tileNames = Read-Names (Read-Field $map 'tileLookup') (Read-Field $map 'tileOptionCounts') $getName $placementNames.tiles
    $wallNames = Read-Names (Read-Field $map 'wallLookup') (Read-Field $map 'wallOptionCounts') $getName $placementNames.walls
    # Runtime localization keys observed in the installed game; these are references, not a copied name table.
    $liquidNames = @('LegacyInterface.53', 'LegacyInterface.56', 'LegacyInterface.58', 'SlimeNames_Rainbow.Shimmer') | ForEach-Object {
        $name = [string]$english.getText.Invoke($english.instance, @([string]$_))
        if ([string]::IsNullOrWhiteSpace($name) -or $name -eq $_) { throw "Unsupported map palette contract: unresolved localization $_." }
        $name
    }
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

    $frameRules = Read-FrameRules $game $map $assemblyPath

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
    $lines.Add('import type { MapContentNames, MapPalette } from "./map-palette.js";')
    $lines.Add('')
    $lines.Add('export const terrariaMapPalette: MapPalette = {')
    $lines.Add("  gameVersion: `"$version`",")
    $lines.AddRange([string[]](Format-Table 'tiles' $tiles))
    $lines.AddRange([string[]](Format-Table 'walls' $walls))
    $lines.AddRange([string[]](Format-Rules 'tileOptions' $frameRules.rules.block))
    $lines.AddRange([string[]](Format-Rules 'wallOptions' $frameRules.rules.wall))
    foreach ($layer in @('block', 'wall')) {
        if ($frameRules.more[$layer].Count -gt 0) {
            $lines.Add("  // $layer IDs whose option depends on more than the frame (they keep option 0): $($frameRules.more[$layer] -join ', ')")
        }
    }
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
    $lines.Add('')
    $lines.Add('// English map legend names, with unambiguous placement-item names for unnamed content (ADR 0002).')
    $lines.Add('export const terrariaMapNames: MapContentNames = {')
    $lines.Add("  gameVersion: `"$version`",")
    $lines.AddRange([string[]](Format-NameTable 'tiles' $tileNames))
    $lines.AddRange([string[]](Format-NameTable 'walls' $wallNames))
    $quotedLiquids = @($liquidNames | ForEach-Object { ConvertTo-Json -InputObject ([string]$_) -Compress }) -join ', '
    $lines.Add("  liquids: [$quotedLiquids],")
    $quotedPaints = @(0..($paintCount - 1) | ForEach-Object {
        $name = if ($placementNames.paints.ContainsKey($_)) { $placementNames.paints[$_] } else { '' }
        ConvertTo-Json -InputObject ([string]$name) -Compress
    }) -join ', '
    $lines.Add("  paints: [$quotedPaints],")
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
