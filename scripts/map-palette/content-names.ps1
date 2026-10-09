# Runtime metadata only: no localization assets or game implementation are read.
function Read-ContentSymbols([Reflection.Assembly]$Game, [string]$TypeName, [int]$Count) {
    $symbols = @{}
    $type = $Game.GetType("Terraria.ID.$TypeName", $false)
    if ($null -eq $type) { return $symbols }
    foreach ($field in $type.GetFields([Reflection.BindingFlags]'Public,Static')) {
        if (-not $field.IsLiteral -or $field.Name -eq 'Count' -or $field.FieldType -notin @([byte], [int16], [uint16], [int])) { continue }
        $id = [int]$field.GetRawConstantValue()
        if ($id -lt 0 -or $id -ge $Count) { continue }
        if (-not $symbols.ContainsKey($id)) { $symbols[$id] = @() }
        $symbols[$id] += $field.Name
    }
    foreach ($id in @($symbols.Keys)) { $symbols[$id] = @($symbols[$id] | Sort-Object -CaseSensitive) }
    return $symbols
}

# Preserve acronyms and variant numbers; split PascalCase and underscores without guessing translations.
function Format-ContentSymbol([string]$Symbol, [string]$TypeName) {
    $natural = $TypeName -eq 'WallID' -and $Symbol -cmatch 'Unsafe[0-9]*$'
    if ($natural) { $Symbol = $Symbol -creplace 'Unsafe([0-9]*)$', '$1' }
    $label = $Symbol -creplace '([A-Z])([A-Z][a-z])', '$1 $2'
    $label = $label -creplace '([a-z0-9])([A-Z])', '$1 $2'
    $label = $label -creplace '([A-Za-z])([0-9])', '$1 $2'
    $label = $label -replace '_', ' '
    $label = $label -replace '\b([0-9]+)[xX] ([0-9]+)\b', '$1x$2'
    $label = ($label -replace '\s+', ' ').Trim()
    if ($TypeName -eq 'WallID' -and $label -ne 'None') {
        if ($label -notmatch '\bWall\b') { $label += ' Wall' }
        if ($natural) { $label = "Natural $label" }
    }
    return $label
}

function Read-ContentNames([Reflection.Assembly]$Game, [string]$TypeName, [Array]$Lookup, [Array]$Counts, [Reflection.MethodInfo]$GetName, [hashtable]$PlacementNames) {
    $sources = @{}
    $names = Read-Names $Lookup $Counts $GetName $PlacementNames $sources
    $symbols = Read-ContentSymbols $Game $TypeName $Lookup.Length
    $metadata = New-Object 'Collections.Generic.List[object]'
    $gaps = New-Object 'Collections.Generic.List[object]'
    for ($id = 0; $id -lt $Lookup.Length; $id++) {
        $aliases = @(if ($symbols.ContainsKey($id)) { $symbols[$id] })
        $markedUnused = @($aliases | Where-Object { $_ -cmatch 'Unused|Deprecated|Reserved' }).Count -gt 0
        $symbolStatus = if ($aliases.Count -eq 0) { 'unavailable' }
            elseif ($aliases.Count -gt 1) { 'ambiguous' }
            elseif ($markedUnused) { 'unused' }
            else { 'present' }
        $before = @($names[$id])
        # No map colour does not mean unused: pressure plates and echo blocks are real content.
        if ($before.Count -eq 0 -and $PlacementNames.ContainsKey($id)) {
            $names[$id] = @([string]$PlacementNames[$id])
            $sources[$id] = @('placement')
        }
        $first = @($names[$id])
        if (($first.Count -eq 0 -or -not $first[0]) -and $aliases.Count -eq 1) {
            $label = Format-ContentSymbol $aliases[0] $TypeName
            if ($label) {
                if ($first.Count -eq 0) { $first = @(''); $sources[$id] = @('unresolved') }
                for ($option = 0; $option -lt $first.Count; $option++) {
                    if (-not $first[$option]) { $first[$option] = $label; $sources[$id][$option] = 'symbol' }
                }
                $names[$id] = $first
            }
        }
        $metadata.Add(@{ symbols = $aliases; symbolStatus = $symbolStatus; mapOptionCount = [int]$Counts[$id]; nameSources = @($sources[$id]) })
        if ($markedUnused -or $before.Count -eq 0 -or @($before | Where-Object { -not $_ }).Count -gt 0) {
            $label = if (@($names[$id]).Count -gt 0) { [string]$names[$id][0] } else { '' }
            $reason = if ($label) {
                if ($markedUnused -and $before.Count -gt 0 -and $before[0]) { 'existing name (unused/deprecated/reserved symbol)' }
                elseif ($markedUnused) { "diagnostic $($sources[$id][0]) fallback (unused/deprecated/reserved)" }
                elseif ($before.Count -gt 0 -and $before[0]) { 'empty options retain option-zero fallback' }
                else { "$($sources[$id][0]) fallback" }
            } elseif ($aliases.Count -eq 0) { 'unavailable symbolic metadata' }
            elseif ($aliases.Count -gt 1) { 'ambiguous symbolic aliases' }
            else { 'unresolved symbol' }
            $category = if ($markedUnused) { 'unused/obsolete' }
                elseif ($TypeName -eq 'WallID') { 'wall' }
                elseif (($aliases -join ' ') -match 'Grass|MossBrick|Gemspark|Block') { 'terrain' }
                elseif (($aliases -join ' ') -match 'Plant|Vine|Moss|Cattail|Lily|Oats|Bamboo|Seaweed|Thorn') { 'vegetation' }
                else { 'object/other' }
            $gaps.Add(@{ id = $id; symbols = $aliases; category = $category; count = [int]$Counts[$id]; label = $label; reason = $reason })
        }
    }
    return @{ names = $names; metadata = $metadata.ToArray(); gaps = $gaps.ToArray() }
}

function Format-ContentCoverage([string]$Version, [hashtable]$Data, [string]$Kind) {
    $lines = New-Object 'Collections.Generic.List[string]'
    $lines.Add("# Generated vanilla $Kind name coverage")
    $lines.Add('')
    $lines.Add('Generated by scripts/map-palette/export.ps1; do not edit. See ADR 0002 for the naming policy.')
    $lines.Add("Terraria version: $Version. Regenerate with the exporter's -CoveragePath parameter.")
    $named = @($Data.names | Where-Object { @($_).Count -gt 0 -and $_[0] }).Count
    $lines.Add("Named $Kind IDs: $named/$($Data.names.Length). Residual unnamed $Kind IDs: $($Data.names.Length - $named).")
    $unused = @($Data.metadata | Where-Object { $_.symbolStatus -eq 'unused' }).Count
    $lines.Add("Unused/obsolete symbolic entries (included above with diagnostic labels): $unused.")
    $lines.Add('')
    $lines.Add('Every ID with an empty legend/placement option is listed below, including content with no map colour.')
    $lines.Add('Category is a triage hint derived from symbol words, not a game taxonomy or proof an ID is used.')
    $lines.Add('Existing option-zero labels still cover empty nonzero options; no frame-specific label is replaced.')
    $lines.Add('')
    $lines.Add('| ID | Runtime symbols | Category | Map options | Default label | Source or residual reason |')
    $lines.Add('| --- | --- | --- | --- | --- | --- |')
    foreach ($gap in $Data.gaps) {
        $label = $gap.label.Replace('|', '\|').Replace("`r", '').Replace("`n", '<br>')
        $lines.Add("| $($gap.id) | $($gap.symbols -join ', ') | $($gap.category) | $($gap.count) | $label | $($gap.reason) |")
    }
    return ,$lines.ToArray()
}

function Format-NameMetadata([string]$Name, [Array]$Records) {
    $lines = New-Object 'Collections.Generic.List[string]'
    $lines.Add("  ${Name}: [")
    foreach ($record in $Records) {
        $symbols = @($record.symbols | ForEach-Object { ConvertTo-Json -InputObject ([string]$_) -Compress }) -join ', '
        $sources = @($record.nameSources | ForEach-Object { ConvertTo-Json -InputObject ([string]$_) -Compress }) -join ', '
        $lines.Add("    { symbols: [$symbols], symbolStatus: `"$($record.symbolStatus)`", mapOptionCount: $($record.mapOptionCount), nameSources: [$sources] },")
    }
    $lines.Add('  ],')
    return ,$lines.ToArray()
}
