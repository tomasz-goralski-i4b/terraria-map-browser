# Reproduce the selected .NET oracle values without any TypeScript runtime calls.
# Run from the repository root:
# powershell -NoProfile -File packages/world-codec/tests/fixtures/world-details-oracle.ps1
# Add -Progressed for an in-memory synthetic progression overlay on the generated SCCO1 fixture.
# Independently walks MetadataSection.cs rows 1-49 using BinaryReader / DateTime.FromBinary.
param([switch]$Progressed)
$progression = @{
  eyeOfCthulhu = $true; eaterOfWorldsOrBrainOfCthulhu = $true; skeletron = $true; queenBee = $true
  destroyer = $true; twins = $true; skeletronPrime = $true; anyMechanicalBoss = $true
  plantera = $true; golem = $false; kingSlime = $true; dukeFishron = $true
  lunaticCultist = $false; moonLord = $false; pumpking = $true; mourningWood = $true
  iceQueen = $false; santaNk1 = $true; everscream = $true; empressOfLight = $false
  queenSlime = $true; deerclops = $true
}
function Read-Boss([string]$name) {
  $bossOffsets[$name] = $stream.Position
  if ($Progressed) { $payload[$stream.Position] = [byte][bool]$progression[$name] }
  return $reader.ReadBoolean()
}
$worlds = Get-Content -Encoding UTF8 packages/test-fixtures/worlds/manifest.json | ConvertFrom-Json
foreach ($world in $worlds.worlds) {
  if ($Progressed -and $world.file -ne 'SCCO1.wld') { continue }
  $payload = [IO.File]::ReadAllBytes((Join-Path $PWD "packages/test-fixtures/worlds/$($world.file)"))
  $stream = New-Object IO.MemoryStream(,$payload)
  $bossOffsets = @{}
  $reader = New-Object IO.BinaryReader($stream)
  $stream.Position = 26
  $start = $reader.ReadInt32()
  $stream.Position = $start
  $null = $reader.ReadString(); $null = $reader.ReadString()
  $worldGen = $reader.ReadUInt64().ToString()
  $null = $reader.ReadBytes(16 + 4 + 16 + 8 + 4 + 9)
  $creation = [DateTime]::FromBinary($reader.ReadInt64())
  $lastPlayed = [DateTime]::FromBinary($reader.ReadInt64())
  $null = $reader.ReadByte(); $null = $reader.ReadBytes(17 * 4)
  $spawn = @{ x = $reader.ReadInt32(); y = $reader.ReadInt32() }
  $null = $reader.ReadDouble(); $null = $reader.ReadDouble()
  $time = $reader.ReadDouble(); $day = $reader.ReadBoolean(); $moon = $reader.ReadInt32()
  $blood = $reader.ReadBoolean(); $eclipse = $reader.ReadBoolean()
  $dungeon = @{ x = $reader.ReadInt32(); y = $reader.ReadInt32() }
  $null = $reader.ReadBoolean()
  $bosses = @{}
  foreach ($name in @('eyeOfCthulhu','eaterOfWorldsOrBrainOfCthulhu','skeletron','queenBee','destroyer','twins','skeletronPrime','anyMechanicalBoss','plantera','golem','kingSlime')) { $bosses[$name] = Read-Boss $name }
  $null = $reader.ReadBytes(7 + 2 + 1 + 4)
  $hardmodeOffset = $stream.Position
  if ($Progressed) { $payload[$hardmodeOffset] = 1 }
  $hardmode = $reader.ReadBoolean()
  $null = $reader.ReadBytes(1 + 3 * 4 + 2 * 8 + 1 + 1 + 4 + 4 + 3 * 4 + 8 + 4 + 2 + 4)
  $finishers = $reader.ReadInt32()
  for ($i = 0; $i -lt $finishers; $i++) { $null = $reader.ReadString() }
  $null = $reader.ReadBytes(1 + 4 + 3 + 8)
  $kills = $reader.ReadInt16(); $null = $reader.ReadBytes($kills * 4)
  $banners = $reader.ReadInt16(); $null = $reader.ReadBytes($banners * 2)
  $null = $reader.ReadBoolean()
  $fishron = Read-Boss 'dukeFishron'; $martians = $reader.ReadBoolean()
  foreach ($name in @('lunaticCultist','moonLord','pumpking','mourningWood','iceQueen','santaNk1','everscream')) { $bosses[$name] = Read-Boss $name }
  $bosses.dukeFishron = $fishron
  $null = $reader.ReadBytes(9 + 2 + 4)
  $partyCount = $reader.ReadInt32(); $null = $reader.ReadBytes($partyCount * 4)
  $null = $reader.ReadBytes(1 + 12 + 4 + 5 + 1 + 4 + 3)
  $treeCount = $reader.ReadInt32(); $null = $reader.ReadBytes($treeCount * 4)
  $null = $reader.ReadBytes(2 + 16 + 3)
  foreach ($name in @('empressOfLight','queenSlime','deerclops')) { $bosses[$name] = Read-Boss $name }
  $result = @{
    file = $world.file
    generation = @{ worldGenVersion = $worldGen; creationTime = $creation.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"); lastPlayed = $lastPlayed.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") }
    spawnAndLandmarks = @{ spawn = $spawn; dungeon = $dungeon }
    timeAndWeather = @{ time = $time; dayTime = $day; moonPhase = $moon; bloodMoon = $blood; eclipse = $eclipse }
    progression = @{ hardmode = $hardmode; bosses = $bosses }
    other = @{ killCountLength = $kills; claimableBannerLength = $banners }
  }
  if ($Progressed) { $result.bossOffsets = $bossOffsets; $result.hardmodeOffset = $hardmodeOffset }
  $result | ConvertTo-Json -Depth 10 -Compress
  $reader.Dispose()
}
