# Observe item names, texture aliases and inventory frames from an installed game; never read game code.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$TerrariaAssembly,
    [Parameter(Mandatory = $true)][string]$DimensionsPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -eq 'Windows_NT' -and [Environment]::Is64BitProcess) {
    $itemHost = Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
    & $itemHost -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $PSCommandPath -TerrariaAssembly $TerrariaAssembly -DimensionsPath $DimensionsPath -OutputPath $OutputPath
    if ($LASTEXITCODE -ne 0) { throw 'Item observation failed in the 32-bit host.' }
    exit 0
}
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Reflection;
public static class ItemObservationHost {
    static Assembly game;
    static string directory;
    public static Assembly Load(string path) {
        directory = Path.GetDirectoryName(path);
        AppDomain.CurrentDomain.AssemblyResolve += Resolve;
        game = Assembly.LoadFrom(path);
        return game;
    }
    static Assembly Resolve(object sender, ResolveEventArgs args) {
        string name = new AssemblyName(args.Name).Name;
        string path = Path.Combine(directory, name + ".dll");
        if (File.Exists(path)) return Assembly.LoadFrom(path);
        if (game != null) foreach (string resource in game.GetManifestResourceNames()) {
            if (resource == name + ".dll" || resource.EndsWith("." + name + ".dll", StringComparison.OrdinalIgnoreCase)) {
                using (Stream source = game.GetManifestResourceStream(resource))
                using (MemoryStream buffer = new MemoryStream()) {
                    source.CopyTo(buffer); return Assembly.Load(buffer.ToArray());
                }
            }
        }
        return null;
    }
}
'@
$itemAssemblyPath = (Resolve-Path -LiteralPath $TerrariaAssembly).Path
$itemGame = [ItemObservationHost]::Load($itemAssemblyPath)
$itemFlags = [Reflection.BindingFlags]'Public,NonPublic,Static,Instance'
# As in the map-palette observer: Main's initializer requires the launcher's save root. No world/player is loaded.
$itemGame.GetType('Terraria.Program',$true).GetField('SavePath',$itemFlags).SetValue($null,[IO.Path]::GetTempPath())
$itemManagerType = $itemGame.GetType('Terraria.Localization.LanguageManager',$true)
$itemManager = $itemManagerType.GetField('Instance',$itemFlags).GetValue($null)
$null = $itemManagerType.GetMethod('SetLanguage',$itemFlags,$null,[Type[]]@([string]),$null).Invoke($itemManager,@('en-US'))
$itemCulture = $itemManagerType.GetProperty('ActiveCulture',$itemFlags).GetValue($itemManager,$null)
$null = $itemManagerType.GetMethod('ReloadLanguage',$itemFlags).Invoke($itemManager,@($itemCulture))
$itemLang = $itemGame.GetType('Terraria.Lang',$true)
$null = $itemLang.GetMethod('InitializeLegacyLocalization',$itemFlags).Invoke($null,@())
$itemGetName = $itemLang.GetMethod('GetItemNameValue',$itemFlags)
$itemMain = $itemGame.GetType('Terraria.Main',$true)
$null = $itemMain.GetMethod('InitializeItemAnimations',$itemFlags).Invoke($null,@())
$itemAnimations = $itemMain.GetField('itemAnimations',$itemFlags).GetValue($null)
$itemIds = $itemGame.GetType('Terraria.ID.ItemID',$true)
$itemCount = [int]$itemIds.GetField('Count',$itemFlags).GetValue($null)
if ($itemCount -lt 1 -or $itemCount -gt 65536) { throw 'Invalid ItemID.Count.' }
$itemAliases = $itemGame.GetType('Terraria.ID.ItemID+Sets',$true).GetField('TextureCopyLoad',$itemFlags).GetValue($null)
$itemSymbols = @{}
foreach ($itemField in $itemIds.GetFields($itemFlags)) {
    if ($itemField.IsLiteral -and $itemField.Name -ne 'Count' -and $itemField.FieldType -in @([int],[int16],[uint16])) {
        $itemId = [int]$itemField.GetRawConstantValue()
        if ($itemId -ge 0 -and $itemId -lt $itemCount) {
            if (-not $itemSymbols.ContainsKey($itemId)) { $itemSymbols[$itemId] = @() }
            $itemSymbols[$itemId] += $itemField.Name
        }
    }
}
$itemDimensions = @{}
foreach ($itemSize in (Get-Content -LiteralPath $DimensionsPath -Encoding UTF8 | ConvertFrom-Json)) { $itemDimensions[[int]$itemSize.id] = $itemSize }
$itemTextureType = $null
foreach ($itemLoadedAssembly in [AppDomain]::CurrentDomain.GetAssemblies()) {
    $itemCandidate = $itemLoadedAssembly.GetType('Microsoft.Xna.Framework.Graphics.Texture2D',$false)
    if ($null -ne $itemCandidate) { $itemTextureType = $itemCandidate; break }
}
if ($null -eq $itemTextureType) { throw 'XNA Texture2D type was not loaded.' }
$itemWidthField = $itemTextureType.GetField('_width',$itemFlags)
$itemHeightField = $itemTextureType.GetField('_height',$itemFlags)
if ($null -eq $itemWidthField -or $null -eq $itemHeightField) { throw 'Unsupported Texture2D dimensions contract.' }
$itemEntries = New-Object 'Collections.Generic.List[object]'
for ($itemId=0; $itemId -lt $itemCount; $itemId++) {
    $itemName = [string]$itemGetName.Invoke($null,@($itemId))
    $itemNameStatus = if ($itemId -eq 0) { 'empty' } elseif ([string]::IsNullOrWhiteSpace($itemName)) { 'unnamed' } else { 'resolved' }
    $itemTextureId = $itemId
    $itemVisited = @{}
    while ($itemAliases[$itemTextureId] -ge 0) {
        if ($itemVisited.ContainsKey($itemTextureId)) { throw "Texture alias cycle at item $itemId." }
        $itemVisited[$itemTextureId] = $true
        $itemTextureId = [int]$itemAliases[$itemTextureId]
        if ($itemTextureId -lt 0 -or $itemTextureId -ge $itemCount) { throw "Invalid texture alias for item $itemId." }
    }
    $itemFrame = $null
    $itemSpriteStatus = if ($itemId -eq 0) { 'empty' } else { 'missing' }
    if ($itemId -gt 0 -and $itemDimensions.ContainsKey($itemTextureId)) {
        $itemSize = $itemDimensions[$itemTextureId]
        $itemFrame = @{ x=0; y=0; width=[int]$itemSize.width; height=[int]$itemSize.height }
        $itemAnimation = $itemAnimations[$itemId]
        if ($null -ne $itemAnimation) {
            # A dimensions-only Texture2D lets the game's GetFrame calculate the rectangle without a GPU.
            # No native texture is created; suppress its finalizer before it can touch native graphics state.
            $itemTexture = [Runtime.Serialization.FormatterServices]::GetUninitializedObject($itemTextureType)
            [GC]::SuppressFinalize($itemTexture)
            $itemWidthField.SetValue($itemTexture,[int]$itemSize.width)
            $itemHeightField.SetValue($itemTexture,[int]$itemSize.height)
            $itemRectangle = $itemAnimation.GetType().GetMethod('GetFrame',$itemFlags).Invoke($itemAnimation,@($itemTexture,[int]0))
            $itemFrame = @{ x=[int]$itemRectangle.X; y=[int]$itemRectangle.Y; width=[int]$itemRectangle.Width; height=[int]$itemRectangle.Height }
        }
        $itemSpriteStatus = 'available'
    }
    $itemEntries.Add(@{ id=$itemId; name=$itemName; nameStatus=$itemNameStatus; symbols=@($itemSymbols[$itemId] | Sort-Object); textureId=$(if ($itemId -eq 0) { $null } else { $itemTextureId }); frame=$itemFrame; spriteStatus=$itemSpriteStatus })
}
$itemPrefixes = @($itemLang.GetField('prefix',$itemFlags).GetValue($null) | ForEach-Object { if ($null -eq $_) { '' } else { [string]$_.Value } })
$itemVersionField = $itemMain.GetField('versionNumber',$itemFlags)
$itemVersion = ([string]$(if ($itemVersionField.IsLiteral) { $itemVersionField.GetRawConstantValue() } else { $itemVersionField.GetValue($null) })).TrimStart('v')
$itemObservation = @{ schemaVersion=1; gameVersion=$itemVersion; assemblySha256=(Get-FileHash -LiteralPath $itemAssemblyPath -Algorithm SHA256).Hash.ToLowerInvariant(); itemCount=$itemCount; prefixes=$itemPrefixes; items=$itemEntries.ToArray() }
$itemOutput = [IO.Path]::GetFullPath($OutputPath)
[IO.File]::WriteAllText($itemOutput,($itemObservation | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
Write-Output "Observed $itemCount item IDs from Terraria $itemVersion."
