# POC: execute locally, never in the browser. Uses the installed game's .NET runtime contract, not decompiled code.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TerrariaAssembly,
    [string]$OutputPath = (Join-Path (Get-Location) 'local-assets/terraria.terraria-map-palette.json')
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Windows Terraria uses the 32-bit XNA/.NET Framework runtime. Do not load it in a .NET Core browser host.
if ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitProcess) {
    $hostPath = Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    if (Test-Path -LiteralPath $hostPath) {
        & $hostPath -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -TerrariaAssembly $TerrariaAssembly -OutputPath $OutputPath
        if ($LASTEXITCODE -ne 0) { throw 'Local map palette export failed in the .NET Framework host.' }
        return
    }
}

$assemblyPath = (Resolve-Path -LiteralPath $TerrariaAssembly).Path
$output = [IO.Path]::GetFullPath($OutputPath)
if (-not $output.EndsWith('.terraria-map-palette.json', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Map palette output must end with .terraria-map-palette.json (game-derived files are gitignored).'
}
$gameDirectory = [IO.Path]::GetDirectoryName($assemblyPath)
$script:paletteGameAssembly = $null
$script:resolvingPaletteAssembly = $false

# Resolve dependencies from this installation or its embedded DLL resources. Nothing is downloaded or copied.
$resolver = [ResolveEventHandler] {
    param($sender, $request)
    if ($script:resolvingPaletteAssembly) { return $null }
    $script:resolvingPaletteAssembly = $true
    try {
    $name = ([Reflection.AssemblyName]$request.Name).Name
    $dependency = Join-Path $gameDirectory ($name + '.dll')
    if (Test-Path -LiteralPath $dependency) { return [Reflection.Assembly]::LoadFrom($dependency) }
    if ($null -ne $script:paletteGameAssembly) {
        foreach ($resource in $script:paletteGameAssembly.GetManifestResourceNames()) {
            if ($resource.EndsWith('.' + $name + '.dll', [StringComparison]::OrdinalIgnoreCase) -or $resource -eq ($name + '.dll')) {
                $stream = $script:paletteGameAssembly.GetManifestResourceStream($resource)
                $buffer = New-Object IO.MemoryStream
                try {
                    $stream.CopyTo($buffer)
                    return [Reflection.Assembly]::Load($buffer.ToArray())
                } finally { $stream.Dispose(); $buffer.Dispose() }
            }
        }
    }
        return $null
    } finally { $script:resolvingPaletteAssembly = $false }
}
[AppDomain]::CurrentDomain.add_AssemblyResolve($resolver)
$flags = [Reflection.BindingFlags]'Static,Public,NonPublic'

function Read-PaletteField([Type]$Type, [string]$Name) {
    $field = $Type.GetField($Name, $flags)
    if ($null -eq $field) { throw "Unsupported map palette contract: missing $Name." }
    $value = $field.GetValue($null)
    if ($null -eq $value) { throw "Map palette field $Name was not initialized." }
    return ,$value
}

function Read-Rgb($Colour) {
    $rgb = New-Object 'Collections.Generic.List[int]'
    foreach ($channel in @('R', 'G', 'B')) {
        $property = $Colour.GetType().GetProperty($channel)
        if ($null -eq $property) { throw "Unsupported map palette colour contract: missing $channel." }
        $value = [Convert]::ToInt32($property.GetValue($Colour, $null))
        if ($value -lt 0 -or $value -gt 255) { throw 'Map palette RGB channel is out of range.' }
        $rgb.Add($value)
    }
    return ,$rgb.ToArray()
}

function Read-Variants([Array]$Lookup, [Array]$Counts, [Array]$Colours) {
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
        $variants = New-Object 'Collections.Generic.List[object]'
        for ($option = 0; $option -lt $count; $option++) {
            $variants.Add((Read-Rgb ($Colours.GetValue($start + $option))))
        }
        $entries.Add($variants.ToArray())
    }
    return ,$entries.ToArray()
}

try {
    $script:paletteGameAssembly = [Reflection.Assembly]::LoadFrom($assemblyPath)
    # Main's static initializer expects the launcher's save root. This process never opens/saves a world.
    $program = $script:paletteGameAssembly.GetType('Terraria.Program', $false)
    if ($null -ne $program) {
        $savePath = $program.GetField('SavePath', $flags)
        if ($null -ne $savePath -and $null -eq $savePath.GetValue($null)) {
            $savePath.SetValue($null, [IO.Path]::GetTempPath())
        }
    }
    $map = $script:paletteGameAssembly.GetType('Terraria.Map.MapHelper', $true)
    $initialize = $map.GetMethod('Initialize', $flags, $null, [Type[]]@(), $null)
    if ($null -eq $initialize) { throw 'Unsupported map palette contract: missing Initialize().' }
    $null = $initialize.Invoke($null, @())
    $colours = Read-PaletteField $map 'colorLookup'
    $liquidStart = [int](Read-PaletteField $map 'liquidPosition')
    if ($liquidStart -le 0 -or $liquidStart + 4 -gt $colours.Length) { throw 'Unsupported map palette liquid lookup range.' }
    $liquids = New-Object 'Collections.Generic.List[object]'
    for ($kind = 0; $kind -lt 4; $kind++) { $liquids.Add((Read-Rgb ($colours.GetValue($liquidStart + $kind)))) }
    $version = $script:paletteGameAssembly.GetName().Version.ToString()
    $main = $script:paletteGameAssembly.GetType('Terraria.Main', $false)
    if ($null -ne $main) {
        $versionField = $main.GetField('versionNumber', $flags)
        if ($null -ne $versionField -and $versionField.IsLiteral) { $version = [string]$versionField.GetRawConstantValue() }
    }
    $palette = [ordered]@{
        schemaVersion = 1
        gameVersion = $version
        tiles = (Read-Variants (Read-PaletteField $map 'tileLookup') (Read-PaletteField $map 'tileOptionCounts') $colours)
        walls = (Read-Variants (Read-PaletteField $map 'wallLookup') (Read-PaletteField $map 'wallOptionCounts') $colours)
        liquids = $liquids.ToArray()
    }
    # Validate the entire reflected contract before touching output. The path is not recorded in the JSON.
    $json = ConvertTo-Json -InputObject $palette -Depth 12 -Compress
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output))
    [IO.File]::WriteAllText($output, $json, (New-Object Text.UTF8Encoding($false)))
    Write-Host "Exported map palette for $version to $output"
} catch {
    $cause = $_.Exception
    while ($null -ne $cause.InnerException) { $cause = $cause.InnerException }
    Write-Verbose $cause.ToString()
    throw ("Map palette export failed: " + $cause.GetType().Name + ": " + $cause.Message)
} finally {
    [AppDomain]::CurrentDomain.remove_AssemblyResolve($resolver)
}
